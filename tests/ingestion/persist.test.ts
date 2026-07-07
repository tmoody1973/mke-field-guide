import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent, type Db } from '@/ingestion/persist';
import { normalizedEventSchema } from '@/lib/validation/normalized-event';
import { createTestDb } from '../helpers/test-db';

/** Delegates everything to the real db, but throws on insert into eventSourceLinks. */
function withFailingLinkInsert(db: Db): Db {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'insert') {
        return (table: unknown) => {
          if (table === schema.eventSourceLinks) {
            throw new Error('simulated link insert failure');
          }
          return target.insert(table as typeof schema.events);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function seedSource(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [source] = await db
    .insert(schema.sources)
    .values({ key: 'test', name: 'Test Source', url: 'https://example.com', adapterType: 'ical' })
    .returning();
  return source;
}

async function seedSecondSource(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [source] = await db
    .insert(schema.sources)
    .values({ key: 'test-2', name: 'Test Source 2', url: 'https://example2.com', adapterType: 'ical' })
    .returning();
  return source;
}

const sample = normalizedEventSchema.parse({
  sourceEventId: '12345@urbanmilwaukee.com',
  title: 'Jazz in the Park',
  venueName: 'Cathedral Square Park',
  venueAddress: 'Cathedral Square Park, 520 E Wells St, Milwaukee, WI 53202',
  url: 'https://urbanmilwaukee.com/event/jazz-in-the-park/',
  startAt: '2026-07-11T00:00:00.000Z',
  endAt: '2026-07-11T03:00:00.000Z',
});

describe('persistNormalizedEvent', () => {
  test('first ingest creates event, venue, instance, and source link', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);

    const result = await persistNormalizedEvent(db, { id: source.id, key: 'test' }, sample);

    expect(result.created).toBe(true);
    expect(await db.query.events.findMany()).toHaveLength(1);
    expect(await db.query.venues.findMany()).toHaveLength(1);
    expect(await db.query.eventInstances.findMany()).toHaveLength(1);
    expect(await db.query.eventSourceLinks.findMany()).toHaveLength(1);
  });

  test('re-ingesting the same record is idempotent and updates fields', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);

    await persistNormalizedEvent(db, { id: source.id, key: 'test' }, sample);
    const updated = { ...sample, title: 'Jazz in the Park (Rescheduled)' };
    const result = await persistNormalizedEvent(db, { id: source.id, key: 'test' }, updated);

    expect(result.created).toBe(false);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Jazz in the Park (Rescheduled)');
    expect(await db.query.eventInstances.findMany()).toHaveLength(1);
  });

  test('two events at the same venue share one venue row', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);

    await persistNormalizedEvent(db, { id: source.id, key: 'test' }, sample);
    await persistNormalizedEvent(db, { id: source.id, key: 'test' }, {
      ...sample,
      sourceEventId: 'other@urbanmilwaukee.com',
      title: 'Another Concert',
      venueName: 'Cathedral  Square Park', // extra whitespace, same normalized name
    });

    expect(await db.query.venues.findMany()).toHaveLength(1);
    expect(await db.query.events.findMany()).toHaveLength(2);
  });

  test('event without venue persists with null venueId', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);

    await persistNormalizedEvent(db, { id: source.id, key: 'test' }, {
      ...sample,
      venueName: undefined,
      venueAddress: undefined,
    });

    const [event] = await db.query.events.findMany();
    expect(event.venueId).toBeNull();
  });

  test('create path cleans up the event row when the source link insert fails', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const failingDb = withFailingLinkInsert(db);

    await expect(
      persistNormalizedEvent(failingDb, { id: source.id, key: 'test' }, sample),
    ).rejects.toThrow('simulated link insert failure');

    expect(await db.query.events.findMany()).toHaveLength(0);
    expect(await db.query.eventSourceLinks.findMany()).toHaveLength(0);
    expect(await db.query.eventInstances.findMany()).toHaveLength(0);
  });

  test('supersede replaces a rescheduled instance instead of duplicating', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };
    await persistNormalizedEvent(db, ref, sample, { supersede: true });
    const moved = { ...sample, startAt: new Date('2026-07-12T00:00:00.000Z') };
    await persistNormalizedEvent(db, ref, moved, { supersede: true });
    const instances = await db.query.eventInstances.findMany();
    expect(instances).toHaveLength(1);
    expect(instances[0].startAt.toISOString()).toBe('2026-07-12T00:00:00.000Z');
  });

  test('without supersede, a second start time adds an instance (legacy behavior)', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };
    await persistNormalizedEvent(db, ref, sample);
    await persistNormalizedEvent(db, ref, { ...sample, startAt: new Date('2026-07-12T00:00:00.000Z') });
    expect(await db.query.eventInstances.findMany()).toHaveLength(2);
  });

  test('same sourceEventId from different sources produces different slugs', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const [source2] = await db
      .insert(schema.sources)
      .values({ key: 'other', name: 'Other', url: 'https://y', adapterType: 'ical' })
      .returning();
    await persistNormalizedEvent(db, { id: source.id, key: 'test' }, sample);
    await persistNormalizedEvent(db, { id: source2.id, key: 'other' }, sample);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(2);
    expect(events[0].slug).not.toBe(events[1].slug);
  });

  test('venue insert survives a pre-existing normalized name (race-safe path)', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    await db.insert(schema.venues).values({
      name: 'Cathedral Square Park',
      normalizedName: 'cathedral square park',
    });
    await persistNormalizedEvent(db, { id: source.id, key: 'test' }, sample);
    expect(await db.query.venues.findMany()).toHaveLength(1);
  });

  test('persists venue coordinates and isFree on create', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    await persistNormalizedEvent(db, { id: source.id, key: 'test' }, {
      ...sample,
      venueName: 'Fiserv Forum',
      venueAddress: '1111 Vel R. Phillips Ave, Milwaukee, WI',
      venueLat: 43.0451,
      venueLng: -87.9172,
      isFree: false,
    });
    const [venue] = await db.query.venues.findMany();
    expect(Number(venue.lat)).toBeCloseTo(43.0451);
    const [event] = await db.query.events.findMany();
    expect(event.isFree).toBe(false);
  });

  test('re-ingest without isFree preserves the previously stored value', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };
    await persistNormalizedEvent(db, ref, { ...sample, isFree: true });
    await persistNormalizedEvent(db, ref, sample); // sample has no isFree
    const [event] = await db.query.events.findMany();
    expect(event.isFree).toBe(true);
  });

  test('adopts the existing event when a concurrent ingest wins the link race', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };
    const n = { ...sample, sourceEventId: 'race-1', title: 'Race Show' };
    const first = await persistNormalizedEvent(db, ref, n);
    // Simulate the race: a second worker that missed the link lookup calls the create path directly.
    const { createOrAdoptEvent } = await import('@/ingestion/persist');
    const second = await createOrAdoptEvent(db, ref, { ...n, title: 'Race Show (updated)' }, null);
    expect(second.eventId).toBe(first.eventId);
    expect(second.created).toBe(false);
    const allEvents = await db.query.events.findMany();
    expect(allEvents).toHaveLength(1);
    expect(allEvents[0].title).toBe('Race Show (updated)');
    const links = await db.query.eventSourceLinks.findMany();
    expect(links).toHaveLength(1);
  });

  test('stamps sourceId on upserted instances', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const result = await persistNormalizedEvent(db, { id: source.id, key: source.key }, {
      ...sample,
      sourceEventId: 'stamp-1',
    });
    const instances = await db.query.eventInstances.findMany({
      where: eq(schema.eventInstances.eventId, result.eventId),
    });
    expect(instances).toHaveLength(1);
    expect(instances[0].sourceId).toBe(source.id);
  });

  test("supersede only deletes the ingesting source's other instances", async () => {
    const db = await createTestDb();
    const sourceA = await seedSource(db);
    const sourceB = await seedSecondSource(db);
    const refA = { id: sourceA.id, key: sourceA.key };
    // sourceA persists the event with two different startAts (no supersede)
    const n1 = { ...sample, sourceEventId: 'multi-1', startAt: new Date('2026-08-01T00:00:00.000Z') };
    const { eventId } = await persistNormalizedEvent(db, refA, n1);
    await persistNormalizedEvent(db, refA, { ...n1, startAt: new Date('2026-08-02T00:00:00.000Z') });
    // a consolidated instance from sourceB sits on the same event (post-dedup state)
    await db.insert(schema.eventInstances).values({
      eventId,
      sourceId: sourceB.id,
      startAt: new Date('2026-08-03T00:00:00.000Z'),
    });
    // sourceA re-ingests with supersede at a new time
    await persistNormalizedEvent(db, refA, { ...n1, startAt: new Date('2026-08-05T00:00:00.000Z') }, {
      supersede: true,
    });
    const instances = await db.query.eventInstances.findMany({
      where: eq(schema.eventInstances.eventId, eventId),
    });
    const bySource = new Map(instances.map((instance) => [instance.sourceId, instance.startAt.toISOString()]));
    expect(instances).toHaveLength(2);
    expect(bySource.get(sourceA.id)).toBe('2026-08-05T00:00:00.000Z');
    expect(bySource.get(sourceB.id)).toBe('2026-08-03T00:00:00.000Z');
  });

  test('re-ingest via a non-canonical link updates lastSeenAt but not the event, and still upserts the instance', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };
    const n = { ...sample, sourceEventId: 'merged-1' };
    const first = await persistNormalizedEvent(db, ref, n);

    // Simulate the post-merge state: dedup repoints a duplicate's link onto the
    // canonical event and marks it non-canonical (src/dedup/merge.ts).
    const [linkBeforeFlip] = await db.query.eventSourceLinks.findMany({
      where: eq(schema.eventSourceLinks.eventId, first.eventId),
    });
    await db
      .update(schema.eventSourceLinks)
      .set({ isCanonical: false, lastSeenAt: new Date('2020-01-01T00:00:00.000Z') })
      .where(eq(schema.eventSourceLinks.id, linkBeforeFlip.id));

    const newerStartAt = new Date('2026-07-13T00:00:00.000Z');
    const result = await persistNormalizedEvent(db, ref, {
      ...n,
      title: 'Lower Confidence Title',
      startAt: newerStartAt,
    });

    expect(result.eventId).toBe(first.eventId);
    const [event] = await db.query.events.findMany();
    expect(event.title).toBe('Jazz in the Park'); // unchanged: canonical fields must survive

    const [link] = await db.query.eventSourceLinks.findMany({
      where: eq(schema.eventSourceLinks.eventId, first.eventId),
    });
    expect(link.isCanonical).toBe(false);
    expect(link.lastSeenAt.getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00.000Z').getTime());

    const instances = await db.query.eventInstances.findMany({
      where: eq(schema.eventInstances.eventId, first.eventId),
    });
    expect(instances.some((instance) => instance.startAt.toISOString() === newerStartAt.toISOString())).toBe(true);
  });
});
