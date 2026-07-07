import { and, eq, ne } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { normalizeName, slugify } from './naming';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

export interface SourceRef {
  id: string;
  key: string;
}

export interface PersistOptions {
  supersede?: boolean;
}

async function findOrCreateVenue(db: Db, n: NormalizedEvent): Promise<string> {
  const name = n.venueName as string;
  const normalized = normalizeName(name);
  const inserted = await db
    .insert(schema.venues)
    .values({
      name: name.trim(),
      normalizedName: normalized,
      address: n.venueAddress,
      lat: n.venueLat?.toString(),
      lng: n.venueLng?.toString(),
    })
    .onConflictDoNothing({ target: schema.venues.normalizedName })
    .returning();
  if (inserted.length > 0) return inserted[0].id;
  const existing = await db.query.venues.findFirst({
    where: eq(schema.venues.normalizedName, normalized),
  });
  if (!existing) throw new Error(`Venue lookup failed after conflict: ${name}`);
  return existing.id;
}

function eventFields(n: NormalizedEvent, venueId: string | null) {
  return {
    title: n.title,
    normalizedTitle: normalizeName(n.title),
    description: n.description,
    canonicalUrl: n.url,
    imageUrl: n.imageUrl,
    status: n.status,
    isFree: n.isFree,
    venueId,
  };
}

async function updateExistingEvent(
  db: Db,
  linkId: string,
  eventId: string,
  n: NormalizedEvent,
  venueId: string | null,
): Promise<void> {
  await db
    .update(schema.events)
    .set({ ...eventFields(n, venueId), updatedAt: new Date() })
    .where(eq(schema.events.id, eventId));
  await db
    .update(schema.eventSourceLinks)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.eventSourceLinks.id, linkId));
}

async function createEventWithLink(
  db: Db,
  source: SourceRef,
  n: NormalizedEvent,
  venueId: string | null,
): Promise<string> {
  const [event] = await db
    .insert(schema.events)
    .values({ slug: slugify(n.title, `${source.key}:${n.sourceEventId}`), ...eventFields(n, venueId) })
    .returning();
  try {
    await db.insert(schema.eventSourceLinks).values({
      eventId: event.id,
      sourceId: source.id,
      sourceEventId: n.sourceEventId,
      sourceUrl: n.url,
    });
  } catch (linkErr) {
    // No transactions on the Neon HTTP driver: compensate so retry recreates cleanly.
    await db.delete(schema.events).where(eq(schema.events.id, event.id));
    throw linkErr;
  }
  return event.id;
}

async function upsertInstance(db: Db, eventId: string, n: NormalizedEvent): Promise<void> {
  await db
    .insert(schema.eventInstances)
    .values({ eventId, startAt: n.startAt, endAt: n.endAt, timezone: n.timezone, status: n.status })
    .onConflictDoUpdate({
      target: [schema.eventInstances.eventId, schema.eventInstances.startAt],
      set: { endAt: n.endAt, status: n.status },
    });
}

async function supersedeOtherInstances(db: Db, eventId: string, keepStartAt: Date): Promise<void> {
  await db
    .delete(schema.eventInstances)
    .where(and(eq(schema.eventInstances.eventId, eventId), ne(schema.eventInstances.startAt, keepStartAt)));
}

export async function persistNormalizedEvent(
  db: Db,
  source: SourceRef,
  n: NormalizedEvent,
  opts: PersistOptions = {},
): Promise<{ eventId: string; created: boolean }> {
  const venueId = n.venueName ? await findOrCreateVenue(db, n) : null;
  const existingLink = await db.query.eventSourceLinks.findFirst({
    where: and(
      eq(schema.eventSourceLinks.sourceId, source.id),
      eq(schema.eventSourceLinks.sourceEventId, n.sourceEventId),
    ),
  });
  let eventId: string;
  if (existingLink) {
    eventId = existingLink.eventId;
    await updateExistingEvent(db, existingLink.id, eventId, n, venueId);
  } else {
    eventId = await createEventWithLink(db, source, n, venueId);
  }
  await upsertInstance(db, eventId, n);
  if (opts.supersede) await supersedeOtherInstances(db, eventId, n.startAt);
  return { eventId, created: !existingLink };
}
