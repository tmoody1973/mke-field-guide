import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { htmlAdapter } from '@/ingestion/adapters/html';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';
import {
  crawlMso,
  MSO_MAX_DETAIL_FETCHES,
  MSO_VENUE_ADDRESS,
  MSO_VENUE_NAME,
  parseMonthUrlYearMonth,
  parseMsoMonthGrid,
  parseMsoMonthSwitcher,
  parseMsoPerformanceDates,
  parseMsoPerformanceRange,
  pmDefaultGridTime,
  selectMsoMonthsAhead,
} from '@/ingestion/adapters/html/sources/mso';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests/fixtures/html', name), 'utf8');

const calendarJuly = fixture('mso-calendar-current.html'); // live-fetched "current month" bare page, July 2026 selected
const calendarSeptember = fixture('mso-calendar-september.html'); // live-fetched September 2026 page (multi-perf + off-site)
const detailKingsOfSoul = fixture('mso-detail-kings-of-soul.html');
const detailRhinelander = fixture('mso-detail-rhinelander.html');

const CALENDAR_URL = 'https://www.mso.org/concerts/calendar/';
const ORIGIN = 'https://www.mso.org';
const okText = (body: string) => ({ ok: true, text: async () => body });
const NO_MATCHING_MARKUP = '<html><body>a page whose template no longer matches</body></html>';
const EMPTY_MONTH = '<div class="empty-grid"></div>'; // synthetic: a genuinely quiet month, no show markup at all

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Degraded (pm-default) times are published-but-warned; tests spy to assert the log and keep output quiet. */
const spyOnWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('parseMsoMonthSwitcher', () => {
  test('reads only #month_switcher options; the real August 2026 gap proves months are never constructed', () => {
    const options = parseMsoMonthSwitcher(calendarJuly);
    expect(options).toHaveLength(11); // July 2026 through June 2027, per the live switcher
    expect(options.map((o) => o.label)).not.toContain('August 2026');
    expect(options[0]).toEqual({ url: '/concerts/calendar/2026/july', label: 'July 2026', selected: true });
    expect(options.some((o) => o.url === '/concerts/calendar/2026/september')).toBe(true);
    expect(options.filter((o) => o.selected)).toHaveLength(1);
  });
});

describe('selectMsoMonthsAhead', () => {
  test('takes up to maxMonthsAhead options AFTER the selected one, in switcher order (Aug gap skipped, not constructed)', () => {
    const options = parseMsoMonthSwitcher(calendarJuly);
    const ahead = selectMsoMonthsAhead(options, 3);
    expect(ahead.map((o) => o.url)).toEqual([
      '/concerts/calendar/2026/september',
      '/concerts/calendar/2026/october',
      '/concerts/calendar/2026/november',
    ]);
  });

  test('no selected option yields an empty list rather than guessing', () => {
    expect(selectMsoMonthsAhead([{ url: '/x', label: 'x', selected: false }], 3)).toEqual([]);
  });
});

describe('parseMonthUrlYearMonth', () => {
  test('extracts year + month number from a real month-switcher URL path', () => {
    expect(parseMonthUrlYearMonth('/concerts/calendar/2026/september')).toEqual({ year: 2026, month: 9 });
    expect(parseMonthUrlYearMonth('/concerts/calendar/2027/january')).toEqual({ year: 2027, month: 1 });
  });

  test('an unparseable path (no year/month, or an unknown month name) yields null', () => {
    expect(parseMonthUrlYearMonth('/concerts/calendar/')).toBeNull();
    expect(parseMonthUrlYearMonth('/concerts/calendar/2026/smarch')).toBeNull();
  });
});

