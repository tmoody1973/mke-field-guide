import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import * as schema from '@/db/schema';
import {
  MAX_ATTEMPTS_PER_WINDOW,
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
});
