import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';
import {
  COMEDYSPORTZ_LISTING_PAGE_URL,
  parseComedySportzJson,
} from '@/ingestion/adapters/html/sources/comedysportz';

const json = readFileSync(join(process.cwd(), 'tests/fixtures/html/comedysportz.json'), 'utf8');
const LISTING_URL = 'https://www.spothopperapp.com/api/spots/8096/events';

describe('parseComedySportzJson', () => {
  const { records, skipped } = parseComedySportzJson(json, LISTING_URL);

  test('parses a happy-path event: title, Chicago-local start, duration-derived end, venue', () => {
    // id 2960873 "ComedySportz 104 Student Showcase": event_date 2026-07-15
    // (date part only) + start_time 19:30, duration_minutes 90.
    const record = records.find((r) => r.sourceEventId === '2960873')!;
    const payload = record.payload as {
      name: string;
      startDate: string;
      endDate?: string;
      venueName: string;
      venueAddress: string;
    };
    expect(payload.name).toBe('ComedySportz 104 Student Showcase');
    // 2026-07-15 19:30 America/Chicago (CDT, UTC-5) -> 2026-07-16T00:30:00.000Z
    expect(payload.startDate).toBe('2026-07-16T00:30:00.000Z');
    // +90 minutes
    expect(payload.endDate).toBe('2026-07-16T02:00:00.000Z');
    expect(payload.venueName).toBe('ComedySportz Milwaukee');
    expect(payload.venueAddress).toBe('420 South 1st Street, Milwaukee, WI, 53204');
  });

  test('the midnight-UTC event_date trap: date part + start_time in America/Chicago, never the raw UTC timestamp', () => {
    // id 3152142 "Sketch 22 (#37)": event_date "2026-07-18T00:00:00.000+00:00"
    // (midnight UTC — a lie about the showtime) + start_time "19:00".
    // Correct: 2026-07-18 19:00 America/Chicago (CDT, UTC-5) -> 2026-07-19T00:00:00.000Z.
    // Wrong answers this guards against: using the raw event_date timestamp
    // directly (2026-07-18T00:00:00.000Z — July 18 at midnight, no time-of-day
    // applied) or misreading the date part as July 17 by subtracting a day.
    const record = records.find((r) => r.sourceEventId === '3152142')!;
    const payload = record.payload as { startDate: string };
    expect(payload.startDate).toBe('2026-07-19T00:00:00.000Z');
    expect(payload.startDate).not.toBe('2026-07-18T00:00:00.000Z');
    expect(payload.startDate).not.toBe('2026-07-18T01:00:00.000Z'); // July 17 19:00 Chicago misread
  });

  test('show_on_website: false is skipped and counted, not published', () => {
    // Synthetic fixture row id 9999999, _synthetic: true, show_on_website: false
    // (no real event in the live 60-event fetch carried show_on_website: false;
    // disclosed in the task report).
    expect(records.some((r) => r.sourceEventId === '9999999')).toBe(false);
    expect(skipped).toBeGreaterThan(0);
  });

  test('a malformed row (missing name, unparseable event_date) is skipped and counted, batch survives', () => {
    const parsed = JSON.parse(json) as { events: Array<Record<string, unknown>> };
    const missingName = { ...parsed.events[0], id: 888001, name: undefined };
    const badDate = { ...parsed.events[0], id: 888002, event_date: 'not-a-date' };
    const payload = JSON.stringify({
      events: [missingName, badDate],
      linked: (JSON.parse(json) as { linked: unknown }).linked,
    });

    const { records: batchRecords, skipped: batchSkipped } = parseComedySportzJson(payload, LISTING_URL);
    expect(batchRecords).toHaveLength(0);
    expect(batchSkipped).toBe(2);
  });

  test('an empty-but-valid events array yields zero records without throwing (a legitimately quiet week)', () => {
    const parsedLinked = (JSON.parse(json) as { linked: unknown }).linked;
    const quietPayload = JSON.stringify({ events: [], linked: parsedLinked });
    const { records: quietRecords, skipped: quietSkipped } = parseComedySportzJson(quietPayload, LISTING_URL);
    expect(quietRecords).toHaveLength(0);
    expect(quietSkipped).toBe(0);
  });

  test('a missing events array or invalid JSON throws instead of reporting a healthy empty batch', () => {
    const parsedLinked = (JSON.parse(json) as { linked: unknown }).linked;
    expect(() =>
      parseComedySportzJson(JSON.stringify({ notEvents: [], linked: parsedLinked }), LISTING_URL),
    ).toThrow(/not a ComedySportz Milwaukee JSON payload/);
    expect(() => parseComedySportzJson('<!doctype html><html><body>Not JSON</body></html>', LISTING_URL)).toThrow(
      /not a ComedySportz Milwaukee JSON payload/,
    );
  });

  test('recurring-title pair ("ComedySportz Match Friday 7:30pm" on two different weeks) yields two distinct records', () => {
    const fridayMatches = records.filter((r) => (r.payload as { name: string }).name === 'ComedySportz Match Friday 7:30pm');
    expect(fridayMatches).toHaveLength(2);
    const startDates = fridayMatches.map((r) => (r.payload as { startDate: string }).startDate).sort();
    expect(new Set(startDates).size).toBe(2);
  });

  test('url fallback: no per-event URL exists in the feed, so the user-facing url is the shared listing page with a unique #ev{id} fragment', () => {
    const record = records.find((r) => r.sourceEventId === '2960873')!;
    const expectedUrl = `${COMEDYSPORTZ_LISTING_PAGE_URL}#ev2960873`;
    expect(record.sourceUrl).toBe(expectedUrl);
    expect((record.payload as { url: string }).url).toBe(expectedUrl);
    expect(normalizeHtmlRecord(record)?.url).toBe(expectedUrl);
  });

  test('normalizes a parsed record into a valid NormalizedEvent', () => {
    const record = records.find((r) => r.sourceEventId === '2960873')!;
    const normalized = normalizeHtmlRecord(record);
    expect(normalized?.title).toBe('ComedySportz 104 Student Showcase');
    expect(normalized?.status).toBe('scheduled');
  });
});
