import { describe, expect, it } from 'vitest';
import { buildTitlePrompt, titleSuggestionSchema, type SuggestTitleInput } from '@/enrichment/title-suggest';

const INPUT: SuggestTitleInput = {
  title: 'BILLY ALLEN AND THE POLLIES SHOW ON 7/18: VIVARIUM @ 7PM',
  venueName: 'Vivarium',
  startsChicago: ['Sat, Jul 18, 7:00 PM'],
  sourceKeys: ['visit-milwaukee'],
};

describe('buildTitlePrompt', () => {
  it('carries the event facts and the preservation rules', () => {
    const prompt = buildTitlePrompt(INPUT);
    for (const fragment of [
      'BILLY ALLEN AND THE POLLIES SHOW ON 7/18: VIVARIUM @ 7PM',
      'Vivarium', 'Sat, Jul 18, 7:00 PM', 'visit-milwaukee',
      'never invent', 'support act', 'changed: false',
    ]) {
      expect(prompt).toContain(fragment);
    }
  });
});

describe('titleSuggestionSchema', () => {
  it('bounds cleanTitle length, confidence range, and rationale length', () => {
    expect(titleSuggestionSchema.safeParse({ cleanTitle: 'Billy Allen + The Pollies', changed: true, confidence: 0.95, rationale: 'stripped date/venue junk' }).success).toBe(true);
    expect(titleSuggestionSchema.safeParse({ cleanTitle: 'x'.repeat(400), changed: true, confidence: 0.9, rationale: 'r' }).success).toBe(false);
    expect(titleSuggestionSchema.safeParse({ cleanTitle: 'ok', changed: true, confidence: 1.2, rationale: 'r' }).success).toBe(false);
  });
});
