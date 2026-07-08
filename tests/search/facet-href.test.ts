import { describe, expect, it } from 'vitest';
import { buildFacetHref } from '@/app/events/facet-href';

describe('buildFacetHref', () => {
  it('adds a facet to current params', () => {
    expect(buildFacetHref({ q: 'jazz' }, { cat: 'music' })).toBe('/events?q=jazz&cat=music');
  });
  it('replaces an existing value', () => {
    expect(buildFacetHref({ cat: 'music' }, { cat: 'comedy' })).toBe('/events?cat=comedy');
  });
  it('removes a facet when patched undefined', () => {
    expect(buildFacetHref({ cat: 'music', free: '1' }, { cat: undefined })).toBe('/events?free=1');
  });
  it('yields bare /events when nothing survives', () => {
    expect(buildFacetHref({ cat: 'music' }, { cat: undefined })).toBe('/events');
  });
});
