import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { loadVenueCoords } from '@/queries/venue-coords';
import { createTestDb } from '../helpers/test-db';

async function seedVenue(
  db: Awaited<ReturnType<typeof createTestDb>>,
  overrides: Partial<typeof schema.venues.$inferInsert> = {},
) {
  const [venue] = await db
    .insert(schema.venues)
    .values({
      name: overrides.name ?? 'Test Venue',
      normalizedName: overrides.normalizedName ?? `test venue ${Math.random()}`,
      ...overrides,
    })
    .returning();
  return venue;
}

async function seedRegistryRow(
  db: Awaited<ReturnType<typeof createTestDb>>,
  id: string,
  lat: string,
  lon: string,
) {
  await db.insert(schema.venueRegistry).values({
    id,
    name: 'Registry Place',
    lat,
    lon,
  });
}

describe('loadVenueCoords', () => {
  it('returns an empty map for an empty ID list without querying', async () => {
    const db = await createTestDb();
    const result = await loadVenueCoords(db, []);
    expect(result).toEqual(new Map());
  });

  it("own lat/lng wins over registry when both are present", async () => {
    const db = await createTestDb();
    await seedRegistryRow(db, 'gers-1', '43.999', '-87.999');
    const venue = await seedVenue(db, {
      registryId: 'gers-1',
      lat: '43.0389',
      lng: '-87.9065',
    });

    const result = await loadVenueCoords(db, [venue.id]);

    expect(result.get(venue.id)).toEqual({ lat: 43.0389, lng: -87.9065 });
  });

  it('falls back to registry coords when own coords are null and registry_id is annotated', async () => {
    const db = await createTestDb();
    await seedRegistryRow(db, 'gers-2', '43.05', '-87.9');
    const venue = await seedVenue(db, {
      registryId: 'gers-2',
      lat: null,
      lng: null,
    });

    const result = await loadVenueCoords(db, [venue.id]);

    expect(result.get(venue.id)).toEqual({ lat: 43.05, lng: -87.9 });
  });

  it('is absent from the map when neither own coords nor a registry match exist', async () => {
    const db = await createTestDb();
    const venue = await seedVenue(db, { registryId: null, lat: null, lng: null });

    const result = await loadVenueCoords(db, [venue.id]);

    expect(result.has(venue.id)).toBe(false);
  });

  it('treats a venue with only ONE of lat/lng non-null as having no own coords, falling back to registry', async () => {
    const db = await createTestDb();
    await seedRegistryRow(db, 'gers-3', '43.1', '-87.8');
    const venue = await seedVenue(db, {
      registryId: 'gers-3',
      lat: '43.0389',
      lng: null,
    });

    const result = await loadVenueCoords(db, [venue.id]);

    expect(result.get(venue.id)).toEqual({ lat: 43.1, lng: -87.8 });
  });
});
