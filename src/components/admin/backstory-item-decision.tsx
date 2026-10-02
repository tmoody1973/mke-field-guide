'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { BackstoryActionState } from '@/app/actions/admin-backstory';
import { decideItemAction } from '@/app/actions/admin-backstory-actions';

const initial: BackstoryActionState = { ok: false, message: '' };

interface Props {
  storyId: string;
  table: 'mentions' | 'places' | 'storyTopics' | 'storyActions';
  id: string;
  status: 'pending' | 'approved' | 'rejected';
}

export function BackstoryItemDecision({ storyId, table, id, status }: Props) {
  const [state, action, pending] = useActionState(decideItemAction, initial);
  const button = (next: Props['status'], label: string, variant?: 'outline') => (
    <form action={action}>
      <input type="hidden" name="storyId" value={storyId} />
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={next} />
      <Button type="submit" size="sm" variant={variant} disabled={pending || status === next}>{label}</Button>
    </form>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-muted">{status}</span>
      {button('approved', 'Approve')}
      {button('rejected', 'Reject', 'outline')}
      {status !== 'pending' ? button('pending', 'Undo', 'outline') : null}
      {state.message && !state.ok ? <span role="status" className="text-sm text-rm-red">{state.message}</span> : null}
    </div>
  );
}
