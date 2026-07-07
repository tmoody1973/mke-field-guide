import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { extractTicketmasterRecords, ticketmasterAdapter } from '@/ingestion/adapters/ticketmaster';
import { resolveAdapter } from '@/ingestion/adapters/registry';

const page = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/ticketmaster-events.json'), 'utf8'),
);

describe('extractTicketmasterRecords', () => {
  test('extracts one record per event with flat replayable payload', () => {
    const records = extractTicketmasterRecords(page);
    expect(records).toHaveLength(3);
    expect(records[0].sourceEventId).toBe('tm-001');
    expect(records[0].payload).toEqual({
      id: 'tm-001',
      name: 'Milwaukee Bucks vs. Chicago Bulls',
      url: 'https://www.ticketmaster.com/event/tm-001',
      startDateTime: '2026-08-15T00:00:00Z',
      statusCode: 'onsale',
      venueName: 'Fiserv Forum',
      venueAddress: '1111 Vel R. Phillips Ave, Milwaukee',
      venueLat: 43.0451,
      venueLng: -87.9172,
      imageUrl: 'https://images.tm.com/bucks.jpg',
    });
  });
});

describe('ticketmasterAdapter.normalize', () => {
  test('maps a full record to NormalizedEvent with geo', () => {
    const [record] = extractTicketmasterRecords(page);
    const n = ticketmasterAdapter.normalize(record);
    expect(n?.title).toBe('Milwaukee Bucks vs. Chicago Bulls');
    expect(n?.venueLat).toBeCloseTo(43.0451);
    expect(n?.status).toBe('scheduled');
  });

  test('skips events without a start dateTime', () => {
    const records = extractTicketmasterRecords(page);
    expect(ticketmasterAdapter.normalize(records[1])).toBeNull();
  });

  test('maps postponed status', () => {
    const records = extractTicketmasterRecords(page);
    expect(ticketmasterAdapter.normalize(records[2])?.status).toBe('postponed');
  });
});

describe('resolveAdapter', () => {
  test('resolves ical and api adapters, rejects unknown', () => {
    expect(resolveAdapter({ adapterType: 'ical', config: {} }).adapterType).toBe('ical');
    expect(
      resolveAdapter({ adapterType: 'api', config: { adapter: 'ticketmaster' } }).adapterType,
    ).toBe('api');
    expect(() => resolveAdapter({ adapterType: 'html', config: {} })).toThrow(
      'No adapter registered',
    );
  });
});
