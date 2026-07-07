import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';
import { parseMilwaukeeWorldFestivalHtml } from '@/ingestion/adapters/html/sources/milwaukee-world-festival';

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

  test('single-day card maps name, venue, image and midnight-Chicago start', () => {
    const dragon = records.filter((r) => r.sourceEventId === 'mwf:milwaukee dragon boat festival');
    expect(dragon).toHaveLength(1);
    const p = dragon[0].payload as Record<string, unknown>;
    expect(p.name).toBe('Milwaukee Dragon Boat Festival');
    expect(p.venueName).toBe('Henry Maier Festival Park');
    // "July 11, 2026" (date-only listing) -> midnight America/Chicago (CDT, UTC-5).
    expect(p.startDate).toBe('2026-07-11T05:00:00.000Z');
    // Relative img src resolved against the page's <base href>, not the listing URL path.
    expect(p.imageUrl).toBe(
      'https://www.milwaukeeworldfestival.com/assets/img/Calendar/dragon-boat-festival-800x600.jpg',
    );
    expect(p.endDate).toBeUndefined();
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
