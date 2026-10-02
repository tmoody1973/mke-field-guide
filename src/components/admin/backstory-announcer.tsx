'use client';

import { createContext, useActionState, useContext, useState, type ReactNode } from 'react';
import { announcement } from '@/lib/backstory-review';

type Announcement = { ok: boolean; text: string };
const Context = createContext<(a: Announcement) => void>(() => {});
const Latest = createContext<Announcement | null>(null);

/** Holds the latest save confirmation at page level, so it survives an item moving between sections. */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [latest, setLatest] = useState<Announcement | null>(null);
  return (
    <Context.Provider value={setLatest}>
      <Latest.Provider value={latest}>{children}</Latest.Provider>
    </Context.Provider>
  );
}

type ActionState = { ok: boolean; message: string };

/**
 * useActionState for a review form whose result is also announced at page level. The announcement is made when the
 * result arrives, not in an effect, because a save can move the card to another section and unmount it in the same commit.
 */
export function useAnnouncedAction(
  serverAction: (prev: ActionState, formData: FormData) => Promise<ActionState>,
  subject: string,
) {
  const announce = useContext(Context);
  return useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await serverAction(prev, formData);
    const next = announcement(subject, result);
    if (next) announce(next);
    return result;
  }, { ok: false, message: '' });
}

export function AnnouncementLine() {
  const latest = useContext(Latest);
  return (
    <p role="status" aria-live="polite" className={`w-full text-sm ${latest && !latest.ok ? 'text-rm-red' : 'text-ink'}`}>
      {latest?.text ?? ''}
    </p>
  );
}
