import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { normalizeName, slugify } from './naming';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

type EventSourceLink = typeof schema.eventSourceLinks.$inferSelect;

async function findOrCreateVenue(
  db: Db,
  venueName: string,
  venueAddress: string | undefined,
): Promise<string> {
  const normalized = normalizeName(venueName);
  const existing = await db.query.venues.findFirst({
    where: eq(schema.venues.normalizedName, normalized),
  });
  if (existing) return existing.id;
  const [created] = await db
    .insert(schema.venues)
    .values({ name: venueName.trim(), normalizedName: normalized, address: venueAddress })
    .returning();
  return created.id;
}

function eventFields(n: NormalizedEvent, venueId: string | null) {
  return {
    title: n.title,
    normalizedTitle: normalizeName(n.title),
    description: n.description,
    canonicalUrl: n.url,
    imageUrl: n.imageUrl,
    status: n.status,
    venueId,
  };
}

async function updateExistingEvent(
  db: Db,
  link: EventSourceLink,
  n: NormalizedEvent,
  venueId: string | null,
): Promise<string> {
  await db
    .update(schema.events)
    .set({ ...eventFields(n, venueId), updatedAt: new Date() })
    .where(eq(schema.events.id, link.eventId));
  await db
    .update(schema.eventSourceLinks)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.eventSourceLinks.id, link.id));
  return link.eventId;
}

async function createEventWithLink(
  db: Db,
  sourceId: string,
  n: NormalizedEvent,
  venueId: string | null,
): Promise<string> {
  const [event] = await db
    .insert(schema.events)
    .values({ slug: slugify(n.title, n.sourceEventId), ...eventFields(n, venueId) })
    .returning();
  try {
    await db.insert(schema.eventSourceLinks).values({
      eventId: event.id,
      sourceId,
      sourceEventId: n.sourceEventId,
      sourceUrl: n.url,
    });
  } catch (error) {
    // Neon's HTTP driver has no transactions: compensate so a retry recreates cleanly.
    await db.delete(schema.events).where(eq(schema.events.id, event.id));
    throw error;
  }
  return event.id;
}

async function upsertInstance(db: Db, eventId: string, n: NormalizedEvent): Promise<void> {
  await db
    .insert(schema.eventInstances)
    .values({
      eventId,
      startAt: n.startAt,
      endAt: n.endAt,
      timezone: n.timezone,
      status: n.status,
    })
    .onConflictDoUpdate({
      target: [schema.eventInstances.eventId, schema.eventInstances.startAt],
      set: { endAt: n.endAt, status: n.status },
    });
}

export async function persistNormalizedEvent(
  db: Db,
  sourceId: string,
  n: NormalizedEvent,
): Promise<{ eventId: string; created: boolean }> {
  const venueId = n.venueName
    ? await findOrCreateVenue(db, n.venueName, n.venueAddress)
    : null;

  const existingLink = await db.query.eventSourceLinks.findFirst({
    where: and(
      eq(schema.eventSourceLinks.sourceId, sourceId),
      eq(schema.eventSourceLinks.sourceEventId, n.sourceEventId),
    ),
  });

  const eventId = existingLink
    ? await updateExistingEvent(db, existingLink, n, venueId)
    : await createEventWithLink(db, sourceId, n, venueId);

  await upsertInstance(db, eventId, n);

  return { eventId, created: !existingLink };
}
