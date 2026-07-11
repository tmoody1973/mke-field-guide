'use client';

import { useActionState } from 'react';
import type { EventActionState } from '@/app/actions/admin-events';
import { Button } from '@/components/ui/button';

const initialState: EventActionState = { ok: false, message: '' };

interface TitleSuggestionBannerProps {
  eventId: string;
  suggestion: string;
  applyAction: (prev: EventActionState, formData: FormData) => Promise<EventActionState>;
  dismissAction: (prev: EventActionState, formData: FormData) => Promise<EventActionState>;
}

export function TitleSuggestionBanner({
  eventId,
  suggestion,
  applyAction,
  dismissAction,
}: TitleSuggestionBannerProps) {
  const [applyState, applyFormAction, applyPending] = useActionState(applyAction, initialState);
  const [dismissState, dismissFormAction, dismissPending] = useActionState(dismissAction, initialState);
  const pending = applyPending || dismissPending;
  return (
    <div className="grid gap-2 border-[3px] border-ink bg-cream-raised p-3">
      <p className="text-sm text-ink">AI suggests: &ldquo;{suggestion}&rdquo;</p>
      <div className="flex flex-wrap gap-2">
        <form
          action={applyFormAction}
          onSubmit={(event) => {
            if (!window.confirm('Apply this title? It will be locked against re-ingestion.'))
              event.preventDefault();
          }}
        >
          <input type="hidden" name="eventId" value={eventId} />
          <Button type="submit" disabled={pending}>
            {applyPending ? 'Applying…' : 'Apply'}
          </Button>
        </form>
        <form action={dismissFormAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <Button type="submit" variant="outline" disabled={pending}>
            {dismissPending ? 'Dismissing…' : 'Dismiss'}
          </Button>
        </form>
      </div>
      {applyState.message && !applyState.ok ? (
        <p role="status" className="text-sm text-rm-red">{applyState.message}</p>
      ) : null}
      {dismissState.message && !dismissState.ok ? (
        <p role="status" className="text-sm text-rm-red">{dismissState.message}</p>
      ) : null}
    </div>
  );
}
