import { z } from 'zod';
import { applyReview } from '@/dedup/sweep';
import type { Db } from '@/lib/card-data';

export interface ReviewActionState {
  ok: boolean;
  message: string;
}

const approveSchema = z.object({ reviewId: z.uuid(), survivorEventId: z.uuid() });
const rejectSchema = z.object({ reviewId: z.uuid() });

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
