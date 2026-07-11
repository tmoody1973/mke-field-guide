// Advisory title-cleanup proposal (propose-only — a human applies via the editor,
// which locks + records provenance). Mirrors dedup/judge.ts: one structured haiku
// call, 15s abort, never throws.
import { generateText, Output } from 'ai';
import { z } from 'zod';

const TITLE_MODEL = 'anthropic/claude-haiku-4-5';
const TITLE_TIMEOUT_MS = 15_000;
const MAX_TITLE_CHARS = 300;
const MAX_RATIONALE_CHARS = 200;

export const titleSuggestionSchema = z.object({
  cleanTitle: z.string().min(1).max(MAX_TITLE_CHARS),
  changed: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(MAX_RATIONALE_CHARS),
});
export type TitleSuggestion = z.infer<typeof titleSuggestionSchema>;

export interface SuggestTitleInput {
  title: string;
  venueName: string | null;
  startsChicago: string[];
  sourceKeys: string[];
}

export function buildTitlePrompt(input: SuggestTitleInput): string {
  return [
    'Clean up this scraped Milwaukee event title for a public events calendar.',
    `Raw title: "${input.title}"`,
    `Venue (already shown separately on the site): ${input.venueName ?? 'unknown'}`,
    `Date/time (already shown separately): ${input.startsChicago.join('; ') || 'unknown'}`,
    `Sources: ${input.sourceKeys.join(', ')}`,
    '',
    'Rules:',
    '- Remove embedded venue names, dates, times, and ticket/price junk — the site displays those separately.',
    '- Fix ALL-CAPS or shouty casing to natural title casing; keep intentional stylization (e.g. an artist named "JADY" stays if the casing is the artist\'s own — when unsure, prefer natural casing).',
    '- Preserve the full bill: keep support act names and separators like "w/", "+", "•" in the artist\'s own style.',
    '- never invent, add, translate, or reorder information that is not in the raw title.',
    `- If the raw title is already clean, return it unchanged with changed: false.`,
    '',
    'cleanTitle: the cleaned title (or the original if already clean).',
    'changed: false if the raw title needed no cleanup.',
    'confidence: 0-1, your certainty that cleanTitle is faithful and strictly better.',
    `rationale: one short sentence (under ${MAX_RATIONALE_CHARS} chars) naming what was removed or fixed.`,
  ].join('\n');
}

/** Never throws: any model/network/validation failure yields null (skip; gate stays open for retry). */
export async function suggestTitle(input: SuggestTitleInput): Promise<TitleSuggestion | null> {
  try {
    const { output } = await generateText({
      model: TITLE_MODEL,
      output: Output.object({ schema: titleSuggestionSchema }),
      prompt: buildTitlePrompt(input),
      abortSignal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
    });
    return output;
  } catch {
    return null;
  }
}
