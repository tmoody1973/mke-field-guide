// NOTE: source currently unseeded — redundant with ticketmaster-milwaukee coverage
// of the same six venues (which carries accurate showtimes). startAt here is
// date-only (midnight-Chicago placeholder) pending a detail-page crawl, since the
// listing page omits time-of-day. Parser + tests kept revivable for non-ticketed
// Pabst events. See .superpowers/sdd/task-5-report.md.
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { FetchedRecord } from '../../types';
import { chicagoWallTimeToIso } from '../chicago-time';
import type { SelectorParser } from './index';

const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

// Listing cards only expose a calendar date (e.g. "July  7 2026") — no time-of-day.
// Detail pages carry an explicit "Event Starts" time, but crawling them is out of
// scope for a listing-page selector parser (see task report for the assumption).
const DATE_RE = /^(\w+)\s+(\d{1,2})\s+(\d{4})$/;

/** Parses the card's "aria-label" date (e.g. "July  7 2026") into a midnight-Chicago ISO instant. */
function parseCardDate(ariaLabel: string): string | undefined {
  const m = DATE_RE.exec(ariaLabel.trim().replace(/\s+/g, ' '));
  if (!m) return undefined;
  const [, monthName, dayStr, yearStr] = m;
  const month = MONTHS[monthName];
  if (!month) return undefined;
  return chicagoWallTimeToIso(Number(yearStr), month, Number(dayStr), 0, 0);
}

function statusFromDateText(text: string): string | undefined {
  const t = text.toLowerCase();
  if (t.includes('cancel')) return 'cancelled';
  if (t.includes('postpone') || t.includes('reschedul')) return 'postponed';
  return undefined;
}

type Card = cheerio.Cheerio<AnyNode>;

function cardToRecord($: cheerio.CheerioAPI, el: AnyNode, baseUrl: string): FetchedRecord | null {
  const card: Card = $(el);
  const link = card.find('h3.title a').first();
  const name = link.text().trim();
  const href = link.attr('href');
  if (!name || !href) return null;
  const url = new URL(href, baseUrl).toString();
  const dateEl = card.find('.date').first();
  const startDate = parseCardDate(dateEl.attr('aria-label') ?? '');
  if (!startDate) return null;
  const status = statusFromDateText(dateEl.text());
  const venueName = card.find('.location').first().text().trim() || undefined;
  const description = card.find('h4.tagline').first().text().replace(/\s+/g, ' ').trim() || undefined;
  const imageUrl = card.find('.thumb img').first().attr('src') || undefined;
  const payload = { id: url, name, url, startDate, status, venueName, description, imageUrl };
  return { sourceEventId: url, sourceUrl: url, payload };
}

export function parsePabstTheaterGroupHtml(html: string, baseUrl: string): FetchedRecord[] {
  const $ = cheerio.load(html);
  const records: FetchedRecord[] = [];
  $('.eventItem').each((_, el) => {
    const record = cardToRecord($, el, baseUrl);
    if (record) records.push(record);
  });
  const seen = new Set<string>();
  return records.filter((r) => (seen.has(r.sourceEventId) ? false : seen.add(r.sourceEventId)));
}

export const pabstTheaterGroupParser: SelectorParser = (html, baseUrl) =>
  parsePabstTheaterGroupHtml(html, baseUrl);
