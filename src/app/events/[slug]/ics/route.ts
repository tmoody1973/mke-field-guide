import { z } from 'zod';
import { db } from '@/db';
import { getEventBySlug } from '@/queries/event-detail';
import { buildIcs } from '@/lib/calendar-links';
import { SITE_URL } from '@/lib/site';

const startParam = z.iso.datetime({ offset: true }).optional().catch(undefined);

/** GET /events/[slug]/ics[?start=ISO] — downloads the next (or selected) instance as .ics. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const detail = await getEventBySlug(db, slug);
  if (!detail || detail.instances.length === 0) return new Response('Not found', { status: 404 });

  const requestedStart = startParam.parse(new URL(request.url).searchParams.get('start') ?? undefined);
  const matchedInstance = requestedStart
    ? detail.instances.find((candidate) => candidate.startAt.toISOString() === requestedStart)
    : undefined;
  const instance = matchedInstance ?? detail.instances[0];

  const ics = buildIcs({
    slug: detail.event.slug,
    title: detail.event.title,
    description: detail.event.summary ?? detail.event.description,
    venueName: detail.venue?.name ?? null,
    venueAddress: detail.venue?.address ?? null,
    startAt: instance.startAt,
    endAt: instance.endAt,
    url: `${SITE_URL}/events/${detail.event.slug}`,
  });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${detail.event.slug}.ics"`,
    },
  });
}
