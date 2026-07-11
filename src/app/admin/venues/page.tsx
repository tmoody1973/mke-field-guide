import { db } from '@/db';
import { mergeVenuesAction } from '@/app/actions/admin-venues-actions';
import { VenueMergeForm } from '@/components/admin/venue-merge-form';
import { requireStaff } from '@/lib/staff-guard';
import { adminVenueList } from '@/queries/admin-venues';

export default async function AdminVenuesPage() {
  await requireStaff('admin');
  const venues = await adminVenueList(db);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">Venues</h1>
        <p className="mt-1 text-ink-muted">
          Merge duplicate rows; the absorbed name becomes an alias so re-ingest can&apos;t re-mint it.
        </p>
      </div>
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
