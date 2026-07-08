import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { searchEvents } from '@/search/hybrid';
import { createTestDb } from '../helpers/test-db';

const FUTURE = (days: number, hour = 19) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

// deterministic unit-ish vectors: e1 points "comedy", e2 points "family outdoors"
const vec = (i: number) => `[${Array.from({ length: 1536 }, (_, k) => (k === i ? 1 : 0)).join(',')}]`;

async function seedEvent(db: Awaited<ReturnType<typeof createTestDb>>, opts: {
  slug: string; title: string; description?: string; vibeTags?: string[]; audienceTags?: string[];
  isFree?: boolean; category?: string; embeddingIndex?: number; startAt?: Date; venueName?: string;
}) {
  let venueId: string | null = null;
  if (opts.venueName) {
    const [v] = await db.insert(schema.venues).values({
      name: opts.venueName, normalizedName: opts.venueName.toLowerCase(),
    }).onConflictDoNothing({ target: schema.venues.normalizedName }).returning();
    venueId = v?.id ?? (await db.query.venues.findFirst({
      where: (t, { eq }) => eq(t.normalizedName, opts.venueName!.toLowerCase()),
    }))!.id;
  }
  const [e] = await db.insert(schema.events).values({
    slug: opts.slug, title: opts.title, normalizedTitle: opts.title.toLowerCase(),
    description: opts.description, vibeTags: opts.vibeTags, audienceTags: opts.audienceTags,
    isFree: opts.isFree, category: opts.category, venueId,
  }).returning();
  if (opts.embeddingIndex !== undefined) {
    await db.execute(sql`UPDATE events SET embedding = ${vec(opts.embeddingIndex)}::vector WHERE id = ${e.id}`);
  }
  await db.insert(schema.eventInstances).values({ eventId: e.id, startAt: opts.startAt ?? FUTURE(3) });
  return e;
}

describe('searchEvents', () => {
  it('keyword search ranks the title match first (FTS leg alone)', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'comedy', title: 'Comedy Showcase', venueName: 'Pabst Theater' });
    await seedEvent(db, { slug: 'music', title: 'Indie Night', description: 'no comedy here honestly' });
    const hits = await searchEvents(db, { text: 'comedy' });
    expect(hits[0].slug).toBe('comedy');
    expect(hits).toHaveLength(2);
  });

  it('typo-tolerant via trigram when FTS misses', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'pabst', title: 'Pabst Theater Tour' });
    const hits = await searchEvents(db, { text: 'pabts theater' });
    expect(hits.map((h) => h.slug)).toContain('pabst');
  });

  it('vector leg surfaces a semantic match FTS cannot see, and RRF fuses both legs', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'kids-picnic', title: 'Family Picnic', embeddingIndex: 2 });
    await seedEvent(db, { slug: 'metal', title: 'Metal Fest', embeddingIndex: 5 });
    const queryEmbedding = Array.from({ length: 1536 }, (_, k) => (k === 2 ? 1 : 0));
    const hits = await searchEvents(db, { queryEmbedding });
    expect(hits[0].slug).toBe('kids-picnic');
  });

  it('facets filter: free + vibe + window', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'free-chill', title: 'Beach Hang', isFree: true, vibeTags: ['chill'], startAt: FUTURE(2) });
    await seedEvent(db, { slug: 'paid', title: 'Beach Rave', isFree: false, vibeTags: ['party'], startAt: FUTURE(2) });
    await seedEvent(db, { slug: 'late', title: 'Beach Later', isFree: true, vibeTags: ['chill'], startAt: FUTURE(30) });
    const hits = await searchEvents(db, {
      filters: {
        free: true, vibe: 'chill',
        window: { start: new Date(), end: new Date(Date.now() + 7 * 86_400_000) },
      },
    });
    expect(hits.map((h) => h.slug)).toEqual(['free-chill']);
  });

  it('no text and no embedding returns the facet browse ordered by next start', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'soon', title: 'Soon Show', startAt: FUTURE(1) });
    await seedEvent(db, { slug: 'later', title: 'Later Show', startAt: FUTURE(5) });
    const hits = await searchEvents(db, {});
    expect(hits.map((h) => h.slug)).toEqual(['soon', 'later']);
  });

  it('never returns past instances', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'past', title: 'Old Show', startAt: new Date(Date.now() - 86_400_000) });
    const hits = await searchEvents(db, { text: 'old show' });
    expect(hits).toHaveLength(0);
  });
});
