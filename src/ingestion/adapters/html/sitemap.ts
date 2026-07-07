import * as cheerio from 'cheerio';
import { z } from 'zod';
import { fetchText } from '../helpers';
import type { FetchedRecord, FetchOutcome } from '../types';
import { extractJsonLdEvents } from './jsonld';
import { defaultSleep, mapWithDelay, type SleepFn } from './pacing';
import { detailEnrichers, type DetailEnricher } from './sources';

// For sites whose listing page is JS-rendered without structured data but whose
// event DETAIL pages are server-rendered with JSON-LD (e.g. SimpleView CMS /
// visitmilwaukee.org): enumerate detail URLs from the public sitemap, then
// extract each page's JSON-LD Event nodes.
export const sitemapConfigSchema = z.object({
  strategy: z.literal('sitemap-jsonld'),
  sourceKey: z.string().min(1),
  sitemapUrl: z.string().url(),
  /** Substring an event detail URL must contain to be crawled (e.g. '/event/'). */
  urlFilter: z.string().min(1),
  /** Detail pages crawled per run, newest <lastmod> first. */
  limit: z.number().int().positive().max(300),
  /** Pause between detail fetches; set from the host's robots.txt crawl-delay. */
  delayMs: z.number().int().positive().default(2000),
});

export type SitemapConfig = z.infer<typeof sitemapConfigSchema>;

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

export function parseSitemapEntries(xml: string): SitemapEntry[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const entries: SitemapEntry[] = [];
  $('url').each((_, element) => {
    const loc = $(element).children('loc').first().text().trim();
    if (!loc) return;
    const lastmod = $(element).children('lastmod').first().text().trim();
    entries.push(lastmod ? { loc, lastmod } : { loc });
  });
  return entries;
}

// Newest lastmod first so a bounded crawl prioritizes recently changed events.
// Entries without lastmod fall back to document order, after all dated entries.
export function selectDetailUrls(
  entries: SitemapEntry[],
  urlFilter: string,
  limit: number,
): string[] {
  const matching = entries.filter((entry) => entry.loc.includes(urlFilter));
  const dated = matching.filter((entry) => entry.lastmod !== undefined);
  const undated = matching.filter((entry) => entry.lastmod === undefined);
  const newestFirst = [...dated].sort((a, b) => String(b.lastmod).localeCompare(String(a.lastmod)));
  return [...newestFirst, ...undated].slice(0, limit).map((entry) => entry.loc);
}

// A throwing enricher never loses the page's extraction — the record ships unenriched.
function applyEnricher(
  records: FetchedRecord[],
  html: string,
  enricher: DetailEnricher | undefined,
): FetchedRecord[] {
  if (!enricher) return records;
  return records.map((record) => {
    try {
      return enricher(record, html);
    } catch {
      return record;
    }
  });
}

// The urlFilter marked this page as an event, so a fetch failure or a page with
// no JSON-LD Event nodes is "recognized but unextractable" — it counts as skipped.
// A single bad page never aborts the crawl.
async function extractDetailPage(
  url: string,
  enricher: DetailEnricher | undefined,
): Promise<{ records: FetchedRecord[]; skipped: number }> {
  let html: string;
  try {
    html = await fetchText(url, `sitemap detail ${url}`);
  } catch {
    return { records: [], skipped: 1 };
  }
  const records = extractJsonLdEvents(html, url);
  if (records.length === 0) return { records: [], skipped: 1 };
  return { records: applyEnricher(records, html, enricher), skipped: 0 };
}

export async function crawlSitemapJsonLd(
  config: SitemapConfig,
  sleepFn: SleepFn = defaultSleep,
): Promise<FetchOutcome> {
  const xml = await fetchText(config.sitemapUrl, `sitemap ${config.sitemapUrl}`);
  const urls = selectDetailUrls(parseSitemapEntries(xml), config.urlFilter, config.limit);
  const enricher = detailEnrichers[config.sourceKey];
  const pages = await mapWithDelay(
    urls,
    config.delayMs,
    (url) => extractDetailPage(url, enricher),
    sleepFn,
  );
  return {
    records: pages.flatMap((page) => page.records),
    parseSkipped: pages.reduce((sum, page) => sum + page.skipped, 0),
  };
}
