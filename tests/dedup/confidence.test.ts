import { describe, expect, it } from 'vitest';
import { adapterRank, pickCanonical, pickSameShowSurvivor } from '@/dedup/confidence';

describe('confidence ladder', () => {
  it('ranks api > ical > html > firecrawl', () => {
    expect(adapterRank('api')).toBeGreaterThan(adapterRank('ical'));
    expect(adapterRank('ical')).toBeGreaterThan(adapterRank('html'));
    expect(adapterRank('html')).toBeGreaterThan(adapterRank('firecrawl'));
  });

  it('picks the higher-confidence source as canonical', () => {
    const api = { eventId: 'a', adapterType: 'api', createdAt: new Date('2026-07-02T00:00:00Z'), sourceKey: 'tm' };
    const html = { eventId: 'b', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'mwf' };
    expect(pickCanonical(api, html)).toBe(api);
    expect(pickCanonical(html, api)).toBe(api);
  });

  it('breaks ties by earlier createdAt', () => {
    const older = { eventId: 'a', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'mwf' };
    const newer = { eventId: 'b', adapterType: 'html', createdAt: new Date('2026-07-02T00:00:00Z'), sourceKey: 'mwf' };
    expect(pickCanonical(newer, older)).toBe(older);
  });

  it('pins the <= boundary: equal rank AND byte-identical createdAt returns the first argument', () => {
    const sameInstant = new Date('2026-07-02T00:00:00Z');
    const a = { eventId: 'a', adapterType: 'html', createdAt: sameInstant, sourceKey: 'mwf' };
    const b = { eventId: 'b', adapterType: 'html', createdAt: sameInstant, sourceKey: 'other' };
    expect(pickCanonical(a, b)).toBe(a);
  });
});

describe('pickSameShowSurvivor', () => {
  it('picks the venue-owned side even when it ranks lower on the ladder', () => {
    const api = { eventId: 'a', adapterType: 'api', createdAt: new Date('2026-07-02T00:00:00Z'), sourceKey: 'tm' };
    const pabst = {
      eventId: 'b', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'pabst-theater-group',
    };
    expect(pickSameShowSurvivor(api, pabst)).toBe(pabst);
    expect(pickSameShowSurvivor(pabst, api)).toBe(pabst);

    // New venue-owned sources beat aggregator sources
    const cactus = { eventId: 'e', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'cactus-club' };
    const ticketmaster = { eventId: 'f', adapterType: 'api', createdAt: new Date('2026-07-02T00:00:00Z'), sourceKey: 'ticketmaster-milwaukee' };
    expect(pickSameShowSurvivor(ticketmaster, cactus)).toBe(cactus);
    expect(pickSameShowSurvivor(cactus, ticketmaster)).toBe(cactus);

    const xray = { eventId: 'g', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'x-ray-arcade' };
    const mkeShows = { eventId: 'h', adapterType: 'api', createdAt: new Date('2026-07-02T00:00:00Z'), sourceKey: 'mke-shows' };
    expect(pickSameShowSurvivor(mkeShows, xray)).toBe(xray);

    const marcus = { eventId: 'i', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'marcus-center' };
    expect(pickSameShowSurvivor(ticketmaster, marcus)).toBe(marcus);

    const jazz = { eventId: 'j', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'jazz-gallery' };
    expect(pickSameShowSurvivor(mkeShows, jazz)).toBe(jazz);

    const cooperage = { eventId: 'k', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'eventbrite-cooperage' };
    expect(pickSameShowSurvivor(api, cooperage)).toBe(cooperage);

    const madPlanet = { eventId: 'l', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'mad-planet' };
    const aggregator = { eventId: 'm', adapterType: 'api', createdAt: new Date('2026-07-02T00:00:00Z'), sourceKey: 'ticketmaster-milwaukee' };
    expect(pickSameShowSurvivor(aggregator, madPlanet)).toBe(madPlanet);

    const wiggleRoom = { eventId: 'n', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'wiggle-room' };
    expect(pickSameShowSurvivor(aggregator, wiggleRoom)).toBe(wiggleRoom);

    const centroCafe = { eventId: 'o', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'centro-cafe' };
    expect(pickSameShowSurvivor(aggregator, centroCafe)).toBe(centroCafe);
  });

  it('falls back to the confidence ladder when neither or both sides are venue-owned', () => {
    const api = { eventId: 'a', adapterType: 'api', createdAt: new Date('2026-07-02T00:00:00Z'), sourceKey: 'tm' };
    const html = { eventId: 'b', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'mwf' };
    expect(pickSameShowSurvivor(api, html)).toBe(api);

    const pabstOne = {
      eventId: 'c', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z'), sourceKey: 'pabst-theater-group',
    };
    const pabstTwo = {
      eventId: 'd', adapterType: 'html', createdAt: new Date('2026-07-02T00:00:00Z'), sourceKey: 'pabst-theater-group',
    };
    expect(pickSameShowSurvivor(pabstTwo, pabstOne)).toBe(pabstOne); // ladder tie-break: older wins
  });
});
