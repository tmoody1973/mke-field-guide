'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { importConcertPicksAction, previewConcertPicksAction, type ConcertPicksState } from '@/app/actions/concert-picks-actions';

/** Preview this week's MKE Concert Picks against the event guide, then import the matches as staff picks. */
export function ConcertPicksPanel() {
  const [state, setState] = useState<ConcertPicksState | null>(null);
  const [pending, start] = useTransition();
  const go = (action: () => Promise<ConcertPicksState>) => start(async () => setState(await action()));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => go(previewConcertPicksAction)}>
          {pending ? 'Working…' : "Preview this week's Concert Picks"}
        </Button>
        {state?.result && !state.imported && state.result.matched.length > 0 ? (
          <Button type="button" disabled={pending} onClick={() => go(importConcertPicksAction)}>Import {state.result.matched.length} picks</Button>
        ) : null}
      </div>
      {state ? <p role="status" className={`text-sm ${state.ok ? 'text-ink' : 'text-rm-red'}`}>{state.title ? `${state.title}: ` : ''}{state.message}</p> : null}
      {state?.result ? (
        <div className="grid gap-2 text-sm">
          <details open>
            <summary className="font-semibold">Matched ({state.result.matched.length})</summary>
            <ul className="list-disc pl-5">{state.result.matched.map((m) => <li key={m.line}>{m.line} → {m.title}</li>)}</ul>
          </details>
          <details open>
            <summary className="font-semibold">In Concert Picks, not in the event guide ({state.result.unmatched.length})</summary>
            <ul className="list-disc pl-5">{state.result.unmatched.map((line) => <li key={line}>{line}</li>)}</ul>
          </details>
        </div>
      ) : null}
    </div>
  );
}
