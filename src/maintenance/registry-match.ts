// Tier-0 resolution logic for the venue registry waterfall: pure candidate
// lookup + deterministic acceptance. Reads venue_registry only — no writes,
// no sweeps. Later tasks (sweep, cron) consume matchVenueToRegistry.
import { sql } from 'drizzle-orm';
import type { Db } from '@/db/types';

export const NAME_ACCEPT = 0.92;
export const NAME_WITH_STREET = 0.75;
export const NAME_WITH_DISTANCE = 0.6;
export const DISTANCE_ACCEPT_METERS = 100;
export const CANDIDATE_LIMIT = 5;
export const CANDIDATE_FLOOR = 0.55;

const EARTH_RADIUS_METERS = 6_371_000;

export type RegistryCandidate = {
  registryId: string;
  registryName: string;
  registryAddress: string | null;
  lon: number;
  lat: number;
  nameSimilarity: number;
};

export type RegistryMatch = {
  registryId: string;
  registryName: string;
  registryAddress: string | null;
  nameSimilarity: number;
};

export type MatchableVenue = {
  normalizedName: string;
  address: string | null;
};

/**
 * Leading street number of an address's FIRST token only. Venue names that
 * front-load a descriptive prefix before the address (e.g. "Shank Hall -
 * 1434 N Farwell") intentionally return null — this only reads the start of
 * the string, never scans for digits mid-string.
 */
export function streetNumber(address: string | null): string | null {
  if (address === null) return null;
  const match = /^(\d+)/.exec(address.trim());
  return match ? match[1] : null;
}

function toCandidateRow(row: Record<string, unknown>): RegistryCandidate {
  return {
    registryId: String(row.id),
    registryName: String(row.name),
    registryAddress: row.address === null ? null : String(row.address),
    lon: Number(row.lon),
    lat: Number(row.lat),
    nameSimilarity: Number(row.sim),
  };
}

export async function findRegistryCandidates(db: Db, normalizedName: string): Promise<RegistryCandidate[]> {
  const result = await db.execute(sql`
    SELECT id, name, address, lon, lat, similarity(lower(name), ${normalizedName}) AS sim
    FROM venue_registry
    WHERE similarity(lower(name), ${normalizedName}) >= ${CANDIDATE_FLOOR}
    ORDER BY sim DESC
    LIMIT ${CANDIDATE_LIMIT}
  `);
  return (result.rows as Record<string, unknown>[]).map(toCandidateRow);
}

/**
 * Standard haversine great-circle distance in meters between two lon/lat
 * points.
 */
function haversineMeters(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(deltaLon / 2) ** 2;
  const angularDistance = 2 * Math.asin(Math.sqrt(haversine));
  return EARTH_RADIUS_METERS * angularDistance;
}

export function acceptMatch(
  candidate: RegistryCandidate,
  venue: MatchableVenue,
  distanceMeters: number | null,
): boolean {
  if (candidate.nameSimilarity >= NAME_ACCEPT) return true;

  const candidateStreetNumber = streetNumber(candidate.registryAddress);
  const venueStreetNumber = streetNumber(venue.address);
  if (
    candidate.nameSimilarity >= NAME_WITH_STREET &&
    candidateStreetNumber !== null &&
    venueStreetNumber !== null &&
    candidateStreetNumber === venueStreetNumber
  ) {
    return true;
  }

  if (
    distanceMeters !== null &&
    distanceMeters <= DISTANCE_ACCEPT_METERS &&
    candidate.nameSimilarity >= NAME_WITH_DISTANCE
  ) {
    return true;
  }

  return false;
}

export async function matchVenueToRegistry(
  db: Db,
  venue: MatchableVenue,
  coords?: { lon: number; lat: number },
): Promise<RegistryMatch | null> {
  const candidates = await findRegistryCandidates(db, venue.normalizedName);

  for (const candidate of candidates) {
    const distanceMeters = coords ? haversineMeters(coords, candidate) : null;
    if (acceptMatch(candidate, venue, distanceMeters)) {
      return {
        registryId: candidate.registryId,
        registryName: candidate.registryName,
        registryAddress: candidate.registryAddress,
        nameSimilarity: candidate.nameSimilarity,
      };
    }
  }

  return null;
}
