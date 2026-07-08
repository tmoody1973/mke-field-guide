import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('weighted search_tsv', () => {
  it('ranks a title hit above a description hit', async () => {
    const db = await createTestDb();
    await db.insert(schema.events).values([
      { slug: 'a', title: 'Jazz Night', normalizedTitle: 'jazz night' },
      { slug: 'b', title: 'Open Mic', normalizedTitle: 'open mic', description: 'jazz jam session after the mic' },
    ]);
    const result = await db.execute(sql`
      SELECT slug, ts_rank("search_tsv", websearch_to_tsquery('english', 'jazz')) AS rank
      FROM events WHERE "search_tsv" @@ websearch_to_tsquery('english', 'jazz')
      ORDER BY rank DESC
    `);
    const slugs = result.rows.map((r) => (r as { slug: string }).slug);
    expect(slugs).toEqual(['a', 'b']);
  });

  it('matches enrichment tags at weight B', async () => {
    const db = await createTestDb();
    await db.insert(schema.events).values(
      { slug: 'c', title: 'Sunset Cruise', normalizedTitle: 'sunset cruise', vibeTags: ['chill', 'outdoors'] },
    );
    const result = await db.execute(sql`
      SELECT slug FROM events WHERE "search_tsv" @@ websearch_to_tsquery('english', 'outdoors')
    `);
    expect(result.rows).toHaveLength(1);
  });
});
