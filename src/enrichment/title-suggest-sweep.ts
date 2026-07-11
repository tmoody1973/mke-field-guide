// Advisory title-cleanup sweep (propose-only — writes ONLY title_suggestion /
// title_suggested_at; a human applies via the editor, which locks + records
// provenance). Mirrors dedup/judge-sweep.ts: candidate query, gate stamping,
// rows-affected honest counts.
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { hasGatewayKey } from './embed';
import { chicagoDateLabel } from '@/lib/display';
import type { Db } from '@/db/types';
import { suggestTitle, type SuggestTitleInput, type TitleSuggestion } from './title-suggest';

const DEFAULT_TITLE_LIMIT = 50;
const MAX_STARTS_IN_PROMPT = 3;
// Same ladder rank as admin-events.ts's LOW_CONFIDENCE_ADAPTERS: scraper-sourced,
// no structured feed to trust for a clean title.
const SCRAPER_ADAPTERS = ['html', 'firecrawl'] as const;

export interface TitleSweepResult {
  suggested: number;
  alreadyClean: number;
  skipped: number;
}

interface CandidateRow {
  id: string;
}

/** Events whose CANONICAL source link is scraper-sourced and never gated, oldest first. */
async function fetchCandidates(db: Db, limit: number): Promise<CandidateRow[]> {
  return db
    .select({ id: schema.events.id })
    .from(schema.events)
    .innerJoin(
      schema.eventSourceLinks,
      and(eq(schema.eventSourceLinks.eventId, schema.events.id), eq(schema.eventSourceLinks.isCanonical, true)),
    )
    .innerJoin(schema.sources, eq(schema.sources.id, schema.eventSourceLinks.sourceId))
    .where(
      and(
        inArray(schema.sources.adapterType, [...SCRAPER_ADAPTERS]),
        isNull(schema.events.titleSuggestedAt),
      ),
    )
    .orderBy(asc(schema.events.createdAt))
    .limit(limit);
}

async function loadInput(db: Db, eventId: string): Promise<SuggestTitleInput | null> {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    with: {
      venue: { columns: { name: true } },
      instances: { columns: { startAt: true } },
      sourceLinks: { with: { source: { columns: { key: true } } } },
    },
  });
  if (!event) return null;
  const starts = event.instances.map((i) => i.startAt).sort((a, b) => a.getTime() - b.getTime());
  return {
    title: event.title,
    venueName: event.venue?.name ?? null,
    startsChicago: starts.slice(0, MAX_STARTS_IN_PROMPT).map(chicagoDateLabel),
    sourceKeys: event.sourceLinks.map((l) => l.source.key),
  };
}

/**
 * Guards on titleSuggestedAt IS NULL so a row already stamped by this sweep (or a
 * concurrent one racing it) never gets overwritten. Returns whether the row was
 * actually written, so the caller can report an honest count instead of a phantom one.
 */
async function stampAlreadyClean(db: Db, eventId: string): Promise<boolean> {
  const written = await db
    .update(schema.events)
    .set({ titleSuggestedAt: new Date() })
    .where(and(eq(schema.events.id, eventId), isNull(schema.events.titleSuggestedAt)))
    .returning({ id: schema.events.id });
  return written.length > 0;
}

/** Same mid-flight guard as stampAlreadyClean, but also writes the proposed title. */
async function writeSuggestion(db: Db, eventId: string, suggestion: TitleSuggestion): Promise<boolean> {
  const written = await db
    .update(schema.events)
    .set({ titleSuggestion: suggestion.cleanTitle, titleSuggestedAt: new Date() })
    .where(and(eq(schema.events.id, eventId), isNull(schema.events.titleSuggestedAt)))
    .returning({ id: schema.events.id });
  return written.length > 0;
}

/**
 * Advisory title-cleanup sweep: for each scraper-sourced, never-gated event, calls
 * the title-cleanup model and writes only title_suggestion/title_suggested_at.
 * titleSuggestedAt is a one-shot gate — set on every verdict (including "already
 * clean") so a dismissed/applied event is never re-proposed.
 */
export async function suggestTitles(
  db: Db,
  opts: { limit?: number; suggestFn?: typeof suggestTitle } = {},
): Promise<TitleSweepResult> {
  if (!hasGatewayKey()) return { suggested: 0, alreadyClean: 0, skipped: 0 };
  const suggestFn = opts.suggestFn ?? suggestTitle;
  const candidates = await fetchCandidates(db, opts.limit ?? DEFAULT_TITLE_LIMIT);
  const result: TitleSweepResult = { suggested: 0, alreadyClean: 0, skipped: 0 };
  for (const candidate of candidates) {
    const input = await loadInput(db, candidate.id);
    if (!input) {
      result.skipped += 1; // event raced away mid-sweep — tolerate, next sweep won't see it
      continue;
    }
    const suggestion = await suggestFn(input);
    if (!suggestion) {
      result.skipped += 1; // titleSuggestedAt stays NULL — retried next sweep
      continue;
    }
    const isAlreadyClean = !suggestion.changed || suggestion.cleanTitle === input.title;
    if (isAlreadyClean) {
      const wrote = await stampAlreadyClean(db, candidate.id);
      if (wrote) {
        result.alreadyClean += 1;
      } else {
        result.skipped += 1; // gated between fetch and write — honest count, not a phantom verdict
      }
      continue;
    }
    const wrote = await writeSuggestion(db, candidate.id, suggestion);
    if (wrote) {
      result.suggested += 1;
    } else {
      result.skipped += 1; // gated between fetch and write — honest count, not a phantom suggestion
    }
  }
  return result;
}
