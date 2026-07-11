import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { icalAdapter, parseIcsText } from '@/ingestion/adapters/ical';

const fixture = readFileSync(
  join(process.cwd(), 'tests/fixtures/urban-milwaukee.ics'),
  'utf8',
);

describe('parseIcsText', () => {
  test('extracts both VEVENTs with JSON-safe payloads', () => {
    const records = parseIcsText(fixture);
    expect(records).toHaveLength(2);
    const [first] = records;
    expect(first.sourceEventId).toBe('12345@urbanmilwaukee.com');
    expect(first.sourceUrl).toBe('https://urbanmilwaukee.com/event/jazz-in-the-park/');
    // 19:00 America/Chicago in July (CDT, UTC-5) = 00:00Z next day
    expect((first.payload as { startAt: string }).startAt).toBe('2026-07-11T00:00:00.000Z');
    expect(JSON.parse(JSON.stringify(first.payload))).toEqual(first.payload);
  });
});

describe('icalAdapter.normalize', () => {
  test('maps a full record to a NormalizedEvent', () => {
    const [record] = parseIcsText(fixture);
    const n = icalAdapter.normalize(record);
    expect(n).not.toBeNull();
    expect(n?.title).toBe('Jazz in the Park');
    expect(n?.venueName).toBe('Cathedral Square Park');
    expect(n?.venueAddress).toBe('Cathedral Square Park, 520 E Wells St, Milwaukee, WI 53202');
    expect(n?.startAt.toISOString()).toBe('2026-07-11T00:00:00.000Z');
    expect(n?.endAt?.toISOString()).toBe('2026-07-11T03:00:00.000Z');
    expect(n?.status).toBe('scheduled');
  });

  test('handles a record with no end time and no description', () => {
    const [, second] = parseIcsText(fixture);
    const n = icalAdapter.normalize(second);
    expect(n).not.toBeNull();
    expect(n?.title).toBe('South Shore Farmers Market');
    expect(n?.endAt).toBeUndefined();
  });

  test('returns null for an unparseable payload', () => {
    const n = icalAdapter.normalize({ sourceEventId: 'bad', payload: { junk: true } });
    expect(n).toBeNull();
  });

  test('applies dash-address split to venue name, preserves full location as address', () => {
    const n = icalAdapter.normalize({
      sourceEventId: 'cactus-club-123',
      payload: {
        uid: 'cactus-club-123',
        summary: 'Dance Night',
        location: 'Cactus Club - 2496 S Wentworth Ave',
        startAt: '2026-07-12T23:00:00.000Z',
      },
    });
    expect(n).not.toBeNull();
    expect(n?.venueName).toBe('Cactus Club');
    expect(n?.venueAddress).toBe('Cactus Club - 2496 S Wentworth Ave');
  });
});
