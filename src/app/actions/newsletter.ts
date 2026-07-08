'use server';

import { db } from '@/db';
import { subscribeWithDb, type SubscribeState } from '@/app/actions/subscribe';

export async function subscribeAction(_prev: SubscribeState, formData: FormData): Promise<SubscribeState> {
  return subscribeWithDb(db, { email: formData.get('email'), source: formData.get('source') });
}
