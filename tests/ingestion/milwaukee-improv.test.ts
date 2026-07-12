import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { htmlAdapter } from '@/ingestion/adapters/html';
import {
  crawlMilwaukeeImprov,
  extractImprovShowtimes,
  IMPROV_MAX_DETAIL_FETCHES,
  IMPROV_MAX_PAGES,
  MILWAUKEE_IMPROV_VENUE_ADDRESS,
  MILWAUKEE_IMPROV_VENUE_NAME,
  parseImprovCalendarPage,
  selectImprovDetailUrls,
} from '@/ingestion/adapters/html/sources/milwaukee-improv';

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), 'tests/fixtures/html', name), 'utf8');

const calendar1 = fixture('milwaukee-improv-calendar-1.html');
const calendar2 = fixture('milwaukee-improv-calendar-2.html');
const detailSingle = fixture('milwaukee-improv-detail-single.html');
const detailMulti = fixture('milwaukee-improv-detail-multi.html');

const CALENDAR_URL = 'https://improv.com/milwaukee/calendar/';
const okText = (body: string) => ({ ok: true, text: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseImprovCalendarPage', () => {
  test('enumerates absolute detail URLs from every .cal-list a.item card and the next ?start= link', () => {
    const page = parseImprovCalendarPage(calendar1, CALENDAR_URL);
    // 55 cards on the live page, 50 distinct hrefs (recurring same-slug shows,
    // e.g. "Two Cents Tuesday", repeat their card across several weeks).
    expect(page.hasCards).toBe(true);
    expect(page.detailUrls).toHaveLength(55);
    expect(new Set(page.detailUrls).size).toBe(50);
    expect(page.detailUrls).toContain('https://improv.com/milwaukee/comic/mike+epps/');
    expect(page.detailUrls).toContain('https://improv.com/milwaukee/comic/godfrey/');
    expect(page.nextPageUrl).toBe('https://improv.com/milwaukee/calendar/?start=2026-12-08');
  });

  test('resolves the ?start= page relative to the page it was fetched from, and finds its own next link', () => {
    const page2Url = 'https://improv.com/milwaukee/calendar/?start=2026-12-08';
    const page = parseImprovCalendarPage(calendar2, page2Url);
    expect(page.detailUrls).toHaveLength(5);
    expect(page.nextPageUrl).toBe('https://improv.com/milwaukee/calendar/?start=2027-01-01');
  });

  test('empty calendar (no .cal-list cards) reports hasCards: false and zero URLs', () => {
    const page = parseImprovCalendarPage('<div class="cal-results"><div class="cal-list"></div></div>', CALENDAR_URL);
    expect(page.hasCards).toBe(false);
    expect(page.detailUrls).toHaveLength(0);
    expect(page.nextPageUrl).toBeUndefined();
  });
});

describe('selectImprovDetailUrls', () => {
  test('cross-page dedupe: the shared href between page 1 and page 2 collapses to one fetch', () => {
    const page1 = parseImprovCalendarPage(calendar1, CALENDAR_URL);
    const page2 = parseImprovCalendarPage(calendar2, 'https://improv.com/milwaukee/calendar/?start=2026-12-08');
    const combined = [...page1.detailUrls, ...page2.detailUrls];
    // 50 unique on page 1 + 5 unique on page 2, minus 1 shared (Don McMillan) = 54.
    const { eligible, dropped } = selectImprovDetailUrls(combined, 100);
    expect(eligible).toHaveLength(54);
    expect(dropped).toBe(0);
    const donMcmillanUrl = 'https://improv.com/milwaukee/event/don+mcmillan+2.0+%2anow+powered+by+ai/14982493/';
    expect(eligible.filter((u) => u === donMcmillanUrl)).toHaveLength(1);
  });

  test('detail-fetch cap respected: overflow past the cap is dropped and counted, order preserved', () => {
    const urls = Array.from({ length: 45 }, (_, i) => `https://improv.com/milwaukee/comic/show-${i}/`);
    const { eligible, dropped } = selectImprovDetailUrls(urls, IMPROV_MAX_DETAIL_FETCHES);
    expect(IMPROV_MAX_DETAIL_FETCHES).toBe(40);
    expect(eligible).toHaveLength(40);
    expect(eligible[0]).toBe('https://improv.com/milwaukee/comic/show-0/');
    expect(eligible[39]).toBe('https://improv.com/milwaukee/comic/show-39/');
    expect(dropped).toBe(5);
  });

  test('a duplicate-heavy list still respects the cap after dedupe, not before', () => {
    const urls = Array.from({ length: 10 }, () => 'https://improv.com/milwaukee/comic/two+cents+tuesday/');
    const { eligible, dropped } = selectImprovDetailUrls(urls, 5);
    expect(eligible).toHaveLength(1);
    expect(dropped).toBe(0);
  });
});

