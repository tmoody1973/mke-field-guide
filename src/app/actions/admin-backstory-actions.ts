'use server';

import { revalidatePath } from 'next/cache';
import { backstoryMutation, backstoryFetchDetails, backstoryFindBookingLink, backstoryPinLocation, reviewErrorMessage, type BackstoryMutation } from '@/lib/backstory';
import { currentStaffRole } from '@/lib/staff-guard';
import {
  parseApproval, parseDecision, parseDetailedAnswers, parseDoNotUse, parsePlaceDetails, parsePlaceKey, parseReservation, parseSongFields, parseNeighborhood, parsePin, parseRename, parseSpeaker,
  type BackstoryActionState, type Parsed,
} from './admin-backstory';

// The staff check here is a courtesy; Backstory re-checks the reviewer allowlist inside every mutation.
async function run(mutation: BackstoryMutation, parsed: Parsed, done: string): Promise<BackstoryActionState> {
  return call(mutation, parsed, async (args) => {
    await backstoryMutation(mutation, args);
    return done;
  });
}

async function call(name: string, parsed: Parsed, send: (args: Record<string, unknown>) => Promise<string>): Promise<BackstoryActionState> {
  if (!(await currentStaffRole())) return { ok: false, message: 'Not authorized.' };
  if (!parsed.ok) return parsed;
  let done: string;
  try {
    done = await send(parsed.args);
  } catch (error) {
    console.error(`backstory ${name} failed`, error);
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
export async function setDetailedAnswersAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:setDetailedAnswers', parseDetailedAnswers(formData), 'Saved.');
}

export async function setReservationAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:setReservationUrl', parseReservation(formData), 'Saved.');
}

export async function setPlaceDetailsAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:setPlaceDetails', parsePlaceDetails(formData), 'Saved in every episode.');
}

export async function fetchDetailsAction(_prev: BackstoryActionState, formData: FormData) {
  return call('aws/placeDetails:run', parsePlaceKey(formData), async (args) => {
    const found = await backstoryFetchDetails(args);
    return found.website || found.phone ? 'Details saved.' : 'Saved what Amazon had.';
  });
}

/** A suggested reservation page for the editor to check; nothing is saved until they press Save. */
export async function findBookingLinkAction(key: string): Promise<{ ok: boolean; message: string; url?: string }> {
  if (!(await currentStaffRole())) return { ok: false, message: 'Not authorized.' };
  const form = new FormData();
  form.set('key', key);
  const parsed = parsePlaceKey(form);
  if (!parsed.ok) return parsed;
  try {
    const { url } = await backstoryFindBookingLink(parsed.args);
    return url ? { ok: true, message: 'Found one. Check it opens the right restaurant, then Save.', url } : { ok: true, message: 'No booking page found. The place may be walk-in only.' };
  } catch (error) {
    console.error('backstory bookingLink:find failed', error);
    return { ok: false, message: reviewErrorMessage(error) };
  }
}

export async function setSongFieldsAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:setSongFields', parseSongFields(formData), 'Song details saved.');
}

export async function setDoNotUseAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:setDoNotUse', parseDoNotUse(formData), 'Saved.');
}
export async function pinLocationAction(_prev: BackstoryActionState, formData: FormData) {
  return call('aws/pinLocation:run', parsePin(formData), async (args) => `Pinned at ${(await backstoryPinLocation(args)).label}.`);
}
export async function renameMentionAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:renameMention', parseRename(formData), 'Spelling saved.');
}
