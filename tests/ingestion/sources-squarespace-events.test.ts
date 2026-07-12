import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { squarespaceEventsParser } from '@/ingestion/adapters/html/sources/squarespace-events';

const xrayFixture = readFileSync(join(process.cwd(), 'tests/fixtures/html/x-ray-arcade.json'), 'utf8');
const jazzGalleryFixture = readFileSync(join(process.cwd(), 'tests/fixtures/html/jazz-gallery.json'), 'utf8');

const xrayParser = squarespaceEventsParser({
  baseUrl: 'https://xrayarcade.com',
  fallbackVenueName: 'X-Ray Arcade',
  fallbackVenueAddress: '5036 South Packard Avenue, Cudahy',
  skipTitle: /(?=.*closed)(?=.*private)/i,
});

const jazzGalleryParser = squarespaceEventsParser({
  baseUrl: 'https://jazzgallerycenterforarts.org',
  fallbackVenueName: 'Jazz Gallery Center for the Arts',
  fallbackVenueAddress: '926 East Center Street, Milwaukee, WI, 53212',
});

describe('squarespaceEventsParser', () => {
  test('parses upcoming Squarespace items into records with absolute instants and venue fields', () => {
    const { records } = xrayParser(xrayFixture, 'https://xrayarcade.com/calendar');
    const record = records.find((r) => r.sourceEventId === '6a4d2ed7df15e75cf7ca46f7')!;
    const payload = record.payload as {
      name: string;
      startDate: string;
      url: string;
      venueName: string;
      venueAddress: string;
    };
    expect(payload.name).toBe('Ste Martaen Presents: MEETSTOP VEGAN DELI POP-UP');
    expect(new Date(payload.startDate)).toEqual(new Date(1783872000069));
    expect(payload.url).toBe('https://xrayarcade.com/calendar/2026/07/12/ste-martaen');
    expect(payload.venueName).toBe('X-Ray Arcade');
    expect(payload.venueAddress).toContain('5036 South Packard Avenue');
  });

  test('skips the *CLOSED* private-event notice and counts it (x-ray instance)', () => {
    const { records, skipped } = xrayParser(xrayFixture, 'https://xrayarcade.com/calendar');
    expect(records.some((r) => (r.payload as { name: string }).name.includes('CLOSED'))).toBe(false);
    expect(skipped).toBeGreaterThanOrEqual(1);
  });

  test('ignores the past collection entirely', () => {
    const parsedFixture = JSON.parse(xrayFixture) as { past: Array<{ id: string }> };
    const pastId = parsedFixture.past[0]!.id;
    const { records } = xrayParser(xrayFixture, 'https://xrayarcade.com/calendar');
    expect(records.some((r) => r.sourceEventId === pastId)).toBe(false);
  });

  test('falls back to configured venue name/address when item location is empty strings (jazz-gallery instance)', () => {
    const { records } = jazzGalleryParser(jazzGalleryFixture, 'https://jazzgallerycenterforarts.org/events');
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      const payload = record.payload as { venueName: string; venueAddress: string };
      expect(payload.venueName).toBe('Jazz Gallery Center for the Arts');
      expect(payload.venueAddress).toBe('926 East Center Street, Milwaukee, WI, 53212');
    }
  });

  test('tolerates a malformed item without dropping the batch', () => {
    const malformedEnvelope = JSON.stringify({
      upcoming: [
        { id: 'valid-1', title: 'Real Show', startDate: 1783872000069, fullUrl: '/calendar/real-show' },
        { id: 'missing-fields' },
      ],
      past: [],
    });
    const { records, skipped } = xrayParser(malformedEnvelope, 'https://xrayarcade.com/calendar');
    expect(records).toHaveLength(1);
    expect(records[0]!.sourceEventId).toBe('valid-1');
    expect(skipped).toBe(1);
  });
});
