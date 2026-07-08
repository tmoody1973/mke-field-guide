import type { Metadata } from 'next';
import { db } from '@/db';
import { picksForWeek } from '@/queries/picks';
import { homeData } from '@/queries/home';
import { chicagoDateLabel, chicagoTimeLabel, chicagoWeekMonday } from '@/lib/display';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'This Weekend in MKE — weekly digest',
  robots: { index: false, follow: false },
};

const HIGHLIGHT_LIMIT = 5;

/** Copy-paste source for the station's ESP: picks + weekend highlights, plain structure, no chrome. */
export default async function DigestPage() {
  const now = new Date();
  const [picks, data] = await Promise.all([picksForWeek(db, chicagoWeekMonday(now)), homeData(db, now)]);
  const highlights = [...data.weekend]
    .sort((a, b) => Number(b.meta.isStationEvent) - Number(a.meta.isStationEvent))
    .slice(0, HIGHLIGHT_LIMIT);
  return (
    <div className="mx-auto max-w-[720px] px-5 pb-16 pt-10">
      <h1 className="font-head text-4xl uppercase leading-[0.9]">This Weekend in MKE</h1>
      <p className="mt-2 text-sm font-semibold text-ink-muted">
        Auto-assembled {chicagoDateLabel(now)} — paste into the newsletter and edit freely.
      </p>
      <h2 className="mt-8 font-head text-2xl uppercase">Staff picks</h2>
      {picks.map((pick) => (
        <div key={pick.id} className="mt-4 border-l-4 border-rm-orange pl-4">
          <p className="font-accent text-xl">
            &quot;{pick.blurb}&quot; — {pick.curatorName}
          </p>
          <p className="text-sm font-bold">
            {pick.meta.title} · {pick.meta.venueName}
            {pick.nextStartAt && ` · ${chicagoDateLabel(pick.nextStartAt)} ${chicagoTimeLabel(pick.nextStartAt)}`}
          </p>
        </div>
      ))}
      <h2 className="mt-8 font-head text-2xl uppercase">Weekend highlights</h2>
      <ul className="mt-4 flex flex-col gap-3">
        {highlights.map((item) => (
          <li key={`${item.meta.eventId}-${item.startAt.getTime()}`} className="text-sm">
            <span className="font-extrabold">{item.meta.title}</span>
            {' — '}
            {item.meta.venueName} · {chicagoDateLabel(item.startAt)} {chicagoTimeLabel(item.startAt)}
            {item.meta.isFree ? ' · Free' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
