import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import {
  approveReviewWithDb,
  rejectReviewWithDb,
  returnStuckReviewWithDb,
} from '@/app/actions/admin-reviews';
import { createTestDb } from '../helpers/test-db';

const FUTURE = new Date(Date.now() + 7 * 86_400_000);
FUTURE.setUTCHours(19, 0, 0, 0); // evening start well in the future

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

async function seedSources(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [api] = await db
    .insert(schema.sources)
    .values({
      key: 'tm-test',
      name: 'TM',
      url: 'https://tm.example',
      adapterType: 'api',
      config: {},
    })
    .returning();
  const [pabst] = await db
    .insert(schema.sources)
    .values({
      key: 'pabst-theater-group',
      name: 'Pabst Theater Group',
      url: 'https://pabsttheatergroup.example',
      adapterType: 'html',
      config: {},
    })
    .returning();
  return {
    api: { id: api.id, key: api.key },
    pabst: { id: pabst.id, key: pabst.key },
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
  const [review] = await db
    .insert(schema.eventReviews)
    .values({
      eventAId,
      eventBId,
      score: '0.6800',
      breakdown: {
        titleSimilarity: 0.65,
        venueAffinity: 1,
        startDeltaMinutes: 0,
        urlMatch: false,
        total: 0.68,
        verdict: 'review',
      },
    })
    .returning();
  return { review, apiEventId: first.eventId, pabstEventId: second.eventId };
}

describe('approveReviewWithDb', () => {
  it('approve happy path with explicit survivor merges onto survivor', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review, apiEventId } = await seedPendingPair(db, sources);

    const result = await approveReviewWithDb(db, {
      reviewId: review.id,
      survivorEventId: apiEventId,
    });

    expect(result.ok).toBe(true);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(apiEventId);
    // Review should be cascade deleted after merge
    const reviews = await db.query.eventReviews.findMany();
    expect(reviews).toHaveLength(0);
  });

  it('approve with missing survivorEventId returns error mentioning survivor', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review } = await seedPendingPair(db, sources);

    const result = await approveReviewWithDb(db, {
      reviewId: review.id,
      survivorEventId: null,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/survivor/i);
    // Verify nothing was merged
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(2);
    const reviews = await db.query.eventReviews.findMany();
    expect(reviews).toHaveLength(1);
  });

  it('approve with malformed reviewId returns error envelope', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { apiEventId } = await seedPendingPair(db, sources);

    const result = await approveReviewWithDb(db, {
      reviewId: 'not-a-uuid',
      survivorEventId: apiEventId,
    });

    expect(result.ok).toBe(false);
  });

  it('approve with non-existent reviewId returns error envelope', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { apiEventId } = await seedPendingPair(db, sources);

    const result = await approveReviewWithDb(db, {
      reviewId: '00000000-0000-0000-0000-000000000000',
      survivorEventId: apiEventId,
    });

    expect(result.ok).toBe(false);
  });
});

describe('rejectReviewWithDb', () => {
  it('reject happy path sets status to rejected and preserves both events', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review } = await seedPendingPair(db, sources);

    const result = await rejectReviewWithDb(db, {
      reviewId: review.id,
    });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(schema.eventReviews).where(eq(schema.eventReviews.id, review.id));
    expect(row.status).toBe('rejected');
    expect(row.resolvedAt).not.toBeNull();
    // Both events should survive
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(2);
  });

  it('reject with malformed reviewId returns error envelope', async () => {
    const db = await createTestDb();

    const result = await rejectReviewWithDb(db, {
      reviewId: 'not-a-uuid',
    });

    expect(result.ok).toBe(false);
  });

  it('reject with non-existent reviewId returns error envelope', async () => {
    const db = await createTestDb();

    const result = await rejectReviewWithDb(db, {
      reviewId: '00000000-0000-0000-0000-000000000000',
    });

    expect(result.ok).toBe(false);
  });
});

describe('returnStuckReviewWithDb', () => {
  it('CAS-returns an approved row to pending and clears resolvedAt', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review } = await seedPendingPair(db, sources);
    await db
      .update(schema.eventReviews)
      .set({ status: 'approved', resolvedAt: new Date() })
      .where(eq(schema.eventReviews.id, review.id));

    const result = await returnStuckReviewWithDb(db, { reviewId: review.id });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(schema.eventReviews).where(eq(schema.eventReviews.id, review.id));
    expect(row.status).toBe('pending');
    expect(row.resolvedAt).toBeNull();
  });

  it('refuses rows that are not approved (raced back already)', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review } = await seedPendingPair(db, sources);

    const result = await returnStuckReviewWithDb(db, { reviewId: review.id });

    expect(result.ok).toBe(false);
    const [row] = await db.select().from(schema.eventReviews).where(eq(schema.eventReviews.id, review.id));
    expect(row.status).toBe('pending');
  });
});
