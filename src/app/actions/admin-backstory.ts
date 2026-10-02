import { z } from 'zod';
import { NEIGHBORHOODS } from '@/lib/neighborhoods';

export interface BackstoryActionState {
  ok: boolean;
  message: string;
}

export type Parsed = { ok: true; storyId: string; args: Record<string, unknown> } | { ok: false; message: string };

const INVALID: Parsed = { ok: false, message: 'That form was incomplete. Reload the page and try again.' };
const id = z.string().min(1).max(64);
const fields = (formData: FormData) => Object.fromEntries(formData.entries());

const decision = z.object({
  storyId: id, id, table: z.enum(['mentions', 'places', 'storyTopics', 'storyActions']), status: z.enum(['approved', 'rejected', 'pending']),
});
export function parseDecision(formData: FormData): Parsed {
  const result = decision.safeParse(fields(formData));
  if (!result.success) return INVALID;
  const { storyId, table, id: itemId, status } = result.data;
  return { ok: true, storyId, args: { item: { table, id: itemId }, status } };
}

const approval = z.object({ storyId: id, runId: id, summary: z.string() });
export function parseApproval(formData: FormData): Parsed {
  const result = approval.safeParse(fields(formData));
  return result.success ? { ok: true, storyId: result.data.storyId, args: result.data } : INVALID;
}

const speaker = z.object({ storyId: id, label: z.string().regex(/^spk_\d+$/), name: z.string() });
export function parseSpeaker(formData: FormData): Parsed {
  const result = speaker.safeParse(fields(formData));
  return result.success ? { ok: true, storyId: result.data.storyId, args: result.data } : INVALID;
}

const neighborhoodNames = NEIGHBORHOODS.map((n) => n.name) as [string, ...string[]];
const neighborhood = z.object({ storyId: id, placeId: id, neighborhood: z.union([z.enum(neighborhoodNames), z.literal('')]) });
export function parseNeighborhood(formData: FormData): Parsed {
  const result = neighborhood.safeParse(fields(formData));
  if (!result.success) return INVALID;
  const { storyId, placeId, neighborhood: name } = result.data;
  return { ok: true, storyId, args: { placeId, neighborhood: name || null } };
}

const doNotUse = z.object({ storyId: id, table: z.enum(['stories', 'mentions']), id, doNotUse: z.enum(['true', 'false']) });
export function parseDoNotUse(formData: FormData): Parsed {
  const result = doNotUse.safeParse(fields(formData));
  if (!result.success) return INVALID;
  const { storyId, table, id: targetId, doNotUse: flag } = result.data;
  return { ok: true, storyId, args: { target: { table, id: targetId }, doNotUse: flag === 'true' } };
}

export const PLACE_CATEGORIES = ['restaurant', 'bar', 'venue', 'park', 'organization'] as const;
const pin = z.object({ storyId: id, mentionId: id, address: z.string().trim().min(5).max(200), category: z.enum(PLACE_CATEGORIES) });
export function parsePin(formData: FormData): Parsed {
  const result = pin.safeParse(fields(formData));
  if (!result.success) return { ok: false, message: 'Enter a street address and pick a category.' };
  const { storyId, ...args } = result.data;
  return { ok: true, storyId, args };
}

const rename = z.object({ storyId: id, mentionId: id, name: z.string().trim().min(1).max(120) });
export function parseRename(formData: FormData): Parsed {
  const result = rename.safeParse(fields(formData));
  if (!result.success) return { ok: false, message: 'Names are 1 to 120 characters.' };
  const { storyId, ...args } = result.data;
  return { ok: true, storyId, args };
}
