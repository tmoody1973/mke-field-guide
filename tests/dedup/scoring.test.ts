import { describe, expect, it } from 'vitest';
import { scorePair, timeProximity } from '@/dedup/scoring';

describe('timeProximity', () => {
  it('is 1 at identical start times', () => expect(timeProximity(0)).toBe(1));
  it('decays linearly to 0 at 180 minutes', () => {
    expect(timeProximity(90)).toBeCloseTo(0.5);
    expect(timeProximity(180)).toBe(0);
    expect(timeProximity(400)).toBe(0);
  });
  it('is neutral 0.5 when a midnight placeholder is involved', () => {
    expect(timeProximity(null)).toBe(0.5);
  });
});

describe('scorePair', () => {
  it('auto-merges an identical cross-source listing', () => {
    const scored = scorePair({ titleSimilarity: 1, venueAffinity: 1, startDeltaMinutes: 0, urlMatch: false });
    expect(scored.total).toBeCloseTo(0.55 + 0.15 + 0.15);
    expect(scored.verdict).toBe('merge');
  });

  it('sends the amphitheater-headliner shape to review', () => {
    // identical title, different venue naming, midnight placeholder on one side
    const scored = scorePair({ titleSimilarity: 1, venueAffinity: 0.1, startDeltaMinutes: null, urlMatch: false });
    expect(scored.total).toBeCloseTo(0.55 + 0.015 + 0.075);
    expect(scored.verdict).toBe('review');
  });

  it('ignores unrelated events on the same day', () => {
    const scored = scorePair({ titleSimilarity: 0.2, venueAffinity: 0.5, startDeltaMinutes: 120, urlMatch: false });
    expect(scored.verdict).toBe('ignore');
  });

  it('url match pushes a borderline pair over the merge line', () => {
    const withUrl = scorePair({ titleSimilarity: 0.9, venueAffinity: 0.5, startDeltaMinutes: 30, urlMatch: true });
    const withoutUrl = scorePair({ ...withUrl, urlMatch: false });
    expect(withUrl.verdict).toBe('merge');
    expect(withoutUrl.verdict).toBe('review');
  });
});
