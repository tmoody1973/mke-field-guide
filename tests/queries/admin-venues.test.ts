import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { adminVenueList, pendingVenueSuggestions } from '@/queries/admin-venues';
import { createTestDb } from '../helpers/test-db';

describe('adminVenueList', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
    const [zeta] = await db.insert(schema.venues)
      .values({ name: 'Zeta Hall', normalizedName: 'zeta hall', neighborhood: 'Downtown' }).returning();
    await db.insert(schema.venues).values({ name: 'Alpha Room', normalizedName: 'alpha room' });
    await db.insert(schema.events).values([
      { slug: 'z1', title: 'Z1', normalizedTitle: 'z1', venueId: zeta.id },
      { slug: 'z2', title: 'Z2', normalizedTitle: 'z2', venueId: zeta.id },
    ]);
  });

  it('returns name-ordered venues with event counts and neighborhoods', async () => {
    const rows = await adminVenueList(db);
    expect(rows.map((r) => r.name)).toEqual(['Alpha Room', 'Zeta Hall']);
    expect(rows.find((r) => r.name === 'Zeta Hall')).toMatchObject({ eventCount: 2, neighborhood: 'Downtown' });
    expect(rows.find((r) => r.name === 'Alpha Room')?.eventCount).toBe(0);
  });
});

describe('pendingVenueSuggestions', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('carries names/counts and excludes dismissed', async () => {
    const [keep] = await db.insert(schema.venues)
      .values({ name: 'The Cactus Club', normalizedName: 'the cactus club' }).returning();
    const [absorb] = await db.insert(schema.venues)
      .values({ name: 'Cactus Club', normalizedName: 'cactus club' }).returning();
    await db.insert(schema.events).values([
      { slug: 'sug-k1', title: 'K1', normalizedTitle: 'k1', venueId: keep.id },
      { slug: 'sug-k2', title: 'K2', normalizedTitle: 'k2', venueId: keep.id },
      { slug: 'sug-a1', title: 'A1', normalizedTitle: 'a1', venueId: absorb.id },
    ]);
    const [pending] = await db.insert(schema.venueMergeSuggestions).values({
      keepVenueId: keep.id,
      absorbVenueId: absorb.id,
      confidence: '0.8700',
      rationale: 'Same address, minor name variant.',
    }).returning();

    const [otherKeep] = await db.insert(schema.venues)
      .values({ name: 'Turner Hall', normalizedName: 'turner hall' }).returning();
    const [otherAbsorb] = await db.insert(schema.venues)
      .values({ name: 'Turner Hall Ballroom', normalizedName: 'turner hall ballroom' }).returning();
    await db.insert(schema.venueMergeSuggestions).values({
      keepVenueId: otherKeep.id,
      absorbVenueId: otherAbsorb.id,
      confidence: '0.6000',
      rationale: 'Dismissed already.',
      status: 'dismissed',
    });

    const rows = await pendingVenueSuggestions(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      suggestionId: pending.id,
      keepVenueId: keep.id,
      keepName: 'The Cactus Club',
      keepEventCount: 2,
      absorbVenueId: absorb.id,
      absorbName: 'Cactus Club',
      absorbEventCount: 1,
      confidence: 0.87,
      rationale: 'Same address, minor name variant.',
    });
  });
});
