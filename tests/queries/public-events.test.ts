import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { publicEvents, publicPicks } from '@/queries/public-events';
import { parsePublicEventsQuery } from '@/lib/public-api';
import { chicagoWeekMonday } from '@/lib/display';
import { presetWindow } from '@/search/query-understanding';
import { createTestDb } from '../helpers/test-db';

// Tuesday noon Chicago.
const NOW = new Date('2026-07-07T17:00:00Z');
const at = (iso: string) => new Date(iso);
const TONIGHT_8PM = at('2026-07-08T01:00:00Z'); // Tue 8 PM CDT
const TONIGHT_1130PM = at('2026-07-08T04:30:00Z'); // Tue 11:30 PM CDT
const TOMORROW_7PM = at('2026-07-09T00:00:00Z'); // Wed 7 PM CDT
const TEDS = { lat: 43.06087, lng: -87.98998 };

let db: Awaited<ReturnType<typeof createTestDb>>;
let n = 0;

async function venue(fields: Partial<typeof schema.venues.$inferInsert> = {}) {
  const name = `Venue ${++n}`;
  const [row] = await db.insert(schema.venues).values({ name, normalizedName: name.toLowerCase(), ...fields }).returning();
  return row;
}
async function event(title: string, fields: Partial<typeof schema.events.$inferInsert> = {}) {
  const slug = `e-${++n}`;
  const [row] = await db.insert(schema.events).values({ slug, title, normalizedTitle: title.toLowerCase(), status: 'scheduled', category: 'music', ...fields }).returning();
  return row;
}
async function instance(eventId: string, startAt: Date, status: 'scheduled' | 'cancelled' = 'scheduled') {
  await db.insert(schema.eventInstances).values({ eventId, startAt, status });
}

