import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { adminEventList, venueOptions } from '@/queries/admin-events';
import { createTestDb } from '../helpers/test-db';

describe('adminEventList', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
    const [apiSource] = await db.insert(schema.sources)
      .values({ key: 'api-src', name: 'API', url: 'https://a.test', adapterType: 'api', config: {} }).returning();
    const [htmlSource] = await db.insert(schema.sources)
      .values({ key: 'html-src', name: 'HTML', url: 'https://b.test', adapterType: 'html', config: {} }).returning();

    const [tagged] = await db.insert(schema.events)
      .values({ slug: 'tagged-api', title: 'Tagged Api Event', normalizedTitle: 'tagged api event', category: 'music' }).returning();
    const [scraped] = await db.insert(schema.events)
      .values({ slug: 'scraped-html', title: 'Scraped Html Event', normalizedTitle: 'scraped html event', category: 'arts' }).returning();
    const [untagged] = await db.insert(schema.events)
      .values({ slug: 'untagged-api', title: 'Untagged Api Event', normalizedTitle: 'untagged api event' }).returning();

    await db.insert(schema.eventSourceLinks).values([
      { eventId: tagged.id, sourceId: apiSource.id, sourceEventId: 't1' },
      { eventId: scraped.id, sourceId: htmlSource.id, sourceEventId: 's1' },
      { eventId: untagged.id, sourceId: apiSource.id, sourceEventId: 'u1' },
    ]);
    await db.insert(schema.eventInstances).values([
      { eventId: tagged.id, startAt: new Date('2026-08-01T00:00:00Z') },
      { eventId: scraped.id, startAt: new Date('2026-08-02T00:00:00Z') },
      { eventId: untagged.id, startAt: new Date('2026-08-03T00:00:00Z') },
    ]);
  });

  it('low-confidence filter = scraper-sourced OR never-enriched, nothing else', async () => {
    const rows = await adminEventList(db, { filter: 'low-confidence' });
    expect(rows.map((r) => r.slug).sort()).toEqual(['scraped-html', 'untagged-api']);
    expect(rows.find((r) => r.slug === 'scraped-html')?.lowConfidence).toBe(true);
  });

  it('search matches on normalized title', async () => {
    const rows = await adminEventList(db, { q: 'TAGGED api' });
    expect(rows.map((r) => r.slug).sort()).toEqual(['tagged-api', 'untagged-api']);
  });

  it('carries the canonical source and lock state for each row', async () => {
    const rows = await adminEventList(db, {});
    const scraped = rows.find((r) => r.slug === 'scraped-html');
    expect(scraped).toMatchObject({
      canonicalSourceKey: 'html-src', canonicalAdapterType: 'html', lockedFields: [],
    });
  });

  it('venueOptions returns name-ordered venues', async () => {
    await db.insert(schema.venues).values([
      { name: 'Zeta Hall', normalizedName: 'zeta hall' },
      { name: 'Alpha Room', normalizedName: 'alpha room' },
    ]);
    const options = await venueOptions(db);
    expect(options.map((v) => v.name)).toEqual(['Alpha Room', 'Zeta Hall']);
  });
});
