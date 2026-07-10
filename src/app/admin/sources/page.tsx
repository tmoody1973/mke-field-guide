import { db } from '@/db';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';
import { sourceHealthRows, triggerRunUrl, type SourceHealthRow } from '@/queries/admin-sources';

function statusVariant(status: SourceHealthRow['healthStatus']): 'default' | 'destructive' | 'secondary' {
  if (status === 'failing') return 'destructive';
  if (status === 'ok') return 'default';
  return 'secondary'; // 'unknown' = never ingested, not an error
}

function SourceCard({ row }: { row: SourceHealthRow }) {
  const runUrl = triggerRunUrl(row.lastRunId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {row.name}
          <Badge variant={statusVariant(row.healthStatus)}>{row.healthStatus}</Badge>
          <Badge variant="outline">{row.adapterType}</Badge>
          <Badge variant="outline">{row.cadence}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm text-ink-muted">
        <p>
          Last success: {row.lastFetchAt ? chicagoDateLabel(row.lastFetchAt) : 'never'} · Last attempt:{' '}
          {row.lastAttemptAt ? chicagoDateLabel(row.lastAttemptAt) : 'never'}
        </p>
        <p>
          Fetched {row.lastFetchedCount ?? '—'} · Published {row.lastPublishedCount ?? '—'} · Skipped{' '}
          {row.lastSkippedCount ?? '—'}
        </p>
        {row.healthStatus === 'failing' ? (
          <p className="text-rm-red">
            {row.consecutiveFailures} consecutive failure{row.consecutiveFailures === 1 ? '' : 's'}
            {row.inBackoffUntil ? ` · backing off until ${chicagoDateLabel(row.inBackoffUntil)}` : ''}
            {row.lastError ? ` — ${row.lastError}` : ''}
          </p>
        ) : null}
        <p>
          {runUrl ? (
            <a href={runUrl} target="_blank" rel="noreferrer" className="underline">
              Open last run in Trigger.dev
            </a>
          ) : (
            <span>Last run: —</span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function AdminSourcesPage() {
  await requireStaff('admin');
  const rows = await sourceHealthRows(db);
  const failing = rows.filter((row) => row.healthStatus === 'failing').length;
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">Source health</h1>
        <p className="mt-1 text-ink-muted">
          {rows.length} sources · {failing} failing. Failing sources back off exponentially after 3
          consecutive failures; job detail lives in Trigger.dev (no rebuilt observability).
        </p>
      </div>
      <ul className="grid gap-4">
        {rows.map((row) => (
          <li key={row.id}>
            <SourceCard row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}
