'use client';

import { useActionState } from 'react';
import type { EventActionState } from '@/app/actions/admin-events';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const initialState: EventActionState = { ok: false, message: '' };
const STATUS_VALUES = ['scheduled', 'cancelled', 'postponed'] as const;

// Matches ui/input.tsx's own classes so native <select> reads as part of the same control set
// (no shadcn Select here — its Radix trigger has no bare `name` attribute for FormData).
const selectClass =
  'h-8 w-full min-w-0 rounded border-2 bg-input px-3 py-2 text-sm shadow-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

interface EventEditFormProps {
  event: {
    eventId: string;
    title: string;
    status: string;
    category: string | null;
    venueId: string | null;
    lockedFields: string[];
  };
  categories: readonly string[]; // pass CATEGORY_VALUES down from the RSC (tag.ts is server-side)
  venues: { id: string; name: string }[];
  action: (prev: EventActionState, formData: FormData) => Promise<EventActionState>;
}

function LockBadge({ locked }: { locked: boolean }) {
  return locked ? <Badge variant="outline">🔒 locked</Badge> : null;
}

export function EventEditForm({ event, categories, venues, action }: EventEditFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const locked = new Set(event.lockedFields);
  return (
    <form action={formAction} className="grid max-w-xl gap-3">
      <input type="hidden" name="eventId" value={event.eventId} />
      <label className="grid gap-1 text-sm text-ink">
        <span className="flex items-center gap-2">Title <LockBadge locked={locked.has('title')} /></span>
        <Input name="title" defaultValue={event.title} required maxLength={300} />
      </label>
      <label className="grid gap-1 text-sm text-ink">
        <span className="flex items-center gap-2">Status <LockBadge locked={locked.has('status')} /></span>
        <select name="status" defaultValue={event.status} className={selectClass}>
          {STATUS_VALUES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-ink">
        Category
        <select name="category" defaultValue={event.category ?? ''} className={selectClass}>
          <option value="">— untagged —</option>
          {categories.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-ink">
        <span className="flex items-center gap-2">Venue <LockBadge locked={locked.has('venue')} /></span>
        <select name="venueId" defaultValue={event.venueId ?? ''} className={selectClass}>
          <option value="">— no venue —</option>
          {venues.map((venue) => (
            <option key={venue.id} value={venue.id}>{venue.name}</option>
          ))}
        </select>
      </label>
      <div>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button>
      </div>
      {state.message ? (
        <p role="status" className={`text-sm ${state.ok ? 'text-ink-muted' : 'text-rm-red'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
