import { db } from '@/db';
import {
  applyVenueSuggestionAction,
  dismissVenueSuggestionAction,
  mergeVenuesAction,
} from '@/app/actions/admin-venues-actions';
import { VenueMergeForm } from '@/components/admin/venue-merge-form';
import { VenueProposalCard } from '@/components/admin/venue-proposal-card';
import { requireStaff } from '@/lib/staff-guard';
import { adminVenueList, pendingVenueSuggestions } from '@/queries/admin-venues';

export default async function AdminVenuesPage() {
  await requireStaff('admin');
  const [venues, suggestions] = await Promise.all([adminVenueList(db), pendingVenueSuggestions(db)]);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">Venues</h1>
        <p className="mt-1 text-ink-muted">
          Merge duplicate rows; the absorbed name becomes an alias so re-ingest can&apos;t re-mint it.
        </p>
      </div>
      {suggestions.length > 0 ? (
        <div className="grid gap-3">
          <h2 className="font-head text-xl text-ink">Proposed merges</h2>
          {suggestions.map((suggestion) => (
            <VenueProposalCard
              key={suggestion.suggestionId}
              suggestionId={suggestion.suggestionId}
              keepName={suggestion.keepName}
              keepEventCount={suggestion.keepEventCount}
              absorbName={suggestion.absorbName}
              absorbEventCount={suggestion.absorbEventCount}
              confidence={suggestion.confidence}
              rationale={suggestion.rationale}
              source={suggestion.source}
              registryName={suggestion.registryName}
              applyAction={applyVenueSuggestionAction}
              dismissAction={dismissVenueSuggestionAction}
            />
          ))}
        </div>
      ) : null}
      <VenueMergeForm venues={venues} mergeAction={mergeVenuesAction} />
      <ul className="grid gap-1 text-sm text-ink-muted">
        {venues.map((venue) => (
          <li key={venue.venueId}>
            {venue.name} · {venue.neighborhood ?? 'unmapped'} · {venue.eventCount} events
          </li>
        ))}
      </ul>
    </div>
  );
}
