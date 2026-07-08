import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db';
import { picksForWeek } from '@/queries/picks';
import { chicagoDateLabel, chicagoWeekMonday } from '@/lib/display';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Staff picks',
  description: 'What Radio Milwaukee DJs and hosts are actually going to this week.',
  alternates: { canonical: '/picks' },
};

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();
}

export default async function PicksPage() {
  const picks = await picksForWeek(db, chicagoWeekMonday(new Date()));
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-12 pt-10">
      <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.16em] text-rm-pink">Curated by our DJs</span>
      <h1 className="mb-8 font-head text-[clamp(32px,5vw,56px)] uppercase leading-[0.9]">Staff picks this week</h1>
      {picks.length === 0 ? (
        <p className="font-semibold text-ink-muted">This week's picks are still brewing — check back Thursday.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-[22px]">
          {picks.map((pick) => (
            <Link key={pick.id} href={`/events/${pick.meta.slug}`} className="flex flex-col overflow-hidden border-[3px] border-ink bg-cream no-underline shadow-[6px_6px_0_#1F2528] transition-[transform,box-shadow] duration-100 hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_#1F2528]">
              <div className="flex items-center gap-3.5 border-b-[3px] border-ink bg-rm-orange p-4">
                <span className="flex size-[52px] flex-none items-center justify-center border-[3px] border-ink bg-cream font-head text-xl">
                  {initials(pick.curatorName)}
                </span>
                <div className="min-w-0">
                  <div className="text-base font-extrabold text-ink">{pick.curatorName}</div>
                  {pick.curatorRole && <div className="text-xs font-bold uppercase tracking-[0.08em] text-ink">{pick.curatorRole}</div>}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-3.5 p-[18px]">
                <p className="font-accent text-[23px] leading-[1.15] text-ink">{pick.blurb}</p>
                <div className="mt-auto border-t-2 border-ink/15 pt-3">
                  <div className="text-base font-extrabold leading-tight text-ink">{pick.meta.title}</div>
                  <div className="mt-1 text-[13px] font-semibold text-ink-muted">
                    {pick.meta.venueName}
                    {pick.nextStartAt && ` · ${chicagoDateLabel(pick.nextStartAt)}`}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
