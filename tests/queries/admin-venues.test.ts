import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { adminVenueList } from '@/queries/admin-venues';
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
