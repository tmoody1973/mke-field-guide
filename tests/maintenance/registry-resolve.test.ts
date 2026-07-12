import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import { DEFAULT_GEOCODE_LIMIT, DEFAULT_RESOLUTION_LIMIT, resolveVenues } from '@/maintenance/registry-resolve';
import { createTestDb } from '../helpers/test-db';

afterEach(() => {
  vi.unstubAllEnvs();
});

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

async function seedRegistry(
  db: TestDb,
  overrides: Partial<typeof schema.venueRegistry.$inferInsert> & { id: string; name: string },
) {
  const [row] = await db
    .insert(schema.venueRegistry)
    .values({ address: null, lon: '-87.9', lat: '43.0', ...overrides })
    .returning();
  return row;
}

async function seedVenue(
  db: TestDb,
  overrides: Partial<typeof schema.venues.$inferInsert> & { name: string; normalizedName: string },
) {
  const [row] = await db.insert(schema.venues).values(overrides).returning();
  return row;
}

async function seedEvent(db: TestDb, venueId: string, title: string) {
  const [row] = await db
    .insert(schema.events)
    .values({ slug: `resolve-fixture-${title.toLowerCase().replace(/\s+/g, '-')}`, title, normalizedTitle: title.toLowerCase(), venueId })
    .returning();
  return row;
}

describe('resolveVenues exports', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_RESOLUTION_LIMIT).toBe(50);
    expect(DEFAULT_GEOCODE_LIMIT).toBe(25);
  });
});

