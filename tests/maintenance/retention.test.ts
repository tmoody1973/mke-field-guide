import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { runRetention } from '@/maintenance/retention';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { createTestDb } from '../helpers/test-db';

const NOW = new Date('2026-07-07T12:00:00Z');
const OLD = new Date('2026-03-01T00:00:00Z'); // > 90 days before NOW
const RECENT = new Date('2026-07-01T00:00:00Z');

async function seedSource(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [row] = await db.insert(schema.sources).values({
    key: 's1', name: 'S1', url: 'https://s1.example', adapterType: 'ical', config: {},
  }).returning();
  return { id: row.id, key: row.key };
}

function normalized(id: string, startAt: Date) {
  return {
    sourceEventId: id, title: `Event ${id}`, startAt,
    timezone: 'America/Chicago', status: 'scheduled' as const,
  };
}

describe('runRetention', () => {
  it('deletes long-passed instances and the events they leave empty', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    await persistNormalizedEvent(db, source, normalized('old-1', OLD));
    await persistNormalizedEvent(db, source, normalized('new-1', RECENT));
    const result = await runRetention(db, NOW);
    expect(result.instancesDeleted).toBe(1);
    expect(result.eventsDeleted).toBe(1);
    expect(await db.query.events.findMany()).toHaveLength(1);
    expect(await db.query.eventSourceLinks.findMany()).toHaveLength(1); // cascade cleaned the old link
  });

  it('keeps a multi-instance event alive while only its passed instance is pruned', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    await persistNormalizedEvent(db, source, normalized('multi-1', OLD));
    await persistNormalizedEvent(db, source, { ...normalized('multi-1', RECENT) });
    const result = await runRetention(db, NOW);
    expect(result.instancesDeleted).toBe(1);
    expect(result.eventsDeleted).toBe(0);
    expect(await db.query.events.findMany()).toHaveLength(1);
  });

  it('prunes superseded raw payloads older than 30 days but always keeps the newest', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const base = {
      sourceId: source.id, sourceEventId: 'raw-1', extractionMethod: 'ical',
    };
    await db.insert(schema.rawEvents).values([
      { ...base, payload: { v: 1 }, contentHash: 'h1', extractedAt: new Date('2026-04-01T00:00:00Z') },
      { ...base, payload: { v: 2 }, contentHash: 'h2', extractedAt: new Date('2026-05-01T00:00:00Z') },
      { ...base, payload: { v: 3 }, contentHash: 'h3', extractedAt: new Date('2026-07-06T00:00:00Z') },
    ]);
    const result = await runRetention(db, NOW);
    expect(result.rawEventsDeleted).toBe(2);
    const remaining = await db.query.rawEvents.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].contentHash).toBe('h3');
  });
});
