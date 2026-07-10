import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { sourceHealthRows } from '@/queries/admin-sources';
import { createTestDb } from '../helpers/test-db';

describe('sourceHealthRows', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
    await db.insert(schema.sources).values([
      {
        key: 'healthy-src', name: 'Healthy', url: 'https://a.test', adapterType: 'ical', config: {},
        healthStatus: 'ok', lastFetchAt: new Date('2026-07-09T11:00:00Z'), lastAttemptAt: new Date('2026-07-09T11:00:00Z'),
        lastFetchedCount: 30, lastPublishedCount: 30, lastSkippedCount: 0, lastRunId: 'run_ok1',
      },
      {
        key: 'broken-src', name: 'Broken', url: 'https://b.test', adapterType: 'api',
        config: { cadence: 'daily' }, healthStatus: 'failing', lastError: 'TICKETMASTER_API_KEY is not set',
        consecutiveFailures: 3, lastAttemptAt: new Date('2026-07-09T11:00:00Z'),
        lastFetchAt: new Date('2026-07-07T22:00:00Z'), lastRunId: 'run_fail1',
      },
      { key: 'virgin-src', name: 'Virgin', url: 'https://c.test', adapterType: 'html', config: {} },
    ]);
  });

  it('returns failing sources first, then unknown, then ok; alphabetical within group', async () => {
    const rows = await sourceHealthRows(db);
    expect(rows.map((r) => r.key)).toEqual(['broken-src', 'virgin-src', 'healthy-src']);
  });

  it('computes the backoff window for a source at the failure threshold', async () => {
    const broken = (await sourceHealthRows(db)).find((r) => r.key === 'broken-src');
    // 3 consecutive failures = FAILURES_BEFORE_BACKOFF → a non-null future re-attempt bound.
    expect(broken?.inBackoffUntil).toBeInstanceOf(Date);
    expect(broken?.inBackoffUntil!.getTime()).toBeGreaterThan(new Date('2026-07-09T11:00:00Z').getTime());
  });

  it('carries the raw health fields the dashboard renders', async () => {
    const healthy = (await sourceHealthRows(db)).find((r) => r.key === 'healthy-src');
    expect(healthy).toMatchObject({
      healthStatus: 'ok', lastPublishedCount: 30, lastSkippedCount: 0, lastRunId: 'run_ok1', lastError: null,
    });
  });

  it('healthy and never-run sources have no backoff window', async () => {
    const rows = await sourceHealthRows(db);
    expect(rows.find((r) => r.key === 'healthy-src')?.inBackoffUntil).toBeNull();
    expect(rows.find((r) => r.key === 'virgin-src')?.inBackoffUntil).toBeNull();
  });
});
