import { and, asc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/db/types';
import { googleCalendarUrl } from '@/lib/calendar-links';
import { chicagoWeekMonday } from '@/lib/display';
import { SITE_URL } from '@/lib/site';
import { searchEvents } from '@/search/hybrid';
import { parseSearchInput, presetWindow } from '@/search/query-understanding';

/** One upcoming event as other apps (Radio Commons on Alexa+) see it: only what the public site already shows. */
export interface PublicEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  venue: { name: string; address: string | null; lat: number | null; lng: number | null; neighborhood: string | null } | null;
  category: string | null;
  isFree: boolean | null;
  priceMin: number | null;
  priceMax: number | null;
  imageUrl: string | null;
  url: string;
  calendarUrl: string;
  isStationEvent: boolean;
  pick: { curator: string; role: string | null; blurb: string } | null;
  distanceMiles?: number;
}

export type When = 'tonight' | 'today' | 'this-weekend' | 'this-week';
export const MAX_RESULTS = 10;

export interface PublicEventsOptions {
  now: Date;
  q?: string;
  when?: When;
  near?: { lat: number; lng: number };
  radiusMiles?: number;
  free?: boolean;
  ids?: string[];
  limit?: number;
}

const DAY = 86_400_000;
const EARTH_MILES = 3958.8;

/** Great-circle distance in miles. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(h));
}

const num = (value: string | null) => (value === null ? null : Number(value));

/**
 * Upcoming, scheduled events (never cancelled, postponed or past), one row per event at its next date in the window.
 * Words go through the site's own hybrid search; "near" uses the venue's pin, else its venue-registry pin.
 */
