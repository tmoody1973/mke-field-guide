import { generateText, Output } from 'ai';
import { z } from 'zod';

// `generateObject` is deprecated in the installed `ai@7` — the current equivalent is
// `generateText` with a structured `output: Output.object({ schema })` spec, whose
// result is read from `result.output` instead of `result.object`.
const TAG_MODEL = 'anthropic/claude-haiku-4-5';

const CATEGORY_VALUES = [
  'music', 'comedy', 'sports', 'festival', 'family', 'food-drink', 'arts', 'community', 'other',
] as const;

const AUDIENCE_TAG_VALUES = ['family-friendly', 'all-ages', '21-plus', 'date-night', 'kids'] as const;

const MAX_VIBE_TAGS = 5;

export const enrichmentSchema = z.object({
  category: z.enum(CATEGORY_VALUES).nullable(),
  vibeTags: z.array(z.string()).max(MAX_VIBE_TAGS),
  audienceTags: z.array(z.enum(AUDIENCE_TAG_VALUES)),
  isFree: z.boolean().nullable(),
});

export type Enrichment = z.infer<typeof enrichmentSchema>;

interface TagInput {
  title: string;
  description: string | null;
  venueName: string | null;
}

/** Prompt constrains the model to the closed category/audience vocab; vibeTags stay free-form. */
function buildPrompt(input: TagInput): string {
  return [
    'Classify this Milwaukee-area event for a public events calendar.',
    `Title: ${input.title}`,
    `Venue: ${input.venueName ?? 'unknown'}`,
    `Description: ${input.description ?? 'none provided'}`,
    '',
    `category: exactly one of ${CATEGORY_VALUES.join(', ')}, or null if unclear`,
    `audienceTags: zero or more of ${AUDIENCE_TAG_VALUES.join(', ')}`,
    `vibeTags: up to ${MAX_VIBE_TAGS} free-form lowercase descriptive words`,
    'isFree: true if clearly free, false if clearly paid, null if unknown',
  ].join('\n');
}

/** Never throws: any model, network, or validation failure yields null so the sweep can skip it. */
export async function tagEvent(input: TagInput): Promise<Enrichment | null> {
  try {
    const { output } = await generateText({
      model: TAG_MODEL,
      output: Output.object({ schema: enrichmentSchema }),
      prompt: buildPrompt(input),
    });
    return output;
  } catch {
    return null;
  }
}
