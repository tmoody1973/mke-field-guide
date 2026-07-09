import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { applyReview } from '@/dedup/sweep';
import { createTestDb } from '../helpers/test-db';

// Three sources: a higher-ranked non-venue source, the venue's own listing (html,
// lower ladder rank), and a second non-venue html source for the no-venue-owned case.
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

async function seedPendingPair(
  db: Awaited<ReturnType<typeof createTestDb>>,
  sources: Awaited<ReturnType<typeof seedSources>>,
  titleA = 'Review Show',
  titleB = 'Review Show Live',
) {
  const first = await persistNormalizedEvent(db, sources.api, normalized(`s-${titleA}`, titleA));
  const second = await persistNormalizedEvent(db, sources.pabst, normalized(`s-${titleB}`, titleB));
  const [eventAId, eventBId] = [first.eventId, second.eventId].sort();
  const [review] = await db.insert(schema.eventReviews).values({
    eventAId, eventBId, score: '0.6800',
    breakdown: { titleSimilarity: 0.65, venueAffinity: 1, startDeltaMinutes: 0, urlMatch: false, total: 0.68, verdict: 'review' },
  }).returning();
  return { review, apiEventId: first.eventId, pabstEventId: second.eventId };
}

describe('applyReview (M2)', () => {
  it('reject persists status and resolvedAt; both events survive', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review } = await seedPendingPair(db, sources);
    const result = await applyReview(db, review.id, 'rejected');
    expect(result.ok).toBe(true);
    const [row] = await db.select().from(schema.eventReviews).where(eq(schema.eventReviews.id, review.id));
    expect(row.status).toBe('rejected');
    expect(row.resolvedAt).not.toBeNull();
    expect(await db.query.events.findMany()).toHaveLength(2);
  });

  it('approve with an explicit survivor merges onto it and writes a review receipt', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review, apiEventId } = await seedPendingPair(db, sources);
    const result = await applyReview(db, review.id, 'approved', apiEventId);
    expect(result.ok).toBe(true);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(apiEventId);
    expect(await db.query.eventReviews.findMany()).toHaveLength(0); // cascade IS the contract
    const receipts = await db.query.eventClusters.findMany();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].canonicalEventId).toBe(apiEventId);
    expect(receipts[0].decidedBy).toBe('review');
  });

  it('approve without a survivor defaults to the venue-owned side', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review, pabstEventId } = await seedPendingPair(db, sources);
    const result = await applyReview(db, review.id, 'approved');
    expect(result.ok).toBe(true);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(pabstEventId); // pabst-theater-group is VENUE_OWNED
  });

  it('rejects a survivor that is not one of the pair, changing nothing', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review } = await seedPendingPair(db, sources);
    const result = await applyReview(db, review.id, 'approved', '00000000-0000-0000-0000-000000000000');
    expect(result.ok).toBe(false);
    expect(await db.query.events.findMany()).toHaveLength(2);
    expect((await db.query.eventReviews.findMany())[0].status).toBe('pending');
  });

  it('re-points a staff pick off the merged-away duplicate', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review, apiEventId, pabstEventId } = await seedPendingPair(db, sources);
    await db.insert(schema.staffPicks).values({
      eventId: apiEventId, curatorName: 'Tarik', blurb: 'keep me', weekOf: '2026-07-06',
    });
    const result = await applyReview(db, review.id, 'approved', pabstEventId); // api side is the duplicate
    expect(result.ok).toBe(true);
    const picks = await db.query.staffPicks.findMany();
    expect(picks).toHaveLength(1);
    expect(picks[0].eventId).toBe(pabstEventId);
  });

  it('is a not-found envelope on a second application', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review } = await seedPendingPair(db, sources);
    expect((await applyReview(db, review.id, 'rejected')).ok).toBe(true);
    expect((await applyReview(db, review.id, 'rejected')).ok).toBe(false);
  });

  it('refuses to merge on corrupt breakdown', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review, apiEventId } = await seedPendingPair(db, sources);
    await db.update(schema.eventReviews).set({ breakdown: {} as any }).where(eq(schema.eventReviews.id, review.id));
    const result = await applyReview(db, review.id, 'approved', apiEventId);
    expect(result.ok).toBe(false);
    expect(await db.query.events.findMany()).toHaveLength(2);
    expect((await db.query.eventReviews.findMany())[0].status).toBe('pending');
  });

  it('loses the claim race cleanly', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review } = await seedPendingPair(db, sources);
    // Simulate a concurrent winner already having claimed this review between
    // this caller's read and its CAS attempt.
    await db.update(schema.eventReviews)
      .set({ status: 'approved', resolvedAt: new Date() })
      .where(eq(schema.eventReviews.id, review.id));
    const result = await applyReview(db, review.id, 'approved');
    expect(result.ok).toBe(false);
    expect(await db.query.events.findMany()).toHaveLength(2);
  });

  it('a sequential double-approve envelopes on the second call', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review, apiEventId } = await seedPendingPair(db, sources);
    expect((await applyReview(db, review.id, 'approved', apiEventId)).ok).toBe(true);
    expect((await applyReview(db, review.id, 'approved', apiEventId)).ok).toBe(false);
  });
});
