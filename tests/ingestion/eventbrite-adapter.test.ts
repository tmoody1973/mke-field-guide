import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { eventbriteAdapter, extractEventbriteRecords } from '@/ingestion/adapters/eventbrite';

const page = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/eventbrite-events.json'), 'utf8'),
);

describe('extractEventbriteRecords', () => {
  test('extracts flat replayable payloads', () => {
    const records = extractEventbriteRecords(page);
    expect(records).toHaveLength(3);
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

  test('normalizes an event with explicit null optional fields instead of dropping it', () => {
    const [, , nullFields] = extractEventbriteRecords(page);
    expect(nullFields.payload).toMatchObject({
      description: undefined,
      endUtc: undefined,
      imageUrl: undefined,
      venueName: undefined,
      venueAddress: undefined,
      venueLat: undefined,
      venueLng: undefined,
    });
    const n = eventbriteAdapter.normalize(nullFields);
    expect(n).not.toBeNull();
    expect(n?.title).toBe('Mystery Market Pop-Up');
    expect(n?.description).toBeUndefined();
    expect(n?.imageUrl).toBeUndefined();
    expect(n?.venueName).toBeUndefined();
  });
});

describe('eventbriteAdapter.fetch pagination', () => {
  const makeEvent = (id: string) => ({
    id,
    name: { text: `Event ${id}` },
    url: `https://www.eventbrite.com/e/${id}`,
    status: 'live',
    start: { utc: '2026-09-01T00:00:00Z' },
    is_free: true,
    venue: null,
  });

  const jsonResponse = (body: unknown) =>
    ({ ok: true, json: () => Promise.resolve(body) }) as Response;

  const config = { adapter: 'eventbrite', organizerIds: ['org-1'] };

  beforeEach(() => {
    vi.stubEnv('EVENTBRITE_PRIVATE_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('follows continuation token across pages', async () => {
    const calls: string[] = [];
    const mockFetch = vi.fn((url: URL | string) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return Promise.resolve(
          jsonResponse({
            events: [makeEvent('eb-p1')],
            pagination: { has_more_items: true, continuation: 'tok1' },
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          events: [makeEvent('eb-p2')],
          pagination: { has_more_items: false },
        }),
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    const { records } = await eventbriteAdapter.fetch(config);

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.sourceEventId)).toEqual(['eb-p1', 'eb-p2']);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('continuation=tok1');
  });

  test('stops when has_more_items is true but continuation is missing', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          events: [makeEvent('eb-only')],
          pagination: { has_more_items: true },
        }),
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const { records } = await eventbriteAdapter.fetch(config);

    expect(records).toHaveLength(1);
    expect(records[0].sourceEventId).toBe('eb-only');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