describe('extractImprovShowtimes', () => {
  test('lowercase "event" @type is accepted; WebSite/ComedyClub blocks are filtered out', () => {
    const records = extractImprovShowtimes(detailSingle, 'https://improv.com/milwaukee/comic/mike+epps/');
    expect(records).toHaveLength(1);
    const payload = records[0].payload as Record<string, unknown>;
    expect(payload.name).toBe('Mike Epps');
  });

  test('happy-path single showtime: venue from location, ticket URL and id from offers.url', () => {
    const records = extractImprovShowtimes(detailSingle, 'https://improv.com/milwaukee/comic/mike+epps/');
    const record = records[0];
    const payload = record.payload as Record<string, unknown>;
    expect(record.sourceEventId).toBe('14959993');
    const expectedUrl =
      'https://www.ticketweb.com/event/mike-epps-milwaukee-improv-main-room-tickets/14959993?pl=milwaukeeimprov&REFID=milWP';
    expect(payload.url).toBe(expectedUrl);
    expect(record.sourceUrl).toBe(expectedUrl);
    // 2026-07-12T18:00:00-05:00 (CDT, UTC-5) -> 2026-07-12T23:00:00.000Z
    expect(payload.startDate).toBe('2026-07-12T23:00:00.000Z');
    expect(payload.venueName).toBe(MILWAUKEE_IMPROV_VENUE_NAME);
    expect(payload.venueAddress).toBe('20110 Lower Union Street, Brookfield, WI, 53045');
  });

  test('multi-show run (Godfrey, 5 shows over 3 days) yields 5 records with distinct times and ids', () => {
    const records = extractImprovShowtimes(detailMulti, 'https://improv.com/milwaukee/comic/godfrey/');
    expect(records).toHaveLength(5);
    expect(records.every((r) => (r.payload as { name: string }).name === 'Godfrey')).toBe(true);

    const startDates = records.map((r) => (r.payload as { startDate: string }).startDate);
    expect(new Set(startDates).size).toBe(5);

    const ids = records.map((r) => r.sourceEventId);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toContain('14893453');
    expect(ids).toContain('14893473');
    expect(ids).toContain('14893493');
    expect(ids).toContain('14893463');
    expect(ids).toContain('14893483');
  });

  test('url fallback: no offers.url means the payload/source url falls back to the detail page URL', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'http://schema.org',
      '@type': 'event',
      name: 'Synthetic No-Offer Show',
      startDate: '2026-08-01T19:00:00-05:00',
      location: { name: 'Milwaukee Improv', address: { streetAddress: '20110 Lower Union Street' } },
    })}</script>`;
    const detailUrl = 'https://improv.com/milwaukee/comic/synthetic-no-offer/';
    const records = extractImprovShowtimes(html, detailUrl);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect((record.payload as { url: string }).url).toBe(detailUrl);
    expect(record.sourceUrl).toBe(detailUrl);
    // Stable fallback id: sha256(detailUrl|startDate) truncated to 16 hex chars.
    expect(record.sourceEventId).toMatch(/^[0-9a-f]{16}$/);
  });

  test('a block with no showtime blocks at all (e.g. a page whose detail template broke) yields zero records', () => {
    const html = `
      <script type="application/ld+json">{"@type":"WebSite","url":"https://improv.com/milwaukee/"}</script>
      <script type="application/ld+json">{"@type":"ComedyClub","name":"Milwaukee Improv"}</script>
    `;
    expect(extractImprovShowtimes(html, 'https://improv.com/milwaukee/comic/broken/')).toHaveLength(0);
  });
});

describe('crawlMilwaukeeImprov', () => {
  const config = { strategy: 'calendar-jsonld' as const, sourceKey: 'milwaukee-improv', calendarUrl: CALENDAR_URL };

  test('crawls page 1 only (no further page needed) and fetches its detail pages', async () => {
    // A single-card calendar page with no moreshowsbtn link at all.
    const oneCardCalendar = `
      <div class="cal-results"><div class="cal-list">
        <a class="item" href="/milwaukee/comic/mike+epps/" id="ev14959993"></a>
      </div></div>`;
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okText(oneCardCalendar))
      .mockResolvedValueOnce(okText(detailSingle));
    vi.stubGlobal('fetch', mockFetch);

    const { records, parseSkipped } = await crawlMilwaukeeImprov(config);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(1);
    expect(parseSkipped).toBe(0);
  });

  test('follows ?start= pagination across real page 1 + page 2, dedupes the shared card, and stops (no further link)', async () => {
    // Page 2 fixture's own next link ("?start=2027-01-01") is a real, live 3rd
    // page — but it renders a single already-seen show with no further link,
    // so a synthetic terminal page (no cards, no next link) stands in here
    // for that 3rd fetch to keep this test hermetic. Disclosed in the task report.
    const terminalPage = '<div class="cal-results"><div class="cal-list"></div></div>';
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okText(calendar1)) // page 1
      .mockResolvedValueOnce(okText(calendar2)) // page 2 (?start=2026-12-08)
      .mockResolvedValueOnce(okText(terminalPage)) // page 3 (?start=2027-01-01)
      .mockResolvedValue(okText(detailSingle)); // every detail fetch
    vi.stubGlobal('fetch', mockFetch);

    const { records, parseSkipped } = await crawlMilwaukeeImprov(config);
    // 54 unique detail hrefs across the two pages (50 + 5 - 1 shared), which
    // exceeds IMPROV_MAX_DETAIL_FETCHES (40) — 3 calendar-page fetches + 40
    // (capped) detail fetches, with the remaining 14 dropped and counted.
    expect(mockFetch).toHaveBeenCalledTimes(3 + IMPROV_MAX_DETAIL_FETCHES);
    expect(records).toHaveLength(IMPROV_MAX_DETAIL_FETCHES);
    expect(parseSkipped).toBe(14);
  });

  test('pagination cap respected: a 4th page link on the 3rd (IMPROV_MAX_PAGES-th) page is never followed, and the drop is counted', async () => {
    expect(IMPROV_MAX_PAGES).toBe(3);
    const pageWithNext = (start: string, nextStart?: string) => `
      <div class="cal-results"><div class="cal-list">
        <a class="item" href="/milwaukee/comic/show-${start}/" id="ev1"></a>
      </div>
      ${nextStart ? `<a href="?start=${nextStart}" id="moreshowsbtn">More Shows</a>` : ''}
      </div>`;
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okText(pageWithNext('a', '2026-12-08'))) // page 1
      .mockResolvedValueOnce(okText(pageWithNext('b', '2027-01-01'))) // page 2
      .mockResolvedValueOnce(okText(pageWithNext('c', '2027-02-01'))) // page 3 (cap) — its next link must be dropped
      .mockResolvedValue(okText(detailSingle));
    vi.stubGlobal('fetch', mockFetch);

    const { records, parseSkipped } = await crawlMilwaukeeImprov(config);
    // 3 calendar pages (never a 4th) + 3 distinct detail fetches.
    expect(mockFetch).toHaveBeenCalledTimes(3 + 3);
    expect(records).toHaveLength(3);
    expect(parseSkipped).toBeGreaterThanOrEqual(1); // the dropped 4th-page link
  });

  test('detail-fetch failure is skipped and logged; the run continues with the remaining detail pages', async () => {
    const twoCardCalendar = `
      <div class="cal-results"><div class="cal-list">
        <a class="item" href="/milwaukee/comic/mike+epps/" id="ev1"></a>
        <a class="item" href="/milwaukee/comic/godfrey/" id="ev2"></a>
      </div></div>`;
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okText(twoCardCalendar))
      .mockRejectedValueOnce(new Error('detail fetch down'))
      .mockResolvedValueOnce(okText(detailMulti));
    vi.stubGlobal('fetch', mockFetch);

    const { records, parseSkipped } = await crawlMilwaukeeImprov(config);
    expect(parseSkipped).toBe(1);
    expect(records).toHaveLength(5); // godfrey's 5 showtimes; mike epps's fetch failed
  });

  test('detail-fetch cap respected: overflow past IMPROV_MAX_DETAIL_FETCHES is dropped and counted', async () => {
    const manyCardsCalendar = `<div class="cal-results"><div class="cal-list">${Array.from(
      { length: 45 },
      (_, i) => `<a class="item" href="/milwaukee/comic/show-${i}/" id="ev${i}"></a>`,
    ).join('')}</div></div>`;
    const mockFetch = vi.fn().mockResolvedValueOnce(okText(manyCardsCalendar)).mockResolvedValue(okText(detailSingle));
    vi.stubGlobal('fetch', mockFetch);

    const { records, parseSkipped } = await crawlMilwaukeeImprov(config);
    // 1 calendar fetch + 40 detail fetches (capped), never 45.
    expect(mockFetch).toHaveBeenCalledTimes(1 + IMPROV_MAX_DETAIL_FETCHES);
    expect(records).toHaveLength(IMPROV_MAX_DETAIL_FETCHES);
    expect(parseSkipped).toBe(5);
  });

  test('zero events parsed from a non-empty calendar throws (parser rot), never reports a healthy empty batch', async () => {
    const oneCardCalendar = `
      <div class="cal-results"><div class="cal-list">
        <a class="item" href="/milwaukee/comic/mike+epps/" id="ev1"></a>
      </div></div>`;
    const brokenDetail = '<script type="application/ld+json">{"@type":"WebSite"}</script>';
    const mockFetch = vi.fn().mockResolvedValueOnce(okText(oneCardCalendar)).mockResolvedValueOnce(okText(brokenDetail));
    vi.stubGlobal('fetch', mockFetch);

    await expect(crawlMilwaukeeImprov(config)).rejects.toThrow(/zero events/);
  });

  test('a genuinely empty calendar (no cards at all) returns zero records without throwing', async () => {
    const emptyCalendar = '<div class="cal-results"><div class="cal-list"></div></div>';
    const mockFetch = vi.fn().mockResolvedValueOnce(okText(emptyCalendar));
    vi.stubGlobal('fetch', mockFetch);

    const { records, parseSkipped } = await crawlMilwaukeeImprov(config);
    expect(records).toHaveLength(0);
    expect(parseSkipped).toBe(0);
  });
});

describe('htmlAdapter calendar-jsonld strategy', () => {
  const config = { strategy: 'calendar-jsonld', sourceKey: 'milwaukee-improv', calendarUrl: CALENDAR_URL };

  test('dispatches to the Improv crawler and normalizes a resulting record', async () => {
    const oneCardCalendar = `
      <div class="cal-results"><div class="cal-list">
        <a class="item" href="/milwaukee/comic/mike+epps/" id="ev1"></a>
      </div></div>`;
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okText(oneCardCalendar))
      .mockResolvedValueOnce(okText(detailSingle));
    vi.stubGlobal('fetch', mockFetch);

    const { records } = await htmlAdapter.fetch(config);
    expect(records).toHaveLength(1);
    const normalized = htmlAdapter.normalize(records[0]);
    expect(normalized).not.toBeNull();
    expect(normalized?.title).toBe('Mike Epps');
    expect(normalized?.venueAddress).toBe(MILWAUKEE_IMPROV_VENUE_ADDRESS);
  });

  test('rejects a config missing required calendar-jsonld fields', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(htmlAdapter.fetch({ strategy: 'calendar-jsonld', sourceKey: 'milwaukee-improv' })).rejects.toThrow();
  });
});
