import { describe, it, expect, beforeAll } from 'vitest';
import * as schema from '@/db/schema';
import { homeData } from '@/queries/home';
import { presetWindow } from '@/search/query-understanding';
import { chicagoWeekMonday } from '@/lib/display';
import { createTestDb } from '../helpers/test-db';

// Tuesday noon Chicago — mid-week, so tonight/weekend/picks windows land on distinct,
// non-overlapping days and can't accidentally satisfy each other's assertions.
const NOW = new Date('2026-07-07T17:00:00Z');

let db: Awaited<ReturnType<typeof createTestDb>>;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
});

async function seedVenue(neighborhood: string | null) {
  const name = `Test Venue ${++counter}`;
  const [venue] = await db.insert(schema.venues).values({
    name,
    normalizedName: name.toLowerCase(),
    neighborhood,
  }).returning();
  return venue;
}

async function seedEvent(overrides: Partial<typeof schema.events.$inferInsert>) {
  const slug = `test-event-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const [event] = await db.insert(schema.events).values({
    slug,
    title: slug,
    normalizedTitle: slug,
    status: 'scheduled',
    category: 'music',
    isFree: true,
    isStationEvent: false,
    ...overrides,
  }).returning();
  return event;
}

async function seedInstance(eventId: string, startAt: Date) {
  await db.insert(schema.eventInstances).values({ eventId, startAt });
}

describe('homeData', () => {
  it('surfaces tonight, weekend, station, picks, and hood counts relative to a fixed now', async () => {
    const venue = await seedVenue('Bay View');
    const tonightWindow = presetWindow('tonight', NOW);
    const weekendWindow = presetWindow('this-weekend', NOW);

    const tonightEvent = await seedEvent({ venueId: venue.id, title: 'Tonight Show' });
    await seedInstance(tonightEvent.id, new Date(tonightWindow.start.getTime() + 60 * 60 * 1000));

    const weekendEvent = await seedEvent({ venueId: venue.id, title: 'Weekend Show' });
    await seedInstance(weekendEvent.id, new Date(weekendWindow.start.getTime() + 60 * 60 * 1000));

    const stationEvent = await seedEvent({ venueId: venue.id, title: 'Station Show', isStationEvent: true });
    await seedInstance(stationEvent.id, new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000));

    const pickEvent = await seedEvent({ venueId: venue.id, title: 'Pick Show' });
    await seedInstance(pickEvent.id, new Date(NOW.getTime() + 30 * 60 * 1000));
    await db.insert(schema.staffPicks).values({
      eventId: pickEvent.id,
      curatorName: 'DJ Test',
      curatorRole: 'Host',
      blurb: 'Go to this.',
      weekOf: chicagoWeekMonday(NOW),
      sortOrder: 0,
    });

    const pastEvent = await seedEvent({ venueId: venue.id, title: 'Past Show' });
    await seedInstance(pastEvent.id, new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000));

    const data = await homeData(db, NOW);

    expect(data.tonight.map((item) => item.meta.title)).toEqual(['Tonight Show']);
    expect(data.weekend.map((item) => item.meta.title)).toEqual(['Weekend Show']);
    expect(data.station.map((item) => item.meta.title)).toEqual(['Station Show']);
    expect(data.picks).toHaveLength(1);
    expect(data.picks[0]?.curatorName).toBe('DJ Test');
    expect(data.picks[0]?.meta.title).toBe('Pick Show');

    const bayView = data.hoods.find((hood) => hood.name === 'Bay View');
    expect(bayView?.count).toBe(4);
  });

  it('returns empty modules against a clean database', async () => {
    const emptyDb = await createTestDb();
    const data = await homeData(emptyDb, NOW);
    expect(data).toEqual({ tonight: [], weekend: [], station: [], picks: [], hoods: [] });
  });
});
