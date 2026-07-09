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

async function clientIp(): Promise<string> {
  const headerList = await headers();
  return headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function subscribeAction(
  _prev: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  // Honeypot: bots fill the invisible field; respond exactly like success, store nothing.
  if (formData.get('company')) return { ok: true, message: SUBSCRIBE_SUCCESS_MESSAGE };
  const { allowed } = await registerAttempt(db, await clientIp());
  if (!allowed) return { ok: false, message: THROTTLED_MESSAGE };
  return subscribeWithDb(db, { email: formData.get('email'), source: formData.get('source') });
}
