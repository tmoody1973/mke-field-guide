// Absorb a duplicate venue row into its canonical: repoint events, backfill the
// survivor's null address/lat/lng/neighborhood, record the variant's normalized
// name as an alias (so re-ingest can't re-mint it), delete the duplicate.
// No transactions on Neon HTTP — ordered so a crash converges on re-run.
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import type { Db } from '@/db/types';

export interface MergeVenuesResult {
  eventsRepointed: number;
  aliasRecorded: string;
}

export async function mergeVenues(db: Db, keepId: string, absorbId: string): Promise<MergeVenuesResult> {
  if (keepId === absorbId) throw new Error('Refusing to merge a venue into itself.');
  const keep = await db.query.venues.findFirst({ where: eq(schema.venues.id, keepId) });
  const absorb = await db.query.venues.findFirst({ where: eq(schema.venues.id, absorbId) });
  if (!keep) throw new Error(`Keep venue not found: ${keepId}`);
  if (!absorb) throw new Error(`Absorb venue not found: ${absorbId} — already merged?`);

  // 1. Backfill survivor nulls (COALESCE — survivor's own values always win).
  //    neighborhood is load-bearing: the curated map may only know the variant's key.
  await db.execute(sql`
    UPDATE venues k
    SET address = COALESCE(k.address, a.address),
        lat = COALESCE(k.lat, a.lat),
        lng = COALESCE(k.lng, a.lng),
        neighborhood = COALESCE(k.neighborhood, a.neighborhood),
        updated_at = now()
    FROM venues a
    WHERE k.id = ${keepId} AND a.id = ${absorbId}
  `);
  // 2. Repoint events (the only FK into venues). Deliberately ignores per-event
  //    'venue' locks: that lock guards against INGESTION reassigning an event to a
  //    DIFFERENT physical venue from re-parsed text. A merge is operator-invoked
  //    consolidation of two rows for the SAME physical venue — the event still
  //    points at that place, just via the canonical id now.
  const repointed = await db
    .update(schema.events)
    .set({ venueId: keepId, updatedAt: new Date() })
    .where(eq(schema.events.venueId, absorbId))
    .returning({ id: schema.events.id });
  // 3. Record the alias BEFORE deleting — a crash between 3 and 4 leaves both the
  //    alias and the row; findOrCreateVenue prefers the alias, and a re-run finishes.
  await db
    .insert(schema.venueAliases)
    .values({ normalizedName: absorb.normalizedName, venueId: keepId })
    .onConflictDoNothing({ target: schema.venueAliases.normalizedName });
  // 4. Delete the duplicate (its aliases, if any, cascade — re-point them first).
  //    Accepted race window: a concurrent ingest event can land between step 2's
  //    repoint sweep and this delete and get persisted with venueId = absorbId —
  //    events.venue_id has no ON DELETE action, so this DELETE then throws a live
  //    FK violation. That's intentional: it fails LOUD into the ingest source's
  //    markFailed (src/ingestion/ingest.ts) rather than silently orphaning the
  //    event, and a plain re-run of mergeVenues converges (step 2 sweeps the
  //    straggler onto keepId; steps 1 and 3 are idempotent no-ops by then).
  await db
    .update(schema.venueAliases)
    .set({ venueId: keepId })
    .where(eq(schema.venueAliases.venueId, absorbId));
  await db.delete(schema.venues).where(eq(schema.venues.id, absorbId));

  return { eventsRepointed: repointed.length, aliasRecorded: absorb.normalizedName };
}

async function resolveVenueArg(db: Db, arg: string): Promise<string> {
  // A non-uuid arg in an id equality makes Postgres throw on the cast — only
  // include the id term when the arg actually parses as a uuid (repo idiom).
  const isUuid = z.uuid().safeParse(arg).success;
  const venue = await db.query.venues.findFirst({
    where: isUuid
      ? or(eq(schema.venues.id, arg), eq(schema.venues.slug, arg))
      : eq(schema.venues.slug, arg),
  });
  if (!venue) throw new Error(`No venue matches id or slug: ${arg}`);
  return venue.id;
}

function argValue(flag: string): string {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${flag} <slug-or-id>`);
  return value;
}

async function main(): Promise<void> {
  const { db } = await import('@/db');
  const keepId = await resolveVenueArg(db, argValue('--keep'));
  const absorbId = await resolveVenueArg(db, argValue('--absorb'));
  const keep = await db.query.venues.findFirst({ where: eq(schema.venues.id, keepId) });
  const absorb = await db.query.venues.findFirst({ where: eq(schema.venues.id, absorbId) });
  console.log(`KEEP   ${keep?.name} (${keep?.normalizedName})`);
  console.log(`ABSORB ${absorb?.name} (${absorb?.normalizedName})`);
  const result = await mergeVenues(db, keepId, absorbId);
  console.log(`repointed ${result.eventsRepointed} events; alias recorded: ${result.aliasRecorded}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
