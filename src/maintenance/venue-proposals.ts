// Advisory venue-merge proposal (propose-only — a human applies via the existing
// mergeVenues path). Mirrors dedup/judge-sweep.ts and enrichment/title-suggest-sweep.ts:
// one structured haiku call per pair, 15s abort, never throws. proposeVenueMerge and
// findVenuePairCandidates make NO database writes; proposeVenueMerges is the sweep
// that writes venue_merge_suggestions rows — and ONLY those rows (never mergeVenues,
// never touches venues/events).
import { generateText, Output } from 'ai';
import { count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import { hasGatewayKey } from '@/enrichment/embed';
import type { Db } from '@/db/types';

const VENUE_MODEL = 'anthropic/claude-haiku-4-5';
const VENUE_TIMEOUT_MS = 15_000;
const MAX_RATIONALE_CHARS = 240;
const DEFAULT_VENUE_PROPOSAL_LIMIT = 50;
const SAMPLE_TITLE_COUNT = 3;

// Below this, two normalized names are unrelated (not worth a model call).
// At/above this, names are near-identical — that band is the dedup layer's
// territory (it already merges duplicate events); above the ceiling isn't a
// judgment call, it's an obvious pending typo-level match.
const CANDIDATE_SIMILARITY_LOWER_BOUND = 0.45;
const CANDIDATE_SIMILARITY_UPPER_BOUND = 0.92;

export const venueProposalSchema = z.object({
  samePlace: z.boolean(),
  confidence: z.number().min(0).max(1),
  keep: z.enum(['a', 'b']),
  rationale: z.string().max(MAX_RATIONALE_CHARS),
});
export type VenueProposal = z.infer<typeof venueProposalSchema>;

export interface VenuePairInput {
  nameA: string;
  nameB: string;
  addressA: string | null;
  addressB: string | null;
  hoodA: string | null;
  hoodB: string | null;
  eventCountA: number;
  eventCountB: number;
  sampleTitlesA: string[];
  sampleTitlesB: string[];
}

export interface CandidatePair {
  venueAId: string;
  venueBId: string;
  similarity: number;
}

function describeVenue(
  name: string,
  address: string | null,
  hood: string | null,
  eventCount: number,
  sampleTitles: string[],
): string {
  return [
    `"${name}"`,
    `address: ${address ?? 'unknown'}`,
    `neighborhood: ${hood ?? 'unknown'}`,
    `${eventCount} event${eventCount === 1 ? '' : 's'} on record`,
    `sample titles: ${sampleTitles.join('; ') || 'none'}`,
  ].join(' · ');
}

export function buildVenuePrompt(input: VenuePairInput): string {
  return [
    'Two venue records in a Milwaukee events calendar may refer to the same real-world place.',
    'Decide whether they are the SAME place a person would walk into.',
    '',
    `Venue A: ${describeVenue(input.nameA, input.addressA, input.hoodA, input.eventCountA, input.sampleTitlesA)}`,
    `Venue B: ${describeVenue(input.nameB, input.addressB, input.hoodB, input.eventCountB, input.sampleTitlesB)}`,
    '',
    'Common SAME-place patterns: a venue and its own street address entered as a second record',
    '(e.g. "Cactus Club" and "Cactus Club - 2496 S Wentworth Ave") — SAME; "The X" vs "X" (e.g.',
    '"The Pabst Theater" vs "Pabst Theater") — SAME, the article is not a different place; a name',
    'with an embedded address is still the venue named in it, just written differently — SAME.',
    'Common DIFFERENT-place traps: rooms within a building booked and billed separately (e.g.',
    '"Falcon Bowl" vs "Falcon Nest" — DIFFERENT rooms in the same building, not the same venue,',
    'even though they share an address); a park vs its bandshell (e.g. a park vs its own bandshell',
    'or stage) — DIFFERENT unless this corpus\'s sample titles show them booked and billed as one',
    'and the same venue.',
    '',
    'samePlace: true only if a person going to either listed address ends up at the same door.',
    'confidence: 0-1, your honest certainty. Report confidence >= 0.9 only if you can rule out',
    'every DIFFERENT-place trap listed above.',
    'keep: "a" or "b" — whichever name is the cleaner canonical form (no embedded address, no',
    'redundant suffix, correct casing). Always answer keep even when samePlace is false — pick',
    'the name you would prefer this record be titled if it turns out to be the same place.',
    `rationale: one sentence, under ${MAX_RATIONALE_CHARS} characters, naming the deciding signal.`,
  ].join('\n');
}

/** Never throws: any model, network, or validation failure yields null (skip + retry next sweep). */
export async function proposeVenueMerge(input: VenuePairInput): Promise<VenueProposal | null> {
  try {
    const { output } = await generateText({
      model: VENUE_MODEL,
      output: Output.object({ schema: venueProposalSchema }),
      prompt: buildVenuePrompt(input),
      abortSignal: AbortSignal.timeout(VENUE_TIMEOUT_MS),
    });
    return output;
  } catch {
    return null;
  }
}

/**
 * In-band trigram candidate venue pairs, excluding any pair already recorded
 * in venue_merge_suggestions in either keep/absorb ordering.
 */
export async function findVenuePairCandidates(db: Db, limit: number): Promise<CandidatePair[]> {
  const result = await db.execute(sql`
    SELECT a.id AS venue_a_id,
           b.id AS venue_b_id,
           similarity(a.normalized_name, b.normalized_name) AS similarity
    FROM venues a
    JOIN venues b ON a.id < b.id
    WHERE similarity(a.normalized_name, b.normalized_name)
      BETWEEN ${CANDIDATE_SIMILARITY_LOWER_BOUND} AND ${CANDIDATE_SIMILARITY_UPPER_BOUND}
      AND NOT EXISTS (
        SELECT 1 FROM venue_merge_suggestions s
        WHERE (s.keep_venue_id = a.id AND s.absorb_venue_id = b.id)
           OR (s.keep_venue_id = b.id AND s.absorb_venue_id = a.id)
      )
      AND NOT (a.registry_id IS NOT NULL AND b.registry_id IS NOT NULL
               AND a.registry_id <> b.registry_id)
      AND NOT EXISTS (
        SELECT 1 FROM venue_aliases al
        WHERE al.normalized_name = a.normalized_name
           OR al.normalized_name = b.normalized_name
      )
    ORDER BY similarity DESC
    LIMIT ${limit}
  `);
  return (result.rows as Record<string, unknown>[]).map(toCandidatePair);
}

/**
 * Address-only candidate venue pairs: no similarity floor, matched purely on
 * their OWN street number + first street-name token (catches dash-variant
 * names like "Shank Hall" vs "Shank Hall - 1434 N Farwell Ave Milwaukee" that
 * sit well below the trigram band). Same registry/alias/suggested-pair
 * exclusions as findVenuePairCandidates; similarity is still computed/reported
 * for the judge prompt even though it played no role in selection.
 */
export async function findAddressMatchCandidates(db: Db, limit: number): Promise<CandidatePair[]> {
  const result = await db.execute(sql`
    SELECT a.id AS venue_a_id,
           b.id AS venue_b_id,
           similarity(a.normalized_name, b.normalized_name) AS similarity
    FROM venues a
    JOIN venues b ON a.id < b.id
    WHERE a.address ~ '^[0-9]+ ' AND b.address ~ '^[0-9]+ '
      AND split_part(a.address, ' ', 1) = split_part(b.address, ' ', 1)
      AND lower(split_part(a.address, ' ', 3)) = lower(split_part(b.address, ' ', 3))
      AND NOT (a.registry_id IS NOT NULL AND b.registry_id IS NOT NULL
               AND a.registry_id <> b.registry_id)
      AND NOT EXISTS (
        SELECT 1 FROM venue_aliases al
        WHERE al.normalized_name = a.normalized_name
           OR al.normalized_name = b.normalized_name
      )
      AND NOT EXISTS (
        SELECT 1 FROM venue_merge_suggestions s
        WHERE (s.keep_venue_id = a.id AND s.absorb_venue_id = b.id)
           OR (s.keep_venue_id = b.id AND s.absorb_venue_id = a.id)
      )
    ORDER BY similarity DESC
    LIMIT ${limit}
  `);
  return (result.rows as Record<string, unknown>[]).map(toCandidatePair);
}

function toCandidatePair(row: Record<string, unknown>): CandidatePair {
  return {
    venueAId: String(row.venue_a_id),
    venueBId: String(row.venue_b_id),
    similarity: Number(row.similarity),
  };
}

export type CandidateEvidence = { tier: 'address-pair' } | null;

interface SourcedCandidatePair extends CandidatePair {
  evidence: CandidateEvidence;
}

function candidatePairKey(candidate: CandidatePair): string {
  const [minId, maxId] =
    candidate.venueAId < candidate.venueBId
      ? [candidate.venueAId, candidate.venueBId]
      : [candidate.venueBId, candidate.venueAId];
  return `${minId}:${maxId}`;
}

/**
 * Combines trigram + address-match candidates into one deduped list keyed by
 * unordered venue-id pair. Address-match wins on overlap: a pair that also
 * clears the trigram band still gets the registry-blind address-pair evidence
 * tag, since that's the stronger real-world signal for the judge prompt.
 */
function dedupeCandidates(trigramCandidates: CandidatePair[], addressCandidates: CandidatePair[]): SourcedCandidatePair[] {
  const merged = new Map<string, SourcedCandidatePair>();
  for (const candidate of trigramCandidates) {
    merged.set(candidatePairKey(candidate), { ...candidate, evidence: null });
  }
  for (const candidate of addressCandidates) {
    merged.set(candidatePairKey(candidate), { ...candidate, evidence: { tier: 'address-pair' } });
  }
  return [...merged.values()];
}

export interface VenueProposalSweepResult {
  proposed: number;
  rejected: number;
  skipped: number;
}

interface VenueContext {
  name: string;
  address: string | null;
  neighborhood: string | null;
  eventCount: number;
  sampleTitles: string[];
}

/** A venue's name/address/neighborhood, event count, and 3 most recent event titles. */
async function loadVenueContext(db: Db, venueId: string): Promise<VenueContext | null> {
  const venue = await db.query.venues.findFirst({
    where: eq(schema.venues.id, venueId),
    columns: { name: true, address: true, neighborhood: true },
    with: {
      events: {
        columns: { title: true },
        orderBy: [desc(schema.events.createdAt)],
        limit: SAMPLE_TITLE_COUNT,
      },
    },
  });
  if (!venue) return null;
  const [{ eventCount }] = await db
    .select({ eventCount: count(schema.events.id) })
    .from(schema.events)
    .where(eq(schema.events.venueId, venueId));
  return {
    name: venue.name,
    address: venue.address,
    neighborhood: venue.neighborhood,
    eventCount: Number(eventCount),
    sampleTitles: venue.events.map((event) => event.title),
  };
}

function toVenuePairInput(venueA: VenueContext, venueB: VenueContext): VenuePairInput {
  return {
    nameA: venueA.name,
    nameB: venueB.name,
    addressA: venueA.address,
    addressB: venueB.address,
    hoodA: venueA.neighborhood,
    hoodB: venueB.neighborhood,
    eventCountA: venueA.eventCount,
    eventCountB: venueB.eventCount,
    sampleTitlesA: venueA.sampleTitles,
    sampleTitlesB: venueB.sampleTitles,
  };
}

/**
 * Inserts a venue_merge_suggestions row for the pair, guarded by the pair's unique
 * index so a race with a concurrent sweep (or a pre-existing row) no-ops instead of
 * throwing. Returns whether the row actually landed, so the caller can report an
 * honest count instead of assuming success.
 */
async function writeSuggestion(
  db: Db,
  keepVenueId: string,
  absorbVenueId: string,
  proposal: VenueProposal,
  status: 'pending' | 'dismissed',
  evidence: CandidateEvidence = null,
): Promise<boolean> {
  const inserted = await db
    .insert(schema.venueMergeSuggestions)
    .values({
      keepVenueId,
      absorbVenueId,
      confidence: proposal.confidence.toFixed(4),
      rationale: proposal.rationale,
      status,
      evidence,
    })
    .onConflictDoNothing()
    .returning({ id: schema.venueMergeSuggestions.id });
  return inserted.length > 0;
}

/**
 * Advisory venue-merge sweep: for each in-band candidate pair, calls the venue judge
 * and writes ONLY a venue_merge_suggestions row — never mergeVenues, never touches
 * venues/events. A model "no" is durable (written as a dismissed row so the pair is
 * never re-proposed); a null result (parse failure/timeout) is skipped with no row,
 * so the pair legitimately retries next sweep.
 */
export async function proposeVenueMerges(
  db: Db,
  opts: { limit?: number; proposeFn?: typeof proposeVenueMerge } = {},
): Promise<VenueProposalSweepResult> {
  if (!hasGatewayKey()) return { proposed: 0, rejected: 0, skipped: 0 };
  const proposeFn = opts.proposeFn ?? proposeVenueMerge;
  const limit = opts.limit ?? DEFAULT_VENUE_PROPOSAL_LIMIT;
  const [trigramCandidates, addressCandidates] = await Promise.all([
    findVenuePairCandidates(db, limit),
    findAddressMatchCandidates(db, limit),
  ]);
  const candidates = dedupeCandidates(trigramCandidates, addressCandidates).slice(0, limit);
  const result: VenueProposalSweepResult = { proposed: 0, rejected: 0, skipped: 0 };

  for (const candidate of candidates) {
    const [venueA, venueB] = await Promise.all([
      loadVenueContext(db, candidate.venueAId),
      loadVenueContext(db, candidate.venueBId),
    ]);
    if (!venueA || !venueB) {
      result.skipped += 1; // a venue raced away mid-sweep (e.g. merged by a human) — tolerate, next sweep won't see it
      continue;
    }

    const proposal = await proposeFn(toVenuePairInput(venueA, venueB));
    if (!proposal) {
      result.skipped += 1; // parse failure/timeout/no response — retried next sweep
      continue;
    }

    if (!proposal.samePlace) {
      // keep is ignored on a "no" — the dismissed row is written in candidate order.
      const wrote = await writeSuggestion(
        db,
        candidate.venueAId,
        candidate.venueBId,
        proposal,
        'dismissed',
        candidate.evidence,
      );
      if (wrote) result.rejected += 1;
      else result.skipped += 1; // pair already recorded between fetch and write — honest count, not a phantom verdict
      continue;
    }

    const [keepVenueId, absorbVenueId] =
      proposal.keep === 'a' ? [candidate.venueAId, candidate.venueBId] : [candidate.venueBId, candidate.venueAId];
    const wrote = await writeSuggestion(db, keepVenueId, absorbVenueId, proposal, 'pending', candidate.evidence);
    if (wrote) result.proposed += 1;
    else result.skipped += 1; // pair already recorded between fetch and write — honest count, not a phantom proposal
  }

  return result;
}
