import { eq, inArray } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/ingestion/persist';
import { findCandidates, type CandidateRow } from './candidates';
import { adapterRank, pickCanonical, type EventProvenance } from './confidence';
import { mergeEvents } from './merge';
import { scorePair, type ScoredPair } from './scoring';

export interface DedupResult {
  examined: number;
  merged: number;
  queued: number;
}

export async function dedupSweep(db: Db): Promise<DedupResult> {
  const candidates = await findCandidates(db);
  const result: DedupResult = { examined: candidates.length, merged: 0, queued: 0 };
  const consumed = new Set<string>();
  for (const candidate of candidates) {
    if (consumed.has(candidate.eventAId) || consumed.has(candidate.eventBId)) continue;
    const scored = scorePair(candidate);
    if (scored.verdict === 'merge') {
      await mergePair(db, candidate, scored, consumed);
      result.merged += 1;
    } else if (scored.verdict === 'review') {
      await queuePair(db, candidate, scored);
      result.queued += 1;
    }
  }
  return result;
}

async function mergePair(
  db: Db,
  candidate: CandidateRow,
  scored: ScoredPair,
  consumed: Set<string>,
): Promise<void> {
  const [a, b] = await provenanceFor(db, [candidate.eventAId, candidate.eventBId]);
  const canonical = pickCanonical(a, b);
  const duplicate = canonical.eventId === a.eventId ? b : a;
  await mergeEvents(db, canonical.eventId, duplicate.eventId, scored, 'auto');
  consumed.add(duplicate.eventId);
}

async function queuePair(db: Db, candidate: CandidateRow, scored: ScoredPair): Promise<void> {
  await db
    .insert(schema.eventReviews)
    .values({
      eventAId: candidate.eventAId,
      eventBId: candidate.eventBId,
      score: scored.total.toFixed(4),
      breakdown: { ...scored },
    })
    .onConflictDoNothing();
}

/** Provenance = each event's canonical link's source adapter type + event age. */
async function provenanceFor(db: Db, eventIds: string[]): Promise<EventProvenance[]> {
  const rows = await db
    .select({
      eventId: schema.events.id,
      createdAt: schema.events.createdAt,
      adapterType: schema.sources.adapterType,
    })
    .from(schema.events)
    .innerJoin(schema.eventSourceLinks, eq(schema.eventSourceLinks.eventId, schema.events.id))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.eventSourceLinks.sourceId))
    .where(inArray(schema.events.id, eventIds));
  return eventIds.map((id) => {
    const ranked = rows.filter((r) => r.eventId === id);
    if (ranked.length === 0) throw new Error(`No source link found for event ${id}`);
    return bestProvenance(ranked);
  });
}

function bestProvenance(rows: EventProvenance[]): EventProvenance {
  return rows.reduce((best, row) => (adapterRank(row.adapterType) > adapterRank(best.adapterType) ? row : best));
}

export async function applyReview(
  db: Db,
  reviewId: string,
  verdict: 'approved' | 'rejected',
): Promise<void> {
  const review = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, reviewId) });
  if (!review || review.status !== 'pending') return;
  if (verdict === 'approved') {
    const [a, b] = await provenanceFor(db, [review.eventAId, review.eventBId]);
    const canonical = pickCanonical(a, b);
    const duplicate = canonical.eventId === a.eventId ? b : a;
    const breakdown = review.breakdown as ScoredPair;
    await mergeEvents(db, canonical.eventId, duplicate.eventId, breakdown, 'review');
  }
  await db
    .update(schema.eventReviews)
    .set({ status: verdict, resolvedAt: new Date() })
    .where(eq(schema.eventReviews.id, reviewId));
}
