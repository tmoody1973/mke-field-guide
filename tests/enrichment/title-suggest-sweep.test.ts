import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import { suggestTitles } from '@/enrichment/title-suggest-sweep';
import type { TitleSuggestion } from '@/enrichment/title-suggest';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { createTestDb } from '../helpers/test-db';

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

async function seedSource(db: TestDb, key: string, adapterType: 'html' | 'firecrawl' | 'api' | 'ical' | 'rss') {
  const [source] = await db
    .insert(schema.sources)
    .values({ key, name: key, url: `https://${key}.example`, adapterType, config: {} })
    .returning();
  return { id: source.id, key: source.key };
}

const FUTURE = new Date(Date.now() + 7 * 86_400_000);
FUTURE.setUTCHours(19, 0, 0, 0); // evening start well in the future, non-midnight Chicago wall time

async function seedEvent(
  db: TestDb,
  source: { id: string; key: string },
  sourceEventId: string,
  title: string,
): Promise<string> {
  const { eventId } = await persistNormalizedEvent(db, source, {
    sourceEventId,
    title,
    venueName: 'Turner Hall Ballroom',
    startAt: FUTURE,
    timezone: 'America/Chicago',
    status: 'scheduled',
  });
  return eventId;
}

async function loadEvent(db: TestDb, eventId: string) {
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
  if (!event) throw new Error(`event ${eventId} not found`);
  return event;
}

