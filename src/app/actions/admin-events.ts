// Pure, DB-injected event-edit mutations (no 'use server' — the repo's admin-reviews.ts pattern).
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import { CATEGORY_VALUES } from '@/enrichment/tag';
import { LOCKED_FIELD_VALUES } from '@/ingestion/persist';
import { normalizeName } from '@/ingestion/naming';
import type { Db } from '@/lib/card-data';

export interface EventActionState {
  ok: boolean;
  message: string;
}

// Single source of truth for the lock vocabulary — imported, not hand-rolled, so a
// typo'd lock value is structurally impossible (Task 4 review finding). 'time' is
// excluded here: it locks only via updateInstanceTimeWithDb, never through the diff below.
type LockableEventField = Exclude<(typeof LOCKED_FIELD_VALUES)[number], 'time'>;

const emptyToNull = (value: string) => (value === '' ? null : value);

const updateEventSchema = z.object({
  eventId: z.uuid(),
  title: z.string().trim().min(1, 'Title is required.').max(300),
  status: z.enum(['scheduled', 'cancelled', 'postponed']),
  category: z.enum(CATEGORY_VALUES).or(z.literal('')).transform(emptyToNull),
  venueId: z.uuid().or(z.literal('')).transform(emptyToNull),
});
export type EventEditInput = Record<string, FormDataEntryValue | null>;

const instanceTimeSchema = z
  .object({
    instanceId: z.uuid(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime().or(z.literal('')).transform(emptyToNull),
  })
  .refine((v) => v.endAt === null || new Date(v.endAt) > new Date(v.startAt), {
    message: 'End must be after start.',
  });

const unlockSchema = z.object({ eventId: z.uuid(), field: z.enum(LOCKED_FIELD_VALUES) });

function invalidMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.';
}

interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  lock: LockableEventField | null;
}

function diffEvent(
  current: { title: string; status: string; category: string | null; venueId: string | null },
  next: { title: string; status: string; category: string | null; venueId: string | null },
): FieldChange[] {
  const changes: FieldChange[] = [];
  if (next.title !== current.title)
    changes.push({ field: 'title', oldValue: current.title, newValue: next.title, lock: 'title' });
  if (next.status !== current.status)
    changes.push({ field: 'status', oldValue: current.status, newValue: next.status, lock: 'status' });
  if (next.category !== current.category)
    changes.push({ field: 'category', oldValue: current.category, newValue: next.category, lock: null });
  if (next.venueId !== current.venueId)
    changes.push({ field: 'venue', oldValue: current.venueId, newValue: next.venueId, lock: 'venue' });
  return changes;
}

async function recordEdits(db: Db, eventId: string, editedBy: string, changes: FieldChange[]): Promise<void> {
  await db.insert(schema.eventEdits).values(
    changes.map((change) => ({
      eventId,
      editedBy,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue,
    })),
  );
}

export async function updateEventWithDb(
  db: Db,
  editedBy: string,
  input: EventEditInput,
): Promise<EventActionState> {
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidMessage(parsed.error) };
  const { eventId, ...next } = parsed.data;
  try {
    const current = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
    if (!current) return { ok: false, message: 'Event not found.' };
    const changes = diffEvent(current, next);
    if (changes.length === 0) return { ok: true, message: 'No changes.' };
    const locks = new Set([...current.lockedFields, ...changes.flatMap((c) => (c.lock ? [c.lock] : []))]);
    // Recovery order (no transactions on Neon HTTP): audit rows BEFORE the row update.
    // A crash between the two leaves the row unchanged, so a retry re-diffs against the
    // same "current" state and inserts a DUPLICATE audit row before the update finally
    // lands — an over-count in provenance, not data loss. Same order for the same reason
    // in unlockFieldWithDb below.
    await recordEdits(db, eventId, editedBy, changes);
    await db
      .update(schema.events)
      .set({
        title: next.title,
        normalizedTitle: normalizeName(next.title),
        status: next.status,
        category: next.category,
        venueId: next.venueId,
        lockedFields: [...locks],
        updatedAt: new Date(),
      })
      .where(eq(schema.events.id, eventId));
    return { ok: true, message: 'Event updated.' };
  } catch (error) {
    console.error('updateEventWithDb failed', error);
    return { ok: false, message: 'Could not save the event. Try again.' };
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  if (e.code === '23505' || e.cause?.code === '23505') return true;
  return typeof e.message === 'string' && e.message.includes('duplicate key value violates unique constraint');
}

