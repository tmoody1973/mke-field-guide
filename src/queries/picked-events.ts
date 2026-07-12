import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/db/types';
import { chicagoWeekMonday } from '@/lib/display';

/** Staff-picked event ids for the CURRENT Chicago week (mirrors picksForWeek's weekOf semantics). */
export async function loadPickedEventIds(db: Db, now: Date): Promise<Set<string>> {
  const weekOf = chicagoWeekMonday(now);
  const rows = await db
    .select({ eventId: schema.staffPicks.eventId })
    .from(schema.staffPicks)
    .where(eq(schema.staffPicks.weekOf, weekOf));
  return new Set(rows.map((row) => row.eventId));
}
