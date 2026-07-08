import { asc, eq, gte } from 'drizzle-orm';
import { eventInstances, events } from '@/db/schema';
import type { Db, EventCardMeta } from '@/lib/card-data';
import { loadCardMeta } from '@/lib/card-data';
import type { CardItem } from '@/app/events/day-list';
import { searchEvents } from '@/search/hybrid';

export async function getEventBySlug(db: Db, slug: string) {
  const event = await db.query.events.findFirst({
    where: eq(events.slug, slug),
    with: {
      venue: true,
      instances: { where: gte(eventInstances.startAt, new Date()), orderBy: [asc(eventInstances.startAt)] },
      sourceLinks: { with: { source: true } },
    },
  });
  if (!event) return null;
  const canonical = event.sourceLinks.find((link) => link.isCanonical);
  return { event, venue: event.venue, instances: event.instances, sourceName: canonical?.source?.name ?? null };
}

const RELATED_LIMIT = 3;

function toCardItem(hit: { eventId: string; nextStartAt: Date }, metaById: Map<string, EventCardMeta>): CardItem[] {
  const meta = metaById.get(hit.eventId);
  return meta ? [{ meta, startAt: hit.nextStartAt }] : [];
}

/** Same category first; falls back to same neighborhood; excludes the event itself. */
export async function relatedEvents(
  db: Db,
  args: { eventId: string; category: string | null; neighborhood: string | null },
): Promise<CardItem[]> {
  const filters = args.category ? { category: args.category } : args.neighborhood ? { neighborhood: args.neighborhood } : {};
  const hits = await searchEvents(db, { filters, limit: RELATED_LIMIT + 1 });
  const kept = hits.filter((hit) => hit.eventId !== args.eventId).slice(0, RELATED_LIMIT);
  const metaById = await loadCardMeta(db, kept.map((hit) => hit.eventId));
  return kept.flatMap((hit) => toCardItem(hit, metaById));
}
