'use server';

import { revalidatePath } from 'next/cache';
import { backstoryMutation, reviewErrorMessage, type BackstoryMutation } from '@/lib/backstory';
import { currentStaffRole } from '@/lib/staff-guard';
import {
  parseApproval, parseDecision, parseDoNotUse, parseNeighborhood, parseSpeaker,
  type BackstoryActionState, type Parsed,
} from './admin-backstory';

// The staff check here is a courtesy; Backstory re-checks the reviewer allowlist inside every mutation.
async function run(mutation: BackstoryMutation, parsed: Parsed, done: string): Promise<BackstoryActionState> {
  if (!(await currentStaffRole())) return { ok: false, message: 'Not authorized.' };
  if (!parsed.ok) return parsed;
  try {
    await backstoryMutation(mutation, parsed.args);
  } catch (error) {
    console.error(`backstory ${mutation} failed`, error);
    return { ok: false, message: reviewErrorMessage(error) };
  }
  revalidatePath('/admin/backstory');
  revalidatePath(`/admin/backstory/${parsed.storyId}`);
  return { ok: true, message: done };
}

export async function decideItemAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:decideItem', parseDecision(formData), 'Saved.');
}
export async function approveEpisodeAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:approveEpisode', parseApproval(formData), 'Approved. Alexa can use this episode now.');
}
export async function setSpeakerNameAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:setSpeakerName', parseSpeaker(formData), 'Saved.');
}
export async function setNeighborhoodAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:setPlaceNeighborhood', parseNeighborhood(formData), 'Saved.');
}
export async function setDoNotUseAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:setDoNotUse', parseDoNotUse(formData), 'Saved.');
}
