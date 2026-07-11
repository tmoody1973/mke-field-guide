import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { mergeEvents } from '@/dedup/merge';
import type { ScoredPair } from '@/dedup/scoring';
import { createTestDb } from '../helpers/test-db';

const T1 = new Date(Date.now() + 7 * 86_400_000);
const T2 = new Date(Date.now() + 14 * 86_400_000);

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
  overrides: Record<string, unknown> = {},
) {
  return persistNormalizedEvent(db, source, {
    sourceEventId,
    title: 'Jazz Night',
    description: 'An evening of jazz',
    venueName: 'Test Hall',
    startAt: T1,
    timezone: 'America/Chicago',
    status: 'scheduled',
    ...overrides,
  });
}

async function lockFields(
  db: Awaited<ReturnType<typeof createTestDb>>,
  eventId: string,
  fields: string[],
) {
  await db.update(schema.events).set({ lockedFields: fields }).where(eq(schema.events.id, eventId));
}

async function instancesFor(db: Awaited<ReturnType<typeof createTestDb>>, eventId: string) {
  return db.query.eventInstances.findMany({ where: eq(schema.eventInstances.eventId, eventId) });
}

describe('mergeEvents respects survivor locks', () => {
  it("a 'time'-locked survivor keeps its exact instance set; the duplicate's instances die with it", async () => {
    const db = await createTestDb();
    const source = await seedSource(db, 'lock-time');
    const canonical = await seedEvent(db, source, 'canonical-time', { startAt: T1 });
    await lockFields(db, canonical.eventId, ['time']);

    const duplicate = await seedEvent(db, source, 'duplicate-time', { startAt: T1 });
    // Give the duplicate a second, novel instance at T2 — since it shares the source
    // and sourceEventId with T1, seed T2 via a direct insert to avoid colliding with
    // upsertInstance's (eventId, startAt) conflict target.
    await db.insert(schema.eventInstances).values({
      eventId: duplicate.eventId,
      sourceId: source.id,
      startAt: T2,
      timezone: 'America/Chicago',
      status: 'scheduled',
    });

    await mergeEvents(db, canonical.eventId, duplicate.eventId, FAKE_SCORE, 'auto');

    const canonicalInstances = await instancesFor(db, canonical.eventId);
    expect(canonicalInstances).toHaveLength(1);
    expect(canonicalInstances[0].startAt).toEqual(T1);

    const duplicateStillExists = await db.query.events.findFirst({
      where: eq(schema.events.id, duplicate.eventId),
    });
    expect(duplicateStillExists).toBeUndefined();

    const receipt = await db.query.eventClusters.findFirst({
      where: eq(schema.eventClusters.canonicalEventId, canonical.eventId),
    });
    expect(receipt).toBeDefined();

    const links = await db.query.eventSourceLinks.findMany({
      where: eq(schema.eventSourceLinks.eventId, canonical.eventId),
    });
    expect(links).toHaveLength(2);
  });

  it("an unlocked survivor still receives the duplicate's novel instances (regression)", async () => {
    const db = await createTestDb();
    const source = await seedSource(db, 'unlock-time');
    const canonical = await seedEvent(db, source, 'canonical-unlock-time', { startAt: T1 });
    const duplicate = await seedEvent(db, source, 'duplicate-unlock-time', { startAt: T1 });
    await db.insert(schema.eventInstances).values({
      eventId: duplicate.eventId,
      sourceId: source.id,
      startAt: T2,
      timezone: 'America/Chicago',
      status: 'scheduled',
    });

    await mergeEvents(db, canonical.eventId, duplicate.eventId, FAKE_SCORE, 'auto');

    const canonicalInstances = await instancesFor(db, canonical.eventId);
    const starts = canonicalInstances.map((row) => row.startAt.getTime()).sort();
    expect(starts).toEqual([T1.getTime(), T2.getTime()]);
  });

  it("a 'venue'-locked survivor's deliberately-null venue survives backfill", async () => {
    const db = await createTestDb();
    const source = await seedSource(db, 'lock-venue');
    const canonical = await seedEvent(db, source, 'canonical-venue', { venueName: undefined });
    await db
      .update(schema.events)
      .set({ venueId: null, description: null })
      .where(eq(schema.events.id, canonical.eventId));
    await lockFields(db, canonical.eventId, ['venue']);

    const duplicate = await seedEvent(db, source, 'duplicate-venue', {
      venueName: 'Test Hall',
      description: 'An evening of jazz',
    });

    await mergeEvents(db, canonical.eventId, duplicate.eventId, FAKE_SCORE, 'auto');

    const merged = await db.query.events.findFirst({ where: eq(schema.events.id, canonical.eventId) });
    expect(merged?.venueId).toBeNull();
    expect(merged?.description).toBe('An evening of jazz');
  });

  it('an unlocked survivor still backfills venue from the duplicate (regression)', async () => {
    const db = await createTestDb();
    const source = await seedSource(db, 'unlock-venue');
    const canonical = await seedEvent(db, source, 'canonical-unlock-venue', { venueName: undefined });
    await db.update(schema.events).set({ venueId: null }).where(eq(schema.events.id, canonical.eventId));

    const duplicate = await seedEvent(db, source, 'duplicate-unlock-venue', { venueName: 'Test Hall' });
    const duplicateRow = await db.query.events.findFirst({ where: eq(schema.events.id, duplicate.eventId) });

    await mergeEvents(db, canonical.eventId, duplicate.eventId, FAKE_SCORE, 'auto');

    const merged = await db.query.events.findFirst({ where: eq(schema.events.id, canonical.eventId) });
    expect(merged?.venueId).toBe(duplicateRow?.venueId);
    expect(merged?.venueId).not.toBeNull();
  });

  it('category/vibe/audience still fill together from a tagged duplicate onto a locked survivor', async () => {
    const db = await createTestDb();
    const source = await seedSource(db, 'lock-tags');
    const canonical = await seedEvent(db, source, 'canonical-tags', { startAt: T1 });
    await lockFields(db, canonical.eventId, ['time']);

    const duplicate = await seedEvent(db, source, 'duplicate-tags', { startAt: T1 });
    await db
      .update(schema.events)
      .set({ category: 'music', vibeTags: ['jazz', 'intimate'], audienceTags: ['adults'] })
      .where(eq(schema.events.id, duplicate.eventId));

    await mergeEvents(db, canonical.eventId, duplicate.eventId, FAKE_SCORE, 'auto');

    const merged = await db.query.events.findFirst({ where: eq(schema.events.id, canonical.eventId) });
    expect(merged?.category).toBe('music');
    expect(merged?.vibeTags).toEqual(['jazz', 'intimate']);
    expect(merged?.audienceTags).toEqual(['adults']);
  });
});
