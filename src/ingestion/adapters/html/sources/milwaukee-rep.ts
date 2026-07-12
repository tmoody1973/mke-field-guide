// Milwaukee Repertory Theater — season listing + detail-page date-range runs.
//
// The season listing (`/shows/current-season/`, a Django CMS page — NOT
// Craft, confirmed live) renders one `.show-listing[data-show-id][data-theater]`
// card per production, but its own visible date text is UNRELIABLE: live
// observation caught wrong end-years ("November 4, 2025 - December 14,
// 2024"; "May 26, 2026 - June 28, 2025" — both should read the FOLLOWING
// year). Listing dates are therefore NEVER parsed for the authoritative
// range — only enumerated (id/theater/title/detail href) — and each show's
// own detail page supplies the real range via `h2.tight-paragraph`
// ("November 4 – December 14, 2025": en dash, year given ONLY at the end,
// applied to both ends). When the start month is numerically greater than
// the end month the run crosses a calendar-year boundary, so the start
// year rolls back one from the shared end year (e.g. "December 27 –
// January 3, 2026" -> starts 2025-12-27, ends 2026-01-03).
//
// No per-performance time is fetchable anywhere (ticketing sits behind
// Imperva) — every instance in a run publishes as an ALL-DAY midnight-
// Chicago record, one per day.title, via the same frozen day-range.ts
// machinery every other multi-day HTML source consumes (tribe-events,
// milwaukee-downtown). Dark days (most theaters go quiet on Mondays) are
// NOT modeled — every calendar day in the range publishes, a known,
// documented limitation of this class of source, not something this
// parser can fix from what the site exposes.
//
// `data-theater` maps to a small, fixed set of Rep-operated houses (all at
// 108 East Wells Street, the Associated Bank Theater Center) PLUS one
// off-site partner stage: theater 26 is the Pabst Theater, which already
// has its own venue row seeded by the pabst-theater-group source. That
// existing row's canonical name is literally "The Pabst Theater" (its own
// listing card text) — normalizeName() does not strip articles, so this
// parser must emit that exact string, not the shorter "Pabst Theater" that
// Milwaukee Rep's OWN detail pages print in their venue line, or the two
// would mint separate venue rows instead of consolidating onto one. The
// "the "-prefix is stripped before comparing/matching venue text for this
// reason (see normalizeVenueText).
//
// An id outside the known map falls back to matching the detail page's own
// venue line (a lone `h4` or occasionally `h3` following the credits line —
// matched by KNOWN venue text, never by tag/position, since the credits
// line is also an h4/h3 sibling) against the same known-venue list; neither
// resolving is a skip, logged.
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { fetchText, resolveUrl } from '../../helpers';
import type { FetchedRecord, FetchOutcome } from '../../types';
import { chicagoWallTimeToIso } from '@/lib/chicago-time';
import { dedupeDayRecords, expandDayRange, type DayDate } from '../day-range';
import { defaultSleep, mapWithDelay, type SleepFn } from '../pacing';

/** Safety cap so a misparsed detail range cannot fan out into hundreds of day-instances. */
export const MILWAUKEE_REP_MAX_RANGE_DAYS = 120;
/** Pause between sequential per-show detail-page fetches; polite pacing (~12 shows/season). */
const DETAIL_DELAY_MS = 250;

interface VenueFields {
  venueName: string;
  venueAddress: string;
}

const REP_HOUSE_ADDRESS = '108 East Wells Street, Milwaukee, WI 53202';
const CHECOTA_POWERHOUSE: VenueFields = { venueName: 'Checota Powerhouse Theater', venueAddress: REP_HOUSE_ADDRESS };
const STACKNER_CABARET: VenueFields = { venueName: 'Stackner Cabaret', venueAddress: REP_HOUSE_ADDRESS };
const HERRO_FRANKE_STUDIO: VenueFields = { venueName: 'Herro-Franke Studio Theater', venueAddress: REP_HOUSE_ADDRESS };
// Off-site partner stage — the venueName MUST match the pabst-theater-group
// source's own listing-card text ("The Pabst Theater") so both sources'
// events consolidate onto one venue row (normalizeName keeps articles).
const PABST_THEATER: VenueFields = { venueName: 'The Pabst Theater', venueAddress: '144 E Wells St, Milwaukee, WI 53202' };

/** `data-theater` -> known Rep-operated house or off-site partner stage. */
export const MILWAUKEE_REP_THEATER_VENUES: Record<number, VenueFields> = {
  24: CHECOTA_POWERHOUSE,
  25: STACKNER_CABARET,
  30: HERRO_FRANKE_STUDIO,
  26: PABST_THEATER,
};

