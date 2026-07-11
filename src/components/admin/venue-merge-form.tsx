'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { VenueActionState } from '@/app/actions/admin-venues';

const initialState: VenueActionState = { ok: false, message: '' };

interface VenueOption {
  venueId: string;
  name: string;
  eventCount: number;
}

interface VenueMergeFormProps {
  venues: VenueOption[];
  mergeAction: (prev: VenueActionState, formData: FormData) => Promise<VenueActionState>;
}

export function VenueMergeForm({ venues, mergeAction }: VenueMergeFormProps) {
  const [state, formAction, pending] = useActionState(mergeAction, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            'Absorb the second venue into the first? Its page is deleted and its name becomes an alias. This cannot be undone.',
          )
        ) {
          event.preventDefault();
        }
      }}
      className="grid gap-2 border-t-[3px] border-ink pt-3"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm text-ink">
          Keep
          <select name="keepId" required className="rounded border-2 bg-input px-2 py-2 text-sm">
            <option value="">Select a venue…</option>
            {venues.map((venue) => (
              <option key={venue.venueId} value={venue.venueId}>
                {venue.name} ({venue.eventCount} events)
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-ink">
          Absorb
          <select name="absorbId" required className="rounded border-2 bg-input px-2 py-2 text-sm">
            <option value="">Select a venue…</option>
            {venues.map((venue) => (
              <option key={venue.venueId} value={venue.venueId}>
                {venue.name} ({venue.eventCount} events)
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Merging…' : 'Merge venues'}
        </Button>
      </div>
      {state.message ? (
        <p role="status" className={`text-sm ${state.ok ? 'text-ink' : 'text-rm-red'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
