import { describe, expect, test } from 'vitest';
import { normalizeName, slugify } from '@/ingestion/naming';

describe('normalizeName', () => {
  test('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeName("  Linneman's  Riverwest Inn! ")).toBe('linneman s riverwest inn');
  });
  test('strips accents', () => {
    expect(normalizeName('Café Benelux')).toBe('cafe benelux');
  });
});

describe('slugify', () => {
  test('produces url-safe slug with stable hash suffix', () => {
    const a = slugify('Jazz in the Park', '12345@urbanmilwaukee.com');
    const b = slugify('Jazz in the Park', '12345@urbanmilwaukee.com');
    expect(a).toBe(b);
    expect(a).toMatch(/^jazz-in-the-park-[0-9a-f]{8}$/);
  });
  test('different source ids produce different slugs', () => {
    expect(slugify('Trivia Night', 'a')).not.toBe(slugify('Trivia Night', 'b'));
  });
});
