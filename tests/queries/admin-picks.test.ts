import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import * as schema from '@/db/schema';
import { getPickById, pickWeeks } from '@/queries/admin-picks';

let db: Awaited<ReturnType<typeof createTestDb>>;
let eventId: string;

beforeAll(async () => {
  db = await createTestDb();

  const [venue] = await db
    .insert(schema.venues)
    .values({
      name: 'Admin Test Venue',
      normalizedName: 'admin test venue',
      neighborhood: 'Bay View',
    })
    .returning();

  const [event] = await db
    .insert(schema.events)
    .values({
      slug: 'admin-test-event',
      title: 'Admin Test Event',
      normalizedTitle: 'admin test event',
      status: 'scheduled',
      category: 'music',
      isFree: true,
      isStationEvent: false,
      venueId: venue.id,
    })
    .returning();

  eventId = event.id;
});

describe('getPickById', () => {
  it('returns the full editable row joined with event title and slug', async () => {
    const [inserted] = await db
      .insert(schema.staffPicks)
      .values({
        eventId,
        curatorName: 'Test DJ',
        blurb: 'A great one',
        weekOf: '2026-07-06',
        sortOrder: 2,
      })
      .returning();
    const row = await getPickById(db, inserted.id);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      id: inserted.id,
      eventId,
      curatorName: 'Test DJ',
      curatorRole: null,
      showUrl: null,
      blurb: 'A great one',
      weekOf: '2026-07-06',
      sortOrder: 2,
      eventTitle: 'Admin Test Event',
      eventSlug: 'admin-test-event',
    });
  });

  it('returns null for an unknown id', async () => {
    expect(await getPickById(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('pickWeeks', () => {
  it('returns distinct weeks, newest first', async () => {
    await db.insert(schema.staffPicks).values([
      { eventId, curatorName: 'A', blurb: 'x', weekOf: '2026-07-13' },
      { eventId, curatorName: 'B', blurb: 'y', weekOf: '2026-07-13' },
      { eventId, curatorName: 'C', blurb: 'z', weekOf: '2026-06-29' },
    ]);
    const weeks = await pickWeeks(db);
    expect(weeks[0]).toBe('2026-07-13');
    expect(weeks).toContain('2026-07-06');
    expect(weeks).toContain('2026-06-29');
    expect(new Set(weeks).size).toBe(weeks.length);
  });
});
