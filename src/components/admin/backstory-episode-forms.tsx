'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { BackstoryActionState } from '@/app/actions/admin-backstory';
import {
  approveEpisodeAction, setDoNotUseAction, setNeighborhoodAction, setSpeakerNameAction,
} from '@/app/actions/admin-backstory-actions';
import { clipSrc } from '@/lib/backstory-types';
import { NEIGHBORHOODS } from '@/lib/neighborhoods';

const initial: BackstoryActionState = { ok: false, message: '' };

function Status({ state }: { state: BackstoryActionState }) {
  if (!state.message) return null;
  return <p role="status" className={`text-sm ${state.ok ? 'text-ink' : 'text-rm-red'}`}>{state.message}</p>;
}

const CONFIRM_APPROVE =
  'Approve this episode? Everything you did not reject becomes available to Alexa. Places with uncertain map pins stay off until you approve them.';

export function ApproveEpisodeForm({ storyId, runId, defaultSummary, alreadyLive, notReady }: {
  storyId: string; runId: string; defaultSummary: string; alreadyLive: boolean; notReady: boolean;
}) {
  const [state, action, pending] = useActionState(approveEpisodeAction, initial);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(CONFIRM_APPROVE)) event.preventDefault();
      }}
      className="grid gap-2"
    >
      <input type="hidden" name="storyId" value={storyId} />
      <input type="hidden" name="runId" value={runId} />
      <label className="grid gap-1 text-sm text-ink">
        Summary listeners will hear
        <textarea name="summary" defaultValue={defaultSummary} maxLength={1500} rows={5} required className="border-[3px] border-ink bg-white p-2" />
      </label>
      <div>
        <Button type="submit" disabled={pending || notReady}>{pending ? 'Approving…' : alreadyLive ? 'Approve this version' : 'Approve episode'}</Button>
      </div>
      {notReady ? <p className="text-sm text-ink-muted">Still finding map pins for this episode. Reload in a minute to approve.</p> : null}
      <Status state={state} />
    </form>
  );
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
      {/* preload="none": an episode can have a dozen speakers; nothing downloads until Play is pressed */}
      <audio controls preload="none" src={clipSrc(audioUrl, startMs, endMs)} aria-label={`Play ${label}'s first line`} className="h-8 w-full max-w-sm" />
      <div className="flex flex-wrap gap-2">
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
      <Button type="submit" size="sm" variant="outline" disabled={pending}>{doNotUse ? 'Allow assistant use' : 'Do not use'}</Button>
      {state.message && !state.ok ? <span role="status" className="text-sm text-rm-red">{state.message}</span> : null}
    </form>
  );
}
