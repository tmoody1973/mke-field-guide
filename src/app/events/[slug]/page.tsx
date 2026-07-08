import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { getEventBySlug, relatedEvents } from '@/queries/event-detail';
import { buildEventJsonLd, safeJsonLdString } from '@/lib/event-jsonld';
import { googleCalendarUrl, type CalendarEventInput } from '@/lib/calendar-links';
import { accentForCategory, onAccent, priceLabel } from '@/lib/design';
import { neighborhoodByName } from '@/lib/neighborhoods';
import { chicagoDateLabel, chicagoTimeLabel } from '@/lib/display';
import { SITE_URL } from '@/lib/site';
import { EventCard } from '@/components/event-card';
import { audienceLabel, cardBadges } from '@/components/card-badges';
import { loadCardMeta } from '@/lib/card-data';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getEventBySlug(db, slug);
  if (!detail) return { title: 'Event not found' };
  return {
    title: detail.event.title,
    description: detail.event.summary ?? detail.event.description?.slice(0, 160) ?? undefined,
    alternates: { canonical: `/events/${slug}` },
    openGraph: detail.event.imageUrl ? { images: [detail.event.imageUrl] } : undefined,
  };
}

function calendarInput(detail: NonNullable<Awaited<ReturnType<typeof getEventBySlug>>>, startAt: Date, endAt: Date | null): CalendarEventInput {
  return {
    slug: detail.event.slug,
    title: detail.event.title,
    description: detail.event.summary ?? detail.event.description,
    venueName: detail.venue?.name ?? null,
    venueAddress: detail.venue?.address ?? null,
    startAt,
    endAt,
    url: `${SITE_URL}/events/${detail.event.slug}`,
  };
}

