// ComedySportz Milwaukee — public SpotHopper JSON events API
// (spothopperapp.com/api/spots/8096/events).
//
// SpotHopper's `event_date` is a MIDNIGHT-UTC-NORMALIZED date wrapper
// ("2026-07-18T00:00:00.000+00:00") — the time-of-day component is not a
// real showtime, it is always 00:00:00 regardless of when the show
// actually starts. The real local start time lives in the separate
// `start_time` field ("19:00", 24h, already America/Chicago wall-clock —
// confirmed against `linked.spots[0].time_zone`). This parser therefore
// only ever reads the DATE part out of `event_date` and combines it with
// `start_time` through the chicago-time helpers; the UTC time-of-day on
// `event_date` is discarded entirely, never used as-is.
//
// Every event in the feed already carries a globally unique numeric `id`
// per showtime instance (SpotHopper materializes each recurring slot —
// e.g. "ComedySportz Match Friday 7:30pm" — as its own event row with its
// own date), so unlike Tribe's all_day/date-range events there is no
// day-range expansion here: one feed event is always one record.
//
// The feed carries no per-event URL — every show links back to the same
// shared listing page. Persist's own de-duplication keys on
// (source key, sourceEventId), not on URL uniqueness, so a shared URL
// would not by itself cause records to collide there. Each record's
// sourceUrl still gets a `#ev{id}` fragment appended so that distinct
// showtimes carry visibly distinct URLs (avoids the appearance, in any
// downstream UI or log, that 60 different shows are "the same link").
//
// Designed skip: `show_on_website !== true` (SpotHopper's own
// publish/unpublish flag for a show). Any row that fails schema
// validation (missing name/id, unparseable event_date or start_time) is
// also skipped, counted, never crashes the batch. A dead or reshaped
// payload — invalid JSON, or a JSON object missing the `events` array or
// the feed's single `linked.spots` entry — throws instead of reporting a
// healthy empty batch (same rule as every other JSON parser in this
// codebase).
import { z } from 'zod';
import type { FetchedRecord } from '../../types';
import { chicagoWallTimeToIso } from '@/lib/chicago-time';
import type { SelectorParser } from './index';

/** Shared listing page every ComedySportz Milwaukee show links back to (no per-event URL exists). */
export const COMEDYSPORTZ_LISTING_PAGE_URL = 'https://cszmke.com/milwaukee-comedysportz-milwaukee-events';

const EVENT_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T/;
const START_TIME_RE = /^(\d{1,2}):(\d{2})$/;

const spotSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
});

const eventSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string().min(1),
  text: z.string().optional(),
  event_date: z.string().min(1),
  start_time: z.string().min(1),
  duration_minutes: z.number().optional(),
  show_on_website: z.boolean(),
});

const envelopeSchema = z.object({
  events: z.array(z.unknown()),
  linked: z.object({ spots: z.array(spotSchema).min(1) }),
});

type ComedySportzEvent = z.infer<typeof eventSchema>;
type ComedySportzSpot = z.infer<typeof spotSchema>;

/** Date part only — the time-of-day on `event_date` is a midnight-UTC placeholder, never real. */
function eventDateParts(eventDate: string): { year: number; month: number; day: number } | null {
  const match = EVENT_DATE_RE.exec(eventDate);
  if (!match) return null;
  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

function startTimeParts(startTime: string): { hour: number; minute: number } | null {
  const match = START_TIME_RE.exec(startTime);
  if (!match) return null;
  const [, hour, minute] = match;
  return { hour: Number(hour), minute: Number(minute) };
}

function venueFields(spot: ComedySportzSpot): { venueName: string; venueAddress: string } {
  return {
    venueName: spot.name,
    venueAddress: `${spot.address}, ${spot.city}, ${spot.state}, ${spot.zip}`,
  };
}

function eventRecord(event: ComedySportzEvent, spot: ComedySportzSpot): FetchedRecord | null {
  const dateParts = eventDateParts(event.event_date);
  const timeParts = startTimeParts(event.start_time);
  if (!dateParts || !timeParts) return null;

  const startDate = chicagoWallTimeToIso(dateParts.year, dateParts.month, dateParts.day, timeParts.hour, timeParts.minute);
  const endDate =
    event.duration_minutes !== undefined
      ? new Date(Date.parse(startDate) + event.duration_minutes * 60_000).toISOString()
      : undefined;

  const id = String(event.id);
  // No per-event URL exists in the feed — every show links to the same
  // shared listing page. A `#ev{id}` fragment keeps each record's URL
  // (and therefore the user-facing link) visibly distinct per showtime,
  // even though persist's own de-duplication never keys on URL.
  const url = `${COMEDYSPORTZ_LISTING_PAGE_URL}#ev${id}`;
  return {
    sourceEventId: id,
    sourceUrl: url,
    payload: {
      id,
      name: event.name,
      description: event.text,
      url,
      startDate,
      endDate,
      ...venueFields(spot),
    },
  };
}

export function parseComedySportzJson(
  json: string,
  listingUrl: string,
): { records: FetchedRecord[]; skipped: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`${listingUrl} listing is not a ComedySportz Milwaukee JSON payload: ${cause}`);
  }

  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    const cause = envelope.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`${listingUrl} listing is not a ComedySportz Milwaukee JSON payload: ${cause}`);
  }

  const spot = envelope.data.linked.spots[0];
  const records: FetchedRecord[] = [];
  let skipped = 0;
  for (const rawEvent of envelope.data.events) {
    const event = eventSchema.safeParse(rawEvent);
    if (!event.success) {
      skipped += 1;
      continue;
    }
    if (event.data.show_on_website !== true) {
      skipped += 1;
      continue;
    }
    const record = eventRecord(event.data, spot);
    if (!record) {
      skipped += 1;
      continue;
    }
    records.push(record);
  }
  return { records, skipped };
}

export const comedySportzParser: SelectorParser = (json, listingUrl) => parseComedySportzJson(json, listingUrl);
