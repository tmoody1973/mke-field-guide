// Pure, DB-injected pick mutations (no 'use server' — the repo's subscribe.ts pattern).
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import type { Db } from '@/lib/card-data';

export interface AdminPickState {
  ok: boolean;
  message: string;
}

const SERVER_ERROR_MESSAGE = 'Something went wrong saving the pick. Try again.';
const NOT_FOUND_MESSAGE = 'Pick not found — it may have been removed by a dedup merge.';

/** Public reads match weekOf exactly; a non-Monday pick would silently never render. */
const mondayDate = z.iso
  .date()
  .refine((value) => new Date(`${value}T12:00:00Z`).getUTCDay() === 1, {
    message: 'weekOf must be a Monday (YYYY-MM-DD)',
  });

/** FormData.get() returns null for missing fields — treat null/undefined/'' all as "not provided". */
const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (value ?? '').trim())
    .pipe(z.string().max(max))
    .transform((value) => (value === '' ? null : value));

const pickFieldsSchema = z.object({
  curatorName: z.string().trim().min(1, 'curator is required').max(120),
  curatorRole: optionalText(120),
  showUrl: optionalText(300).refine(
    (value) => value === null || z.url().safeParse(value).success,
    { message: 'show URL must be a valid URL' },
  ),
  blurb: z.string().trim().min(1, 'blurb is required').max(600),
  weekOf: mondayDate,
  sortOrder: z.coerce.number().int().min(0).max(99).default(0),
});

const createPickSchema = pickFieldsSchema.extend({ eventId: z.uuid() });

type PickInput = Record<string, FormDataEntryValue | null>;

function invalidMessage(error: z.ZodError): string {
  return `Check the form: ${error.issues[0]?.message ?? 'invalid input'}`;
}

export async function createPickWithDb(db: Db, input: PickInput): Promise<AdminPickState> {
  const parsed = createPickSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidMessage(parsed.error) };
  try {
    await db.insert(schema.staffPicks).values(parsed.data);
    return { ok: true, message: 'Pick added.' };
  } catch (error) {
    console.error('createPickWithDb failed', error);
    return { ok: false, message: SERVER_ERROR_MESSAGE };
  }
}

export async function updatePickWithDb(db: Db, id: string, input: PickInput): Promise<AdminPickState> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: NOT_FOUND_MESSAGE };
  const parsed = pickFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidMessage(parsed.error) };
  try {
    const rows = await db
      .update(schema.staffPicks)
      .set(parsed.data)
      .where(eq(schema.staffPicks.id, id))
      .returning({ id: schema.staffPicks.id });
    if (rows.length === 0) return { ok: false, message: NOT_FOUND_MESSAGE };
    return { ok: true, message: 'Pick updated.' };
  } catch (error) {
    console.error('updatePickWithDb failed', error);
    return { ok: false, message: SERVER_ERROR_MESSAGE };
  }
}

export async function deletePickWithDb(db: Db, id: string): Promise<AdminPickState> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: NOT_FOUND_MESSAGE };
  try {
    const rows = await db
      .delete(schema.staffPicks)
      .where(eq(schema.staffPicks.id, id))
      .returning({ id: schema.staffPicks.id });
    if (rows.length === 0) return { ok: false, message: NOT_FOUND_MESSAGE };
    return { ok: true, message: 'Pick deleted.' };
  } catch (error) {
    console.error('deletePickWithDb failed', error);
    return { ok: false, message: SERVER_ERROR_MESSAGE };
  }
}
