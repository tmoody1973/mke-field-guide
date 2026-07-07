import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { dedupSweep } from '@/dedup/sweep';
import { createTestDb } from '../helpers/test-db';

// Two sources with different confidence tiers.
async function seedSources(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [api] = await db.insert(schema.sources).values({
    key: 'tm-test', name: 'TM', url: 'https://tm.example', adapterType: 'api', config: {},
  }).returning();
  const [html] = await db.insert(schema.sources).values({
    key: 'mwf-test', name: 'MWF', url: 'https://mwf.example', adapterType: 'html', config: {},
  }).returning();
  return { api: { id: api.id, key: api.key }, html: { id: html.id, key: html.key } };
}

const FUTURE = new Date(Date.now() + 7 * 86_400_000);
FUTURE.setUTCHours(19, 0, 0, 0); // umbrella: an evening start well in the future

function normalized(sourceEventId: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceEventId,
    title,
    venueName: 'Test Hall',
    startAt: FUTURE,
    timezone: 'America/Chicago',
    status: 'scheduled' as const,
    ...overrides,
  };
}

describe('dedupSweep', () => {
  it('auto-merges an identical cross-source event onto the higher-confidence source', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const a = await persistNormalizedEvent(db, sources.api, normalized('tm-1', 'Hozier'));
    const b = await persistNormalizedEvent(db, sources.html, normalized('mwf-1', 'Hozier'));
    const result = await dedupSweep(db);
    expect(result.merged).toBe(1);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(a.eventId); // api outranks html
    const links = await db.query.eventSourceLinks.findMany({
      where: eq(schema.eventSourceLinks.eventId, a.eventId),
    });
    expect(links).toHaveLength(2); // provenance preserved
    const clusters = await db.query.eventClusters.findMany();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].canonicalEventId).toBe(a.eventId);
    void b;
  });

  it('keeps per-source day instances intact after a merge', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const dayTwo = new Date(FUTURE.getTime() + 86_400_000);
    await persistNormalizedEvent(db, sources.html, normalized('fest-1', 'Big Fest'));
    await persistNormalizedEvent(db, sources.html, normalized('fest-1', 'Big Fest', { startAt: dayTwo }));
    await persistNormalizedEvent(db, sources.api, normalized('tm-2', 'Big Fest'));
    await dedupSweep(db);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    const instances = await db.query.eventInstances.findMany();
    // html day 1 + html day 2 + api day 1 (same startAt as html day 1 collapses on the unique index)
    expect(instances.length).toBe(2);
    expect(new Set(instances.map((i) => i.startAt.toISOString())).size).toBe(2);
  });

  it('queues an ambiguous pair for review instead of merging', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const midnight = new Date(FUTURE);
    midnight.setUTCHours(5, 0, 0, 0); // 00:00 America/Chicago (CDT) — placeholder time
    await persistNormalizedEvent(db, sources.api, normalized('tm-3', 'Khruangbin', { venueName: 'Amphitheater' }));
    await persistNormalizedEvent(db, sources.html, normalized('mwf-3', 'Khruangbin', {
      venueName: 'Festival Park', startAt: midnight,
    }));
    const result = await dedupSweep(db);
    expect(result.merged).toBe(0);
    expect(result.queued).toBe(1);
    const reviews = await db.query.eventReviews.findMany();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].status).toBe('pending');
    expect(await db.query.events.findMany()).toHaveLength(2);
  });

  it('is idempotent: a second sweep neither re-merges nor re-queues', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    await persistNormalizedEvent(db, sources.api, normalized('tm-4', 'Same Show'));
    await persistNormalizedEvent(db, sources.html, normalized('mwf-4', 'Same Show'));
    await dedupSweep(db);
    const again = await dedupSweep(db);
    expect(again.merged).toBe(0);
    expect(again.queued).toBe(0);
    expect(await db.query.eventClusters.findMany()).toHaveLength(1);
  });

  it('never pairs two events from the same source', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    await persistNormalizedEvent(db, sources.api, normalized('tm-5', 'Twin Show'));
    await persistNormalizedEvent(db, sources.api, normalized('tm-6', 'Twin Show'));
    const result = await dedupSweep(db);
    expect(result.merged).toBe(0);
    expect(result.queued).toBe(0);
  });
});
