import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { SourceAdapter } from '@/ingestion/adapters/types';
import { ingestSource } from '@/ingestion/ingest';
import { createTestDb } from '../helpers/test-db';

const emptyAdapter: SourceAdapter = {
  adapterType: 'ical',
  fetch: async () => ({ records: [], parseSkipped: 0 }),
  normalize: () => null,
};
const throwingAdapter: SourceAdapter = {
  adapterType: 'ical',
  fetch: async () => {
    throw new Error('boom');
  },
  normalize: () => null,
};

describe('ingestSource run-id threading', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  async function seedSource(key: string) {
    const [source] = await db
      .insert(schema.sources)
      .values({ key, name: key, url: 'https://x.test', adapterType: 'ical', config: {} })
      .returning();
    return source;
  }

  it('writes lastRunId on the success path', async () => {
    const source = await seedSource('runid-ok');
    await ingestSource(db, source, emptyAdapter, 'run_success1');
    const row = await db.query.sources.findFirst({ where: eq(schema.sources.id, source.id) });
    expect(row?.lastRunId).toBe('run_success1');
    expect(row?.healthStatus).toBe('ok');
  });

  it('writes lastRunId on the failure path (the run you want to open)', async () => {
    const source = await seedSource('runid-fail');
    await expect(ingestSource(db, source, throwingAdapter, 'run_fail1')).rejects.toThrow('boom');
    const row = await db.query.sources.findFirst({ where: eq(schema.sources.id, source.id) });
    expect(row?.lastRunId).toBe('run_fail1');
    expect(row?.healthStatus).toBe('failing');
    expect(row?.lastError).toContain('boom');
  });

  it('leaves lastRunId untouched when no runId is given (CLI ingest)', async () => {
    const source = await seedSource('runid-none');
    await db.update(schema.sources).set({ lastRunId: 'run_prior' }).where(eq(schema.sources.id, source.id));
    await ingestSource(db, source, emptyAdapter);
    const row = await db.query.sources.findFirst({ where: eq(schema.sources.id, source.id) });
    expect(row?.lastRunId).toBe('run_prior'); // stale-but-honest beats null
  });
});
