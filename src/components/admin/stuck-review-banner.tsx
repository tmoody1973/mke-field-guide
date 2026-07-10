'use client';

import { useActionState } from 'react';
import type { ReviewActionState } from '@/app/actions/admin-reviews';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { chicagoDateLabel } from '@/lib/display';
import type { StuckReview } from '@/queries/admin-reviews';

const initialState: ReviewActionState = { ok: false, message: '' };

type ReturnStuckAction = (prev: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;

function StuckReviewRow({ review, returnAction }: { review: StuckReview; returnAction: ReturnStuckAction }) {
  const [state, formAction, pending] = useActionState(returnAction, initialState);
  return (
    <li className="grid gap-1">
      <p className="text-sm text-ink">
        &ldquo;{review.aTitle}&rdquo; ↔ &ldquo;{review.bTitle}&rdquo; — approved{' '}
        {chicagoDateLabel(review.resolvedAt)} but never merged (crash mid-apply)
      </p>
      <form action={formAction}>
        <input type="hidden" name="reviewId" value={review.reviewId} />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? 'Returning…' : 'Return to queue'}
        </Button>
      </form>
      {state.message ? <p role="status" className="text-sm text-ink-muted">{state.message}</p> : null}
    </li>
  );
}

interface StuckReviewBannerProps {
  reviews: StuckReview[];
  returnAction: ReturnStuckAction;
}

export function StuckReviewBanner({ reviews, returnAction }: StuckReviewBannerProps) {
  if (reviews.length === 0) return null;
  return (
    <Card className="border-rm-red">
      <CardHeader>
        <CardTitle className="text-base text-rm-red">
          {reviews.length} stuck review{reviews.length === 1 ? '' : 's'} — approved but never merged
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3">
          {reviews.map((review) => (
            <StuckReviewRow key={review.reviewId} review={review} returnAction={returnAction} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
