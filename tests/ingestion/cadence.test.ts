import { describe, expect, it } from 'vitest';
import { cadenceOf, filterDueSources } from '@/ingestion/cadence';

const NOW = new Date('2026-07-07T11:00:00Z');

describe('cadenceOf', () => {
  it('defaults to daily', () => {
    expect(cadenceOf({})).toBe('daily');
    expect(cadenceOf(null)).toBe('daily');
    expect(cadenceOf({ strategy: 'selectors' })).toBe('daily');
  });

  it('honors an explicit weekly cadence', () => {
    expect(cadenceOf({ cadence: 'weekly' })).toBe('weekly');
  });
});

describe('filterDueSources', () => {
  const healthy = { consecutiveFailures: 0, lastAttemptAt: null };
  const backedOff = { consecutiveFailures: 5, lastAttemptAt: new Date('2026-07-07T10:00:00Z') };
  const daily = { key: 'a', config: {}, ...healthy };
  const weekly = { key: 'b', config: { cadence: 'weekly' }, ...healthy };
  const failing = { key: 'c', config: {}, ...backedOff };

  it('daily run takes only daily-cadence sources outside backoff', () => {
    expect(filterDueSources([daily, weekly, failing], 'daily', NOW).map((s) => s.key)).toEqual(['a']);
  });

  it('weekly run takes every cadence, still honoring backoff', () => {
    expect(filterDueSources([daily, weekly, failing], 'weekly', NOW).map((s) => s.key)).toEqual(['a', 'b']);
  });
});
