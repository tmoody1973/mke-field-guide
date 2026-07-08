import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

async function columnNames(db: Awaited<ReturnType<typeof createTestDb>>, table: string): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = ${table}
  `);
  return (result.rows as { column_name: string }[]).map((row) => row.column_name);
}

describe('phase 4 tables', () => {
  it('replays staff_picks with its expected columns', async () => {
    const db = await createTestDb();
    const cols = await columnNames(db, 'staff_picks');
    expect(cols).toEqual(expect.arrayContaining(['id', 'event_id', 'curator_name', 'blurb', 'week_of', 'sort_order']));
  });
  it('replays newsletter_subscribers with a unique email', async () => {
    const db = await createTestDb();
    await db.execute(sql`INSERT INTO newsletter_subscribers (email) VALUES ('a@b.com')`);
    await expect(db.execute(sql`INSERT INTO newsletter_subscribers (email) VALUES ('a@b.com')`)).rejects.toThrow();
  });
  it('replays venues.slug with a partial unique index', async () => {
    const db = await createTestDb();
    expect(await columnNames(db, 'venues')).toContain('slug');
    const idx = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE indexname = 'venues_slug_unique_idx'`);
    expect(idx.rows).toHaveLength(1);
  });
});
