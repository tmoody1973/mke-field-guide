'use client';

import { useActionState } from 'react';
import type { EventActionState } from '@/app/actions/admin-events';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { chicagoParts, chicagoWallTimeToIso } from '@/lib/chicago-time';

const initialState: EventActionState = { ok: false, message: '' };

/** UTC ISO instant → Chicago wall-clock string for <input type="datetime-local">. */
function toChicagoLocalValue(iso: string): string {
  const p = chicagoParts(Date.parse(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Chicago wall-clock 'YYYY-MM-DDTHH:mm' → UTC ISO instant (DST-aware); '' passes through. */
function toIsoInstant(local: string): string {
  if (!local) return '';
  const [datePart, timePart] = local.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  return chicagoWallTimeToIso(year, month, day, hour, minute);
}

interface InstanceTimeFormProps {
  instance: { instanceId: string; startAt: string; endAt: string | null; status: string };
  action: (prev: EventActionState, formData: FormData) => Promise<EventActionState>;
}

export function InstanceTimeForm({ instance, action }: InstanceTimeFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // datetime-local values are Chicago wall clock; the server accepts only UTC ISO.
        const form = event.currentTarget;
        const start = form.elements.namedItem('startLocal') as HTMLInputElement;
        const end = form.elements.namedItem('endLocal') as HTMLInputElement;
        (form.elements.namedItem('startAt') as HTMLInputElement).value = toIsoInstant(start.value);
        (form.elements.namedItem('endAt') as HTMLInputElement).value = toIsoInstant(end.value);
      }}
      className="flex flex-wrap items-end gap-2 border-t-[3px] border-ink pt-3"
    >
      <input type="hidden" name="instanceId" value={instance.instanceId} />
      <input type="hidden" name="startAt" />
      <input type="hidden" name="endAt" />
      <label className="grid gap-1 text-sm text-ink">
        Starts (Chicago)
        <Input
          type="datetime-local"
          name="startLocal"
          defaultValue={toChicagoLocalValue(instance.startAt)}
          required
        />
      </label>
      <label className="grid gap-1 text-sm text-ink">
        Ends (optional)
        <Input
          type="datetime-local"
          name="endLocal"
          defaultValue={instance.endAt ? toChicagoLocalValue(instance.endAt) : ''}
        />
      </label>
      {instance.status !== 'scheduled' ? <span className="text-sm text-ink-muted">({instance.status})</span> : null}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Saving…' : 'Save time'}
      </Button>
      {state.message ? (
        <p role="status" className={`text-sm ${state.ok ? 'text-ink-muted' : 'text-rm-red'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
