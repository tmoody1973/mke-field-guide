import { auth } from '@clerk/nextjs/server';
import { fetchAction, fetchMutation, fetchQuery } from 'convex/nextjs';
import { makeFunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import type { z } from 'zod';

// Backstory's functions live in another repo (tmoody1973/backstory), so they're referenced by name, the way
// src/app/api/now-playing/route.ts references the playlist deployment. Every one checks the reviewer allowlist itself.
type BackstoryQuery = 'review:queue' | 'review:episode';
export type BackstoryMutation =
  | 'reviewMutations:decideItem' | 'reviewMutations:approveEpisode' | 'reviewMutations:setSpeakerName'
  | 'reviewMutations:setPlaceNeighborhood' | 'reviewMutations:setDoNotUse' | 'reviewMutations:setDetailedAnswers' | 'reviewMutations:setReservationUrl' | 'reviewMutations:renameMention';

const MESSAGES: Record<string, string> = {
  not_signed_in: 'Your sign-in expired. Reload the page to sign in again.',
  not_a_reviewer: "You're signed in, but not on the Backstory reviewer list.",
  stale_run: 'This episode was re-processed since you opened it. Reload to review the new version.',
  invalid_summary: 'The summary must be between 1 and 1,500 characters.',
  not_ready: 'Still finding map pins for this episode. Try again in a minute.',
  invalid_address: 'Enter a street address between 5 and 200 characters.',
  no_match: "Couldn't find that address in the Milwaukee area. Check it and try again.",
  not_locatable: 'Only places people can visit get a location, never a person.',
  invalid_name: 'That name is empty or too long.',
  invalid_neighborhood: 'Pick a neighborhood from the list.',
  invalid_reservation_url: 'Use an https link from OpenTable, Resy, Tock or SevenRooms.',
  not_found: 'That item no longer exists. Reload the page.',
};
const UNAVAILABLE = 'Backstory is unavailable right now. Try again in a minute.';

export function reviewErrorMessage(error: unknown): string {
  const code = error instanceof ConvexError ? (error.data as { code?: string })?.code : undefined;
  return (code && MESSAGES[code]) || UNAVAILABLE;
}

async function connection(): Promise<{ token: string; url: string }> {
  const url = process.env.BACKSTORY_CONVEX_URL;
  if (!url) throw new Error('BACKSTORY_CONVEX_URL is not set');
  // Clerk mints a token Backstory's convex/auth.config.ts trusts (applicationID "convex").
  const token = await (await auth()).getToken({ template: 'convex' });
  if (!token) throw new ConvexError({ code: 'not_signed_in' });
  return { token, url };
}

export async function backstoryQuery<T>(name: BackstoryQuery, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const result = await fetchQuery(makeFunctionReference<'query'>(name), args, await connection());
  return schema.parse(result);
}

export async function backstoryMutation(name: BackstoryMutation, args: Record<string, unknown>): Promise<unknown> {
  return fetchMutation(makeFunctionReference<'mutation'>(name), args, await connection());
}

/** "Add location": Backstory looks the address up with Amazon Location and returns the matched address. */
export async function backstoryPinLocation(args: Record<string, unknown>): Promise<{ label: string }> {
  return fetchAction(makeFunctionReference<'action'>('aws/pinLocation:run'), args, await connection());
}