export async function publicEvents(db: Db, opts: PublicEventsOptions): Promise<PublicEvent[]> {
  const limit = Math.min(opts.limit ?? MAX_RESULTS, MAX_RESULTS);
  // Like the site's search box: "jazz tonight" or "free jazz" become a window and a free filter, not search words.
  const parsed = opts.q ? parseSearchInput(opts.q, opts.now) : null;
  const free = opts.free || parsed?.free || false;
  // Windows from presetWindow never start before now; with no window: the next week (by id: the next two months).
  const window = opts.when
    ? presetWindow(opts.when, opts.now)
    : parsed?.window ?? { start: opts.now, end: new Date(opts.now.getTime() + (opts.ids ? 60 : 7) * DAY) };

  let ranked: string[] | null = null;
  if (parsed?.text) {
    const hits = await searchEvents(db, { text: parsed.text, filters: { window, ...(free ? { free: true } : {}) }, limit: 50 });
    ranked = hits.map((hit) => hit.eventId);
    if (ranked.length === 0) return [];
  }
  const only = ranked ?? opts.ids;
  if (only && only.length === 0) return [];

  const conditions: SQL[] = [
    eq(schema.eventInstances.status, 'scheduled'),
    eq(schema.events.status, 'scheduled'),
    gte(schema.eventInstances.startAt, window.start),
    lt(schema.eventInstances.startAt, window.end),
  ];
  if (free) conditions.push(eq(schema.events.isFree, true));
  if (only) conditions.push(inArray(schema.events.id, only));

  const rows = await db
    .select({
      id: schema.events.id, slug: schema.events.slug, title: schema.events.title, summary: schema.events.summary,
      category: schema.events.category, imageUrl: schema.events.imageUrl, isFree: schema.events.isFree,
      priceMin: schema.events.priceMin, priceMax: schema.events.priceMax, isStationEvent: schema.events.isStationEvent,
      startAt: schema.eventInstances.startAt, endAt: schema.eventInstances.endAt,
      venueName: schema.venues.name, venueAddress: schema.venues.address, neighborhood: schema.venues.neighborhood,
      lat: schema.venues.lat, lng: schema.venues.lng, registryLat: schema.venueRegistry.lat, registryLon: schema.venueRegistry.lon,
    })
    .from(schema.eventInstances)
    .innerJoin(schema.events, eq(schema.eventInstances.eventId, schema.events.id))
    .leftJoin(schema.venues, eq(schema.events.venueId, schema.venues.id))
    .leftJoin(schema.venueRegistry, eq(schema.venueRegistry.id, schema.venues.registryId))
    .where(and(...conditions))
    .orderBy(asc(schema.eventInstances.startAt))
    .limit(500); // ponytail: a week of Milwaukee events is ~200 instances; page if the guide grows past this

  // One row per event: its next date in the window (rows are in start order).
  const seen = new Set<string>();
  let events = rows.filter((row) => !seen.has(row.id) && seen.add(row.id)).map((row) => {
    const own = row.lat !== null && row.lng !== null;
    const lat = own ? num(row.lat) : num(row.registryLat);
    const lng = own ? num(row.lng) : num(row.registryLon);
    return { row, lat, lng, distanceMiles: undefined as number | undefined };
  });

  if (opts.near) {
    const radius = opts.radiusMiles ?? 1;
    events = events
      .filter((e) => e.lat !== null && e.lng !== null)
      .map((e) => ({ ...e, distanceMiles: milesBetween(opts.near!, { lat: e.lat!, lng: e.lng! }) }))
      .filter((e) => e.distanceMiles! <= radius)
      .sort((a, b) => a.distanceMiles! - b.distanceMiles! || a.row.startAt.getTime() - b.row.startAt.getTime());
  } else if (ranked) {
    const order = new Map(ranked.map((id, i) => [id, i]));
    events.sort((a, b) => order.get(a.row.id)! - order.get(b.row.id)!);
  }
  events = events.slice(0, limit);

  const picks = events.length
    ? await db.select().from(schema.staffPicks).where(and(
      inArray(schema.staffPicks.eventId, events.map((e) => e.row.id)),
      eq(schema.staffPicks.weekOf, chicagoWeekMonday(opts.now)),
    ))
    : [];
  const pickBy = new Map(picks.map((p) => [p.eventId, p]));

  return events.map(({ row, lat, lng, distanceMiles }) => {
    const url = `${SITE_URL}/events/${row.slug}`;
    const pick = pickBy.get(row.id);
    return {
      id: row.id,
      title: row.title,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt ? row.endAt.toISOString() : null,
      venue: row.venueName === null ? null : { name: row.venueName, address: row.venueAddress, lat, lng, neighborhood: row.neighborhood },
      category: row.category,
      isFree: row.isFree,
      priceMin: num(row.priceMin),
      priceMax: num(row.priceMax),
      imageUrl: row.imageUrl,
      url,
      calendarUrl: googleCalendarUrl({
        slug: row.slug, title: row.title, description: row.summary, venueName: row.venueName, venueAddress: row.venueAddress,
        startAt: row.startAt, endAt: row.endAt, url,
      }),
      isStationEvent: row.isStationEvent,
      pick: pick ? { curator: pick.curatorName, role: pick.curatorRole, blurb: pick.blurb } : null,
      ...(distanceMiles === undefined ? {} : { distanceMiles: Math.round(distanceMiles * 10) / 10 }),
    };
  });
}

/** "What is Radio Milwaukee recommending?": this week's staff picks (curator's words), topped up with station events to three. */
export async function publicPicks(db: Db, now: Date): Promise<PublicEvent[]> {
  const picks = await db.select({ eventId: schema.staffPicks.eventId }).from(schema.staffPicks)
    .where(eq(schema.staffPicks.weekOf, chicagoWeekMonday(now)))
    .orderBy(asc(schema.staffPicks.sortOrder));
  const picked = picks.length ? await publicEvents(db, { now, ids: picks.map((p) => p.eventId) }) : [];
  const order = new Map(picks.map((p, i) => [p.eventId, i]));
  picked.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  if (picked.length >= 3) return picked.slice(0, 3);
  // Soonest first and scheduled only, so one weekly series can't crowd out the next station show.
  const station = await db.select({ id: schema.events.id }).from(schema.events)
    .innerJoin(schema.eventInstances, eq(schema.eventInstances.eventId, schema.events.id))
    .where(and(
      eq(schema.events.isStationEvent, true), eq(schema.events.status, 'scheduled'),
      eq(schema.eventInstances.status, 'scheduled'), gte(schema.eventInstances.startAt, now),
    ))
    .orderBy(asc(schema.eventInstances.startAt))
    .limit(50);
  const more = [...new Set(station.map((s) => s.id))].filter((id) => !order.has(id));
  const extra = more.length ? await publicEvents(db, { now, ids: more }) : [];
  extra.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return [...picked, ...extra].slice(0, 3);
}
