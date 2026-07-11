'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { VenueActionState } from '@/app/actions/admin-venues';

const initialState: VenueActionState = { ok: false, message: '' };

interface VenueProposalCardProps {
  suggestionId: string;
  keepName: string;
  keepEventCount: number;
  absorbName: string;
  absorbEventCount: number;
  confidence: number;
  rationale: string;
  applyAction: (prev: VenueActionState, formData: FormData) => Promise<VenueActionState>;
  dismissAction: (prev: VenueActionState, formData: FormData) => Promise<VenueActionState>;
}

export function VenueProposalCard({
  suggestionId,
  keepName,
  keepEventCount,
  absorbName,
  absorbEventCount,
  confidence,
  rationale,
  applyAction,
  dismissAction,
}: VenueProposalCardProps) {
  const [applyState, applyFormAction, applyPending] = useActionState(applyAction, initialState);
  const [dismissState, dismissFormAction, dismissPending] = useActionState(dismissAction, initialState);
  const pending = applyPending || dismissPending;
  const confirmMessage = `Merge these venues? ${absorbName} is deleted, its name becomes an alias, and ${absorbEventCount} events repoint. This cannot be undone.`;
  return (
    <div className="grid gap-2 border-[3px] border-ink bg-cream-raised p-3">
      <p className="text-sm text-ink">
        <strong>Keep</strong> {keepName} ({keepEventCount} events) ← <strong>absorb</strong> {absorbName} ({absorbEventCount} events)
      </p>
      <p className="text-sm text-ink-muted">{Math.round(confidence * 100)}% confidence — {rationale}</p>
      <div className="flex flex-wrap gap-2">
        <form action={applyFormAction} onSubmit={(e) => { if (!window.confirm(confirmMessage)) e.preventDefault(); }}>
          <input type="hidden" name="suggestionId" value={suggestionId} />
          <Button type="submit" disabled={pending}>{applyPending ? 'Merging…' : 'Apply'}</Button>
        </form>
        <form action={dismissFormAction}>
          <input type="hidden" name="suggestionId" value={suggestionId} />
          <Button type="submit" variant="outline" disabled={pending}>{dismissPending ? 'Dismissing…' : 'Dismiss'}</Button>
        </form>
      </div>
      {applyState.message && !applyState.ok ? <p role="status" className="text-sm text-rm-red">{applyState.message}</p> : null}
      {dismissState.message && !dismissState.ok ? <p role="status" className="text-sm text-rm-red">{dismissState.message}</p> : null}
    </div>
  );
}
