import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

describe('pgvector in the test harness', () => {
  it('computes cosine distance with the <=> operator', async () => {
    const db = await createTestDb();
    const result = await db.execute(sql`SELECT '[1,0,0]'::vector(3) <=> '[0,1,0]'::vector(3) AS dist`);
    expect(Number((result.rows[0] as { dist: unknown }).dist)).toBeCloseTo(1);
  });

  it('replayed the embedding column and HNSW index', async () => {
    const db = await createTestDb();
    const col = await db.execute(sql`
      SELECT data_type, udt_name FROM information_schema.columns
      WHERE table_name = 'events' AND column_name = 'embedding'
    `);
    expect((col.rows[0] as { udt_name: string }).udt_name).toBe('vector');
    const idx = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE indexname = 'events_embedding_hnsw_idx'`);
    expect(idx.rows).toHaveLength(1);
  });
});
