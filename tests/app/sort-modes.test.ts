import { describe, expect, it } from 'vitest';
import { sortWithinDay, type CardItem } from '@/app/events/sort-modes';
import type { EventCardMeta } from '@/lib/card-data';

let sequence = 0;

/** Builds a minimal-but-complete CardItem; every field defaults to a neutral value so tests only spell out what matters. */
function makeItem(overrides: Partial<EventCardMeta> & { startAt: Date }): CardItem {
  sequence += 1;
  const meta: EventCardMeta = {
    eventId: overrides.eventId ?? `event-${sequence}`,
    slug: overrides.slug ?? `slug-${sequence}`,
    title: overrides.title ?? `Event ${sequence}`,
    venueName: overrides.venueName ?? 'Some Venue',
    neighborhood: overrides.neighborhood ?? null,
    category: overrides.category ?? null,
    status: overrides.status ?? 'scheduled',
    isFree: overrides.isFree ?? null,
    priceMin: overrides.priceMin ?? null,
    priceMax: overrides.priceMax ?? null,
    audienceTags: overrides.audienceTags ?? [],
    isStationEvent: overrides.isStationEvent ?? false,
    venueId: overrides.venueId ?? `venue-${sequence}`,
  };
  return { meta, startAt: overrides.startAt };
}

describe('sortWithinDay — default mode', () => {
  it('reproduces the pre-filter-bar byBoostThenTime ordering: station events first, then chronological, then slug tiebreak', () => {
    const early = makeItem({ slug: 'b-early', startAt: new Date('2026-07-12T18:00:00Z'), isStationEvent: false });
    const late = makeItem({ slug: 'a-late', startAt: new Date('2026-07-12T22:00:00Z'), isStationEvent: false });
    const station = makeItem({ slug: 'z-station', startAt: new Date('2026-07-12T23:00:00Z'), isStationEvent: true });
    const tieA = makeItem({ slug: 'tie-a', startAt: new Date('2026-07-12T20:00:00Z'), isStationEvent: false });
    const tieB = makeItem({ slug: 'tie-b', startAt: new Date('2026-07-12T20:00:00Z'), isStationEvent: false });
    const items = [late, tieB, station, early, tieA];

    const result = sortWithinDay(items, { mode: 'default' });

    expect(result.map((item) => item.meta.slug)).toEqual(['z-station', 'b-early', 'tie-a', 'tie-b', 'a-late']);
  });

  it('returns a new array and leaves the input untouched', () => {
    const items = [
      makeItem({ slug: 'x', startAt: new Date('2026-07-12T22:00:00Z') }),
      makeItem({ slug: 'y', startAt: new Date('2026-07-12T18:00:00Z') }),
    ];
    const originalOrder = items.map((item) => item.meta.slug);

    const result = sortWithinDay(items, { mode: 'default' });

    expect(result).not.toBe(items);
    expect(items.map((item) => item.meta.slug)).toEqual(originalOrder);
  });
});

describe('sortWithinDay — recommended mode', () => {
  it('orders picked before station before the rest, time-ordered within each group', () => {
    const pickedLate = makeItem({ slug: 'picked-late', startAt: new Date('2026-07-12T23:00:00Z') });
    const pickedEarly = makeItem({ slug: 'picked-early', startAt: new Date('2026-07-12T18:00:00Z') });
    const stationEvent = makeItem({ slug: 'station', startAt: new Date('2026-07-12T19:00:00Z'), isStationEvent: true });
    const plainLate = makeItem({ slug: 'plain-late', startAt: new Date('2026-07-12T21:00:00Z') });
    const plainEarly = makeItem({ slug: 'plain-early', startAt: new Date('2026-07-12T20:00:00Z') });
    const items = [plainLate, stationEvent, pickedLate, plainEarly, pickedEarly];
    const pickedEventIds = new Set([pickedLate.meta.eventId, pickedEarly.meta.eventId]);

    const result = sortWithinDay(items, { mode: 'recommended', pickedEventIds });

    expect(result.map((item) => item.meta.slug)).toEqual([
      'picked-early',
      'picked-late',
      'station',
      'plain-early',
      'plain-late',
    ]);
  });

  it('treats a picked+station event as picked-first (picked outranks station)', () => {
    const pickedStation = makeItem({ slug: 'picked-station', startAt: new Date('2026-07-12T23:00:00Z'), isStationEvent: true });
    const station = makeItem({ slug: 'station-only', startAt: new Date('2026-07-12T18:00:00Z'), isStationEvent: true });
    const pickedEventIds = new Set([pickedStation.meta.eventId]);

    const result = sortWithinDay([station, pickedStation], { mode: 'recommended', pickedEventIds });

    expect(result.map((item) => item.meta.slug)).toEqual(['picked-station', 'station-only']);
  });

  it('defaults to an empty picked set when none is supplied, degrading to boost-then-time', () => {
    const stationEvent = makeItem({ slug: 'station', startAt: new Date('2026-07-12T18:00:00Z'), isStationEvent: true });
    const plain = makeItem({ slug: 'plain', startAt: new Date('2026-07-12T17:00:00Z') });

    const result = sortWithinDay([plain, stationEvent], { mode: 'recommended' });

    expect(result.map((item) => item.meta.slug)).toEqual(['station', 'plain']);
  });
});

