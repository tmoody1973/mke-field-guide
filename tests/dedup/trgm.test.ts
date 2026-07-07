import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

describe('pg_trgm in the test harness', () => {
  it('computes trigram similarity', async () => {
    const db = await createTestDb();
    const result = await db.execute(sql`SELECT similarity('summerfest', 'summerfest 2026') AS sim`);
    const sim = Number((result.rows[0] as { sim: unknown }).sim);
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThanOrEqual(1);
  });
});
