import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { chicagoDateLabel } from '@/lib/display';
import type { Judgment, JudgePairInput } from '@/dedup/judge';
import { judgePendingReviews } from '@/dedup/judge-sweep';
import { createTestDb } from '../helpers/test-db';

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
});
