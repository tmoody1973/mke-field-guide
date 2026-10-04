import { and, desc, eq, like, sql } from 'drizzle-orm';
import type { Db } from '@/db/types';
import * as schema from '@/db/schema';
import { normalizeName } from '@/ingestion/naming';
import { parsePicks, spotlightFor, type ParsedPick } from '@/lib/concert-picks';
import { chicagoWeekMonday } from '@/lib/display';

export interface ConcertPicksArticle {
  id: string; // CDS id
  title: string;
  url: string;
  byline: string;
  publishDateTime: string;
  paragraphs: string[];
}

export interface ImportResult {
  matched: { line: string; eventId: string; title: string }[];
  unmatched: string[];
  written: number;
}

const DEFAULT_BLURB = "On Radio Milwaukee's MKE Concert Picks this week.";

/** The venue a list line names: exact name, a known alias, or the single venue whose name starts with it. */
export async function findVenueIdByName(db: Db, name: string): Promise<string | null> {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const exact = await db.query.venues.findFirst({ where: eq(schema.venues.normalizedName, normalized) });
  if (exact) return exact.id;
  const alias = await db.query.venueAliases.findFirst({ where: eq(schema.venueAliases.normalizedName, normalized) });
  if (alias) return alias.venueId;
  // ponytail: "Linneman's" → "linneman s riverwest inn"; only when exactly one venue fits, never a guess between two
  const prefixed = await db.select({ id: schema.venues.id }).from(schema.venues).where(like(schema.venues.normalizedName, `${normalized} %`)).limit(2);
  return prefixed.length === 1 ? prefixed[0].id : null;
}

/** "7:30 p.m." → minutes after midnight; "noon" → 720; unknown → null. */
function minutesOf(time: string): number | null {
  if (/noon/i.test(time)) return 12 * 60;
  const m = /(\d{1,2})(?::(\d{2}))?\s*(a|p)\.?m/i.exec(time);
  if (!m) return null;
  return ((Number(m[1]) % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + Number(m[2] ?? 0);
}

/** A scheduled event at that venue on that Milwaukee day whose title names the headliner; nearest start wins. */
async function matchPick(db: Db, pick: ParsedPick): Promise<{ eventId: string; title: string } | null> {
  const venueId = await findVenueIdByName(db, pick.venue);
  if (!venueId) return null;
  const rows = await db
    .select({
      eventId: schema.events.id,
      title: schema.events.title,
      minutes: sql<number>`extract(hour from ${schema.eventInstances.startAt} at time zone 'America/Chicago') * 60 + extract(minute from ${schema.eventInstances.startAt} at time zone 'America/Chicago')`,
    })
    .from(schema.eventInstances)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventInstances.eventId))
    .where(and(
      eq(schema.events.venueId, venueId),
      eq(schema.events.status, 'scheduled'),
      eq(schema.eventInstances.status, 'scheduled'),
      sql`(${schema.eventInstances.startAt} at time zone 'America/Chicago')::date = ${pick.date}::date`,
    ));
  const headliner = normalizeName(pick.headliner);
  const named = rows.filter((r) => ` ${normalizeName(r.title)} `.includes(` ${headliner} `));
  if (named.length === 0) return null;
  const wanted = minutesOf(pick.time);
  named.sort((a, b) => (wanted === null ? 0 : Math.abs(Number(a.minutes) - wanted) - Math.abs(Number(b.minutes) - wanted)));
  return { eventId: named[0].eventId, title: named[0].title };
}

/**
 * One Concert Picks article → staff picks for the shows the event guide has. Unmatched lines are reported, never
 * created as events. A dry run writes nothing; a real run writes the whole article or nothing, and re-runs add nothing.
 */
export async function importConcertPicks(db: Db, article: ConcertPicksArticle, { dryRun }: { dryRun: boolean }): Promise<ImportResult> {
  const published = new Date(article.publishDateTime);
  const { picks, unparsed } = parsePicks(article.paragraphs, published);
  const matched: ImportResult['matched'] = [];
  const unmatched = [...unparsed];
  const rows: (typeof schema.staffPicks.$inferInsert)[] = [];
  for (const pick of picks) {
    const event = await matchPick(db, pick);
    if (!event) {
      unmatched.push(pick.line);
      continue;
    }
    matched.push({ line: pick.line, ...event });
    rows.push({
      eventId: event.eventId, curatorName: article.byline, curatorRole: 'Radio Milwaukee', showUrl: article.url,
      blurb: spotlightFor(article.paragraphs, pick.headliner) ?? DEFAULT_BLURB,
      weekOf: chicagoWeekMonday(published), sortOrder: pick.order, sourceId: article.id,
    });
  }
  if (dryRun) return { matched, unmatched, written: 0 };
  const record = {
    sourceId: article.id, title: article.title, url: article.url, weekOf: chicagoWeekMonday(published),
    matchedCount: matched.length, unmatched, importedAt: new Date(),
  };
  // Production's neon-http driver has no transactions, so order makes it safe instead: picks first, then the record.
  // Both skip what already exists; a failure in between leaves no record, and the next run finishes the job.
  const inserted = rows.length
    ? await db.insert(schema.staffPicks).values(rows).onConflictDoNothing().returning({ id: schema.staffPicks.id })
    : [];
  await db.insert(schema.concertPicksImports).values(record).onConflictDoUpdate({ target: schema.concertPicksImports.sourceId, set: record });
  return { matched, unmatched, written: inserted.length };
}

/** The daily job: this week's article, once. An article already imported is skipped, so picks staff delete stay deleted. */
export async function importLatestConcertPicks(
  db: Db,
  fetchArticle: () => Promise<ConcertPicksArticle | null>,
): Promise<{ imported: false; reason: 'no article' | 'already imported' } | { imported: true; article: string; written: number; matched: number; unmatched: number }> {
  const article = await fetchArticle();
  if (!article) return { imported: false, reason: 'no article' };
  const done = await db.query.concertPicksImports.findFirst({ where: eq(schema.concertPicksImports.sourceId, article.id) });
  if (done) return { imported: false, reason: 'already imported' };
  const result = await importConcertPicks(db, article, { dryRun: false });
  return { imported: true, article: article.id, written: result.written, matched: result.matched.length, unmatched: result.unmatched.length };
}

/** The latest imports, newest first, for the admin picks page. */
export async function recentImports(db: Db, limit = 4) {
  return db.select().from(schema.concertPicksImports).orderBy(desc(schema.concertPicksImports.importedAt)).limit(limit);
}