describe('resolveVenues', () => {
  it('no geocode key = tier 1 skipped, tier-0 miss stays unmatched (no crash, no network attempt)', async () => {
    vi.stubEnv('GEOCODE_EARTH_API_KEY', '');
    const db = await createTestDb();
    await seedRegistry(db, {
      id: 'gers-turner-hall-ballroom',
      name: 'Turner Hall Ballroom',
      address: '1040 N 4th St',
      lon: '-87.9146',
      lat: '43.0436',
    });
    // Name-only similarity lands in the low band -- tier 0 (no coords) rejects
    // it, and with no key + no geocodeFn override, tier 1 must be skipped.
    const venue = await seedVenue(db, {
      name: 'Turner Hall',
      normalizedName: 'turner hall',
      address: '1500 W Some Other Ave',
    });

    const result = await resolveVenues(db);
    expect(result).toEqual({ annotated: 0, unmatched: 1, suggested: 0, skipped: 0 });

    const updated = await db.query.venues.findFirst({ where: eq(schema.venues.id, venue.id) });
    expect(updated?.registryId).toBeNull();
    expect(updated?.registryMatchedAt).not.toBeNull();
  });

  it('annotates a strong name match and stamps the gate (registry_id + registry_matched_at set)', async () => {
    const db = await createTestDb();
    const registry = await seedRegistry(db, {
      id: 'gers-shank-hall',
      name: 'Shank Hall',
      address: '1434 N Farwell Ave',
      lon: '-87.8891',
      lat: '43.0625',
    });
    const venue = await seedVenue(db, { name: 'Shank Hall', normalizedName: 'shank hall' });

    const result = await resolveVenues(db);

    expect(result).toEqual({ annotated: 1, unmatched: 0, suggested: 0, skipped: 0 });

    const updated = await db.query.venues.findFirst({ where: eq(schema.venues.id, venue.id) });
    expect(updated?.registryId).toBe(registry.id);
    expect(updated?.registryMatchedAt).not.toBeNull();
  });

  it('stamps gate-only for a no-confidence venue (registry_id stays NULL, never re-attempted next run)', async () => {
    const db = await createTestDb();
    await seedRegistry(db, {
      id: 'gers-turner-hall-ballroom',
      name: 'Turner Hall Ballroom',
      address: '1040 N 4th St',
      lon: '-87.9146',
      lat: '43.0436',
    });
    const venue = await seedVenue(db, {
      name: 'Completely Unrelated Venue',
      normalizedName: 'completely unrelated venue',
    });

    const result = await resolveVenues(db);
    expect(result).toEqual({ annotated: 0, unmatched: 1, suggested: 0, skipped: 0 });

    const updated = await db.query.venues.findFirst({ where: eq(schema.venues.id, venue.id) });
    expect(updated?.registryId).toBeNull();
    expect(updated?.registryMatchedAt).not.toBeNull();

    // Second sweep must not re-attempt: registry_matched_at IS NULL no longer selects this row.
    const secondResult = await resolveVenues(db);
    expect(secondResult).toEqual({ annotated: 0, unmatched: 0, suggested: 0, skipped: 0 });
  });

  it('tier 1: geocodeFn coords rescue a low-sim match within 100m; geocode budget is respected', async () => {
    const db = await createTestDb();
    const registry = await seedRegistry(db, {
      id: 'gers-turner-hall-ballroom',
      name: 'Turner Hall Ballroom',
      address: '1040 N 4th St',
      lon: '-87.9146',
      lat: '43.0436',
    });
    // Both venues: name-only similarity lands in the low band (0.6-0.75) — tier 0
    // (no coords) rejects both. Distinct createdAt guarantees candidate order.
    const venueA = await seedVenue(db, {
      name: 'Turner Hall',
      normalizedName: 'turner hall',
      address: '1500 W Some Other Ave',
      createdAt: new Date(Date.now() - 60_000),
    });
    const venueB = await seedVenue(db, {
      name: 'Turner Hall Annex',
      normalizedName: 'turner hall annex',
      address: '2000 E Yet Another Ave',
      createdAt: new Date(),
    });

    const geocodeFn = vi.fn(async () => ({ lon: -87.9146, lat: 43.0436 }));

    const result = await resolveVenues(db, { geocodeFn, geocodeLimit: 1 });

    expect(geocodeFn).toHaveBeenCalledTimes(1);
    expect(geocodeFn).toHaveBeenCalledWith(venueA.address);
    expect(result).toEqual({ annotated: 1, unmatched: 1, suggested: 0, skipped: 0 });

    const updatedA = await db.query.venues.findFirst({ where: eq(schema.venues.id, venueA.id) });
    expect(updatedA?.registryId).toBe(registry.id);

    const updatedB = await db.query.venues.findFirst({ where: eq(schema.venues.id, venueB.id) });
    expect(updatedB?.registryId).toBeNull();
    expect(updatedB?.registryMatchedAt).not.toBeNull();
  });

  it('writes a registry-duplicate suggestion with source/evidence/keep-side per the sim rule', async () => {
    const db = await createTestDb();
    const registry = await seedRegistry(db, {
      id: 'gers-turner-hall-ballroom',
      name: 'Turner Hall Ballroom',
      address: '1040 N 4th St',
      lon: '-87.9146',
      lat: '43.0436',
    });
    // Both already resolved to the same registry entity (bypasses the annotation
    // loop entirely — registry_matched_at is already set) so this test isolates
    // the duplicate scan.
    const keepVenue = await seedVenue(db, {
      name: 'Turner Hall Ballroom',
      normalizedName: 'turner hall ballroom',
      registryId: registry.id,
      registryMatchedAt: new Date(),
    });
    const absorbVenue = await seedVenue(db, {
      name: 'Turner Hall',
      normalizedName: 'turner hall',
      registryId: registry.id,
      registryMatchedAt: new Date(),
    });

    const result = await resolveVenues(db);
    expect(result).toEqual({ annotated: 0, unmatched: 0, suggested: 1, skipped: 0 });

    const suggestions = await db.query.venueMergeSuggestions.findMany();
    expect(suggestions).toHaveLength(1);
    const suggestion = suggestions[0];
    expect(suggestion.keepVenueId).toBe(keepVenue.id);
    expect(suggestion.absorbVenueId).toBe(absorbVenue.id);
    expect(suggestion.source).toBe('registry');
    expect(Number(suggestion.confidence)).toBeCloseTo(0.98, 4);
    expect(suggestion.rationale).toBe(
      'Both records resolve to registry entity "Turner Hall Ballroom" (1040 N 4th St).',
    );
    expect(suggestion.evidence).toMatchObject({
      tier: 'registry-id',
      registryId: registry.id,
      registryName: 'Turner Hall Ballroom',
      registryAddress: '1040 N 4th St',
    });
    const evidence = suggestion.evidence as { simKeep: number; simAbsorb: number };
    expect(evidence.simKeep).toBeGreaterThan(evidence.simAbsorb);
  });

  it('ANNOTATE-ONLY invariant: all venue columns except registry_id/registry_matched_at byte-untouched; events untouched', async () => {
    const db = await createTestDb();
    await seedRegistry(db, {
      id: 'gers-shank-hall',
      name: 'Shank Hall',
      address: '1434 N Farwell Ave',
      lon: '-87.8891',
      lat: '43.0625',
    });
    const venue = await seedVenue(db, {
      name: 'Shank Hall',
      normalizedName: 'shank hall',
      address: '1434 N Farwell Ave',
      lat: '43.0625',
      lng: '-87.8891',
      neighborhood: 'East Side',
      slug: 'shank-hall',
    });
    await seedEvent(db, venue.id, 'Local Band Showcase');

    const venuesBefore = await db.query.venues.findMany();
    const eventsBefore = await db.query.events.findMany();

    const result = await resolveVenues(db);
    expect(result.annotated).toBe(1);

    const venuesAfter = await db.query.venues.findMany();
    const eventsAfter = await db.query.events.findMany();

    const maskedVenuesAfter = venuesAfter.map((row) => ({ ...row, registryId: null, registryMatchedAt: null }));
    expect(maskedVenuesAfter).toEqual(venuesBefore);
    expect(eventsAfter).toEqual(eventsBefore);
  });

  it('a pre-existing suggestion in the REVERSED orientation blocks re-proposal (no contradictory pair, no phantom suggested)', async () => {
    const db = await createTestDb();
    const registry = await seedRegistry(db, {
      id: 'gers-turner-hall-ballroom',
      name: 'Turner Hall Ballroom',
      address: '1040 N 4th St',
      lon: '-87.9146',
      lat: '43.0436',
    });
    // The sim rule would pick keepVenue as keep — the fixture row deliberately
    // records the OPPOSITE orientation (absorb-as-keep), as if a prior run's
    // tie-break went the other way. The ordered-pair unique index would NOT
    // block a flipped insert, so the sweep must skip pairs recorded in EITHER
    // orientation.
    const keepVenue = await seedVenue(db, {
      name: 'Turner Hall Ballroom',
      normalizedName: 'turner hall ballroom',
      registryId: registry.id,
      registryMatchedAt: new Date(),
    });
    const absorbVenue = await seedVenue(db, {
      name: 'Turner Hall',
      normalizedName: 'turner hall',
      registryId: registry.id,
      registryMatchedAt: new Date(),
    });
    await db.insert(schema.venueMergeSuggestions).values({
      keepVenueId: absorbVenue.id,
      absorbVenueId: keepVenue.id,
      confidence: '0.5',
      rationale: 'pre-existing reversed-orientation fixture row',
    });

    const result = await resolveVenues(db);
    expect(result).toEqual({ annotated: 0, unmatched: 0, suggested: 0, skipped: 0 });

    const suggestions = await db.query.venueMergeSuggestions.findMany();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].rationale).toBe('pre-existing reversed-orientation fixture row');
  });

  it('one failing duplicate group does not kill the others: sweep resolves with honest counts', async () => {
    const db = await createTestDb();
    const registryA = await seedRegistry(db, {
      id: 'gers-turner-hall-ballroom',
      name: 'Turner Hall Ballroom',
      address: '1040 N 4th St',
    });
    const registryB = await seedRegistry(db, {
      id: 'gers-shank-hall',
      name: 'Shank Hall',
      address: '1434 N Farwell Ave',
    });
    for (const [name, normalizedName, registryId] of [
      ['Turner Hall Ballroom', 'turner hall ballroom', registryA.id],
      ['Turner Hall', 'turner hall', registryA.id],
      ['Shank Hall', 'shank hall', registryB.id],
      ['Shank Hall Milwaukee', 'shank hall milwaukee', registryB.id],
    ] as const) {
      await seedVenue(db, { name, normalizedName, registryId, registryMatchedAt: new Date() });
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // First suggestion insert of the sweep blows up (as a real DB error would);
    // subsequent inserts pass through to the real PGlite.
    const insertSpy = vi.spyOn(db, 'insert').mockImplementationOnce(() => {
      throw new Error('boom: simulated per-group failure');
    });

    try {
      const result = await resolveVenues(db);

      expect(result).toEqual({ annotated: 0, unmatched: 0, suggested: 1, skipped: 0 });
      expect(consoleError).toHaveBeenCalled();

      const suggestions = await db.query.venueMergeSuggestions.findMany();
      expect(suggestions).toHaveLength(1);
    } finally {
      insertSpy.mockRestore();
      consoleError.mockRestore();
    }
  });

  it('a duplicate-scan query failure never throws past resolveVenues (counts object still returned)', async () => {
    const db = await createTestDb();
    const registry = await seedRegistry(db, {
      id: 'gers-turner-hall-ballroom',
      name: 'Turner Hall Ballroom',
      address: '1040 N 4th St',
    });
    await seedVenue(db, {
      name: 'Turner Hall Ballroom',
      normalizedName: 'turner hall ballroom',
      registryId: registry.id,
      registryMatchedAt: new Date(),
    });
    await seedVenue(db, {
      name: 'Turner Hall',
      normalizedName: 'turner hall',
      registryId: registry.id,
      registryMatchedAt: new Date(),
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const executeSpy = vi.spyOn(db, 'execute').mockRejectedValue(new Error('boom: simulated scan-query failure'));

    try {
      await expect(resolveVenues(db)).resolves.toEqual({ annotated: 0, unmatched: 0, suggested: 0, skipped: 0 });
      expect(consoleError).toHaveBeenCalled();
    } finally {
      executeSpy.mockRestore();
      consoleError.mockRestore();
    }

    const suggestions = await db.query.venueMergeSuggestions.findMany();
    expect(suggestions).toHaveLength(0);
  });

  it('suggestion insert is conflict-safe and counts stay honest (pre-existing pair row → no phantom suggested)', async () => {
    const db = await createTestDb();
    const registry = await seedRegistry(db, {
      id: 'gers-turner-hall-ballroom',
      name: 'Turner Hall Ballroom',
      address: '1040 N 4th St',
      lon: '-87.9146',
      lat: '43.0436',
    });
    const keepVenue = await seedVenue(db, {
      name: 'Turner Hall Ballroom',
      normalizedName: 'turner hall ballroom',
      registryId: registry.id,
      registryMatchedAt: new Date(),
    });
    const absorbVenue = await seedVenue(db, {
      name: 'Turner Hall',
      normalizedName: 'turner hall',
      registryId: registry.id,
      registryMatchedAt: new Date(),
    });
    await db.insert(schema.venueMergeSuggestions).values({
      keepVenueId: keepVenue.id,
      absorbVenueId: absorbVenue.id,
      confidence: '0.5',
      rationale: 'pre-existing fixture row',
    });

    const result = await resolveVenues(db);
    expect(result).toEqual({ annotated: 0, unmatched: 0, suggested: 0, skipped: 0 });

    const suggestions = await db.query.venueMergeSuggestions.findMany();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].rationale).toBe('pre-existing fixture row');
  });
});
