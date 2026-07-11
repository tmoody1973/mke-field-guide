'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { currentStaffRole } from '@/lib/staff-guard';
import { mergeVenuesWithDb, type VenueActionState } from '@/app/actions/admin-venues';
import {
  applyVenueSuggestionWithDb,
  dismissVenueSuggestionWithDb,
} from '@/app/actions/admin-venue-suggestions';

const NOT_AUTHORIZED: VenueActionState = { ok: false, message: 'Not authorized.' };
const REVALIDATE_PATHS = ['/admin/venues', '/admin/events', '/', '/events'];

export async function mergeVenuesAction(
  _prev: VenueActionState,
  formData: FormData,
): Promise<VenueActionState> {
  const staff = await currentStaffRole();
  if (staff === null || staff.role !== 'admin') return NOT_AUTHORIZED;
  const result = await mergeVenuesWithDb(db, {
    keepId: formData.get('keepId'),
    absorbId: formData.get('absorbId'),
  });
  if (result.ok) {
    for (const path of REVALIDATE_PATHS) revalidatePath(path);
  }
  return result;
}

export async function applyVenueSuggestionAction(
  _prev: VenueActionState,
  formData: FormData,
): Promise<VenueActionState> {
  const staff = await currentStaffRole();
  if (staff === null || staff.role !== 'admin') return NOT_AUTHORIZED;
  const result = await applyVenueSuggestionWithDb(db, { suggestionId: formData.get('suggestionId') });
  if (result.ok) {
    for (const path of REVALIDATE_PATHS) revalidatePath(path);
  }
  return result;
}

export async function dismissVenueSuggestionAction(
  _prev: VenueActionState,
  formData: FormData,
): Promise<VenueActionState> {
  const staff = await currentStaffRole();
  if (staff === null || staff.role !== 'admin') return NOT_AUTHORIZED;
  const result = await dismissVenueSuggestionWithDb(db, { suggestionId: formData.get('suggestionId') });
  if (result.ok) {
    for (const path of REVALIDATE_PATHS) revalidatePath(path);
  }
  return result;
}
