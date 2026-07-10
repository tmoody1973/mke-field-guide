'use client';

import { useActionState } from 'react';
import type { EventActionState } from '@/app/actions/admin-events';
import { Button } from '@/components/ui/button';

const initialState: EventActionState = { ok: false, message: '' };

interface UnlockButtonProps {
  eventId: string;
  field: string;
  action: (prev: EventActionState, formData: FormData) => Promise<EventActionState>;
}

export function UnlockButton({ eventId, field, action }: UnlockButtonProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Source values will overwrite ${field} on the next ingest. Unlock?`))
          event.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="field" value={field} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Unlocking…' : `Unlock ${field}`}
      </Button>
      {state.message && !state.ok ? (
        <p role="status" className="text-sm text-rm-red">{state.message}</p>
      ) : null}
    </form>
  );
}
