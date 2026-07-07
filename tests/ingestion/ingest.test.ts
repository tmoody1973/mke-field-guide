import { describe, expect, test } from 'vitest';
import * as schema from '@/db/schema';
import type { FetchedRecord, SourceAdapter } from '@/ingestion/adapters/types';
import { ingestSource } from '@/ingestion/ingest';
import { normalizedEventSchema } from '@/lib/validation/normalized-event';
import { createTestDb } from '../helpers/test-db';

function stubAdapter(records: FetchedRecord[], normalizeValid: boolean): SourceAdapter {
  return {
    adapterType: 'ical',
    fetch: async () => records,
    normalize: (record) =>
      normalizeValid
        ? normalizedEventSchema.parse({
            sourceEventId: record.sourceEventId,
            title: `Event ${record.sourceEventId}`,
            startAt: '2026-08-01T00:00:00.000Z',
          })
        : null,
  };
}

const recordsFixture: FetchedRecord[] = [
  { sourceEventId: 'a', payload: { uid: 'a' } },
  { sourceEventId: 'b', payload: { uid: 'b' } },
];

async function seedSource(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [source] = await db
    .insert(schema.sources)
    .values({ key: 'stub', name: 'Stub', url: 'https://x', adapterType: 'ical' })
    .returning();
  return source;
}

describe('ingestSource', () => {
  test('publishes valid records and marks source ok', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const result = await ingestSource(db, source, stubAdapter(recordsFixture, true));
    expect(result).toEqual({ fetched: 2, published: 2, skipped: 0 });
    const updated = await db.query.sources.findFirst();
    expect(updated?.healthStatus).toBe('ok');
    expect(updated?.lastFetchAt).not.toBeNull();
    expect(await db.query.rawEvents.findMany()).toHaveLength(2);
    expect(await db.query.events.findMany()).toHaveLength(2);
  });

  test('marks source failing when every record skips normalization', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const result = await ingestSource(db, source, stubAdapter(recordsFixture, false));
    expect(result).toEqual({ fetched: 2, published: 0, skipped: 2 });
    const updated = await db.query.sources.findFirst();
    expect(updated?.healthStatus).toBe('failing');
    expect(updated?.lastError).toBe('all records skipped normalization');
  });

  test('empty feed is ok, not failing', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const result = await ingestSource(db, source, stubAdapter([], true));
    expect(result).toEqual({ fetched: 0, published: 0, skipped: 0 });
    expect((await db.query.sources.findFirst())?.healthStatus).toBe('ok');
  });

  test('adapter throw marks failing and rethrows original error', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const boom: SourceAdapter = {
      adapterType: 'ical',
      fetch: async () => {
        throw new Error('feed exploded');
      },
      normalize: () => null,
    };
    await expect(ingestSource(db, source, boom)).rejects.toThrow('feed exploded');
    const updated = await db.query.sources.findFirst();
    expect(updated?.healthStatus).toBe('failing');
    expect(updated?.lastError).toContain('feed exploded');
  });

  test('re-ingesting identical payloads stores no duplicate raw events', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    await ingestSource(db, source, stubAdapter(recordsFixture, true));
    await ingestSource(db, source, stubAdapter(recordsFixture, true));
    expect(await db.query.rawEvents.findMany()).toHaveLength(2);
    expect(await db.query.events.findMany()).toHaveLength(2);
  });

  test('rescheduled event ends with a single updated instance', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const at = (iso: string): SourceAdapter => ({
      adapterType: 'ical',
      fetch: async () => [{ sourceEventId: 'a', payload: {} }],
      normalize: () =>
        normalizedEventSchema.parse({ sourceEventId: 'a', title: 'Movable Feast', startAt: iso }),
    });
    await ingestSource(db, source, at('2026-08-01T00:00:00.000Z'));
    await ingestSource(db, source, at('2026-08-02T00:00:00.000Z'));
    const instances = await db.query.eventInstances.findMany();
    expect(instances).toHaveLength(1);
    expect(instances[0].startAt.toISOString()).toBe('2026-08-02T00:00:00.000Z');
  });
});
