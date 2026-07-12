// The Events Calendar (Tribe) REST JSON parser factory
// (wp-json/tribe/events/v1/events) — shared by every venue running the
// WordPress "The Events Calendar" plugin (Marcus Center, Wiggle Room,
// Centro Café so far).
//
// Tribe's `start_date`/`end_date` are Chicago wall-clock strings
// ("2026-07-14 19:00:00") with no offset — each event's own `timezone`
// field confirms "America/Chicago" — so this parser routes through the
// chicago-time helpers, same as cactus-club and county-parks.
//
// Multi-day vs. single-showtime is a three-way rule, not a straight
// all_day check:
//   1. `all_day: true` — Tribe's own multi-day-RUN signal (Broadway-style
//      shows spanning a week or more come back with `start_date` at
//      00:00:00, `end_date` at 23:59:59) — always expands through the
//      day-range machinery.
//   2. `all_day: false` and the date parts span at most one calendar day
//      apart — a same-day showtime that merely runs past midnight (a bar's
//      last set ending at 1am) — stays a single record at its real start
//      time; treating it as a range would replace that real time with a
//      midnight placeholder.
//   3. `all_day: false` and the date parts span two or more calendar days
//      — a genuinely multi-day TIMED event (a weekend festival pass, a
//      multi-night residency, not all-day) — still expands through the
//      day-range machinery, same as case 1; collapsing it to one record
//      would silently drop every day after the first.
// Only case 2 stays a single record; cases 1 and 3 both expand.
//
// Tribe's `image` field is `false` (not null/absent) when an event has no
// featured image, so the Zod schema unions z.literal(false) with the
// object shape — otherwise every imageless event would fail validation
// and get silently skipped.
//
// Not every venue's feed attaches a Venue custom-post-type to its events —
// Tribe returns `venue: []` (an empty array, not an object) when none is
// configured. The venue field is normalized to `undefined` in that case and
// falls back to the instance's configured fallback venue name/address when
// provided (same idiom as squarespaceEventsParser); an event with neither a
// real venue nor a configured fallback is skipped, same as any other
// malformed record.
//
// Some sources are only reachable through Firecrawl (Cloudflare-gated
// sites), which wraps the JSON body in `<html><body>…</body></html>`. The
// JSON is extracted from the first `{` to the last `}` before parsing —
// harmless for raw JSON (whose first character already is `{`) and
// tolerant of the wrapper when present. No braces at all still fails
// loudly, same as any other total-payload parse failure.
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { chicagoWallTimeToIso } from '@/lib/chicago-time';
import type { FetchedRecord } from '../../types';
import { dedupeDayRecords, expandDayRange, type DayDate } from '../day-range';
import type { SelectorParser } from './index';

/** Safety cap so a misparsed range cannot fan out into hundreds of instances. */
const MAX_RANGE_DAYS = 120;
const WALL_TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export interface TribeEventsOptions {
  /** Names the feed in loud parse-failure messages, e.g. "Marcus Center Tribe Events". */
  listingLabel: string;
  /** Used only when an event carries no venue post (Tribe returns `venue: []`). */
  fallbackVenueName?: string;
  /** Full "address, City, State" fallback paired with fallbackVenueName. */
  fallbackVenueAddress?: string;
}

const venueSchema = z.object({
  venue: z.string().min(1),
  address: z.string().min(1),
  city: z.string().optional(),
  state: z.string().optional(),
});

/** Tribe sends `venue: []` instead of an object when no Venue post is attached. */
const venueFieldSchema = z.preprocess(
  (value) => (Array.isArray(value) ? undefined : value),
  venueSchema.optional(),
);

const imageSchema = z.union([z.literal(false), z.object({ url: z.string().min(1) })]);

const tribeEventSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().min(1),
  url: z.string().min(1),
  excerpt: z.string().optional(),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  all_day: z.boolean().optional(),
  venue: venueFieldSchema,
  image: imageSchema.optional(),
});

const envelopeSchema = z.object({ events: z.array(z.unknown()) });

type TribeEvent = z.infer<typeof tribeEventSchema>;
type WallTime = { year: number; month: number; day: number; hour: number; minute: number };

/** Parses Tribe's "YYYY-MM-DD HH:MM:SS" wall-clock string; null when malformed. */
function parseWallTime(value: string): WallTime | null {
  const match = WALL_TIME_RE.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
}

/** Whole calendar days between two dates (UTC-anchored, ignores wall-clock time-of-day). */
function calendarDaySpan(start: DayDate, end: DayDate): number {
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endMs - startMs) / 86_400_000);
}

/** Decodes HTML entities (`&#8217;` -> `'`) via cheerio's text-node parsing. */
function decodeHtmlEntities(text: string): string {
  return cheerio.load(text).text();
}

/** Strips markup from Tribe's rich-text excerpt, collapsing whitespace. */
function stripHtmlTags(html: string): string {
  return cheerio.load(html).text().replace(/\s+/g, ' ').trim();
}

function imageUrlFrom(image: TribeEvent['image']): string | undefined {
  return image ? image.url : undefined;
}

