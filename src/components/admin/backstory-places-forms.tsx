'use client';

import { Button } from '@/components/ui/button';
import { fetchDetailsAction, setPlaceDetailsAction } from '@/app/actions/admin-backstory-actions';
import { NEIGHBORHOODS } from '@/lib/neighborhoods';
import { useAnnouncedAction } from './backstory-announcer';
import { Status } from './backstory-episode-forms';

/** Neighborhood for one place, saved in every episode it appears in. */
export function PlaceNeighborhoodForm({ placeKey, neighborhood, name }: { placeKey: string; neighborhood: string | null; name: string }) {
  const [state, action, pending] = useAnnouncedAction(setPlaceDetailsAction, `${name} neighborhood`);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="key" value={placeKey} />
      <select name="neighborhood" defaultValue={neighborhood ?? ''} aria-label={`Neighborhood for ${name}`} className="border-[3px] border-ink bg-white px-2 py-1 text-sm">
        <option value="">No neighborhood</option>
        {NEIGHBORHOODS.map((n) => <option key={n.slug} value={n.name}>{n.name}</option>)}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>Save</Button>
      <Status state={state} />
    </form>
  );
}

/** A restaurant's booking page, saved in every episode: Alexa's card shows Reserve. */
export function PlaceReservationForm({ placeKey, url, name }: { placeKey: string; url: string | null; name: string }) {
  const [state, action, pending] = useAnnouncedAction(setPlaceDetailsAction, `${name} reservation link`);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="key" value={placeKey} />
      <input name="reservationUrl" type="url" defaultValue={url ?? ''} maxLength={500} placeholder="https://www.opentable.com/r/…" aria-label={`Reservation link for ${name}`} className="min-w-0 flex-1 border-[3px] border-ink bg-white px-2 py-1 text-sm" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>Save</Button>
      <Status state={state} />
    </form>
  );
}

/** Phone, website and hours from Amazon Location (about half a cent), saved in every episode. */
export function FetchDetailsButton({ placeKey, name, fetched }: { placeKey: string; name: string; fetched: boolean }) {
  const [state, action, pending] = useAnnouncedAction(fetchDetailsAction, `${name} details`);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="key" value={placeKey} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? 'Fetching…' : fetched ? 'Refresh details' : 'Fetch details'}</Button>
      <Status state={state} />
    </form>
  );
}
