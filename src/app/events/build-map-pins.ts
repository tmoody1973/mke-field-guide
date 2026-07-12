import type { VenueCoords } from '@/queries/venue-coords';
import type { CardItem } from './sort-modes';

export interface MapPin {
  venueId: string;
  venueName: string;
  lat: number;
  lng: number;
  count: number;
  href: string;
}

const FALLBACK_VENUE_NAME = 'Unnamed venue';

interface VenueAccumulator {
  venueName: string;
  lat: number;
  lng: number;
  eventIds: Set<string>;
  earliestSlug: string;
  earliestStartAt: Date;
}

function startAccumulator(item: CardItem, coords: VenueCoords): VenueAccumulator {
  return {
    venueName: item.meta.venueName ?? FALLBACK_VENUE_NAME,
    lat: coords.lat,
    lng: coords.lng,
    eventIds: new Set([item.meta.eventId]),
    earliestSlug: item.meta.slug,
    earliestStartAt: item.startAt,
  };
}

/** Folds one more instance/hit into an existing venue's pin data, keeping the earliest-starting event as the link target. */
function foldIntoAccumulator(accumulator: VenueAccumulator, item: CardItem): VenueAccumulator {
  const eventIds = new Set(accumulator.eventIds).add(item.meta.eventId);
  const isEarlier = item.startAt.getTime() < accumulator.earliestStartAt.getTime();
  return {
    ...accumulator,
    eventIds,
    earliestSlug: isEarlier ? item.meta.slug : accumulator.earliestSlug,
    earliestStartAt: isEarlier ? item.startAt : accumulator.earliestStartAt,
  };
}

function toPin(venueId: string, accumulator: VenueAccumulator): MapPin {
  return {
    venueId,
    venueName: accumulator.venueName,
    lat: accumulator.lat,
    lng: accumulator.lng,
    count: accumulator.eventIds.size,
    href: `/events/${accumulator.earliestSlug}`,
  };
}

/**
 * One pin per venue in the CURRENT result set that has resolvable coords
 * (Decision 4 — map scope is whatever filters are active, no viewport refetch).
 * `count` dedupes by eventId (an event can appear more than once per venue
 * across day-instances); `href` points at the chronologically earliest event
 * so the popup link always lands on something upcoming. Venues without an
 * entry in `coordsByVenueId` are excluded entirely.
 */
export function buildMapPins(items: CardItem[], coordsByVenueId: Map<string, VenueCoords>): MapPin[] {
  const byVenueId = new Map<string, VenueAccumulator>();

  for (const item of items) {
    const venueId = item.meta.venueId;
    if (!venueId) continue;
    const coords = coordsByVenueId.get(venueId);
    if (!coords) continue;

    const existing = byVenueId.get(venueId);
    byVenueId.set(venueId, existing ? foldIntoAccumulator(existing, item) : startAccumulator(item, coords));
  }

  return [...byVenueId.entries()].map(([venueId, accumulator]) => toPin(venueId, accumulator));
}
