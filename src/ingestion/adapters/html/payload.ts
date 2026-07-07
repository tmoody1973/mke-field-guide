import { z } from 'zod';
import { normalizeWith } from '../helpers';

export const htmlPayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().optional(),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  status: z.string().optional(),
  venueName: z.string().optional(),
  venueAddress: z.string().optional(),
  venueLat: z.number().optional(),
  venueLng: z.number().optional(),
  imageUrl: z.string().optional(),
  isFree: z.boolean().optional(),
});

export type HtmlEventPayload = z.infer<typeof htmlPayloadSchema>;

function mapStatus(status: string | undefined): 'scheduled' | 'cancelled' | 'postponed' {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'postponed') return 'postponed';
  return 'scheduled';
}

export const normalizeHtmlRecord = normalizeWith(htmlPayloadSchema, (p) => ({
  sourceEventId: p.id,
  title: p.name,
  description: p.description,
  url: p.url,
  imageUrl: p.imageUrl,
  venueName: p.venueName,
  venueAddress: p.venueAddress,
  venueLat: p.venueLat,
  venueLng: p.venueLng,
  startAt: p.startDate,
  endAt: p.endDate,
  isFree: p.isFree,
  status: mapStatus(p.status),
}));
