import { createHash } from 'node:crypto';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/lib/card-data';

export const MAX_ATTEMPTS_PER_WINDOW = 5;
export const WINDOW_MINUTES = 60;
const PRUNE_AFTER_HOURS = 24;
export const PRUNE_BATCH = 500;

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

/** Counts BEFORE inserting so the blocked attempt itself is still recorded (abuse visibility). */
export async function registerAttempt(
  db: Db,
  ip: string,
  now: Date = new Date(),
): Promise<{ allowed: boolean }> {
  if (process.env.NEWSLETTER_THROTTLE_DISABLED === '1') return { allowed: true };
  const ipHash = hashIp(ip);
  const windowStart = new Date(now.getTime() - WINDOW_MINUTES * 60_000);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.subscriptionAttempts)
    .where(
      and(
        eq(schema.subscriptionAttempts.ipHash, ipHash),
        gte(schema.subscriptionAttempts.createdAt, windowStart),
      ),
    );
  await db.insert(schema.subscriptionAttempts).values({ ipHash, createdAt: now });
  const pruneBefore = new Date(now.getTime() - PRUNE_AFTER_HOURS * 60 * 60_000);
  const stale = db
    .select({ id: schema.subscriptionAttempts.id })
    .from(schema.subscriptionAttempts)
    .where(lt(schema.subscriptionAttempts.createdAt, pruneBefore))
    .limit(PRUNE_BATCH);
  await db.delete(schema.subscriptionAttempts).where(inArray(schema.subscriptionAttempts.id, stale));
  return { allowed: count < MAX_ATTEMPTS_PER_WINDOW };
}
