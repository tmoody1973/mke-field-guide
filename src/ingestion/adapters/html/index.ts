import { z } from 'zod';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { fetchText } from '../helpers';
import type { FetchedRecord, FetchOutcome, SourceAdapter } from '../types';
import { fetchRenderedHtml } from './firecrawl';
import { extractJsonLdEvents } from './jsonld';
import { defaultSleep, mapWithDelay, type SleepFn } from './pacing';
import { crawlMilwaukeeImprov, milwaukeeImprovConfigSchema } from './sources/milwaukee-improv';
import { normalizeHtmlRecord } from './payload';
import { crawlSitemapJsonLd, sitemapConfigSchema } from './sitemap';
import { detailEnrichers, selectorParsers, type DetailEnricher } from './sources';

const listingConfigSchema = z.object({
  strategy: z.enum(['jsonld', 'selectors', 'firecrawl-jsonld', 'firecrawl-selectors']),
  listingUrls: z.array(z.string().url()).min(1),
  sourceKey: z.string().min(1),
  // Opt-in bounded detail-page crawl: after listing parse + dedupe, up to `limit`
  // records with a sourceUrl are fetched sequentially and passed through the
  // source's registered detail enricher (see sources/index.ts).
  crawlDetails: z.object({ limit: z.number().int().positive().max(50) }).optional(),
});

const configSchema = z.discriminatedUnion('strategy', [
  listingConfigSchema,
  sitemapConfigSchema,
  milwaukeeImprovConfigSchema,
]);

type ListingConfig = z.infer<typeof listingConfigSchema>;

function parseListing(
  config: ListingConfig,
  html: string,
  url: string,
): { records: FetchedRecord[]; skipped: number } {
  if (config.strategy === 'jsonld' || config.strategy === 'firecrawl-jsonld') {
    return { records: extractJsonLdEvents(html, url), skipped: 0 };
  }
  const parser = selectorParsers[config.sourceKey];
  if (!parser) throw new Error(`No selector parser registered for source: ${config.sourceKey}`);
  return parser(html, url);
}

// Keyed on id + startDate so a multi-day event's intentional day-records (one per
// occurrence, sharing a sourceEventId — e.g. milwaukee-world-festival) all survive,
// while true duplicates across listing pages still collapse.
function dedupe(records: FetchedRecord[]): FetchedRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const startDate = (r.payload as { startDate?: string }).startDate;
    const key = `${r.sourceEventId}|${String(startDate ?? '')}`;
    return seen.has(key) ? false : seen.add(key);
  });
}

// A failed detail fetch (or a throwing enricher) on a single record never aborts
// the run: that record simply stays unenriched — listing-level data is still
// publishable and the remaining records keep crawling.
async function enrichOne(record: FetchedRecord, enricher: DetailEnricher): Promise<FetchedRecord> {
  if (!record.sourceUrl) return record;
  try {
    const html = await fetchText(record.sourceUrl, `HTML detail ${record.sourceUrl}`);
    return enricher(record, html);
  } catch {
    return record;
  }
}

/** Pause between sequential detail-page fetches; polite pacing for small venue sites. */
const DETAIL_CRAWL_DELAY_MS = 250;

export async function crawlDetailPages(
  records: FetchedRecord[],
  limit: number,
  enricher: DetailEnricher,
  sleepFn: SleepFn = defaultSleep,
): Promise<FetchedRecord[]> {
  const eligible = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.sourceUrl !== undefined)
    .slice(0, limit);
  const enriched = await mapWithDelay(
    eligible,
    DETAIL_CRAWL_DELAY_MS,
    ({ record }) => enrichOne(record, enricher),
    sleepFn,
  );
  const enrichedByIndex = new Map(eligible.map(({ index }, position) => [index, enriched[position]]));
  return records.map((record, index) => enrichedByIndex.get(index) ?? record);
}

export const htmlAdapter: SourceAdapter = {
  adapterType: 'html',

  async fetch(rawConfig: unknown): Promise<FetchOutcome> {
    const config = configSchema.parse(rawConfig);
    if (config.strategy === 'sitemap-jsonld') return crawlSitemapJsonLd(config);
    if (config.strategy === 'calendar-jsonld') return crawlMilwaukeeImprov(config);
    const all: FetchedRecord[] = [];
    let parseSkipped = 0;
    for (const url of config.listingUrls) {
      const usesFirecrawl = config.strategy === 'firecrawl-jsonld' || config.strategy === 'firecrawl-selectors';
      const html = usesFirecrawl ? await fetchRenderedHtml(url) : await fetchText(url, `HTML listing ${url}`);
      const parsed = parseListing(config, html, url);
      all.push(...parsed.records);
      parseSkipped += parsed.skipped;
    }
    const deduped = dedupe(all);
    const enricher = detailEnrichers[config.sourceKey];
    if (!config.crawlDetails || !enricher) return { records: deduped, parseSkipped };
    return { records: await crawlDetailPages(deduped, config.crawlDetails.limit, enricher), parseSkipped };
  },

  normalize(record: FetchedRecord): NormalizedEvent | null {
    return normalizeHtmlRecord(record);
  },
};
