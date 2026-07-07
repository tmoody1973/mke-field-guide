import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { extractJsonLdEvents } from '@/ingestion/adapters/html/jsonld';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/html/jsonld-sample.html'), 'utf8');
const records = extractJsonLdEvents(html, 'https://example.com/events/');

describe('extractJsonLdEvents', () => {
  test('extracts Event subtypes from @graph and arrays, ignores non-events and malformed blocks', () => {
    expect(records.map((r) => r.sourceEventId)).toEqual([
      'https://example.com/events/jazz-at-the-vine',
      'https://example.com/events/cancelled-gala',
      'https://example.com/events/no-date',
    ]);
  });

  test('maps place, geo, offers, and image into the flat payload', () => {
    const p = records[0].payload as Record<string, unknown>;
    expect(p.name).toBe('Jazz at the Vine');
    expect(p.venueName).toBe('Villa Terrace');
    expect(p.venueAddress).toBe('2220 N Terrace Ave, Milwaukee, WI');
    expect(p.venueLat).toBeCloseTo(43.0521);
    expect(p.imageUrl).toBe('https://example.com/jazz.jpg');
    expect(p.isFree).toBe(true);
    expect(p.startDate).toBe('2026-08-06T18:00:00-05:00');
  });

  test('coerces explicit null to undefined and handles string locations', () => {
    const p = records[1].payload as Record<string, unknown>;
    expect(p.description).toBeUndefined();
    expect(p.venueName).toBe('Grain Exchange');
    expect(p.status).toBe('cancelled');
  });
});

describe('normalizeHtmlRecord', () => {
  test('normalizes a complete record with Chicago-offset time', () => {
    const n = normalizeHtmlRecord(records[0]);
    expect(n?.title).toBe('Jazz at the Vine');
    expect(n?.startAt.toISOString()).toBe('2026-08-06T23:00:00.000Z');
    expect(n?.isFree).toBe(true);
    expect(n?.status).toBe('scheduled');
  });

  test('skips records without a start date', () => {
    expect(normalizeHtmlRecord(records[2])).toBeNull();
  });

  test('maps cancelled status', () => {
    expect(normalizeHtmlRecord(records[1])?.status).toBe('cancelled');
  });
});
