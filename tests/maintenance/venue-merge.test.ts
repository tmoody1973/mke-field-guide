import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { mergeVenues } from '@/maintenance/merge-venues';
import { createTestDb } from '../helpers/test-db';

describe('mergeVenues', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  async function seedVenue(values: Partial<typeof schema.venues.$inferInsert> & { name: string; normalizedName: string }) {
    const [venue] = await db.insert(schema.venues).values(values).returning();
    return venue;
  }

  async function seedEventAt(venueId: string, slug: string) {
    const [event] = await db
      .insert(schema.events)
      .values({ slug, title: slug, normalizedTitle: slug, venueId })
      .returning();
    return event;
  }

  it('repoints events, backfills survivor nulls (incl. neighborhood), records the alias, deletes the duplicate', async () => {
    const keep = await seedVenue({ name: 'Cactus Club', normalizedName: 'cactus club', slug: 'cactus-club' });
    const absorb = await seedVenue({
      name: 'Cactus Club - 2496 S Wentworth Ave',
      normalizedName: 'cactus club 2496 s wentworth ave',
      address: '2496 S Wentworth Ave',
      neighborhood: 'Bay View',
      slug: 'cactus-club-2496-s-wentworth-ave',
    });
    await seedEventAt(absorb.id, 'show-at-variant');
    await seedEventAt(keep.id, 'show-at-canonical');

    const result = await mergeVenues(db, keep.id, absorb.id);

    expect(result.eventsRepointed).toBe(1);
    const survivor = await db.query.venues.findFirst({ where: eq(schema.venues.id, keep.id) });
    // Landmine guard: the survivor inherits the variant's neighborhood + address (its own were null)
    expect(survivor).toMatchObject({ neighborhood: 'Bay View', address: '2496 S Wentworth Ave', slug: 'cactus-club' });
    expect(await db.query.venues.findFirst({ where: eq(schema.venues.id, absorb.id) })).toBeUndefined();
    const alias = await db.query.venueAliases.findFirst({
      where: eq(schema.venueAliases.normalizedName, 'cactus club 2496 s wentworth ave'),
    });
    expect(alias?.venueId).toBe(keep.id);
    const moved = await db.query.events.findFirst({ where: eq(schema.events.slug, 'show-at-variant') });
    expect(moved?.venueId).toBe(keep.id);
  });

  it('survivor values win over duplicate values (COALESCE, not overwrite)', async () => {
    const keep = await seedVenue({ name: 'Pabst Theater', normalizedName: 'pabst theater', neighborhood: 'Downtown' });
    const absorb = await seedVenue({ name: 'The Pabst Theater', normalizedName: 'the pabst theater', neighborhood: 'WRONG' });
    await mergeVenues(db, keep.id, absorb.id);
    const survivor = await db.query.venues.findFirst({ where: eq(schema.venues.id, keep.id) });
    expect(survivor?.neighborhood).toBe('Downtown');
  });

  it('re-run converges: merging an already-absorbed pair is a clean no-op envelope', async () => {
    const keep = await seedVenue({ name: 'Turner Hall', normalizedName: 'turner hall' });
    const absorb = await seedVenue({ name: 'Turner Hall Ballroom', normalizedName: 'turner hall ballroom' });
    await mergeVenues(db, keep.id, absorb.id);
    await expect(mergeVenues(db, keep.id, absorb.id)).rejects.toThrow(/not found/i);
    // (the CLI surfaces this as "absorb venue not found — already merged?"; the alias row persists)
  });

  it('refuses to merge a venue into itself', async () => {
    const keep = await seedVenue({ name: 'Vivarium', normalizedName: 'vivarium' });
    await expect(mergeVenues(db, keep.id, keep.id)).rejects.toThrow(/itself/i);
  });
});