async function lockTime(db: Db, eventId: string): Promise<void> {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: { lockedFields: true },
  });
  if (!event || event.lockedFields.includes('time')) return;
  await db
    .update(schema.events)
    .set({ lockedFields: [...event.lockedFields, 'time'], updatedAt: new Date() })
    .where(eq(schema.events.id, eventId));
}

export async function updateInstanceTimeWithDb(
  db: Db,
  editedBy: string,
  input: EventEditInput,
): Promise<EventActionState> {
  const parsed = instanceTimeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidMessage(parsed.error) };
  const { instanceId, startAt, endAt } = parsed.data;
  try {
    const instance = await db.query.eventInstances.findFirst({
      where: eq(schema.eventInstances.id, instanceId),
    });
    if (!instance) return { ok: false, message: 'Instance not found.' };
    await db
      .update(schema.eventInstances)
      .set({ startAt: new Date(startAt), endAt: endAt ? new Date(endAt) : null })
      .where(eq(schema.eventInstances.id, instanceId));
    // Lock BEFORE audit here — the opposite order from updateEventWithDb/unlockFieldWithDb,
    // and deliberately so. persist.ts skips instance maintenance only when 'time' is locked;
    // a crash between the instance move above and this lock leaves a genuinely-moved time
    // with no lock, which the next ingest run silently reverts — a missing lock loses the
    // edit outright. A crash between the lock and the audit insert below only loses one
    // history row, which is visible-but-cosmetic. Minimize the dangerous window, not the
    // cosmetic one.
    await lockTime(db, instance.eventId);
    await recordEdits(db, instance.eventId, editedBy, [
      {
        field: 'time',
        oldValue: instance.startAt.toISOString(),
        newValue: new Date(startAt).toISOString(),
        lock: null,
      },
    ]);
    return { ok: true, message: 'Time updated.' };
  } catch (error) {
    if (isUniqueViolation(error))
      return { ok: false, message: 'Another date of this event already starts at that time.' };
    console.error('updateInstanceTimeWithDb failed', error);
    return { ok: false, message: 'Could not save the time. Try again.' };
  }
}

export async function unlockFieldWithDb(
  db: Db,
  editedBy: string,
  input: EventEditInput,
): Promise<EventActionState> {
  const parsed = unlockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidMessage(parsed.error) };
  const { eventId, field } = parsed.data;
  try {
    const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
    if (!event) return { ok: false, message: 'Event not found.' };
    if (!event.lockedFields.includes(field)) return { ok: true, message: 'Already unlocked.' };
    // Audit before the row update — same rationale as updateEventWithDb: removing a lock
    // has no silent-revert failure mode the way a missed 'time' lock does, so a duplicate
    // audit row on retry is the acceptable side of the tradeoff, not a lost one.
    await recordEdits(db, eventId, editedBy, [
      { field, oldValue: 'locked', newValue: 'unlocked', lock: null },
    ]);
    await db
      .update(schema.events)
      .set({ lockedFields: event.lockedFields.filter((f) => f !== field), updatedAt: new Date() })
      .where(eq(schema.events.id, eventId));
    return { ok: true, message: `Unlocked ${field} — source values apply on the next ingest.` };
  } catch (error) {
    console.error('unlockFieldWithDb failed', error);
    return { ok: false, message: 'Could not unlock. Try again.' };
  }
}
