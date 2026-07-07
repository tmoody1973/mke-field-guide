import { sql } from 'drizzle-orm';
import type { Db } from '@/ingestion/persist';

export const INSTANCE_RETENTION_DAYS = 90;
export const RAW_SUPERSEDED_RETENTION_DAYS = 30;

export interface RetentionResult {
  instancesDeleted: number;
  eventsDeleted: number;
  rawEventsDeleted: number;
}

/** DB hygiene: listings already hide passed events at query time; this reclaims the rows. */
export async function runRetention(db: Db, now: Date = new Date()): Promise<RetentionResult> {
  const instanceCutoff = new Date(now.getTime() - INSTANCE_RETENTION_DAYS * 86_400_000);
  const rawCutoff = new Date(now.getTime() - RAW_SUPERSEDED_RETENTION_DAYS * 86_400_000);
  const instances = await db.execute(sql`
    DELETE FROM event_instances WHERE start_at < ${instanceCutoff} RETURNING id
  `);
  const events = await db.execute(sql`
    DELETE FROM events e
    WHERE NOT EXISTS (SELECT 1 FROM event_instances i WHERE i.event_id = e.id)
    RETURNING id
  `);
  const raw = await db.execute(sql`
    DELETE FROM raw_events r
    WHERE r.extracted_at < ${rawCutoff}
      AND EXISTS (
        SELECT 1 FROM raw_events newer
        WHERE newer.source_id = r.source_id
          AND newer.source_event_id = r.source_event_id
          AND newer.extracted_at > r.extracted_at
      )
    RETURNING id
  `);
  return {
    instancesDeleted: instances.rows.length,
    eventsDeleted: events.rows.length,
    rawEventsDeleted: raw.rows.length,
  };
}
