// Milwaukee Symphony Orchestra — calendar-grid selectors + detail-page
// performance times.
//
// Two dead ends ruled this strategy in (verified live 2026-07-12): the Tribe
// REST endpoint 401s, and detail pages carry no Event JSON-LD. What remains
// is a monthly calendar grid (`www.mso.org/concerts/calendar/`) whose
// `.event-time` cells have NO am/pm suffix ("3:00", "7:30"), so a detail-page
// crawl is required for authoritative times.
//
// Month discovery is switcher-driven, never URL-constructed: `#month_switcher`
// only lists months that actually have events (a real live gap: August 2026
// is absent between July and September). Constructing "/2026/august" would
// silently 404 or render an empty page that looks like a legitimate quiet
// month — so months to fetch always come from the switcher's own `<option>`
// list, never from date arithmetic.
//
// A day cell belongs to the target month ONLY when its `<li class="list-item-day">`
// carries a numeric `id` attribute (the day-of-month). Adjacent-month padding
// cells (leading/trailing weeks needed to fill the grid) share the same
// classes and CAN carry their own `.calendar-event` blocks, but have no `id`
// attribute — e.g. September's grid trailing padding renders Oct 2's "Pirates
// of the Caribbean" show under a day cell with no id at all. Only `[id]` cells
// are read; the id-less padding cells are skipped so that event is picked up
// once, from October's own page fetch, not duplicated (or misdated) here.
// This id-presence rule isn't in the original recon — it surfaced from the
// live fixture and is disclosed in the task report as selector-fix drift.
//
// Per-production detail pages give the authoritative time via
// `.performance-dates` ("7:30p on Saturday, September 26") and the venue via
// `.performance-range`'s tail ("at the Bradley Symphony Center, 212 W.
// Wisconsin Ave., Milwaukee" / "at Rhinelander High School, 665 Coolidge Ave
// B, Rhinelander"). A multi-performance production can assign a DIFFERENT
// numeric detail URL to each grid date (Kings of Soul: .../70161 for the
// Sat 7:30p show, .../70163 for the Sun 2:30p show) even though both URLs
// render the same production page listing both dates — so URL-exact dedup
// only avoids re-fetching a truly shared URL; each grid candidate still
// looks up ITS OWN day within whichever detail page its own URL yields,
// which keeps multi-performance productions to one record per grid date+time
// even when their detail URLs don't collapse to one fetch.
//
// A detail fetch that fails, or succeeds but has no `.performance-dates` line
// matching this candidate's day, degrades to a pm-default heuristic read off
// the grid's own bare time (hours 1-7 -> pm, 8-11 -> am, 12 -> pm) rather than
// dropping the record — MSO's own live data confirms this heuristic against
// ground truth: Rhinelander's grid cell shows "7:30" and its detail page
// confirms "7:30p", the exact pm guess the heuristic would produce.
//
// Non-metro localities (e.g. Rhinelander, a real off-site touring date) are a
// designed skip — this calendar is for events IN Milwaukee, not the
// orchestra's touring schedule. A missing/unparseable venue line (fetch
// failed, or the detail page's markup didn't match) defaults to the house
// venue (Bradley Symphony Center) rather than skip, since the vast majority
// of MSO's own calendar is performed there.
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { fetchText, resolveUrl } from '../../helpers';
import type { FetchedRecord, FetchOutcome } from '../../types';
import { chicagoWallTimeToIso } from '@/lib/chicago-time';
import { defaultSleep, mapWithDelay, type SleepFn } from '../pacing';

/** Month pages fetched per run beyond the switcher-discovery fetch (which doubles as month 1's data). */
export const MSO_MAX_MONTHS = 3;
/** Unique production detail pages fetched per run, after exact-URL dedup; overflow degrades to the pm-default heuristic. */
export const MSO_MAX_DETAIL_FETCHES = 20;
/** Pause between sequential detail-page fetches; polite pacing (cache-control: no-store). */
const DETAIL_DELAY_MS = 250;

export const MSO_VENUE_NAME = 'Bradley Symphony Center';
export const MSO_VENUE_ADDRESS = '212 W. Wisconsin Ave., Milwaukee';

/** Milwaukee-metro localities MSO's own detail pages resolve to; anything else is a designed off-site skip. */
export const MSO_METRO_LOCALITIES = [
  'Milwaukee',
  'Wauwatosa',
  'Brookfield',
  'Bayside',
  'Glendale',
  'Franklin',
  'Oak Creek',
  'Shorewood',
  'Whitefish Bay',
  'West Allis',
];
const METRO_LOCALITY_SET = new Set(MSO_METRO_LOCALITIES.map((locality) => locality.toLowerCase()));

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export const msoConfigSchema = z.object({
  strategy: z.literal('mso-calendar'),
  sourceKey: z.string().min(1),
  calendarUrl: z.string().url(),
});

