'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { BackstoryActionState } from '@/app/actions/admin-backstory';
import {
  pinLocationAction, renameMentionAction, setDoNotUseAction, setNeighborhoodAction, setSpeakerNameAction,
} from '@/app/actions/admin-backstory-actions';
import { PLACE_CATEGORIES } from '@/app/actions/admin-backstory';
import { ClipButton } from './backstory-clip-button';
import { NEIGHBORHOODS } from '@/lib/neighborhoods';

const initial: BackstoryActionState = { ok: false, message: '' };

function Status({ state }: { state: BackstoryActionState }) {
  if (!state.message) return null;
  return <p role="status" className={`text-sm ${state.ok ? 'text-ink' : 'text-rm-red'}`}>{state.message}</p>;
}

export function SpeakerNameForm({ storyId, label, name, sample, audioUrl, startMs, endMs }: {
  storyId: string; label: string; name: string | null; sample: string; audioUrl: string; startMs: number; endMs: number;
}) {
  const [state, action, pending] = useActionState(setSpeakerNameAction, initial);
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="storyId" value={storyId} />
      <input type="hidden" name="label" value={label} />
      <p className="text-sm text-ink-muted">{label}: &ldquo;{sample}&rdquo;</p>
      <div className="flex flex-wrap gap-2">
        <ClipButton audioUrl={audioUrl} startMs={startMs} endMs={endMs} label={`${label}'s first line`} />
        <input name="name" defaultValue={name ?? ''} maxLength={80} placeholder="Unknown speaker" className="border-[3px] border-ink bg-white px-2 py-1" />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>Save</Button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function NeighborhoodForm({ storyId, placeId, neighborhood }: { storyId: string; placeId: string; neighborhood: string | null }) {
  const [state, action, pending] = useActionState(setNeighborhoodAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="storyId" value={storyId} />
      <input type="hidden" name="placeId" value={placeId} />
      <select name="neighborhood" defaultValue={neighborhood ?? ''} aria-label="Neighborhood" className="border-[3px] border-ink bg-white px-2 py-1 text-sm">
        <option value="">No neighborhood</option>
        {NEIGHBORHOODS.map((n) => <option key={n.slug} value={n.name}>{n.name}</option>)}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>Save</Button>
      <Status state={state} />
    </form>
  );
}

export function DoNotUseToggle({ storyId, table, id, doNotUse }: {
  storyId: string; table: 'stories' | 'mentions'; id: string; doNotUse: boolean;
}) {
  const [state, action, pending] = useActionState(setDoNotUseAction, initial);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="storyId" value={storyId} />
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="doNotUse" value={String(!doNotUse)} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>{doNotUse ? 'Allow on Alexa' : (table === 'stories' ? 'Keep episode off Alexa' : 'Keep off Alexa')}</Button>
      {state.message && !state.ok ? <span role="status" className="text-sm text-rm-red">{state.message}</span> : null}
    </form>
  );
}

export function LocationForm({ storyId, mentionId, category, hasPin }: {
  storyId: string; mentionId: string; category: string; hasPin: boolean;
}) {
  const [state, action, pending] = useActionState(pinLocationAction, initial);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-ink underline">{hasPin ? 'Correct location' : 'Add location'}</summary>
      <form action={action} className="mt-2 grid gap-2">
        <input type="hidden" name="storyId" value={storyId} />
        <input type="hidden" name="mentionId" value={mentionId} />
        <input name="address" required minLength={5} maxLength={200} placeholder="8004 W National Ave, West Allis, WI 53214" aria-label="Street address" className="border-[3px] border-ink bg-white px-2 py-1" />
        <div className="flex flex-wrap items-center gap-2">
          <select name="category" defaultValue={PLACE_CATEGORIES.includes(category as never) ? category : 'venue'} aria-label="Category" className="border-[3px] border-ink bg-white px-2 py-1">
            {PLACE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Button type="submit" size="sm" disabled={pending}>{pending ? 'Finding…' : 'Find and pin'}</Button>
        </div>
        <p className="text-ink-muted">Public places only, never someone&rsquo;s home.</p>
        <Status state={state} />
      </form>
    </details>
  );
}

export function RenameForm({ storyId, mentionId, name }: { storyId: string; mentionId: string; name: string }) {
  const [state, action, pending] = useActionState(renameMentionAction, initial);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-ink underline">Fix spelling</summary>
      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="storyId" value={storyId} />
        <input type="hidden" name="mentionId" value={mentionId} />
        <input name="name" defaultValue={name} required maxLength={120} aria-label="Correct spelling" className="border-[3px] border-ink bg-white px-2 py-1" />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>Save</Button>
        <Status state={state} />
      </form>
    </details>
  );
}
