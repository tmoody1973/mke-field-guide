// Weekly registry resolution sweep: annotate-only venue -> venue_registry
// waterfall (Tier 0 name/address/distance match, optional Tier 1 geocode
// rescue) plus a registry-duplicate proposal scan. Mirrors venue-proposals.ts:
// this sweep writes ONLY venues.registry_id/registry_matched_at and
// venue_merge_suggestions rows — never mergeVenues, never any other venue
// column. Task 5 wires the default geocodeFn; until then opts.geocodeFn is
// undefined and Tier 1 is skipped — this file imports nothing network-touching.
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { matchVenueToRegistry, type MatchableVenue, type RegistryMatch } from '@/maintenance/registry-match';
import type { Db } from '@/db/types';

export const DEFAULT_RESOLUTION_LIMIT = 50;
export const DEFAULT_GEOCODE_LIMIT = 25;

// Fixed high-confidence weight for a registry-id-backed duplicate proposal —
// this isn't a model guess, it's two venues both resolved to the same
// real-world GERS entity by the Tier 0/1 waterfall.
const DUPLICATE_SUGGESTION_CONFIDENCE = '0.9800';

export type GeocodeFn = (address: string) => Promise<{ lon: number; lat: number } | null>;

export interface ResolveVenuesOptions {
  limit?: number;
  geocodeLimit?: number;
  geocodeFn?: GeocodeFn;
}

export interface ResolveVenuesResult {
  annotated: number;
  unmatched: number;
  suggested: number;
  skipped: number;
}

interface ResolutionCandidate extends MatchableVenue {
  id: string;
}

interface GeocodeBudget {
  remaining: number;
}

/** Candidate venues that have never been through the resolution gate. */
async function findResolutionCandidates(db: Db, limit: number): Promise<ResolutionCandidate[]> {
  const rows = await db.query.venues.findMany({
    where: isNull(schema.venues.registryMatchedAt),
    orderBy: [asc(schema.venues.createdAt)],
    limit,
    columns: { id: true, normalizedName: true, address: true },
  });
  return rows;
}

/**
 * Tier 0 (name/address, no coords), then Tier 1 (geocode rescue) only when
 * Tier 0 misses, the venue has an address, a geocodeFn is wired, and geocode
 * budget remains. Budget decrements on every geocode attempt, including a
 * null (not-found) result — geocode coords are transient, never persisted.
 */
async function resolveOneVenue(
  db: Db,
  venue: ResolutionCandidate,
  geocodeFn: GeocodeFn | null,
  budget: GeocodeBudget,
): Promise<RegistryMatch | null> {
  const tierZeroMatch = await matchVenueToRegistry(db, venue);
  if (tierZeroMatch) return tierZeroMatch;

  const tierOneEligible = venue.address !== null && geocodeFn !== null && budget.remaining > 0;
  if (!tierOneEligible) return null;

  budget.remaining -= 1;
  const coords = await geocodeFn(venue.address as string);
  if (!coords) return null;

  return matchVenueToRegistry(db, venue, coords);
}

type AnnotationOutcome = 'annotated' | 'unmatched' | 'skipped';

/**
 * Writes ONLY registry_id (on match) or leaves it null (no match) plus
 * registry_matched_at, guarded by registry_matched_at IS NULL so a racing
 * sweep (or a human annotation) can't be clobbered — a guard miss is an
 * honest "skipped", not a silent overwrite.
 */
async function annotateVenue(db: Db, venueId: string, match: RegistryMatch | null): Promise<AnnotationOutcome> {
  const matchedAt = new Date();
  const setValues = match ? { registryId: match.registryId, registryMatchedAt: matchedAt } : { registryMatchedAt: matchedAt };

  const updated = await db
    .update(schema.venues)
    .set(setValues)
    .where(and(eq(schema.venues.id, venueId), isNull(schema.venues.registryMatchedAt)))
    .returning({ id: schema.venues.id });

  if (updated.length === 0) return 'skipped';
  return match ? 'annotated' : 'unmatched';
}

interface RegistryDuplicateRow {
  venueId: string;
  registryId: string;
  nameSimilarity: number;
  registryName: string;
  registryAddress: string | null;
}

/** venues sharing a registry_id held by more than one venue, with each venue's trigram sim to the registry name. */
async function findRegistryDuplicateRows(db: Db): Promise<RegistryDuplicateRow[]> {
  const result = await db.execute(sql`
    SELECT v.id AS venue_id,
           v.registry_id,
           similarity(lower(v.normalized_name), lower(r.name)) AS sim,
           r.name AS registry_name,
           r.address AS registry_address
    FROM venues v
    JOIN venue_registry r ON r.id = v.registry_id
    WHERE v.registry_id IN (
      SELECT registry_id FROM venues WHERE registry_id IS NOT NULL GROUP BY registry_id HAVING count(*) > 1
    )
  `);
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    venueId: String(row.venue_id),
    registryId: String(row.registry_id),
    nameSimilarity: Number(row.sim),
    registryName: String(row.registry_name),
    registryAddress: row.registry_address === null ? null : String(row.registry_address),
  }));
}

