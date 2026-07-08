import { and, asc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { eventInstances, events, venues } from '@/db/schema';
import { presetWindow } from '@/search/query-understanding';
import { loadCardMeta, type Db } from '@/lib/card-data';
import { chicagoWeekMonday } from '@/lib/display';
import { picksForWeek, type PickWithEvent } from '@/queries/picks';
import type { CardItem } from '@/app/events/day-list';

const MODULE_LIMIT = 6;

async function windowItems(db: Db, window: { start: Date; end: Date }, limit: number): Promise<CardItem[]> {
  const instances = await db.query.eventInstances.findMany({
    where: and(gte(eventInstances.startAt, window.start), lt(eventInstances.startAt, window.end)),
    orderBy: [asc(eventInstances.startAt)],
    limit,
    with: { event: true },
  });
  const metaById = await loadCardMeta(db, [...new Set(instances.map((instance) => instance.eventId))]);
  return instances.flatMap((instance) => {
    const meta = metaById.get(instance.eventId);
    return meta ? [{ meta, startAt: instance.startAt }] : [];
  });
}

async function stationItems(db: Db, now: Date, limit: number): Promise<CardItem[]> {
  const rows = await db
    .select({ eventId: eventInstances.eventId, startAt: sql<Date>`min(${eventInstances.startAt})`.as('next_start') })
    .from(eventInstances)
    .innerJoin(events, eq(eventInstances.eventId, events.id))
    .where(and(gte(eventInstances.startAt, now), eq(events.isStationEvent, true)))
    .groupBy(eventInstances.eventId)
    .orderBy(sql`next_start ASC`)
    .limit(limit);
  const metaById = await loadCardMeta(db, rows.map((row) => row.eventId));
  return rows.flatMap((row) => {
    const meta = metaById.get(row.eventId);
    return meta ? [{ meta, startAt: new Date(row.startAt) }] : [];
  });
}

export interface NeighborhoodCount {
  name: string;
  count: number;
}

async function neighborhoodCounts(db: Db, now: Date): Promise<NeighborhoodCount[]> {
  const rows = await db
    .select({ name: venues.neighborhood, count: sql<number>`count(distinct ${eventInstances.eventId})` })
    .from(eventInstances)
    .innerJoin(events, eq(eventInstances.eventId, events.id))
    .innerJoin(venues, eq(events.venueId, venues.id))
    .where(and(gte(eventInstances.startAt, now), isNotNull(venues.neighborhood)))
    .groupBy(venues.neighborhood);
  return rows.flatMap((row) => (row.name ? [{ name: row.name, count: Number(row.count) }] : []));
}

export interface HomeData {
  tonight: CardItem[];
  weekend: CardItem[];
  station: CardItem[];
  picks: PickWithEvent[];
  hoods: NeighborhoodCount[];
}

export async function homeData(db: Db, now: Date): Promise<HomeData> {
  const [tonight, weekend, station, picks, hoods] = await Promise.all([
    windowItems(db, presetWindow('tonight', now), MODULE_LIMIT),
    windowItems(db, presetWindow('this-weekend', now), MODULE_LIMIT + 2),
    stationItems(db, now, MODULE_LIMIT),
    picksForWeek(db, chicagoWeekMonday(now)),
    neighborhoodCounts(db, now),
  ]);
  return { tonight, weekend, station, picks, hoods };
}