let ids: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDb();
  const near = await venue({ name: 'Near Club', normalizedName: 'near club', address: '6300 W North Ave', lat: '43.0610', lng: '-87.9915', neighborhood: 'Washington Heights' }); // ~0.1 mi
  const mid = await venue({ name: 'Mid Hall', normalizedName: 'mid hall', lat: '43.0700', lng: '-87.9900' }); // ~0.6 mi
  const far = await venue({ name: 'Far Arena', normalizedName: 'far arena', lat: '43.0389', lng: '-87.9065' }); // ~4.6 mi
  const nowhere = await venue({ name: 'No Pin Bar', normalizedName: 'no pin bar' });
  await db.insert(schema.venueRegistry).values({ id: 'gers-1', name: 'Registry Spot', lat: '43.0650', lon: '-87.9950' });
  const registry = await venue({ name: 'Registry Spot', normalizedName: 'registry spot', registryId: 'gers-1' }); // ~0.3 mi via registry

  const jazz = await event('Jazz Jam', { venueId: near.id, isFree: true, isStationEvent: true });
  await instance(jazz.id, TONIGHT_8PM);
  const late = await event('Late Show', { venueId: mid.id, isFree: false, priceMin: '15' });
  await instance(late.id, TONIGHT_1130PM);
  const tomorrow = await event('Tomorrow Gig', { venueId: near.id });
  await instance(tomorrow.id, TOMORROW_7PM);
  const recurring = await event('Weekly Trivia', { venueId: registry.id });
  await instance(recurring.id, at('2026-06-30T01:00:00Z')); // last week (past)
  await instance(recurring.id, TONIGHT_8PM);
  await instance(recurring.id, at('2026-07-15T01:00:00Z'));
  const arena = await event('Arena Concert', { venueId: far.id });
  await instance(arena.id, TONIGHT_8PM);
  const pinless = await event('Pinless Party', { venueId: nowhere.id });
  await instance(pinless.id, TONIGHT_8PM);
  const cancelled = await event('Cancelled Show', { venueId: near.id, status: 'cancelled' });
  await instance(cancelled.id, TONIGHT_8PM);
  const instCancelled = await event('Instance Cancelled', { venueId: near.id });
  await instance(instCancelled.id, TONIGHT_8PM, 'cancelled');
  const past = await event('Yesterday Show', { venueId: near.id });
  await instance(past.id, at('2026-07-07T01:00:00Z'));
  await db.insert(schema.staffPicks).values({ eventId: jazz.id, curatorName: 'Tarik Moody', curatorRole: 'Host', blurb: 'The best Tuesday hang in town.', weekOf: chicagoWeekMonday(NOW) });
  ids = { jazz: jazz.id, late: late.id, tomorrow: tomorrow.id, recurring: recurring.id, arena: arena.id, pinless: pinless.id };
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe('publicEvents', () => {
  it('never returns cancelled events, cancelled instances or past instances', async () => {
    const rows = titles(await publicEvents(db, { now: NOW }));
    expect(rows).not.toContain('Cancelled Show');
    expect(rows).not.toContain('Instance Cancelled');
    expect(rows).not.toContain('Yesterday Show');
  });

  it('tonight includes an 11:30 PM show and not tomorrow', async () => {
    const rows = titles(await publicEvents(db, { now: NOW, when: 'tonight' }));
    expect(rows).toContain('Late Show');
    expect(rows).not.toContain('Tomorrow Gig');
  });

  it('a recurring event comes back with the date inside the window', async () => {
    const [trivia] = (await publicEvents(db, { now: NOW, when: 'tonight' })).filter((r) => r.title === 'Weekly Trivia');
    expect(trivia.startAt).toEqual(TONIGHT_8PM.toISOString());
  });

  it('near: within the radius, nearest first, with the distance; registry pins count; no pin, no result', async () => {
    const rows = await publicEvents(db, { now: NOW, when: 'tonight', near: TEDS, radiusMiles: 1 });
    expect(titles(rows)).toEqual(['Jazz Jam', 'Weekly Trivia', 'Late Show']);
    expect(rows[0].distanceMiles).toBeGreaterThan(0);
    expect(rows[0].distanceMiles).toBeLessThan(0.2);
    expect(titles(rows)).not.toContain('Arena Concert');
    expect(titles(rows)).not.toContain('Pinless Party');
    expect((await publicEvents(db, { now: NOW, when: 'tonight', near: TEDS, radiusMiles: 5 })).map((r) => r.title)).toContain('Arena Concert');
  });

  it('free only, and by id', async () => {
    expect(titles(await publicEvents(db, { now: NOW, when: 'tonight', free: true }))).toEqual(['Jazz Jam']);
    expect(titles(await publicEvents(db, { now: NOW, ids: [ids.late, ids.arena] })).sort()).toEqual(['Arena Concert', 'Late Show']);
  });

  it('words go through the Field Guide search', async () => {
    // The site's search also checks the database's real clock, so this one event is dated from the real now.
    const realNow = new Date();
    const quiz = await event('Pub Quiz Night', {});
    await instance(quiz.id, new Date(realNow.getTime() + 2 * 86_400_000));
    expect(titles(await publicEvents(db, { now: realNow, q: 'pub quiz' }))).toEqual(['Pub Quiz Night']);
  });

  it('carries the venue, page link, calendar link, station flag and staff pick', async () => {
    const [jazz] = (await publicEvents(db, { now: NOW, when: 'tonight' })).filter((r) => r.title === 'Jazz Jam');
    expect(jazz).toMatchObject({
      venue: { name: 'Near Club', address: '6300 W North Ave', neighborhood: 'Washington Heights' },
      isFree: true, isStationEvent: true,
      pick: { curator: 'Tarik Moody', role: 'Host', blurb: 'The best Tuesday hang in town.' },
    });
    expect(jazz.url).toMatch(/\/events\/e-\d+$/);
    expect(jazz.calendarUrl).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?/);
    const [late] = (await publicEvents(db, { now: NOW, when: 'tonight' })).filter((r) => r.title === 'Late Show');
    expect(late).toMatchObject({ isFree: false, priceMin: 15, pick: null, isStationEvent: false });
  });

  it('at most the limit, never more than 10', async () => {
    expect(await publicEvents(db, { now: NOW, limit: 2 })).toHaveLength(2);
  });
});

describe('publicEvents review fixes', () => {
  it('time and price words in the search text become the window and free filter, not search words', async () => {
    const realNow = new Date();
    const gig = await event('Luminosity Contemporary Jazz Quartet', { isFree: true });
    // Half an hour into tonight's window (whatever time the test runs), so 'tonight' always includes it.
    const tonight = presetWindow('tonight', realNow);
    await instance(gig.id, new Date(Math.max(tonight.start.getTime(), realNow.getTime()) + 30 * 60 * 1000));
    expect(titles(await publicEvents(db, { now: realNow, q: 'free jazz tonight' }))).toEqual(['Luminosity Contemporary Jazz Quartet']);
  });
});

