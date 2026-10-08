import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';
import { hoursFrom, parseMilwaukeeWorldFestivalHtml } from '@/ingestion/adapters/html/sources/milwaukee-world-festival';

const html = readFileSync(
  join(process.cwd(), 'tests/fixtures/html/milwaukee-world-festival.html'),
  'utf8',
);
const LISTING_URL = 'https://www.milwaukeeworldfestival.com/find-events/calendar';

describe('parseMilwaukeeWorldFestivalHtml', () => {
  const { records, skipped } = parseMilwaukeeWorldFestivalHtml(html, LISTING_URL);
  const uniqueIds = new Set(records.map((r) => r.sourceEventId));

  test('emits one record per day-occurrence across all cards', () => {
    // 35 cards on the fixture; 1 skipped (no year) -> 34 events fanned into 61 day-records.
    expect(records.length).toBe(61);
    expect(uniqueIds.size).toBe(34);
  });

  test('counts the yearless card as skipped instead of dropping it silently', () => {
    expect(skipped).toBe(1);
  });

  test('multi-range card (Summerfest) yields one day-record per festival day, one shared id', () => {
    // "June 18-20, June 25-27, and July 2-4, 2026" -> 9 days, 3 non-contiguous weekends.
    const summerfest = records.filter((r) => r.sourceEventId === 'mwf:summerfest');
    expect(summerfest).toHaveLength(9);
    const dates = summerfest.map((r) => (r.payload as { startDate: string }).startDate);
    expect(dates).toEqual([
      '2026-06-18T05:00:00.000Z', '2026-06-19T05:00:00.000Z', '2026-06-20T05:00:00.000Z',
      '2026-06-25T05:00:00.000Z', '2026-06-26T05:00:00.000Z', '2026-06-27T05:00:00.000Z',
      '2026-07-02T05:00:00.000Z', '2026-07-03T05:00:00.000Z', '2026-07-04T05:00:00.000Z',
    ]);
    // Every day-record carries the shared card id in its payload (same canonical event).
    for (const r of summerfest) expect((r.payload as { id: string }).id).toBe('mwf:summerfest');
  });

  test('single-day card maps name, venue, image and the hours its description states', () => {
    const dragon = records.filter((r) => r.sourceEventId === 'mwf:milwaukee dragon boat festival');
    expect(dragon).toHaveLength(1);
    const p = dragon[0].payload as Record<string, unknown>;
    expect(p.name).toBe('Milwaukee Dragon Boat Festival');
    expect(p.venueName).toBe('Henry Maier Festival Park');
    // "July 11, 2026" + "from 8:00 a.m. to 4:00 p.m." in the description -> 8 AM to 4 PM America/Chicago (CDT, UTC-5).
    expect(p.startDate).toBe('2026-07-11T13:00:00.000Z');
    expect(p.endDate).toBe('2026-07-11T21:00:00.000Z');
    // Relative img src resolved against the page's <base href>, not the listing URL path.
    expect(p.imageUrl).toBe(
      'https://www.milwaukeeworldfestival.com/assets/img/Calendar/dragon-boat-festival-800x600.jpg',
    );
  });

  // The cards have no time fields, but a day event usually states its hours in prose. Without them the event read as
  // starting at midnight downstream (Doggy Day at the Lakefront, "from 9am - 2pm", 2026-10-08).
  test('an en-dash range with a.m./p.m. sets start and end (Family Fun Day)', () => {
    const day = records.find((r) => r.sourceEventId === 'mwf:family fun day july 19 family health and wellness')!.payload as Record<string, unknown>;
    expect(day.startDate).toBe('2026-07-19T15:00:00.000Z');
    expect(day.endDate).toBe('2026-07-19T19:00:00.000Z');
  });

  test('"Noon – 10pm" starts at noon and ends that night (Incredible India)', () => {
    const india = records.find((r) => r.sourceEventId === 'mwf:incredible india festival')!.payload as Record<string, unknown>;
    expect(india.startDate).toBe('2026-07-18T17:00:00.000Z');
    expect(india.endDate).toBe('2026-07-19T03:00:00.000Z');
  });

  test('a card that states no hours stays date-only (Summerfest)', () => {
    for (const r of records.filter((x) => x.sourceEventId === 'mwf:summerfest')) {
      const p = r.payload as Record<string, unknown>;
      expect(p.startDate).toMatch(/T05:00:00\.000Z$/);
      expect(p.endDate).toBeUndefined();
    }
  });

  test('contiguous range spelled with the month twice expands day-by-day', () => {
    // "June 23 - June 26, 2026" (Summerfest Tech).
    const tech = records.filter((r) => r.sourceEventId === 'mwf:summerfest tech');
    expect(tech.map((r) => (r.payload as { startDate: string }).startDate)).toEqual([
      '2026-06-23T05:00:00.000Z', '2026-06-24T05:00:00.000Z',
      '2026-06-25T05:00:00.000Z', '2026-06-26T05:00:00.000Z',
    ]);
  });

  test('skips a card whose date text has no year (Light The Night)', () => {
    // Fixture card reads "September 17 | Blood Cancer United's Light The Night".
    expect([...uniqueIds].some((id) => id.includes('light the night'))).toBe(false);
  });

  test('normalizes into a valid NormalizedEvent', () => {
    const normalized = normalizeHtmlRecord(records.find((r) => r.sourceEventId === 'mwf:irish fest')!);
    expect(normalized?.title).toBe('Irish Fest');
    expect(normalized?.venueName).toBe('Henry Maier Festival Park');
    expect(normalized?.startAt.toISOString()).toBe('2026-08-13T05:00:00.000Z');
    expect(normalized?.status).toBe('scheduled');
  });

  test('never emits duplicate (id, startDate) pairs', () => {
    const keys = records.map((r) => `${r.sourceEventId}|${(r.payload as { startDate: string }).startDate}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('hoursFrom', () => {
  test('reads the formats on the calendar', () => {
    expect(hoursFrom('on Saturday, October 10, 2026, from 9am - 2pm. This FREE')).toEqual({ start: { hour: 9, minute: 0 }, end: { hour: 14, minute: 0 } });
    expect(hoursFrom('held from 8:00 a.m. to 4:00 p.m.')).toEqual({ start: { hour: 8, minute: 0 }, end: { hour: 16, minute: 0 } });
    expect(hoursFrom('from Noon – 10pm, offering')).toEqual({ start: { hour: 12, minute: 0 }, end: { hour: 22, minute: 0 } });
    expect(hoursFrom('from 6:30 PM — midnight')).toEqual({ start: { hour: 18, minute: 30 }, end: { hour: 0, minute: 0 } });
  });

  test('no stated range, two different ranges, or an impossible clock: no hours', () => {
    expect(hoursFrom(undefined)).toBeUndefined();
    expect(hoursFrom('Join us all weekend long.')).toBeUndefined();
    expect(hoursFrom('Saturday from 9am - 2pm and Sunday from 10am - 4pm')).toBeUndefined();
    expect(hoursFrom('from 13pm - 2pm')).toBeUndefined();
  });

  test('the same range said twice still counts as one', () => {
    expect(hoursFrom('Open from 9am - 2pm. Remember: from 9am - 2pm!')).toEqual({ start: { hour: 9, minute: 0 }, end: { hour: 14, minute: 0 } });
  });
});

// Two real cards from the live calendar (2026-10-08): Doggy Day states its hours in the overlay date line, not the
// description; Family Fun Day writes its date with a short month ("Oct 11, 2026") and was skipped entirely.
describe('cards from the October 2026 calendar', () => {
  const october = readFileSync(join(process.cwd(), 'tests/fixtures/html/milwaukee-world-festival-2026-10.html'), 'utf8');
  const { records } = parseMilwaukeeWorldFestivalHtml(october, LISTING_URL);

  test('hours in the date line count: Doggy Day runs 9 AM to 2 PM', () => {
    const doggy = records.find((r) => r.sourceEventId === 'mwf:doggy day at the lakefront')!.payload as Record<string, unknown>;
    expect(doggy.startDate).toBe('2026-10-10T14:00:00.000Z');
    expect(doggy.endDate).toBe('2026-10-10T19:00:00.000Z');
  });
});
