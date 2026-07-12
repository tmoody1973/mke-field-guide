// Marcus Performing Arts Center — The Events Calendar REST JSON parser
// (wp-json/tribe/events/v1/events).
//
// Tribe's `start_date`/`end_date` are Chicago wall-clock strings
// ("2026-07-14 19:00:00") with no offset — each event's own `timezone`
// field confirms "America/Chicago" — so this parser routes through the
// chicago-time helpers, same as cactus-club and county-parks.
//
// Single-day events carry a real showtime and equal start/end date parts.
// Multi-day RUNS (Broadway-series shows spanning a week or more) come back
// with `start_date` at 00:00:00, `end_date` at 23:59:59, and `all_day: true`
// — Tribe's way of expressing a date range, not a specific performance
// time. Per Decision 3, those become day-range instances (one all-day
// instance per calendar day, sharing one sourceEventId) via the existing
// day-range machinery — no showtime is invented for them.
//
// Tribe's `image` field is `false` (not null/absent) when an event has no
// featured image, so the Zod schema unions z.literal(false) with the
// object shape — otherwise every imageless event would fail validation
// and get silently skipped.
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { chicagoWallTimeToIso } from '@/lib/chicago-time';
import type { FetchedRecord } from '../../types';
import { dedupeDayRecords, expandDayRange, type DayDate } from '../day-range';
import type { SelectorParser } from './index';

/** Safety cap so a misparsed range cannot fan out into hundreds of instances. */
const MAX_RANGE_DAYS = 120;
const WALL_TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

const venueSchema = z.object({
  venue: z.string().min(1),
  address: z.string().min(1),
});

const imageSchema = z.union([z.literal(false), z.object({ url: z.string().min(1) })]);

const tribeEventSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().min(1),
  url: z.string().min(1),
  excerpt: z.string().optional(),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  venue: venueSchema,
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

function baseFields(event: TribeEvent) {
  return {
    id: String(event.id),
    name: decodeHtmlEntities(event.title),
    description: event.excerpt ? stripHtmlTags(event.excerpt) : undefined,
    url: event.url,
    venueName: event.venue.venue,
    venueAddress: `${event.venue.address}, Milwaukee, WI`,
    imageUrl: imageUrlFrom(event.image),
  };
}

function singleDayRecord(event: TribeEvent, wallTime: WallTime, listingUrl: string): FetchedRecord {
  const startDate = chicagoWallTimeToIso(wallTime.year, wallTime.month, wallTime.day, wallTime.hour, wallTime.minute);
  return { sourceEventId: String(event.id), sourceUrl: listingUrl, payload: { ...baseFields(event), startDate } };
}

function dayRunRecords(event: TribeEvent, start: DayDate, end: DayDate, listingUrl: string): FetchedRecord[] {
  return expandDayRange(start, end, MAX_RANGE_DAYS).map((day) => ({
    sourceEventId: String(event.id),
    sourceUrl: listingUrl,
    payload: { ...baseFields(event), startDate: chicagoWallTimeToIso(day.year, day.month, day.day, 0, 0) },
  }));
}

/** Every FetchedRecord for one Tribe event: a single showtime instance, or day-range instances for a run. */
function eventRecords(event: TribeEvent, listingUrl: string): FetchedRecord[] {
  const startWall = parseWallTime(event.start_date);
  const endWall = parseWallTime(event.end_date);
  if (!startWall || !endWall) return [];

  const isSingleDay =
    startWall.year === endWall.year && startWall.month === endWall.month && startWall.day === endWall.day;
  if (isSingleDay) return [singleDayRecord(event, startWall, listingUrl)];

  return dayRunRecords(
    event,
    { year: startWall.year, month: startWall.month, day: startWall.day },
    { year: endWall.year, month: endWall.month, day: endWall.day },
    listingUrl,
  );
}

export function parseMarcusCenterJson(
  html: string,
  listingUrl: string,
): { records: FetchedRecord[]; skipped: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(html);
  } catch {
    return { records: [], skipped: 0 };
  }
  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) return { records: [], skipped: 0 };

  const records: FetchedRecord[] = [];
  let skipped = 0;
  for (const rawEvent of envelope.data.events) {
    const event = tribeEventSchema.safeParse(rawEvent);
    if (!event.success) {
      skipped += 1;
      continue;
    }
    const eventInstances = eventRecords(event.data, listingUrl);
    if (eventInstances.length === 0) {
      skipped += 1;
      continue;
    }
    records.push(...eventInstances);
  }
  return { records: dedupeDayRecords(records), skipped };
}

export const marcusCenterParser: SelectorParser = (html, listingUrl) => parseMarcusCenterJson(html, listingUrl);
