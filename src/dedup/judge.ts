// Advisory dedup adjudicator (annotate-only). Mirrors enrichment/tag.ts: one
// structured haiku call per pair via the AI Gateway; any failure returns null
// so the sweep skips and retries next run. NEVER merges — a human decides.
import { generateText, Output } from 'ai';
import { z } from 'zod';

const JUDGE_MODEL = 'anthropic/claude-haiku-4-5';
const MAX_RATIONALE_CHARS = 240;
/** Below this confidence a boolean answer is rendered as 'unsure' — an honest escape hatch. */
export const UNSURE_BELOW = 0.7;

export const judgmentSchema = z.object({
  sameEvent: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(MAX_RATIONALE_CHARS),
});
export type Judgment = z.infer<typeof judgmentSchema>;

export interface JudgePairInput {
  aTitle: string;
  bTitle: string;
  venueA: string | null;
  venueB: string | null;
  sameVenueId: boolean;
  startDeltaMinutes: number | null;
  aStarts: string[]; // Chicago-rendered, at most 3
  bStarts: string[];
  aSources: string[];
  bSources: string[];
  urlMatch: boolean;
  score: number;
}

export function buildJudgePrompt(input: JudgePairInput): string {
  return [
    'Two Milwaukee event listings from different sources may describe the same real-world event.',
    'Decide whether they are the SAME event occurrence.',
    '',
    `Listing A: "${input.aTitle}" at ${input.venueA ?? 'unknown venue'} — ${input.aStarts.join('; ') || 'no dates'} (sources: ${input.aSources.join(', ')})`,
    `Listing B: "${input.bTitle}" at ${input.venueB ?? 'unknown venue'} — ${input.bStarts.join('; ') || 'no dates'} (sources: ${input.bSources.join(', ')})`,
    `same venue record: ${input.sameVenueId ? 'yes' : 'no'} · closest start delta: ${
      input.startDeltaMinutes === null ? 'unknown' : `${input.startDeltaMinutes} minutes`
    } · canonical URLs match: ${input.urlMatch ? 'yes' : 'no'} · deterministic similarity score: ${input.score.toFixed(2)}`,
    '',
    'Common SAME-event patterns in this corpus: one source lists doors time, the other showtime',
    '(deltas up to ~60 minutes at the same venue); support-act suffixes ("w/ X", "• X"); ALL-CAPS or',
    'punctuation variants; "(Touring)" suffixes; a year prefix ("2026 …").',
    'Common DIFFERENT-event traps: a tribute act vs the original artist; two different bands at the',
    'same venue the same night; a watch party vs the game itself; a festival day vs one specific set',
    'or headliner inside it; the same recurring series title at two different venues; a large start-time',
    'gap at the same venue (well beyond the ~60-minute doors/showtime window) usually means two distinct',
    'shows — an early show and a late show — even when title and venue match.',
    '',
    'sameEvent: true only if these are the same occurrence a person would attend.',
    'confidence: 0-1, your honest certainty. Report confidence >= 0.9 only if you can rule out every',
    'DIFFERENT-event trap listed above; if any trap could plausibly apply, keep confidence low even when',
    'sameEvent looks likely.',
    `rationale: one sentence, under ${MAX_RATIONALE_CHARS} characters, naming the deciding signal.`,
  ].join('\n');
}

export function verdictFrom(judgment: Judgment): 'same' | 'different' | 'unsure' {
  if (judgment.confidence < UNSURE_BELOW) return 'unsure';
  return judgment.sameEvent ? 'same' : 'different';
}

/** Never throws: any model, network, or validation failure yields null (skip + retry next sweep). */
export async function judgePair(input: JudgePairInput): Promise<Judgment | null> {
  try {
    const { output } = await generateText({
      model: JUDGE_MODEL,
      output: Output.object({ schema: judgmentSchema }),
      prompt: buildJudgePrompt(input),
    });
    return output;
  } catch {
    return null;
  }
}
