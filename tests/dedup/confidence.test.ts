import { describe, expect, it } from 'vitest';
import { adapterRank, pickCanonical } from '@/dedup/confidence';

describe('confidence ladder', () => {
  it('ranks api > ical > html > firecrawl', () => {
    expect(adapterRank('api')).toBeGreaterThan(adapterRank('ical'));
    expect(adapterRank('ical')).toBeGreaterThan(adapterRank('html'));
    expect(adapterRank('html')).toBeGreaterThan(adapterRank('firecrawl'));
  });

  it('picks the higher-confidence source as canonical', () => {
    const api = { eventId: 'a', adapterType: 'api', createdAt: new Date('2026-07-02T00:00:00Z') };
    const html = { eventId: 'b', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z') };
    expect(pickCanonical(api, html)).toBe(api);
    expect(pickCanonical(html, api)).toBe(api);
  });

  it('breaks ties by earlier createdAt', () => {
    const older = { eventId: 'a', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z') };
    const newer = { eventId: 'b', adapterType: 'html', createdAt: new Date('2026-07-02T00:00:00Z') };
    expect(pickCanonical(newer, older)).toBe(older);
  });
});
