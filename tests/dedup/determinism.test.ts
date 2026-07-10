import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { findCandidates } from '@/dedup/candidates';
import { dedupSweep, scoreAndSortCandidates } from '@/dedup/sweep';
import { REVIEW_THRESHOLD, scorePair } from '@/dedup/scoring';
import { createTestDb } from '../helpers/test-db';

// Copied verbatim from tests/dedup/same-show.test.ts (do not edit that file).
async function seedSources(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [api] = await db.insert(schema.sources).values({
    key: 'tm-test', name: 'TM', url: 'https://tm.example', adapterType: 'api', config: {},
  }).returning();
  const [pabst] = await db.insert(schema.sources).values({
    key: 'pabst-theater-group', name: 'Pabst Theater Group', url: 'https://pabsttheatergroup.example',
    adapterType: 'html', config: {},
  }).returning();
  const [otherHtml] = await db.insert(schema.sources).values({
    key: 'other-promoter', name: 'Other Promoter', url: 'https://other.example', adapterType: 'html', config: {},
  }).returning();
  return {
    api: { id: api.id, key: api.key },
    pabst: { id: pabst.id, key: pabst.key },
    otherHtml: { id: otherHtml.id, key: otherHtml.key },
  };
}

const FUTURE = new Date(Date.now() + 7 * 86_400_000);
FUTURE.setUTCHours(19, 0, 0, 0); // evening start well in the future, non-midnight Chicago wall time

function normalized(sourceEventId: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceEventId,
    title,
    venueName: 'Turner Hall Ballroom',
    startAt: FUTURE,
    timezone: 'America/Chicago',
    status: 'scheduled' as const,
    ...overrides,
  };
}

// Title similarity is verified empirically against this codebase's pg_trgm + normalizeName
// (src/ingestion/naming.ts) pipeline: titleSimilarity(A,B) ≈ 0.534, (B,C) ≈ 0.517, (A,C) ≈ 0.052.
// With venue affinity and time delta both maxed for all three (same venue, same start), only
// titleSimilarity differentiates pair totals: total(A,B) ≈ 0.594 > total(B,C) ≈ 0.584, both
// clearing REVIEW_THRESHOLD (0.55); total(A,C) sits under MIN_TITLE_SIMILARITY (0.3) in
// src/dedup/candidates.ts, so (A,C) never becomes a candidate — it cannot interfere with the
// ordering being tested.
const EVENT_A_TITLE = 'The National at the Riverside Theater';
const EVENT_B_TITLE = 'The National at the Riverside Theater w/ Neon Static Sound Collective';
const EVENT_C_TITLE = 'w/ Neon Static Sound Collective';

/** Seeds the same 3-event shared-node cluster (A-B scores higher than B-C, both sharing B) into a fresh db. */
async function seedCluster(db: Awaited<ReturnType<typeof createTestDb>>) {
  const sources = await seedSources(db);
  const a = await persistNormalizedEvent(db, sources.api, normalized('src-a', EVENT_A_TITLE));
  const b = await persistNormalizedEvent(db, sources.otherHtml, normalized('src-b', EVENT_B_TITLE));
  const c = await persistNormalizedEvent(db, sources.pabst, normalized('src-c', EVENT_C_TITLE));
  return { a, b, c };
}

describe('dedupSweep determinism (M4)', () => {
  it('consumes the highest-scoring pair first in a shared-event cluster', async () => {
    const db = await createTestDb();
    const { a, b, c } = await seedCluster(db);

    // Pin the precondition: (A,B) must outscore (B,C) before dedupSweep runs at all.
    const candidatesBeforeSweep = await findCandidates(db);
    const abCandidate = candidatesBeforeSweep.find(
      (candidate) =>
        [candidate.eventAId, candidate.eventBId].includes(a.eventId) &&
        [candidate.eventAId, candidate.eventBId].includes(b.eventId),
    );
    const bcCandidate = candidatesBeforeSweep.find(
      (candidate) =>
        [candidate.eventAId, candidate.eventBId].includes(b.eventId) &&
        [candidate.eventAId, candidate.eventBId].includes(c.eventId),
    );
    if (!abCandidate || !bcCandidate) {
      throw new Error('expected findCandidates to surface both the (A,B) and (B,C) pairs before sweeping');
    }
    const scoreAB = scorePair(abCandidate);
    const scoreBC = scorePair(bcCandidate);
    expect(scoreAB.total).toBeGreaterThan(scoreBC.total);
    expect(scoreAB.total).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    expect(scoreBC.total).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);

    const result = await dedupSweep(db);

    // B must have been consumed by the (A,B) pair — the higher-scoring one — regardless
    // of Postgres row order. That leaves (B,C) with no B left to evaluate against, so
    // exactly one merge happens: A survives, B is gone, C is untouched.
    expect(result.merged).toBe(1);
    const events = await db.query.events.findMany();
    const ids = events.map((row) => row.id);
    expect(ids).toContain(a.eventId);
    expect(ids).not.toContain(b.eventId);
    expect(ids).toContain(c.eventId);

    // The one receipt written must be the (A,B) merge, not (B,C).
    const receipts = await db.query.eventClusters.findMany({ orderBy: [asc(schema.eventClusters.createdAt)] });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].canonicalEventId).toBe(a.eventId);
  });

  it('is idempotent-stable: two sweeps over identical seeds produce identical receipt sets', async () => {
    async function seedSweepAndSummarizeReceipts() {
      const db = await createTestDb();
      await seedCluster(db);
      await dedupSweep(db);
      const receipts = await db.query.eventClusters.findMany();
      return receipts
        .map((receipt) => ({
          mergedEventSlug: receipt.mergedEventSlug,
          mergedEventTitle: receipt.mergedEventTitle,
          decidedBy: receipt.decidedBy,
        }))
        .sort((x, y) => x.mergedEventSlug.localeCompare(y.mergedEventSlug));
    }

    const firstRun = await seedSweepAndSummarizeReceipts();
    const secondRun = await seedSweepAndSummarizeReceipts();
    expect(secondRun).toEqual(firstRun);
  }, 30_000); // two sequential PGlite boots (~12s each) exceed the file's 15s default

  it('breaks exact-total ties by eventAId then eventBId, independent of input order', () => {
    const signals = { titleSimilarity: 0.7, venueAffinity: 1, startDeltaMinutes: 0, urlMatch: false };
    const candidates = [
      { eventAId: 'zzz-a', eventBId: 'aaa-b', ...signals },
      { eventAId: 'aaa-a', eventBId: 'zzz-b', ...signals },
      { eventAId: 'aaa-a', eventBId: 'aaa-b', ...signals },
    ];

    const sorted = scoreAndSortCandidates(candidates);

    expect(sorted.map((entry) => [entry.candidate.eventAId, entry.candidate.eventBId])).toEqual([
      ['aaa-a', 'aaa-b'],
      ['aaa-a', 'zzz-b'],
      ['zzz-a', 'aaa-b'],
    ]);
  });
});
