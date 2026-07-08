import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { getEventBySlug } from '@/queries/event-detail';
import { createTestDb } from '../helpers/test-db';

async function seedEventWithInstancesAndSource(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [venue] = await db.insert(schema.venues).values({
    name: 'Cathedral Square Park',
    normalizedName: 'cathedral square park',
    neighborhood: 'Downtown',
  }).returning();
  const [source] = await db.insert(schema.sources).values({
    key: 'easttown',
    name: 'East Town Association',
    url: 'https://easttown.com',
    adapterType: 'html',
  }).returning();
  const [event] = await db.insert(schema.events).values({
    slug: 'jazz-in-the-park-abc12345',
    title: 'Jazz in the Park',
    normalizedTitle: 'jazz in the park',
    status: 'scheduled',
    category: 'music',
    venueId: venue.id,
  }).returning();
  await db.insert(schema.eventInstances).values([
    { eventId: event.id, startAt: new Date('2020-01-01T20:00:00Z') },
    { eventId: event.id, startAt: new Date('2099-01-01T20:00:00Z') },
  ]);
  await db.insert(schema.eventSourceLinks).values({
    eventId: event.id,
    sourceId: source.id,
    sourceEventId: 'jazz-2026',
    isCanonical: true,
  });
  return { venue, event, source };
}

describe('getEventBySlug', () => {
  it('returns only future instances and resolves the canonical source name', async () => {
    const db = await createTestDb();
    const { venue, event, source } = await seedEventWithInstancesAndSource(db);

    const result = await getEventBySlug(db, event.slug);

    expect(result).not.toBeNull();
    expect(result?.event.id).toBe(event.id);
    expect(result?.venue?.id).toBe(venue.id);
    expect(result?.instances).toHaveLength(1);
    expect(result?.instances[0].startAt.toISOString()).toBe('2099-01-01T20:00:00.000Z');
    expect(result?.sourceName).toBe(source.name);
  });

  it('returns null for an unknown slug', async () => {
    const db = await createTestDb();
    const result = await getEventBySlug(db, 'does-not-exist');
    expect(result).toBeNull();
  });
});
