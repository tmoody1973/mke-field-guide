import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { addStaffPick } from '@/maintenance/add-staff-pick';
import { createTestDb } from '../helpers/test-db';

async function seedEvent(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [event] = await db
    .insert(schema.events)
    .values({ slug: 'jazz-in-the-park', title: 'Jazz in the Park', normalizedTitle: 'jazz in the park' })
    .returning();
  return event;
}

describe('addStaffPick', () => {
  it('inserts a pick against a seeded event', async () => {
    const db = await createTestDb();
    const event = await seedEvent(db);

    const pick = await addStaffPick(db, {
      slug: 'jazz-in-the-park',
      curatorName: 'Tarik',
      blurb: 'A great show.',
      weekOf: '2026-07-06',
    });

    expect(pick.eventId).toBe(event.id);
    expect(pick.curatorName).toBe('Tarik');
    expect(pick.sortOrder).toBe(0);
  });

  it('rejects an unknown slug', async () => {
    const db = await createTestDb();
    await expect(
      addStaffPick(db, { slug: 'does-not-exist', curatorName: 'Tarik', blurb: 'x', weekOf: '2026-07-06' }),
    ).rejects.toThrow(/does-not-exist/);
  });
});