export type MsoConfig = z.infer<typeof msoConfigSchema>;

export interface MsoMonthOption {
  /** Raw `option[value]`, e.g. "/concerts/calendar/2026/september" — a real switcher-listed month, never constructed. */
  url: string;
  label: string;
  selected: boolean;
}

/** Reads only `#month_switcher`'s own options — gap months (e.g. Aug 2026) are absent here and never synthesized. */
export function parseMsoMonthSwitcher(html: string): MsoMonthOption[] {
  const $ = cheerio.load(html);
  const options: MsoMonthOption[] = [];
  $('#month_switcher option').each((_, el) => {
    const value = $(el).attr('value');
    if (!value) return;
    options.push({
      url: value,
      label: $(el).text().trim(),
      selected: $(el).attr('selected') !== undefined,
    });
  });
  return options;
}

/** The selected month plus up to `maxMonthsAhead` FROM THE OPTION LIST — never date arithmetic. */
export function selectMsoMonthsAhead(
  options: MsoMonthOption[],
  maxMonthsAhead: number = MSO_MAX_MONTHS,
): MsoMonthOption[] {
  const selectedIndex = options.findIndex((option) => option.selected);
  if (selectedIndex === -1) return [];
  return options.slice(selectedIndex + 1, selectedIndex + 1 + maxMonthsAhead);
}

const MONTH_URL_RE = /\/calendar\/(\d{4})\/([a-z]+)/i;

/** Year is ONLY ever available from a month URL's path — never from grid-cell visible text. */
export function parseMonthUrlYearMonth(url: string): { year: number; month: number } | null {
  const match = MONTH_URL_RE.exec(url);
  if (!match) return null;
  const month = MONTH_NAME_TO_NUMBER[match[2].toLowerCase()];
  if (!month) return null;
  return { year: Number(match[1]), month };
}

export interface MsoGridCandidate {
  year: number;
  month: number;
  day: number;
  title: string;
  detailUrl: string;
  /** The grid's own bare time text, e.g. "3:00" — no am/pm, subordinate to detail-page times. */
  gridTimeText: string;
}

export interface MsoMonthGridResult {
  candidates: MsoGridCandidate[];
  /** True when at least one show block rendered anywhere in the month's real (non-padding) day cells. */
  hasShowMarkup: boolean;
  /** A show block was recognized (title/time/day present) but one required field failed to extract. */
  skipped: number;
}

/** One month's grid: real day cells only (`[id]`), each day's `li.event` show blocks. */
export function parseMsoMonthGrid(
  html: string,
  year: number,
  month: number,
  baseUrl: string,
): MsoMonthGridResult {
  const $ = cheerio.load(html);
  const candidates: MsoGridCandidate[] = [];
  let hasShowMarkup = false;
  let skipped = 0;

  $('li.list-item-day[id]').each((_, dayEl) => {
    const day = Number($(dayEl).attr('id'));
    if (!Number.isInteger(day)) return;

    $(dayEl)
      .find('li.event')
      .each((__, showEl) => {
        hasShowMarkup = true;
        const titleAnchor = $(showEl).find('.show-title a[href]').first();
        const title = titleAnchor.text().trim();
        const detailUrl = resolveUrl(titleAnchor.attr('href'), baseUrl);
        const gridTimeText = $(showEl).find('.event-time').first().text().trim();
        if (!title || !detailUrl || !gridTimeText) {
          skipped += 1;
          return;
        }
        candidates.push({ year, month, day, title, detailUrl, gridTimeText });
      });
  });

  return { candidates, hasShowMarkup, skipped };
}

