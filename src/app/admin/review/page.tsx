import Link from 'next/link';
import { db } from '@/db';
import { approveReviewAction, rejectReviewAction } from '@/app/actions/admin-reviews-actions';
import { ReviewDecisionForm } from '@/components/admin/review-decision-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VENUE_OWNED_SOURCE_KEYS } from '@/dedup/confidence';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';
import { pendingReviewPairs, type ReviewSide } from '@/queries/admin-reviews';

const MAX_STARTS_SHOWN = 5;

function SideColumn({ side }: { side: ReviewSide }) {
  return (
    <div className="grid content-start gap-2">
      <Link href={`/events/${side.slug}`} target="_blank" className="font-head text-lg text-ink underline">
        {side.title}
      </Link>
      <p className="text-sm text-ink-muted">
        {side.venueName ?? 'Venue TBA'}
        {side.category ? ` · ${side.category}` : ''}
        {side.isFree ? ' · Free' : ''}
        {side.status !== 'scheduled' ? ` · ${side.status}` : ''}
      </p>
      <div className="text-sm text-ink-muted">
        {side.instanceStarts.slice(0, MAX_STARTS_SHOWN).map((start) => (
          <div key={start.toISOString()}>{chicagoDateLabel(start)}</div>
        ))}
        {side.instanceStarts.length > MAX_STARTS_SHOWN ? (
          <div>+{side.instanceStarts.length - MAX_STARTS_SHOWN} more</div>
        ) : null}
        {side.instanceStarts.length === 0 ? <div>No instances</div> : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {side.sources.map((source) => (
          <Badge key={source.key} variant={source.isCanonical ? 'default' : 'outline'}>
            {source.key}
            {source.isCanonical ? ' ★' : ''}
          </Badge>
        ))}
        {side.hasStaffPick ? <Badge variant="secondary">staff pick</Badge> : null}
      </div>
    </div>
  );
}

export default async function AdminReviewPage() {
  await requireStaff('admin');
  const pairs = await pendingReviewPairs(db);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">Duplicate review</h1>
        <p className="mt-1 text-ink-muted">
          {pairs.length} pending pair{pairs.length === 1 ? '' : 's'}. Approving merges the pair onto
          the survivor you pick — links, dates, and staff picks move with it; this cannot be undone.
          Venue-owned sources preferred by default: {VENUE_OWNED_SOURCE_KEYS.join(', ')}.
        </p>
      </div>
      {pairs.length === 0 ? (
        <p className="text-ink-muted">
          Queue is clear. The daily 8:00 dedup sweep adds new ambiguous pairs here.
        </p>
      ) : (
        <ul className="grid gap-4">
          {pairs.map((pair) => (
            <li key={pair.reviewId}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    Score {Number(pair.score).toFixed(2)}
                    <span className="text-sm font-normal text-ink-muted">
                      title {Math.round(pair.breakdown.titleSimilarity * 100)}% · venue{' '}
                      {Math.round(pair.breakdown.venueAffinity * 100)}% ·{' '}
                      {pair.breakdown.startDeltaMinutes === null
                        ? 'time unknown'
                        : `Δ${pair.breakdown.startDeltaMinutes}min`}
                      {pair.breakdown.urlMatch ? ' · url match' : ''}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SideColumn side={pair.a} />
                    <SideColumn side={pair.b} />
                  </div>
                  <ReviewDecisionForm
                    reviewId={pair.reviewId}
                    suggestedSurvivorId={pair.suggestedSurvivorId}
                    sides={[
                      { eventId: pair.a.eventId, title: pair.a.title },
                      { eventId: pair.b.eventId, title: pair.b.title },
                    ]}
                    approveAction={approveReviewAction}
                    rejectAction={rejectReviewAction}
                  />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
