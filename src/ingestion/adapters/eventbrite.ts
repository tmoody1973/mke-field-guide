import { z } from 'zod';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { fetchJson, normalizeWith, requireEnv, toFiniteNumber } from './helpers';
import type { FetchedRecord, SourceAdapter } from './types';

const configSchema = z.object({
  adapter: z.literal('eventbrite'),
  organizerIds: z.array(z.string().min(1)).min(1),
});

const payloadSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().optional(),
  startUtc: z.string(),
  endUtc: z.string().optional(),
  status: z.string().optional(),
  isFree: z.boolean().optional(),
  venueName: z.string().optional(),
  venueAddress: z.string().optional(),
  venueLat: z.number().optional(),
  venueLng: z.number().optional(),
  imageUrl: z.string().optional(),
});

const API_BASE = 'https://www.eventbriteapi.com/v3';
const MAX_PAGES = 5;

/* eslint-disable @typescript-eslint/no-explicit-any */
function toPayload(event: any): Record<string, unknown> {
  return {
    id: String(event.id),
    name: event?.name?.text,
    description: event?.summary ?? undefined,
    url: event.url ?? undefined,
    startUtc: event?.start?.utc,
    endUtc: event?.end?.utc ?? undefined,
    status: event?.status ?? undefined,
    isFree: event?.is_free ?? undefined,
    venueName: event?.venue?.name ?? undefined,
    venueAddress: event?.venue?.address?.localized_address_display ?? undefined,
    venueLat: toFiniteNumber(event?.venue?.latitude),
    venueLng: toFiniteNumber(event?.venue?.longitude),
    imageUrl: event?.logo?.url ?? undefined,
  };
}

export function extractEventbriteRecords(page: any): FetchedRecord[] {
  const events: any[] = page?.events ?? [];
  return events.map((event) => ({
    sourceEventId: String(event.id),
    sourceUrl: event.url,
    payload: toPayload(event),
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mapStatus(status: string | undefined): NormalizedEvent['status'] {
  if (status === 'canceled' || status === 'cancelled') return 'cancelled';
  if (status === 'postponed') return 'postponed';
  return 'scheduled';
}

function requireToken(): string {
  return requireEnv('EVENTBRITE_PRIVATE_TOKEN', 'create one at eventbrite.com/platform');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchOrganizerPage(token: string, organizerId: string, continuation?: string): Promise<any> {
  const url = new URL(`${API_BASE}/organizers/${organizerId}/events/`);
  url.searchParams.set('status', 'live');
  url.searchParams.set('order_by', 'start_asc');
  url.searchParams.set('expand', 'venue');
  if (continuation) url.searchParams.set('continuation', continuation);
  return fetchJson(url, { headers: { authorization: `Bearer ${token}` } }, `Eventbrite organizer ${organizerId}`);
}

async function fetchOrganizer(token: string, organizerId: string): Promise<FetchedRecord[]> {
  const records: FetchedRecord[] = [];
  let continuation: string | undefined;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const page = await fetchOrganizerPage(token, organizerId, continuation);
    records.push(...extractEventbriteRecords(page));
    if (!page?.pagination?.has_more_items) break;
    const next = page?.pagination?.continuation;
    if (!next) break;
    continuation = next;
  }
  return records;
}

export const eventbriteAdapter: SourceAdapter = {
  adapterType: 'api',

  async fetch(rawConfig: unknown): Promise<FetchedRecord[]> {
    const config = configSchema.parse(rawConfig);
    const token = requireToken();
    const all: FetchedRecord[] = [];
    for (const organizerId of config.organizerIds) {
      all.push(...(await fetchOrganizer(token, organizerId)));
    }
    return all;
  },

  normalize: normalizeWith(payloadSchema, (p) => ({
    sourceEventId: p.id,
    title: p.name,
    description: p.description,
    url: p.url,
    imageUrl: p.imageUrl,
    venueName: p.venueName,
    venueAddress: p.venueAddress,
    venueLat: p.venueLat,
    venueLng: p.venueLng,
    startAt: p.startUtc,
    endAt: p.endUtc,
    isFree: p.isFree,
    status: mapStatus(p.status),
  })),
};
