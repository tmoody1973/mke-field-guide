import { z } from 'zod';

export const MAX_DESCRIPTION_LENGTH = 10_000;

export const normalizedEventSchema = z
  .object({
    sourceEventId: z.string().min(1),
    title: z.string().trim().min(1).max(500),
    description: z
      .string()
      .transform((s) => s.slice(0, MAX_DESCRIPTION_LENGTH))
      .optional(),
    url: z.string().url().optional(),
    imageUrl: z.string().url().optional(),
    venueName: z.string().trim().min(1).optional(),
    venueAddress: z.string().optional(),
    venueLat: z.number().min(-90).max(90).optional(),
    venueLng: z.number().min(-180).max(180).optional(),
    isFree: z.boolean().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date().optional(),
    timezone: z.string().default('America/Chicago'),
    status: z.enum(['scheduled', 'cancelled', 'postponed']).default('scheduled'),
  })
  .refine((e) => !e.endAt || e.endAt.getTime() >= e.startAt.getTime(), {
    message: 'endAt must not be before startAt',
    path: ['endAt'],
  });

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
