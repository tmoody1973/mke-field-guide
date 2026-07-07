import ical from 'node-ical';
import { z } from 'zod';
import {
  normalizedEventSchema,
  type NormalizedEvent,
} from '@/lib/validation/normalized-event';
import type { FetchedRecord, SourceAdapter } from './types';

const icalConfigSchema = z.object({ icalUrl: z.string().url() });

const icalPayloadSchema = z.object({
  uid: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  url: z.string().optional(),
  startAt: z.string(),
  endAt: z.string().optional(),
  status: z.string().optional(),
});

export function parseIcsText(text: string): FetchedRecord[] {
  const parsed = ical.sync.parseICS(text);
  const records: FetchedRecord[] = [];
  for (const component of Object.values(parsed)) {
    if (component.type !== 'VEVENT') continue;
    const vevent = component;
    if (!vevent.uid || !vevent.summary || !vevent.start) continue;
    const url = typeof vevent.url === 'string' ? vevent.url : undefined;
    const startAt = vevent.start.toISOString();
    const endAtIso = vevent.end ? vevent.end.toISOString() : undefined;
    // Treat end time same as start time (instantaneous event) as no end time
    const endAt = endAtIso && endAtIso !== startAt ? endAtIso : undefined;
    records.push({
      sourceEventId: vevent.uid,
      sourceUrl: url,
      payload: {
        uid: vevent.uid,
        summary: String(vevent.summary),
        description: vevent.description ? String(vevent.description) : undefined,
        location: vevent.location ? String(vevent.location) : undefined,
        url,
        startAt,
        endAt,
        status: vevent.status ? String(vevent.status) : undefined,
      },
    });
  }
  return records;
}

function mapStatus(raw: string | undefined): NormalizedEvent['status'] {
  if (raw?.toUpperCase() === 'CANCELLED') return 'cancelled';
  return 'scheduled';
}

export const icalAdapter: SourceAdapter = {
  adapterType: 'ical',

  async fetch(config: unknown): Promise<FetchedRecord[]> {
    const { icalUrl } = icalConfigSchema.parse(config);
    const res = await fetch(icalUrl, {
      headers: { 'user-agent': 'MKEEventsBot/0.1 (event aggregation; Milwaukee, WI)' },
    });
    if (!res.ok) throw new Error(`iCal fetch failed (${res.status}) for ${icalUrl}`);
    return parseIcsText(await res.text());
  },

  normalize(record: FetchedRecord): NormalizedEvent | null {
    const payload = icalPayloadSchema.safeParse(record.payload);
    if (!payload.success) return null;
    const p = payload.data;
    const venueName = p.location?.split(',')[0]?.trim();
    const result = normalizedEventSchema.safeParse({
      sourceEventId: p.uid,
      title: p.summary,
      description: p.description,
      url: p.url,
      venueName: venueName || undefined,
      venueAddress: p.location,
      startAt: p.startAt,
      endAt: p.endAt,
      status: mapStatus(p.status),
    });
    return result.success ? result.data : null;
  },
};
