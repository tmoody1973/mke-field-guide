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
  storyId: id, id, table: z.enum(['mentions', 'places', 'storyTopics', 'storyActions', 'songs']), status: z.enum(['approved', 'rejected', 'pending']),
  reason: z.enum(['wrong', 'sensitive', 'minor']).optional(),
});
export function parseDecision(formData: FormData): Parsed {
  const result = decision.safeParse(fields(formData));
  if (!result.success) return INVALID;
  const { storyId, table, id: itemId, status, reason } = result.data;
  return { ok: true, storyId, args: { item: { table, id: itemId }, status, ...(reason ? { reason } : {}) } };
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

const detailedAnswers = z.object({ storyId: id, allow: z.enum(['true', 'false']) });
export function parseDetailedAnswers(formData: FormData): Parsed {
  const result = detailedAnswers.safeParse(fields(formData));
  if (!result.success) return INVALID;
  const { storyId, allow } = result.data;
  return { ok: true, storyId, args: { storyId, allow: allow === 'true' } };
}

export const PLACE_CATEGORIES = ['restaurant', 'bar', 'venue', 'park', 'organization'] as const;
const pin = z.object({ storyId: id, mentionId: id, address: z.string().trim().min(5).max(200), category: z.enum(PLACE_CATEGORIES) });
export function parsePin(formData: FormData): Parsed {
  const result = pin.safeParse(fields(formData));
  if (!result.success) return { ok: false, message: 'Enter a street address and pick a category.' };
  const { storyId, ...args } = result.data;
  return { ok: true, storyId, args };
}

const reservation = z.object({ storyId: id, placeId: id, url: z.string().trim().max(500) });
export function parseReservation(formData: FormData): Parsed {
  const result = reservation.safeParse(fields(formData));
  if (!result.success) return { ok: false, message: 'That link is too long.' };
  const { storyId, placeId, url } = result.data;
  return { ok: true, storyId, args: { placeId, url: url || null } };
}

const songFields = z.object({
  storyId: id, songId: id,
  title: z.string().trim().max(200).optional(), album: z.string().trim().max(200).optional(),
  releaseDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional(),
});
export function parseSongFields(formData: FormData): Parsed {
  const result = songFields.safeParse(fields(formData));
  if (!result.success) return INVALID;
  const { storyId, ...args } = result.data;
  return { ok: true, storyId, args };
}

// Place-wide edits refresh the Places page (call() revalidates /admin/backstory/<storyId>).
const PLACES_PAGE = 'places';
const placeKey = z.string().trim().min(1).max(200);
const placeDetails = z.object({
  key: placeKey,
  neighborhood: z.union([z.enum(neighborhoodNames), z.literal('')]).optional(),
  reservationUrl: z.string().trim().max(500).optional(),
});
export function parsePlaceDetails(formData: FormData): Parsed {
  const result = placeDetails.safeParse(fields(formData));
  if (!result.success) return INVALID;
  const { key, neighborhood, reservationUrl } = result.data;
  return {
    ok: true, storyId: PLACES_PAGE,
    args: { key, ...(neighborhood !== undefined ? { neighborhood: neighborhood || null } : {}), ...(reservationUrl !== undefined ? { reservationUrl: reservationUrl || null } : {}) },
  };
}
export function parsePlaceKey(formData: FormData): Parsed {
  const result = z.object({ key: placeKey }).safeParse(fields(formData));
  return result.success ? { ok: true, storyId: PLACES_PAGE, args: { key: result.data.key } } : INVALID;
}

const rename = z.object({ storyId: id, mentionId: id, name: z.string().trim().min(1).max(120) });
export function parseRename(formData: FormData): Parsed {
  const result = rename.safeParse(fields(formData));
  if (!result.success) return { ok: false, message: 'Names are 1 to 120 characters.' };
  const { storyId, ...args } = result.data;
  return { ok: true, storyId, args };
}
