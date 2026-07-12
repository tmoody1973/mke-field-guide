import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { selectorParsers } from '@/ingestion/adapters/html/sources/index';
import { parseTribeEventsJson } from '@/ingestion/adapters/html/sources/tribe-events';

const wiggleRoomHtml = readFileSync(join(process.cwd(), 'tests/fixtures/html/wiggle-room.txt'), 'utf8');
const centroCafeJson = readFileSync(join(process.cwd(), 'tests/fixtures/html/centro-cafe.json'), 'utf8');

const WIGGLE_ROOM_LISTING_URL = 'https://wiggleroommke.com/wp-json/tribe/events/v1/events?per_page=50';
const CENTRO_CAFE_LISTING_URL = 'https://centrocaferiverwest.com/wp-json/tribe/events/v1/events?per_page=50';

describe('wiggle-room instance (firecrawl-wrapped Tribe JSON)', () => {
  const { records, skipped } = selectorParsers['wiggle-room'](wiggleRoomHtml, WIGGLE_ROOM_LISTING_URL);

  test('parses the <html><body>-wrapped fixture into records', () => {
    expect(skipped).toBe(0);
    expect(records).toHaveLength(5);
  });

  test('first record: title, Chicago wall-time start, and fallback venue (feed carries no Venue post)', () => {
    const record = records.find((r) => r.sourceEventId === '1135')!;
    const payload = record.payload as { name: string; startDate: string; venueName: string; venueAddress: string };
    expect(payload.name).toBe('DJ Asher Gray');
    // 2026-07-11 20:00:00 America/Chicago (CDT, UTC-5) -> 2026-07-12T01:00:00.000Z
    expect(payload.startDate).toBe('2026-07-12T01:00:00.000Z');
    expect(payload.venueName).toBe('Wiggle Room');
    expect(payload.venueAddress).toBe('2988 S Kinnickinnic Ave, Milwaukee, WI 53207');
  });

  test('a showtime crossing midnight keeps its real start time instead of fanning out into a day-range run', () => {
    // id 1135 itself: start_date 2026-07-11 20:00:00, end_date 2026-07-12 01:00:00 — different
    // calendar days, but all_day: false (a late bar set, not a multi-day RUN). The branch is driven
    // by all_day, not by comparing start/end date parts, so this stays a single showtime instance.
    const instances = records.filter((r) => r.sourceEventId === '1135');
    expect(instances).toHaveLength(1);
  });
});

describe('centro-cafe instance (raw Tribe JSON, plain fetch)', () => {
  const { records, skipped } = selectorParsers['centro-cafe'](centroCafeJson, CENTRO_CAFE_LISTING_URL);

  test('parses the raw fixture into records', () => {
    expect(skipped).toBe(0);
    expect(records).toHaveLength(4);
  });

  test('first record: venue "bar centro" with address falling back to Milwaukee, WI (city present, state absent)', () => {
    const record = records.find((r) => r.sourceEventId === '4135')!;
    const payload = record.payload as { name: string; venueName: string; venueAddress: string };
    expect(payload.name).toBe('CLAUDIA JOHNSON TRIO – alternative rock originals');
    expect(payload.venueName).toBe('bar centro');
    // Feed's venue object has city "Milwaukee" but no "state" key (only "province"/"stateprovince") —
    // an incomplete pair, so cityStateFrom falls back to the Milwaukee, WI default (the Todd Wehr case).
    expect(payload.venueAddress).toBe('804 E. Center St., Milwaukee, WI');
  });
});

describe('parseTribeEventsJson total-payload failures', () => {
  test('throws a source-identified error when no JSON object is found at all', () => {
    expect(() =>
      parseTribeEventsJson('plain text, no braces anywhere', 'https://example.com/listing', {
        listingLabel: 'Example Tribe Events',
      }),
    ).toThrow(/not a Example Tribe Events JSON payload/);
  });

  test('throws when the envelope has no events array', () => {
    expect(() =>
      parseTribeEventsJson(JSON.stringify({ notEvents: [] }), 'https://example.com/listing', {
        listingLabel: 'Example Tribe Events',
      }),
    ).toThrow(/not a Example Tribe Events JSON payload/);
  });
});
