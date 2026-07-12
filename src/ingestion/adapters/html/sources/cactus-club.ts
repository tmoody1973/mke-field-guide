// Cactus Club WordPress events-grid parser (cactusclubmilwaukee.com/events).
//
// The venue's WordPress theme renders one `.eventEntryInner` card per show,
// combining a text date ("Sat 07/18/26") and a separate text time
// ("1:00PM") — Chicago wall-clock terms, not an ISO datetime attribute — so
// unlike the epoch-ms Squarespace collections, this parser routes through
// the chicago-time helpers to produce an absolute UTC instant.
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { chicagoWallTimeToIso } from '@/lib/chicago-time';
import { resolveUrl } from '../../helpers';
import type { FetchedRecord } from '../../types';
import type { SelectorParser } from './index';

const VENUE_NAME = 'Cactus Club';
const VENUE_ADDRESS = '2496 S Wentworth Ave, Milwaukee, WI';

const DATE_RE = /(\d{2})\/(\d{2})\/(\d{2})/;
const TIME_RE = /(\d{1,2}):(\d{2})\s*(AM|PM)/i;
const BACKGROUND_IMAGE_RE = /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i;

type CardFields = {
  href: string;
  title: string;
  dateText: string;
  timeText: string;
  admittance?: string;
  imageUrl?: string;
};

function to24Hour(hour12: number, meridiem: string): number {
  const isPm = meridiem.toUpperCase() === 'PM';
  if (hour12 === 12) return isPm ? 12 : 0;
  return isPm ? hour12 + 12 : hour12;
}

/** Reads the card's linking anchor (`.eventThumb a`) plus its adjoining date/time/admittance text. */
function cardFields($: cheerio.CheerioAPI, el: AnyNode): CardFields | null {
  const anchor = $(el).find('.eventThumb a').first();
  const href = anchor.attr('href');
  const title = anchor.attr('title');
  if (!href || !title) return null;

  const dateText = $(el).find('.eventDate').first().text().trim();
  const timeText = $(el).find('.eventTime').first().text().trim();
  const admittance = $(el).find('.admittance').first().text().trim() || undefined;
  const imageMatch = BACKGROUND_IMAGE_RE.exec(anchor.attr('style') ?? '');
  const imageUrl = imageMatch?.[1];

  return { href, title, dateText, timeText, admittance, imageUrl };
}

/** Last non-empty path segment of an absolute URL, used as the stable sourceEventId slug. */
function urlSlug(url: string): string | undefined {
  const segments = new URL(url).pathname.split('/').filter((segment) => segment !== '');
  return segments.at(-1);
}

function cardRecord(fields: CardFields, listingUrl: string): FetchedRecord | null {
  const url = resolveUrl(fields.href, listingUrl);
  if (!url) return null;
  const slug = urlSlug(url);
  if (!slug) return null;

  const dateMatch = DATE_RE.exec(fields.dateText);
  if (!dateMatch) return null;
  const timeMatch = TIME_RE.exec(fields.timeText);
  if (!timeMatch) return null;

  const [, monthText, dayText, twoDigitYearText] = dateMatch;
  const [, hour12Text, minuteText, meridiem] = timeMatch;
  const startDate = chicagoWallTimeToIso(
    2000 + Number(twoDigitYearText),
    Number(monthText),
    Number(dayText),
    to24Hour(Number(hour12Text), meridiem),
    Number(minuteText),
  );

  return {
    sourceEventId: slug,
    sourceUrl: url,
    payload: {
      id: slug,
      name: fields.title,
      url,
      startDate,
      venueName: VENUE_NAME,
      venueAddress: VENUE_ADDRESS,
      imageUrl: fields.imageUrl,
      description: fields.admittance,
    },
  };
}

export function parseCactusClubHtml(
  html: string,
  listingUrl: string,
): { records: FetchedRecord[]; skipped: number } {
  const $ = cheerio.load(html);
  const records: FetchedRecord[] = [];
  let skipped = 0;
  $('.eventEntryInner').each((_, el) => {
    const fields = cardFields($, el);
    const record = fields ? cardRecord(fields, listingUrl) : null;
    if (!record) {
      skipped += 1;
      return;
    }
    records.push(record);
  });
  return { records, skipped };
}

export const cactusClubParser: SelectorParser = (html, listingUrl) => parseCactusClubHtml(html, listingUrl);
