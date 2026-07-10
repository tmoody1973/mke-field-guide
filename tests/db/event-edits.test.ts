import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('migration 0015 surfaces', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('events.lockedFields defaults to an empty array', async () => {
    const [event] = await db
      .insert(schema.events)
      .values({ slug: 'lock-default', title: 'Lock Default', normalizedTitle: 'lock default' })
      .returning();
    expect(event.lockedFields).toEqual([]);
  });

  it('sources.lastRunId is writable and nullable', async () => {
    const [source] = await db
      .insert(schema.sources)
      .values({ key: 'run-id-src', name: 'Run Id', url: 'https://x.test', adapterType: 'ical', config: {} })
      .returning();
    expect(source.lastRunId).toBeNull();
    await db.update(schema.sources).set({ lastRunId: 'run_abc123' }).where(eq(schema.sources.id, source.id));
    const updated = await db.query.sources.findFirst({ where: eq(schema.sources.id, source.id) });
    expect(updated?.lastRunId).toBe('run_abc123');
  });

  it('event_edits rows cascade away with their event', async () => {
    const [event] = await db
      .insert(schema.events)
      .values({ slug: 'edit-cascade', title: 'Edit Cascade', normalizedTitle: 'edit cascade' })
      .returning();
    await db.insert(schema.eventEdits).values({
      eventId: event.id,
      editedBy: 'tarik@radiomilwaukee.org',
      field: 'title',
      oldValue: 'Old',
      newValue: 'New',
    });
    await db.delete(schema.events).where(eq(schema.events.id, event.id));
    const orphans = await db.query.eventEdits.findMany({ where: eq(schema.eventEdits.eventId, event.id) });
    expect(orphans).toEqual([]);
  });
});