function groupByRegistryId(rows: RegistryDuplicateRow[]): RegistryDuplicateRow[][] {
  const groups = new Map<string, RegistryDuplicateRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.registryId) ?? [];
    groups.set(row.registryId, [...existing, row]);
  }
  return [...groups.values()];
}

async function countVenueEvents(db: Db, venueId: string): Promise<number> {
  const [{ eventCount }] = await db
    .select({ eventCount: count(schema.events.id) })
    .from(schema.events)
    .where(eq(schema.events.venueId, venueId));
  return Number(eventCount);
}

/** Highest trigram sim to the registry name wins; ties break to the higher event count. */
async function pickKeepVenue(db: Db, group: RegistryDuplicateRow[]): Promise<RegistryDuplicateRow> {
  const ranked = await Promise.all(
    group.map(async (row) => ({ row, eventCount: await countVenueEvents(db, row.venueId) })),
  );
  const best = ranked.reduce((current, candidate) => {
    if (candidate.row.nameSimilarity > current.row.nameSimilarity) return candidate;
    if (candidate.row.nameSimilarity < current.row.nameSimilarity) return current;
    return candidate.eventCount > current.eventCount ? candidate : current;
  });
  return best.row;
}

/** Conflict-safe: the pair unique index makes a re-run (or an existing pair row) a no-op, not a phantom count. */
async function writeDuplicateSuggestion(
  db: Db,
  keep: RegistryDuplicateRow,
  absorb: RegistryDuplicateRow,
): Promise<boolean> {
  const inserted = await db
    .insert(schema.venueMergeSuggestions)
    .values({
      keepVenueId: keep.venueId,
      absorbVenueId: absorb.venueId,
      confidence: DUPLICATE_SUGGESTION_CONFIDENCE,
      rationale: `Both records resolve to registry entity "${keep.registryName}" (${keep.registryAddress ?? 'address unknown'}).`,
      source: 'registry',
      evidence: {
        tier: 'registry-id',
        registryId: keep.registryId,
        registryName: keep.registryName,
        registryAddress: keep.registryAddress,
        simKeep: keep.nameSimilarity,
        simAbsorb: absorb.nameSimilarity,
      },
    })
    .onConflictDoNothing()
    .returning({ id: schema.venueMergeSuggestions.id });
  return inserted.length > 0;
}

/** Registry-id-backed duplicate proposals — real-world-identity evidence, not a model guess. */
async function proposeRegistryDuplicates(db: Db): Promise<number> {
  const rows = await findRegistryDuplicateRows(db);
  const groups = groupByRegistryId(rows);

  let suggested = 0;
  for (const group of groups) {
    const keep = await pickKeepVenue(db, group);
    for (const absorb of group) {
      if (absorb.venueId === keep.venueId) continue;
      const wrote = await writeDuplicateSuggestion(db, keep, absorb);
      if (wrote) suggested += 1;
    }
  }
  return suggested;
}

/**
 * The weekly resolution sweep: annotate each unresolved venue with its
 * registry match (or stamp the one-shot no-match gate), then scan for venues
 * that landed on the same registry entity and propose merging them. Never
 * throws to the caller — a per-venue failure is logged and counted as
 * skipped so one bad row can't stall the whole sweep.
 */
export async function resolveVenues(db: Db, opts: ResolveVenuesOptions = {}): Promise<ResolveVenuesResult> {
  const geocodeFn = opts.geocodeFn ?? null;
  const budget: GeocodeBudget = { remaining: opts.geocodeLimit ?? DEFAULT_GEOCODE_LIMIT };
  const candidates = await findResolutionCandidates(db, opts.limit ?? DEFAULT_RESOLUTION_LIMIT);

  const result: ResolveVenuesResult = { annotated: 0, unmatched: 0, suggested: 0, skipped: 0 };

  for (const venue of candidates) {
    try {
      const match = await resolveOneVenue(db, venue, geocodeFn, budget);
      const outcome = await annotateVenue(db, venue.id, match);
      result[outcome] += 1;
    } catch (error) {
      console.error(`registry resolution failed for venue ${venue.id}:`, error);
      result.skipped += 1;
    }
  }

  result.suggested += await proposeRegistryDuplicates(db);

  return result;
}
