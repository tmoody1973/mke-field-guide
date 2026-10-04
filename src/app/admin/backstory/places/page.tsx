import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { LocationForm } from '@/components/admin/backstory-episode-forms';
import { FetchDetailsButton, PlaceNeighborhoodForm, PlaceReservationForm } from '@/components/admin/backstory-places-forms';
import { backstoryQuery, reviewErrorMessage } from '@/lib/backstory';
import { placesDirectorySchema, type DirectoryRow } from '@/lib/backstory-types';
import { requireStaff } from '@/lib/staff-guard';
import { BackstoryTabs } from '@/components/admin/backstory-tabs';

const FILTERS: { slug: string; name: string; keep: (row: DirectoryRow) => boolean }[] = [
  { slug: '', name: 'All', keep: () => true },
  { slug: 'no-pin', name: 'No pin', keep: (r) => !r.hasPin },
  { slug: 'low-confidence', name: 'Low-confidence pin', keep: (r) => r.lowConfidence },
  { slug: 'no-neighborhood', name: 'No neighborhood', keep: (r) => r.kind === 'place' && !r.neighborhood },
  { slug: 'no-reservation', name: 'Restaurants without a reservation link', keep: (r) => (r.category === 'restaurant' || r.category === 'bar') && !r.reservationUrl },
  { slug: 'organizations', name: 'Organizations', keep: (r) => r.kind === 'organization' },
];
const RESTAURANT = new Set(['restaurant', 'bar']);

async function load(): Promise<{ rows: DirectoryRow[] } | { error: string }> {
  try {
    return { rows: await backstoryQuery('review:places', {}, placesDirectorySchema) };
  } catch (error) {
    console.error('backstory places failed', error);
    return { error: reviewErrorMessage(error) };
  }
}

export default async function BackstoryPlacesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireStaff('picks');
  const { filter = '' } = await searchParams;
  const active = FILTERS.find((f) => f.slug === filter) ?? FILTERS[0];
  const result = await load();
  const rows = 'rows' in result ? result.rows.filter(active.keep) : [];
  return (
    <div className="grid gap-4">
      <h1 className="font-head text-3xl text-ink">Backstory review</h1>
      <BackstoryTabs current="places" />
      <p className="text-ink-muted">Every published place and organization, once. An edit here applies in every episode it appears in, and survives re-processing.</p>
      <nav aria-label="Filters" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.slug} href={f.slug ? `/admin/backstory/places?filter=${f.slug}` : '/admin/backstory/places'}
            aria-current={f.slug === active.slug ? 'page' : undefined}
            className={`border-[3px] border-ink px-3 py-1 text-sm ${f.slug === active.slug ? 'bg-ink text-cream' : ''}`}>
            {f.name}
          </Link>
        ))}
      </nav>
      {'error' in result ? <p role="alert" className="text-rm-red">{result.error}</p> : null}
      {'rows' in result && rows.length === 0 ? <p>Nothing here.</p> : null}
      <ul className="grid gap-3">
        {rows.map((row) => (
          <li key={row.key}>
            <Card>
              <CardContent className="grid gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-head text-xl">{row.name}</h2>
                  <Badge variant="outline">{row.kind === 'organization' ? 'Organization' : row.category}</Badge>
                  {!row.hasPin ? <Badge variant="secondary">No pin</Badge> : null}
                  {row.lowConfidence ? <Badge variant="secondary">Low-confidence pin</Badge> : null}
                </div>
                <p className="text-sm text-ink-muted">
                  {[row.address, row.neighborhood, row.phone, row.openingHours].filter(Boolean).join(' · ') || 'No address yet'}
                  {row.website ? <> · <a href={row.website} target="_blank" rel="noreferrer" className="underline">website</a></> : null}
                  {row.reservationUrl ? <> · <a href={row.reservationUrl} target="_blank" rel="noreferrer" className="underline">reservations</a></> : null}
                </p>
                <p className="text-sm">
                  In {row.stories.length} {row.stories.length === 1 ? 'episode' : 'episodes'}:{' '}
                  {row.stories.map((s, i) => (
                    <span key={s.storyId}>{i > 0 ? ', ' : ''}<Link href={`/admin/backstory/${s.storyId}`} className="underline">{s.title}</Link> ({s.showName})</span>
                  ))}
                </p>
                <div className="grid gap-2">
                  {row.kind === 'place' ? <PlaceNeighborhoodForm placeKey={row.key} neighborhood={row.neighborhood} name={row.name} /> : null}
                  {RESTAURANT.has(row.category) ? <PlaceReservationForm placeKey={row.key} url={row.reservationUrl} name={row.name} /> : null}
                  {row.hasPin ? <FetchDetailsButton placeKey={row.key} name={row.name} fetched={Boolean(row.website || row.phone)} /> : null}
                  {row.mentionId && row.stories[0] ? (
                    <LocationForm storyId={row.stories[0].storyId} mentionId={row.mentionId} category={row.category === 'organization' ? 'organization' : row.category} hasPin={row.hasPin} subject={row.name} />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
