import { describe, expect, it } from 'vitest';
import { buildMapPins } from '@/app/events/build-map-pins';
import type { CardItem } from '@/app/events/sort-modes';
import type { EventCardMeta } from '@/lib/card-data';
import type { VenueCoords } from '@/queries/venue-coords';

let sequence = 0;

/** Builds a minimal-but-complete CardItem; every field defaults to a neutral value so tests only spell out what matters. */
function makeItem(overrides: Partial<EventCardMeta> & { startAt: Date }): CardItem {
  sequence += 1;
  const meta: EventCardMeta = {
    eventId: overrides.eventId ?? `event-${sequence}`,
    slug: overrides.slug ?? `slug-${sequence}`,
    title: overrides.title ?? `Event ${sequence}`,
    venueName: 'venueName' in overrides ? overrides.venueName ?? null : 'Some Venue',
    neighborhood: overrides.neighborhood ?? null,
    category: overrides.category ?? null,
    status: overrides.status ?? 'scheduled',
    isFree: overrides.isFree ?? null,
    priceMin: overrides.priceMin ?? null,
    priceMax: overrides.priceMax ?? null,
    audienceTags: overrides.audienceTags ?? [],
    isStationEvent: overrides.isStationEvent ?? false,
    venueId: 'venueId' in overrides ? overrides.venueId ?? null : `venue-${sequence}`,
  };
  return { meta, startAt: overrides.startAt };
}

describe('buildMapPins', () => {
  it('returns an empty list for an empty result set', () => {
    expect(buildMapPins([], new Map())).toEqual([]);
  });

  it('excludes venues with no entry in coordsByVenueId', () => {
    const noCoords = makeItem({ venueId: 'venue-no-coords', startAt: new Date('2026-07-12T18:00:00Z') });
    const hasCoords = makeItem({ venueId: 'venue-with-coords', startAt: new Date('2026-07-12T19:00:00Z') });
    const coordsByVenueId = new Map<string, VenueCoords>([['venue-with-coords', { lat: 43.04, lng: -87.91 }]]);

    const pins = buildMapPins([noCoords, hasCoords], coordsByVenueId);

    expect(pins).toHaveLength(1);
    expect(pins[0].venueId).toBe('venue-with-coords');
  });

  it('excludes items with no venueId at all', () => {
    const noVenue = makeItem({ venueId: null, startAt: new Date('2026-07-12T18:00:00Z') });
    const coordsByVenueId = new Map<string, VenueCoords>([['some-other-venue', { lat: 43.04, lng: -87.91 }]]);

    expect(buildMapPins([noVenue], coordsByVenueId)).toEqual([]);
  });

  it('aggregates count by UNIQUE eventId, not by instance row', () => {
    const sameEventTwice = [
      makeItem({ eventId: 'event-a', venueId: 'venue-1', startAt: new Date('2026-07-12T18:00:00Z') }),
      makeItem({ eventId: 'event-a', venueId: 'venue-1', startAt: new Date('2026-07-13T18:00:00Z') }),
      makeItem({ eventId: 'event-b', venueId: 'venue-1', startAt: new Date('2026-07-14T18:00:00Z') }),
    ];
    const coordsByVenueId = new Map<string, VenueCoords>([['venue-1', { lat: 43.04, lng: -87.91 }]]);

    const pins = buildMapPins(sameEventTwice, coordsByVenueId);

    expect(pins).toHaveLength(1);
    expect(pins[0].count).toBe(2);
  });

  it('links to the chronologically earliest event at that venue', () => {
    const later = makeItem({ slug: 'later-show', venueId: 'venue-1', startAt: new Date('2026-07-14T18:00:00Z') });
    const earliest = makeItem({ slug: 'earliest-show', venueId: 'venue-1', startAt: new Date('2026-07-12T18:00:00Z') });
    const middle = makeItem({ slug: 'middle-show', venueId: 'venue-1', startAt: new Date('2026-07-13T18:00:00Z') });
    const coordsByVenueId = new Map<string, VenueCoords>([['venue-1', { lat: 43.04, lng: -87.91 }]]);

    const pins = buildMapPins([later, earliest, middle], coordsByVenueId);

    expect(pins).toHaveLength(1);
    expect(pins[0].href).toBe('/events/earliest-show');
  });

  it('produces one pin per distinct venue, carrying venue name and coords through', () => {
    const venueOne = makeItem({ venueId: 'venue-1', venueName: 'The Pabst', startAt: new Date('2026-07-12T18:00:00Z') });
    const venueTwo = makeItem({ venueId: 'venue-2', venueName: 'Turner Hall', startAt: new Date('2026-07-12T19:00:00Z') });
    const coordsByVenueId = new Map<string, VenueCoords>([
      ['venue-1', { lat: 43.0417, lng: -87.9137 }],
      ['venue-2', { lat: 43.043, lng: -87.9155 }],
    ]);

    const pins = buildMapPins([venueOne, venueTwo], coordsByVenueId);

    expect(pins).toHaveLength(2);
    const pabst = pins.find((pin) => pin.venueId === 'venue-1');
    expect(pabst).toMatchObject({ venueName: 'The Pabst', lat: 43.0417, lng: -87.9137, count: 1 });
  });

  it('falls back to a placeholder name when venueName is null', () => {
    const item = makeItem({ venueId: 'venue-1', venueName: null, startAt: new Date('2026-07-12T18:00:00Z') });
    const coordsByVenueId = new Map<string, VenueCoords>([['venue-1', { lat: 43.04, lng: -87.91 }]]);

    const pins = buildMapPins([item], coordsByVenueId);

    expect(pins[0].venueName).toBe('Unnamed venue');
  });
});
