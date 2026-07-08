import { describe, expect, it } from 'vitest';
import { formatRow, hitAt3, median, percentile } from '@/search/eval-utils';

describe('percentile', () => {
  it('returns the single value when n=1, regardless of p', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('computes p95 as sorted[ceil(0.95*n)-1] for n=30', () => {
    const values = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30
    // ceil(0.95 * 30) - 1 = ceil(28.5) - 1 = 29 - 1 = 28 (0-indexed) -> value 29
    expect(percentile(values, 0.95)).toBe(29);
  });

  it('computes p50 as sorted[ceil(0.5*n)-1] for n=30', () => {
    const values = Array.from({ length: 30 }, (_, i) => i + 1);
    // ceil(0.5 * 30) - 1 = 15 - 1 = 14 (0-indexed) -> value 15
    expect(percentile(values, 0.5)).toBe(15);
  });

  it('sorts unordered input before indexing', () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentile(values, 0.5)).toBe(3);
  });
});

describe('median', () => {
  it('returns the middle value for an odd-length sample', () => {
    expect(median([10, 30, 20])).toBe(20);
  });

  it('matches percentile(values, 0.5)', () => {
    const values = [7, 2, 9, 4, 1];
    expect(median(values)).toBe(percentile(values, 0.5));
  });
});

describe('hitAt3', () => {
  it('reports n/a for a draft row even when top slugs overlap expectedSlugs', () => {
    expect(hitAt3(['a', 'b', 'c'], ['a'], true)).toBe('n/a');
  });

  it('reports n/a when expectedSlugs is empty, draft flag absent', () => {
    expect(hitAt3(['a', 'b', 'c'], [], undefined)).toBe('n/a');
  });

  it('reports true when an expected slug is within the top 3', () => {
    expect(hitAt3(['a', 'b', 'c'], ['c'], undefined)).toBe(true);
  });

  it('reports false when no expected slug is within the top 3', () => {
    expect(hitAt3(['a', 'b', 'c'], ['z'], undefined)).toBe(false);
  });

  it('only considers the first 3 slugs even if more are passed in', () => {
    expect(hitAt3(['a', 'b', 'c', 'd'], ['d'], undefined)).toBe(false);
  });
});

describe('formatRow', () => {
  it('pads each column to its fixed width with a two-space gutter', () => {
    expect(formatRow(['ab', 'c'], [4, 4])).toBe('ab    c   ');
  });

  it('falls back to the column length when no width is provided', () => {
    expect(formatRow(['hello'], [])).toBe('hello');
  });
});
