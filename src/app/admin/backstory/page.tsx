import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { backstoryQuery, reviewErrorMessage } from '@/lib/backstory';
import { queueSchema, type QueueRow } from '@/lib/backstory-types';
import { minutesEstimate } from '@/lib/backstory-review';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';
import { BACKSTORY_SHOWS, BackstoryTabs } from '@/components/admin/backstory-tabs';

const SHOWS = BACKSTORY_SHOWS;
const REASON: Record<QueueRow['needsReview'], string> = {
  new: 'New',
  reprocessed: 'Re-processed: live version stays until you approve this one',
  pipeline_failed: 'Pipeline failed: needs an editor',
};

async function loadQueue(showSlug: string): Promise<{ rows: QueueRow[] } | { error: string }> {
  try {
    return { rows: await backstoryQuery('review:queue', showSlug ? { showSlug } : {}, queueSchema) };
  } catch (error) {
    console.error('backstory queue failed', error);
    return { error: reviewErrorMessage(error) };
  }
}

export default async function BackstoryQueuePage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireStaff('picks');
  const { show = '' } = await searchParams;
  const selected = SHOWS.some((s) => s.slug === show) ? show : '';
  const result = await loadQueue(selected);
  return (
    <div className="grid gap-4">
      <h1 className="font-head text-3xl text-ink">Backstory review</h1>
      <BackstoryTabs current="episodes" />
      <p className="text-ink-muted">Nothing here reaches Alexa until you approve it. Content type: podcast episodes.</p>
      <nav className="flex flex-wrap gap-2">
        {SHOWS.map((s) => (
          <Link key={s.slug} href={s.slug ? `/admin/backstory?show=${s.slug}` : '/admin/backstory'}>
            <Badge variant={s.slug === selected ? 'default' : 'outline'}>{s.name}</Badge>
          </Link>
        ))}
      </nav>
      {'error' in result ? (
        <p role="status" className="text-rm-red">{result.error}</p>
      ) : result.rows.length === 0 ? (
        <p className="text-ink-muted">Nothing waiting for review.</p>
      ) : (
        result.rows.map((row) => (
          <Card key={row.storyId}>
            <CardContent className="grid gap-1 py-4">
              <Link href={`/admin/backstory/${row.storyId}`} className="font-head text-lg text-ink underline">{row.title}</Link>
              <p className="text-sm text-ink-muted">
                {row.showName} · {chicagoDateLabel(new Date(row.publishedAt))} · reviewer: {row.reviewer}
              </p>
              <div className="flex flex-wrap gap-1">
                <Badge variant={row.needsReview === 'pipeline_failed' ? 'secondary' : 'outline'}>{REASON[row.needsReview]}</Badge>
                {row.needsReview !== 'pipeline_failed' ? (
                  <Badge variant={row.needsYou > 0 ? 'default' : 'outline'}>
                    {row.needsYou} need you · about {minutesEstimate(row.items, row.needsYou)} min
                  </Badge>
                ) : null}
                {row.doNotUse ? <Badge variant="secondary">do not use</Badge> : null}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
