import { desc, eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/lib/card-data';

export interface AdminPickRow {
  id: string;
  eventId: string;
  curatorName: string;
  curatorRole: string | null;
  showUrl: string | null;
  blurb: string;
  weekOf: string;
  sortOrder: number;
  eventTitle: string;
  eventSlug: string;
}

export async function getPickById(db: Db, id: string): Promise<AdminPickRow | null> {
  const rows = await db
    .select({
      id: schema.staffPicks.id,
      eventId: schema.staffPicks.eventId,
      curatorName: schema.staffPicks.curatorName,
      curatorRole: schema.staffPicks.curatorRole,
      showUrl: schema.staffPicks.showUrl,
      blurb: schema.staffPicks.blurb,
      weekOf: schema.staffPicks.weekOf,
      sortOrder: schema.staffPicks.sortOrder,
      eventTitle: schema.events.title,
      eventSlug: schema.events.slug,
    })
    .from(schema.staffPicks)
    .innerJoin(schema.events, eq(schema.staffPicks.eventId, schema.events.id))
    .where(eq(schema.staffPicks.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function pickWeeks(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ weekOf: schema.staffPicks.weekOf })
    .from(schema.staffPicks)
    .orderBy(desc(schema.staffPicks.weekOf));
  return rows.map((row) => row.weekOf);
}
