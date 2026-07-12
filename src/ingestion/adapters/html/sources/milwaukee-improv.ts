// Milwaukee Improv — calendar-page crawl for detail URLs, then per-showtime
// Event JSON-LD on each detail page.
//
// The public calendar (https://improv.com/milwaukee/calendar/) is a
// server-rendered card list (`.cal-list a.item[href]`) with infinite-scroll
// pagination that degrades to a plain GET: `a#moreshowsbtn[href^="?start="]`
// is a real link the widget's own JS fetches via `$.get(url)` — no
// JS execution is required to follow it, a plain fetch returns the same
// markup. Multi-day runs (e.g. a 3-night stand) repeat their card across
// however many calendar pages their date range spans, so detail URLs are
// deduped before any detail page is ever fetched.
//
// Each detail page (two URL shapes: `/milwaukee/comic/<slug>/` and
// `/milwaukee/event/<slug>/<id>/`) embeds one `application/ld+json` block
// PER SHOWTIME alongside two venue/site blocks (`WebSite`, `ComedyClub`)
// that must be filtered out. Improv's own JSON-LD writer lowercases the
// showtime blocks' `@type` to `"event"` (every other JSON-LD source in this
// repo sees the schema.org-correct `"Event"`), so the type check here is
// case-insensitive on purpose — matching only on the literal string "event"
// (never a suffix match) so `"ComedyClub"`/`"WebSite"` never slip through.
//
// A showtime's own ticket id — not the calendar card's `id="ev…"`, which
// only labels the FIRST showtime of a multi-show run — is the last
// all-numeric path segment of `offers.url` (the ticketweb link). When
// `offers.url` is missing or unparseable, the id falls back to a sha256 of
// `detailUrl|startDate` (this repo's convention for id-less items — see
// naming.ts/venue-slug.ts), which is still stable across runs since both
// inputs are themselves stable.
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { fetchText, resolveUrl } from '../../helpers';
import type { FetchedRecord, FetchOutcome } from '../../types';
import { defaultSleep, mapWithDelay, type SleepFn } from '../pacing';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Calendar pages fetched per run: page 1 + up to 2 more `?start=` pages (~4-5 months out). */
export const IMPROV_MAX_PAGES = 3;
/** Detail pages fetched per run, after cross-page dedupe; overflow is dropped and counted. */
export const IMPROV_MAX_DETAIL_FETCHES = 40;
/** Pause between sequential detail-page fetches; polite pacing for a small venue site. */
const DETAIL_DELAY_MS = 250;

export const MILWAUKEE_IMPROV_VENUE_NAME = 'Milwaukee Improv';
export const MILWAUKEE_IMPROV_VENUE_ADDRESS = '20110 Lower Union Street, Brookfield, WI, 53045';

export const milwaukeeImprovConfigSchema = z.object({
  strategy: z.literal('calendar-jsonld'),
  sourceKey: z.string().min(1),
  calendarUrl: z.string().url(),
});

export type MilwaukeeImprovConfig = z.infer<typeof milwaukeeImprovConfigSchema>;

export interface ImprovCalendarPage {
  detailUrls: string[];
  nextPageUrl?: string;
  /** True when the page rendered at least one show card (vs. a genuinely empty calendar). */
  hasCards: boolean;
}

/** Enumerates detail-page URLs and the next `?start=` page from one calendar page. */
export function parseImprovCalendarPage(html: string, baseUrl: string): ImprovCalendarPage {
  const $ = cheerio.load(html);
  const items = $('.cal-list a.item[href]');
  const detailUrls: string[] = [];
  items.each((_, el) => {
    const resolved = resolveUrl($(el).attr('href'), baseUrl);
    if (resolved) detailUrls.push(resolved);
  });
  const nextPageUrl = resolveUrl($('a#moreshowsbtn[href^="?start="]').attr('href'), baseUrl);
  return { detailUrls, nextPageUrl, hasCards: items.length > 0 };
}

function isImprovEventNode(node: any): boolean {
  const raw = node?.['@type'];
  const types: unknown[] = Array.isArray(raw) ? raw : [raw];
  return types.some((t) => typeof t === 'string' && t.toLowerCase() === 'event');
}

function offersUrlFrom(offers: any): string | undefined {
  const first = Array.isArray(offers) ? offers[0] : offers;
  return typeof first?.url === 'string' ? first.url : undefined;
}

/** The showtime's own ticketweb id — the last all-numeric path segment of its ticket URL. */
function ticketwebEventId(offersUrl: string | undefined): string | undefined {
  if (!offersUrl) return undefined;
  try {
    const segments = new URL(offersUrl).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return last && /^\d+$/.test(last) ? last : undefined;
  } catch {
    return undefined;
  }
}

/** Stable fallback id when a showtime carries no usable ticket URL. */
function fallbackEventId(detailUrl: string, startDate: string): string {
  return createHash('sha256').update(`${detailUrl}|${startDate}`).digest('hex').slice(0, 16);
}

function venueFieldsFrom(location: any): { venueName?: string; venueAddress?: string } {
  if (!location || typeof location !== 'object') return {};
  const address = location.address;
  const parts =
    address && typeof address === 'object'
      ? [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode].filter(
          (part): part is string => typeof part === 'string' && part.length > 0,
        )
      : [];
  return {
    venueName: typeof location.name === 'string' ? location.name : undefined,
    venueAddress: parts.length > 0 ? parts.join(', ') : undefined,
  };
}

