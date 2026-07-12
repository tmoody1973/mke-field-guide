import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { htmlAdapter } from '@/ingestion/adapters/html';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';
import {
  crawlMilwaukeeRep,
  MILWAUKEE_REP_MAX_RANGE_DAYS,
  MILWAUKEE_REP_THEATER_VENUES,
  parseMilwaukeeRepDetailRange,
  parseMilwaukeeRepDetailVenueText,
  parseMilwaukeeRepListing,
} from '@/ingestion/adapters/html/sources/milwaukee-rep';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests/fixtures/html', name), 'utf8');

// Live-fetched season listing (2026-07-12): 12 `.show-listing` cards, including
// "Come From Away" (id 440, theater 24) whose own listing date text carries the
// real live wrong-end-year bug ("November 4, 2025 - December 14, 2024" — should
// read 2025) and "And Then There Were None" (id 449) with the same class of bug
// ("May 26, 2026 - June 28, 2025").
const listingHtml = fixture('milwaukee-rep-listing.html');
const detailComeFromAway = fixture('milwaukee-rep-detail-come-from-away.html'); // Powerhouse (theater 24)
const detailChristmasCarol = fixture('milwaukee-rep-detail-christmas-carol.html'); // Pabst off-site (theater 26)

const LISTING_URL = 'https://www.milwaukeerep.com/shows/current-season/';
const okText = (body: string) => ({ ok: true, text: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const spyOnWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('parseMilwaukeeRepListing', () => {
  test('enumerates all 12 live cards by id/theater/title/detail-href — never the listing date text', () => {
    const { cards, rawCardCount } = parseMilwaukeeRepListing(listingHtml, LISTING_URL);
    expect(rawCardCount).toBe(12);
    expect(cards).toHaveLength(12);

    const comeFromAway = cards.find((c) => c.showId === '440');
    expect(comeFromAway).toEqual({
      showId: '440',
      theaterId: 24,
      title: 'Come From Away',
      detailUrl: 'https://www.milwaukeerep.com/shows/show/come-from-away/',
    });

    const christmasCarol = cards.find((c) => c.showId === '450');
    expect(christmasCarol).toEqual({
      showId: '450',
      theaterId: 26,
      title: 'A Christmas Carol',
      detailUrl: 'https://www.milwaukeerep.com/shows/show/a-christmas-carol-2025/',
    });

    // No parsed card carries any date field at all — the listing's own dates
    // are never even extracted, let alone trusted.
    expect(cards.every((c) => !('startDate' in c) && !('dateText' in c))).toBe(true);
  });

  test('an empty listing (no .show-listing cards at all) yields zero cards, zero rawCardCount', () => {
    const { cards, rawCardCount } = parseMilwaukeeRepListing('<div class="show-listing-container"></div>', LISTING_URL);
    expect(cards).toEqual([]);
    expect(rawCardCount).toBe(0);
  });
});

describe('parseMilwaukeeRepDetailRange', () => {
  test('Come From Away: en dash, year trailing the end date, same-year run', () => {
    expect(parseMilwaukeeRepDetailRange(detailComeFromAway)).toEqual({
      start: { year: 2025, month: 11, day: 4 },
      end: { year: 2025, month: 12, day: 14 },
    });
  });

  test('A Christmas Carol: same shape, different dates', () => {
    expect(parseMilwaukeeRepDetailRange(detailChristmasCarol)).toEqual({
      start: { year: 2025, month: 11, day: 25 },
      end: { year: 2025, month: 12, day: 24 },
    });
  });

  test('cross-year run rolls the start year back one (synthesized: the live 2025/26 season has no show whose own run crosses Jan 1, disclosed in task report)', () => {
    const html = '<h2 class="tight-paragraph">December 27 – January 3, 2026</h2>';
    expect(parseMilwaukeeRepDetailRange(html)).toEqual({
      start: { year: 2025, month: 12, day: 27 },
      end: { year: 2026, month: 1, day: 3 },
    });
  });

  test('a page with no h2.tight-paragraph, or unparseable text, yields null', () => {
    expect(parseMilwaukeeRepDetailRange('<h2 class="tight-paragraph">TBD</h2>')).toBeNull();
    expect(parseMilwaukeeRepDetailRange('<p>no range here</p>')).toBeNull();
  });
});

describe('parseMilwaukeeRepDetailVenueText', () => {
  test('Come From Away: the venue h4 following the credits h4, matched by text not position', () => {
    expect(parseMilwaukeeRepDetailVenueText(detailComeFromAway)).toBe('Checota Powerhouse Theater');
  });

  test('A Christmas Carol: an h3 (not h4) still matches by text', () => {
    expect(parseMilwaukeeRepDetailVenueText(detailChristmasCarol)).toBe('Pabst Theater');
  });

  test('no matching known-venue text anywhere yields undefined', () => {
    expect(parseMilwaukeeRepDetailVenueText('<h4>Directed by Someone</h4><h4>Some Other Theater</h4>')).toBeUndefined();
  });
});

describe('MILWAUKEE_REP_THEATER_VENUES', () => {
  test('24/25/30 share the Rep house address; 26 is the off-site Pabst consolidation target', () => {
    expect(MILWAUKEE_REP_THEATER_VENUES[24]).toEqual({
      venueName: 'Checota Powerhouse Theater',
      venueAddress: '108 East Wells Street, Milwaukee, WI 53202',
    });
    expect(MILWAUKEE_REP_THEATER_VENUES[25]).toEqual({
      venueName: 'Stackner Cabaret',
      venueAddress: '108 East Wells Street, Milwaukee, WI 53202',
    });
    expect(MILWAUKEE_REP_THEATER_VENUES[30]).toEqual({
      venueName: 'Herro-Franke Studio Theater',
      venueAddress: '108 East Wells Street, Milwaukee, WI 53202',
    });
    // Emitted verbatim as "The Pabst Theater" (with article) — matching the
    // pabst-theater-group source's own listing-card text exactly, since
    // normalizeName() does not strip "the" and venue matching is a plain
    // normalized-name equality check (see file header comment).
    expect(MILWAUKEE_REP_THEATER_VENUES[26]).toEqual({
      venueName: 'The Pabst Theater',
      venueAddress: '144 E Wells St, Milwaukee, WI 53202',
    });
  });
});

describe('crawlMilwaukeeRep', () => {
  const config = { strategy: 'milwaukee-rep-season' as const, sourceKey: 'milwaukee-rep', listingUrl: LISTING_URL };

  test('full run: listing dates ignored — Come From Away publishes the DETAIL range (Nov 4-Dec 14, 2025), never the buggy listing text (which would end Dec 14 2024)', async () => {
    const mockFetch = vi.fn(async (input: string) => {
      if (input === LISTING_URL) return okText(listingHtml);
      if (input === 'https://www.milwaukeerep.com/shows/show/come-from-away/') return okText(detailComeFromAway);
      if (input === 'https://www.milwaukeerep.com/shows/show/a-christmas-carol-2025/') return okText(detailChristmasCarol);
      // Every other show's detail page reuses the Come From Away fixture shape
      // (arbitrary valid range) purely to keep this "full run" scenario simple;
      // only Come From Away and A Christmas Carol are asserted on individually.
      return okText(detailComeFromAway);
    });
    vi.stubGlobal('fetch', mockFetch);

    const { records, parseSkipped } = await crawlMilwaukeeRep(config);
    expect(parseSkipped).toBe(0);

    const comeFromAwayRecords = records.filter((r) => (r.payload as { id: string }).id === '440');
    const dates = comeFromAwayRecords.map((r) => (r.payload as { startDate: string }).startDate).sort();
    expect(dates[0]).toBe('2025-11-04T06:00:00.000Z'); // Nov 4 2025 midnight Chicago
    expect(dates[dates.length - 1]).toBe('2025-12-14T06:00:00.000Z'); // Dec 14 2025 — NOT the listing's buggy "Dec 14 2024"
    expect(dates).toHaveLength(41); // Nov 4 - Dec 14 2025 inclusive
    expect(comeFromAwayRecords.every((r) => (r.payload as { venueName: string }).venueName === 'Checota Powerhouse Theater')).toBe(
      true,
    );

    const christmasCarolRecords = records.filter((r) => (r.payload as { id: string }).id === '450');
    expect(christmasCarolRecords.length).toBeGreaterThan(0);
    expect(
      christmasCarolRecords.every((r) => (r.payload as { venueName: string }).venueName === 'The Pabst Theater'),
    ).toBe(true);
    expect(
      christmasCarolRecords.every((r) => (r.payload as { venueAddress: string }).venueAddress === '144 E Wells St, Milwaukee, WI 53202'),
    ).toBe(true);
  });

  test('over-length run truncates at MILWAUKEE_REP_MAX_RANGE_DAYS and warns with title + full range + clamped range (synthesized: no real Rep run this long, disclosed)', async () => {
    expect(MILWAUKEE_REP_MAX_RANGE_DAYS).toBe(120);
    const oneCardListing =
      '<div class="show-listing" data-show-id="999" data-theater="24">' +
      '<div class="show-listing-title">A Very Long Run</div>' +
      '<a href="/shows/show/a-very-long-run/">Learn More</a></div>';
    const longRangeDetail = '<h2 class="tight-paragraph">January 1 – August 1, 2026</h2><h4>Checota Powerhouse Theater</h4>'; // 213 days
    const mockFetch = vi.fn(async (input: string) => {
      if (input === LISTING_URL) return okText(oneCardListing);
      if (input === 'https://www.milwaukeerep.com/shows/show/a-very-long-run/') return okText(longRangeDetail);
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal('fetch', mockFetch);
    const warnSpy = spyOnWarn();

    const { records } = await crawlMilwaukeeRep(config);
    expect(records).toHaveLength(MILWAUKEE_REP_MAX_RANGE_DAYS);

    const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(warnings).toContainEqual(
      expect.stringMatching(/truncated: "A Very Long Run" full range 2026-01-01 to 2026-08-01 \(213 days\) clamped to 120 days/),
    );
  });

  test('unknown data-theater id falls back to the detail page\'s own venue text', async () => {
    const oneCardListing =
      '<div class="show-listing" data-show-id="500" data-theater="99">' +
      '<div class="show-listing-title">Guest Production</div>' +
      '<a href="/shows/show/guest-production/">Learn More</a></div>';
    const detail = '<h2 class="tight-paragraph">March 1 – March 15, 2026</h2><h4>Directed by Someone</h4><h4>Stackner Cabaret</h4>';
    const mockFetch = vi.fn(async (input: string) => {
      if (input === LISTING_URL) return okText(oneCardListing);
      if (input === 'https://www.milwaukeerep.com/shows/show/guest-production/') return okText(detail);
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const { records, parseSkipped } = await crawlMilwaukeeRep(config);
    expect(parseSkipped).toBe(0);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => (r.payload as { venueName: string }).venueName === 'Stackner Cabaret')).toBe(true);
  });

  test('unknown data-theater id with no matching venue text anywhere is skipped and logged (alongside a normally-resolving show, same as MSO\'s non-metro-skip precedent — a listing where EVERY show hits this designed skip is not a realistic season and is out of scope for the throw-on-total-failure check)', async () => {
    const twoCardListing =
      '<div class="show-listing" data-show-id="501" data-theater="99">' +
      '<div class="show-listing-title">Mystery Production</div>' +
      '<a href="/shows/show/mystery-production/">Learn More</a></div>' +
      '<div class="show-listing" data-show-id="502" data-theater="24">' +
      '<div class="show-listing-title">Ordinary Production</div>' +
      '<a href="/shows/show/ordinary-production/">Learn More</a></div>';
    const mysteryDetail = '<h2 class="tight-paragraph">March 1 – March 15, 2026</h2><h4>Some Unrelated Text</h4>';
    const ordinaryDetail = '<h2 class="tight-paragraph">March 1 – March 3, 2026</h2>';
    const mockFetch = vi.fn(async (input: string) => {
      if (input === LISTING_URL) return okText(twoCardListing);
      if (input === 'https://www.milwaukeerep.com/shows/show/mystery-production/') return okText(mysteryDetail);
      if (input === 'https://www.milwaukeerep.com/shows/show/ordinary-production/') return okText(ordinaryDetail);
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal('fetch', mockFetch);
    const warnSpy = spyOnWarn();

    const { records, parseSkipped } = await crawlMilwaukeeRep(config);
    expect(records.every((r) => (r.payload as { id: string }).id === '502')).toBe(true);
    expect(parseSkipped).toBe(1);
    const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(warnings).toContainEqual(expect.stringMatching(/unknown data-theater "99".*Mystery Production/));
  });

  test('a detail-fetch failure skips that show and logs, but the run continues with the rest', async () => {
    const twoCardListing =
      '<div class="show-listing" data-show-id="502" data-theater="24">' +
      '<div class="show-listing-title">Show One</div>' +
      '<a href="/shows/show/show-one/">Learn More</a></div>' +
      '<div class="show-listing" data-show-id="503" data-theater="25">' +
      '<div class="show-listing-title">Show Two</div>' +
      '<a href="/shows/show/show-two/">Learn More</a></div>';
    const detailTwo = '<h2 class="tight-paragraph">April 1 – April 5, 2026</h2><h4>Stackner Cabaret</h4>';
    const mockFetch = vi.fn(async (input: string) => {
      if (input === LISTING_URL) return okText(twoCardListing);
      if (input === 'https://www.milwaukeerep.com/shows/show/show-one/') throw new Error('network error');
      if (input === 'https://www.milwaukeerep.com/shows/show/show-two/') return okText(detailTwo);
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal('fetch', mockFetch);
    const warnSpy = spyOnWarn();

    const { records, parseSkipped } = await crawlMilwaukeeRep(config);
    expect(parseSkipped).toBe(1);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => (r.payload as { id: string }).id === '503')).toBe(true);
    const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(warnings).toContainEqual(expect.stringMatching(/detail fetch failed, skipping: "Show One"/));
  });

  test('zero events from a non-empty listing (every detail fetch/parse fails) throws — parser rot, not a healthy empty run', async () => {
    const oneCardListing =
      '<div class="show-listing" data-show-id="504" data-theater="24">' +
      '<div class="show-listing-title">Broken Show</div>' +
      '<a href="/shows/show/broken-show/">Learn More</a></div>';
    const mockFetch = vi.fn(async (input: string) => {
      if (input === LISTING_URL) return okText(oneCardListing);
      throw new Error('network error');
    });
    vi.stubGlobal('fetch', mockFetch);
    spyOnWarn();

    await expect(crawlMilwaukeeRep(config)).rejects.toThrow(/had 1 show card\(s\) but yielded zero events/);
  });

  test('a genuinely empty listing (no show cards at all) returns quietly, no throw', async () => {
    const mockFetch = vi.fn(async (input: string) => {
      if (input === LISTING_URL) return okText('<div class="show-listing-container"></div>');
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const { records, parseSkipped } = await crawlMilwaukeeRep(config);
    expect(records).toEqual([]);
    expect(parseSkipped).toBe(0);
  });

  test('normalizes a produced record into a valid NormalizedEvent (all-day, scheduled)', async () => {
    const oneCardListing =
      '<div class="show-listing" data-show-id="505" data-theater="24">' +
      '<div class="show-listing-title">Sample Show</div>' +
      '<a href="/shows/show/sample-show/">Learn More</a></div>';
    const detail = '<h2 class="tight-paragraph">May 1 – May 3, 2026</h2>';
    const mockFetch = vi.fn(async (input: string) => {
      if (input === LISTING_URL) return okText(oneCardListing);
      if (input === 'https://www.milwaukeerep.com/shows/show/sample-show/') return okText(detail);
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const { records } = await crawlMilwaukeeRep(config);
    const normalized = normalizeHtmlRecord(records[0]);
    expect(normalized?.title).toBe('Sample Show');
    expect(normalized?.status).toBe('scheduled');
    expect(normalized?.venueName).toBe('Checota Powerhouse Theater');
  });

  test('htmlAdapter dispatches the milwaukee-rep-season strategy to crawlMilwaukeeRep', async () => {
    const oneCardListing =
      '<div class="show-listing" data-show-id="506" data-theater="24">' +
      '<div class="show-listing-title">Dispatch Show</div>' +
      '<a href="/shows/show/dispatch-show/">Learn More</a></div>';
    const detail = '<h2 class="tight-paragraph">June 1 – June 2, 2026</h2>';
    const mockFetch = vi.fn(async (input: string) => {
      if (input === LISTING_URL) return okText(oneCardListing);
      if (input === 'https://www.milwaukeerep.com/shows/show/dispatch-show/') return okText(detail);
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const outcome = await htmlAdapter.fetch(config);
    expect(outcome.records).toHaveLength(2);
  });
});
