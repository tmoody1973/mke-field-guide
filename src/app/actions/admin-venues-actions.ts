'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { currentStaffRole } from '@/lib/staff-guard';
import { mergeVenuesWithDb, type VenueActionState } from '@/app/actions/admin-venues';

const NOT_AUTHORIZED: VenueActionState = { ok: false, message: 'Not authorized.' };

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
    for (const path of ['/admin/venues', '/admin/events', '/', '/events']) revalidatePath(path);
  }
  return result;
}
