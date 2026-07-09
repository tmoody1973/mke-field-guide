'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { currentStaffRole } from '@/lib/staff-guard';
import {
  createPickWithDb,
  deletePickWithDb,
  updatePickWithDb,
  type AdminPickState,
} from '@/app/actions/admin-picks';

const NOT_AUTHORIZED: AdminPickState = { ok: false, message: 'Not authorized.' };

function pickInputFromForm(formData: FormData): Record<string, FormDataEntryValue | null> {
  return {
    eventId: formData.get('eventId'),
    curatorName: formData.get('curatorName'),
    curatorRole: formData.get('curatorRole'),
    showUrl: formData.get('showUrl'),
    blurb: formData.get('blurb'),
    weekOf: formData.get('weekOf'),
    sortOrder: formData.get('sortOrder'),
  };
}

function revalidatePickSurfaces(): void {
  for (const path of ['/admin/picks', '/', '/picks', '/digest']) revalidatePath(path);
}

export async function createPickAction(
  _prev: AdminPickState,
  formData: FormData,
): Promise<AdminPickState> {
  if (!(await currentStaffRole())) return NOT_AUTHORIZED;
  const input = pickInputFromForm(formData);
  const result = await createPickWithDb(db, input);
  if (!result.ok) return result;
  revalidatePickSurfaces();
  redirect(`/admin/picks?week=${input.weekOf}`);
}

export async function updatePickAction(
  id: string,
  _prev: AdminPickState,
  formData: FormData,
): Promise<AdminPickState> {
  if (!(await currentStaffRole())) return NOT_AUTHORIZED;
  const input = pickInputFromForm(formData);
  const result = await updatePickWithDb(db, id, input);
  if (!result.ok) return result;
  revalidatePickSurfaces();
  redirect(`/admin/picks?week=${input.weekOf}`);
}

export async function deletePickAction(
  id: string,
  _prev: AdminPickState,
  _formData: FormData,
): Promise<AdminPickState> {
  if (!(await currentStaffRole())) return NOT_AUTHORIZED;
  const result = await deletePickWithDb(db, id);
  if (!result.ok) return result;
  revalidatePickSurfaces();
  redirect('/admin/picks');
}
