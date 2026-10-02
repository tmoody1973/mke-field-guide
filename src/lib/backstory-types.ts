import { z } from 'zod';

// Backstory's review payloads (tmoody1973/backstory convex/review.ts). Validated because they cross a service boundary.
const status = z.enum(['pending', 'approved', 'rejected']);
const quoted = { quote: z.string().min(1), startMs: z.number() };

export const queueSchema = z.array(z.object({
  storyId: z.string(), title: z.string(), showSlug: z.string(), showName: z.string(), reviewer: z.string(),
  contentType: z.string(), publishedAt: z.number(), stage: z.string(), reviewStatus: status, doNotUse: z.boolean(),
  needsReview: z.enum(['new', 'reprocessed', 'pipeline_failed']),
}));

export const episodeSchema = z.object({
  story: z.object({
    storyId: z.string(), title: z.string(), showSlug: z.string(), showName: z.string(), reviewer: z.string(),
    publishedAt: z.number(), audioUrl: z.string(), permalink: z.string().nullable(), stage: z.string(), reviewStatus: status,
    doNotUse: z.boolean(), proposedSummary: z.string(), summary: z.string().nullable(), latestRunId: z.string(),
    approvedRunId: z.string().nullable(), approvedBy: z.string().nullable(), approvedAt: z.number().nullable(),
  }),
  speakers: z.array(z.object({
    label: z.string(), name: z.string().nullable(), source: z.enum(['suggested', 'editor']).nullable(),
    sample: z.string(), startMs: z.number(), endMs: z.number(),
  })),
  mentions: z.array(z.object({ id: z.string(), entityType: z.string(), name: z.string(), ...quoted, subjectConfidence: z.number().nullable(), reviewStatus: status, doNotUse: z.boolean() })),
  places: z.array(z.object({
    id: z.string(), mentionId: z.string(), name: z.string(), officialName: z.string().nullable(), category: z.string(),
    geocodeLabel: z.string().nullable(), geocodeConfidence: z.number().nullable(), neighborhood: z.string().nullable(), ...quoted, reviewStatus: status,
  })),
  topics: z.array(z.object({ id: z.string(), topic: z.string(), confidence: z.number(), ...quoted, reviewStatus: status })),
  actions: z.array(z.object({ id: z.string(), kind: z.string(), label: z.string(), ...quoted, reviewStatus: status, place: z.string().nullable() })),
});

export type QueueRow = z.infer<typeof queueSchema>[number];
export type Episode = z.infer<typeof episodeSchema>;