function fakeSuggestion(overrides: Partial<TitleSuggestion> = {}): TitleSuggestion {
  return { cleanTitle: 'Cleaned Title', changed: true, confidence: 0.9, rationale: 'cleaned up', ...overrides };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('suggestTitles', () => {
  it('does nothing and makes zero AI calls when no gateway key is configured', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    const db = await createTestDb();
    const source = await seedSource(db, 'no-key-src', 'html');
    await seedEvent(db, source, 'e1', 'JUNK TITLE @ VENUE 7PM');
    const suggestFn = vi.fn(async () => fakeSuggestion());

    const result = await suggestTitles(db, { suggestFn });

    expect(result).toEqual({ suggested: 0, alreadyClean: 0, skipped: 0 });
    expect(suggestFn).not.toHaveBeenCalled();
  });

  it('proposes for a scraper-sourced junk title and stamps both columns', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const source = await seedSource(db, 'html-src', 'html');
    const eventId = await seedEvent(db, source, 'e1', 'JUNK TITLE @ VENUE 7PM');
    const suggestFn = vi.fn(async () => fakeSuggestion({ cleanTitle: 'Junk Title' }));

    const result = await suggestTitles(db, { suggestFn });

    expect(result).toEqual({ suggested: 1, alreadyClean: 0, skipped: 0 });
    const before = { title: 'JUNK TITLE @ VENUE 7PM', titleSuggestion: null, titleSuggestedAt: null };
    const after = await loadEvent(db, eventId);
    expect(after.title).toBe(before.title); // propose-only: events.title itself never mutated
    expect(after.titleSuggestion).toBe('Junk Title');
    expect(after.titleSuggestedAt).not.toBeNull();
  });

  it('stamps only the gate for an already-clean verdict (changed: false)', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const source = await seedSource(db, 'html-src', 'html');
    const eventId = await seedEvent(db, source, 'e1', 'Already Clean Title');
    const suggestFn = vi.fn(async () =>
      fakeSuggestion({ cleanTitle: 'Already Clean Title', changed: false }),
    );

    const result = await suggestTitles(db, { suggestFn });

    expect(result).toEqual({ suggested: 0, alreadyClean: 1, skipped: 0 });
    const after = await loadEvent(db, eventId);
    expect(after.titleSuggestion).toBeNull();
    expect(after.titleSuggestedAt).not.toBeNull();
  });

  it('treats a cleanTitle identical to the raw title as already-clean even when changed:true', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const source = await seedSource(db, 'html-src', 'html');
    const eventId = await seedEvent(db, source, 'e1', 'Same Title');
    const suggestFn = vi.fn(async () => fakeSuggestion({ cleanTitle: 'Same Title', changed: true }));

    const result = await suggestTitles(db, { suggestFn });

    expect(result).toEqual({ suggested: 0, alreadyClean: 1, skipped: 0 });
    const after = await loadEvent(db, eventId);
    expect(after.titleSuggestion).toBeNull();
    expect(after.titleSuggestedAt).not.toBeNull();
  });

  it('never selects api/ical-sourced events or already-gated events', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const apiSource = await seedSource(db, 'api-src', 'api');
    const icalSource = await seedSource(db, 'ical-src', 'ical');
    const htmlSource = await seedSource(db, 'html-src', 'html');

    await seedEvent(db, apiSource, 'api-1', 'Api Sourced Event');
    await seedEvent(db, icalSource, 'ical-1', 'Ical Sourced Event');
    const gatedEventId = await seedEvent(db, htmlSource, 'gated-1', 'Already Gated Event');
    await db
      .update(schema.events)
      .set({ titleSuggestedAt: new Date() })
      .where(eq(schema.events.id, gatedEventId));
    await seedEvent(db, htmlSource, 'eligible-1', 'Eligible Junk Title');

    const suggestFn = vi.fn(async () => fakeSuggestion());
    const result = await suggestTitles(db, { suggestFn });

    expect(suggestFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ suggested: 1, alreadyClean: 0, skipped: 0 });
  });

  it('null suggestion = skip, gate stays NULL for retry', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const source = await seedSource(db, 'html-src', 'html');
    const eventId = await seedEvent(db, source, 'e1', 'Some Title');
    const suggestFn = vi.fn(async () => null);

    const result = await suggestTitles(db, { suggestFn });

    expect(result).toEqual({ suggested: 0, alreadyClean: 0, skipped: 1 });
    const after = await loadEvent(db, eventId);
    expect(after.titleSuggestion).toBeNull();
    expect(after.titleSuggestedAt).toBeNull();
  });

  it('PROPOSE-ONLY invariant: events.title, lockedFields, instances, links byte-untouched', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const source = await seedSource(db, 'html-src', 'html');
    await seedEvent(db, source, 'e1', 'JUNK TITLE @ VENUE 7PM');

    const eventsBefore = await db.query.events.findMany();
    const instancesBefore = await db.query.eventInstances.findMany();
    const linksBefore = await db.query.eventSourceLinks.findMany();

    const suggestFn = vi.fn(async () => fakeSuggestion({ cleanTitle: 'Junk Title' }));
    await suggestTitles(db, { suggestFn });

    const eventsAfter = await db.query.events.findMany();
    const instancesAfter = await db.query.eventInstances.findMany();
    const linksAfter = await db.query.eventSourceLinks.findMany();

    expect(instancesAfter).toEqual(instancesBefore);
    expect(linksAfter).toEqual(linksBefore);
    // Only title_suggestion / title_suggested_at may differ from the pre-sweep snapshot.
    const maskTitleGate = (rows: typeof eventsBefore) =>
      rows.map((row) => ({ ...row, titleSuggestion: null, titleSuggestedAt: null }));
    expect(maskTitleGate(eventsAfter)).toEqual(maskTitleGate(eventsBefore));
    expect(eventsAfter[0].title).toBe('JUNK TITLE @ VENUE 7PM'); // events.title itself never mutated
    expect(eventsAfter[0].lockedFields).toEqual(eventsBefore[0].lockedFields);
  });

  it('respects limit oldest-first', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const source = await seedSource(db, 'html-src', 'html');
    const olderId = await seedEvent(db, source, 'old-1', 'Older Junk Title');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const newerId = await seedEvent(db, source, 'new-1', 'Newer Junk Title');

    const suggestFn = vi.fn(async () => fakeSuggestion());
    const result = await suggestTitles(db, { limit: 1, suggestFn });

    expect(result).toEqual({ suggested: 1, alreadyClean: 0, skipped: 0 });
    expect(suggestFn).toHaveBeenCalledTimes(1);
    const older = await loadEvent(db, olderId);
    const newer = await loadEvent(db, newerId);
    expect(older.titleSuggestedAt).not.toBeNull();
    expect(newer.titleSuggestedAt).toBeNull();
  });
});
