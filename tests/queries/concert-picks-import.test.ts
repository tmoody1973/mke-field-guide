import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { findVenueIdByName, importConcertPicks, importLatestConcertPicks, recentImports } from '@/queries/concert-picks-import';
import article from '../fixtures/concert-picks-2026-09-30.json';
import { createTestDb } from '../helpers/test-db';

let db: Awaited<ReturnType<typeof createTestDb>>;
let n = 0;
async function venue(name: string, normalizedName: string) {
  const [row] = await db.insert(schema.venues).values({ name, normalizedName, slug: `v${n++}` }).returning();
  return row.id;
}
async function event(title: string, venueId: string, startAt: string, status: 'scheduled' | 'cancelled' = 'scheduled') {
  const [row] = await db.insert(schema.events).values({ slug: `e${n++}`, title, normalizedTitle: title.toLowerCase(), status, category: 'music', venueId }).returning();
  await db.insert(schema.eventInstances).values({ eventId: row.id, startAt: new Date(startAt), status: 'scheduled' });
  return row.id;
}

let ids: Record<string, string>;
beforeEach(async () => {
  db = await createTestDb();
  const turner = await venue('Turner Hall', 'turner hall');
  const linnemans = await venue("Linneman's Riverwest Inn", 'linneman s riverwest inn');
  const landmark = await venue('Landmark Credit Union Live', 'landmark credit union live');
  const anodyne = await venue('Anodyne Coffee', 'anodyne coffee');
  await db.insert(schema.venueAliases).values({ normalizedName: 'anodyne', venueId: anodyne });
  ids = {
    brightEyes: await event('Bright Eyes', turner, '2026-10-03T00:30:00Z'), // Oct 2, 7:30 p.m. in Milwaukee
    garwood: await event("Jesse Garwood Club Presents: Fall Show", linnemans, '2026-10-03T00:00:00Z'),
    beck: await event('Beck: Ride Lonesome Tour', landmark, '2026-10-07T01:00:00Z'),
    mtJoyWrongDay: await event('Mt. Joy', landmark, '2026-10-04T01:00:00Z'),
    charmingCancelled: await event('Charming Disaster', anodyne, '2026-10-03T00:30:00Z', 'cancelled'),
  };
});

describe('findVenueIdByName', () => {
  it('exact name, alias, or the one venue whose name starts with it', async () => {
    expect(await findVenueIdByName(db, 'Turner Hall')).not.toBeNull();
    expect(await findVenueIdByName(db, 'Anodyne')).not.toBeNull();
    expect(await findVenueIdByName(db, "Linneman's")).not.toBeNull();
    expect(await findVenueIdByName(db, 'The Rave')).toBeNull();
  });
});

describe('importConcertPicks', () => {
  it('dry run reports matches and misses and writes nothing', async () => {
    const out = await importConcertPicks(db, article, { dryRun: true });
    expect(out.matched.map((m) => m.eventId).sort()).toEqual([ids.brightEyes, ids.garwood, ids.beck].sort());
    expect(out.unmatched).toContain('Oct. 2: Mt. Joy @ Landmark Credit Union Live, 8 p.m.');
    expect(out.unmatched).toContain('Oct. 2: Charming Disaster, Duo Mercury @ Anodyne, 7:30 p.m.');
    expect(out.written).toBe(0);
    expect(await db.select().from(schema.staffPicks)).toHaveLength(0);
  });

  it('writes staff picks: byline as curator, spotlight as blurb, list order, the week, the source', async () => {
    const out = await importConcertPicks(db, article, { dryRun: false });
    expect(out.written).toBe(3);
    const [beck] = await db.select().from(schema.staffPicks).where(eq(schema.staffPicks.eventId, ids.beck));
    expect(beck).toMatchObject({
      curatorName: 'Brett Krzykowski', curatorRole: 'Radio Milwaukee', showUrl: article.url, weekOf: '2026-09-28', sourceId: 'g-s921-16698', sortOrder: 18,
    });
    expect(beck.blurb).toMatch(/^After giving yourself a couple days to regroup/);
    const [bright] = await db.select().from(schema.staffPicks).where(eq(schema.staffPicks.eventId, ids.brightEyes));
    expect(bright.blurb).toBe("On Radio Milwaukee's MKE Concert Picks this week.");
  });

  it('records the import (what the event guide lacks) for the admin page; a dry run records nothing', async () => {
    await importConcertPicks(db, article, { dryRun: true });
    expect(await recentImports(db)).toEqual([]);
    await importConcertPicks(db, article, { dryRun: false });
    const [imp] = await recentImports(db);
    expect(imp).toMatchObject({ sourceId: 'g-s921-16698', title: article.title, weekOf: '2026-09-28', matchedCount: 3 });
    expect(imp.unmatched).toContain('Oct. 2: Mt. Joy @ Landmark Credit Union Live, 8 p.m.');
  });

  it('works on a database that has no transactions (production uses the neon-http driver)', async () => {
    const noTx = new Proxy(db, { get: (t, p) => (p === 'transaction' ? () => { throw new Error('No transactions support in neon-http driver'); } : Reflect.get(t, p)) });
    expect((await importConcertPicks(noTx, article, { dryRun: false })).written).toBe(3);
    expect(await recentImports(db)).toHaveLength(1);
  });

  it('the daily job skips an article already imported, so picks staff delete stay deleted', async () => {
    const fetchArticle = async () => article;
    expect(await importLatestConcertPicks(db, fetchArticle)).toMatchObject({ imported: true, written: 3 });
    await db.delete(schema.staffPicks).where(eq(schema.staffPicks.eventId, ids.beck));
    expect(await importLatestConcertPicks(db, fetchArticle)).toEqual({ imported: false, reason: 'already imported' });
    expect(await db.select().from(schema.staffPicks)).toHaveLength(2);
    expect(await importLatestConcertPicks(db, async () => null)).toEqual({ imported: false, reason: 'no article' });
  });

  it('running again adds nothing', async () => {
    await importConcertPicks(db, article, { dryRun: false });
    expect((await importConcertPicks(db, article, { dryRun: false })).written).toBe(0);
    expect(await db.select().from(schema.staffPicks)).toHaveLength(3);
  });
});
