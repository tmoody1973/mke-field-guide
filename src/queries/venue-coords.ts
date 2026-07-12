import { eq, inArray } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/db/types';

export interface VenueCoords {
  lat: number;
  lng: number;
}

function fetchVenueRows(db: Db, venueIds: string[]) {
  return db
    .select({
      id: schema.venues.id,
      lat: schema.venues.lat,
      lng: schema.venues.lng,
      registryLat: schema.venueRegistry.lat,
      registryLon: schema.venueRegistry.lon,
    })
    .from(schema.venues)
    .leftJoin(schema.venueRegistry, eq(schema.venueRegistry.id, schema.venues.registryId))
    .where(inArray(schema.venues.id, venueIds));
}

type VenueCoordsRow = Awaited<ReturnType<typeof fetchVenueRows>>[number];

/** Source-provided venue coords win only when BOTH lat and lng are present; otherwise fall back to the registry join. */
function resolveCoords(row: VenueCoordsRow): VenueCoords | undefined {
  if (row.lat !== null && row.lng !== null) {
    return { lat: Number(row.lat), lng: Number(row.lng) };
  }
  if (row.registryLat !== null && row.registryLon !== null) {
    return { lat: Number(row.registryLat), lng: Number(row.registryLon) };
  }
  return undefined;
}

/** Batch-hydrates venue coordinates for a set of venue IDs: own lat/lng, else registry JOIN fallback, else absent. */
export async function loadVenueCoords(db: Db, venueIds: string[]): Promise<Map<string, VenueCoords>> {
  if (venueIds.length === 0) return new Map();
  const rows = await fetchVenueRows(db, venueIds);
  const entries: Array<[string, VenueCoords]> = [];
  for (const row of rows) {
    const coords = resolveCoords(row);
    if (coords) entries.push([row.id, coords]);
  }
  return new Map(entries);
}
