'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { currentStaffRole } from '@/lib/staff-guard';
import {
  applyTitleSuggestionWithDb,
  dismissTitleSuggestionWithDb,
  unlockFieldWithDb,
  updateEventWithDb,
  updateInstanceTimeWithDb,
  type EventActionState,
} from '@/app/actions/admin-events';

const NOT_AUTHORIZED: EventActionState = { ok: false, message: 'Not authorized.' };

// The editor identity for provenance rows: the verified staff email, or null if not admin.
async function adminEmail(): Promise<string | null> {
  const staff = await currentStaffRole();
  return staff !== null && staff.role === 'admin' ? staff.email : null;
}

// Public pages: event detail is force-dynamic (no revalidate needed); card surfaces are listed.
const EDIT_REVALIDATE_PATHS = ['/admin/events', '/', '/events', '/picks', '/digest'];

function revalidateEdits(): void {
  for (const path of EDIT_REVALIDATE_PATHS) revalidatePath(path);
}

export async function updateEventAction(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const email = await adminEmail();
  if (!email) return NOT_AUTHORIZED;
  const result = await updateEventWithDb(db, email, {
    eventId: formData.get('eventId'),
    title: formData.get('title'),
    status: formData.get('status'),
    category: formData.get('category'),
    venueId: formData.get('venueId'),
  });
  if (result.ok) revalidateEdits();
  return result;
}

export async function updateInstanceTimeAction(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const email = await adminEmail();
  if (!email) return NOT_AUTHORIZED;
  const result = await updateInstanceTimeWithDb(db, email, {
    instanceId: formData.get('instanceId'),
    startAt: formData.get('startAt'),
    endAt: formData.get('endAt'),
  });
  if (result.ok) revalidateEdits();
  return result;
}

export async function applyTitleSuggestionAction(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const email = await adminEmail();
  if (!email) return NOT_AUTHORIZED;
  const result = await applyTitleSuggestionWithDb(db, email, { eventId: formData.get('eventId') });
  if (result.ok) revalidateEdits();
  return result;
}

export async function dismissTitleSuggestionAction(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const email = await adminEmail();
  if (!email) return NOT_AUTHORIZED;
  const result = await dismissTitleSuggestionWithDb(db, email, { eventId: formData.get('eventId') });
  if (result.ok) revalidateEdits();
  return result;
}

export async function unlockFieldAction(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const email = await adminEmail();
  if (!email) return NOT_AUTHORIZED;
  const result = await unlockFieldWithDb(db, email, {
    eventId: formData.get('eventId'),
    field: formData.get('field'),
  });
  if (result.ok) revalidateEdits();
  return result;
}
