import { z } from 'zod';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { fetchText } from '../helpers';
import type { FetchedRecord, SourceAdapter } from '../types';
import { fetchRenderedHtml } from './firecrawl';
import { extractJsonLdEvents } from './jsonld';
import { normalizeHtmlRecord } from './payload';
import { selectorParsers } from './sources';

const configSchema = z.object({
  strategy: z.enum(['jsonld', 'selectors', 'firecrawl-jsonld']),
  listingUrls: z.array(z.string().url()).min(1),
  sourceKey: z.string().min(1),
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
    return dedupe(all);
  },

  normalize(record: FetchedRecord): NormalizedEvent | null {
    return normalizeHtmlRecord(record);
  },
};
