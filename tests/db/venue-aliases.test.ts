import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('migration 0016: venue_aliases', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  async function seedVenue(name: string, normalized: string) {
    const [venue] = await db
      .insert(schema.venues)
      .values({ name, normalizedName: normalized })
      .returning();
    return venue;
  }

  it('stores an alias and enforces normalized_name uniqueness', async () => {
    const venue = await seedVenue('Cactus Club', 'cactus club');
    await db.insert(schema.venueAliases).values({
      normalizedName: 'cactus club 2496 s wentworth ave',
      venueId: venue.id,
    });
    await expect(
      db.insert(schema.venueAliases).values({
        normalizedName: 'cactus club 2496 s wentworth ave',
        venueId: venue.id,
      }),
    ).rejects.toThrow();
  });

  it('aliases cascade away with their venue', async () => {
    const venue = await seedVenue('Doomed Hall', 'doomed hall');
    await db.insert(schema.venueAliases).values({ normalizedName: 'doomed hall annex', venueId: venue.id });
    await db.delete(schema.venues).where(eq(schema.venues.id, venue.id));
    const orphans = await db.query.venueAliases.findMany({
      where: eq(schema.venueAliases.normalizedName, 'doomed hall annex'),
    });
    expect(orphans).toEqual([]);
  });
});
