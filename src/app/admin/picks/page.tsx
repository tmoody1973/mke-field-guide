import Link from 'next/link';
import { z } from 'zod';
import { db } from '@/db';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { chicagoDateLabel, chicagoWeekMonday } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';
import { pickWeeks } from '@/queries/admin-picks';
import { picksForWeek } from '@/queries/picks';
import { searchEvents } from '@/search/hybrid';

const paramsSchema = z.object({
  week: z.iso.date().catch(''),
  q: z.string().trim().max(200).catch(''),
});

function addDaysToIsoDate(isoDate: string, days: number): string {
  return new Date(new Date(`${isoDate}T12:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export default async function AdminPicksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff('picks');
  const raw = await searchParams;
  const parsed = paramsSchema.parse({ week: raw.week ?? '', q: raw.q ?? '' });
  const currentMonday = chicagoWeekMonday(new Date());
  const week = parsed.week || currentMonday;
  const weeks = Array.from(
    new Set([currentMonday, addDaysToIsoDate(currentMonday, 7), ...(await pickWeeks(db))]),
  ).sort();
  const picks = await picksForWeek(db, week);
  const results = parsed.q ? await searchEvents(db, { text: parsed.q, limit: 20 }) : [];

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-head text-3xl text-ink">Staff picks</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          {weeks.map((candidate) => (
            <Link key={candidate} href={`/admin/picks?week=${candidate}`}>
              <Badge variant={candidate === week ? 'default' : 'outline'}>
                Week of {candidate}
              </Badge>
            </Link>
          ))}
        </div>
      </div>

      <section>
        <h2 className="font-head text-xl text-ink">Picks for week of {week}</h2>
        {picks.length === 0 ? (
          <p className="mt-2 text-ink-muted">
            No picks yet for this week. (If a pick vanished, its event was merged away in dedup —
            re-add it against the surviving event.)
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {picks.map((pick) => (
              <li key={pick.id}>
                <Card>
                  <CardHeader>
                    <CardTitle>{pick.meta.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    <p className="text-sm text-ink-muted">
                      {pick.curatorName}
                      {pick.curatorRole ? ` — ${pick.curatorRole}` : ''} ·{' '}
                      {pick.meta.venueName ?? 'Venue TBA'} ·{' '}
                      {pick.nextStartAt ? chicagoDateLabel(pick.nextStartAt) : 'no upcoming date'}
                    </p>
                    <p className="font-accent text-lg text-ink">“{pick.blurb}”</p>
                    <div>
                      <Link href={`/admin/picks/${pick.id}/edit`}>
                        <Button size="sm" variant="outline">
                          Edit
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-head text-xl text-ink">Add a pick — search events</h2>
        <form method="GET" action="/admin/picks" className="mt-3 flex gap-2">
          <input type="hidden" name="week" value={week} />
          <Input name="q" defaultValue={parsed.q} placeholder="Search events…" className="max-w-md" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        {parsed.q ? (
          results.length === 0 ? (
            <p className="mt-3 text-ink-muted">No events match “{parsed.q}”.</p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {results.map((hit) => (
                <li
                  key={hit.eventId}
                  className="flex items-center justify-between border-[3px] border-ink bg-cream-raised px-3 py-2"
                >
                  <span className="text-ink">
                    {hit.title}
                    <span className="text-ink-muted">
                      {' '}
                      · {hit.venueName ?? 'Venue TBA'} · {chicagoDateLabel(hit.nextStartAt)}
                    </span>
                  </span>
                  <Link href={`/admin/picks/new?eventId=${hit.eventId}&week=${week}`}>
                    <Button size="sm">Pick this</Button>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}