describe('parseMsoMonthGrid', () => {
  test('July grid: one real day cell (26) with one show — title, detail URL, and bare grid time', () => {
    const { candidates, hasShowMarkup, skipped } = parseMsoMonthGrid(calendarJuly, 2026, 7, ORIGIN);
    expect(hasShowMarkup).toBe(true);
    expect(skipped).toBe(0);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      year: 2026,
      month: 7,
      day: 26,
      title: 'Glenn Miller Orchestra',
      detailUrl: 'https://www.mso.org/concerts/glenn-miller-orchestra/70375',
      gridTimeText: '3:00',
    });
  });

  test('September grid: multi-performance (Kings of Soul on two dates, two detail URLs) + off-site (Rhinelander)', () => {
    const { candidates, hasShowMarkup } = parseMsoMonthGrid(calendarSeptember, 2026, 9, ORIGIN);
    expect(hasShowMarkup).toBe(true);

    const bySlug = (slug: string) => candidates.filter((c) => c.detailUrl.includes(slug));
    expect(bySlug('kings-of-soul/70161')).toEqual([
      expect.objectContaining({ day: 26, gridTimeText: '7:30' }),
    ]);
    expect(bySlug('kings-of-soul/70163')).toEqual([
      expect.objectContaining({ day: 27, gridTimeText: '2:30' }),
    ]);
    expect(bySlug('mso-in-rhinelander')).toEqual([
      expect.objectContaining({ day: 29, title: 'Rhinelander Welcomes the Milwaukee Symphony Orchestra' }),
    ]);
    // Every candidate carries the September year/month passed in — never the
    // adjoining month a padding cell might visually belong to.
    expect(candidates.every((c) => c.year === 2026 && c.month === 9)).toBe(true);
  });

  test('adjacent-month padding cells (no id attribute) are excluded even when they carry their own show block', () => {
    // September's trailing grid weeks render October 2's "Pirates of the
    // Caribbean" under a padding <li> with no `id` — confirmed against the
    // live fixture. It must not leak into September's own candidates (it
    // belongs to October's own page fetch instead).
    const { candidates } = parseMsoMonthGrid(calendarSeptember, 2026, 9, ORIGIN);
    expect(candidates.some((c) => c.detailUrl.includes('pirates-of-the-caribbean'))).toBe(false);
  });

  test('a month page with day-cell markup but zero show blocks reports hasShowMarkup: false (legitimately quiet)', () => {
    const html = '<li class="list-item-day" id="1"><div class="day-indicator">01</div></li>';
    const { candidates, hasShowMarkup, skipped } = parseMsoMonthGrid(html, 2026, 8, ORIGIN);
    expect(hasShowMarkup).toBe(false);
    expect(candidates).toHaveLength(0);
    expect(skipped).toBe(0);
  });

  test('a show block missing its title/href/time is skipped and counted, not silently dropped', () => {
    const html = `
      <li class="list-item-day" id="5">
        <ul class="calendar-event"><li class="event">
          <div class="calendar--col-1"><p class="event-time"></p></div>
          <div class="calendar--col-2"><h4 class="show-title"><a>No href here</a></h4></div>
        </li></ul>
      </li>`;
    const { candidates, hasShowMarkup, skipped } = parseMsoMonthGrid(html, 2026, 8, ORIGIN);
    expect(hasShowMarkup).toBe(true);
    expect(candidates).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe('parseMsoPerformanceDates', () => {
  test('Kings of Soul: both performance-dates lines, "7:30p"->19:30 and "2:30p"->14:30', () => {
    const instants = parseMsoPerformanceDates(detailKingsOfSoul);
    expect(instants).toEqual([
      { month: 9, day: 26, hour: 19, minute: 30 },
      { month: 9, day: 27, hour: 14, minute: 30 },
    ]);
  });

  test('an "a" (am) suffix line parses without the pm-hour offset ("11:15a" -> 11:15)', () => {
    const html =
      '<ul class="list-unstyled performance-dates"><li>11:15a on Sunday, September 27</li></ul>';
    expect(parseMsoPerformanceDates(html)).toEqual([{ month: 9, day: 27, hour: 11, minute: 15 }]);
  });

  test('a 12p (noon) line rolls to hour 12 (not 24), matching the pm-default rule for hour 12', () => {
    const html = '<ul class="list-unstyled performance-dates"><li>12:00p on Sunday, September 27</li></ul>';
    expect(parseMsoPerformanceDates(html)).toEqual([{ month: 9, day: 27, hour: 12, minute: 0 }]);
  });

  test('no performance-dates markup at all yields an empty list, not a throw', () => {
    expect(parseMsoPerformanceDates(NO_MATCHING_MARKUP)).toEqual([]);
  });
});

describe('parseMsoPerformanceRange', () => {
  test('Kings of Soul: house venue, "the" prefix stripped, metro locality', () => {
    expect(parseMsoPerformanceRange(detailKingsOfSoul)).toEqual({
      venueName: 'Bradley Symphony Center',
      venueAddress: '212 W. Wisconsin Ave., Milwaukee',
      locality: 'Milwaukee',
    });
  });

  test('Rhinelander: off-site venue, no "the" prefix, non-metro locality', () => {
    expect(parseMsoPerformanceRange(detailRhinelander)).toEqual({
      venueName: 'Rhinelander High School',
      venueAddress: '665 Coolidge Ave B, Rhinelander',
      locality: 'Rhinelander',
    });
  });

  test('a page with no .performance-range block yields undefined (caller defaults to the house venue)', () => {
    expect(parseMsoPerformanceRange(NO_MATCHING_MARKUP)).toBeUndefined();
  });
});

describe('pmDefaultGridTime', () => {
  test.each([
    ['1:00', { hour: 13, minute: 0 }],
    ['3:00', { hour: 15, minute: 0 }],
    ['7:30', { hour: 19, minute: 30 }],
    ['8:00', { hour: 8, minute: 0 }],
    ['10:15', { hour: 10, minute: 15 }],
    ['11:00', { hour: 11, minute: 0 }],
    ['12:00', { hour: 12, minute: 0 }],
  ])('hour bucket rule for grid time %s', (gridTimeText, expected) => {
    expect(pmDefaultGridTime(gridTimeText)).toEqual(expected);
  });

  test('an unparseable grid time text yields null', () => {
    expect(pmDefaultGridTime('TBD')).toBeNull();
  });
});

describe('crawlMso', () => {
  const config = { strategy: 'mso-calendar' as const, sourceKey: 'mso', calendarUrl: CALENDAR_URL };

  test(
    'full run: July (real, detail-fetch fails) + September (real, multi-perf + house-default + non-metro skip) ' +
      '+ two synthetic-empty months ahead',
    async () => {
      const responses: Record<string, string | 'fail'> = {
        [CALENDAR_URL]: calendarJuly,
        [`${ORIGIN}/concerts/calendar/2026/september`]: calendarSeptember,
        [`${ORIGIN}/concerts/calendar/2026/october`]: EMPTY_MONTH, // no real Oct/Nov/Dec fixture — synthetic quiet months, disclosed
        [`${ORIGIN}/concerts/calendar/2026/november`]: EMPTY_MONTH,
        'https://www.mso.org/concerts/glenn-miller-orchestra/70375': 'fail', // detail-fetch FAILURE case
        'https://www.mso.org/concerts/season-opening-fanfare/69585': NO_MATCHING_MARKUP, // fetch ok, no matching day/venue
        'https://www.mso.org/concerts/season-opening-fanfare/69586': NO_MATCHING_MARKUP,
        'https://www.mso.org/concerts/mso-2026-gala/71280': NO_MATCHING_MARKUP, // "Milwaukee Symphony Orchestra 2026 Gala" — same degraded path, third instance
        'https://www.mso.org/concerts/kings-of-soul/70161': detailKingsOfSoul,
        'https://www.mso.org/concerts/kings-of-soul/70163': detailKingsOfSoul, // same page both grid dates link to (live-verified)
        'https://www.mso.org/concerts/mso-in-rhinelander/': detailRhinelander,
      };
      const mockFetch = vi.fn(async (input: string) => {
        const body = responses[input];
        if (body === undefined) throw new Error(`unexpected fetch: ${input}`);
        if (body === 'fail') throw new Error('network error');
        return okText(body);
      });
      vi.stubGlobal('fetch', mockFetch);
      const warnSpy = spyOnWarn();

      const { records, parseSkipped } = await crawlMso(config);

      // 1 calendar (July, doubles as month 1) + 3 months ahead + 7 unique detail URLs
      // (Glenn Miller, 2x Season Opening Fanfare, MSO 2026 Gala, 2x Kings of Soul, Rhinelander).
      expect(mockFetch).toHaveBeenCalledTimes(1 + 3 + 7);

      // Only Rhinelander (non-metro) is dropped; every other candidate still publishes.
      expect(parseSkipped).toBe(1);
      expect(records).toHaveLength(6);

      const byTitle = (title: string) => records.filter((r) => (r.payload as { name: string }).name === title);

      // Detail-fetch FAILURE -> pm-default heuristic on the grid's own "3:00" (hour 1-7 -> pm).
      const glennMiller = byTitle('Glenn Miller Orchestra')[0];
      expect((glennMiller.payload as { startDate: string }).startDate).toBe('2026-07-26T20:00:00.000Z'); // 3pm Chicago (CDT, UTC-5)
      expect((glennMiller.payload as { venueName: string }).venueName).toBe(MSO_VENUE_NAME);
      expect((glennMiller.payload as { venueAddress: string }).venueAddress).toBe(MSO_VENUE_ADDRESS);

      // Detail fetch succeeded but had no matching performance-dates line/venue ->
      // same pm-default heuristic + house-venue default, two distinct dates.
      const fanfare = byTitle('Season Opening Fanfare');
      expect(fanfare).toHaveLength(2);
      const fanfareDates = fanfare.map((r) => (r.payload as { startDate: string }).startDate).sort();
      expect(fanfareDates).toEqual(['2026-09-19T00:30:00.000Z', '2026-09-20T00:30:00.000Z']); // 7:30pm Sept 18 & 19 Chicago (CDT)
      expect(fanfare.every((r) => (r.payload as { venueName: string }).venueName === MSO_VENUE_NAME)).toBe(true);

      // A third instance of the same degraded path (fetch ok, no matching markup).
      const gala = byTitle('Milwaukee Symphony Orchestra 2026 Gala')[0];
      expect((gala.payload as { startDate: string }).startDate).toBe('2026-09-25T22:00:00.000Z'); // pm-default on "5:00"
      expect((gala.payload as { venueName: string }).venueName).toBe(MSO_VENUE_NAME);

      // Multi-performance: two grid dates, two distinct detail URLs serving the
      // SAME production page — each still resolves to its own date+time (no
      // duplication, no cross-contamination), detail times win over grid times.
      const kingsOfSoul = byTitle('Kings of Soul');
      expect(kingsOfSoul).toHaveLength(2);
      const kingsOfSoulByDate = Object.fromEntries(
        kingsOfSoul.map((r) => [(r.payload as { startDate: string }).startDate, r]),
      );
      expect(Object.keys(kingsOfSoulByDate).sort()).toEqual([
        '2026-09-27T00:30:00.000Z', // 7:30pm Sat Sept 26 Chicago (CDT) rolls to 00:30 UTC Sept 27
        '2026-09-27T19:30:00.000Z', // 2:30pm Sun Sept 27 Chicago (CDT)
      ]);
      expect(
        kingsOfSoul.every((r) => (r.payload as { venueName: string }).venueName === 'Bradley Symphony Center'),
      ).toBe(true);

      // Rhinelander (non-metro off-site) never appears in the published records.
      expect(records.some((r) => (r.payload as { name: string }).name.includes('Rhinelander'))).toBe(false);

      // Decision 3's "logged" rule: every pm-default degradation warns with
      // the production title + which degraded path was taken, and the run
      // ends with an aggregate degraded-ratio line (4 of 6 published records
      // degraded here: Glenn Miller fetch-failed, Fanfare x2 + Gala no-line).
      const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(warnings).toContainEqual(
        expect.stringMatching(/pm-default degraded \(detail-fetch-failed\).*Glenn Miller Orchestra.*2026-07-26/),
      );
      expect(
        warnings.filter((w) => /pm-default degraded \(no-matching-performance-line\)/.test(w)),
      ).toHaveLength(3);
      expect(warnings).toContain('mso: 4/6 published times pm-default degraded');
    },
  );

  test('month switcher with no selected option throws (parser rot, not a healthy empty run)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(okText('<select id="month_switcher"></select>'));
    vi.stubGlobal('fetch', mockFetch);
    await expect(crawlMso(config)).rejects.toThrow(/no selected month/);
  });

  test('zero events parsed from a month page with real show markup throws (selector rot)', async () => {
    // A day cell with a show block whose title/href/time all fail to extract —
    // "had show cards but yielded zero events" per repo convention.
    const brokenGrid = `
      <li class="list-item-day" id="1">
        <ul class="calendar-event"><li class="event">
          <div class="calendar--col-2"><h4 class="show-title"><a>No href</a></h4></div>
        </li></ul>
      </li>`;
    // Force a switcher with only one month ahead so the second fetch is deterministic.
    const oneAheadSwitcher =
      '<select id="month_switcher"><option value="/concerts/calendar/2026/july" selected>July 2026</option>' +
      '<option value="/concerts/calendar/2026/september">September 2026</option></select>';
    const mockFetch = vi.fn().mockResolvedValueOnce(okText(oneAheadSwitcher)).mockResolvedValueOnce(okText(brokenGrid));
    vi.stubGlobal('fetch', mockFetch);
    await expect(crawlMso(config)).rejects.toThrow(/likely parser rot/);
  });

  test('a genuinely empty month (no show markup) returns quietly, no throw', async () => {
    const oneAheadSwitcher =
      '<select id="month_switcher"><option value="/concerts/calendar/2026/july" selected>July 2026</option>' +
      '<option value="/concerts/calendar/2026/september">September 2026</option></select>';
    const mockFetch = vi.fn().mockResolvedValueOnce(okText(oneAheadSwitcher)).mockResolvedValueOnce(okText(EMPTY_MONTH));
    vi.stubGlobal('fetch', mockFetch);
    const { records, parseSkipped } = await crawlMso(config);
    expect(records).toEqual([]);
    expect(parseSkipped).toBe(0);
  });

  test('detail-fetch cap respected: only MSO_MAX_DETAIL_FETCHES detail pages are fetched; overflow candidates still publish via the pm-default heuristic', async () => {
    expect(MSO_MAX_DETAIL_FETCHES).toBe(20);
    const totalShows = 25;
    const dayCells = Array.from({ length: totalShows }, (_, i) => {
      const day = i + 1;
      return `<li class="list-item-day" id="${day}"><ul class="calendar-event"><li class="event">
        <div class="calendar--col-1"><p class="event-time">7:30</p></div>
        <div class="calendar--col-2"><h4 class="show-title"><a href="https://www.mso.org/concerts/show-${day}/${1000 + day}">Show ${day}</a></h4></div>
      </li></ul></li>`;
    }).join('');
    const oneMonthSwitcher = '<select id="month_switcher"><option value="/concerts/calendar/2026/july" selected>July 2026</option></select>';
    const bareCalendar = `${oneMonthSwitcher}${dayCells}`;

    const mockFetch = vi.fn(async (input: string) => {
      if (input === CALENDAR_URL) return okText(bareCalendar);
      throw new Error('network error'); // every detail fetch fails outright
    });
    vi.stubGlobal('fetch', mockFetch);
    const warnSpy = spyOnWarn();

    const { records, parseSkipped } = await crawlMso(config);
    // 1 calendar fetch + capped detail fetches (not 25).
    expect(mockFetch).toHaveBeenCalledTimes(1 + MSO_MAX_DETAIL_FETCHES);
    // All 25 candidates still publish (pm-default heuristic on "7:30" -> 19:30 for every one).
    expect(records).toHaveLength(totalShows);
    expect(parseSkipped).toBe(0);
    expect(records.every((r) => (r.payload as { startDate: string }).startDate.endsWith('T00:30:00.000Z'))).toBe(true);

    // Every degradation warns with its distinct path: 20 attempted-but-failed
    // fetches vs 5 never-attempted cap-overflow drops, plus the aggregate line.
    const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(warnings.filter((w) => /pm-default degraded \(detail-fetch-failed\)/.test(w))).toHaveLength(
      MSO_MAX_DETAIL_FETCHES,
    );
    const overflowWarnings = warnings.filter((w) => /pm-default degraded \(detail-cap-overflow\)/.test(w));
    expect(overflowWarnings).toHaveLength(totalShows - MSO_MAX_DETAIL_FETCHES);
    expect(overflowWarnings[0]).toMatch(/"Show 21" 2026-07-21 grid time "7:30"/);
    expect(warnings).toContain(`mso: ${totalShows}/${totalShows} published times pm-default degraded`);
  });

  test('normalizes a produced record into a valid NormalizedEvent', async () => {
    const oneMonthSwitcher = '<select id="month_switcher"><option value="/concerts/calendar/2026/july" selected>July 2026</option></select>';
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okText(`${oneMonthSwitcher}${calendarJuly.slice(calendarJuly.indexOf('<li'))}`))
      .mockResolvedValueOnce(okText(detailKingsOfSoul)); // arbitrary detail content, just needs a parseable page
    vi.stubGlobal('fetch', mockFetch);
    spyOnWarn(); // July 26 has no matching performance line in that page — degraded path warns
    const { records } = await crawlMso(config);
    const normalized = normalizeHtmlRecord(records[0]);
    expect(normalized?.title).toBe('Glenn Miller Orchestra');
    expect(normalized?.status).toBe('scheduled');
  });

  test('htmlAdapter dispatches the mso-calendar strategy to crawlMso', async () => {
    const oneMonthSwitcher = '<select id="month_switcher"><option value="/concerts/calendar/2026/july" selected>July 2026</option></select>';
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okText(`${oneMonthSwitcher}${calendarJuly.slice(calendarJuly.indexOf('<li'))}`))
      .mockResolvedValueOnce(okText(detailKingsOfSoul));
    vi.stubGlobal('fetch', mockFetch);
    spyOnWarn(); // same degraded-path warn as the normalize test above
    const outcome = await htmlAdapter.fetch(config);
    expect(outcome.records).toHaveLength(1);
  });
});
