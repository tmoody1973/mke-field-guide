import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as schema from '@/db/schema';
import { picksForWeek } from '@/queries/picks';
import { createTestDb } from '../helpers/test-db';

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

let counter = 0;

async function seedTestData(name?: string) {
  const uniqueName = name || `Test Venue ${++counter}`;
  const normalizedName = uniqueName.toLowerCase().replace(/\s+/g, ' ');
  const [venue] = await db.insert(schema.venues).values({
    name: uniqueName,
    normalizedName: normalizedName,
    neighborhood: 'Bay View',
  }).returning();

  const uniqueSlug = `test-event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const [event] = await db.insert(schema.events).values({
    slug: uniqueSlug,
    title: 'Test Event',
    normalizedTitle: 'test event',
    status: 'scheduled',
    category: 'music',
    isFree: true,
    isStationEvent: false,
    venueId: venue.id,
  }).returning();

  return { venue, event };
}

describe('picksForWeek', () => {
  it('should return picks for the requested week only', async () => {
    const { event } = await seedTestData();
    const week1 = '2024-01-01';
    const week2 = '2024-01-08';

    // Seed instances in different weeks
    await db.insert(schema.eventInstances).values([
      { eventId: event.id, startAt: new Date('2024-01-02T20:00:00Z') },
      { eventId: event.id, startAt: new Date('2024-01-09T20:00:00Z') },
    ]);

    // Seed picks in different weeks
    await db.insert(schema.staffPicks).values([
      {
        eventId: event.id,
        curatorName: 'DJ Alice',
        curatorRole: 'Music Director',
        showUrl: 'https://example.com/alice',
        blurb: 'First week pick',
        weekOf: week1,
        sortOrder: 0,
      },
      {
        eventId: event.id,
        curatorName: 'DJ Bob',
        curatorRole: 'Host',
        showUrl: 'https://example.com/bob',
        blurb: 'Second week pick',
        weekOf: week2,
        sortOrder: 0,
      },
    ]);

    // Query week 1
    const picks1 = await picksForWeek(db, week1);
    expect(picks1).toHaveLength(1);
    expect(picks1[0]?.curatorName).toBe('DJ Alice');
    expect(picks1[0]?.blurb).toBe('First week pick');

    // Query week 2
    const picks2 = await picksForWeek(db, week2);
    expect(picks2).toHaveLength(1);
    expect(picks2[0]?.curatorName).toBe('DJ Bob');
    expect(picks2[0]?.blurb).toBe('Second week pick');
  });

  it('should order picks by sortOrder ascending', async () => {
    const { event } = await seedTestData();
    const week = '2024-02-01';

    // Seed instance
    await db.insert(schema.eventInstances).values({
      eventId: event.id,
      startAt: new Date('2024-02-05T20:00:00Z'),
    });

    // Seed picks in different orders
    await db.insert(schema.staffPicks).values([
      {
        eventId: event.id,
        curatorName: 'DJ Second',
        curatorRole: null,
        showUrl: null,
        blurb: 'Second pick',
        weekOf: week,
        sortOrder: 1,
      },
      {
        eventId: event.id,
        curatorName: 'DJ First',
        curatorRole: null,
        showUrl: null,
        blurb: 'First pick',
        weekOf: week,
        sortOrder: 0,
      },
      {
        eventId: event.id,
        curatorName: 'DJ Third',
        curatorRole: null,
        showUrl: null,
        blurb: 'Third pick',
        weekOf: week,
        sortOrder: 2,
      },
    ]);

    // Query and verify order
    const picks = await picksForWeek(db, week);
    expect(picks).toHaveLength(3);
    expect(picks[0]?.curatorName).toBe('DJ First');
    expect(picks[1]?.curatorName).toBe('DJ Second');
    expect(picks[2]?.curatorName).toBe('DJ Third');
  });

  it('should return empty array when no picks for week', async () => {
    const picks = await picksForWeek(db, '2024-03-01');
    expect(picks).toEqual([]);
  });

  it('should return PickWithEvent with correct structure', async () => {
    const { event } = await seedTestData();
    const week = '2024-04-01';

    // Seed instance
    await db.insert(schema.eventInstances).values({
      eventId: event.id,
      startAt: new Date('2024-04-05T20:00:00Z'),
    });

    // Seed pick
    const [pick] = await db.insert(schema.staffPicks).values({
      eventId: event.id,
      curatorName: 'DJ Structure',
      curatorRole: 'Tester',
      showUrl: 'https://example.com/structure',
      blurb: 'A structured pick',
      weekOf: week,
      sortOrder: 0,
    }).returning();

    // Query and verify structure
    const picks = await picksForWeek(db, week);
    expect(picks).toHaveLength(1);
    const result = picks[0];

    expect(result).toBeDefined();
    expect(result?.id).toBe(pick.id);
    expect(result?.curatorName).toBe('DJ Structure');
    expect(result?.curatorRole).toBe('Tester');
    expect(result?.showUrl).toBe('https://example.com/structure');
    expect(result?.blurb).toBe('A structured pick');
    expect(result?.meta).toBeDefined();
    expect(result?.meta?.title).toBe('Test Event');
    expect(result?.meta?.slug).toMatch(/^test-event-/);
    expect(result?.nextStartAt).toBeDefined();
  });
});
