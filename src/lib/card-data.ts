import { inArray } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';
import { events } from '@/db/schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

export interface EventCardMeta {
  eventId: string;
  slug: string;
  title: string;
  venueName: string | null;
  neighborhood: string | null;
  category: string | null;
  status: string;
  isFree: boolean | null;
  priceMin: string | null;
  priceMax: string | null;
  audienceTags: string[];
  isStationEvent: boolean;
}

function fetchRows(db: Db, eventIds: string[]) {
  return db.query.events.findMany({
    where: inArray(events.id, eventIds),
    with: { venue: true },
  });
}

type EventRowWithVenue = Awaited<ReturnType<typeof fetchRows>>[number];

/** One round trip: hydrates card fields for a set of event IDs (search hits or instance rows). */
export async function loadCardMeta(db: Db, eventIds: string[]): Promise<Map<string, EventCardMeta>> {
  if (eventIds.length === 0) return new Map();
  const rows = await fetchRows(db, eventIds);
  return new Map(rows.map((row) => [row.id, toMeta(row)]));
}

function toMeta(row: EventRowWithVenue): EventCardMeta {
  return {
    eventId: row.id,
    slug: row.slug,
    title: row.title,
    venueName: row.venue?.name ?? null,
    neighborhood: row.venue?.neighborhood ?? null,
    category: row.category,
    status: row.status,
    isFree: row.isFree,
    priceMin: row.priceMin,
    priceMax: row.priceMax,
    audienceTags: row.audienceTags ?? [],
    isStationEvent: row.isStationEvent,
  };
}
