// Milwaukee County Parks events calendar parser (county.milwaukee.gov).
//
// The listing renders one row per actual calendar occurrence (not a date-range
// card needing expansion): the detail link's `Occurrence` query param is the
// exact Chicago wall-clock start for that row, matching the adjoining "Time:"
// text's start. A recurring program (e.g. "Yarn Bomb", May 25 - Sept 7)
// reappears as one row per day it's shown on this page; rows share the same
// numeric `DataID`, which becomes the shared sourceEventId so they collapse
// into one event with multiple day-instances (see day-range.ts convention,
// same pattern as milwaukee-world-festival / milwaukee-downtown).
//
// Cloudflare's managed challenge blocks plain HTTP entirely across the whole
// county.milwaukee.gov zone (see README "Deferred sources"), so this source
// runs the 'firecrawl-selectors' strategy: Firecrawl renders the page, this
// parser then reads the resulting static markup. No JSON-LD is present, so
// 'firecrawl-jsonld' does not apply here.
//
// The widget paginates ("Showing page 1 of 30") through an internal AJAX call
// not exposed in the static markup, so only page 1 (the nearest ~3 days,
// sorted StartDate Ascending) is captured per run. A daily cadence is
// required — a weekly cadence would skip almost the entire rolling window
// between runs (see seed.ts for the cadence rationale).
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { chicagoWallTimeToIso, rollEndAtForward } from '@/lib/chicago-time';
import { splitLocationName } from '../../venue-location';
import { resolveUrl } from '../../helpers';
import type { FetchedRecord } from '../../types';
import { dedupeDayRecords } from '../day-range';
import type { SelectorParser } from './index';

const DETAIL_LINK_RE = /DataID=(\d+)&Occurrence=(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const END_TIME_RE = /-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i;

type OccurrenceStart = {
  dataId: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** Pulls the stable event id and exact occurrence start out of a detail link href. */
function parseOccurrence(href: string): OccurrenceStart | null {
  const match = DETAIL_LINK_RE.exec(href);
  if (!match) return null;
  const [, dataId, year, month, day, hour, minute] = match;
  return {
    dataId,
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
}

function to24Hour(hour12: number, meridiem: string): number {
  const isPm = meridiem.toUpperCase() === 'PM';
  if (hour12 === 12) return isPm ? 12 : 0;
  return isPm ? hour12 + 12 : hour12;
}

/** The "Time:" text's trailing end time on the occurrence's day; undefined for a single time (no range). */
function endDateFor(occurrence: OccurrenceStart, timeText: string, startIso: string): string | undefined {
  const match = END_TIME_RE.exec(timeText);
  if (!match) return undefined;
  const [, hour12, minute, meridiem] = match;
  const hour24 = to24Hour(Number(hour12), meridiem);
  const endIso = chicagoWallTimeToIso(occurrence.year, occurrence.month, occurrence.day, hour24, Number(minute));
  return rollEndAtForward(startIso, endIso);
}

/** Splits "Venue Name, street, city, state zip" on its first comma. Applies dash-address rule to the name. */
function splitVenue(locationText: string): { venueName?: string; venueAddress?: string } {
  const commaIndex = locationText.indexOf(',');
  if (commaIndex === -1) return { venueName: splitLocationName(locationText) || undefined };
  return {
    venueName: splitLocationName(locationText) || undefined,
    venueAddress: locationText.slice(commaIndex + 1).trim(),
  };
}

type ItemFields = {
  href: string;
  name: string;
  description?: string;
  locationText: string;
  timeText: string;
};

function itemFields($: cheerio.CheerioAPI, el: AnyNode): ItemFields | null {
  const link = $(el).find('a.dataDetailLink').first();
  const href = link.attr('href');
  const name = link.text().trim();
  if (!href || !name) return null;
  const timeText = $(el).find('.dateTime.Time .value').first().text().trim();
  const locationText = $(el).find('.location.Location .value').first().text().trim();
  const description = $(el).find('.description').first().text().trim() || undefined;
  return { href, name, description, locationText, timeText };
}

function itemRecord(item: ItemFields, listingUrl: string): FetchedRecord | null {
  const occurrence = parseOccurrence(item.href);
  if (!occurrence) return null;
  const startDate = chicagoWallTimeToIso(
    occurrence.year, occurrence.month, occurrence.day, occurrence.hour, occurrence.minute,
  );
  const endDate = endDateFor(occurrence, item.timeText, startDate);
  const { venueName, venueAddress } = splitVenue(item.locationText);
  const url = resolveUrl(item.href, listingUrl);
  return {
    sourceEventId: occurrence.dataId,
    sourceUrl: url,
    payload: {
      id: occurrence.dataId, name: item.name, description: item.description,
      url, startDate, endDate, venueName, venueAddress,
    },
  };
}

export function parseCountyParksHtml(
  html: string,
  listingUrl: string,
): { records: FetchedRecord[]; skipped: number } {
  const $ = cheerio.load(html);
  const records: FetchedRecord[] = [];
  let skipped = 0;
  $('.DataListing .items .item').each((_, el) => {
    const fields = itemFields($, el);
    const record = fields ? itemRecord(fields, listingUrl) : null;
    if (!record) {
      skipped += 1;
      return;
    }
    records.push(record);
  });
  return { records: dedupeDayRecords(records), skipped };
}

export const countyParksParser: SelectorParser = (html, baseUrl) => parseCountyParksHtml(html, baseUrl);
