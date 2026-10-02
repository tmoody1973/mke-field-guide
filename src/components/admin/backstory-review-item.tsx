'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { decideItemAction } from '@/app/actions/admin-backstory-actions';
import { ATTENTION_COPY, clock, REASON_COPY, type RemoveReason, type ReviewItem } from '@/lib/backstory-review';
import { useAnnouncedAction } from './backstory-announcer';
import { ClipButton } from './backstory-clip-button';
import { LocationForm, NeighborhoodForm, RenameForm } from './backstory-episode-forms';

const CLIP_MS = 12_000; // quotes carry a start time only; twelve seconds covers a quote and its context

function statusView(item: ReviewItem) {
  if (item.status === 'approved') return { icon: '✓', text: 'Kept' };
  if (item.status === 'rejected') return { icon: '✕', text: `Removed: ${REASON_COPY[item.removeReason ?? 'wrong']}` };
  return { icon: '○', text: item.attention ? 'Needs your decision' : 'Not checked (kept when you publish)' };
}

export function ReviewItemCard({ storyId, item }: { storyId: string; item: ReviewItem }) {
  const [state, action, pending] = useAnnouncedAction(decideItemAction, item.title);
  const [choosing, setChoosing] = useState(false);
  const removed = item.status === 'rejected';
  const status = statusView(item);

  const decide = (next: ReviewItem['status'], label: string, ariaLabel: string, opts: { reason?: RemoveReason; variant?: 'outline'; dataAction?: string; autoFocus?: boolean } = {}) => (
    <form action={action} onSubmit={() => setChoosing(false)}>
      <input type="hidden" name="storyId" value={storyId} />
      <input type="hidden" name="table" value={item.table} />
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="status" value={next} />
      {opts.reason ? <input type="hidden" name="reason" value={opts.reason} /> : null}
      <Button type="submit" size="sm" variant={opts.variant} disabled={pending} aria-label={ariaLabel} data-action={opts.dataAction} autoFocus={opts.autoFocus}>
        {label}
      </Button>
    </form>
  );

  return (
    <article
      data-review-item
      tabIndex={-1}
      aria-labelledby={`${item.key}-title`}
      className={`grid gap-2 border-[3px] border-ink bg-white p-3 focus:outline focus:outline-4 focus:outline-offset-2 focus:outline-ink ${removed ? 'opacity-75' : ''}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 id={`${item.key}-title`} className="font-head text-lg text-ink">{removed ? <s>{item.title}</s> : item.title}</h3>
        <span className="text-sm text-ink-muted">{item.kind}{item.detail ? ` · ${item.table === 'places' && item.hasPin ? '📍 ' : ''}${item.detail}` : ''}</span>
      </div>
      {item.attention ? <p className="text-sm font-medium text-ink"><span aria-hidden="true">⚠ </span>{ATTENTION_COPY[item.attention]}</p> : null}
      <blockquote className="border-l-[3px] border-ink pl-3 text-sm text-ink-muted">
        &ldquo;{item.quote}&rdquo; <span className="whitespace-nowrap">({clock(item.startMs)})</span>
      </blockquote>
      <p className="text-sm text-ink"><span aria-hidden="true">{status.icon} </span>{status.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ClipButton startMs={item.startMs} endMs={item.startMs + CLIP_MS} label={`the quote for ${item.title}`} text="Hear it" />
        {item.status !== 'approved' ? decide('approved', 'Keep', `Keep ${item.title}`, { dataAction: 'keep' }) : null}
        <Button
          type="button" size="sm" variant="outline" data-action="remove" aria-expanded={choosing} aria-controls={`${item.key}-reasons`}
          aria-label={`Remove ${item.title}`} onClick={() => setChoosing((open) => !open)} disabled={pending}
        >
          Remove…
        </Button>
        {item.status !== 'pending' ? decide('pending', 'Undo', `Undo decision on ${item.title}`, { variant: 'outline' }) : null}
      </div>
      {choosing ? (
        <div id={`${item.key}-reasons`} role="group" aria-label={`Why remove ${item.title}?`} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink">Why?</span>
          {decide('rejected', REASON_COPY.wrong, `Remove ${item.title}: wrong`, { reason: 'wrong', variant: 'outline', autoFocus: true })}
          {decide('rejected', REASON_COPY.sensitive, `Remove ${item.title}: true, but keep off Alexa`, { reason: 'sensitive', variant: 'outline' })}
          {decide('rejected', REASON_COPY.minor, `Remove ${item.title}: too minor`, { reason: 'minor', variant: 'outline' })}
        </div>
      ) : null}
      {state.message && !state.ok ? <p role="alert" className="text-sm text-rm-red">{state.message}</p> : null}
      {item.renameMentionId || item.canLocate || item.placeId ? (
        <div className="grid gap-1">
          {item.renameMentionId ? <RenameForm storyId={storyId} mentionId={item.renameMentionId} name={item.title} /> : null}
          {item.canLocate && item.renameMentionId ? (
            <LocationForm storyId={storyId} mentionId={item.renameMentionId} category={item.category} hasPin={item.hasPin} subject={item.title} />
          ) : null}
          {item.placeId ? <NeighborhoodForm storyId={storyId} placeId={item.placeId} neighborhood={item.neighborhood} /> : null}
        </div>
      ) : null}
    </article>
  );
}