describe('sortWithinDay — near mode', () => {
  const userPoint = { lat: 43.0389, lng: -87.9065 }; // downtown Milwaukee

  it('orders by distance ascending, with venues missing coords sorted last', () => {
    const far = makeItem({ slug: 'far', startAt: new Date('2026-07-12T18:00:00Z'), venueId: 'venue-far' });
    const near = makeItem({ slug: 'near', startAt: new Date('2026-07-12T18:00:00Z'), venueId: 'venue-near' });
    const noCoords = makeItem({ slug: 'no-coords', startAt: new Date('2026-07-12T01:00:00Z'), venueId: 'venue-unknown' });
    const coordsByVenueId = new Map([
      ['venue-near', { lat: 43.04, lng: -87.907 }], // ~150m away
      ['venue-far', { lat: 43.2, lng: -88.0 }], // ~20km away
    ]);

    const result = sortWithinDay([far, noCoords, near], { mode: 'near', coordsByVenueId, userPoint });

    expect(result.map((item) => item.meta.slug)).toEqual(['near', 'far', 'no-coords']);
  });

  it('breaks distance ties by start time', () => {
    const sameSpotLate = makeItem({ slug: 'same-spot-late', startAt: new Date('2026-07-12T23:00:00Z'), venueId: 'venue-a' });
    const sameSpotEarly = makeItem({ slug: 'same-spot-early', startAt: new Date('2026-07-12T18:00:00Z'), venueId: 'venue-a' });
    const coordsByVenueId = new Map([['venue-a', userPoint]]);

    const result = sortWithinDay([sameSpotLate, sameSpotEarly], { mode: 'near', coordsByVenueId, userPoint });

    expect(result.map((item) => item.meta.slug)).toEqual(['same-spot-early', 'same-spot-late']);
  });

  it('keeps missing-coords items in their original relative order (stable)', () => {
    const first = makeItem({ slug: 'first-unknown', startAt: new Date('2026-07-12T23:00:00Z'), venueId: 'venue-unknown-1' });
    const second = makeItem({ slug: 'second-unknown', startAt: new Date('2026-07-12T01:00:00Z'), venueId: 'venue-unknown-2' });

    const result = sortWithinDay([first, second], { mode: 'near', coordsByVenueId: new Map(), userPoint });

    expect(result.map((item) => item.meta.slug)).toEqual(['first-unknown', 'second-unknown']);
  });

  it('returns a new array and leaves the input untouched', () => {
    const items = [
      makeItem({ slug: 'a', startAt: new Date('2026-07-12T18:00:00Z'), venueId: 'venue-a' }),
      makeItem({ slug: 'b', startAt: new Date('2026-07-12T19:00:00Z'), venueId: 'venue-b' }),
    ];
    const originalOrder = items.map((item) => item.meta.slug);

    const result = sortWithinDay(items, { mode: 'near', coordsByVenueId: new Map(), userPoint });

    expect(result).not.toBe(items);
    expect(items.map((item) => item.meta.slug)).toEqual(originalOrder);
  });
});
