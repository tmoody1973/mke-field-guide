import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { flagStationEvents, isStationEventHeuristic } from '@/maintenance/flag-station-events';
import { createTestDb } from '../helpers/test-db';

async function seedEvent(
  db: Awaited<ReturnType<typeof createTestDb>>,
  title: string,
  venue?: { name: string; normalizedName: string; address?: string },
) {
  let venueId: string | null = null;
  if (venue) {
    const [row] = await db
      .insert(schema.venues)
      .values({ name: venue.name, normalizedName: venue.normalizedName, address: venue.address })
      .returning();
    venueId = row.id;
  }
  const [event] = await db
    .insert(schema.events)
    .values({ slug: title.toLowerCase().replace(/\s+/g, '-'), title, normalizedTitle: title.toLowerCase(), venueId })
    .returning();
  return event;
}

describe('isStationEventHeuristic', () => {
  it('flags on venue normalized name match', () => {
    expect(
      isStationEventHeuristic({ title: 'Some Show', venueNormalizedName: 'radio milwaukee', venueAddress: null }),
    ).toBe(true);
  });
  it('flags on address match', () => {
    expect(
      isStationEventHeuristic({ title: 'Some Show', venueNormalizedName: null, venueAddress: '220 E. Pittsburgh Ave' }),
    ).toBe(true);
  });
  it('flags on title keyword match', () => {
    expect(
      isStationEventHeuristic({ title: '414 Live Session', venueNormalizedName: null, venueAddress: null }),
    ).toBe(true);
  });
  it('does not flag an unrelated event', () => {
    expect(
      isStationEventHeuristic({ title: 'Jazz Night', venueNormalizedName: 'pabst theater', venueAddress: null }),
    ).toBe(false);
  });
  it("does not flag another station's Backyard event (WMSE regression)", () => {
    expect(
      isStationEventHeuristic({
        title: '16th Annual WMSE Backyard BBQ',
        venueNormalizedName: 'humboldt park 3000',
        venueAddress: '3000 S Howell Ave, Milwaukee, WI',
      }),
    ).toBe(false);
  });
});

describe('flagStationEvents', () => {
  it('flags a venue match, a title match, and leaves a non-match alone', async () => {
    const db = await createTestDb();
    await seedEvent(db, 'Ordinary Concert', { name: 'Radio Milwaukee', normalizedName: 'radio milwaukee' });
    await seedEvent(db, '88Nine Backyard BBQ');
    await seedEvent(db, 'Unrelated Show', { name: 'Pabst Theater', normalizedName: 'pabst theater' });

    const result = await flagStationEvents(db, { dryRun: false });

    expect(result.flagged).toHaveLength(2);
    const events = await db.query.events.findMany();
    const flaggedTitles = events.filter((e) => e.isStationEvent).map((e) => e.title).sort();
    expect(flaggedTitles).toEqual(['88Nine Backyard BBQ', 'Ordinary Concert']);
  });

  it('dry-run reports without mutating', async () => {
    const db = await createTestDb();
    await seedEvent(db, 'Ordinary Concert', { name: 'Radio Milwaukee', normalizedName: 'radio milwaukee' });

    const result = await flagStationEvents(db, { dryRun: true });

    expect(result.flagged).toHaveLength(1);
    const events = await db.query.events.findMany();
    expect(events.every((e) => e.isStationEvent === false)).toBe(true);
  });
});
