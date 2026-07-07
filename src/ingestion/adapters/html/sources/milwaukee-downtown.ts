// Milwaukee Downtown (BID #21) signature-events page parser.
//
// The listing is a static "Signature Events" grid (Avada/Fusion builder cards),
// not an events calendar — no JSON-LD Event nodes and no ical feed (confirmed:
// `?ical=1` returns the normal page, not VCALENDAR; `tribe-events` CSS classes
// found in the fixture are unused Avada theme boilerplate, not an active
// The Events Calendar plugin — see task-9-report.md).
//
// Each card gives a title, a lead sentence describing timing, and prose. Timing
// falls into three buckets:
//   - explicit single date ("October 24, 2026.") -> one day-record.
//   - explicit date range, same or cross month/year ("August 17 – 21, 2026.",
//     "November 19, 2026 – January 1, 2027.") -> one day-record per day
//     (instance modeling per Phase 2b Task 7 controller ruling: day-records
//     share one sourceEventId, the card's detail URL).
//   - vague/relative timing ("Now through August 26, 2026." + "each week";
//     "Returning May 2027.") -> NOT enumerable from the page text (no start
//     date, or no day-of-month at all). These cards are skipped rather than
//     guessed — same treatment as milwaukee-world-festival's yearless cards.
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { FetchedRecord } from '../../types';
import { chicagoWallTimeToIso } from '../chicago-time';
import type { SelectorParser } from './index';

const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};
const MONTH_ALT = Object.keys(MONTHS).join('|');
const CROSS_RANGE_RE = new RegExp(
  `^(${MONTH_ALT})\\s+(\\d{1,2}),\\s*(\\d{4})\\s*[–-]\\s*(${MONTH_ALT})\\s+(\\d{1,2}),\\s*(\\d{4})`,
);
const SAME_MONTH_RANGE_RE = new RegExp(`^(${MONTH_ALT})\\s+(\\d{1,2})\\s*[–-]\\s*(\\d{1,2}),\\s*(\\d{4})`);
const SINGLE_DATE_RE = new RegExp(`^(${MONTH_ALT})\\s+(\\d{1,2}),\\s*(\\d{4})`);
/** Safety cap so a misparsed range cannot fan out into hundreds of instances. */
const MAX_RANGE_DAYS = 60;

type DayDate = { year: number; month: number; day: number };

function expandRange(y1: number, m1: number, d1: number, y2: number, m2: number, d2: number): DayDate[] {
  const start = Date.UTC(y1, m1 - 1, d1);
  const end = Date.UTC(y2, m2 - 1, d2);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const days: DayDate[] = [];
  for (let t = start; t <= end && days.length < MAX_RANGE_DAYS; t += 86_400_000) {
    const d = new Date(t);
    days.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
  }
  return days;
}

/** Every day-occurrence implied by the card's lead date sentence; [] when vague/unparseable. */
function extractDays(dateText: string): DayDate[] {
  if (/^(Returning|Now through)\b/i.test(dateText)) return [];
  const cross = CROSS_RANGE_RE.exec(dateText);
  if (cross) {
    const [, m1, d1, y1, m2, d2, y2] = cross;
    return expandRange(Number(y1), MONTHS[m1], Number(d1), Number(y2), MONTHS[m2], Number(d2));
  }
  const sameMonth = SAME_MONTH_RANGE_RE.exec(dateText);
  if (sameMonth) {
    const [, month, d1, d2, year] = sameMonth;
    return expandRange(Number(year), MONTHS[month], Number(d1), Number(year), MONTHS[month], Number(d2));
  }
  const single = SINGLE_DATE_RE.exec(dateText);
  if (single) {
    const [, month, day, year] = single;
    const day1 = Number(day);
    return expandRange(Number(year), MONTHS[month], day1, Number(year), MONTHS[month], day1);
  }
  return [];
}

/** Splits the card's paragraph into its lead date sentence and the remaining prose. */
function splitDateAndDescription(text: string): { dateText: string; description?: string } {
  const idx = text.indexOf('. ');
  if (idx === -1) return { dateText: text.trim() };
  return { dateText: text.slice(0, idx + 1).trim(), description: text.slice(idx + 2).trim() || undefined };
}

type CardFields = {
  url: string;
  name: string;
  description?: string;
  imageUrl?: string;
  dateText: string;
};

function cardFields($: cheerio.CheerioAPI, el: AnyNode, baseUrl: string): CardFields | null {
  const card = $(el).closest('[class*="fusion-builder-column-"]');
  const name = $(el).text().trim();
  const href = card.find('a[href]').first().attr('href');
  if (!name || !href) return null;
  const url = new URL(href, baseUrl).toString();
  const imgSrc = card.find('img').first().attr('src');
  const text = card.find('.fusion-text').first().text().replace(/\s+/g, ' ').trim();
  const { dateText, description } = splitDateAndDescription(text);
  return { url, name, description, dateText, imageUrl: imgSrc ? new URL(imgSrc, baseUrl).toString() : undefined };
}

function dayRecord(card: CardFields, day: DayDate, listingUrl: string): FetchedRecord {
  const startDate = chicagoWallTimeToIso(day.year, day.month, day.day, 0, 0);
  const { url, name, description, imageUrl } = card;
  return {
    sourceEventId: url,
    sourceUrl: listingUrl,
    payload: { id: url, url, name, description, imageUrl, startDate },
  };
}

export function parseMilwaukeeDowntownHtml(html: string, listingUrl: string): FetchedRecord[] {
  const $ = cheerio.load(html);
  const records: FetchedRecord[] = [];
  $('h4.fusion-title-heading').each((_, el) => {
    const card = cardFields($, el, listingUrl);
    if (!card) return;
    for (const day of extractDays(card.dateText)) records.push(dayRecord(card, day, listingUrl));
  });
  const seen = new Set<string>();
  return records.filter((r) => {
    const key = `${r.sourceEventId}|${(r.payload as { startDate: string }).startDate}`;
    return seen.has(key) ? false : seen.add(key);
  });
}

export const milwaukeeDowntownParser: SelectorParser = (html, baseUrl) =>
  parseMilwaukeeDowntownHtml(html, baseUrl);
