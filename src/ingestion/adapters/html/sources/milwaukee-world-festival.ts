// Milwaukee World Festival (Henry Maier Festival Park) calendar parser.
//
// Instance modeling (controller ruling, Phase 2b Task 7): one event per card;
// one FetchedRecord per DAY across all of the card's date ranges, all sharing
// one sourceEventId. The pipeline accumulates them as instances under a single
// event via the (eventId, startAt) unique index — ingest's idCounts sees the
// repeated id and keeps supersede off. Summerfest's card ("June 18-20,
// June 25-27, and July 2-4, 2026") = one event, nine day-instances.
//
// The listing has no time fields. A card whose date line or description states one range of
// hours ("from 9am - 2pm", "from 8:00 a.m. to 4:00 p.m.", "from Noon – 10pm")
// gets those hours on each of its days; otherwise the instance stays
// DATE-granularity: startDate is midnight America/Chicago and endDate is
// omitted (Summerfest and other all-day festivals).
//
// Cards have no on-site detail URLs (their fancybox hrefs point at gallery
// image assets), so ids use the stable name-based scheme
// `mwf:${normalizeName(title)}`. Cards whose date text lacks a 4-digit year
// are skipped at parse time. Past-dated cards are emitted normally — the
// public page filters startAt >= now.
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { normalizeName } from '@/ingestion/naming';
import type { FetchedRecord } from '../../types';
import { chicagoWallTimeToIso, rollEndAtForward } from '@/lib/chicago-time';
import { expandDayRange, dedupeDayRecords, type DayDate } from '../day-range';
import type { SelectorParser } from './index';

const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};
const MONTH_ALT = Object.keys(MONTHS).join('|');
// One fragment per match: "June 18-20", "June 23 - June 26", or "July 11".
const RANGE_RE = new RegExp(
  `(${MONTH_ALT})\\s+(\\d{1,2})(?:\\s*[-–]\\s*(?:(${MONTH_ALT})\\s+)?(\\d{1,2}))?`,
  'g',
);
const YEAR_RE = /\b(20\d{2})\b/;
const DATE_LINE_RE = new RegExp(`(${MONTH_ALT})\\s+\\d`);
/** Every event on this calendar takes place at the festival park. */
const VENUE_NAME = 'Henry Maier Festival Park';
/** Safety cap so a misparsed range cannot fan out into hundreds of instances. */
const MAX_RANGE_DAYS = 31;

type Clock = { hour: number; minute: number };
// "9am", "8:00 a.m.", "6:30 PM", "Noon", "midnight".
const CLOCK = String.raw`(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?)`;
const HOURS_RE = new RegExp(String.raw`\bfrom\s+${CLOCK}\s*(?:to|-|–|—)\s*${CLOCK}`, 'gi');

function toClock(word: string, hour?: string, minute?: string, meridiem?: string): Clock | undefined {
  const named = word.toLowerCase();
  if (named === 'noon') return { hour: 12, minute: 0 };
  if (named === 'midnight') return { hour: 0, minute: 0 };
  const h = Number(hour);
  const m = Number(minute ?? 0);
  if (!Number.isInteger(h) || h < 1 || h > 12 || m > 59) return undefined;
  return { hour: (h % 12) + (meridiem?.toLowerCase() === 'p' ? 12 : 0), minute: m };
}

/**
 * The hours a card's description states, when it states exactly one range. None, or two different ranges (whose
 * day would each belong to?), means no hours: the instance stays date-only.
 */
export function hoursFrom(description: string | undefined): { start: Clock; end: Clock } | undefined {
  if (!description) return undefined;
  const parsed = [...description.matchAll(HOURS_RE)].map(([, a, ah, am, ap, b, bh, bm, bp]) => ({ start: toClock(a, ah, am, ap), end: toClock(b, bh, bm, bp) }));
  if (parsed.some((r) => !r.start || !r.end)) return undefined;
  // The same hours said twice are one range; compare the times, not the wording.
  const ranges = new Map(parsed.map((r) => [JSON.stringify(r), r as { start: Clock; end: Clock }]));
  return ranges.size === 1 ? [...ranges.values()][0] : undefined;
}

