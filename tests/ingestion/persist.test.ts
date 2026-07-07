import { describe, expect, test } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
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

    const result = await persistNormalizedEvent(db, source.id, sample);

    expect(result.created).toBe(true);
    expect(await db.query.events.findMany()).toHaveLength(1);
    expect(await db.query.venues.findMany()).toHaveLength(1);
    expect(await db.query.eventInstances.findMany()).toHaveLength(1);
    expect(await db.query.eventSourceLinks.findMany()).toHaveLength(1);
  });

  test('re-ingesting the same record is idempotent and updates fields', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);

    await persistNormalizedEvent(db, source.id, sample);
    const updated = { ...sample, title: 'Jazz in the Park (Rescheduled)' };
    const result = await persistNormalizedEvent(db, source.id, updated);

    expect(result.created).toBe(false);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Jazz in the Park (Rescheduled)');
    expect(await db.query.eventInstances.findMany()).toHaveLength(1);
  });

  test('two events at the same venue share one venue row', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);

    await persistNormalizedEvent(db, source.id, sample);
    await persistNormalizedEvent(db, source.id, {
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

    await persistNormalizedEvent(db, source.id, {
      ...sample,
      venueName: undefined,
      venueAddress: undefined,
    });

    const [event] = await db.query.events.findMany();
    expect(event.venueId).toBeNull();
  });
});
