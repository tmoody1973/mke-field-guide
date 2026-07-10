import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import { pickSameShowSurvivor } from '@/dedup/confidence';
import { provenanceFor } from '@/dedup/sweep';
import type { Db } from '@/lib/card-data';

const reviewBreakdownSchema = z.object({
  titleSimilarity: z.number(),
  venueAffinity: z.number(),
  startDeltaMinutes: z.number().nullable(),
  urlMatch: z.boolean(),
  total: z.number(),
});

export type ReviewBreakdown = z.infer<typeof reviewBreakdownSchema>;

export interface ReviewSide {
  eventId: string;
  slug: string;
  title: string;
  status: string;
  category: string | null;
  isFree: boolean | null;
  venueName: string | null;
  instanceStarts: Date[]; // ALL instances, past included, ascending — a dupe may be past-only
  sources: { key: string; name: string; isCanonical: boolean; sourceUrl: string | null }[];
  hasStaffPick: boolean;
}

export interface PendingReviewPair {
  reviewId: string;
  score: string;
  breakdown: ReviewBreakdown;
  createdAt: Date;
  a: ReviewSide;
  b: ReviewSide;
  suggestedSurvivorId: string;
}

type LoadedEvent = NonNullable<Awaited<ReturnType<typeof loadReviewEvents>>>[number];

async function loadReviewEvents(db: Db, ids: string[]) {
  return db.query.events.findMany({
    where: inArray(schema.events.id, ids),
    with: {
      venue: true,
      instances: { orderBy: [asc(schema.eventInstances.startAt)] }, // no future-only filter
      sourceLinks: { with: { source: true } },
    },
  });
}

function toSide(event: LoadedEvent, pickEventIds: Set<string>): ReviewSide {
  return {
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    status: event.status,
    category: event.category,
    isFree: event.isFree,
    venueName: event.venue?.name ?? null,
    instanceStarts: event.instances.map((instance) => instance.startAt),
    sources: event.sourceLinks.map((link) => ({
      key: link.source.key,
      name: link.source.name,
      isCanonical: link.isCanonical,
      sourceUrl: link.sourceUrl,
    })),
    hasStaffPick: pickEventIds.has(event.id),
  };
}

/** Admin-only, 27-pairs-at-a-time scale: the per-pair provenanceFor call is N+1 by design. */
export async function pendingReviewPairs(db: Db): Promise<PendingReviewPair[]> {
  const reviews = await db.query.eventReviews.findMany({
    where: eq(schema.eventReviews.status, 'pending'),
    orderBy: [desc(schema.eventReviews.score), asc(schema.eventReviews.createdAt)],
  });
  if (reviews.length === 0) return [];

  const eventIds = [...new Set(reviews.flatMap((row) => [row.eventAId, row.eventBId]))];
  const events = await loadReviewEvents(db, eventIds);
  const byId = new Map(events.map((event) => [event.id, event]));
  const picks = await db
    .select({ eventId: schema.staffPicks.eventId })
    .from(schema.staffPicks)
    .where(inArray(schema.staffPicks.eventId, eventIds));
  const pickEventIds = new Set(picks.map((pick) => pick.eventId));

  const pairs: PendingReviewPair[] = [];
  for (const review of reviews) {
    const eventA = byId.get(review.eventAId);
    const eventB = byId.get(review.eventBId);
    if (!eventA || !eventB) continue; // pair raced away (merge cascade) — tolerate, don't throw
    const parsedBreakdown = reviewBreakdownSchema.safeParse(review.breakdown);
    if (!parsedBreakdown.success) {
      console.error('review breakdown corrupt', review.id);
      continue;
    }
    const [provA, provB] = await provenanceFor(db, [review.eventAId, review.eventBId]);
    pairs.push({
      reviewId: review.id,
      score: review.score,
      breakdown: parsedBreakdown.data,
      createdAt: review.createdAt,
      a: toSide(eventA, pickEventIds),
      b: toSide(eventB, pickEventIds),
      suggestedSurvivorId: pickSameShowSurvivor(provA, provB).eventId,
    });
  }
  return pairs;
}

export interface StuckReview {
  reviewId: string;
  resolvedAt: Date;
  aTitle: string;
  bTitle: string;
}

const STUCK_AFTER_MINUTES = 15;

/**
 * A completed merge cascade-deletes its review row — so ANY surviving 'approved'
 * row is a claim whose merge crashed (sweep.ts accepted tradeoff). The age gate
 * only skips claims still in flight.
 */
export async function stuckApprovedReviews(
  db: Db,
  olderThanMinutes: number = STUCK_AFTER_MINUTES,
): Promise<StuckReview[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const rows = await db.query.eventReviews.findMany({
    where: and(eq(schema.eventReviews.status, 'approved'), lt(schema.eventReviews.resolvedAt, cutoff)),
    orderBy: [asc(schema.eventReviews.resolvedAt)],
  });
  if (rows.length === 0) return [];
  const eventIds = [...new Set(rows.flatMap((row) => [row.eventAId, row.eventBId]))];
  const events = await db.query.events.findMany({
    where: inArray(schema.events.id, eventIds),
    columns: { id: true, title: true },
  });
  const titles = new Map(events.map((event) => [event.id, event.title]));
  return rows.map((row) => ({
    reviewId: row.id,
    resolvedAt: row.resolvedAt!,
    aTitle: titles.get(row.eventAId) ?? '(deleted)',
    bTitle: titles.get(row.eventBId) ?? '(deleted)',
  }));
}