/** Every known venue, for detail-page venue-TEXT fallback matching (unknown `data-theater` ids). */
const KNOWN_VENUES: VenueFields[] = [CHECOTA_POWERHOUSE, STACKNER_CABARET, HERRO_FRANKE_STUDIO, PABST_THEATER];

/** Strips a leading "the " before comparing venue text — Rep's own detail pages print "Pabst Theater", the seeded row is "The Pabst Theater". */
function normalizeVenueText(text: string): string {
  return text.toLowerCase().replace(/^the\s+/, '').trim();
}

export const milwaukeeRepConfigSchema = z.object({
  strategy: z.literal('milwaukee-rep-season'),
  sourceKey: z.string().min(1),
  listingUrl: z.string().url(),
});

export type MilwaukeeRepConfig = z.infer<typeof milwaukeeRepConfigSchema>;

export interface MilwaukeeRepShowCard {
  showId: string;
  theaterId: number;
  title: string;
  detailUrl: string;
}

export interface MilwaukeeRepListingResult {
  cards: MilwaukeeRepShowCard[];
  /** Count of `.show-listing[data-show-id][data-theater]` elements seen, parseable or not — the "non-empty listing" signal. */
  rawCardCount: number;
}

/** Enumerates every season card's id/theater/title/detail-href — NEVER its date text (see file header). */
export function parseMilwaukeeRepListing(html: string, listingUrl: string): MilwaukeeRepListingResult {
  const $ = cheerio.load(html);
  const rawCards = $('.show-listing[data-show-id][data-theater]');
  const cards: MilwaukeeRepShowCard[] = [];
  rawCards.each((_, el) => {
    const card = $(el);
    const showId = card.attr('data-show-id');
    const theaterAttr = card.attr('data-theater');
    const theaterId = Number(theaterAttr);
    const title = card.find('.show-listing-title').first().text().trim();
    const detailUrl = resolveUrl(card.find('a[href^="/shows/show/"]').first().attr('href'), listingUrl);
    if (!showId || !Number.isInteger(theaterId) || !title || !detailUrl) return;
    cards.push({ showId, theaterId, title, detailUrl });
  });
  return { cards, rawCardCount: rawCards.length };
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// En dash (–, U+2013) is the live separator; a plain hyphen is accepted too
// for robustness. Year appears ONCE, trailing the end date only.
const DETAIL_RANGE_RE = /^([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/;

export interface MilwaukeeRepDateRange {
  start: DayDate;
  end: DayDate;
}

/** Parses the detail page's authoritative `h2.tight-paragraph` range; null when unparseable. */
export function parseMilwaukeeRepDetailRange(html: string): MilwaukeeRepDateRange | null {
  const $ = cheerio.load(html);
  const text = $('h2.tight-paragraph').first().text().replace(/\s+/g, ' ').trim();
  const match = DETAIL_RANGE_RE.exec(text);
  if (!match) return null;
  const [, startMonthName, startDayStr, endMonthName, endDayStr, yearStr] = match;
  const startMonth = MONTHS[startMonthName.toLowerCase()];
  const endMonth = MONTHS[endMonthName.toLowerCase()];
  if (!startMonth || !endMonth) return null;
  const endYear = Number(yearStr);
  // Year is given once, trailing the end date, and applies to BOTH ends —
  // except when the run crosses a calendar-year boundary (start month
  // numerically after end month, e.g. Dec -> Jan), in which case the start
  // date belongs to the PRIOR year.
  const startYear = startMonth > endMonth ? endYear - 1 : endYear;
  return {
    start: { year: startYear, month: startMonth, day: Number(startDayStr) },
    end: { year: endYear, month: endMonth, day: Number(endDayStr) },
  };
}

/** The detail page's own venue line (`h4` or `h3` following the credits line), matched by text — never tag position. */
export function parseMilwaukeeRepDetailVenueText(html: string): string | undefined {
  const $ = cheerio.load(html);
  const container = $('.show-placeholder-content').first();
  const candidates = container.length > 0 ? container.find('h3, h4') : $('h3, h4');
  let matchedText: string | undefined;
  candidates.each((_, el) => {
    if (matchedText) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    const normalized = normalizeVenueText(text);
    if (KNOWN_VENUES.some((venue) => normalizeVenueText(venue.venueName) === normalized)) {
      matchedText = text;
    }
  });
  return matchedText;
}

/** Known `data-theater` id first; else the detail page's own venue text against the known-venue list; else undefined (skip). */
function resolveVenue(theaterId: number, detailHtml: string): VenueFields | undefined {
  const known = MILWAUKEE_REP_THEATER_VENUES[theaterId];
  if (known) return known;
  const text = parseMilwaukeeRepDetailVenueText(detailHtml);
  if (!text) return undefined;
  const normalized = normalizeVenueText(text);
  return KNOWN_VENUES.find((venue) => normalizeVenueText(venue.venueName) === normalized);
}

/** Whole calendar days spanned inclusively (e.g. same day -> 1). */
function inclusiveDaySpan(start: DayDate, end: DayDate): number {
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

function formatDayDate(day: DayDate): string {
  const month = String(day.month).padStart(2, '0');
  const dayOfMonth = String(day.day).padStart(2, '0');
  return `${day.year}-${month}-${dayOfMonth}`;
}

function dayInstanceRecords(card: MilwaukeeRepShowCard, venue: VenueFields, days: DayDate[]): FetchedRecord[] {
  return days.map((day) => ({
    sourceEventId: card.showId,
    sourceUrl: card.detailUrl,
    payload: {
      id: card.showId,
      name: card.title,
      url: card.detailUrl,
      startDate: chicagoWallTimeToIso(day.year, day.month, day.day, 0, 0),
      venueName: venue.venueName,
      venueAddress: venue.venueAddress,
    },
  }));
}

interface CardOutcome {
  records: FetchedRecord[];
  skipped: number;
}

async function fetchCardOutcome(card: MilwaukeeRepShowCard): Promise<CardOutcome> {
  let detailHtml: string;
  try {
    detailHtml = await fetchText(card.detailUrl, `Milwaukee Rep detail ${card.detailUrl}`);
  } catch {
    console.warn(`Milwaukee Rep detail fetch failed, skipping: "${card.title}" ${card.detailUrl}`);
    return { records: [], skipped: 1 };
  }

  const range = parseMilwaukeeRepDetailRange(detailHtml);
  if (!range) {
    console.warn(`Milwaukee Rep detail page had no parseable date range, skipping: "${card.title}" ${card.detailUrl}`);
    return { records: [], skipped: 1 };
  }

  const venue = resolveVenue(card.theaterId, detailHtml);
  if (!venue) {
    console.warn(
      `Milwaukee Rep unknown data-theater "${card.theaterId}" with no matching venue text, skipping: "${card.title}" ${card.detailUrl}`,
    );
    return { records: [], skipped: 1 };
  }

  const days = expandDayRange(range.start, range.end, MILWAUKEE_REP_MAX_RANGE_DAYS);
  if (days.length === 0) {
    console.warn(`Milwaukee Rep detail range was empty or reversed, skipping: "${card.title}" ${card.detailUrl}`);
    return { records: [], skipped: 1 };
  }

  const fullSpan = inclusiveDaySpan(range.start, range.end);
  if (fullSpan > MILWAUKEE_REP_MAX_RANGE_DAYS) {
    console.warn(
      `Milwaukee Rep run truncated: "${card.title}" full range ${formatDayDate(range.start)} to ${formatDayDate(range.end)} ` +
        `(${fullSpan} days) clamped to ${MILWAUKEE_REP_MAX_RANGE_DAYS} days`,
    );
  }

  return { records: dayInstanceRecords(card, venue, days), skipped: 0 };
}

export async function crawlMilwaukeeRep(
  config: MilwaukeeRepConfig,
  sleepFn: SleepFn = defaultSleep,
): Promise<FetchOutcome> {
  const listingHtml = await fetchText(config.listingUrl, `Milwaukee Rep listing ${config.listingUrl}`);
  const { cards, rawCardCount } = parseMilwaukeeRepListing(listingHtml, config.listingUrl);

  const outcomes = await mapWithDelay(cards, DETAIL_DELAY_MS, fetchCardOutcome, sleepFn);
  const records = dedupeDayRecords(outcomes.flatMap((outcome) => outcome.records));
  // Cards whose own attributes failed to parse (missing id/theater/title/href)
  // count toward skipped too, alongside each per-card detail-crawl skip.
  const unparseableCardCount = rawCardCount - cards.length;
  const parseSkipped = outcomes.reduce((sum, outcome) => sum + outcome.skipped, 0) + unparseableCardCount;

  // The listing rendered real show cards but nothing survived detail-crawl
  // and parsing — a dead template or selector rot, never reported as a
  // healthy empty run. A genuinely empty season page (rawCardCount === 0)
  // is a legitimately quiet result and returns quietly instead.
  if (rawCardCount > 0 && records.length === 0) {
    throw new Error(
      `Milwaukee Rep listing ${config.listingUrl} had ${rawCardCount} show card(s) but yielded zero events — likely parser rot`,
    );
  }

  return { records, parseSkipped };
}
