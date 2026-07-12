import { haversineMeters } from '@/lib/geo';
import type { EventCardMeta } from '@/lib/card-data';
import type { VenueCoords } from '@/queries/venue-coords';

export interface CardItem {
  meta: EventCardMeta;
  startAt: Date;
}

export type SortModeName = 'default' | 'recommended' | 'near';

export interface SortWithinDayOptions {
  mode: SortModeName;
  coordsByVenueId?: Map<string, VenueCoords>;
  pickedEventIds?: Set<string>;
  userPoint?: { lat: number; lng: number };
}

/** Station events float to the top of their day; slug keeps ties deterministic. This is the exact pre-filter-bar default ordering — do not change it. */
function byBoostThenTime(a: CardItem, b: CardItem): number {
  if (a.meta.isStationEvent !== b.meta.isStationEvent) return a.meta.isStationEvent ? -1 : 1;
  return a.startAt.getTime() - b.startAt.getTime() || a.meta.slug.localeCompare(b.meta.slug);
}

/** Recommended = a strict extension of the default ordering: picked (current Chicago week) first, then station, then time/slug. */
function byRecommended(pickedEventIds: Set<string>) {
  return (a: CardItem, b: CardItem): number => {
    const aPicked = pickedEventIds.has(a.meta.eventId);
    const bPicked = pickedEventIds.has(b.meta.eventId);
    if (aPicked !== bPicked) return aPicked ? -1 : 1;
    return byBoostThenTime(a, b);
  };
}

/** Distance in meters from the user's point, or undefined when the venue has no resolvable coords. */
function distanceMeters(
  item: CardItem,
  coordsByVenueId: Map<string, VenueCoords>,
  userPoint: { lat: number; lng: number },
): number | undefined {
  const venueId = item.meta.venueId;
  if (!venueId) return undefined;
  const coords = coordsByVenueId.get(venueId);
  if (!coords) return undefined;
  return haversineMeters(userPoint, coords);
}

/** Nearest first; venues with no resolvable coords sort last and keep their relative order (stable). */
function byNear(coordsByVenueId: Map<string, VenueCoords>, userPoint: { lat: number; lng: number }) {
  return (a: CardItem, b: CardItem): number => {
    const distanceA = distanceMeters(a, coordsByVenueId, userPoint);
    const distanceB = distanceMeters(b, coordsByVenueId, userPoint);
    if (distanceA === undefined && distanceB === undefined) return 0;
    if (distanceA === undefined) return 1;
    if (distanceB === undefined) return -1;
    return distanceA - distanceB || a.startAt.getTime() - b.startAt.getTime();
  };
}

/**
 * Reorders items WITHIN a single day (day-grouping itself is untouched — caller
 * groups first, then sorts each group). Always returns a NEW array; never
 * mutates `items` or its elements (repo immutability rule).
 */
export function sortWithinDay(items: CardItem[], opts: SortWithinDayOptions): CardItem[] {
  const copy = [...items];
  if (opts.mode === 'recommended') return copy.sort(byRecommended(opts.pickedEventIds ?? new Set()));
  if (opts.mode === 'near' && opts.userPoint) return copy.sort(byNear(opts.coordsByVenueId ?? new Map(), opts.userPoint));
  return copy.sort(byBoostThenTime);
}
