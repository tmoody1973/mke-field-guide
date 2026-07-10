import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { pendingReviewPairs, stuckApprovedReviews } from '@/queries/admin-reviews';
import { createTestDb } from '../helpers/test-db';

// Three sources: a higher-ranked non-venue source, the venue's own listing (html,
// lower ladder rank), and a second non-venue html source — mirrors tests/dedup/same-show.test.ts.
async function seedSources(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [api] = await db.insert(schema.sources).values({
    key: 'tm-test', name: 'TM', url: 'https://tm.example', adapterType: 'api', config: {},
  }).returning();
  const [pabst] = await db.insert(schema.sources).values({
    key: 'pabst-theater-group', name: 'Pabst Theater Group', url: 'https://pabsttheatergroup.example',
    adapterType: 'html', config: {},
  }).returning();
  return {
    api: { id: api.id, key: api.key },
    pabst: { id: pabst.id, key: pabst.key },
  };
}

const FUTURE = new Date(Date.now() + 7 * 86_400_000);
FUTURE.setUTCHours(19, 0, 0, 0); // evening start well in the future, non-midnight Chicago wall time

const PAST = new Date(Date.now() - 30 * 86_400_000);
PAST.setUTCHours(19, 0, 0, 0);

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

// Mirrors tests/dedup/apply-review.test.ts's seedPendingPair, with a score override param.
async function seedPendingPair(
  db: Awaited<ReturnType<typeof createTestDb>>,
  sources: Awaited<ReturnType<typeof seedSources>>,
  titleA: string,
  titleB: string,
  score = '0.6800',
) {
  const first = await persistNormalizedEvent(db, sources.api, normalized(`s-${titleA}`, titleA));
  const second = await persistNormalizedEvent(db, sources.pabst, normalized(`s-${titleB}`, titleB));
  const [eventAId, eventBId] = [first.eventId, second.eventId].sort();
  const [review] = await db
    .insert(schema.eventReviews)
    .values({
      eventAId,
      eventBId,
      score,
      breakdown: {
        titleSimilarity: 0.65,
        venueAffinity: 1,
        startDeltaMinutes: 0,
        urlMatch: false,
        total: Number(score),
      },
    })
    .returning();
  return { review, apiEventId: first.eventId, pabstEventId: second.eventId };
}

describe('pendingReviewPairs', () => {
  it('returns pending pairs ordered by score desc with full side detail', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const low = await seedPendingPair(db, sources, 'Low Score A', 'Low Score B', '0.5000');
    const high = await seedPendingPair(db, sources, 'High Score A', 'High Score B', '0.9000');
    // Give the high-score pabst side a second, past instance — a dupe may be past-only.
    await persistNormalizedEvent(
      db,
      sources.pabst,
      normalized('s-High Score B', 'High Score B', { startAt: PAST }),
    );

    const pairs = await pendingReviewPairs(db);

    expect(pairs).toHaveLength(2);
    // (a) ordered by score desc
    expect(pairs[0].reviewId).toBe(high.review.id);
    expect(pairs[0].score).toBe('0.9000');
    expect(pairs[1].reviewId).toBe(low.review.id);
    expect(pairs[1].score).toBe('0.5000');

    // (b) side detail on the high-score pair
    const highPair = pairs[0];
    const apiSide = [highPair.a, highPair.b].find((side) => side.eventId === high.apiEventId);
    const pabstSide = [highPair.a, highPair.b].find((side) => side.eventId === high.pabstEventId);
    expect(apiSide).toBeDefined();
    expect(pabstSide).toBeDefined();
    expect(apiSide?.title).toBe('High Score A');
    expect(apiSide?.venueName).toBe('Turner Hall Ballroom');
    expect(apiSide?.status).toBe('scheduled');
    expect(apiSide?.sources).toEqual([
      expect.objectContaining({ key: 'tm-test', isCanonical: true }),
    ]);
    expect(pabstSide?.sources).toEqual([
      expect.objectContaining({ key: 'pabst-theater-group', isCanonical: true }),
    ]);
    // instanceStarts includes the past instance, ascending, past-first
    expect(pabstSide?.instanceStarts).toHaveLength(2);
    expect(pabstSide?.instanceStarts[0].getTime()).toBe(PAST.getTime());
    expect(pabstSide?.instanceStarts[1].getTime()).toBe(FUTURE.getTime());
    expect(pabstSide?.instanceStarts[0].getTime()).toBeLessThan(pabstSide!.instanceStarts[1].getTime());
  });

  it('suggests the venue-owned side as survivor', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review, pabstEventId } = await seedPendingPair(db, sources, 'Survivor A', 'Survivor B');

    const pairs = await pendingReviewPairs(db);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].reviewId).toBe(review.id);
    expect(pairs[0].suggestedSurvivorId).toBe(pabstEventId); // pabst-theater-group is VENUE_OWNED
  });

  it('marks sides that carry staff picks', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { apiEventId, pabstEventId } = await seedPendingPair(db, sources, 'Pick A', 'Pick B');
    await db.insert(schema.staffPicks).values({
      eventId: apiEventId,
      curatorName: 'Tarik',
      blurb: 'keep me',
      weekOf: '2026-07-06',
    });

    const pairs = await pendingReviewPairs(db);

    expect(pairs).toHaveLength(1);
    const apiSide = [pairs[0].a, pairs[0].b].find((side) => side.eventId === apiEventId);
    const pabstSide = [pairs[0].a, pairs[0].b].find((side) => side.eventId === pabstEventId);
    expect(apiSide?.hasStaffPick).toBe(true);
    expect(pabstSide?.hasStaffPick).toBe(false);
  });

  it('returns [] when the queue is empty', async () => {
    const db = await createTestDb();
    await seedSources(db); // sources exist, but no reviews are queued

    expect(await pendingReviewPairs(db)).toEqual([]);
  });
});

describe('stuckApprovedReviews', () => {
  it('stuckApprovedReviews surfaces approved rows older than the threshold, not fresh claims or pendings', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const stuck = await seedPendingPair(db, sources, 'Stuck A', 'Stuck B');
    const inFlight = await seedPendingPair(db, sources, 'In Flight A', 'In Flight B');
    await seedPendingPair(db, sources, 'Still Pending A', 'Still Pending B');

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000);
    const oneMinuteAgo = new Date(Date.now() - 1 * 60_000);
    await db
      .update(schema.eventReviews)
      .set({ status: 'approved', resolvedAt: thirtyMinutesAgo })
      .where(eq(schema.eventReviews.id, stuck.review.id));
    await db
      .update(schema.eventReviews)
      .set({ status: 'approved', resolvedAt: oneMinuteAgo })
      .where(eq(schema.eventReviews.id, inFlight.review.id));

    const result = await stuckApprovedReviews(db, 15);

    expect(result).toHaveLength(1);
    expect(result[0].reviewId).toBe(stuck.review.id);
    expect(result[0].resolvedAt.getTime()).toBe(thirtyMinutesAgo.getTime());
    expect([result[0].aTitle, result[0].bTitle].sort()).toEqual(['Stuck A', 'Stuck B']);
  });
});
