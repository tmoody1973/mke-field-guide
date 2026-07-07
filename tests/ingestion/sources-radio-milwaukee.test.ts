import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';
import {
  parseRadioMilwaukeeHtml,
  resolveOccurrenceYear,
} from '@/ingestion/adapters/html/sources/radio-milwaukee';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/html/radio-milwaukee.html'), 'utf8');
const LISTING_URL = 'https://radiomilwaukee.org/community-calendar';
// Fixed to the fixture's capture date so "next occurrence" resolution for
// recurring (undated) listings is deterministic in tests.
const CAPTURE_NOW = new Date('2026-07-07T12:00:00Z');

describe('radioMilwaukeeParser', () => {
  const records = parseRadioMilwaukeeHtml(html, LISTING_URL, CAPTURE_NOW);

  test('extracts every PromoEvent card on the listing page', () => {
    expect(records.length).toBeGreaterThanOrEqual(15);
  });

  test('maps an explicitly-dated event to a Chicago-offset ISO instant', () => {
    const first = records[0].payload as Record<string, unknown>;
    expect(first.name).toBe('88Nine presents: American Football');
    expect(first.venueName).toBe('Turner Hall Ballroom');
    expect(first.url).toBe(
      'https://radiomilwaukee.org/community-calendar/event/88nine-presents-american-football-02-06-2026-12-33-51',
    );
    // "08:00 PM ... on Sat, 15 Aug 2026" (CDT, UTC-5) -> 2026-08-16T01:00:00Z
    expect(first.startDate).toBe('2026-08-16T01:00:00.000Z');
    expect(first.endDate).toBe('2026-08-16T03:00:00.000Z');
  });

  test('maps a recurring/ongoing event using its displayed next-occurrence date', () => {
    const recurring = records.find(
      (r) => (r.payload as Record<string, unknown>).name === 'Habitat Restoration (County Parks)',
    );
    expect(recurring).toBeDefined();
    const payload = recurring!.payload as Record<string, unknown>;
    // date field shows "Jul 07" (today, per the fixed CAPTURE_NOW), time "09:00 AM - 12:00 PM" CDT.
    expect(payload.startDate).toBe('2026-07-07T14:00:00.000Z');
    expect(payload.endDate).toBe('2026-07-07T17:00:00.000Z');
  });

  test('normalizes into a valid NormalizedEvent', () => {
    const normalized = normalizeHtmlRecord(records[0]);
    expect(normalized?.title).toBe('88Nine presents: American Football');
    expect(normalized?.startAt.toISOString()).toBe('2026-08-16T01:00:00.000Z');
    expect(normalized?.status).toBe('scheduled');
  });

  test('deduplicates by detail URL', () => {
    const ids = records.map((r) => r.sourceEventId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('resolveOccurrenceYear', () => {
  test('uses Chicago-local "today", not UTC (evening scrape must not push same-day to next year)', () => {
    // 2026-07-08T01:00:00Z is still July 7, 8:00 PM CDT in Chicago. A recurring
    // event whose next occurrence reads "Jul 07" must resolve to 2026, not 2027.
    const eveningNow = new Date('2026-07-08T01:00:00Z');
    expect(resolveOccurrenceYear(7, 7, eveningNow)).toBe(2026);
  });

  test('rolls past-relative-to-Chicago dates into the next year', () => {
    const now = new Date('2026-07-07T12:00:00Z'); // July 7, 7:00 AM CDT
    expect(resolveOccurrenceYear(7, 6, now)).toBe(2027); // Jul 06 already passed
    expect(resolveOccurrenceYear(7, 7, now)).toBe(2026); // today stays this year
    expect(resolveOccurrenceYear(1, 15, now)).toBe(2027); // January is next year
  });
});