export default async function EventDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getEventBySlug(db, slug);
  if (!detail || detail.instances.length === 0) notFound();

  const { event, venue, instances, sourceName } = detail;
  const metaById = await loadCardMeta(db, [event.id]);
  const meta = metaById.get(event.id);
  if (!meta) notFound();

  const accent = accentForCategory(event.category, event.isStationEvent);
  const textOnAccent = onAccent(accent);
  const next = instances[0];
  const related = await relatedEvents(db, {
    eventId: event.id,
    category: event.category,
    neighborhood: venue?.neighborhood ?? null,
  });
  const hood = venue?.neighborhood ? neighborhoodByName(venue.neighborhood) : undefined;
  const jsonLd = buildEventJsonLd({
    title: event.title,
    description: event.summary ?? event.description,
    status: event.status,
    imageUrl: event.imageUrl,
    isFree: event.isFree,
    priceMin: event.priceMin,
    canonicalUrl: event.canonicalUrl,
    isStationEvent: event.isStationEvent,
    venueName: venue?.name ?? null,
    venueAddress: venue?.address ?? null,
    url: `${SITE_URL}/events/${event.slug}`,
    instances: instances.map((instance) => ({ startAt: instance.startAt, endAt: instance.endAt })),
  });

  return (
    <div className="mx-auto max-w-[1080px] px-5 pb-12 pt-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLdString(jsonLd) }} />
      <Link href="/events" className="mb-5 inline-block border-[3px] border-ink bg-cream px-3 py-2 text-[13px] font-extrabold uppercase tracking-[0.04em] no-underline shadow-[3px_3px_0_#1F2528] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0_#1F2528]">
        ← All events
      </Link>

      <div className="mb-[26px] border-[3px] border-ink p-7 shadow-[8px_8px_0_#1F2528]" style={{ background: accent, color: textOnAccent }}>
        <div className="mb-4 flex flex-wrap gap-2">
          {cardBadges(meta).map((badge) => (
            <span key={badge.label} className="inline-block border-2 border-ink px-2.5 py-[5px] text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ background: badge.bg, color: badge.fg, textDecoration: badge.strike ? 'line-through' : undefined }}>
              {badge.label}
            </span>
          ))}
        </div>
        <h1 className="mb-3.5 text-balance font-head text-[clamp(34px,6vw,68px)] uppercase leading-[0.9] tracking-[-0.01em]">
          {event.title}
        </h1>
        <div className="flex flex-wrap items-baseline gap-5">
          <span className="text-lg font-extrabold">
            {chicagoDateLabel(next.startAt)} · {chicagoTimeLabel(next.startAt)}
          </span>
          <span className="text-[15px] font-bold opacity-70">Central Time (Chicago)</span>
        </div>
      </div>

      <div className="grid items-start gap-[26px] md:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-6">
          {(event.description ?? event.summary) && (
            <div>
              <h3 className="mb-2.5 font-head text-xl uppercase">The rundown</h3>
              <p className="whitespace-pre-line text-base font-medium leading-relaxed text-[#3A4146]">
                {event.description ?? event.summary}
              </p>
            </div>
          )}
          {instances.length > 1 && (
            <div>
              <h3 className="mb-3 font-head text-xl uppercase">All dates</h3>
              <ul className="flex flex-col gap-2">
                {instances.map((instance) => (
                  <li key={instance.id} className="flex flex-wrap items-center gap-3 border-2 border-ink bg-cream-raised px-3 py-2">
                    <span className="text-sm font-extrabold">{chicagoDateLabel(instance.startAt)}</span>
                    <span className="text-sm font-semibold text-ink-muted">{chicagoTimeLabel(instance.startAt)}</span>
                    <a href={googleCalendarUrl(calendarInput(detail, instance.startAt, instance.endAt))} target="_blank" rel="noopener" className="ml-auto text-xs font-extrabold uppercase text-rm-blue underline">
                      + Google Cal
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {related.length > 0 && (
            <div>
              <h3 className="mb-3 font-head text-xl uppercase">More like this</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[18px] [grid-auto-rows:1fr]">
                {related.map((item) => (
                  <EventCard key={item.meta.eventId} meta={item.meta} startAt={item.startAt} />
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="order-first flex flex-col gap-4 md:order-none md:sticky md:top-[92px]">
          <div className="border-[3px] border-ink bg-cream p-[18px] shadow-[5px_5px_0_#1F2528]">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-rm-pink">Venue</span>
            <div className="mb-1 mt-1.5 font-head text-2xl uppercase leading-[0.95]">
              {venue?.slug ? (
                <Link href={`/venues/${venue.slug}`} className="no-underline hover:text-rm-orange">{venue.name}</Link>
              ) : (
                venue?.name ?? 'Venue TBA'
              )}
            </div>
            {hood && (
              <Link href={`/neighborhoods/${hood.slug}`} className="mt-1.5 inline-flex items-center gap-1.5 border-2 border-ink bg-rm-blue px-2 py-1 text-xs font-extrabold text-cream no-underline">
                ◈ {hood.name}
              </Link>
            )}
            {venue?.address && <div className="mt-3 text-sm font-semibold text-ink-muted">{venue.address}</div>}
            <div className="mt-3.5 flex flex-wrap gap-3.5">
              <div>
                <span className="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-subtle">Price</span>
                <span className="text-base font-extrabold">{priceLabel(meta)}</span>
              </div>
              <div>
                <span className="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-subtle">Ages</span>
                <span className="text-base font-extrabold">{audienceLabel(meta.audienceTags)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 border-[3px] border-ink bg-cream p-[18px] shadow-[5px_5px_0_#1F2528]">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-rm-pink">Add to calendar</span>
            <a href={googleCalendarUrl(calendarInput(detail, next.startAt, next.endAt))} target="_blank" rel="noopener" className="border-[3px] border-ink bg-rm-orange px-3.5 py-3 text-center text-sm font-extrabold uppercase tracking-[0.03em] text-ink no-underline shadow-[3px_3px_0_#1F2528] transition-[transform,box-shadow] duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0_#1F2528]">
              Google Calendar
            </a>
            <a href={`/events/${event.slug}/ics`} className="border-[3px] border-ink bg-ink px-3.5 py-3 text-center text-sm font-extrabold uppercase tracking-[0.03em] text-cream no-underline shadow-[3px_3px_0_#F8971D] transition-[transform,box-shadow] duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0_#F8971D]">
              Download .ics
            </a>
          </div>

          <div className="flex flex-col gap-1 px-1 text-xs font-semibold text-ink-subtle">
            {sourceName && <span>Source: {sourceName}</span>}
            {event.canonicalUrl && (
              <a href={event.canonicalUrl} target="_blank" rel="noopener" className="text-ink-subtle underline">
                Official event page ↗
              </a>
            )}
            {event.category && (
              <Link href={`/categories/${event.category}`} className="text-ink-subtle underline">
                More {event.category} events
              </Link>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
