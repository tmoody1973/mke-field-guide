import { beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import {
  applyTitleSuggestionWithDb,
  dismissTitleSuggestionWithDb,
  unlockFieldWithDb,
  updateEventWithDb,
  updateInstanceTimeWithDb,
} from '@/app/actions/admin-events';
import { createTestDb } from '../helpers/test-db';

const EDITOR = 'tarik@radiomilwaukee.org';

describe('admin event editing', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  async function seedEvent(slug: string) {
    const [event] = await db
      .insert(schema.events)
      .values({ slug, title: 'Original Title', normalizedTitle: 'original title' })
      .returning();
    return event;
  }

  it('updates changed fields, recomputes normalizedTitle, and writes one provenance row per change', async () => {
    const event = await seedEvent('edit-basic');
    const result = await updateEventWithDb(db, EDITOR, {
      eventId: event.id, title: 'Fixed Title', status: 'cancelled', category: 'music', venueId: '',
    });
    expect(result.ok).toBe(true);
    const updated = await db.query.events.findFirst({ where: eq(schema.events.id, event.id) });
    expect(updated).toMatchObject({
      title: 'Fixed Title', normalizedTitle: 'fixed title', status: 'cancelled', category: 'music',
    });
    // title + status changed AND lock; category changed, NO lock (enrichment already respects non-null)
    expect([...(updated?.lockedFields ?? [])].sort()).toEqual(['status', 'title']);
    const edits = await db.query.eventEdits.findMany({
      where: eq(schema.eventEdits.eventId, event.id),
      orderBy: [asc(schema.eventEdits.createdAt)],
    });
    expect(edits.map((edit) => edit.field).sort()).toEqual(['category', 'status', 'title']);
    expect(edits.find((edit) => edit.field === 'title')).toMatchObject({
      editedBy: EDITOR, oldValue: 'Original Title', newValue: 'Fixed Title',
    });
  });

  it('a no-change save writes nothing', async () => {
    const event = await seedEvent('edit-noop');
    const result = await updateEventWithDb(db, EDITOR, {
      eventId: event.id, title: 'Original Title', status: 'scheduled', category: '', venueId: '',
    });
    expect(result.ok).toBe(true);
    expect(await db.query.eventEdits.findMany({ where: eq(schema.eventEdits.eventId, event.id) })).toEqual([]);
    expect((await db.query.events.findFirst({ where: eq(schema.events.id, event.id) }))?.lockedFields).toEqual([]);
  });

  it('rejects a category outside the closed vocabulary', async () => {
    const event = await seedEvent('edit-badcat');
    const result = await updateEventWithDb(db, EDITOR, {
      eventId: event.id, title: 'Original Title', status: 'scheduled', category: 'polka-core', venueId: '',
    });
    expect(result.ok).toBe(false);
  });

  it('moves an instance time, locks time, and reports a start collision as an envelope', async () => {
    const event = await seedEvent('edit-time');
    const t1 = new Date('2026-08-01T01:00:00Z');
    const t2 = new Date('2026-08-02T01:00:00Z');
    const [a] = await db.insert(schema.eventInstances).values({ eventId: event.id, startAt: t1 }).returning();
    await db.insert(schema.eventInstances).values({ eventId: event.id, startAt: t2 });

    const moved = await updateInstanceTimeWithDb(db, EDITOR, {
      instanceId: a.id, startAt: '2026-08-03T01:00:00.000Z', endAt: '',
    });
    expect(moved.ok).toBe(true);
    expect((await db.query.events.findFirst({ where: eq(schema.events.id, event.id) }))?.lockedFields).toContain('time');

    const collided = await updateInstanceTimeWithDb(db, EDITOR, {
      instanceId: a.id, startAt: t2.toISOString(), endAt: '',
    });
    expect(collided.ok).toBe(false);
    expect(collided.message).toMatch(/already starts/i);
  });

  it('rejects endAt at or before startAt', async () => {
    const event = await seedEvent('edit-endat');
    const [inst] = await db
      .insert(schema.eventInstances)
      .values({ eventId: event.id, startAt: new Date('2026-08-05T01:00:00Z') })
      .returning();
    const result = await updateInstanceTimeWithDb(db, EDITOR, {
      instanceId: inst.id, startAt: '2026-08-05T01:00:00.000Z', endAt: '2026-08-05T00:00:00.000Z',
    });
    expect(result.ok).toBe(false);
  });

  it('unlock removes exactly one lock and audits it', async () => {
    const event = await seedEvent('edit-unlock');
    await db.update(schema.events).set({ lockedFields: ['title', 'time'] }).where(eq(schema.events.id, event.id));
    const result = await unlockFieldWithDb(db, EDITOR, { eventId: event.id, field: 'title' });
    expect(result.ok).toBe(true);
    expect((await db.query.events.findFirst({ where: eq(schema.events.id, event.id) }))?.lockedFields).toEqual(['time']);
    const edits = await db.query.eventEdits.findMany({ where: eq(schema.eventEdits.eventId, event.id) });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ field: 'title', oldValue: 'locked', newValue: 'unlocked' });
  });

  it('applyTitleSuggestion routes through the editor mutation: title updated, locked, provenance row, suggestion cleared, gate kept', async () => {
    const suggestedAt = new Date('2026-07-01T00:00:00Z');
    const [event] = await db
      .insert(schema.events)
      .values({
        slug: 'edit-title-suggestion-apply',
        title: 'Original Title',
        normalizedTitle: 'original title',
        titleSuggestion: 'Cleaned Up Title',
        titleSuggestedAt: suggestedAt,
      })
      .returning();

    const result = await applyTitleSuggestionWithDb(db, EDITOR, { eventId: event.id });
    expect(result.ok).toBe(true);

    const updated = await db.query.events.findFirst({ where: eq(schema.events.id, event.id) });
    expect(updated?.title).toBe('Cleaned Up Title');
    expect(updated?.lockedFields).toContain('title');
    expect(updated?.titleSuggestion).toBeNull();
    expect(updated?.titleSuggestedAt).toEqual(suggestedAt);

    const edits = await db.query.eventEdits.findMany({ where: eq(schema.eventEdits.eventId, event.id) });
    expect(edits.find((edit) => edit.field === 'title')).toMatchObject({
      oldValue: 'Original Title',
      newValue: 'Cleaned Up Title',
    });
  });

  it('applyTitleSuggestion with no suggestion present returns a friendly envelope', async () => {
    const event = await seedEvent('edit-title-suggestion-none');
    const result = await applyTitleSuggestionWithDb(db, EDITOR, { eventId: event.id });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no pending title suggestion/i);
    const unchanged = await db.query.events.findFirst({ where: eq(schema.events.id, event.id) });
    expect(unchanged?.title).toBe('Original Title');
  });

  it('applyTitleSuggestion with title already matching the suggestion clears it honestly, without claiming a lock', async () => {
    const suggestedAt = new Date('2026-07-01T00:00:00Z');
    const [event] = await db
      .insert(schema.events)
      .values({
        slug: 'edit-title-suggestion-already-applied',
        title: 'Cleaned Up Title',
        normalizedTitle: 'cleaned up title',
        titleSuggestion: 'Cleaned Up Title',
        titleSuggestedAt: suggestedAt,
      })
      .returning();

    const result = await applyTitleSuggestionWithDb(db, EDITOR, { eventId: event.id });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/already matches/i);

    const updated = await db.query.events.findFirst({ where: eq(schema.events.id, event.id) });
    expect(updated?.titleSuggestion).toBeNull();
    expect(updated?.titleSuggestedAt).toEqual(suggestedAt);
    expect(updated?.lockedFields ?? []).not.toContain('title');

    const edits = await db.query.eventEdits.findMany({ where: eq(schema.eventEdits.eventId, event.id) });
    expect(edits).toEqual([]);
  });

  it('dismissTitleSuggestion clears the suggestion, keeps the gate, and audits the decline', async () => {
    const suggestedAt = new Date('2026-07-01T00:00:00Z');
    const [event] = await db
      .insert(schema.events)
      .values({
        slug: 'edit-title-suggestion-dismiss',
        title: 'Original Title',
        normalizedTitle: 'original title',
        titleSuggestion: 'Cleaned Up Title',
        titleSuggestedAt: suggestedAt,
      })
      .returning();

    const result = await dismissTitleSuggestionWithDb(db, EDITOR, { eventId: event.id });
    expect(result.ok).toBe(true);

    const updated = await db.query.events.findFirst({ where: eq(schema.events.id, event.id) });
    expect(updated?.title).toBe('Original Title');
    expect(updated?.titleSuggestion).toBeNull();
    expect(updated?.titleSuggestedAt).toEqual(suggestedAt);

    const edits = await db.query.eventEdits.findMany({ where: eq(schema.eventEdits.eventId, event.id) });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      field: 'title-suggestion',
      oldValue: 'Cleaned Up Title',
      newValue: 'dismissed',
      editedBy: EDITOR,
    });
  });
});
