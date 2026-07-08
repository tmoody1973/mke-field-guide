import { describe, expect, it } from 'vitest';
import { disambiguateSlug, venueSlug } from '@/lib/venue-slug';

describe('venueSlug', () => {
  it('slugifies a normalized name', () => {
    expect(venueSlug('pabst theater')).toBe('pabst-theater');
  });
  it('strips punctuation runs and edge dashes', () => {
    expect(venueSlug("linneman's riverwest inn")).toBe('linneman-s-riverwest-inn');
  });
  it('caps length at 48 chars without a trailing dash', () => {
    const slug = venueSlug('a'.repeat(60) + ' venue');
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });
  it('never returns empty', () => {
    expect(venueSlug('!!!')).toMatch(/^venue-[0-9a-f]{8}$/);
  });
});

describe('disambiguateSlug', () => {
  it('appends a deterministic hash suffix without lengthening past 48 chars', () => {
    const result = disambiguateSlug('pabst-theater', 'pabst theater');
    expect(result).toMatch(/^pabst-theater-[0-9a-f]{8}$/);
    expect(result.length).toBeLessThanOrEqual(48);
  });
  it('is deterministic for the same inputs', () => {
    expect(disambiguateSlug('a', 'venue x')).toBe(disambiguateSlug('a', 'venue x'));
  });
});
