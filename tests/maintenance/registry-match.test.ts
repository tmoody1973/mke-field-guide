import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  acceptMatch,
  findRegistryCandidates,
  matchVenueToRegistry,
  streetNumber,
} from '@/maintenance/registry-match';
import { createTestDb } from '../helpers/test-db';

describe('streetNumber', () => {
  it('extracts a leading street number and returns null for name-first or null addresses', () => {
    expect(streetNumber('1434 N Farwell Ave')).toBe('1434');
    expect(streetNumber('Shank Hall - 1434 N Farwell')).toBeNull();
    expect(streetNumber(null)).toBeNull();
  });
});

describe('findRegistryCandidates', () => {
  it('returns sim-ordered candidates above the floor with numeric coercion', async () => {
    const db = await createTestDb();
    await db.insert(schema.venueRegistry).values([
      { id: 'gers-1', name: 'Shank Hall', address: '1434 N Farwell Ave', lon: '-87.8891', lat: '43.0625' },
      { id: 'gers-2', name: 'Shank Hall Milwaukee', address: '1434 N Farwell Ave', lon: '-87.8891', lat: '43.0625' },
      { id: 'gers-3', name: 'Completely Unrelated Venue', address: '1 Somewhere Rd', lon: '-88.0', lat: '43.5' },
    ]);

    const candidates = await findRegistryCandidates(db, 'shank hall');

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(5);
    for (const candidate of candidates) {
      expect(candidate.nameSimilarity).toBeGreaterThanOrEqual(0.55);
      expect(typeof candidate.nameSimilarity).toBe('number');
      expect(typeof candidate.lon).toBe('number');
      expect(typeof candidate.lat).toBe('number');
    }
    // sim-ordered descending
    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i - 1].nameSimilarity).toBeGreaterThanOrEqual(candidates[i].nameSimilarity);
    }
    expect(candidates.some((candidate) => candidate.registryId === 'gers-3')).toBe(false);
    expect(candidates[0].registryId).toBe('gers-1');
  });
});

describe('acceptMatch / matchVenueToRegistry', () => {
  it('accepts on name similarity alone at >= 0.92 (Shank Hall exact)', async () => {
    const db = await createTestDb();
    await db.insert(schema.venueRegistry).values([
      { id: 'gers-1', name: 'Shank Hall', address: '1434 N Farwell Ave', lon: '-87.8891', lat: '43.0625' },
    ]);

    const match = await matchVenueToRegistry(db, {
      normalizedName: 'shank hall',
      address: null,
    });

    expect(match).not.toBeNull();
    expect(match?.registryId).toBe('gers-1');
    expect(match?.nameSimilarity).toBeGreaterThanOrEqual(0.92);
  });

  it('accepts mid-similarity only with matching street numbers (The Cooperage vs The Cooperage MKE at 822)', async () => {
    const db = await createTestDb();
    await db.insert(schema.venueRegistry).values([
      { id: 'gers-1', name: 'The Cooperage MKE', address: '822 S Water St', lon: '-87.9065', lat: '43.0243' },
    ]);

    const acceptedMatch = await matchVenueToRegistry(db, {
      normalizedName: 'the cooperage',
      address: '822 S Water St',
    });
    expect(acceptedMatch).not.toBeNull();
    expect(acceptedMatch?.registryId).toBe('gers-1');
    expect(acceptedMatch?.nameSimilarity).toBeGreaterThanOrEqual(0.75);
    expect(acceptedMatch?.nameSimilarity).toBeLessThan(0.92);

    const rejectedMatch = await matchVenueToRegistry(db, {
      normalizedName: 'the cooperage',
      address: '410 N Different St',
    });
    expect(rejectedMatch).toBeNull();
  });

  it('accepts low-band similarity only within 100m when coords are provided', async () => {
    const db = await createTestDb();
    await db.insert(schema.venueRegistry).values([
      { id: 'gers-1', name: 'Turner Hall Ballroom', address: '1040 N 4th St', lon: '-87.9146', lat: '43.0436' },
    ]);

    const acceptedMatch = await matchVenueToRegistry(
      db,
      { normalizedName: 'turner hall', address: null },
      { lon: -87.9146, lat: 43.0436 },
    );
    expect(acceptedMatch).not.toBeNull();
    expect(acceptedMatch?.registryId).toBe('gers-1');
    expect(acceptedMatch?.nameSimilarity).toBeGreaterThanOrEqual(0.6);
    expect(acceptedMatch?.nameSimilarity).toBeLessThan(0.75);

    const rejectedNoCoords = await matchVenueToRegistry(db, { normalizedName: 'turner hall', address: null });
    expect(rejectedNoCoords).toBeNull();

    const rejectedFarCoords = await matchVenueToRegistry(
      db,
      { normalizedName: 'turner hall', address: null },
      { lon: -88.05, lat: 43.15 },
    );
    expect(rejectedFarCoords).toBeNull();
  });

  it('rejects the park-feature trap: "humboldt park bandshell" does NOT match "Humboldt Park Pond" (sim < 0.92, no street/distance evidence)', async () => {
    const db = await createTestDb();
    await db.insert(schema.venueRegistry).values([
      { id: 'gers-1', name: 'Humboldt Park Pond', address: null, lon: '-87.8894', lat: '43.0056' },
    ]);

    const match = await matchVenueToRegistry(db, {
      normalizedName: 'humboldt park bandshell',
      address: null,
    });

    expect(match).toBeNull();
  });

  it('acceptMatch enforces the three exact OR rules with no address-equality-alone path', () => {
    const candidate = {
      registryId: 'gers-1',
      registryName: 'Shank Hall',
      registryAddress: '1434 N Farwell Ave',
      lon: -87.8891,
      lat: 43.0625,
      nameSimilarity: 0.92,
    };

    expect(acceptMatch(candidate, { normalizedName: 'shank hall', address: null }, null)).toBe(true);

    const midCandidate = { ...candidate, nameSimilarity: 0.8 };
    expect(
      acceptMatch(midCandidate, { normalizedName: 'shank hall', address: '1434 N Farwell Ave' }, null),
    ).toBe(true);
    expect(
      acceptMatch(midCandidate, { normalizedName: 'shank hall', address: '9999 Other St' }, null),
    ).toBe(false);

    const lowCandidate = { ...candidate, nameSimilarity: 0.65 };
    expect(acceptMatch(lowCandidate, { normalizedName: 'shank hall', address: null }, 50)).toBe(true);
    expect(acceptMatch(lowCandidate, { normalizedName: 'shank hall', address: null }, 150)).toBe(false);
    expect(acceptMatch(lowCandidate, { normalizedName: 'shank hall', address: null }, null)).toBe(false);

    // address equality alone (no street-number match rule invoked, sim below thresholds) must not accept
    const belowFloorCandidate = { ...candidate, nameSimilarity: 0.5 };
    expect(
      acceptMatch(
        belowFloorCandidate,
        { normalizedName: 'totally different venue', address: '1434 N Farwell Ave' },
        null,
      ),
    ).toBe(false);
  });
});
