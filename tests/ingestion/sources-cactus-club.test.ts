import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';
import { parseCactusClubHtml } from '@/ingestion/adapters/html/sources/cactus-club';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/html/cactus-club.html'), 'utf8');
const LISTING_URL = 'https://www.cactusclubmilwaukee.com/events/';

describe('parseCactusClubHtml', () => {
  const { records, skipped } = parseCactusClubHtml(html, LISTING_URL);

  test('parses event cards with Chicago wall-time instants (07/18/26 + 1:00PM -> correct UTC ISO)', () => {
    const record = records.find((r) => r.sourceEventId.startsWith('open-decks-series-vinyl-edition'))!;
    const payload = record.payload as { startDate: string; venueName: string; venueAddress: string };
    expect(payload.startDate).toBe('2026-07-18T18:00:00.000Z');
    expect(payload.venueName).toBe('Cactus Club');
    expect(payload.venueAddress).toBe('2496 S Wentworth Ave, Milwaukee, WI');
  });

  test('decodes entity titles from the anchor title attribute', () => {
    const record = records.find((r) => r.sourceEventId.startsWith('open-decks-series-vinyl-edition'))!;
    const payload = record.payload as { name: string };
    expect(payload.name).toBe('Open Decks – Vinyl Edition');
  });

  test('derives stable sourceEventIds from URL slugs', () => {
    const record = records.find((r) => r.sourceUrl?.includes('dj-libra-bogo-late-night-spin-2'))!;
    expect(record.sourceEventId).toBe('dj-libra-bogo-late-night-spin-2');
    expect(record.sourceUrl).toBe('https://www.cactusclubmilwaukee.com/events/dj-libra-bogo-late-night-spin-2/');
  });

  test('skips a card missing its date without dropping the batch', () => {
    const brokenHtml = `
      <div class="eventEntryInner">
        <div class="eventThumb" style="background-image:url(https://example.com/img.png);">
          <a href="https://www.cactusclubmilwaukee.com/events/mystery-show/" title="Mystery Show" style="background-image:url(https://example.com/img.png);"></a>
        </div>
        <div class="eventMetaWrapper">
          <div class="eventDateAndTime">
            <div class="eventTime"> 8:00PM</div>
          </div>
          <div class="eventTypeAndAdmittance">
            <div class="admittance">All Ages</div>
          </div>
        </div>
      </div>
    `;
    const { records: brokenRecords, skipped: brokenSkipped } = parseCactusClubHtml(brokenHtml, LISTING_URL);
    expect(brokenRecords).toHaveLength(0);
    expect(brokenSkipped).toBe(1);
  });

  test('extracts the background-image URL from the anchor style attribute', () => {
    const record = records.find((r) => r.sourceEventId.startsWith('open-decks-series-vinyl-edition'))!;
    const payload = record.payload as { imageUrl?: string };
    expect(payload.imageUrl).toBe(
      'https://www.cactusclubmilwaukee.com/wp-content/uploads/2026/06/02-july-dec-2026OpenDecks-vinyl-sq-600x600.png',
    );
  });

  test('skips the one placeholder card with a slug-less query-string permalink, keeping the rest', () => {
    // Card 17 ("Cactus Book Club: 'Comité Placeholder title' by author tbd")
    // links via `?post_type=events&p=50354` — a WordPress fallback permalink
    // with no path segment, so no stable slug is derivable. The rest of the
    // live fixture's ~35 cards all carry proper slugs.
    expect(skipped).toBe(1);
    expect(records.length).toBeGreaterThan(30);
    expect(records.some((r) => (r.payload as { name: string }).name.includes('Placeholder'))).toBe(false);
  });

  test('normalizes into a valid NormalizedEvent', () => {
    const record = records.find((r) => r.sourceEventId.startsWith('open-decks-series-vinyl-edition'))!;
    const normalized = normalizeHtmlRecord(record);
    expect(normalized?.title).toBe('Open Decks – Vinyl Edition');
    expect(normalized?.startAt.toISOString()).toBe('2026-07-18T18:00:00.000Z');
    expect(normalized?.status).toBe('scheduled');
  });
});
