import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import { eventInstances, venues } from '@/db/schema';
import { loadCardMeta } from '@/lib/card-data';
import { neighborhoodByName } from '@/lib/neighborhoods';
import { DayList, type CardItem } from '../../events/day-list';

export const dynamic = 'force-dynamic';

async function getVenue(slug: string) {
  return db.query.venues.findFirst({ where: eq(venues.slug, slug) });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const venue = await getVenue((await params).slug);
  if (!venue) return { title: 'Venue not found' };
  return {
    title: `Events at ${venue.name}`,
    description: `Upcoming events at ${venue.name}${venue.neighborhood ? ` in ${venue.neighborhood}` : ''}, Milwaukee.`,
    alternates: { canonical: `/venues/${venue.slug}` },
  };
}

async function upcomingAtVenue(venueId: string): Promise<CardItem[]> {
  const instances = await db.query.eventInstances.findMany({
    where: gte(eventInstances.startAt, new Date()),
    orderBy: [asc(eventInstances.startAt)],
    limit: 60,
    with: { event: true },
  });
  const atVenue = instances.filter((instance) => instance.event.venueId === venueId);
  const metaById = await loadCardMeta(db, [...new Set(atVenue.map((instance) => instance.eventId))]);
  return atVenue.flatMap((instance) => {
    const meta = metaById.get(instance.eventId);
    return meta ? [{ meta, startAt: instance.startAt }] : [];
  });
}

export default async function VenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const venue = await getVenue((await params).slug);
  if (!venue) notFound();
  const items = await upcomingAtVenue(venue.id);
  const hood = venue.neighborhood ? neighborhoodByName(venue.neighborhood) : undefined;

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-10 pt-8">
      <div className="mb-8 border-[3px] border-ink bg-cream-raised p-7 shadow-[6px_6px_0_#1F2528]">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-rm-pink">Venue</span>
        <h1 className="mt-1.5 font-head text-[clamp(30px,5vw,56px)] uppercase leading-[0.9]">{venue.name}</h1>
        {venue.address && <p className="mt-2 text-sm font-semibold text-ink-muted">{venue.address}</p>}
        {hood && (
          <Link href={`/neighborhoods/${hood.slug}`} className="mt-3 inline-flex items-center gap-1.5 border-2 border-ink bg-rm-blue px-2 py-1 text-xs font-extrabold text-cream no-underline">
            ◈ {hood.name}
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="font-semibold text-ink-muted">Nothing upcoming here right now — check <Link href="/events">all events</Link>.</p>
      ) : (
        <DayList items={items} />
      )}
    </div>
  );
}
