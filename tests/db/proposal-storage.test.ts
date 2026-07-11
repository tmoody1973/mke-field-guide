import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('migration 0018: proposal storage', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('title suggestion columns default null and round-trip', async () => {
    const [event] = await db.insert(schema.events)
      .values({ slug: 'ts1', title: 'RAW TITLE @ 7PM', normalizedTitle: 'raw title 7pm' }).returning();
    expect(event.titleSuggestion).toBeNull();
    expect(event.titleSuggestedAt).toBeNull();
    await db.update(schema.events)
      .set({ titleSuggestion: 'Raw Title', titleSuggestedAt: new Date() })
      .where(eq(schema.events.id, event.id));
    const updated = await db.query.events.findFirst({ where: eq(schema.events.id, event.id) });
    expect(updated?.titleSuggestion).toBe('Raw Title');
    expect(updated?.titleSuggestedAt).toBeInstanceOf(Date);
  });

  it('venue suggestions enforce pair uniqueness and cascade with either venue', async () => {
    const [keep] = await db.insert(schema.venues).values({ name: 'K', normalizedName: 'k v' }).returning();
    const [absorb] = await db.insert(schema.venues).values({ name: 'A', normalizedName: 'a v' }).returning();
    await db.insert(schema.venueMergeSuggestions).values({
      keepVenueId: keep.id, absorbVenueId: absorb.id, confidence: '0.8800', rationale: 'same place',
    });
    await expect(
      db.insert(schema.venueMergeSuggestions).values({
        keepVenueId: keep.id, absorbVenueId: absorb.id, confidence: '0.5000', rationale: 'dup',
      }),
    ).rejects.toThrow();
    await db.delete(schema.venues).where(eq(schema.venues.id, absorb.id));
    expect(await db.query.venueMergeSuggestions.findMany()).toEqual([]);
  });
});
