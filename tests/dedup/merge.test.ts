import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { mergeEvents } from '@/dedup/merge';
import type { ScoredPair } from '@/dedup/scoring';
import { createTestDb } from '../helpers/test-db';

const { embedManyMock, generateTextMock } = vi.hoisted(() => ({
  embedManyMock: vi.fn(),
  generateTextMock: vi.fn(),
}));

vi.mock('ai', () => ({
  embedMany: embedManyMock,
  generateText: generateTextMock,
  Output: { object: (config: unknown) => config },
}));

// Imported after the mock so sweep.ts's `import { embedMany, generateText } from 'ai'` resolves
// to the mocked module, per Vitest's hoisting contract for vi.mock.
const { enrichSweep } = await import('@/enrichment/sweep');

const FUTURE = new Date(Date.now() + 7 * 86_400_000);

const FAKE_SCORE: ScoredPair = {
  titleSimilarity: 1,
  venueAffinity: 1,
  startDeltaMinutes: 0,
  urlMatch: false,
  total: 0.9,
  verdict: 'merge',
};

async function seedSource(db: Awaited<ReturnType<typeof createTestDb>>, key: string) {
  const [source] = await db
    .insert(schema.sources)
    .values({ key, name: key, url: `https://${key}.example`, adapterType: 'html', config: {} })
    .returning();
  return { id: source.id, key: source.key };
}

async function seedEvent(
  db: Awaited<ReturnType<typeof createTestDb>>,
  source: { id: string; key: string },
  sourceEventId: string,
) {
  return persistNormalizedEvent(db, source, {
    sourceEventId,
    title: 'Jazz Night',
    description: 'An evening of jazz',
    venueName: 'Test Hall',
    startAt: FUTURE,
    timezone: 'America/Chicago',
    status: 'scheduled',
  });
}

describe('mergeEvents', () => {
  it('backfills vibe_tags and audience_tags (not just category) from a tagged duplicate onto an untagged canonical', async () => {
    const db = await createTestDb();
    const source = await seedSource(db, 'merge-test');
    const canonical = await seedEvent(db, source, 'canonical-1');
    const duplicate = await seedEvent(db, source, 'duplicate-1');

    // Simulate the duplicate having already been tagged by a prior enrichment sweep —
    // category, vibe_tags, and audience_tags are always written together atomically
    // by applyTags in src/enrichment/sweep.ts, so a real tagged row never has one
    // without the others.
    await db
      .update(schema.events)
      .set({ category: 'music', vibeTags: ['jazz', 'intimate'], audienceTags: ['adults'] })
      .where(eq(schema.events.id, duplicate.eventId));

    await mergeEvents(db, canonical.eventId, duplicate.eventId, FAKE_SCORE, 'auto');

    const merged = await db.query.events.findFirst({ where: eq(schema.events.id, canonical.eventId) });
    if (!merged) throw new Error('canonical event missing after merge');
    expect(merged.category).toBe('music');
    expect(merged.vibeTags).toEqual(['jazz', 'intimate']);
    expect(merged.audienceTags).toEqual(['adults']);
  });

  it('does not leave the merged canonical stuck as a forever tag-sweep candidate', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    generateTextMock.mockReset();
    embedManyMock.mockReset();
    embedManyMock.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => Array.from({ length: 1536 }, () => 0)),
    }));

    const db = await createTestDb();
    const source = await seedSource(db, 'merge-sweep-test');
    const canonical = await seedEvent(db, source, 'canonical-2');
    const duplicate = await seedEvent(db, source, 'duplicate-2');
    await db
      .update(schema.events)
      .set({ category: 'music', vibeTags: ['jazz'], audienceTags: ['adults'] })
      .where(eq(schema.events.id, duplicate.eventId));
    // Otherwise the advisory title-suggest tail would legitimately pick these html-sourced
    // events up as candidates and call generateText too — this test isolates tag-sweep candidacy.
    await db
      .update(schema.events)
      .set({ titleSuggestedAt: new Date() })
      .where(inArray(schema.events.id, [canonical.eventId, duplicate.eventId]));

    await mergeEvents(db, canonical.eventId, duplicate.eventId, FAKE_SCORE, 'auto');

    // The old (pre-fix) predicate `category IS NULL AND vibe_tags IS NULL` would have
    // permanently excluded this canonical from tagging if only category had been
    // backfilled. With both columns backfilled together, the canonical is already
    // fully tagged, so the sweep correctly leaves it alone instead of re-tagging it.
    const result = await enrichSweep(db);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(result.tagged).toBe(0);

    const merged = await db.query.events.findFirst({ where: eq(schema.events.id, canonical.eventId) });
    expect(merged?.vibeTags).toEqual(['jazz']);

    vi.unstubAllEnvs();
  });
});
