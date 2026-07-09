import { eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/ingestion/persist';
import { findCandidates, type CandidateRow } from './candidates';
import { adapterRank, pickCanonical, pickSameShowSurvivor, type EventProvenance } from './confidence';
import { mergeEvents } from './merge';
import { scorePair, type ScoredPair } from './scoring';

export interface DedupResult {
  examined: number;
  merged: number;
  queued: number;
}

const SAME_SHOW_VENUE_AFFINITY_MIN = 0.9;
const SAME_SHOW_TIME_DELTA_MAX_MINUTES = 15;

/**
 * Same venue + start time within 15 minutes is the same show; title variants
 * ("w/ Jay Som", support-act suffixes) are why these otherwise land mid-band
 * instead of clearing the >=0.80 auto-merge line on title alone.
 */
function isSameShow(signals: { venueAffinity: number; startDeltaMinutes: number | null }): boolean {
  return (
    signals.venueAffinity >= SAME_SHOW_VENUE_AFFINITY_MIN &&
    signals.startDeltaMinutes !== null &&
    Math.abs(signals.startDeltaMinutes) <= SAME_SHOW_TIME_DELTA_MAX_MINUTES
  );
}

function scoreAndSortCandidates(candidates: CandidateRow[]) {
  return candidates
    .map((candidate) => ({ candidate, scored: scorePair(candidate) }))
    .sort(
      (x, y) =>
        y.scored.total - x.scored.total ||
        x.candidate.eventAId.localeCompare(y.candidate.eventAId) ||
        x.candidate.eventBId.localeCompare(y.candidate.eventBId),
    );
}

export async function dedupSweep(db: Db): Promise<DedupResult> {
  const candidates = await findCandidates(db);
  const result: DedupResult = { examined: candidates.length, merged: 0, queued: 0 };
  const consumed = new Set<string>();
  // Score every candidate up front and sort by total descending (stable id tie-break) so the
  // highest-confidence pair in a shared-event cluster always claims that event first — the
  // greedy loop below then just consumes in that fixed order instead of raw arrival order.
  const scoredCandidates = scoreAndSortCandidates(candidates);
  for (const { candidate, scored } of scoredCandidates) {
    if (consumed.has(candidate.eventAId) || consumed.has(candidate.eventBId)) continue;
    if (scored.verdict === 'merge') {
      await mergePair(db, candidate, scored, consumed, pickCanonical);
      result.merged += 1;
    } else if (scored.verdict === 'review' && isSameShow(scored)) {
      await mergePair(db, candidate, scored, consumed, pickSameShowSurvivor);
      result.merged += 1;
    } else if (scored.verdict === 'review') {
      await queuePair(db, candidate, scored);
      result.queued += 1;
    }
  }
  const backlog = await resolvePendingSameShow(db);
  result.merged += backlog.merged;
  return result;
}

async function mergePair(
  db: Db,
  candidate: CandidateRow,
  scored: ScoredPair,
  consumed: Set<string>,
  pickSurvivor: (a: EventProvenance, b: EventProvenance) => EventProvenance,
): Promise<void> {
  const [a, b] = await provenanceFor(db, [candidate.eventAId, candidate.eventBId]);
  const canonical = pickSurvivor(a, b);
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

/** Provenance = each event's canonical link's source adapter type, key, + event age. */
export async function provenanceFor(db: Db, eventIds: string[]): Promise<EventProvenance[]> {
  const rows = await db
    .select({
      eventId: schema.events.id,
      createdAt: schema.events.createdAt,
      adapterType: schema.sources.adapterType,
      sourceKey: schema.sources.key,
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

export interface ApplyReviewResult {
  ok: boolean;
  message: string;
}

export async function applyReview(
  db: Db,
  reviewId: string,
  verdict: 'approved' | 'rejected',
  survivorEventId?: string,
): Promise<ApplyReviewResult> {
  const review = await db.query.eventReviews.findFirst({
    where: eq(schema.eventReviews.id, reviewId),
  });
  if (!review || review.status !== 'pending') {
    return { ok: false, message: 'Review not found or already resolved.' };
  }
  if (verdict === 'rejected') {
    await db.update(schema.eventReviews)
      .set({ status: 'rejected', resolvedAt: new Date() })
      .where(eq(schema.eventReviews.id, reviewId));
    return { ok: true, message: 'Pair rejected — it will not be suggested again.' };
  }
  const [a, b] = await provenanceFor(db, [review.eventAId, review.eventBId]);
  const survivor = survivorEventId ?? pickSameShowSurvivor(a, b).eventId;
  if (survivor !== review.eventAId && survivor !== review.eventBId) {
    return { ok: false, message: 'Survivor must be one of the paired events.' };
  }
  const duplicate = survivor === review.eventAId ? review.eventBId : review.eventAId;
  // Human decision moves picks with it; the merge below would otherwise cascade-delete them.
  await db.update(schema.staffPicks)
    .set({ eventId: survivor })
    .where(eq(schema.staffPicks.eventId, duplicate));
  const breakdown = review.breakdown as ScoredPair;
  // mergeEvents deletes the duplicate event; THIS review row cascades away with it.
  // The durable record of an approved review is the event_clusters receipt (decidedBy 'review').
  await mergeEvents(db, survivor, duplicate, breakdown, 'review');
  return { ok: true, message: 'Merged. Recorded as a cluster receipt.' };
}

interface SameShowSignals {
  venueAffinity: number;
  startDeltaMinutes: number | null;
}

/**
 * Re-derives venue/time signals for a still-pending pair from current DB state
 * (a venue reassignment or instance edit since queuing could change the
 * verdict). Returns null when either event has since been removed.
 */
async function currentPairSignals(db: Db, eventAId: string, eventBId: string): Promise<SameShowSignals | null> {
  const result = await db.execute(sql`
    SELECT
      CASE
        WHEN ea.venue_id IS NOT NULL AND ea.venue_id = eb.venue_id THEN 1
        WHEN va.normalized_name IS NOT NULL AND vb.normalized_name IS NOT NULL
          THEN similarity(va.normalized_name, vb.normalized_name)
        ELSE 0.5
      END AS venue_affinity,
      (
        SELECT MIN(ABS(EXTRACT(EPOCH FROM (ia.start_at - ib.start_at)) / 60))
        FROM event_instances ia, event_instances ib
        WHERE ia.event_id = ea.id AND ib.event_id = eb.id
          AND (ia.start_at AT TIME ZONE 'America/Chicago')::time <> '00:00:00'
          AND (ib.start_at AT TIME ZONE 'America/Chicago')::time <> '00:00:00'
          AND (ia.start_at AT TIME ZONE 'America/Chicago')::date = (ib.start_at AT TIME ZONE 'America/Chicago')::date
      ) AS start_delta_minutes
    FROM events ea
    JOIN events eb ON eb.id = ${eventBId}
    LEFT JOIN venues va ON va.id = ea.venue_id
    LEFT JOIN venues vb ON vb.id = eb.venue_id
    WHERE ea.id = ${eventAId}
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    venueAffinity: Number(row.venue_affinity),
    startDeltaMinutes: row.start_delta_minutes === null ? null : Number(row.start_delta_minutes),
  };
}

async function mergeSameShowReview(
  db: Db,
  review: { eventAId: string; eventBId: string; breakdown: unknown },
): Promise<void> {
  const [a, b] = await provenanceFor(db, [review.eventAId, review.eventBId]);
  const canonical = pickSameShowSurvivor(a, b);
  const duplicate = canonical.eventId === a.eventId ? b : a;
  await mergeEvents(db, canonical.eventId, duplicate.eventId, review.breakdown as ScoredPair, 'review');
}

/**
 * One-shot backlog drain: promotes any still-pending review whose pair now
 * meets the same-show rule (src/dedup/confidence.ts's venue-owned-aware
 * survivor pick applies here too). Wired at the end of dedupSweep so the daily
 * cron drains qualifying backlog automatically; also exposed standalone for
 * `npm run dedup:resolve-same-show`. A merged pair's review row cascades away
 * with its deleted duplicate event — no separate row cleanup needed.
 */
export async function resolvePendingSameShow(db: Db): Promise<{ merged: number; kept: number }> {
  const pending = await db.query.eventReviews.findMany({ where: eq(schema.eventReviews.status, 'pending') });
  const outcome = { merged: 0, kept: 0 };
  for (const review of pending) {
    const signals = await currentPairSignals(db, review.eventAId, review.eventBId);
    if (!signals || !isSameShow(signals)) {
      outcome.kept += 1;
      continue;
    }
    await mergeSameShowReview(db, review);
    outcome.merged += 1;
  }
  return outcome;
}
