import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import { applyReview } from '@/dedup/sweep';
import type { Db } from '@/lib/card-data';

export interface ReviewActionState {
  ok: boolean;
  message: string;
}

const approveSchema = z.object({ reviewId: z.uuid(), survivorEventId: z.uuid() });
const rejectSchema = z.object({ reviewId: z.uuid() });
const returnStuckSchema = z.object({ reviewId: z.uuid() });

type ReviewInput = Record<string, FormDataEntryValue | null>;

export async function approveReviewWithDb(db: Db, input: ReviewInput): Promise<ReviewActionState> {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Pick a survivor before approving.' };
  return applyReview(db, parsed.data.reviewId, 'approved', parsed.data.survivorEventId);
}

export async function rejectReviewWithDb(db: Db, input: ReviewInput): Promise<ReviewActionState> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Unknown review.' };
  return applyReview(db, parsed.data.reviewId, 'rejected');
}

/** CAS: only an 'approved' (stuck) row returns to the queue; a raced re-approve loses cleanly. */
export async function returnStuckReviewWithDb(db: Db, input: ReviewInput): Promise<ReviewActionState> {
  const parsed = returnStuckSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Unknown review.' };
  const updated = await db
    .update(schema.eventReviews)
    .set({ status: 'pending', resolvedAt: null })
    .where(and(eq(schema.eventReviews.id, parsed.data.reviewId), eq(schema.eventReviews.status, 'approved')))
    .returning({ id: schema.eventReviews.id });
  if (updated.length === 0) return { ok: false, message: 'Review is no longer stuck.' };
  return { ok: true, message: 'Returned to the queue — decide it again below.' };
}
