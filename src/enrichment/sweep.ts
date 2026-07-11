import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/ingestion/persist';
import { embedTexts, hasGatewayKey } from './embed';
import { buildEmbeddingText, contentFingerprint } from './fingerprint';
import { tagEvent, type Enrichment } from './tag';
import { suggestTitles } from './title-suggest-sweep';

export interface EnrichResult {
  embedded: number;
  tagged: number;
  skipped: number;
  titleSuggestions: number;
}

const DEFAULT_EMBED_LIMIT = 200;
const DEFAULT_TAG_LIMIT = 50;
const EMBED_CHUNK_SIZE = 64;
// Worst case: 20 × 15s gateway aborts = 300s, half the task's 600s maxDuration budget —
// the embed/tag sweeps run ahead of this tail in the same tick, so the title
// suggester only gets the other half; mirrors dedup/sweep.ts's CRON_JUDGE_LIMIT.
const CRON_TITLE_LIMIT = 20;

interface EmbedCandidateRow {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  vibeTags: string[] | null;
  audienceTags: string[] | null;
  venueName: string | null;
  embedding: unknown;
  contentFingerprint: string | null;
}

interface TagCandidateRow {
  id: string;
  title: string;
  description: string | null;
  venueName: string | null;
  isFree: boolean | null;
}

/** All events with enough columns to recompute a fingerprint and compare against what's stored. */
async function fetchEmbedCandidates(db: Db): Promise<EmbedCandidateRow[]> {
  return db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      description: schema.events.description,
      category: schema.events.category,
      vibeTags: schema.events.vibeTags,
      audienceTags: schema.events.audienceTags,
      venueName: schema.venues.name,
      embedding: schema.events.embedding,
      contentFingerprint: schema.events.contentFingerprint,
    })
    .from(schema.events)
    .leftJoin(schema.venues, eq(schema.venues.id, schema.events.venueId));
}

/** Events an operator has never tagged — a source re-ingest never clears these once set. */
async function fetchTagCandidates(db: Db, limit: number): Promise<TagCandidateRow[]> {
  return db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      description: schema.events.description,
      venueName: schema.venues.name,
      isFree: schema.events.isFree,
    })
    .from(schema.events)
    .leftJoin(schema.venues, eq(schema.venues.id, schema.events.venueId))
    .where(and(isNull(schema.events.category), isNull(schema.events.vibeTags)))
    .limit(limit);
}

function needsEmbedding(row: EmbedCandidateRow): boolean {
  return row.embedding === null || row.contentFingerprint !== contentFingerprint(row);
}

async function applyEmbedding(db: Db, row: EmbedCandidateRow, vector: number[]): Promise<void> {
  await db
    .update(schema.events)
    .set({ embedding: vector, embeddedAt: new Date(), contentFingerprint: contentFingerprint(row) })
    .where(eq(schema.events.id, row.id));
}

/** Embeds one chunk; a failure skips every row in that chunk rather than throwing the sweep. */
async function embedChunk(db: Db, chunk: EmbedCandidateRow[]): Promise<{ embedded: number; skipped: number }> {
  try {
    const vectors = await embedTexts(chunk.map((row) => buildEmbeddingText(row)));
    await Promise.all(chunk.map((row, index) => applyEmbedding(db, row, vectors[index])));
    return { embedded: chunk.length, skipped: 0 };
  } catch {
    return { embedded: 0, skipped: chunk.length };
  }
}

async function runEmbedSweep(db: Db, limit: number): Promise<{ embedded: number; skipped: number }> {
  const candidates = await fetchEmbedCandidates(db);
  const needing = candidates.filter(needsEmbedding).slice(0, limit);
  let embedded = 0;
  let skipped = 0;
  for (let i = 0; i < needing.length; i += EMBED_CHUNK_SIZE) {
    const chunk = needing.slice(i, i + EMBED_CHUNK_SIZE);
    const outcome = await embedChunk(db, chunk);
    embedded += outcome.embedded;
    skipped += outcome.skipped;
  }
  return { embedded, skipped };
}

/**
 * Adapter-known isFree always wins; enrichment only fills the gap when it was never set.
 *
 * Clears contentFingerprint so the embed sweep (which runs immediately after the tag
 * sweep in the same enrichSweep call) sees this row as needing re-embedding — the
 * fingerprint is title/description only, so it never changes on tagging, and without
 * this reset an event embedded before it was ever tagged would stay untagged in its
 * embedding text forever.
 */
async function applyTags(db: Db, row: TagCandidateRow, enrichment: Enrichment): Promise<void> {
  await db
    .update(schema.events)
    .set({
      category: enrichment.category,
      vibeTags: enrichment.vibeTags,
      audienceTags: enrichment.audienceTags,
      isFree: row.isFree ?? enrichment.isFree,
      contentFingerprint: null,
    })
    .where(eq(schema.events.id, row.id));
}

async function runTagSweep(db: Db, limit: number): Promise<{ tagged: number; skipped: number }> {
  const candidates = await fetchTagCandidates(db, limit);
  let tagged = 0;
  let skipped = 0;
  for (const row of candidates) {
    const enrichment = await tagEvent(row);
    if (!enrichment) {
      skipped += 1;
      continue;
    }
    await applyTags(db, row, enrichment);
    tagged += 1;
  }
  return { tagged, skipped };
}

/**
 * No-key sweeps make zero AI calls — search still runs FTS-only until a key is configured.
 *
 * Tagging runs before embedding: `buildEmbeddingText` includes category/vibe/audience
 * tags, so an event must be tagged before its embedding text can reflect them. Running
 * the tag sweep first — and having `applyTags` clear contentFingerprint — means a
 * freshly tagged event is picked up as needing embedding by the embed sweep that
 * follows in this same call, instead of being embedded untagged forever.
 */
export async function enrichSweep(
  db: Db,
  opts: { embedLimit?: number; tagLimit?: number } = {},
): Promise<EnrichResult> {
  if (!hasGatewayKey()) return { embedded: 0, tagged: 0, skipped: 0, titleSuggestions: 0 };
  const tagResult = await runTagSweep(db, opts.tagLimit ?? DEFAULT_TAG_LIMIT);
  const embedResult = await runEmbedSweep(db, opts.embedLimit ?? DEFAULT_EMBED_LIMIT);
  const result: EnrichResult = {
    embedded: embedResult.embedded,
    tagged: tagResult.tagged,
    skipped: embedResult.skipped + tagResult.skipped,
    titleSuggestions: 0,
  };
  // Advisory and best-effort, like the judge sweep at the end of dedupSweep: a
  // gateway outage here must never discard this tick's embed/tag counts.
  try {
    const t = await suggestTitles(db, { limit: CRON_TITLE_LIMIT });
    result.titleSuggestions = t.suggested;
  } catch (error) {
    console.error('title suggest sweep failed', error);
  }
  return result;
}
