import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';
import { parseMarcusCenterJson } from '@/ingestion/adapters/html/sources/marcus-center';

const json = readFileSync(join(process.cwd(), 'tests/fixtures/html/marcus-center.json'), 'utf8');
const LISTING_URL = 'https://www.marcuscenter.org/wp-json/tribe/events/v1/events?per_page=50';

describe('parseMarcusCenterJson', () => {
  const { records, skipped } = parseMarcusCenterJson(json, LISTING_URL);

  test('parses single-day events with hall-level venues and Chicago wall times', () => {
    const record = records.find((r) => r.sourceEventId === '46116')!;
    const payload = record.payload as { startDate: string; venueName: string; venueAddress: string };
    // 2026-07-14 19:00:00 America/Chicago (CDT, UTC-5) -> 2026-07-15T00:00:00.000Z
    expect(payload.startDate).toBe('2026-07-15T00:00:00.000Z');
    expect(payload.venueName).toBe('South Outdoor Grounds');
    expect(payload.venueAddress).toBe('929 N Water St, Milwaukee, WI');

    const otherHall = records.find((r) => r.sourceEventId === '45842')!;
    const otherPayload = otherHall.payload as { venueName: string };
    expect(otherPayload.venueName).toBe('Wilson Theater at Vogel Hall');
  });

  test('expands a multi-day run through the day-range machinery (one event, N day instances)', () => {
    const spamalotInstances = records.filter((r) => r.sourceEventId === '6866');
    // start_date 2026-07-14 -> end_date 2026-07-19: six calendar days.
    expect(spamalotInstances).toHaveLength(6);
    const startDates = spamalotInstances
      .map((r) => (r.payload as { startDate: string }).startDate)
      .sort();
    expect(startDates[0]).toBe('2026-07-14T05:00:00.000Z'); // midnight Chicago (CDT, UTC-5)
    expect(startDates.at(-1)).toBe('2026-07-19T05:00:00.000Z');
    for (const record of spamalotInstances) {
      expect((record.payload as { venueName: string }).venueName).toBe('Uihlein Hall');
    }
  });

  test("decodes entity titles (Monty Python's Spamalot)", () => {
    const record = records.find((r) => r.sourceEventId === '6866')!;
    const payload = record.payload as { name: string };
    expect(payload.name).toBe('Monty Python’s Spamalot');
  });

  test('tolerates image: false and a malformed event without dropping the batch', () => {
    const parsed = JSON.parse(json) as { events: Array<Record<string, unknown>> };
    const withImageFalse = { ...parsed.events[0], id: 999001, image: false };
    const malformed = { ...parsed.events[0], id: undefined, url: undefined };
    const payload = JSON.stringify({ events: [withImageFalse, malformed] });

    const { records: batchRecords, skipped: batchSkipped } = parseMarcusCenterJson(payload, LISTING_URL);

    expect(batchSkipped).toBe(1);
    const okRecord = batchRecords.find((r) => r.sourceEventId === '999001')!;
    expect(okRecord).toBeDefined();
    expect((okRecord.payload as { imageUrl?: string }).imageUrl).toBeUndefined();
  });

  test('normalizes a parsed record into a valid NormalizedEvent', () => {
    expect(skipped).toBe(0);
    const record = records.find((r) => r.sourceEventId === '45813')!;
    const normalized = normalizeHtmlRecord(record);
    expect(normalized?.title).toBe('Jennifer Lyn & The Groove Revival – Electric Eden');
    expect(normalized?.status).toBe('scheduled');
  });

  test('builds venueAddress from feed city/state, falling back to Milwaukee, WI only when the pair is incomplete', () => {
    const parsed = JSON.parse(json) as { events: Array<Record<string, unknown>> };
    const template = parsed.events[0] as { venue: Record<string, unknown> };

    const fullPair = {
      ...parsed.events[0],
      id: 999002,
      venue: { ...template.venue, address: '650 W Main St', city: 'Waukesha', state: 'WI' },
    };
    // Todd Wehr Theater shape: city present, state missing (garbled zip holds "WI" instead).
    const incompletePair = {
      ...parsed.events[0],
      id: 999003,
      venue: { ...template.venue, address: '123 E. State St', city: 'Milwaukee', state: undefined },
    };
    const payload = JSON.stringify({ events: [fullPair, incompletePair] });

    const { records: batchRecords } = parseMarcusCenterJson(payload, LISTING_URL);

    const fullPairRecord = batchRecords.find((r) => r.sourceEventId === '999002')!;
    expect((fullPairRecord.payload as { venueAddress: string }).venueAddress).toBe('650 W Main St, Waukesha, WI');

    const fallbackRecord = batchRecords.find((r) => r.sourceEventId === '999003')!;
    expect((fallbackRecord.payload as { venueAddress: string }).venueAddress).toBe(
      '123 E. State St, Milwaukee, WI',
    );
  });

  test('throws on a total-payload failure instead of reporting a healthy empty batch', () => {
    expect(() => parseMarcusCenterJson('<!doctype html><html><body>Not JSON</body></html>', LISTING_URL)).toThrow(
      /not a Marcus Center Tribe Events JSON payload/,
    );
    expect(() => parseMarcusCenterJson(JSON.stringify({ notEvents: [] }), LISTING_URL)).toThrow(
      /not a Marcus Center Tribe Events JSON payload/,
    );
  });
});
