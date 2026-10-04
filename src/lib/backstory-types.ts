import { z } from 'zod';

// Backstory's review payloads (tmoody1973/backstory convex/review.ts). Validated because they cross a service boundary.
const status = z.enum(['pending', 'approved', 'rejected']);
const quoted = { quote: z.string().min(1), startMs: z.number() };
// Defaults keep the page working against a Backstory deploy that predates these fields.
const removeReason = z.enum(['wrong', 'sensitive', 'minor']).nullable().default(null);
const attention = z.enum(['no_pin', 'uncertain_pin', 'passing_mention']).nullable().default(null);
const triage = { removeReason, attention };

export const queueSchema = z.array(z.object({
  storyId: z.string(), title: z.string(), showSlug: z.string(), showName: z.string(), reviewer: z.string(),
  contentType: z.string(), publishedAt: z.number(), stage: z.string(), reviewStatus: status, doNotUse: z.boolean(),
  needsReview: z.enum(['new', 'reprocessed', 'pipeline_failed']),
  items: z.number().default(0), needsYou: z.number().default(0),
}));

export const episodeSchema = z.object({
  story: z.object({
    storyId: z.string(), title: z.string(), showSlug: z.string(), showName: z.string(), reviewer: z.string(),
    contentType: z.enum(['episode', 'premiere', 'session']).default('episode'),
    publishedAt: z.number(), audioUrl: z.string(), permalink: z.string().nullable(), stage: z.string(), reviewStatus: status,
    doNotUse: z.boolean(), proposedSummary: z.string(), summary: z.string().nullable(), latestRunId: z.string(),
    approvedRunId: z.string().nullable(), approvedBy: z.string().nullable(), approvedAt: z.number().nullable(),
    attribution: z.string().default(''),
    allowDetailedAnswers: z.boolean().default(false), detailedAnswersDefault: z.boolean().default(false),
  }),
  speakers: z.array(z.object({
    label: z.string(), name: z.string().nullable(), source: z.enum(['suggested', 'editor']).nullable(),
    sample: z.string(), startMs: z.number(), endMs: z.number(),
  })),
  mentions: z.array(z.object({ id: z.string(), entityType: z.string(), name: z.string(), ...quoted, subjectConfidence: z.number().nullable(), reviewStatus: status, doNotUse: z.boolean(), ...triage })),
  places: z.array(z.object({
    id: z.string(), mentionId: z.string(), name: z.string(), officialName: z.string().nullable(), category: z.string(),
    geocodeLabel: z.string().nullable(), geocodeConfidence: z.number().nullable(), neighborhood: z.string().nullable(), reservationUrl: z.string().nullable().default(null), ...quoted, reviewStatus: status, ...triage,
  })),
  topics: z.array(z.object({ id: z.string(), topic: z.string(), confidence: z.number(), ...quoted, reviewStatus: status, ...triage })),
  actions: z.array(z.object({ id: z.string(), kind: z.string(), label: z.string(), ...quoted, reviewStatus: status, place: z.string().nullable(), ...triage })),
  // Premieres and sessions: the song record under review (Backstory review.episode `song`).
  song: z.object({
    songId: z.string(), kind: z.enum(['premiere', 'session']), artist: z.string(), title: z.string().optional(), album: z.string().optional(),
    releaseDate: z.string().optional(), credits: z.array(z.object({ role: z.string(), name: z.string() })),
    releaseShow: z.object({ venue: z.string(), date: z.string() }).optional(), setList: z.array(z.string()).optional(),
    audioUrl: z.string().optional(), reviewStatus: status, removeReason: z.enum(['wrong', 'sensitive', 'minor']).nullable().default(null),
  }).nullable().default(null),
});

export type QueueRow = z.infer<typeof queueSchema>[number];
export type Episode = z.infer<typeof episodeSchema>;


/** Places & Organizations: one row per published place or organization, across episodes. */
export const placesDirectorySchema = z.array(z.object({
  key: z.string(), name: z.string(), kind: z.enum(['place', 'organization']), category: z.string(),
  stories: z.array(z.object({ storyId: z.string(), title: z.string(), showName: z.string() })),
  hasPin: z.boolean(), lowConfidence: z.boolean(), neighborhood: z.string().nullable(), reservationUrl: z.string().nullable(),
  address: z.string().nullable(), phone: z.string().nullable(), website: z.string().nullable(), openingHours: z.string().nullable(),
  mentionId: z.string().nullable(),
}));
export type DirectoryRow = z.infer<typeof placesDirectorySchema>[number];

/** Published episodes (Backstory review.published), for the Published tab. */
export const publishedSchema = z.array(z.object({
  storyId: z.string(), title: z.string(), showSlug: z.string(), showName: z.string(),
  publishedAt: z.number(), doNotUse: z.boolean(), newVersionWaiting: z.boolean(),
}));
export type PublishedRow = z.infer<typeof publishedSchema>[number];
