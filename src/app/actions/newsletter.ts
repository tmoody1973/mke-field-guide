'use server';

import { headers } from 'next/headers';
import { db } from '@/db';
import {
  SUBSCRIBE_SUCCESS_MESSAGE,
  subscribeWithDb,
  type SubscribeState,
} from '@/app/actions/subscribe';
import { registerAttempt } from '@/lib/subscribe-throttle';

const THROTTLED_MESSAGE = 'Too many signups from your network — try again in an hour.';

/**
 * Trust order: `x-real-ip` first — Vercel sets this to the actual connecting
 * client IP and it cannot be overridden by request headers. `x-forwarded-for`
 * is only a fallback, and even then only its FIRST token: platforms that
 * append (rather than overwrite) let a client prepend arbitrary values,
 * making the leftmost entry attacker-controlled unless the platform is known
 * to overwrite the whole header.
 */
async function clientIp(): Promise<string> {
  const headerList = await headers();
  const realIp = headerList.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function subscribeAction(
  _prev: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  // Honeypot: bots fill the invisible field; respond exactly like success, store nothing.
  // Field name "hp_field" is deliberately meaningless to autofill heuristics.
  if (formData.get('hp_field')) return { ok: true, message: SUBSCRIBE_SUCCESS_MESSAGE };
  const { allowed } = await registerAttempt(db, await clientIp());
  if (!allowed) return { ok: false, message: THROTTLED_MESSAGE };
  return subscribeWithDb(db, { email: formData.get('email'), source: formData.get('source') });
}
