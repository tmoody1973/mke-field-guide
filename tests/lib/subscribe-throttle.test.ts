import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import * as schema from '@/db/schema';
import {
  MAX_ATTEMPTS_PER_WINDOW,
  PRUNE_BATCH,
  hashIp,
  registerAttempt,
} from '@/lib/subscribe-throttle';

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.delete(schema.subscriptionAttempts);
  delete process.env.NEWSLETTER_THROTTLE_DISABLED;
});

describe('hashIp', () => {
  it('is deterministic and never contains the raw ip', () => {
    expect(hashIp('203.0.113.7')).toBe(hashIp('203.0.113.7'));
    expect(hashIp('203.0.113.7')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashIp('203.0.113.7')).not.toContain('203');
  });
});

describe('registerAttempt', () => {
  it('allows the first MAX attempts then blocks within the window', async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_WINDOW; attempt += 1) {
      expect((await registerAttempt(db, '203.0.113.7')).allowed).toBe(true);
    }
    expect((await registerAttempt(db, '203.0.113.7')).allowed).toBe(false);
  });

  it('scopes the window per ip', async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_WINDOW + 1; attempt += 1) {
      await registerAttempt(db, '203.0.113.7');
    }
    expect((await registerAttempt(db, '198.51.100.9')).allowed).toBe(true);
  });

  it('forgets attempts older than the window (injected now)', async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_WINDOW + 1; attempt += 1) {
      await registerAttempt(db, '203.0.113.7', past);
    }
    expect((await registerAttempt(db, '203.0.113.7')).allowed).toBe(true);
  });

  it('kill-switch bypasses without writing rows', async () => {
    process.env.NEWSLETTER_THROTTLE_DISABLED = '1';
    expect((await registerAttempt(db, '203.0.113.7')).allowed).toBe(true);
    expect(await db.select().from(schema.subscriptionAttempts)).toHaveLength(0);
  });

  it('prunes stale rows in bounded batches — one call is capped, a second finishes the job', async () => {
    const now = new Date();
    const staleCreatedAt = new Date(now.getTime() - 25 * 60 * 60 * 1000); // past the 24h prune window
    const staleRows = Array.from({ length: PRUNE_BATCH + 10 }, (_, index) => ({
      ipHash: hashIp(`stale-${index}`),
      createdAt: staleCreatedAt,
    }));
    await db.insert(schema.subscriptionAttempts).values(staleRows);

    await registerAttempt(db, '198.51.100.1', now);
    const afterFirstCall = await db.select().from(schema.subscriptionAttempts);
    const staleRemainingAfterFirst = afterFirstCall.filter(
      (row) => row.createdAt.getTime() === staleCreatedAt.getTime(),
    );
    expect(staleRemainingAfterFirst).toHaveLength(10);

    await registerAttempt(db, '198.51.100.2', now);
    const afterSecondCall = await db.select().from(schema.subscriptionAttempts);
    const staleRemainingAfterSecond = afterSecondCall.filter(
      (row) => row.createdAt.getTime() === staleCreatedAt.getTime(),
    );
    expect(staleRemainingAfterSecond).toHaveLength(0);
  });
});
