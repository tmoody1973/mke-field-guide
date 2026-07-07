import { describe, expect, it } from 'vitest';
import { backoffHours, shouldSkipForBackoff } from '@/ingestion/backoff';

describe('backoffHours', () => {
  it('is 0 below three consecutive failures', () => {
    expect(backoffHours(0)).toBe(0);
    expect(backoffHours(2)).toBe(0);
  });

  it('doubles from 24h starting at the third failure', () => {
    expect(backoffHours(3)).toBe(24);
    expect(backoffHours(4)).toBe(48);
    expect(backoffHours(5)).toBe(96);
  });

  it('caps at one week', () => {
    expect(backoffHours(12)).toBe(168);
  });
});

describe('shouldSkipForBackoff', () => {
  const now = new Date('2026-07-07T12:00:00Z');

  it('never skips a healthy source', () => {
    expect(
      shouldSkipForBackoff({ consecutiveFailures: 0, lastAttemptAt: new Date('2026-07-07T11:00:00Z') }, now),
    ).toBe(false);
  });

  it('skips inside the backoff window', () => {
    expect(
      shouldSkipForBackoff({ consecutiveFailures: 3, lastAttemptAt: new Date('2026-07-07T00:00:00Z') }, now),
    ).toBe(true);
  });

  it('allows a retry once the window has elapsed', () => {
    expect(
      shouldSkipForBackoff({ consecutiveFailures: 3, lastAttemptAt: new Date('2026-07-06T00:00:00Z') }, now),
    ).toBe(false);
  });

  it('never skips when lastAttemptAt is unknown', () => {
    expect(shouldSkipForBackoff({ consecutiveFailures: 5, lastAttemptAt: null }, now)).toBe(false);
  });
});
