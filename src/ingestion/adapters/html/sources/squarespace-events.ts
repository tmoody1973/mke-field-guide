// Squarespace events-collection JSON parser factory.
//
// Squarespace event pages expose their listing as structured JSON at
// `<collection-url>?format=json` (no HTML scraping needed). The envelope
// carries both `upcoming` and `past` collections; only `upcoming` is a
// rolling window worth ingesting. `startDate`/`endDate` are epoch-ms
// ABSOLUTE instants (already UTC), not venue-local wall-clock text, so no
// chicago-time conversion applies here.
import * as cheerio from 'cheerio';
import { z } from 'zod';
import type { FetchedRecord } from '../../types';
import type { SelectorParser } from './index';

export interface SquarespaceEventsOptions {
  baseUrl: string;
  fallbackVenueName: string;
  fallbackVenueAddress: string;
  /** Title pattern for listings that are placeholders, not real events (e.g. closure notices). */
  skipTitle?: RegExp;
}

const squarespaceEnvelopeSchema = z.object({
  upcoming: z.array(z.unknown()),
});

const squarespaceItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  startDate: z.number(),
  endDate: z.number().optional(),
  fullUrl: z.string().min(1),
  location: z
    .object({
      addressTitle: z.string().optional(),
      addressLine1: z.string().optional(),
      addressLine2: z.string().optional(),
    })
    .optional(),
  assetUrl: z.string().optional(),
  excerpt: z.string().optional(),
});

type SquarespaceItem = z.infer<typeof squarespaceItemSchema>;

/** Strips markup from a Squarespace rich-text excerpt, collapsing whitespace. */
function stripHtmlTags(html: string): string {
  return cheerio.load(html).text().replace(/\s+/g, ' ').trim();
}

/** Joins non-empty address lines; empty-string fields (Jazz Gallery) count as absent. */
function joinNonEmpty(parts: Array<string | undefined>): string | undefined {
  const nonEmpty = parts.filter((part): part is string => Boolean(part && part.trim() !== ''));
  return nonEmpty.length > 0 ? nonEmpty.join(', ') : undefined;
}

function itemToRecord(item: SquarespaceItem, options: SquarespaceEventsOptions): FetchedRecord {
  const venueName = item.location?.addressTitle?.trim() || options.fallbackVenueName;
  const venueAddress =
    joinNonEmpty([item.location?.addressLine1, item.location?.addressLine2]) ?? options.fallbackVenueAddress;
  const url = options.baseUrl + item.fullUrl;
  const payload = {
    id: item.id,
    name: item.title.trim(),
    url,
    startDate: new Date(item.startDate).toISOString(),
    endDate: item.endDate !== undefined ? new Date(item.endDate).toISOString() : undefined,
    venueName,
    venueAddress,
    imageUrl: item.assetUrl,
    description: item.excerpt ? stripHtmlTags(item.excerpt) : undefined,
  };
  return { sourceEventId: item.id, sourceUrl: url, payload };
}

export function squarespaceEventsParser(options: SquarespaceEventsOptions): SelectorParser {
  return (html: string): { records: FetchedRecord[]; skipped: number } => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(html);
    } catch {
      return { records: [], skipped: 0 };
    }
    const envelope = squarespaceEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) return { records: [], skipped: 0 };

    const records: FetchedRecord[] = [];
    let skipped = 0;
    for (const rawItem of envelope.data.upcoming) {
      const item = squarespaceItemSchema.safeParse(rawItem);
      if (!item.success) {
        skipped += 1;
        continue;
      }
      if (options.skipTitle?.test(item.data.title)) {
        skipped += 1;
        continue;
      }
      records.push(itemToRecord(item.data, options));
    }
    return { records, skipped };
  };
}
