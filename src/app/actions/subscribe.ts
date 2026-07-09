import { z } from 'zod';
import { newsletterSubscribers } from '@/db/schema';
import type { Db } from '@/lib/card-data';

const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  source: z.string().max(40).optional(),
});

export interface SubscribeState {
  ok: boolean;
  message: string;
}

const INVALID_EMAIL_MESSAGE = 'Enter a valid email to join.';
export const SUBSCRIBE_SUCCESS_MESSAGE = "You're in — first issue lands Thursday.";
const SERVER_ERROR_MESSAGE = 'Something hiccuped — try again in a minute.';

/**
 * Validation + insert, kept free of the `@/db` (live Neon) import so it can be
 * unit-tested against a PGlite instance without a DATABASE_URL in the test process.
 */
export async function subscribeWithDb(
  database: Db,
  input: { email: FormDataEntryValue | null; source: FormDataEntryValue | null }
): Promise<SubscribeState> {
  const parsed = subscribeSchema.safeParse({ email: input.email, source: input.source ?? undefined });
  if (!parsed.success) return { ok: false, message: INVALID_EMAIL_MESSAGE };
  try {
    await database.insert(newsletterSubscribers).values(parsed.data).onConflictDoNothing();
    return { ok: true, message: SUBSCRIBE_SUCCESS_MESSAGE };
  } catch (error) {
    console.error('subscribeWithDb failed', error);
    return { ok: false, message: SERVER_ERROR_MESSAGE };
  }
}
