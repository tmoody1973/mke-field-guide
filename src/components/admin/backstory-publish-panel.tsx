'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { BackstoryActionState } from '@/app/actions/admin-backstory';
import { approveEpisodeAction } from '@/app/actions/admin-backstory-actions';
import type { publishPreview } from '@/lib/backstory-review';
import { AnnouncementLine } from './backstory-announcer';
import { EpisodePlayerBar } from './backstory-episode-audio';

const initial: BackstoryActionState = { ok: false, message: '' };

interface Props {
  storyId: string;
  runId: string;
  summary: string;
  attribution: string;
  preview: ReturnType<typeof publishPreview>;
  counts: { needsYou: number; kept: number; removed: number; unchecked: number };
  notReady: boolean;
  alreadyLive: boolean;
}

function shareList(p: Props['preview']) {
  const parts = [
    [p.people, 'people'], [p.organizations, 'organizations and other names'], [p.places, 'places'], [p.topics, 'topics'], [p.actions, 'actions'],
  ] as const;
  return ['the summary', ...parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`)].join(', ');
}

/** "What Alexa will say" at the top of the page, and a publish bar that stays on screen while you review. */
export function PublishPanel({ storyId, runId, summary, attribution, preview, counts, notReady, alreadyLive }: Props) {
  const [state, action, pending] = useActionState(approveEpisodeAction, initial);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <section aria-labelledby="alexa-preview" className="grid gap-2 border-[3px] border-ink bg-white p-4">
        <h2 id="alexa-preview" className="font-head text-2xl text-ink">What Alexa will say</h2>
        <form id="publish-form" action={action} onSubmit={() => setConfirming(false)} className="grid gap-1">
          <input type="hidden" name="storyId" value={storyId} />
          <input type="hidden" name="runId" value={runId} />
          <label htmlFor="summary" className="text-sm text-ink-muted">Summary (edit it if anything is off)</label>
          <textarea id="summary" name="summary" defaultValue={summary} maxLength={1500} rows={4} required className="border-[3px] border-ink bg-cream p-2 text-ink" />
        </form>
        {attribution ? <p className="text-sm text-ink-muted">&mdash; {attribution}</p> : null}
        {/* Also in the page itself: a bar pinned to the window edge is easy to miss, and once was covered by the site's radio player. */}
        {notReady ? null : (
          <div>
            <Button type="button" onClick={() => setConfirming(true)} disabled={pending || confirming}>
              {alreadyLive ? 'Publish this version' : 'Publish to Alexa'}
            </Button>
          </div>
        )}
      </section>

      <div role="region" aria-label="Episode audio and publishing" className="fixed inset-x-0 bottom-0 z-10 border-t-[3px] border-ink bg-cream px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <EpisodePlayerBar />
          <AnnouncementLine />
          <p className="text-sm text-ink" aria-live="polite">
            <strong>{counts.needsYou}</strong> need you · {counts.kept} kept · {counts.removed} removed · {counts.unchecked} not checked
          </p>
          {notReady ? (
            <p className="text-sm text-ink-muted">Still finding map pins. Reload in a minute to publish.</p>
          ) : confirming ? (
            <>
              <p className="text-sm text-ink">
                Alexa will be able to share {shareList(preview)}.
                {counts.needsYou > 0 ? ' Unpinned places stay off until you add a location.' : ''}
              </p>
              <Button type="submit" form="publish-form" disabled={pending} autoFocus>{pending ? 'Publishing…' : 'Confirm publish'}</Button>
              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            </>
          ) : (
            <Button type="button" onClick={() => setConfirming(true)} disabled={pending}>
              {alreadyLive ? 'Publish this version' : 'Publish to Alexa'}
            </Button>
          )}
          {state.message ? (
            <p role="status" className={`text-sm ${state.ok ? 'text-ink' : 'text-rm-red'}`}>{state.message}</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
