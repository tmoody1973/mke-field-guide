import { describe, expect, test, vi, afterEach } from 'vitest';
import { z } from 'zod';
import {
  fetchJson,
  normalizeWith,
  requireEnv,
  resolveUrl,
  toFiniteNumber,
} from '@/ingestion/adapters/helpers';

afterEach(() => vi.unstubAllGlobals());

describe('requireEnv', () => {
  test('returns value when set, throws with hint when missing', () => {
    vi.stubEnv('HELPER_TEST_VAR', 'abc');
    expect(requireEnv('HELPER_TEST_VAR', 'get one at example.com')).toBe('abc');
    vi.unstubAllEnvs();
    expect(() => requireEnv('HELPER_TEST_VAR_MISSING', 'get one at example.com')).toThrow(
      'HELPER_TEST_VAR_MISSING is not set — get one at example.com',
    );
  });
});

describe('toFiniteNumber', () => {
  test('coerces finite values, rejects null/garbage/NaN', () => {
    expect(toFiniteNumber('43.05')).toBeCloseTo(43.05);
    expect(toFiniteNumber(7)).toBe(7);
    expect(toFiniteNumber(null)).toBeUndefined();
    expect(toFiniteNumber(undefined)).toBeUndefined();
    expect(toFiniteNumber('not-a-number')).toBeUndefined();
    expect(toFiniteNumber('')).toBeUndefined();
  });
});

describe('resolveUrl', () => {
  test('resolves a valid absolute href', () => {
    expect(resolveUrl('https://example.com/a', 'https://base.test/')).toBe(
      'https://example.com/a',
    );
  });

  test('resolves a valid relative href against a base', () => {
    expect(resolveUrl('/events/foo', 'https://example.com/listing')).toBe(
      'https://example.com/events/foo',
    );
  });

  test('returns undefined for garbage input instead of throwing', () => {
    expect(resolveUrl('http://', 'https://example.com/')).toBeUndefined();
    expect(resolveUrl('http://a b.com', 'https://example.com/')).toBeUndefined();
    expect(resolveUrl(undefined, 'https://example.com/')).toBeUndefined();
    expect(resolveUrl('', 'https://example.com/')).toBeUndefined();
    expect(resolveUrl(42, 'https://example.com/')).toBeUndefined();
  });
});

describe('fetchJson', () => {
  test('throws labeled error on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchJson('https://x.test/api', {}, 'TestSource')).rejects.toThrow(
      'TestSource fetch failed (503)',
    );
  });
});

describe('normalizeWith', () => {
  const payload = z.object({ id: z.string(), title: z.string(), start: z.string() });
  const normalize = normalizeWith(payload, (p) => ({
    sourceEventId: p.id,
    title: p.title,
    startAt: p.start,
  }));
  test('maps valid payloads and rejects invalid ones as null', () => {
    const good = normalize({
      sourceEventId: 'a',
      payload: { id: 'a', title: 'Show', start: '2026-08-01T00:00:00.000Z' },
    });
    expect(good?.title).toBe('Show');
    expect(normalize({ sourceEventId: 'b', payload: { junk: true } })).toBeNull();
  });
});
