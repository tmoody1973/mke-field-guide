import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { eventbriteAdapter, extractEventbriteRecords } from '@/ingestion/adapters/eventbrite';

const page = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/eventbrite-events.json'), 'utf8'),
);

describe('extractEventbriteRecords', () => {
  test('extracts flat replayable payloads', () => {
    const records = extractEventbriteRecords(page);
    expect(records).toHaveLength(2);
    expect(records[0].payload).toEqual({
      id: 'eb-100',
      name: 'Waterfront Concert Series',
      description: 'Live music on the harbor.',
      url: 'https://www.eventbrite.com/e/eb-100',
      startUtc: '2026-08-20T23:00:00Z',
      endUtc: '2026-08-21T02:00:00Z',
      status: 'live',
      isFree: false,
      venueName: 'The Cooperage',
      venueAddress: '822 S Water St, Milwaukee, WI 53204',
      venueLat: 43.0243,
      venueLng: -87.9079,
      imageUrl: 'https://img.evbuc.com/eb-100.jpg',
    });
  });
});

describe('eventbriteAdapter.normalize', () => {
  test('maps live event with venue, geo, isFree', () => {
    const [record] = extractEventbriteRecords(page);
    const n = eventbriteAdapter.normalize(record);
    expect(n?.title).toBe('Waterfront Concert Series');
    expect(n?.isFree).toBe(false);
    expect(n?.venueLng).toBeCloseTo(-87.9079);
    expect(n?.endAt?.toISOString()).toBe('2026-08-21T02:00:00.000Z');
  });

  test('maps canceled status and handles null venue', () => {
    const [, canceled] = extractEventbriteRecords(page);
    const n = eventbriteAdapter.normalize(canceled);
    expect(n?.status).toBe('cancelled');
    expect(n?.venueName).toBeUndefined();
  });
});
