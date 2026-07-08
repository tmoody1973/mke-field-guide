import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { loadCardMeta } from '@/lib/card-data';
import { createTestDb } from '../helpers/test-db';

async function seedEventWithVenue(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [venue] = await db.insert(schema.venues).values({
    name: 'Cathedral Square Park',
    normalizedName: 'cathedral square park',
    neighborhood: 'Downtown',
  }).returning();
  const [event] = await db.insert(schema.events).values({
    slug: 'jazz-in-the-park-abc12345',
    title: 'Jazz in the Park',
    normalizedTitle: 'jazz in the park',
    status: 'scheduled',
    category: 'music',
    isFree: true,
    isStationEvent: true,
    priceMin: null,
    priceMax: null,
    audienceTags: ['all-ages', 'family'],
    venueId: venue.id,
  }).returning();
  return { venue, event };
}

describe('loadCardMeta', () => {
  it('hydrates card fields for a set of event IDs, joining the venue', async () => {
    const db = await createTestDb();
    const { venue, event } = await seedEventWithVenue(db);

    const result = await loadCardMeta(db, [event.id]);

    expect(result.size).toBe(1);
    expect(result.get(event.id)).toEqual({
      eventId: event.id,
      slug: 'jazz-in-the-park-abc12345',
      title: 'Jazz in the Park',
      venueName: venue.name,
      neighborhood: venue.neighborhood,
      category: 'music',
      status: 'scheduled',
      isFree: true,
      priceMin: null,
      priceMax: null,
      audienceTags: ['all-ages', 'family'],
      isStationEvent: true,
    });
  });

  it('returns an empty map for an empty ID list without querying', async () => {
    const db = await createTestDb();
    const result = await loadCardMeta(db, []);
    expect(result).toEqual(new Map());
  });
});
