import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { resolveUrl } from '../../helpers';
import type { FetchedRecord } from '../../types';
import { chicagoParts, chicagoWallTimeToIso, rollEndAtForward } from '@/lib/chicago-time';
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

/**
 * Resolves the year for a recurring event's "next occurrence" month/day relative to
 * "today" in America/Chicago (NOT UTC — from 7 PM to midnight Chicago time the UTC
 * date is already tomorrow, which would wrongly push a same-day occurrence a year out).
 */
export function resolveOccurrenceYear(month: number, day: number, now: Date): number {
  const today = chicagoParts(now.getTime());
  const year = Number(today.year);
  const candidate = Date.UTC(year, month - 1, day);
  const todayLocal = Date.UTC(year, Number(today.month) - 1, Number(today.day));
  return candidate < todayLocal ? year + 1 : year;
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
  const startDate = chicagoWallTimeToIso(year, month, Number(day), start.hour, start.minute);
  const endDate = rollEndAtForward(
    startDate,
    chicagoWallTimeToIso(year, month, Number(day), end.hour, end.minute),
  );
  return { startDate, endDate };
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
  const startDate = chicagoWallTimeToIso(year, month, day, start.hour, start.minute);
  const endDate = rollEndAtForward(
    startDate,
    chicagoWallTimeToIso(year, month, day, end.hour, end.minute),
  );
  return { startDate, endDate };
}

function priceIsFree(priceText: string): boolean | undefined {
  const trimmed = priceText.trim();
  if (trimmed.length === 0) return undefined;
  return /\bfree\b/i.test(trimmed) ? true : undefined;
}

type Promo = cheerio.Cheerio<AnyNode>;

/** Resolves the promo card's occurrence times from its time/date markup. */
function extractOccurrence(p: Promo, now: Date): OccurrenceTimes {
  const timeEl = p.find('.PromoEvent-time');
  const timeText = timeEl.text().replace(/\s+/g, ' ').trim();
  const isRecurring = timeEl.attr('data-recurring') !== undefined;
  const dateFieldText = p.find('.PromoEvent-date-date').contents().first().text();
  return isRecurring
    ? recurringOccurrence(timeText, dateFieldText, now)
    : explicitOccurrence(timeText);
}

type PromoFields = { venueName?: string; description?: string; isFree?: boolean };

/** Extracts the promo card's descriptive fields (venue, description, price). */
function extractFields(p: Promo): PromoFields {
  return {
    venueName: p.find('.PromoEvent-venue').text().replace(/\s+/g, ' ').trim() || undefined,
    description: p.find('.PromoEvent-description').text().replace(/\s+/g, ' ').trim() || undefined,
    isFree: priceIsFree(p.find('.PromoEvent-price').text()),
  };
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
  const url = resolveUrl(href, baseUrl);
  if (!url) return null;
  const occurrence = extractOccurrence(p, now);
  if (!occurrence) return null;
  const fields = extractFields(p);
  const payload = { id: url, name, url, ...occurrence, ...fields };
  return { sourceEventId: url, sourceUrl: url, payload };
}

/** Exported for tests so occurrence-year resolution can be pinned to a fixed instant. */
export function parseRadioMilwaukeeHtml(
  html: string,
  baseUrl: string,
  now: Date,
): { records: FetchedRecord[]; skipped: number } {
  const $ = cheerio.load(html);
  const records: FetchedRecord[] = [];
  let skipped = 0;
  $('ps-promo.PromoEvent').each((_, el) => {
    const record = promoToRecord($, el, baseUrl, now);
    if (!record) {
      skipped += 1;
      return;
    }
    records.push(record);
  });
  const seen = new Set<string>();
  const deduped = records.filter((r) => (seen.has(r.sourceEventId) ? false : seen.add(r.sourceEventId)));
  return { records: deduped, skipped };
}

export const radioMilwaukeeParser: SelectorParser = (html, baseUrl) =>
  parseRadioMilwaukeeHtml(html, baseUrl, new Date());
