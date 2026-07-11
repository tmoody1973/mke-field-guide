import { describe, expect, it } from 'vitest';
import { buildJudgePrompt, judgmentSchema, verdictFrom, type JudgePairInput } from '@/dedup/judge';

const INPUT: JudgePairInput = {
  aTitle: 'Colin Bracewell • Floryence',
  bTitle: 'Colin Bracewell w/ Floryence',
  venueA: 'Cactus Club',
  venueB: 'Cactus Club',
  sameVenueId: true,
  startDeltaMinutes: 30,
  aStarts: ['Fri, Sep 18, 7:30 PM'],
  bStarts: ['Fri, Sep 18, 8:00 PM'],
  aSources: ['mke-shows'],
  bSources: ['radio-milwaukee'],
  urlMatch: false,
  score: 0.6873,
};

describe('buildJudgePrompt', () => {
  it('carries every pair fact and the confusion-family guidance', () => {
    const prompt = buildJudgePrompt(INPUT);
    for (const fragment of [
      'Colin Bracewell • Floryence', 'Colin Bracewell w/ Floryence', 'Cactus Club',
      'same venue record: yes', '30 minutes', 'mke-shows', 'radio-milwaukee',
      'doors', 'tribute', 'rule out every', 'early show',
    ]) {
      expect(prompt).toContain(fragment);
    }
  });
});

describe('judgmentSchema', () => {
  it('accepts a valid judgment and clamps nothing silently', () => {
    const parsed = judgmentSchema.safeParse({ sameEvent: true, confidence: 0.93, rationale: 'same bill, doors vs showtime' });
    expect(parsed.success).toBe(true);
  });
  it('rejects out-of-range confidence and oversized rationale', () => {
    expect(judgmentSchema.safeParse({ sameEvent: true, confidence: 1.2, rationale: 'x' }).success).toBe(false);
    expect(judgmentSchema.safeParse({ sameEvent: true, confidence: 0.5, rationale: 'x'.repeat(400) }).success).toBe(false);
  });
});

describe('verdictFrom', () => {
  it('maps high-confidence booleans to same/different and low confidence to unsure', () => {
    expect(verdictFrom({ sameEvent: true, confidence: 0.95, rationale: '' })).toBe('same');
    expect(verdictFrom({ sameEvent: false, confidence: 0.9, rationale: '' })).toBe('different');
    expect(verdictFrom({ sameEvent: true, confidence: 0.55, rationale: '' })).toBe('unsure');
  });
});
