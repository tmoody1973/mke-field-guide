import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { FetchedRecord } from '../../types';
import type { SelectorParser } from './index';

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const EXPLICIT_TIME_RE =
  /(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)\s*on\s*\w+,\s*(\d{1,2})\s+(\w+)\s+(\d{4})/i;
const RECURRING_TIME_RE = /(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i;
const DATE_FIELD_RE = /^(\w+)\s+(\d{1,2})/;

function parseClockTime(text: string): { hour: number; minute: number } | undefined {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(text.trim());
  if (!m) return undefined;
  const [, hh, mm, ampm] = m;
  let hour = Number(hh) % 12;
  if (ampm.toUpperCase() === 'PM') hour += 12;
  return { hour, minute: Number(mm) };
}

/** Offset (minutes) of America/Chicago from UTC at the given instant, negative = behind UTC. */
function chicagoOffsetMinutes(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(utcMs)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return (asUtc - utcMs) / 60_000;
}

/** Converts a naive America/Chicago wall-clock time into a UTC ISO string. */
function chicagoWallTimeToIso(year: number, month: number, day: number, hour: number, minute: number): string {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetMin = chicagoOffsetMinutes(utcGuess);
  return new Date(utcGuess - offsetMin * 60_000).toISOString();
}

/** Resolves the year for a recurring event's "next occurrence" month/day relative to now. */
function resolveOccurrenceYear(month: number, day: number, now: Date): number {
  const year = now.getUTCFullYear();
  const candidateUtc = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(year, now.getUTCMonth(), now.getUTCDate());
  return candidateUtc < todayUtc ? year + 1 : year;
}

type OccurrenceTimes = { startDate: string; endDate: string } | undefined;

function explicitOccurrence(timeText: string): OccurrenceTimes {
  const m = EXPLICIT_TIME_RE.exec(timeText);
  if (!m) return undefined;
  const [, startStr, endStr, day, monthName, yearStr] = m;
  const month = MONTHS[monthName.slice(0, 3)];
  const start = parseClockTime(startStr);
  const end = parseClockTime(endStr);
  if (!month || !start || !end) return undefined;
  const year = Number(yearStr);
  return {
    startDate: chicagoWallTimeToIso(year, month, Number(day), start.hour, start.minute),
    endDate: chicagoWallTimeToIso(year, month, Number(day), end.hour, end.minute),
  };
}

function recurringOccurrence(timeText: string, dateFieldText: string, now: Date): OccurrenceTimes {
  const timeMatch = RECURRING_TIME_RE.exec(timeText);
  const dateMatch = DATE_FIELD_RE.exec(dateFieldText.trim());
  if (!timeMatch || !dateMatch) return undefined;
  const [, startStr, endStr] = timeMatch;
  const [, monthName, dayStr] = dateMatch;
  const month = MONTHS[monthName.slice(0, 3)];
  const start = parseClockTime(startStr);
  const end = parseClockTime(endStr);
  if (!month || !start || !end) return undefined;
  const day = Number(dayStr);
  const year = resolveOccurrenceYear(month, day, now);
  return {
    startDate: chicagoWallTimeToIso(year, month, day, start.hour, start.minute),
    endDate: chicagoWallTimeToIso(year, month, day, end.hour, end.minute),
  };
}

function priceIsFree(priceText: string): boolean | undefined {
  const trimmed = priceText.trim();
  if (trimmed.length === 0) return undefined;
  return /\bfree\b/i.test(trimmed) ? true : undefined;
}

function promoToRecord(
  $: cheerio.CheerioAPI,
  el: AnyNode,
  baseUrl: string,
  now: Date,
): FetchedRecord | null {
  const p = $(el);
  const name = p.find('.PromoEvent-title').text().trim();
  const href = p.find('.PromoEvent-link-link').attr('href');
  if (!name || !href) return null;
  const url = new URL(href, baseUrl).toString();
  const timeEl = p.find('.PromoEvent-time');
  const timeText = timeEl.text().replace(/\s+/g, ' ').trim();
  const isRecurring = timeEl.attr('data-recurring') !== undefined;
  const dateFieldText = p.find('.PromoEvent-date-date').contents().first().text();
  const occurrence = isRecurring
    ? recurringOccurrence(timeText, dateFieldText, now)
    : explicitOccurrence(timeText);
  if (!occurrence) return null;
  const venueName = p.find('.PromoEvent-venue').text().replace(/\s+/g, ' ').trim() || undefined;
  const description = p.find('.PromoEvent-description').text().replace(/\s+/g, ' ').trim() || undefined;
  const isFree = priceIsFree(p.find('.PromoEvent-price').text());
  const payload = {
    id: url,
    name,
    description,
    url,
    startDate: occurrence.startDate,
    endDate: occurrence.endDate,
    venueName,
    isFree,
  };
  return { sourceEventId: url, sourceUrl: url, payload };
}

/** Exported for tests so occurrence-year resolution can be pinned to a fixed instant. */
export function parseRadioMilwaukeeHtml(html: string, baseUrl: string, now: Date): FetchedRecord[] {
  const $ = cheerio.load(html);
  const records: FetchedRecord[] = [];
  $('ps-promo.PromoEvent').each((_, el) => {
    const record = promoToRecord($, el, baseUrl, now);
    if (record) records.push(record);
  });
  const seen = new Set<string>();
  return records.filter((r) => (seen.has(r.sourceEventId) ? false : seen.add(r.sourceEventId)));
}

export const radioMilwaukeeParser: SelectorParser = (html, baseUrl) =>
  parseRadioMilwaukeeHtml(html, baseUrl, new Date());
