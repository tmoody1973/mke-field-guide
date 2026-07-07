import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { normalizeName, slugify } from './naming';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

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

  let eventId: string;
  let created = false;

  if (existingLink) {
    eventId = existingLink.eventId;
    await db
      .update(schema.events)
      .set({
        title: n.title,
        normalizedTitle: normalizeName(n.title),
        description: n.description,
        canonicalUrl: n.url,
        imageUrl: n.imageUrl,
        status: n.status,
        venueId,
        updatedAt: new Date(),
      })
      .where(eq(schema.events.id, eventId));
    await db
      .update(schema.eventSourceLinks)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.eventSourceLinks.id, existingLink.id));
  } else {
    const [event] = await db
      .insert(schema.events)
      .values({
        slug: slugify(n.title, n.sourceEventId),
        title: n.title,
        normalizedTitle: normalizeName(n.title),
        description: n.description,
        canonicalUrl: n.url,
        imageUrl: n.imageUrl,
        status: n.status,
        venueId,
      })
      .returning();
    eventId = event.id;
    created = true;
    await db.insert(schema.eventSourceLinks).values({
      eventId,
      sourceId,
      sourceEventId: n.sourceEventId,
      sourceUrl: n.url,
    });
  }

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

  return { eventId, created };
}