describe('publicPicks', () => {
  it("this week's staff picks first, topped up with upcoming station events to three", async () => {
    const station2 = await event('Station Party', { isStationEvent: true });
    await instance(station2.id, TOMORROW_7PM);
    const rows = await publicPicks(db, NOW);
    expect(rows[0]).toMatchObject({ title: 'Jazz Jam', pick: { curator: 'Tarik Moody' } });
    expect(rows.map((r) => r.title)).toContain('Station Party');
    expect(rows.filter((r) => r.title === 'Jazz Jam')).toHaveLength(1); // a pick that is also a station event isn't repeated
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it('tops up with the soonest station events, scheduled only', async () => {
    const weekly = await event('Weekly Station Hang', { isStationEvent: true });
    for (let d = 2; d < 30; d++) await instance(weekly.id, new Date(NOW.getTime() + d * 86_400_000));
    const soon = await event('Station Soon', { isStationEvent: true });
    await instance(soon.id, at('2026-07-08T00:00:00Z'));
    const gone = await event('Station Cancelled', { isStationEvent: true });
    await instance(gone.id, at('2026-07-08T00:30:00Z'), 'cancelled');
    const titlesOut = (await publicPicks(db, NOW)).map((r) => r.title);
    expect(titlesOut).toContain('Station Soon');
    expect(titlesOut).not.toContain('Station Cancelled');
  });
});

describe('parsePublicEventsQuery', () => {
  const parse = (q: string) => parsePublicEventsQuery(new URLSearchParams(q));
  it('reads words, window, near, radius, free, ids and limit', () => {
    expect(parse('q=live music&when=tonight&near=43.06,-87.99&radius=1&free=1&limit=3')).toEqual({
      ok: true, opts: { q: 'live music', when: 'tonight', near: { lat: 43.06, lng: -87.99 }, radiusMiles: 1, free: true, limit: 3 },
    });
    expect(parse('ids=a1b2c3d4-0000-4000-8000-000000000000')).toMatchObject({ ok: true, opts: { ids: ['a1b2c3d4-0000-4000-8000-000000000000'] } });
  });
  it('accepts when=tomorrow', () => {
    expect(parse('when=tomorrow')).toEqual({ ok: true, opts: { when: 'tomorrow' } });
  });
  it('refuses unknown settings and out-of-range values', () => {
    for (const q of ['zz=1', 'when=someday', 'when=next-week', 'near=999,0', 'radius=50', 'limit=11', 'q=' + 'x'.repeat(121), 'ids=not-a-uuid']) {
      expect(parse(q).ok).toBe(false);
    }
  });
});


describe('publicEvents on a Sunday night', () => {
  const SUNDAY_NIGHT = new Date('2026-10-04T21:15:00-05:00');
  const MIDNIGHT_MONDAY = new Date('2026-10-05T00:00:00-05:00');
  const NEXT_SATURDAY = new Date('2026-10-10T20:00:00-05:00');

  // Own database: the suite above inserts events relative to the real clock, which could land in these windows.
  beforeAll(async () => {
    db = await createTestDb();
    const village = await event('Halloween Village', {});
    await instance(village.id, MIDNIGHT_MONDAY);
    const nextWeekend = await event('Next Weekend Fest', {});
    await instance(nextWeekend.id, NEXT_SATURDAY);
  });

  it('this-week still sees events starting at Monday midnight', async () => {
    expect(titles(await publicEvents(db, { now: SUNDAY_NIGHT, when: 'this-week' }))).toContain('Halloween Village');
  });

  it('this-weekend falls back to next weekend when the current one is spent', async () => {
    const rows = titles(await publicEvents(db, { now: SUNDAY_NIGHT, when: 'this-weekend' }));
    expect(rows).toContain('Next Weekend Fest');
    expect(rows).not.toContain('Halloween Village');
  });

  it('tomorrow returns Monday events', async () => {
    expect(titles(await publicEvents(db, { now: SUNDAY_NIGHT, when: 'tomorrow' }))).toContain('Halloween Village');
  });
});
