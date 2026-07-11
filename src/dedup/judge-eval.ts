// Offline judge eval over the golden set (eval/judge-pairs.json). Key-gated.
// The promotion gate for ever granting auto-merge: falseSameAtBar MUST be 0.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { hasGatewayKey } from '@/enrichment/embed';
import { judgePair, verdictFrom, type JudgePairInput } from './judge';

const PAIRS_PATH = join(process.cwd(), 'eval/judge-pairs.json');
/** Matches Decision 5's promotion bar — a false 'same' at or above this sinks promotion. */
const AUTO_MERGE_CONFIDENCE_BAR = 0.9;

const evalPairSchema = z.object({
  aTitle: z.string(),
  bTitle: z.string(),
  venueA: z.string().nullable(),
  venueB: z.string().nullable(),
  sameVenueId: z.boolean(),
  startDeltaMinutes: z.number().nullable(),
  aSources: z.array(z.string()),
  bSources: z.array(z.string()),
  urlMatch: z.boolean(),
  expected: z.enum(['same', 'different']),
});
type EvalPair = z.infer<typeof evalPairSchema>;

export interface EvalOutcome {
  aTitle: string;
  bTitle: string;
  expected: 'same' | 'different';
  verdict: 'same' | 'different' | 'unsure';
  confidence: number;
}

export interface EvalSummary {
  total: number;
  correct: number;
  unsure: number;
  falseSameAtBar: number;
}

export function scoreEval(rows: EvalOutcome[]): EvalSummary {
  return {
    total: rows.length,
    correct: rows.filter((row) => row.verdict === row.expected).length,
    unsure: rows.filter((row) => row.verdict === 'unsure').length,
    falseSameAtBar: rows.filter(
      (row) => row.expected === 'different' && row.verdict === 'same' && row.confidence >= AUTO_MERGE_CONFIDENCE_BAR,
    ).length,
  };
}

function toInput(pair: EvalPair): JudgePairInput {
  return {
    ...pair,
    aStarts: [], // golden pairs carry deltas, not absolute dates — the prompt handles 'no dates'
    bStarts: [],
    score: 0.7, // representative review-band score
  };
}

async function main(): Promise<void> {
  if (!hasGatewayKey()) {
    console.log('AI_GATEWAY_API_KEY not set — judge eval skipped.');
    return;
  }
  const pairs = z.array(evalPairSchema).parse(JSON.parse(readFileSync(PAIRS_PATH, 'utf-8')));
  const outcomes: EvalOutcome[] = [];
  for (const pair of pairs) {
    const judgment = await judgePair(toInput(pair));
    const verdict = judgment ? verdictFrom(judgment) : 'unsure';
    const confidence = judgment?.confidence ?? 0;
    outcomes.push({ aTitle: pair.aTitle, bTitle: pair.bTitle, expected: pair.expected, verdict, confidence });
    const mark = verdict === pair.expected ? 'PASS' : verdict === 'unsure' ? 'UNSURE' : 'FAIL';
    console.log(`${mark.padEnd(7)} [${pair.expected}] "${pair.aTitle}" vs "${pair.bTitle}" → ${verdict} ${(confidence * 100).toFixed(0)}%`);
  }
  const summary = scoreEval(outcomes);
  console.log('');
  console.log(`accuracy ${summary.correct}/${summary.total} · unsure ${summary.unsure} · FALSE-SAME AT >= ${AUTO_MERGE_CONFIDENCE_BAR}: ${summary.falseSameAtBar} (promotion gate: must be 0)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
