import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { assignNeighborhoods } from '@/maintenance/assign-neighborhoods';
import { createTestDb } from '../helpers/test-db';

async function seedVenue(
  db: Awaited<ReturnType<typeof createTestDb>>,
  name: string,
  normalizedName: string,
  address: string | null = null,
) {
  const [venue] = await db.insert(schema.venues).values({ name, normalizedName, address }).returning();
  return venue;
}

describe('assignNeighborhoods', () => {
  it('updates the mapped venue and reports the unmapped one', async () => {
    const db = await createTestDb();
    await seedVenue(db, 'Pabst Theater', 'pabst theater');
    await seedVenue(db, 'Mystery Venue', 'mystery venue', '123 Unknown St');
    const map = { 'pabst theater': 'Downtown' };

    const result = await assignNeighborhoods(db, map);

    expect(result.updated).toBe(1);
    expect(result.unmapped).toEqual([{ name: 'Mystery Venue', address: '123 Unknown St' }]);
    expect(result.staleKeys).toEqual([]);
    const pabst = await db.query.venues.findFirst({ where: (v, { eq }) => eq(v.normalizedName, 'pabst theater') });
    expect(pabst?.neighborhood).toBe('Downtown');
  });

  it('reports map keys that match no venue as stale', async () => {
    const db = await createTestDb();
    await seedVenue(db, 'Pabst Theater', 'pabst theater');
    const map = { 'nonexistent venue': 'Downtown' };

    const result = await assignNeighborhoods(db, map);

    expect(result.updated).toBe(0);
    expect(result.staleKeys).toEqual(['nonexistent venue']);
  });

  it('does not re-update a venue that already has the mapped neighborhood', async () => {
    const db = await createTestDb();
    await seedVenue(db, 'Pabst Theater', 'pabst theater');
    const map = { 'pabst theater': 'Downtown' };
    await assignNeighborhoods(db, map); // first pass sets it
    const result = await assignNeighborhoods(db, map); // second pass should be a no-op
    expect(result.updated).toBe(0);
  });
});
