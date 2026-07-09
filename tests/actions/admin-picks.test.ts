import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import * as schema from '@/db/schema';
import { createPickWithDb, deletePickWithDb, updatePickWithDb } from '@/app/actions/admin-picks';

let db: Awaited<ReturnType<typeof createTestDb>>;
let eventId: string;

const validInput = (overrides: Record<string, string> = {}) => ({
  eventId,
  curatorName: 'Tarik',
  curatorRole: 'HYFIN',
  showUrl: 'https://radiomilwaukee.org/show',
  blurb: 'Do not miss this.',
  weekOf: '2026-07-13',
  sortOrder: '1',
  ...overrides,
});

beforeAll(async () => {
  db = await createTestDb();
  // SEED: copied from tests/queries/admin-picks.test.ts
  const [venue] = await db
    .insert(schema.venues)
    .values({
      name: 'Admin Test Venue',
      normalizedName: 'admin test venue',
      neighborhood: 'Bay View',
    })
    .returning();

  const [event] = await db
    .insert(schema.events)
    .values({
      slug: 'admin-test-event',
      title: 'Admin Test Event',
      normalizedTitle: 'admin test event',
      status: 'scheduled',
      category: 'music',
      isFree: true,
      isStationEvent: false,
      venueId: venue.id,
    })
    .returning();

  eventId = event.id;
});

describe('createPickWithDb', () => {
  it('inserts a valid pick', async () => {
    const result = await createPickWithDb(db, validInput());
    expect(result.ok).toBe(true);
    const rows = await db.select().from(schema.staffPicks).where(eq(schema.staffPicks.weekOf, '2026-07-13'));
    expect(rows).toHaveLength(1);
    expect(rows[0].curatorName).toBe('Tarik');
    expect(rows[0].sortOrder).toBe(1);
  });

  it('rejects a non-Monday weekOf (public read path matches exact Mondays)', async () => {
    const result = await createPickWithDb(db, validInput({ weekOf: '2026-07-15' }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Monday/);
  });

  it('rejects an empty blurb', async () => {
    const result = await createPickWithDb(db, validInput({ blurb: '  ' }));
    expect(result.ok).toBe(false);
  });

  it('returns an error envelope (not a throw) for an unknown eventId', async () => {
    const result = await createPickWithDb(
      db,
      validInput({ eventId: '00000000-0000-0000-0000-000000000000' }),
    );
    expect(result.ok).toBe(false);
  });

  it('treats empty showUrl and curatorRole as null', async () => {
    const result = await createPickWithDb(db, validInput({ showUrl: '', curatorRole: '', weekOf: '2026-07-20' }));
    expect(result.ok).toBe(true);
    const rows = await db.select().from(schema.staffPicks).where(eq(schema.staffPicks.weekOf, '2026-07-20'));
    expect(rows[0].showUrl).toBeNull();
    expect(rows[0].curatorRole).toBeNull();
  });
});

describe('updatePickWithDb', () => {
  it('updates fields on an existing pick', async () => {
    const [pick] = await db
      .insert(schema.staffPicks)
      .values({ eventId, curatorName: 'Old', blurb: 'old', weekOf: '2026-07-27' })
      .returning();
    const result = await updatePickWithDb(db, pick.id, validInput({ curatorName: 'New', weekOf: '2026-07-27' }));
    expect(result.ok).toBe(true);
    const [row] = await db.select().from(schema.staffPicks).where(eq(schema.staffPicks.id, pick.id));
    expect(row.curatorName).toBe('New');
  });

  it('returns a not-found envelope for a vanished pick (merge-cascade tolerance)', async () => {
    const result = await updatePickWithDb(
      db,
      '00000000-0000-0000-0000-000000000000',
      validInput(),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not found|removed/i);
  });
});

describe('deletePickWithDb', () => {
  it('deletes and is not-found on the second call', async () => {
    const [pick] = await db
      .insert(schema.staffPicks)
      .values({ eventId, curatorName: 'Del', blurb: 'bye', weekOf: '2026-08-03' })
      .returning();
    expect((await deletePickWithDb(db, pick.id)).ok).toBe(true);
    expect((await deletePickWithDb(db, pick.id)).ok).toBe(false);
  });
});
