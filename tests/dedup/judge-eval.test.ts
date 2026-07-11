import { describe, expect, it } from 'vitest';
import { scoreEval, type EvalOutcome } from '@/dedup/judge-eval';

const outcome = (expected: 'same' | 'different', verdict: 'same' | 'different' | 'unsure', confidence: number): EvalOutcome =>
  ({ expected, verdict, confidence, aTitle: 'a', bTitle: 'b' });

describe('scoreEval', () => {
  it('computes accuracy, unsure rate, and the promotion-gate false-same count', () => {
    const summary = scoreEval([
      outcome('same', 'same', 0.95),
      outcome('same', 'unsure', 0.5),
      outcome('different', 'different', 0.9),
      outcome('different', 'same', 0.95), // the dangerous one
      outcome('different', 'same', 0.7),  // wrong but below the auto-merge bar
    ]);
    expect(summary.total).toBe(5);
    expect(summary.correct).toBe(2);
    expect(summary.unsure).toBe(1);
    expect(summary.falseSameAtBar).toBe(1); // only the >= 0.9 false-same counts against promotion
  });
});
