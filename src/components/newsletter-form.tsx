'use client';

import { useActionState } from 'react';
import { subscribeAction } from '@/app/actions/newsletter';
import type { SubscribeState } from '@/app/actions/subscribe';

const initialState: SubscribeState = { ok: false, message: '' };

export function NewsletterForm({ source }: { source: string }) {
  const [state, formAction, pending] = useActionState(subscribeAction, initialState);
  return (
    <form action={formAction} className="flex w-full min-w-0 flex-1 flex-col gap-2.5 sm:w-auto sm:min-w-[280px] sm:max-w-[360px]">
      <input type="hidden" name="source" value={source} />
      <input
        type="text"
        name="hp_field"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="sr-only"
      />
      <div className="flex border-[3px] border-ink bg-cream shadow-[4px_4px_0_#1F2528]">
        <input
          type="email"
          name="email"
          required
          placeholder="you@milwaukee.com"
          aria-label="Email address"
          className="min-w-0 flex-1 bg-transparent px-3.5 py-[13px] text-base font-semibold text-ink outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="flex items-center border-l-[3px] border-ink bg-rm-orange px-[18px] font-head text-base text-ink hover:bg-ink hover:text-rm-orange disabled:opacity-60"
        >
          {pending ? '…' : 'JOIN'}
        </button>
      </div>
      <span aria-live="polite" className="min-h-4 text-xs font-bold text-cream">
        {state.message}
      </span>
    </form>
  );
}
