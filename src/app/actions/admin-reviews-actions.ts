'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { currentStaffRole } from '@/lib/staff-guard';
import {
  approveReviewWithDb,
  rejectReviewWithDb,
  type ReviewActionState,
} from '@/app/actions/admin-reviews';

const NOT_AUTHORIZED: ReviewActionState = { ok: false, message: 'Not authorized.' };

async function isAdmin(): Promise<boolean> {
  const staff = await currentStaffRole();
  return staff !== null && staff.role === 'admin';
}

export async function approveReviewAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  if (!(await isAdmin())) return NOT_AUTHORIZED;
  const result = await approveReviewWithDb(db, {
    reviewId: formData.get('reviewId'),
    survivorEventId: formData.get('survivorEventId'),
  });
  if (result.ok) {
    for (const path of ['/admin/review', '/', '/picks', '/digest']) revalidatePath(path);
  }
  return result;
}

export async function rejectReviewAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  if (!(await isAdmin())) return NOT_AUTHORIZED;
  const result = await rejectReviewWithDb(db, { reviewId: formData.get('reviewId') });
  if (result.ok) revalidatePath('/admin/review');
  return result;
}
