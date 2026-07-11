// Advisory annotation pass over pending review pairs (annotate-only — writes
// ONLY the judge_* columns; a human still resolves every pair). No-key = no-op,
// exactly like the enrichment sweep.
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { hasGatewayKey } from '@/enrichment/embed';
import { chicagoDateLabel } from '@/lib/display';
import type { Db } from '@/db/types';
import { judgePair, verdictFrom, type JudgePairInput, type Judgment } from './judge';

const DEFAULT_JUDGE_LIMIT = 50;
const MAX_STARTS_IN_PROMPT = 3;

export interface JudgeSweepResult {
  judged: number;
  skipped: number;
}

type PendingRow = typeof schema.eventReviews.$inferSelect;

async function fetchUnjudgedPending(db: Db, limit: number): Promise<PendingRow[]> {
  return db.query.eventReviews.findMany({
    where: and(eq(schema.eventReviews.status, 'pending'), isNull(schema.eventReviews.judgedAt)),
    limit,
  });
}

interface PairSide {
  title: string;
  venueName: string | null;
  venueId: string | null;
  starts: Date[];
  sources: string[];
  canonicalUrl: string | null;
}

async function loadSide(db: Db, eventId: string): Promise<PairSide | null> {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    with: {
      venue: { columns: { name: true } },
      instances: { columns: { startAt: true } },
      sourceLinks: { with: { source: { columns: { key: true } } } },
    },
  });
  if (!event) return null;
  return {
    title: event.title,
    venueName: event.venue?.name ?? null,
    venueId: event.venueId,
    starts: event.instances.map((i) => i.startAt).sort((a, b) => a.getTime() - b.getTime()),
    sources: event.sourceLinks.map((l) => l.source.key),
    canonicalUrl: event.canonicalUrl,
  };
}

function minDeltaMinutes(a: Date[], b: Date[]): number | null {
  let min: number | null = null;
  for (const x of a) {
    for (const y of b) {
      const delta = Math.abs(x.getTime() - y.getTime()) / 60_000;
      if (min === null || delta < min) min = delta;
    }
  }
  return min === null ? null : Math.round(min);
}

function toJudgeInput(review: PendingRow, a: PairSide, b: PairSide): JudgePairInput {
  return {
    aTitle: a.title,
    bTitle: b.title,
    venueA: a.venueName,
    venueB: b.venueName,
    sameVenueId: a.venueId !== null && a.venueId === b.venueId,
    startDeltaMinutes: minDeltaMinutes(a.starts, b.starts),
    aStarts: a.starts.slice(0, MAX_STARTS_IN_PROMPT).map(chicagoDateLabel),
    bStarts: b.starts.slice(0, MAX_STARTS_IN_PROMPT).map(chicagoDateLabel),
    aSources: a.sources,
    bSources: b.sources,
    urlMatch: a.canonicalUrl !== null && a.canonicalUrl === b.canonicalUrl,
    score: Number(review.score),
  };
}

/**
 * Guards on status='pending' AND judgedAt IS NULL so a pair that a human resolved
 * (or that cascaded away via a mid-sweep same-show merge) mid-flight — after this
 * sweep already fetched it and called the judge — never gets annotated. Returns
 * whether the row was actually written, so the caller can report an honest count
 * instead of assuming success.
 */
async function recordJudgment(db: Db, reviewId: string, judgment: Judgment): Promise<boolean> {
  const written = await db
    .update(schema.eventReviews)
    .set({
      judgeVerdict: verdictFrom(judgment),
      judgeConfidence: judgment.confidence.toFixed(4),
      judgeRationale: judgment.rationale,
      judgedAt: new Date(),
    })
    .where(
      and(
        eq(schema.eventReviews.id, reviewId),
        eq(schema.eventReviews.status, 'pending'),
        isNull(schema.eventReviews.judgedAt),
      ),
    )
    .returning({ id: schema.eventReviews.id });
  return written.length > 0;
}

/**
 * Advisory annotation sweep: for each pending, unjudged review pair, calls the
 * judge and writes only the judge_* columns. Never merges, never touches status —
 * a human still resolves every pair via the review queue.
 */
export async function judgePendingReviews(
  db: Db,
  opts: { limit?: number; judgeFn?: typeof judgePair } = {},
): Promise<JudgeSweepResult> {
  if (!hasGatewayKey()) return { judged: 0, skipped: 0 };
  const judgeFn = opts.judgeFn ?? judgePair;
  const rows = await fetchUnjudgedPending(db, opts.limit ?? DEFAULT_JUDGE_LIMIT);
  const result: JudgeSweepResult = { judged: 0, skipped: 0 };
  for (const review of rows) {
    const [a, b] = await Promise.all([loadSide(db, review.eventAId), loadSide(db, review.eventBId)]);
    if (!a || !b) {
      result.skipped += 1; // pair raced away mid-sweep — tolerate, next sweep won't see it
      continue;
    }
    const judgment = await judgeFn(toJudgeInput(review, a, b));
    if (!judgment) {
      result.skipped += 1; // judgedAt stays NULL — retried next sweep
      continue;
    }
    const wrote = await recordJudgment(db, review.id, judgment);
    if (wrote) {
      result.judged += 1;
    } else {
      result.skipped += 1; // resolved or cascaded away between fetch and write — honest count, not a phantom judgment
    }
  }
  return result;
}
