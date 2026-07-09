'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AdminPickState } from '@/app/actions/admin-picks';

const initialState: AdminPickState = { ok: false, message: '' };

interface PickFormProps {
  action: (prev: AdminPickState, formData: FormData) => Promise<AdminPickState>;
  defaults: {
    curatorName?: string;
    curatorRole?: string | null;
    showUrl?: string | null;
    blurb?: string;
    weekOf: string;
    sortOrder?: number;
  };
  eventId?: string;
  submitLabel: string;
}

export function PickForm({ action, defaults, eventId, submitLabel }: PickFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="grid max-w-xl gap-3">
      {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}
      <label className="grid gap-1 text-sm font-medium text-ink">
        Curator
        <Input name="curatorName" defaultValue={defaults.curatorName ?? ''} required maxLength={120} />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink">
        Curator role (optional — e.g. “HYFIN, middays”)
        <Input name="curatorRole" defaultValue={defaults.curatorRole ?? ''} maxLength={120} />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink">
        Show URL (optional)
        <Input name="showUrl" type="url" defaultValue={defaults.showUrl ?? ''} maxLength={300} />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink">
        Blurb
        <textarea
          name="blurb"
          defaultValue={defaults.blurb ?? ''}
          required
          maxLength={600}
          rows={4}
          className="border-[3px] border-ink bg-cream-raised px-3 py-2 font-sans text-ink"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm font-medium text-ink">
          Week of (a Monday)
          <Input name="weekOf" defaultValue={defaults.weekOf} required pattern="\d{4}-\d{2}-\d{2}" />
        </label>
        <label className="grid gap-1 text-sm font-medium text-ink">
          Sort order
          <Input name="sortOrder" type="number" min={0} max={99} defaultValue={defaults.sortOrder ?? 0} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        {state.message && !state.ok ? (
          <p role="status" className="text-sm text-rm-red">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
