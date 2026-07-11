import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { mergeVenuesWithDb } from '@/app/actions/admin-venues';
import { createTestDb } from '../helpers/test-db';

describe('mergeVenuesWithDb', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('merges via the shared core and reports the repoint count', async () => {
    const [keep] = await db.insert(schema.venues).values({ name: 'A', normalizedName: 'venue a' }).returning();
    const [absorb] = await db.insert(schema.venues).values({ name: 'B', normalizedName: 'venue b' }).returning();
    await db.insert(schema.events).values({ slug: 'atb', title: 'x', normalizedTitle: 'x', venueId: absorb.id });
    const result = await mergeVenuesWithDb(db, { keepId: keep.id, absorbId: absorb.id });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/1 event/);
    expect(await db.query.venues.findFirst({ where: eq(schema.venues.id, absorb.id) })).toBeUndefined();
  });

  it('rejects same-venue and invalid ids with envelopes, not throws', async () => {
    const [venue] = await db.insert(schema.venues).values({ name: 'C', normalizedName: 'venue c' }).returning();
    expect((await mergeVenuesWithDb(db, { keepId: venue.id, absorbId: venue.id })).ok).toBe(false);
    expect((await mergeVenuesWithDb(db, { keepId: 'nope', absorbId: venue.id })).ok).toBe(false);
  });
});
