// Advisory venue-merge proposal (propose-only — a human applies via the existing
// mergeVenues path). Mirrors dedup/judge.ts and enrichment/title-suggest.ts: one
// structured haiku call per pair, 15s abort, never throws. This file makes NO
// database writes — findVenuePairCandidates only selects; the sweep that writes
// venue_merge_suggestions rows is a separate task.
import { generateText, Output } from 'ai';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/types';

const VENUE_MODEL = 'anthropic/claude-haiku-4-5';
const VENUE_TIMEOUT_MS = 15_000;
const MAX_RATIONALE_CHARS = 240;

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