/** Every day-occurrence in the card's date text; [] when no 4-digit year (card skipped). */
function extractDays(text: string): DayDate[] {
  const yearMatch = YEAR_RE.exec(text);
  if (!yearMatch) return [];
  const year = Number(yearMatch[1]);
  const days: DayDate[] = [];
  for (const m of text.matchAll(RANGE_RE)) {
    const [, month1, day1, month2, day2] = m;
    const m1 = MONTHS[month1];
    const m2 = month2 ? MONTHS[month2] : m1;
    days.push(
      ...expandDayRange(
        { year, month: m1, day: Number(day1) },
        { year, month: m2, day: Number(day2 ?? day1) },
        MAX_RANGE_DAYS,
      ),
    );
  }
  return days;
}

/** Card description from the thumbnail img's alt (an HTML blob: date <p> + prose <p>s). */
function descriptionFromAlt(alt: string | undefined): string | undefined {
  if (!alt) return undefined;
  const $ = cheerio.load(alt);
  const paragraphs: string[] = [];
  $('p').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const isDateLine = text.length <= 60 && DATE_LINE_RE.test(text);
    if (text && !isDateLine) paragraphs.push(text);
  });
  const joined = paragraphs.join(' ').trim();
  return joined || undefined;
}

/** The page declares <base href="https://www.milwaukeeworldfestival.com/"> — honor it. */
function resolveBase($: cheerio.CheerioAPI, listingUrl: string): string {
  const href = $('base[href]').attr('href');
  if (!href) return listingUrl;
  try {
    return new URL(href, listingUrl).toString();
  } catch {
    return listingUrl;
  }
}

type CardFields = { id: string; name: string; description?: string; imageUrl?: string };

function cardFields($: cheerio.CheerioAPI, el: AnyNode, base: string): CardFields | null {
  const anchor = $(el);
  const name = anchor.find('.overlay-img h3').first().text().replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const img = anchor.parent().children('img').first();
  const src = img.attr('src');
  return {
    id: `mwf:${normalizeName(name)}`,
    name,
    description: descriptionFromAlt(img.attr('alt')),
    imageUrl: src ? new URL(src, base).toString() : undefined,
  };
}

type Hours = ReturnType<typeof hoursFrom>;

function dayRecord(card: CardFields, day: DayDate, listingUrl: string, hours: Hours): FetchedRecord {
  const at = (clock: Clock) => chicagoWallTimeToIso(day.year, day.month, day.day, clock.hour, clock.minute);
  const startDate = at(hours?.start ?? { hour: 0, minute: 0 });
  // An end before the start ("from 6pm - 1am") runs past midnight into the next day.
  const endDate = hours ? rollEndAtForward(startDate, at(hours.end)) : undefined;
  return {
    sourceEventId: card.id,
    sourceUrl: listingUrl,
    payload: { ...card, startDate, ...(endDate ? { endDate } : {}), venueName: VENUE_NAME },
  };
}

export function parseMilwaukeeWorldFestivalHtml(
  html: string,
  listingUrl: string,
): { records: FetchedRecord[]; skipped: number } {
  const $ = cheerio.load(html);
  const base = resolveBase($, listingUrl);
  const records: FetchedRecord[] = [];
  let skipped = 0;
  $('a.fancybox').each((_, el) => {
    const card = cardFields($, el, base);
    if (!card) {
      skipped += 1;
      return;
    }
    const dateText = $(el).find('.overlay-img p').first().text().replace(/\s+/g, ' ').trim();
    const days = extractDays(dateText);
    if (days.length === 0) {
      skipped += 1;
      return;
    }
    // Hours sit in the date line ("October 10, 2026, from 9am - 2pm") or the description.
    const hours = hoursFrom([dateText, card.description].filter(Boolean).join(' '));
    for (const day of days) records.push(dayRecord(card, day, listingUrl, hours));
  });
  return { records: dedupeDayRecords(records), skipped };
}

export const milwaukeeWorldFestivalParser: SelectorParser = (html, baseUrl) =>
  parseMilwaukeeWorldFestivalHtml(html, baseUrl);
