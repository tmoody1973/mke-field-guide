import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/ingestion/persist';
import { VENUE_NEIGHBORHOODS } from './venue-neighborhood-map';

export interface AssignNeighborhoodsResult {
  updated: number;
  unmapped: { name: string; address: string | null }[];
  staleKeys: string[];
}

async function applyMappedVenue(
  db: Db,
  venue: { id: string; neighborhood: string | null },
  neighborhoodName: string,
): Promise<boolean> {
  if (venue.neighborhood === neighborhoodName) return false;
  await db.update(schema.venues).set({ neighborhood: neighborhoodName }).where(eq(schema.venues.id, venue.id));
  return true;
}

/** Curated assignment sweep: matched venues get their mapped neighborhood; unmatched are reported for curation. */
export async function assignNeighborhoods(
  db: Db,
  map: Record<string, string> = VENUE_NEIGHBORHOODS,
): Promise<AssignNeighborhoodsResult> {
  const allVenues = await db.select().from(schema.venues);
  const matchedKeys = new Set<string>();
  let updated = 0;
  for (const [normalizedName, neighborhoodName] of Object.entries(map)) {
    const venue = allVenues.find((row) => row.normalizedName === normalizedName);
    if (!venue) continue;
    matchedKeys.add(normalizedName);
    if (await applyMappedVenue(db, venue, neighborhoodName)) updated += 1;
  }
  const staleKeys = Object.keys(map).filter((key) => !matchedKeys.has(key));
  const unmapped = allVenues
    .filter((venue) => !(venue.normalizedName in map))
    .map((venue) => ({ name: venue.name, address: venue.address }));
  return { updated, unmapped, staleKeys };
}

async function main(): Promise<void> {
  const { db } = await import('@/db');
  const result = await assignNeighborhoods(db);
  console.log(`neighborhoods assigned: ${result.updated} updated`);
  for (const venue of result.unmapped) {
    console.log(`  unmapped: ${venue.name}${venue.address ? ` (${venue.address})` : ''}`);
  }
  for (const key of result.staleKeys) {
    console.log(`  stale map key (no matching venue): ${key}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
