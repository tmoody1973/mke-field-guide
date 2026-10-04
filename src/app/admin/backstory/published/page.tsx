import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { BACKSTORY_SHOWS, BackstoryTabs } from '@/components/admin/backstory-tabs';
import { backstoryQuery, reviewErrorMessage } from '@/lib/backstory';
import { publishedSchema, type PublishedRow } from '@/lib/backstory-types';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';

async function load(showSlug: string): Promise<{ rows: PublishedRow[] } | { error: string }> {
  try {
    return { rows: await backstoryQuery('review:published', showSlug ? { showSlug } : {}, publishedSchema) };
  } catch (error) {
    console.error('backstory published failed', error);
    return { error: reviewErrorMessage(error) };
  }
}

export default async function BackstoryPublishedPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireStaff('picks');
  const { show = '' } = await searchParams;
  const selected = BACKSTORY_SHOWS.some((s) => s.slug === show) ? show : '';
  const result = await load(selected);
  return (
    <div className="grid gap-4">
      <h1 className="font-head text-3xl text-ink">Backstory review</h1>
      <BackstoryTabs current="published" />
      <p className="text-ink-muted">Everything Alexa can use now. Open an episode to change a decision; changes take effect right away.</p>
      <nav aria-label="Shows" className="flex flex-wrap gap-2">
        {BACKSTORY_SHOWS.map((s) => (
          <Link key={s.slug} href={s.slug ? `/admin/backstory/published?show=${s.slug}` : '/admin/backstory/published'}>
            <Badge variant={s.slug === selected ? 'default' : 'outline'}>{s.name}</Badge>
          </Link>
        ))}
      </nav>
      {'error' in result ? (
        <p role="status" className="text-rm-red">{result.error}</p>
      ) : result.rows.length === 0 ? (
        <p className="text-ink-muted">Nothing published yet.</p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">{result.rows.length} published {result.rows.length === 1 ? 'episode' : 'episodes'}</p>
          {result.rows.map((row) => (
            <Card key={row.storyId}>
              <CardContent className="grid gap-1 py-4">
                <Link href={`/admin/backstory/${row.storyId}`} className="font-head text-lg text-ink underline">{row.title}</Link>
                <p className="text-sm text-ink-muted">{row.showName} · {chicagoDateLabel(new Date(row.publishedAt))}</p>
                <div className="flex flex-wrap gap-1">
                  {row.newVersionWaiting ? <Badge variant="secondary">New version waiting for review</Badge> : null}
                  {row.doNotUse ? <Badge variant="secondary">do not use</Badge> : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
