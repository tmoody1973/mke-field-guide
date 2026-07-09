'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { ReviewActionState } from '@/app/actions/admin-reviews';

const initialState: ReviewActionState = { ok: false, message: '' };

interface ReviewDecisionFormProps {
  reviewId: string;
  suggestedSurvivorId: string;
  sides: { eventId: string; title: string }[];
  approveAction: (prev: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;
  rejectAction: (prev: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;
}

export function ReviewDecisionForm({
  reviewId,
  suggestedSurvivorId,
  sides,
  approveAction,
  rejectAction,
}: ReviewDecisionFormProps) {
  const [approveState, approveFormAction, approvePending] = useActionState(approveAction, initialState);
  const [rejectState, rejectFormAction, rejectPending] = useActionState(rejectAction, initialState);
  const pending = approvePending || rejectPending;
  return (
    <div className="grid gap-2 border-t-[3px] border-ink pt-3">
      <form
        action={approveFormAction}
        onSubmit={(event) => {
          if (!window.confirm('Merge these two events? This cannot be undone.')) event.preventDefault();
        }}
        className="grid gap-2"
      >
        <input type="hidden" name="reviewId" value={reviewId} />
        <fieldset className="grid gap-1">
          <legend className="text-sm font-medium text-ink">Survivor (keeps its page and data)</legend>
          {sides.map((side) => (
            <label key={side.eventId} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="survivorEventId"
                value={side.eventId}
                defaultChecked={side.eventId === suggestedSurvivorId}
                required
              />
              Keep &ldquo;{side.title}&rdquo;
            </label>
          ))}
        </fieldset>
        <div>
          <Button type="submit" disabled={pending}>
            {approvePending ? 'Merging…' : 'Approve merge'}
          </Button>
        </div>
      </form>
      <form action={rejectFormAction}>
        <input type="hidden" name="reviewId" value={reviewId} />
        <Button type="submit" variant="outline" disabled={pending}>
          {rejectPending ? 'Saving…' : 'Not a duplicate'}
        </Button>
      </form>
      {approveState.message && !approveState.ok ? (
        <p role="status" className="text-sm text-rm-red">{approveState.message}</p>
      ) : null}
      {rejectState.message && !rejectState.ok ? (
        <p role="status" className="text-sm text-rm-red">{rejectState.message}</p>
      ) : null}
    </div>
  );
}
