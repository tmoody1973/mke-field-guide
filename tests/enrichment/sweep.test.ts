import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { createTestDb } from '../helpers/test-db';

const { embedManyMock, generateTextMock } = vi.hoisted(() => ({
  embedManyMock: vi.fn(),
  generateTextMock: vi.fn(),
}));

vi.mock('ai', () => ({
  embedMany: embedManyMock,
  generateText: generateTextMock,
  Output: { object: (config: unknown) => config },
}));

// Imported after the mock so sweep.ts's `import { embedMany, generateText } from 'ai'` resolves
// to the mocked module, per Vitest's hoisting contract for vi.mock.
const { enrichSweep } = await import('@/enrichment/sweep');

function fakeEmbedding(seed: number): number[] {
  return Array.from({ length: 1536 }, (_v, i) => (i === 0 ? seed : 0));
}

async function seedSource(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [source] = await db
    .insert(schema.sources)
    .values({ key: 'enrich-test', name: 'Enrich Test', url: 'https://example.com', adapterType: 'html', config: {} })
    .returning();
  return { id: source.id, key: source.key };
}

const FUTURE = new Date(Date.now() + 7 * 86_400_000);

async function seedEvent(
  db: Awaited<ReturnType<typeof createTestDb>>,
  source: { id: string; key: string },
  overrides: Record<string, unknown> = {},
) {
  const { eventId } = await persistNormalizedEvent(db, source, {
    sourceEventId: overrides.sourceEventId as string ?? 'evt-1',
    title: (overrides.title as string) ?? 'Summerfest',
    description: (overrides.description as string) ?? 'Music on the lakefront',
    venueName: 'Henry Maier Festival Park',
    startAt: FUTURE,
    timezone: 'America/Chicago',
    status: 'scheduled',
    isFree: overrides.isFree as boolean | undefined,
  });
  return eventId;
}

async function loadEvent(db: Awaited<ReturnType<typeof createTestDb>>, eventId: string) {
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
  if (!event) throw new Error(`event ${eventId} not found`);
  return event;
}

beforeEach(() => {
  embedManyMock.mockReset();
  generateTextMock.mockReset();
  embedManyMock.mockImplementation(async ({ values }: { values: string[] }) => ({
    embeddings: values.map((_v, i) => fakeEmbedding(i + 1)),
  }));
  generateTextMock.mockImplementation(async () => ({
    output: { category: 'music', vibeTags: ['outdoor'], audienceTags: ['family-friendly'], isFree: true },
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('enrichSweep', () => {
  it('(a) does nothing and makes zero AI calls when no gateway key is configured', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    const db = await createTestDb();
    const source = await seedSource(db);
    await seedEvent(db, source);
    const result = await enrichSweep(db);
    expect(result).toEqual({ embedded: 0, tagged: 0, skipped: 0, titleSuggestions: 0 });
    expect(embedManyMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('(b) embeds a new event and stamps its fingerprint and embeddedAt', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const source = await seedSource(db);
    const eventId = await seedEvent(db, source);
    const result = await enrichSweep(db);
    expect(result.embedded).toBe(1);
    const event = await loadEvent(db, eventId);
    expect(event.embedding).not.toBeNull();
    expect(event.contentFingerprint).not.toBeNull();
    expect(event.embeddedAt).not.toBeNull();
  });

  it('(c) skips an already-embedded event with an unchanged fingerprint on the next sweep', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const source = await seedSource(db);
    await seedEvent(db, source);
    await enrichSweep(db);
    embedManyMock.mockClear();
    const second = await enrichSweep(db);
    expect(second.embedded).toBe(0);
    expect(embedManyMock).not.toHaveBeenCalled();
  });

  it('(d) re-embeds an event whose title changed since the last sweep', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const source = await seedSource(db);
    const eventId = await seedEvent(db, source);
    await enrichSweep(db);
    const before = await loadEvent(db, eventId);
    embedManyMock.mockClear();
    await db.update(schema.events).set({ title: 'Summerfest 2026' }).where(eq(schema.events.id, eventId));
    const result = await enrichSweep(db);
    expect(result.embedded).toBe(1);
    expect(embedManyMock).toHaveBeenCalledTimes(1);
    const after = await loadEvent(db, eventId);
    expect(after.contentFingerprint).not.toBe(before.contentFingerprint);
  });

  it('(e) fills category/tags from the model and only fills isFree when it was null', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const source = await seedSource(db);
    const adapterKnowsFree = await seedEvent(db, source, {
      sourceEventId: 'evt-adapter-free', title: 'Adapter Known Free', isFree: false,
    });
    const adapterUnknownFree = await seedEvent(db, source, {
      sourceEventId: 'evt-unknown-free', title: 'Adapter Unknown Free',
    });
    const result = await enrichSweep(db);
    expect(result.tagged).toBe(2);
    const known = await loadEvent(db, adapterKnowsFree);
    expect(known.category).toBe('music');
    expect(known.vibeTags).toEqual(['outdoor']);
    expect(known.audienceTags).toEqual(['family-friendly']);
    expect(known.isFree).toBe(false); // adapter value wins over the model's `true`
    const unknown = await loadEvent(db, adapterUnknownFree);
    expect(unknown.isFree).toBe(true); // null was filled from the model
  });

  it('(f) counts a rejected AI call as skipped without throwing', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    embedManyMock.mockRejectedValueOnce(new Error('gateway unavailable'));
    const db = await createTestDb();
    const source = await seedSource(db);
    await seedEvent(db, source);
    const result = await enrichSweep(db);
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.embedded).toBe(0);
  });

  it('(g) tags before embedding, so the stored embedding text includes the new tags', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const source = await seedSource(db);
    await seedEvent(db, source);

    const callOrder: string[] = [];
    generateTextMock.mockImplementation(async () => {
      callOrder.push('generateText');
      return { output: { category: 'music', vibeTags: ['outdoor'], audienceTags: ['family-friendly'], isFree: true } };
    });
    embedManyMock.mockImplementation(async ({ values }: { values: string[] }) => {
      callOrder.push('embedMany');
      return { embeddings: values.map((_v, i) => fakeEmbedding(i + 1)) };
    });

    const result = await enrichSweep(db);
    expect(result.tagged).toBe(1);
    expect(result.embedded).toBe(1);
    // Third call is the additive title-suggest tail, which runs after the embed sweep.
    expect(callOrder).toEqual(['generateText', 'embedMany', 'generateText']);

    const embedCallArgs = embedManyMock.mock.calls[0][0] as { values: string[] };
    expect(embedCallArgs.values[0]).toContain('outdoor');
    expect(embedCallArgs.values[0]).toContain('family-friendly');
    expect(embedCallArgs.values[0]).toContain('music');
  });
});
