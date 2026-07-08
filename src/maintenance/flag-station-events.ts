import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/ingestion/persist';

const VENUE_PATTERN = /radio milwaukee/;
const ADDRESS_PATTERN = /220 e\.? pittsburgh/i;
const TITLE_PATTERN = /\b(414 live|hyfin|88nine|backyard)\b/i;

export function isStationEventHeuristic(input: {
  title: string;
  venueNormalizedName: string | null;
  venueAddress: string | null;
}): boolean {
  if (input.venueNormalizedName && VENUE_PATTERN.test(input.venueNormalizedName)) return true;
  if (input.venueAddress && ADDRESS_PATTERN.test(input.venueAddress)) return true;
  return TITLE_PATTERN.test(input.title);
}

export interface FlaggedEvent {
  id: string;
  title: string;
  venueName: string | null;
}

export interface FlagStationEventsResult {
  flagged: FlaggedEvent[];
}

async function candidateEvents(db: Db) {
  return db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      venueName: schema.venues.name,
      venueNormalizedName: schema.venues.normalizedName,
      venueAddress: schema.venues.address,
    })
    .from(schema.events)
    .leftJoin(schema.venues, eq(schema.events.venueId, schema.venues.id))
    .where(eq(schema.events.isStationEvent, false));
}

/** Heuristic sweep, one-way (never unsets isStationEvent). --dry-run reports without mutating. */
export async function flagStationEvents(
  db: Db,
  opts: { dryRun?: boolean } = {},
): Promise<FlagStationEventsResult> {
  const rows = await candidateEvents(db);
  const flagged: FlaggedEvent[] = [];
  for (const row of rows) {
    const matches = isStationEventHeuristic({
      title: row.title,
      venueNormalizedName: row.venueNormalizedName ?? null,
      venueAddress: row.venueAddress ?? null,
    });
    if (!matches) continue;
    flagged.push({ id: row.id, title: row.title, venueName: row.venueName ?? null });
    if (!opts.dryRun) await db.update(schema.events).set({ isStationEvent: true }).where(eq(schema.events.id, row.id));
  }
  return { flagged };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const { db } = await import('@/db');
  const result = await flagStationEvents(db, { dryRun });
  const label = dryRun ? 'would flag' : 'flagged';
  console.log(`station events ${label}: ${result.flagged.length}`);
  for (const event of result.flagged) {
    console.log(`  ${event.title}${event.venueName ? ` @ ${event.venueName}` : ''}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
