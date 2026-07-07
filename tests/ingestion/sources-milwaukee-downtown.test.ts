import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';
import { parseMilwaukeeDowntownHtml } from '@/ingestion/adapters/html/sources/milwaukee-downtown';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/html/milwaukee-downtown.html'), 'utf8');
const LISTING_URL = 'https://www.milwaukeedowntown.com/signature-events/';

describe('parseMilwaukeeDowntownHtml', () => {
  const records = parseMilwaukeeDowntownHtml(html, LISTING_URL);
  const uniqueIds = new Set(records.map((r) => r.sourceEventId));

  test('emits one record per day-occurrence for the 4 cards with enumerable dates', () => {
    // 11 signature-event cards on the fixture; 7 give only vague/relative timing
    // ("Now through <date>" + weekly recurrence, or "Returning <month> <year>"
    // with no day-of-month) and are skipped. The remaining 4 (a single day, two
    // same-month ranges, one cross-month/year range) fan into 80 day-records.
    expect(uniqueIds.size).toBe(4);
    expect(records.length).toBe(80);
  });

  test('single-day card (Jack-O-Lantern Jubilee) maps name, description, image, midnight-Chicago start', () => {
    const jubilee = records.filter((r) =>
      r.sourceEventId.includes('jack-o-lantern-jubilee'),
    );
    expect(jubilee).toHaveLength(1);
    const p = jubilee[0].payload as Record<string, unknown>;
    expect(p.name).toBe('Jack-O-Lantern Jubilee');
    expect(p.description).toContain('Baird Community Commons');
    expect(p.imageUrl).toBe(
      'https://milwaukeedowntown.com/wp-content/uploads/2025/10/FRPhoto_231028X_C1_105_1160x740.jpg',
    );
    // "October 24, 2026." (date-only listing) -> midnight America/Chicago (CDT, UTC-5).
    expect(p.startDate).toBe('2026-10-24T05:00:00.000Z');
  });

  test('same-month range card (Downtown Employee Appreciation Week) expands day-by-day, shares one id', () => {
    const week = records.filter((r) => r.sourceEventId.includes('employee-appreciation-week'));
    expect(week.map((r) => (r.payload as { startDate: string }).startDate)).toEqual([
      '2026-08-17T05:00:00.000Z',
      '2026-08-18T05:00:00.000Z',
      '2026-08-19T05:00:00.000Z',
      '2026-08-20T05:00:00.000Z',
      '2026-08-21T05:00:00.000Z',
    ]);
    const ids = new Set(week.map((r) => r.sourceEventId));
    expect(ids.size).toBe(1);
  });

  test('another same-month range card (Halloween Village) yields 30 day-records', () => {
    const halloween = records.filter((r) => r.sourceEventId.includes('halloween-village'));
    expect(halloween).toHaveLength(30);
    expect((halloween[0].payload as { startDate: string }).startDate).toBe('2026-10-02T05:00:00.000Z');
    expect((halloween[29].payload as { startDate: string }).startDate).toBe('2026-10-31T05:00:00.000Z');
  });

  test('cross-month/year range card (Holiday Lights Festival) expands across the DST fall-back and year boundary', () => {
    const lights = records.filter((r) => r.sourceEventId.includes('milwaukee-holiday-lights-festival'));
    expect(lights).toHaveLength(44);
    // Nov 19 2026 is already CST (UTC-6) -- DST ended Nov 1.
    expect((lights[0].payload as { startDate: string }).startDate).toBe('2026-11-19T06:00:00.000Z');
    expect((lights[43].payload as { startDate: string }).startDate).toBe('2027-01-01T06:00:00.000Z');
  });

  test('skips cards with only vague/relative timing (no enumerable date)', () => {
    const skippedTitles = [
      'heartbeats-city', // "Now through August 26, 2026." + "each week" -- no day-of-week anchor
      'tunes-noon', // "Now through August 27, 2026." + "every Thursday" -- no explicit start date
      'winter-wellness-week', // "Returning January 2027." -- no day-of-month
      'broadway-skates', // "Returning early 2027." -- no day-of-month
      'taste-toast', // "Returning February 2027." -- no day-of-month
      'big-truck-day', // "Returning May 2027." -- no day-of-month
      'downtown-dining', // "Returning May 2027." -- no day-of-month
    ];
    for (const slug of skippedTitles) {
      expect([...uniqueIds].some((id) => id.includes(slug))).toBe(false);
    }
  });

  test('normalizes into a valid NormalizedEvent', () => {
    const normalized = normalizeHtmlRecord(
      records.find((r) => r.sourceEventId.includes('jack-o-lantern-jubilee'))!,
    );
    expect(normalized?.title).toBe('Jack-O-Lantern Jubilee');
    expect(normalized?.startAt.toISOString()).toBe('2026-10-24T05:00:00.000Z');
    expect(normalized?.status).toBe('scheduled');
  });

  test('never emits duplicate (id, startDate) pairs', () => {
    const keys = records.map((r) => `${r.sourceEventId}|${(r.payload as { startDate: string }).startDate}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
