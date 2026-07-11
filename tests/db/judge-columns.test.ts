import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('migration 0017: judge columns', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('judge columns default null and round-trip', async () => {
    const [a] = await db.insert(schema.events)
      .values({ slug: 'ja', title: 'JA', normalizedTitle: 'ja' }).returning();
    const [b] = await db.insert(schema.events)
      .values({ slug: 'jb', title: 'JB', normalizedTitle: 'jb' }).returning();
    const [review] = await db.insert(schema.eventReviews)
      .values({ eventAId: a.id, eventBId: b.id, score: '0.7000', breakdown: {} }).returning();
    expect(review.judgeVerdict).toBeNull();
    expect(review.judgedAt).toBeNull();
    await db.update(schema.eventReviews)
      .set({ judgeVerdict: 'same', judgeConfidence: '0.9300', judgeRationale: 'case variant', judgedAt: new Date() })
      .where(eq(schema.eventReviews.id, review.id));
    const updated = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, review.id) });
    expect(updated).toMatchObject({ judgeVerdict: 'same', judgeRationale: 'case variant' });
    expect(Number(updated?.judgeConfidence)).toBeCloseTo(0.93);
    expect(updated?.judgedAt).toBeInstanceOf(Date);
  });
});
