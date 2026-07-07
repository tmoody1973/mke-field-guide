import { describe, expect, test } from 'vitest';
import { canonicalJson } from '@/ingestion/canonical-json';

describe('canonicalJson', () => {
  test('is stable across key insertion order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
  test('preserves array order', () => {
    expect(canonicalJson({ a: [2, 1] })).toBe('{"a":[2,1]}');
  });
  test('handles primitives and null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('x')).toBe('"x"');
  });
});
