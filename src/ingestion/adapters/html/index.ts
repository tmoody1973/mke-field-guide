import { z } from 'zod';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { fetchText } from '../helpers';
import type { FetchedRecord, SourceAdapter } from '../types';
import { fetchRenderedHtml } from './firecrawl';
import { extractJsonLdEvents } from './jsonld';
import { normalizeHtmlRecord } from './payload';
import { detailEnrichers, selectorParsers, type DetailEnricher } from './sources';

const configSchema = z.object({
  strategy: z.enum(['jsonld', 'selectors', 'firecrawl-jsonld']),
  listingUrls: z.array(z.string().url()).min(1),
  sourceKey: z.string().min(1),
  // Opt-in bounded detail-page crawl: after listing parse + dedupe, up to `limit`
  // records with a sourceUrl are fetched sequentially and passed through the
  // source's registered detail enricher (see sources/index.ts).
  crawlDetails: z.object({ limit: z.number().int().positive().max(50) }).optional(),
});

function parseListing(
  config: z.infer<typeof configSchema>,
  html: string,
  url: string,
): FetchedRecord[] {
  if (config.strategy === 'jsonld' || config.strategy === 'firecrawl-jsonld') return extractJsonLdEvents(html, url);
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

async function crawlDetailPages(
  records: FetchedRecord[],
  limit: number,
  enricher: DetailEnricher,
): Promise<FetchedRecord[]> {
  const out: FetchedRecord[] = [];
  let attempted = 0;
  for (const record of records) {
    const eligible = attempted < limit && record.sourceUrl !== undefined;
    if (eligible) attempted += 1;
    out.push(eligible ? await enrichOne(record, enricher) : record);
  }
  return out;
}

export const htmlAdapter: SourceAdapter = {
  adapterType: 'html',

  async fetch(rawConfig: unknown): Promise<FetchedRecord[]> {
    const config = configSchema.parse(rawConfig);
    const all: FetchedRecord[] = [];
    for (const url of config.listingUrls) {
      const html =
        config.strategy === 'firecrawl-jsonld'
          ? await fetchRenderedHtml(url)
          : await fetchText(url, `HTML listing ${url}`);
      all.push(...parseListing(config, html, url));
    }
    const deduped = dedupe(all);
    const enricher = detailEnrichers[config.sourceKey];
    if (!config.crawlDetails || !enricher) return deduped;
    return crawlDetailPages(deduped, config.crawlDetails.limit, enricher);
  },

  normalize(record: FetchedRecord): NormalizedEvent | null {
    return normalizeHtmlRecord(record);
  },
};
