import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { chicagoDateLabel } from '@/lib/display';
import type { Judgment, JudgePairInput } from '@/dedup/judge';
import { createTestDb } from '../helpers/test-db';

// Wraps the real judgePendingReviews so every test but the cron-shield one calls straight
// through to the actual implementation; only that one test overrides a single call to reject.
vi.mock('@/dedup/judge-sweep', async () => {
  const actual = await vi.importActual<typeof import('@/dedup/judge-sweep')>('@/dedup/judge-sweep');
  return { ...actual, judgePendingReviews: vi.fn(actual.judgePendingReviews) };
});

// Imported after the mock so sweep.ts's `import { judgePendingReviews } from './judge-sweep'`
// resolves to the mocked module too, per Vitest's hoisting contract for vi.mock.
const { judgePendingReviews } = await import('@/dedup/judge-sweep');
const { dedupSweep } = await import('@/dedup/sweep');

async function seedSources(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [a] = await db
    .insert(schema.sources)
    .values({ key: 'judge-src-a', name: 'Judge Source A', url: 'https://a.example', adapterType: 'html', config: {} })
    .returning();
  const [b] = await db
    .insert(schema.sources)
    .values({ key: 'judge-src-b', name: 'Judge Source B', url: 'https://b.example', adapterType: 'html', config: {} })
    .returning();
  return { a: { id: a.id, key: a.key }, b: { id: b.id, key: b.key } };
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

async function seedPendingReview(
  db: Awaited<ReturnType<typeof createTestDb>>,
  eventAId: string,
  eventBId: string,
  overrides: Record<string, unknown> = {},
) {
  const [row] = await db
    .insert(schema.eventReviews)
    .values({
      eventAId,
      eventBId,
      score: '0.68',
      breakdown: { titleSimilarity: 0.65, venueAffinity: 1, startDeltaMinutes: 0, urlMatch: false, total: 0.68, verdict: 'review' },
      ...overrides,
    })
    .returning();
  return row;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('judgePendingReviews', () => {
  it('annotates unjudged pending pairs and skips already-judged ones', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const sources = await seedSources(db);
    const e1a = await persistNormalizedEvent(db, sources.a, normalized('e1a', 'Show One A'));
    const e1b = await persistNormalizedEvent(db, sources.b, normalized('e1b', 'Show One B'));
    const e2a = await persistNormalizedEvent(db, sources.a, normalized('e2a', 'Show Two A'));
    const e2b = await persistNormalizedEvent(db, sources.b, normalized('e2b', 'Show Two B'));

    const review1 = await seedPendingReview(db, e1a.eventId, e1b.eventId);
    const alreadyJudgedAt = new Date('2026-01-01T00:00:00Z');
    const review2 = await seedPendingReview(db, e2a.eventId, e2b.eventId, {
      judgeVerdict: 'different',
      judgeConfidence: '0.8100',
      judgeRationale: 'prior judgment',
      judgedAt: alreadyJudgedAt,
    });
    const review2Before = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, review2.id) });

    const fakeJudgment: Judgment = { sameEvent: true, confidence: 0.93, rationale: 'case variant' };
    const judgeFn = vi.fn(async () => fakeJudgment);

    const result = await judgePendingReviews(db, { judgeFn });

    expect(result).toEqual({ judged: 1, skipped: 0 });
    expect(judgeFn).toHaveBeenCalledTimes(1);

    const updated1 = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, review1.id) });
    expect(updated1?.judgeVerdict).toBe('same');
    expect(Number(updated1?.judgeConfidence)).toBeCloseTo(0.93, 4);
    expect(updated1?.judgeRationale).toBe('case variant');
    expect(updated1?.judgedAt).not.toBeNull();

    // Already-judged row must be byte-untouched.
    const updated2 = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, review2.id) });
    expect(updated2).toEqual(review2Before);
  });

  it('a null judgment is a skip and leaves judgedAt NULL for retry', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const sources = await seedSources(db);
    const a = await persistNormalizedEvent(db, sources.a, normalized('n-a', 'Null Show A'));
    const b = await persistNormalizedEvent(db, sources.b, normalized('n-b', 'Null Show B'));
    await seedPendingReview(db, a.eventId, b.eventId);

    const judgeFn = vi.fn(async () => null);
    const result = await judgePendingReviews(db, { judgeFn });

    expect(result).toEqual({ judged: 0, skipped: 1 });
    const reviews = await db.query.eventReviews.findMany();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].judgeVerdict).toBeNull();
    expect(reviews[0].judgeConfidence).toBeNull();
    expect(reviews[0].judgeRationale).toBeNull();
    expect(reviews[0].judgedAt).toBeNull();
  });

  it('maps low confidence to unsure via verdictFrom', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const sources = await seedSources(db);
    const a = await persistNormalizedEvent(db, sources.a, normalized('u-a', 'Unsure Show A'));
    const b = await persistNormalizedEvent(db, sources.b, normalized('u-b', 'Unsure Show B'));
    await seedPendingReview(db, a.eventId, b.eventId);

    const judgeFn = vi.fn(async (): Promise<Judgment> => ({ sameEvent: true, confidence: 0.5, rationale: 'ambiguous' }));
    const result = await judgePendingReviews(db, { judgeFn });

    expect(result).toEqual({ judged: 1, skipped: 0 });
    const review = await db.query.eventReviews.findFirst();
    expect(review?.judgeVerdict).toBe('unsure');
  });

  it('builds inputs from live pair state (titles, venues, delta, chicago dates, sources)', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const sources = await seedSources(db);
    const bStart = new Date(FUTURE.getTime() + 45 * 60_000);
    const a = await persistNormalizedEvent(db, sources.a, normalized('i-a', 'Input Show A'));
    const b = await persistNormalizedEvent(db, sources.b, normalized('i-b', 'Input Show B', { startAt: bStart }));
    await seedPendingReview(db, a.eventId, b.eventId);

    let capturedInput: JudgePairInput | undefined;
    const judgeFn = vi.fn(async (input: JudgePairInput): Promise<Judgment> => {
      capturedInput = input;
      return { sameEvent: true, confidence: 0.9, rationale: 'ok' };
    });
    await judgePendingReviews(db, { judgeFn });

    expect(capturedInput).toBeDefined();
    expect(capturedInput?.aTitle).toBe('Input Show A');
    expect(capturedInput?.bTitle).toBe('Input Show B');
    expect(capturedInput?.venueA).toBe('Turner Hall Ballroom');
    expect(capturedInput?.venueB).toBe('Turner Hall Ballroom');
    expect(capturedInput?.sameVenueId).toBe(true); // both persisted under the same venue name
    expect(capturedInput?.startDeltaMinutes).toBe(45);
    expect(capturedInput?.aStarts).toEqual([chicagoDateLabel(FUTURE)]);
    expect(capturedInput?.bStarts).toEqual([chicagoDateLabel(bStart)]);
    expect(capturedInput?.aSources).toEqual(['judge-src-a']);
    expect(capturedInput?.bSources).toEqual(['judge-src-b']);
  });

  it('resolved (rejected) rows are never judged', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const sources = await seedSources(db);
    const a = await persistNormalizedEvent(db, sources.a, normalized('r-a', 'Rejected Show A'));
    const b = await persistNormalizedEvent(db, sources.b, normalized('r-b', 'Rejected Show B'));
    await seedPendingReview(db, a.eventId, b.eventId, { status: 'rejected', resolvedAt: new Date() });

    const judgeFn = vi.fn(async (): Promise<Judgment> => ({ sameEvent: true, confidence: 0.9, rationale: 'n/a' }));
    const result = await judgePendingReviews(db, { judgeFn });

    expect(result).toEqual({ judged: 0, skipped: 0 });
    expect(judgeFn).not.toHaveBeenCalled();
  });

  it('ANNOTATE-ONLY invariant: events, instances, links, and review status are byte-untouched', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const sources = await seedSources(db);
    const a = await persistNormalizedEvent(db, sources.a, normalized('a-a', 'Annotate Show A'));
    const b = await persistNormalizedEvent(db, sources.b, normalized('a-b', 'Annotate Show B'));
    const review = await seedPendingReview(db, a.eventId, b.eventId);

    const eventsBefore = await db.query.events.findMany();
    const instancesBefore = await db.query.eventInstances.findMany();
    const linksBefore = await db.query.eventSourceLinks.findMany();
    const reviewBefore = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, review.id) });

    const judgeFn = vi.fn(async (): Promise<Judgment> => ({ sameEvent: true, confidence: 0.9, rationale: 'ok' }));
    await judgePendingReviews(db, { judgeFn });

    const eventsAfter = await db.query.events.findMany();
    const instancesAfter = await db.query.eventInstances.findMany();
    const linksAfter = await db.query.eventSourceLinks.findMany();
    const reviewAfter = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, review.id) });

    expect(eventsAfter).toEqual(eventsBefore);
    expect(instancesAfter).toEqual(instancesBefore);
    expect(linksAfter).toEqual(linksBefore);
    expect(reviewAfter?.status).toBe('pending');
    expect(reviewAfter?.resolvedAt).toBeNull();
    // Only the judge_* columns may differ from the pre-sweep snapshot.
    expect({ ...reviewAfter, judgeVerdict: null, judgeConfidence: null, judgeRationale: null, judgedAt: null }).toEqual({
      ...reviewBefore,
      judgeVerdict: null,
      judgeConfidence: null,
      judgeRationale: null,
      judgedAt: null,
    });
  });

  it('a pair resolved (rejected) mid-flight by a human is an honest skip, not a phantom judgment', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const sources = await seedSources(db);
    const a = await persistNormalizedEvent(db, sources.a, normalized('mf-a', 'MidFlight Show A'));
    const b = await persistNormalizedEvent(db, sources.b, normalized('mf-b', 'MidFlight Show B'));
    const review = await seedPendingReview(db, a.eventId, b.eventId);

    // Simulates a human resolving the review queue between this sweep's fetch and its write.
    const judgeFn = vi.fn(async (): Promise<Judgment> => {
      await db
        .update(schema.eventReviews)
        .set({ status: 'rejected', resolvedAt: new Date() })
        .where(eq(schema.eventReviews.id, review.id));
      return { sameEvent: true, confidence: 0.9, rationale: 'raced' };
    });

    const result = await judgePendingReviews(db, { judgeFn });

    expect(result).toEqual({ judged: 0, skipped: 1 });
    const after = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, review.id) });
    expect(after?.status).toBe('rejected');
    expect(after?.judgeVerdict).toBeNull();
    expect(after?.judgeConfidence).toBeNull();
    expect(after?.judgeRationale).toBeNull();
    expect(after?.judgedAt).toBeNull();
  });

  it('a pair cascaded away (its duplicate event deleted) mid-flight is an honest skip, not a judged count', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const sources = await seedSources(db);
    const a = await persistNormalizedEvent(db, sources.a, normalized('cc-a', 'Cascade Show A'));
    const b = await persistNormalizedEvent(db, sources.b, normalized('cc-b', 'Cascade Show B'));
    await seedPendingReview(db, a.eventId, b.eventId);

    // Simulates a same-show merge deleting one side mid-flight — the review row cascades away
    // via the eventAId/eventBId onDelete: 'cascade' FKs before this judgment gets written.
    const judgeFn = vi.fn(async (): Promise<Judgment> => {
      await db.delete(schema.events).where(eq(schema.events.id, b.eventId));
      return { sameEvent: true, confidence: 0.9, rationale: 'raced' };
    });

    const result = await judgePendingReviews(db, { judgeFn });

    expect(result).toEqual({ judged: 0, skipped: 1 });
    const reviews = await db.query.eventReviews.findMany();
    expect(reviews).toHaveLength(0); // cascaded away with the deleted event
  });

  it('respects limit option and judges oldest-first', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const sources = await seedSources(db);
    const a1 = await persistNormalizedEvent(db, sources.a, normalized('old-a', 'Old Show A'));
    const b1 = await persistNormalizedEvent(db, sources.b, normalized('old-b', 'Old Show B'));
    const a2 = await persistNormalizedEvent(db, sources.a, normalized('new-a', 'New Show A'));
    const b2 = await persistNormalizedEvent(db, sources.b, normalized('new-b', 'New Show B'));

    // Create the older review first (will have earlier createdAt)
    const olderReview = await seedPendingReview(db, a1.eventId, b1.eventId);
    // Small delay to ensure distinct createdAt
    await new Promise((resolve) => setTimeout(resolve, 10));
    const newerReview = await seedPendingReview(db, a2.eventId, b2.eventId);

    const judgeFn = vi.fn(async (): Promise<Judgment> => ({ sameEvent: false, confidence: 0.85, rationale: 'distinct' }));
    const result = await judgePendingReviews(db, { limit: 1, judgeFn });

    expect(result).toEqual({ judged: 1, skipped: 0 });
    expect(judgeFn).toHaveBeenCalledTimes(1);

    // Verify the older review was judged
    const judgdOlder = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, olderReview.id) });
    expect(judgdOlder?.judgeVerdict).toBe('different');
    expect(judgdOlder?.judgedAt).not.toBeNull();

    // Verify the newer review was NOT judged
    const unjudgedNewer = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, newerReview.id) });
    expect(unjudgedNewer?.judgeVerdict).toBeNull();
    expect(unjudgedNewer?.judgedAt).toBeNull();
  });

  it('does not fail the cron when the judge sweep throws — the tick still completes with judged 0 (cron shield)', async () => {
    const db = await createTestDb();
    vi.mocked(judgePendingReviews).mockRejectedValueOnce(new Error('gateway exploded'));

    const result = await dedupSweep(db);

    expect(result.judged).toBe(0);
    expect(result).toMatchObject({ examined: 0, merged: 0, queued: 0, judged: 0 });
  });
});
