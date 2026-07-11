import { aliasedTable, asc, count, countDistinct, desc, eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/db/types';

export interface AdminVenueRow {
  venueId: string;
  name: string;
  normalizedName: string;
  neighborhood: string | null;
  eventCount: number;
}

export async function adminVenueList(db: Db): Promise<AdminVenueRow[]> {
  const rows = await db
    .select({
      venueId: schema.venues.id,
      name: schema.venues.name,
      normalizedName: schema.venues.normalizedName,
      neighborhood: schema.venues.neighborhood,
      eventCount: count(schema.events.id),
    })
    .from(schema.venues)
    .leftJoin(schema.events, eq(schema.events.venueId, schema.venues.id))
    .groupBy(schema.venues.id)
    .orderBy(asc(schema.venues.name));
  return rows.map((row) => ({ ...row, eventCount: Number(row.eventCount) }));
}

export interface VenueSuggestionRow {
  suggestionId: string;
  keepVenueId: string;
  keepName: string;
  keepEventCount: number;
  absorbVenueId: string;
  absorbName: string;
  absorbEventCount: number;
  confidence: number;
  rationale: string;
}

// Two independent one-to-many joins (keep's events, absorb's events) in one query
// cross-multiply — countDistinct on each side's id is what keeps the counts honest.
export async function pendingVenueSuggestions(db: Db): Promise<VenueSuggestionRow[]> {
  const keepVenue = aliasedTable(schema.venues, 'keep_venue');
  const absorbVenue = aliasedTable(schema.venues, 'absorb_venue');
  const keepEvents = aliasedTable(schema.events, 'keep_events');
  const absorbEvents = aliasedTable(schema.events, 'absorb_events');

  const rows = await db
    .select({
      suggestionId: schema.venueMergeSuggestions.id,
      keepVenueId: schema.venueMergeSuggestions.keepVenueId,
      keepName: keepVenue.name,
      keepEventCount: countDistinct(keepEvents.id),
      absorbVenueId: schema.venueMergeSuggestions.absorbVenueId,
      absorbName: absorbVenue.name,
      absorbEventCount: countDistinct(absorbEvents.id),
      confidence: schema.venueMergeSuggestions.confidence,
      rationale: schema.venueMergeSuggestions.rationale,
    })
    .from(schema.venueMergeSuggestions)
    .innerJoin(keepVenue, eq(keepVenue.id, schema.venueMergeSuggestions.keepVenueId))
    .innerJoin(absorbVenue, eq(absorbVenue.id, schema.venueMergeSuggestions.absorbVenueId))
    .leftJoin(keepEvents, eq(keepEvents.venueId, keepVenue.id))
    .leftJoin(absorbEvents, eq(absorbEvents.venueId, absorbVenue.id))
    .where(eq(schema.venueMergeSuggestions.status, 'pending'))
    .groupBy(schema.venueMergeSuggestions.id, keepVenue.id, absorbVenue.id)
    .orderBy(desc(schema.venueMergeSuggestions.createdAt));

  return rows.map((row) => ({
    ...row,
    keepEventCount: Number(row.keepEventCount),
    absorbEventCount: Number(row.absorbEventCount),
    confidence: Number(row.confidence),
  }));
}
