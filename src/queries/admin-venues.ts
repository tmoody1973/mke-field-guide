import { asc, count, eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/db/types';

export interface AdminVenueRow {
  venueId: string;
  name: string;
  normalizedName: string;
  neighborhood: string | null;
  eventCount: number;
}

export async function adminVenueList(db: Db): Promise<AdminVenueRow[]> {
  const rows = await db
    .select({
      venueId: schema.venues.id,
      name: schema.venues.name,
      normalizedName: schema.venues.normalizedName,
      neighborhood: schema.venues.neighborhood,
      eventCount: count(schema.events.id),
    })
    .from(schema.venues)
    .leftJoin(schema.events, eq(schema.events.venueId, schema.venues.id))
    .groupBy(schema.venues.id)
    .orderBy(asc(schema.venues.name));
  return rows.map((row) => ({ ...row, eventCount: Number(row.eventCount) }));
}
