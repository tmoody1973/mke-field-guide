import Link from 'next/link';
import { db } from '@/db';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';
import { adminEventList, type AdminEventRow } from '@/queries/admin-events';

function EventRow({ row }: { row: AdminEventRow }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-head text-lg text-ink">{row.title}</span>
            {row.status !== 'scheduled' ? <Badge variant="secondary">{row.status}</Badge> : null}
            {row.lowConfidence ? <Badge variant="outline">low confidence</Badge> : null}
            {row.hasTitleSuggestion ? <Badge variant="secondary">AI title</Badge> : null}
            {row.lockedFields.length > 0 ? <Badge variant="outline">🔒 {row.lockedFields.join(', ')}</Badge> : null}
          </div>
          <p className="text-sm text-ink-muted">
            {row.venueName ?? 'Venue TBA'}
            {row.category ? ` · ${row.category}` : ' · untagged'}
            {row.nextStartAt ? ` · ${chicagoDateLabel(row.nextStartAt)}` : ' · no upcoming date'}
            {row.canonicalSourceKey ? ` · ${row.canonicalSourceKey} (${row.canonicalAdapterType})` : ''}
          </p>
        </div>
        <Link href={`/admin/events/${row.eventId}/edit`}>
          <Button variant="outline">Edit</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  await requireStaff('admin');
  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const filter = params.filter === 'low-confidence' ? 'low-confidence' : 'all';
  const rows = await adminEventList(db, { q, filter });
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">Events</h1>
        <p className="mt-1 text-ink-muted">
          Edit canonical events. Low confidence = scraper-sourced (html/firecrawl) or never enriched.
        </p>
      </div>
      <form className="flex flex-wrap items-center gap-2" action="/admin/events" method="get">
        <Input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search titles…"
          className="max-w-md"
        />
        {filter === 'low-confidence' ? <input type="hidden" name="filter" value="low-confidence" /> : null}
        <Button type="submit" variant="outline">Search</Button>
        <Link href={`/admin/events${q ? `?q=${encodeURIComponent(q)}` : ''}`}>
          <Button variant={filter === 'all' ? 'default' : 'outline'}>All</Button>
        </Link>
        <Link href={`/admin/events?filter=low-confidence${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
          <Button variant={filter === 'low-confidence' ? 'default' : 'outline'}>Low confidence</Button>
        </Link>
      </form>
      {rows.length === 0 ? (
        <p className="text-ink-muted">No events match.</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => (
            <li key={row.eventId}>
              <EventRow row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