function imageUrlFrom(image: any): string | undefined {
  const first = Array.isArray(image) ? image[0] : image;
  if (typeof first === 'string') return first;
  return typeof first?.url === 'string' ? first.url : undefined;
}

/** Normalizes a JSON-LD offset-ISO startDate ("...-05:00") to the repo's stored UTC form. */
function toUtcIso(offsetIso: string): string | undefined {
  const parsedMs = Date.parse(offsetIso);
  return Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : undefined;
}

function eventNodeToRecord(node: any, detailUrl: string): FetchedRecord | null {
  const name = typeof node.name === 'string' ? node.name : undefined;
  const startDate = typeof node.startDate === 'string' ? toUtcIso(node.startDate) : undefined;
  if (!name || !startDate) return null;

  const offersUrl = offersUrlFrom(node.offers);
  const url = offersUrl ?? detailUrl;
  const id = ticketwebEventId(offersUrl) ?? fallbackEventId(detailUrl, node.startDate);
  const venue = venueFieldsFrom(node.location);

  return {
    sourceEventId: id,
    sourceUrl: url,
    payload: {
      id,
      name,
      description: typeof node.description === 'string' ? node.description : undefined,
      url,
      startDate,
      venueName: venue.venueName ?? MILWAUKEE_IMPROV_VENUE_NAME,
      venueAddress: venue.venueAddress ?? MILWAUKEE_IMPROV_VENUE_ADDRESS,
      imageUrl: imageUrlFrom(node.image),
    },
  };
}

/** Every `Event` (matched case-insensitively) JSON-LD block on one detail page — one per showtime. */
export function extractImprovShowtimes(html: string, detailUrl: string): FetchedRecord[] {
  const $ = cheerio.load(html);
  const records: FetchedRecord[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    if (!isImprovEventNode(parsed)) return;
    const record = eventNodeToRecord(parsed, detailUrl);
    if (record) records.push(record);
  });
  return records;
}

// A page recognized by the calendar as a show (it had a card) but whose
// detail page cannot be fetched, or yields zero showtime blocks once
// fetched, is "recognized but unextractable" — skipped and counted, same
// idiom as the sitemap-jsonld crawler. A single bad detail page never
// aborts the run.
async function fetchImprovDetail(url: string): Promise<{ records: FetchedRecord[]; skipped: number }> {
  let html: string;
  try {
    html = await fetchText(url, `Milwaukee Improv detail ${url}`);
  } catch {
    return { records: [], skipped: 1 };
  }
  const records = extractImprovShowtimes(html, url);
  if (records.length === 0) return { records: [], skipped: 1 };
  return { records, skipped: 0 };
}

/**
 * Cross-page dedupe (a recurring show or a multi-day run repeats the same
 * detail href across cards/pages) followed by the per-run detail-fetch cap;
 * overflow past the cap is dropped in stable, first-seen order and counted.
 */
export function selectImprovDetailUrls(
  detailUrls: string[],
  maxDetailFetches: number = IMPROV_MAX_DETAIL_FETCHES,
): { eligible: string[]; dropped: number } {
  const deduped = Array.from(new Set(detailUrls));
  return {
    eligible: deduped.slice(0, maxDetailFetches),
    dropped: Math.max(0, deduped.length - maxDetailFetches),
  };
}

export async function crawlMilwaukeeImprov(
  config: MilwaukeeImprovConfig,
  sleepFn: SleepFn = defaultSleep,
): Promise<FetchOutcome> {
  let currentUrl: string | undefined = config.calendarUrl;
  let pagesFetched = 0;
  let hasCardsOverall = false;
  let droppedPages = 0;
  const detailUrls: string[] = [];

  while (currentUrl !== undefined) {
    const html = await fetchText(currentUrl, `Milwaukee Improv calendar ${currentUrl}`);
    pagesFetched += 1;
    const page = parseImprovCalendarPage(html, currentUrl);
    if (page.hasCards) hasCardsOverall = true;
    detailUrls.push(...page.detailUrls);

    if (page.nextPageUrl && pagesFetched >= IMPROV_MAX_PAGES) {
      droppedPages += 1;
      break;
    }
    currentUrl = page.nextPageUrl;
  }

  const { eligible: eligibleDetailUrls, dropped: droppedDetails } = selectImprovDetailUrls(detailUrls);

  const detailPages = await mapWithDelay(eligibleDetailUrls, DETAIL_DELAY_MS, fetchImprovDetail, sleepFn);
  const records = detailPages.flatMap((page) => page.records);
  const detailSkipped = detailPages.reduce((sum, page) => sum + page.skipped, 0);
  const parseSkipped = droppedPages + droppedDetails + detailSkipped;

  // The calendar rendered at least one show card, but nothing survived the
  // detail crawl — a dead template or a selector that stopped matching, not
  // a legitimately quiet calendar. A calendar with zero cards to begin with
  // (`hasCardsOverall` stays false) is a real quiet result and never throws.
  if (hasCardsOverall && records.length === 0) {
    throw new Error(
      `Milwaukee Improv calendar ${config.calendarUrl} had show cards but yielded zero events — likely parser rot`,
    );
  }

  return { records, parseSkipped };
}
