'use client';

import { useActionState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { VenueActionState } from '@/app/actions/admin-venues';

const initialState: VenueActionState = { ok: false, message: '' };

interface ProposalProvenanceProps {
  source: 'llm' | 'registry';
  confidence: number;
  registryName: string | null;
}

function ProposalProvenance({ source, confidence, registryName }: ProposalProvenanceProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-muted">{Math.round(confidence * 100)}% confidence</span>
      <Badge variant="secondary">{source === 'registry' ? 'Registry match' : 'AI proposal'}</Badge>
      {registryName ? <span className="text-sm text-ink-muted">Registry entity: {registryName}</span> : null}
    </div>
  );
}

interface VenueProposalCardProps {
  suggestionId: string;
  keepName: string;
  keepEventCount: number;
  absorbName: string;
  absorbEventCount: number;
  confidence: number;
  rationale: string;
  source?: 'llm' | 'registry';
  registryName?: string | null;
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
  source = 'llm',
  registryName = null,
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
      <ProposalProvenance source={source} confidence={confidence} registryName={registryName} />
      <p className="text-sm text-ink-muted">{rationale}</p>
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
