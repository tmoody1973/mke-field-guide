import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { createOrAdoptEvent, persistNormalizedEvent } from '@/ingestion/persist';
import { normalizedEventSchema } from '@/lib/validation/normalized-event';
import { createTestDb } from '../helpers/test-db';

async function seedSource(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [source] = await db
    .insert(schema.sources)
    .values({ key: 'test', name: 'Test Source', url: 'https://example.com', adapterType: 'ical' })
    .returning();
  return source;
}

const sample = normalizedEventSchema.parse({
  sourceEventId: 'locked-1',
  title: 'Source Title',
  venueName: 'Cathedral Square Park',
  venueAddress: 'Cathedral Square Park, 520 E Wells St, Milwaukee, WI 53202',
  url: 'https://urbanmilwaukee.com/event/locked-1/',
  startAt: '2026-07-11T00:00:00.000Z',
  endAt: '2026-07-11T03:00:00.000Z',
});

describe('locked fields survive re-ingestion', () => {
  it('a locked title is not overwritten; unlocked fields still update', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };

    const first = await persistNormalizedEvent(db, ref, sample);
    const [beforeLock] = await db.query.events.findMany();
    expect(beforeLock.title).toBe('Source Title'); // precondition: source-written before any lock

    await db
      .update(schema.events)
      .set({ lockedFields: ['title'], title: 'Admin Title', normalizedTitle: 'admin title' })
      .where(eq(schema.events.id, first.eventId));

    await persistNormalizedEvent(db, ref, {
      ...sample,
      title: 'Source Title v2',
      imageUrl: 'https://example.com/new-image.jpg',
    });

    const [event] = await db.query.events.findMany();
    expect(event.title).toBe('Admin Title'); // lock held
    expect(event.imageUrl).toBe('https://example.com/new-image.jpg'); // unlocked column still updates
  });

  it('a locked venue is not overwritten', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };

    const first = await persistNormalizedEvent(db, ref, sample);
    const [beforeLock] = await db.query.events.findMany();
    expect(beforeLock.venueId).not.toBeNull(); // precondition: source-assigned venue before lock

    await db
      .update(schema.events)
      .set({ lockedFields: ['venue'], venueId: null })
      .where(eq(schema.events.id, first.eventId));

    await persistNormalizedEvent(db, ref, {
      ...sample,
      title: 'Source Title v2',
      venueName: 'Cathedral Square Park',
    });

    const [event] = await db.query.events.findMany();
    expect(event.venueId).toBeNull(); // lock held: admin's cleared venue survives
    expect(event.title).toBe('Source Title v2'); // unlocked column still updates
  });

  it("a 'time' lock freezes instances: no upsert, no supersede", async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };

    const first = await persistNormalizedEvent(db, ref, sample);
    const preLockInstances = await db.query.eventInstances.findMany({
      where: eq(schema.eventInstances.eventId, first.eventId),
    });
    expect(preLockInstances).toHaveLength(1);
    expect(preLockInstances[0].startAt.toISOString()).toBe(sample.startAt.toISOString());

    const adminMovedStartAt = new Date('2026-07-15T00:00:00.000Z');
    await db
      .update(schema.eventInstances)
      .set({ startAt: adminMovedStartAt })
      .where(eq(schema.eventInstances.eventId, first.eventId));
    await db
      .update(schema.events)
      .set({ lockedFields: ['time'] })
      .where(eq(schema.events.id, first.eventId));

    await persistNormalizedEvent(db, ref, sample, { supersede: true });

    const instances = await db.query.eventInstances.findMany({
      where: eq(schema.eventInstances.eventId, first.eventId),
    });
    expect(instances).toHaveLength(1); // no upsert recreated the source's T1, no supersede touched anything
    expect(instances[0].startAt.toISOString()).toBe(adminMovedStartAt.toISOString());
  });

  it('an event with no locks behaves byte-identically to today', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };

    const first = await persistNormalizedEvent(db, ref, sample);
    const movedStartAt = new Date('2026-07-20T00:00:00.000Z');
    await persistNormalizedEvent(
      db,
      ref,
      { ...sample, title: 'Source Title v2', startAt: movedStartAt },
      { supersede: true },
    );

    const [event] = await db.query.events.findMany();
    expect(event.title).toBe('Source Title v2'); // full overwrite, no lock

    const instances = await db.query.eventInstances.findMany({
      where: eq(schema.eventInstances.eventId, first.eventId),
    });
    expect(instances).toHaveLength(1); // instance replacement, not additive
    expect(instances[0].startAt.toISOString()).toBe(movedStartAt.toISOString());
  });

  it('the adopt-path race respects locks', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };

    const n = { ...sample, sourceEventId: 'race-locked-1' };
    const first = await persistNormalizedEvent(db, ref, n);

    await db
      .update(schema.events)
      .set({ lockedFields: ['title'], title: 'Admin Locked Title', normalizedTitle: 'admin locked title' })
      .where(eq(schema.events.id, first.eventId));

    // Simulate the race: a second worker missed the link lookup and calls the create path directly.
    const second = await createOrAdoptEvent(db, ref, { ...n, title: 'Race Title (from source)' }, null);

    expect(second.eventId).toBe(first.eventId);
    expect(second.created).toBe(false);
    const [event] = await db.query.events.findMany();
    expect(event.title).toBe('Admin Locked Title'); // adopt path respects the lock too
  });
});
