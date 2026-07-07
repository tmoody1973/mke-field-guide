import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';
import { parseCountyParksHtml } from '@/ingestion/adapters/html/sources/county-parks';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/html/county-parks.html'), 'utf8');
const LISTING_URL = 'https://county.milwaukee.gov/EN/Parks/Experience/Events-Calendar';

describe('parseCountyParksHtml', () => {
  const { records, skipped } = parseCountyParksHtml(html, LISTING_URL);

  test('emits one record per listed occurrence row on this Firecrawl-rendered page-1 fixture', () => {
    // Page 1 (of 30 total — the widget paginates through an internal AJAX
    // call not present in the static markup) covers July 7-9, 2026: 20 rows,
    // 14 distinct programs (some recur across all 3 days shown, e.g. Yarn Bomb).
    expect(records).toHaveLength(20);
    expect(new Set(records.map((r) => r.sourceEventId)).size).toBe(14);
    expect(skipped).toBe(0);
  });

  test('a recurring program (Yarn Bomb) shares one sourceEventId across its day-rows', () => {
    const yarnBomb = records.filter((r) => r.sourceEventId === '477212');
    expect(yarnBomb).toHaveLength(3);
    expect(yarnBomb.map((r) => (r.payload as { startDate: string }).startDate)).toEqual([
      '2026-07-07T11:00:00.000Z',
      '2026-07-08T11:00:00.000Z',
      '2026-07-09T11:00:00.000Z',
    ]);
  });

  test('cross-midnight "Time:" range (6:00 AM - 10:00 PM) rolls the end to the next UTC day', () => {
    const yarnBomb = records.find((r) => r.sourceEventId === '477212')!;
    const p = yarnBomb.payload as { startDate: string; endDate?: string };
    expect(p.startDate).toBe('2026-07-07T11:00:00.000Z'); // 6:00 AM CDT
    expect(p.endDate).toBe('2026-07-08T03:00:00.000Z'); // 10:00 PM CDT
  });

  test('a single-time "Time:" value (no range) yields no endDate', () => {
    const floralShow = records.find((r) => r.sourceEventId === '367203')!;
    expect((floralShow.payload as { endDate?: string }).endDate).toBeUndefined();
  });

  test('splits the "Location:" value into venueName and venueAddress on the first comma', () => {
    const mobileMarket = records.find((r) => r.sourceEventId === '348623')!;
    const p = mobileMarket.payload as { venueName?: string; venueAddress?: string };
    expect(p.venueName).toBe('Washington Park Senior Center');
    expect(p.venueAddress).toBe('4420 W. Vliet St., Milwaukee');
  });

  test('sourceUrl points at the row\'s own occurrence-specific detail link', () => {
    const chill = records.find((r) => r.sourceEventId === '290205')!;
    expect(chill.sourceUrl).toBe(
      'https://county.milwaukee.gov/EN/Parks/Experience/Events-Calendar/Event-Detail?DataID=290205&Occurrence=2026-07-07T17:00:00',
    );
  });

  test('normalizes into a valid NormalizedEvent', () => {
    const normalized = normalizeHtmlRecord(records.find((r) => r.sourceEventId === '348623')!);
    expect(normalized?.title).toBe('Hunger Task Force Mobile Market');
    expect(normalized?.startAt.toISOString()).toBe('2026-07-07T14:30:00.000Z');
    expect(normalized?.status).toBe('scheduled');
  });

  test('never emits duplicate (id, startDate) pairs', () => {
    const keys = records.map((r) => `${r.sourceEventId}|${(r.payload as { startDate: string }).startDate}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('parseCountyParksHtml malformed rows', () => {
  test('counts a row missing its detail link as skipped instead of dropping it silently', () => {
    const brokenHtml = `
      <div class="DataListing"><div class="items"><div class="item">
        <div class="dateTime Time"><span class="value">9:00 AM</span></div>
        <div class="location Location"><span class="value">Some Park</span></div>
      </div></div></div>
    `;
    const { records, skipped } = parseCountyParksHtml(brokenHtml, LISTING_URL);
    expect(records).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  test('counts a row whose href has no parseable Occurrence as skipped', () => {
    const brokenHtml = `
      <div class="DataListing"><div class="items"><div class="item">
        <h4><a class="dataDetailLink" href="https://county.milwaukee.gov/EN/Parks/Experience/Events-Calendar/Event-Detail?DataID=1">Mystery Event</a></h4>
        <div class="dateTime Time"><span class="value">9:00 AM</span></div>
        <div class="location Location"><span class="value">Some Park</span></div>
      </div></div></div>
    `;
    const { records, skipped } = parseCountyParksHtml(brokenHtml, LISTING_URL);
    expect(records).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});
