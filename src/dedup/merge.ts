import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/ingestion/persist';
import type { ScoredPair } from './scoring';

/**
 * No transactions on the Neon HTTP driver — steps are ordered so a crash leaves
 * a recoverable state: links move first (provenance is never lost), instances
 * next, the duplicate event row is deleted only once it is empty, and the
 * cluster receipt is written last. A duplicate stranded mid-merge has no
 * instances and is swept by retention; the next dedup run re-examines the rest.
 */
export async function mergeEvents(
  db: Db,
  canonicalId: string,
  duplicateId: string,
  scored: ScoredPair,
  decidedBy: 'auto' | 'review',
): Promise<void> {
  const duplicate = await db.query.events.findFirst({ where: eq(schema.events.id, duplicateId) });
  if (!duplicate) return;
  await db
    .update(schema.eventSourceLinks)
    .set({ eventId: canonicalId, isCanonical: false })
    .where(eq(schema.eventSourceLinks.eventId, duplicateId));
  await moveInstances(db, canonicalId, duplicateId);
  await backfillMissingFields(db, canonicalId, duplicateId);
  await db.delete(schema.events).where(eq(schema.events.id, duplicateId));
  await db.insert(schema.eventClusters).values({
    canonicalEventId: canonicalId,
    mergedEventSlug: duplicate.slug,
    mergedEventTitle: duplicate.title,
    score: scored.total.toFixed(4),
    breakdown: scoredBreakdown(scored),
    decidedBy,
  });
}

function scoredBreakdown(scored: ScoredPair): Record<string, unknown> {
  const { titleSimilarity, venueAffinity, startDeltaMinutes, urlMatch, total } = scored;
  return { titleSimilarity, venueAffinity, startDeltaMinutes, urlMatch, total };
}

async function moveInstances(db: Db, canonicalId: string, duplicateId: string): Promise<void> {
  const canonicalStarts = await db
    .select({ startAt: schema.eventInstances.startAt })
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.eventId, canonicalId));
  const startList = canonicalStarts.map((r) => r.startAt);
  if (startList.length > 0) {
    await db.delete(schema.eventInstances).where(
      and(
        eq(schema.eventInstances.eventId, duplicateId),
        inArray(schema.eventInstances.startAt, startList),
      ),
    );
  }
  await db
    .update(schema.eventInstances)
    .set({ eventId: canonicalId })
    .where(eq(schema.eventInstances.eventId, duplicateId));
}

/** The higher-confidence canonical keeps its fields; only nulls are filled from the duplicate. */
async function backfillMissingFields(db: Db, canonicalId: string, duplicateId: string): Promise<void> {
  await db.execute(sql`
    UPDATE events c
    SET summary = COALESCE(c.summary, d.summary),
        description = COALESCE(c.description, d.description),
        category = COALESCE(c.category, d.category),
        image_url = COALESCE(c.image_url, d.image_url),
        canonical_url = COALESCE(c.canonical_url, d.canonical_url),
        is_free = COALESCE(c.is_free, d.is_free),
        venue_id = COALESCE(c.venue_id, d.venue_id),
        updated_at = now()
    FROM events d
    WHERE c.id = ${canonicalId} AND d.id = ${duplicateId}
  `);
}
