import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { mergeEvents } from '@/dedup/merge';
import { createTestDb } from '../helpers/test-db';

// Seeding helpers copied from tests/dedup/same-show.test.ts
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

const scoredStub = {
  titleSimilarity: 0.9, venueAffinity: 1, startDeltaMinutes: 0, urlMatch: false,
  total: 0.9, verdict: 'merge',
} as const;

describe('chain merges preserve receipts (M3)', () => {
  it('re-points earlier receipts when their canonical is merged away', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const a = await persistNormalizedEvent(db, sources.api, normalized('s-a', 'Chain Show A'));
    const b = await persistNormalizedEvent(db, sources.otherHtml, normalized('s-b', 'Chain Show B'));
    const c = await persistNormalizedEvent(db, sources.pabst, normalized('s-c', 'Chain Show C'));

    await mergeEvents(db, a.eventId, b.eventId, scoredStub, 'review'); // receipt 1: canonical A
    await mergeEvents(db, c.eventId, a.eventId, scoredStub, 'review'); // A merged away

    const receipts = await db.query.eventClusters.findMany();
    expect(receipts).toHaveLength(2);
    expect(receipts.every((row) => row.canonicalEventId === c.eventId)).toBe(true);
    const mergedTitles = receipts.map((row) => row.mergedEventTitle).sort();
    expect(mergedTitles).toEqual(['Chain Show A', 'Chain Show B']);
  });
});
