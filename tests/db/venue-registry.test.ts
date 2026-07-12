import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('migration 0019: venue registry + annotation columns', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('registry rows round-trip and the trigram index answers similarity queries', async () => {
    await db.insert(schema.venueRegistry).values({
      id: '08f2baa6d2c54e5b0399cb9f5f3a1b2c',
      name: 'Shank Hall',
      category: 'music_venue',
      address: '1434 N Farwell Ave',
      locality: 'Milwaukee',
      lon: '-87.8934',
      lat: '43.0521',
      confidence: '0.99',
    });
    const rows = await db.execute(sql`
      SELECT id, similarity(lower(name), 'shank hall') AS sim FROM venue_registry
      WHERE similarity(lower(name), 'shank hall') > 0.9
    `);
    expect(rows.rows).toHaveLength(1);
    expect(Number((rows.rows[0] as Record<string, unknown>).sim)).toBeGreaterThan(0.9);
  });

  it('venue annotation columns default null and round-trip', async () => {
    const [venue] = await db.insert(schema.venues)
      .values({ name: 'Shank Hall', normalizedName: 'shank hall' }).returning();
    expect(venue.registryId).toBeNull();
    expect(venue.registryMatchedAt).toBeNull();
    await db.update(schema.venues)
      .set({ registryId: '08f2baa6d2c54e5b0399cb9f5f3a1b2c', registryMatchedAt: new Date() })
      .where(eq(schema.venues.id, venue.id));
    const updated = await db.query.venues.findFirst({ where: eq(schema.venues.id, venue.id) });
    expect(updated?.registryId).toBe('08f2baa6d2c54e5b0399cb9f5f3a1b2c');
    expect(updated?.registryMatchedAt).toBeInstanceOf(Date);
  });

  it('suggestion provenance defaults to llm/null and accepts registry evidence', async () => {
    const [keep] = await db.insert(schema.venues).values({ name: 'K', normalizedName: 'k reg' }).returning();
    const [absorb] = await db.insert(schema.venues).values({ name: 'A', normalizedName: 'a reg' }).returning();
    const [plain] = await db.insert(schema.venueMergeSuggestions).values({
      keepVenueId: keep.id, absorbVenueId: absorb.id, confidence: '0.8000', rationale: 'llm says same',
    }).returning();
    expect(plain.source).toBe('llm');
    expect(plain.evidence).toBeNull();
    await db.update(schema.venueMergeSuggestions)
      .set({ source: 'registry', evidence: { tier: 'registry-id', registryId: 'x' } })
      .where(eq(schema.venueMergeSuggestions.id, plain.id));
    const updated = await db.query.venueMergeSuggestions.findFirst({
      where: eq(schema.venueMergeSuggestions.id, plain.id),
    });
    expect(updated?.source).toBe('registry');
    expect(updated?.evidence).toEqual({ tier: 'registry-id', registryId: 'x' });
  });
});
