import { and, eq, ne } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';
import { disambiguateSlug, venueSlug } from '@/lib/venue-slug';
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

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  if (e.code === '23505' || e.cause?.code === '23505') return true;
  return typeof e.message === 'string' && e.message.includes('duplicate key value violates unique constraint');
}

async function findLink(db: Db, source: SourceRef, sourceEventId: string) {
  return db.query.eventSourceLinks.findFirst({
    where: and(
      eq(schema.eventSourceLinks.sourceId, source.id),
      eq(schema.eventSourceLinks.sourceEventId, sourceEventId),
    ),
    with: { event: { columns: { lockedFields: true } } },
  });
}

function insertVenueValues(
  db: Db,
  values: {
    name: string;
    normalizedName: string;
    address?: string;
    lat?: string;
    lng?: string;
    slug: string;
  },
) {
  return db
    .insert(schema.venues)
    .values(values)
    .onConflictDoNothing({ target: schema.venues.normalizedName })
    .returning();
}

async function insertVenueRow(
  db: Db,
  n: NormalizedEvent,
  name: string,
  normalized: string,
  slug: string,
): Promise<{ id: string }[]> {
  const base = {
    name: name.trim(),
    normalizedName: normalized,
    address: n.venueAddress,
    lat: n.venueLat?.toString(),
    lng: n.venueLng?.toString(),
  };
  try {
    return await insertVenueValues(db, { ...base, slug });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // A distinct new venue name slugified to match an existing venue's slug — retry once, disambiguated.
    return await insertVenueValues(db, { ...base, slug: disambiguateSlug(slug, normalized) });
  }
}

async function findOrCreateVenue(db: Db, n: NormalizedEvent): Promise<string> {
  const name = n.venueName as string;
  const normalized = normalizeName(name);
  const inserted = await insertVenueRow(db, n, name, normalized, venueSlug(normalized));
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

// Admin lock vocabulary → the eventFields columns each lock protects.
// 'time' is handled in persistNormalizedEvent (instances, not an events column).
const LOCK_COLUMNS: Record<string, (keyof ReturnType<typeof eventFields>)[]> = {
  title: ['title', 'normalizedTitle'],
  status: ['status'],
  venue: ['venueId'],
};

function unlockedEventFields(
  n: NormalizedEvent,
  venueId: string | null,
  locked: string[],
): Partial<ReturnType<typeof eventFields>> {
  const fields: Partial<ReturnType<typeof eventFields>> = { ...eventFields(n, venueId) };
  for (const lock of locked) for (const column of LOCK_COLUMNS[lock] ?? []) delete fields[column];
  return fields;
}

async function updateEventRow(
  db: Db,
  eventId: string,
  n: NormalizedEvent,
  venueId: string | null,
  locked: string[],
): Promise<void> {
  await db
    .update(schema.events)
    .set({ ...unlockedEventFields(n, venueId, locked), updatedAt: new Date() })
    .where(eq(schema.events.id, eventId));
}

async function touchLinkLastSeen(db: Db, linkId: string): Promise<void> {
  await db
    .update(schema.eventSourceLinks)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.eventSourceLinks.id, linkId));
}

/**
 * A non-canonical link's event was merged onto a higher-confidence winner by
 * dedup; re-ingesting that source must not let its lower-confidence fields
 * overwrite the confidence-ladder winner. Only the link's lastSeenAt advances.
 */
async function maintainLink(
  db: Db,
  link: { id: string; eventId: string; isCanonical: boolean; event: { lockedFields: string[] } },
  n: NormalizedEvent,
  venueId: string | null,
): Promise<void> {
  if (link.isCanonical) await updateEventRow(db, link.eventId, n, venueId, link.event.lockedFields);
  await touchLinkLastSeen(db, link.id);
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

/** Exported for race-path testing: the create path a worker takes after a missed link lookup. */
export async function createOrAdoptEvent(
  db: Db,
  source: SourceRef,
  n: NormalizedEvent,
  venueId: string | null,
): Promise<{ eventId: string; created: boolean }> {
  try {
    return { eventId: await createEventWithLink(db, source, n, venueId), created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await findLink(db, source, n.sourceEventId);
    if (!winner) throw err;
    await maintainLink(db, winner, n, venueId);
    return { eventId: winner.eventId, created: false };
  }
}

async function upsertInstance(
  db: Db,
  eventId: string,
  sourceId: string,
  n: NormalizedEvent,
): Promise<void> {
  await db
    .insert(schema.eventInstances)
    .values({ eventId, sourceId, startAt: n.startAt, endAt: n.endAt, timezone: n.timezone, status: n.status })
    .onConflictDoUpdate({
      target: [schema.eventInstances.eventId, schema.eventInstances.startAt],
      set: { endAt: n.endAt, status: n.status, sourceId },
    });
}

async function supersedeOtherInstances(
  db: Db,
  eventId: string,
  sourceId: string,
  keepStartAt: Date,
): Promise<void> {
  await db.delete(schema.eventInstances).where(
    and(
      eq(schema.eventInstances.eventId, eventId),
      eq(schema.eventInstances.sourceId, sourceId),
      ne(schema.eventInstances.startAt, keepStartAt),
    ),
  );
}

async function lockedFieldsFor(db: Db, eventId: string): Promise<string[]> {
  const row = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: { lockedFields: true },
  });
  return row?.lockedFields ?? [];
}

export async function persistNormalizedEvent(
  db: Db,
  source: SourceRef,
  n: NormalizedEvent,
  opts: PersistOptions = {},
): Promise<{ eventId: string; created: boolean }> {
  const venueId = n.venueName ? await findOrCreateVenue(db, n) : null;
  const existingLink = await findLink(db, source, n.sourceEventId);
  let outcome: { eventId: string; created: boolean };
  if (existingLink) {
    await maintainLink(db, existingLink, n, venueId);
    outcome = { eventId: existingLink.eventId, created: false };
  } else {
    outcome = await createOrAdoptEvent(db, source, n, venueId);
  }
  // Admin 'time' lock: ingestion must not rebuild this event's instances —
  // upsert would resurrect the source's start and supersede would delete the admin's.
  const locked = outcome.created ? [] : await lockedFieldsFor(db, outcome.eventId);
  if (!locked.includes('time')) {
    await upsertInstance(db, outcome.eventId, source.id, n);
    if (opts.supersede) await supersedeOtherInstances(db, outcome.eventId, source.id, n.startAt);
  }
  return outcome;
}
