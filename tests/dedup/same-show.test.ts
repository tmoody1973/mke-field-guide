import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { dedupSweep, resolvePendingSameShow } from '@/dedup/sweep';
import { createTestDb } from '../helpers/test-db';

// Three sources: a higher-ranked non-venue source, the venue's own listing (html,
// lower ladder rank), and a second non-venue html source for the no-venue-owned case.
async function seedSources(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [api] = await db.insert(schema.sources).values({
    key: 'tm-test', name: 'TM', url: 'https://tm.example', adapterType: 'api', config: {},
  }).returning();
  const [pabst] = await db.insert(schema.sources).values({
    key: 'pabst-theater-group', name: 'Pabst Theater Group', url: 'https://pabsttheatergroup.example',
    adapterType: 'html', config: {},
  }).returning();
  const [otherHtml] = await db.insert(schema.sources).values({
    key: 'other-promoter', name: 'Other Promoter', url: 'https://other.example', adapterType: 'html', config: {},
  }).returning();
  return {
    api: { id: api.id, key: api.key },
    pabst: { id: pabst.id, key: pabst.key },
    otherHtml: { id: otherHtml.id, key: otherHtml.key },
  };
}

const FUTURE = new Date(Date.now() + 7 * 86_400_000);
FUTURE.setUTCHours(19, 0, 0, 0); // evening start well in the future, non-midnight Chicago wall time

function normalized(sourceEventId: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceEventId,
    title,
    venueName: 'Turner Hall Ballroom',
    startAt: FUTURE,
    timezone: 'America/Chicago',
    status: 'scheduled' as const,
    ...overrides,
  };
}

describe('same-show auto-merge in the review band', () => {
  it('auto-merges a same-venue same-time review-band pair, preferring the venue-owned source over the ladder', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const apiEvent = await persistNormalizedEvent(db, sources.api, normalized('tm-dc', 'Death Cab for Cutie'));
    const venueOwnedEvent = await persistNormalizedEvent(
      db,
      sources.pabst,
      normalized('pabst-dc', 'Death Cab for Cutie w/ Jay Som'),
    );
    const result = await dedupSweep(db);
    expect(result.merged).toBe(1);
    expect(result.queued).toBe(0);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(venueOwnedEvent.eventId); // venue-owned wins despite lower ladder rank
    expect(await db.query.eventReviews.findMany()).toHaveLength(0);
    void apiEvent;
  });

  it('falls through to the confidence ladder when neither side is venue-owned', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const apiEvent = await persistNormalizedEvent(db, sources.api, normalized('tm-dc2', 'Death Cab for Cutie'));
    await persistNormalizedEvent(
      db,
      sources.otherHtml,
      normalized('other-dc2', 'Death Cab for Cutie w/ Jay Som'),
    );
    const result = await dedupSweep(db);
    expect(result.merged).toBe(1);
    expect(result.queued).toBe(0);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(apiEvent.eventId); // ladder: api > html
  });

  it('leaves a same-venue pair queued when the start-time gap exceeds 15 minutes', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const later = new Date(FUTURE.getTime() + 120 * 60_000);
    await persistNormalizedEvent(db, sources.api, normalized('tm-dc3', 'Death Cab for Cutie'));
    await persistNormalizedEvent(
      db,
      sources.pabst,
      normalized('pabst-dc3', 'Death Cab for Cutie w/ Jay Som', { startAt: later }),
    );
    const result = await dedupSweep(db);
    expect(result.merged).toBe(0);
    expect(result.queued).toBe(1);
    const reviews = await db.query.eventReviews.findMany();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].status).toBe('pending');
  });

  it('leaves a pair queued when venue affinity is low, even at matching start time', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    await persistNormalizedEvent(db, sources.api, normalized('tm-dc4', 'Big Show', { venueName: 'Turner Hall Ballroom' }));
    await persistNormalizedEvent(db, sources.pabst, normalized('pabst-dc4', 'Big Show', { venueName: 'The Rave' }));
    const result = await dedupSweep(db);
    expect(result.merged).toBe(0);
    expect(result.queued).toBe(1);
  });

  it('resolvePendingSameShow merges a qualifying legacy pending pair and cascades its review row, leaving a non-qualifying pair pending', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const qualA = await persistNormalizedEvent(db, sources.api, normalized('tm-q', 'Death Cab for Cutie'));
    const qualB = await persistNormalizedEvent(
      db,
      sources.pabst,
      normalized('pabst-q', 'Death Cab for Cutie w/ Jay Som'),
    );
    const noQualA = await persistNormalizedEvent(
      db,
      sources.api,
      normalized('tm-nq', 'Big Show', { venueName: 'Turner Hall Ballroom' }),
    );
    const noQualB = await persistNormalizedEvent(
      db,
      sources.pabst,
      normalized('pabst-nq', 'Big Show', { venueName: 'The Rave' }),
    );

    const [qualEventAId, qualEventBId] = [qualA.eventId, qualB.eventId].sort();
    await db.insert(schema.eventReviews).values({
      eventAId: qualEventAId,
      eventBId: qualEventBId,
      score: '0.68',
      breakdown: { titleSimilarity: 0.65, venueAffinity: 1, startDeltaMinutes: 0, urlMatch: false, total: 0.68, verdict: 'review' },
    });
    const [noQualEventAId, noQualEventBId] = [noQualA.eventId, noQualB.eventId].sort();
    await db.insert(schema.eventReviews).values({
      eventAId: noQualEventAId,
      eventBId: noQualEventBId,
      score: '0.68',
      breakdown: { titleSimilarity: 1, venueAffinity: 0.1, startDeltaMinutes: 0, urlMatch: false, total: 0.68, verdict: 'review' },
    });

    const outcome = await resolvePendingSameShow(db);
    expect(outcome.merged).toBe(1);
    expect(outcome.kept).toBe(1);

    const reviews = await db.query.eventReviews.findMany();
    expect(reviews).toHaveLength(1); // the qualifying row cascaded away with its deleted duplicate event
    expect([reviews[0].eventAId, reviews[0].eventBId]).toContain(noQualEventAId);

    const events = await db.query.events.findMany();
    expect(events).toHaveLength(3); // qualifying pair merged to 1, non-qualifying pair stays 2
  });

  it('keeps the confidence ladder (not venue-owned preference) deciding survivor for >=0.80 auto-merges', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const apiEvent = await persistNormalizedEvent(db, sources.api, normalized('tm-hi', 'Hozier'));
    await persistNormalizedEvent(db, sources.pabst, normalized('pabst-hi', 'Hozier'));
    const result = await dedupSweep(db);
    expect(result.merged).toBe(1);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(apiEvent.eventId); // ladder wins; venue-owned preference doesn't apply above 0.80
  });
});