export interface MsoPerformanceInstant {
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const PERFORMANCE_DATE_LINE_RE = /^(\d{1,2}):(\d{2})(a|p)\s+on\s+[A-Za-z]+,\s+([A-Za-z]+)\s+(\d{1,2})$/i;

/** `.performance-dates` lines ("7:30p on Saturday, September 26") — the authoritative time source. */
export function parseMsoPerformanceDates(html: string): MsoPerformanceInstant[] {
  const $ = cheerio.load(html);
  const instants: MsoPerformanceInstant[] = [];
  $('.performance-dates li').each((_, el) => {
    const match = PERFORMANCE_DATE_LINE_RE.exec($(el).text().trim());
    if (!match) return;
    const [, hourStr, minuteStr, meridiem, monthName, dayStr] = match;
    const month = MONTH_NAME_TO_NUMBER[monthName.toLowerCase()];
    if (!month) return;
    let hour = Number(hourStr);
    const isPm = meridiem.toLowerCase() === 'p';
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    instants.push({ month, day: Number(dayStr), hour, minute: Number(minuteStr) });
  });
  return instants;
}

export interface MsoVenueInfo {
  venueName: string;
  venueAddress: string;
  locality: string;
}

const VENUE_TAIL_RE = /\bat\s+(?:the\s+)?(.+)$/i;

/** `.performance-range`'s trailing "at [the] <venue>, <street>, <locality>" line. */
export function parseMsoPerformanceRange(html: string): MsoVenueInfo | undefined {
  const $ = cheerio.load(html);
  const raw = $('.performance-range').first().text();
  if (!raw) return undefined;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  const match = VENUE_TAIL_RE.exec(cleaned);
  if (!match) return undefined;
  const parts = match[1].split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return undefined;
  return {
    venueName: parts[0],
    venueAddress: parts.slice(1).join(', '),
    locality: parts[parts.length - 1],
  };
}

/** hours 1-7 -> pm, 8-11 -> am, 12 -> pm (noon) — ONLY applied when detail-page time data is unavailable. */
export function pmDefaultGridTime(gridTimeText: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(gridTimeText.trim());
  if (!match) return null;
  const hourRaw = Number(match[1]);
  const minute = Number(match[2]);
  if (hourRaw === 12) return { hour: 12, minute };
  if (hourRaw >= 1 && hourRaw <= 7) return { hour: hourRaw + 12, minute };
  if (hourRaw >= 8 && hourRaw <= 11) return { hour: hourRaw, minute };
  return null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Numeric performance-post id from the detail URL when present; else a stable slug+date+time id (e.g. off-site productions with no numeric suffix). */
function msoEventId(
  detailUrl: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  let pathname = '';
  try {
    pathname = new URL(detailUrl).pathname;
  } catch {
    pathname = '';
  }
  const numericMatch = /\/(\d+)\/?$/.exec(pathname);
  if (numericMatch) return numericMatch[1];
  const segments = pathname.split('/').filter(Boolean);
  const slug = segments[segments.length - 1] || 'mso-event';
  return `${slug}-${year}${pad2(month)}${pad2(day)}-${pad2(hour)}${pad2(minute)}`;
}

interface DetailFetchResult {
  performanceDates: MsoPerformanceInstant[];
  venue?: MsoVenueInfo;
}

async function fetchMsoDetail(url: string): Promise<DetailFetchResult | null> {
  try {
    const html = await fetchText(url, `MSO detail ${url}`);
    return { performanceDates: parseMsoPerformanceDates(html), venue: parseMsoPerformanceRange(html) };
  } catch {
    return null;
  }
}

export async function crawlMso(config: MsoConfig, sleepFn: SleepFn = defaultSleep): Promise<FetchOutcome> {
  const origin = new URL(config.calendarUrl).origin;
  const bareHtml = await fetchText(config.calendarUrl, `MSO calendar ${config.calendarUrl}`);
  const options = parseMsoMonthSwitcher(bareHtml);
  const selected = options.find((option) => option.selected);
  if (!selected) {
    throw new Error(`MSO calendar ${config.calendarUrl} month switcher had no selected month — likely parser rot`);
  }
  const selectedYearMonth = parseMonthUrlYearMonth(selected.url);
  if (!selectedYearMonth) {
    throw new Error(
      `MSO calendar ${config.calendarUrl} selected month option "${selected.url}" has no parseable year/month`,
    );
  }

  const monthPages: { html: string; year: number; month: number; label: string }[] = [
    { html: bareHtml, ...selectedYearMonth, label: selected.label },
  ];
  for (const option of selectMsoMonthsAhead(options)) {
    const yearMonth = parseMonthUrlYearMonth(option.url);
    if (!yearMonth) continue; // defensive; every real switcher option parses
    const monthUrl = resolveUrl(option.url, origin) ?? option.url;
    const html = await fetchText(monthUrl, `MSO calendar ${monthUrl}`);
    monthPages.push({ html, ...yearMonth, label: option.label });
  }

  let parseSkipped = 0;
  const allCandidates: MsoGridCandidate[] = [];
  for (const page of monthPages) {
    const grid = parseMsoMonthGrid(page.html, page.year, page.month, origin);
    parseSkipped += grid.skipped;
    // A month whose grid rendered at least one show block, but none of them
    // survived extraction, signals selector rot — never reported as a
    // healthy quiet month. A month with genuinely zero show blocks (no
    // concerts scheduled) is a legitimately quiet result.
    if (grid.hasShowMarkup && grid.candidates.length === 0) {
      throw new Error(`MSO calendar month ${page.label} had show markup but yielded zero grid entries — likely parser rot`);
    }
    allCandidates.push(...grid.candidates);
  }

  const uniqueDetailUrls = Array.from(new Set(allCandidates.map((candidate) => candidate.detailUrl)));
  const eligibleDetailUrls = uniqueDetailUrls.slice(0, MSO_MAX_DETAIL_FETCHES);

  const detailResults = new Map<string, DetailFetchResult | null>();
  await mapWithDelay(
    eligibleDetailUrls,
    DETAIL_DELAY_MS,
    async (url) => {
      detailResults.set(url, await fetchMsoDetail(url));
    },
    sleepFn,
  );

  const records: FetchedRecord[] = [];
  let degradedCount = 0;
  for (const candidate of allCandidates) {
    const detail = detailResults.get(candidate.detailUrl);
    // The (month, day) join below is year-less because `.performance-dates`
    // lines carry no year. INVARIANT making that safe: a run's window is at
    // most 1 + MSO_MAX_MONTHS = 4 consecutive calendar months, so no month
    // number can repeat across years within one run — (month, day) is unique
    // per window. Raising MSO_MAX_MONTHS past 11 would break this.
    const matchedInstant = detail?.performanceDates.find(
      (instant) => instant.month === candidate.month && instant.day === candidate.day,
    );

    // Authoritative detail time wins; a fetch that was never attempted
    // (cap overflow), failed outright, or succeeded without a matching
    // performance-dates line for this candidate's day all degrade the same
    // way — read the grid's own bare time through the pm-default heuristic
    // rather than drop a record we otherwise have a title/date/venue for.
    // Every degradation is warn-logged (Decision 3's "logged" rule): degraded
    // records still publish, so without the log a run whose EVERY time was
    // guessed (e.g. .performance-dates selector rot) would look identical to
    // a healthy run.
    const time = matchedInstant ?? pmDefaultGridTime(candidate.gridTimeText);
    if (!time) {
      parseSkipped += 1;
      continue;
    }
    if (!matchedInstant) {
      degradedCount += 1;
      const degradedPath = !detailResults.has(candidate.detailUrl)
        ? 'detail-cap-overflow'
        : detail === null
          ? 'detail-fetch-failed'
          : 'no-matching-performance-line';
      console.warn(
        `MSO time pm-default degraded (${degradedPath}): "${candidate.title}" ` +
          `${candidate.year}-${pad2(candidate.month)}-${pad2(candidate.day)} grid time "${candidate.gridTimeText}"`,
      );
    }

    let venueName = MSO_VENUE_NAME;
    let venueAddress = MSO_VENUE_ADDRESS;
    if (detail?.venue) {
      if (!METRO_LOCALITY_SET.has(detail.venue.locality.toLowerCase())) {
        // Designed skip: MSO's touring schedule outside the Milwaukee metro
        // (e.g. Rhinelander) isn't a Milwaukee event for this calendar.
        parseSkipped += 1;
        continue;
      }
      venueName = detail.venue.venueName;
      venueAddress = detail.venue.venueAddress;
    }
    // else: no parseable venue line (fetch failed, or the detail page's
    // markup didn't match) — defaults to the house venue, since the large
    // majority of MSO's calendar is performed there.

    const startDate = chicagoWallTimeToIso(candidate.year, candidate.month, candidate.day, time.hour, time.minute);
    const id = msoEventId(candidate.detailUrl, candidate.year, candidate.month, candidate.day, time.hour, time.minute);
    records.push({
      sourceEventId: id,
      sourceUrl: candidate.detailUrl,
      payload: {
        id,
        name: candidate.title,
        url: candidate.detailUrl,
        startDate,
        venueName,
        venueAddress,
      },
    });
  }

  // Aggregate degradation signal, warn-only by design: FetchOutcome is the
  // shared contract every adapter returns (and run.ts's summary line prints
  // fetched/published/skipped from it), so a new field would ripple through
  // shared surfaces for one source's diagnostic. The per-record warns above
  // plus this end-of-run ratio give operators the same visibility.
  if (degradedCount > 0) {
    console.warn(`mso: ${degradedCount}/${records.length} published times pm-default degraded`);
  }

  return { records, parseSkipped };
}
