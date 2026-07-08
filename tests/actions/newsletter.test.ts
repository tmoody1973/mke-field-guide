import { describe, it, expect, beforeAll } from 'vitest';
import { subscribeWithDb } from '@/app/actions/subscribe';
import { createTestDb } from '../helpers/test-db';

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

describe('subscribeWithDb', () => {
  it('inserts a valid, normalized email', async () => {
    const result = await subscribeWithDb(db, { email: '  Test@Example.com  ', source: 'homepage' });
    expect(result).toEqual({ ok: true, message: "You're in — first issue lands Thursday." });

    const rows = await db.query.newsletterSubscribers.findMany({});
    const row = rows.find((candidate) => candidate.email === 'test@example.com');
    expect(row?.source).toBe('homepage');
  });

  it('treats a duplicate submission as idempotent-ok, not an error', async () => {
    const first = await subscribeWithDb(db, { email: 'dup@example.com', source: 'homepage' });
    const second = await subscribeWithDb(db, { email: 'dup@example.com', source: 'homepage' });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: true, message: "You're in — first issue lands Thursday." });

    const rows = await db.query.newsletterSubscribers.findMany({});
    expect(rows.filter((row) => row.email === 'dup@example.com')).toHaveLength(1);
  });

  it('rejects garbage input with a friendly message and no insert', async () => {
    const result = await subscribeWithDb(db, { email: 'not-an-email', source: 'homepage' });
    expect(result).toEqual({ ok: false, message: 'Enter a valid email to join.' });

    const rows = await db.query.newsletterSubscribers.findMany({});
    expect(rows.some((row) => row.email === 'not-an-email')).toBe(false);
  });

  it('rejects a missing email', async () => {
    const result = await subscribeWithDb(db, { email: null, source: null });
    expect(result.ok).toBe(false);
  });
});