/** Fallback default for a campus where every hall sits in Milwaukee, WI. */
const DEFAULT_CITY_STATE = 'Milwaukee, WI';

/**
 * "City, State" from the feed's own venue fields — only when BOTH are
 * present (a complete pair). Tribe's Todd Wehr Theater record (Marcus) and
 * Centro Café's Bar Centro record both carry a city but no state (a
 * garbled zip / a `province` key instead of `state`), so a partial pair
 * falls back to the campus default rather than mixing one real field with
 * one guessed field.
 */
function cityStateFrom(venue: NonNullable<TribeEvent['venue']>): string {
  if (venue.city && venue.state) return `${venue.city}, ${venue.state}`;
  return DEFAULT_CITY_STATE;
}

type VenueFields = { venueName: string; venueAddress: string };

/** Real per-event venue when the feed attaches one; else the instance's configured fallback. */
function venueFieldsFrom(event: TribeEvent, options: TribeEventsOptions): VenueFields | undefined {
  if (event.venue) {
    return { venueName: event.venue.venue, venueAddress: `${event.venue.address}, ${cityStateFrom(event.venue)}` };
  }
  if (options.fallbackVenueName && options.fallbackVenueAddress) {
    return { venueName: options.fallbackVenueName, venueAddress: options.fallbackVenueAddress };
  }
  return undefined;
}

function baseFields(event: TribeEvent, venueFields: VenueFields) {
  return {
    id: String(event.id),
    name: decodeHtmlEntities(event.title),
    description: event.excerpt ? stripHtmlTags(event.excerpt) : undefined,
    url: event.url,
    venueName: venueFields.venueName,
    venueAddress: venueFields.venueAddress,
    imageUrl: imageUrlFrom(event.image),
  };
}

function singleDayRecord(
  event: TribeEvent,
  venueFields: VenueFields,
  wallTime: WallTime,
  listingUrl: string,
): FetchedRecord {
  const startDate = chicagoWallTimeToIso(wallTime.year, wallTime.month, wallTime.day, wallTime.hour, wallTime.minute);
  return { sourceEventId: String(event.id), sourceUrl: listingUrl, payload: { ...baseFields(event, venueFields), startDate } };
}

function dayRunRecords(
  event: TribeEvent,
  venueFields: VenueFields,
  start: DayDate,
  end: DayDate,
  listingUrl: string,
): FetchedRecord[] {
  return expandDayRange(start, end, MAX_RANGE_DAYS).map((day) => ({
    sourceEventId: String(event.id),
    sourceUrl: listingUrl,
    payload: { ...baseFields(event, venueFields), startDate: chicagoWallTimeToIso(day.year, day.month, day.day, 0, 0) },
  }));
}

/** Every FetchedRecord for one Tribe event: a single showtime instance, or day-range instances for a run. */
function eventRecords(event: TribeEvent, listingUrl: string, options: TribeEventsOptions): FetchedRecord[] {
  const venueFields = venueFieldsFrom(event, options);
  if (!venueFields) return [];

  const startWall = parseWallTime(event.start_date);
  const endWall = parseWallTime(event.end_date);
  if (!startWall || !endWall) return [];

  const start: DayDate = { year: startWall.year, month: startWall.month, day: startWall.day };
  const end: DayDate = { year: endWall.year, month: endWall.month, day: endWall.day };
  const isMultiDayRun = event.all_day === true || calendarDaySpan(start, end) >= 2;
  if (!isMultiDayRun) return [singleDayRecord(event, venueFields, startWall, listingUrl)];

  return dayRunRecords(event, venueFields, start, end, listingUrl);
}

/** Slices from the first `{` to the last `}` — tolerates a Firecrawl `<html><body>` wrapper. */
function extractJsonPayload(html: string): string | null {
  const start = html.indexOf('{');
  const end = html.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return html.slice(start, end + 1);
}

export function parseTribeEventsJson(
  html: string,
  listingUrl: string,
  options: TribeEventsOptions,
): { records: FetchedRecord[]; skipped: number } {
  const jsonText = extractJsonPayload(html);
  if (jsonText === null) {
    throw new Error(`${listingUrl} listing is not a ${options.listingLabel} JSON payload: no JSON object found`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`${listingUrl} listing is not a ${options.listingLabel} JSON payload: ${cause}`);
  }
  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    const cause = envelope.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`${listingUrl} listing is not a ${options.listingLabel} JSON payload: ${cause}`);
  }

  const records: FetchedRecord[] = [];
  let skipped = 0;
  for (const rawEvent of envelope.data.events) {
    const event = tribeEventSchema.safeParse(rawEvent);
    if (!event.success) {
      skipped += 1;
      continue;
    }
    const eventInstances = eventRecords(event.data, listingUrl, options);
    if (eventInstances.length === 0) {
      skipped += 1;
      continue;
    }
    records.push(...eventInstances);
  }
  return { records: dedupeDayRecords(records), skipped };
}

export function tribeEventsParser(options: TribeEventsOptions): SelectorParser {
  return (html, listingUrl) => parseTribeEventsJson(html, listingUrl, options);
}
