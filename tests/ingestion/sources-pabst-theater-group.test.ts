import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';
import {
  enrichPabstTheaterGroupDetail,
  parsePabstTheaterGroupHtml,
} from '@/ingestion/adapters/html/sources/pabst-theater-group';

const html = readFileSync(
  join(process.cwd(), 'tests/fixtures/html/pabst-theater-group.html'),
  'utf8',
);
const LISTING_URL = 'https://www.pabsttheatergroup.com/events';

describe('parsePabstTheaterGroupHtml', () => {
  const { records, skipped } = parsePabstTheaterGroupHtml(html, LISTING_URL);

  test('extracts every event card on the listing page', () => {
    expect(records.length).toBeGreaterThanOrEqual(12);
  });

  test('the fixture has no drop case, so no cards are counted as skipped', () => {
    expect(skipped).toBe(0);
  });

  test('maps the first card to a midnight-Chicago ISO instant with venue and detail url', () => {
    const first = records[0].payload as Record<string, unknown>;
    expect(first.name).toBe('Derek Hough - Symphony of Dance: Encore');
    expect(first.venueName).toBe('The Riverside Theater');
    expect(first.url).toBe('https://www.pabsttheatergroup.com/events/detail/derek-hough-2026');
    // "July  7 2026" (no time on listing) -> midnight America/Chicago (CDT, UTC-5).
    expect(first.startDate).toBe('2026-07-07T05:00:00.000Z');
    expect(first.status).toBeUndefined();
  });

  test('maps a "CANCELED" card date to status cancelled while keeping the real date', () => {
    const canceled = records.find(
      (r) => (r.payload as Record<string, unknown>).name === 'BILLY ALLEN + THE POLLIES',
    );
    expect(canceled).toBeDefined();
    const payload = canceled!.payload as Record<string, unknown>;
    expect(payload.status).toBe('cancelled');
    expect(payload.startDate).toBe('2026-07-18T05:00:00.000Z');
  });

  test('normalizes into a valid NormalizedEvent', () => {
    const normalized = normalizeHtmlRecord(records[0]);
    expect(normalized?.title).toBe('Derek Hough - Symphony of Dance: Encore');
    expect(normalized?.startAt.toISOString()).toBe('2026-07-07T05:00:00.000Z');
    expect(normalized?.status).toBe('scheduled');
  });

  test('deduplicates by detail URL', () => {
    const ids = records.map((r) => r.sourceEventId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('enrichPabstTheaterGroupDetail', () => {
  const detailHtml = readFileSync(
    join(process.cwd(), 'tests/fixtures/html/pabst-detail.html'),
    'utf8',
  );
  const listingRecord = parsePabstTheaterGroupHtml(html, LISTING_URL).records[0];

  test('replaces the midnight placeholder with the detail page "Event Starts" showtime', () => {
    expect((listingRecord.payload as Record<string, unknown>).startDate).toBe(
      '2026-07-07T05:00:00.000Z',
    );
    const enriched = enrichPabstTheaterGroupDetail(listingRecord, detailHtml);
    // Detail sidebar: Date "July 07, 2026", Event Starts "8:00 PM" (CDT, UTC-5).
    expect((enriched.payload as Record<string, unknown>).startDate).toBe(
      '2026-07-08T01:00:00.000Z',
    );
    // Immutability: the original record is untouched.
    expect((listingRecord.payload as Record<string, unknown>).startDate).toBe(
      '2026-07-07T05:00:00.000Z',
    );
  });

  test('returns the record unchanged when the detail markup has no start fields', () => {
    const enriched = enrichPabstTheaterGroupDetail(listingRecord, '<html><body></body></html>');
    expect(enriched).toBe(listingRecord);
  });
});
