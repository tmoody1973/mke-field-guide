import { z } from 'zod';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { fetchJson, normalizeWith, requireEnv, toFiniteNumber } from './helpers';
import type { FetchedRecord, SourceAdapter } from './types';

const configSchema = z.object({
  adapter: z.literal('ticketmaster'),
  city: z.string().default('Milwaukee'),
  stateCode: z.string().default('WI'),
});

const payloadSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  url: z.string().optional(),
  startDateTime: z.string().optional(),
  statusCode: z.string().optional(),
  venueName: z.string().optional(),
  venueAddress: z.string().optional(),
  venueLat: z.number().optional(),
  venueLng: z.number().optional(),
  imageUrl: z.string().optional(),
});

const API_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';
const PAGE_SIZE = 199;
const MAX_PAGES = 5;
const PAGE_DELAY_MS = 250;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function extractTicketmasterRecords(page: any): FetchedRecord[] {
  const events: any[] = page?._embedded?.events ?? [];
  return events.map((event) => {
    const venue = event?._embedded?.venues?.[0];
    const addressParts = [venue?.address?.line1, venue?.city?.name].filter(Boolean);
    return {
      sourceEventId: String(event.id),
      sourceUrl: event.url,
      payload: {
        id: String(event.id),
        name: event.name,
        url: event.url ?? undefined,
        startDateTime: event?.dates?.start?.dateTime ?? undefined,
        statusCode: event?.dates?.status?.code ?? undefined,
        venueName: venue?.name ?? undefined,
        venueAddress: addressParts.length > 0 ? addressParts.join(', ') : undefined,
        venueLat: toFiniteNumber(venue?.location?.latitude),
        venueLng: toFiniteNumber(venue?.location?.longitude),
        imageUrl: event?.images?.[0]?.url ?? undefined,
      },
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mapStatus(code: string | undefined): NormalizedEvent['status'] {
  if (code === 'cancelled' || code === 'canceled') return 'cancelled';
  if (code === 'postponed' || code === 'rescheduled') return 'postponed';
  return 'scheduled';
}

function requireApiKey(): string {
  return requireEnv('TICKETMASTER_API_KEY', 'register at developer.ticketmaster.com');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPage(apiKey: string, config: z.infer<typeof configSchema>, pageNumber: number): Promise<any> {
  const url = new URL(API_URL);
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('city', config.city);
  url.searchParams.set('stateCode', config.stateCode);
  url.searchParams.set('size', String(PAGE_SIZE));
  url.searchParams.set('page', String(pageNumber));
  return fetchJson(url, {}, `Ticketmaster page ${pageNumber}`);
}

export const ticketmasterAdapter: SourceAdapter = {
  adapterType: 'api',

  async fetch(rawConfig: unknown): Promise<FetchedRecord[]> {
    const config = configSchema.parse(rawConfig);
    const apiKey = requireApiKey();
    const records: FetchedRecord[] = [];
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const page = await fetchPage(apiKey, config, pageNumber);
      records.push(...extractTicketmasterRecords(page));
      if (pageNumber >= (page?.page?.totalPages ?? 1) - 1) break;
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
    return records;
  },

  normalize: normalizeWith(payloadSchema, (p) => {
    if (!p.startDateTime) return null;
    return {
      sourceEventId: p.id,
      title: p.name,
      url: p.url,
      imageUrl: p.imageUrl,
      venueName: p.venueName,
      venueAddress: p.venueAddress,
      venueLat: p.venueLat,
      venueLng: p.venueLng,
      startAt: p.startDateTime,
      status: mapStatus(p.statusCode),
    };
  }),
};
