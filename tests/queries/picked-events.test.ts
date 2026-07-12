import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { loadPickedEventIds } from '@/queries/picked-events';
import { createTestDb } from '../helpers/test-db';

async function seedEvent(db: Awaited<ReturnType<typeof createTestDb>>, slug: string) {
  const [venue] = await db
    .insert(schema.venues)
    .values({ name: `Venue ${slug}`, normalizedName: `venue ${slug}` })
    .returning();
  const [event] = await db
    .insert(schema.events)
    .values({
      slug,
      title: `Event ${slug}`,
      normalizedTitle: `event ${slug}`,
      status: 'scheduled',
      isStationEvent: false,
      venueId: venue.id,
    })
    .returning();
  return event;
}

async function seedPick(
  db: Awaited<ReturnType<typeof createTestDb>>,
  eventId: string,
  weekOf: string,
) {
  await db.insert(schema.staffPicks).values({
    eventId,
    curatorName: 'DJ Test',
    blurb: 'A pick',
    weekOf,
    sortOrder: 0,
  });
}

// Tuesday, July 7 2026 (Chicago) — chicagoWeekMonday resolves this to 2026-07-06.
const NOW = new Date('2026-07-07T19:00:00-05:00');
const CURRENT_WEEK_MONDAY = '2026-07-06';
const PRIOR_WEEK_MONDAY = '2026-06-29';

describe('loadPickedEventIds', () => {
  it('includes a pick whose weekOf matches the current Chicago week', async () => {
    const db = await createTestDb();
    const event = await seedEvent(db, 'current-week-pick');
    await seedPick(db, event.id, CURRENT_WEEK_MONDAY);

    const pickedIds = await loadPickedEventIds(db, NOW);

    expect(pickedIds.has(event.id)).toBe(true);
  });

  it('excludes a pick from a prior week', async () => {
    const db = await createTestDb();
    const event = await seedEvent(db, 'prior-week-pick');
    await seedPick(db, event.id, PRIOR_WEEK_MONDAY);

    const pickedIds = await loadPickedEventIds(db, NOW);

    expect(pickedIds.has(event.id)).toBe(false);
  });

  it('returns an empty set when there are no picks at all', async () => {
    const db = await createTestDb();
    const pickedIds = await loadPickedEventIds(db, NOW);
    expect(pickedIds.size).toBe(0);
  });
});
