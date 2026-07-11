import { asc, ilike } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { normalizeName } from '@/ingestion/naming';
import type { Db } from '@/lib/card-data';

const LIST_CAP = 50;
const LOW_CONFIDENCE_ADAPTERS = new Set(['html', 'firecrawl']); // PRD ladder rank <= 2

export interface AdminEventRow {
  eventId: string;
  slug: string;
  title: string;
  status: string;
  category: string | null;
  venueName: string | null;
  nextStartAt: Date | null;
  canonicalSourceKey: string | null;
  canonicalAdapterType: string | null;
  lowConfidence: boolean;
  lockedFields: string[];
  hasTitleSuggestion: boolean;
}

export interface AdminEventListOpts {
  q?: string;
  filter?: 'all' | 'low-confidence';
}

type LoadedAdminEvent = Awaited<ReturnType<typeof loadAdminEvents>>[number];

async function loadAdminEvents(db: Db, q?: string) {
  return db.query.events.findMany({
    where: q ? ilike(schema.events.normalizedTitle, `%${normalizeName(q)}%`) : undefined,
    with: {
      venue: { columns: { name: true } },
      instances: { orderBy: [asc(schema.eventInstances.startAt)], limit: 1 },
      sourceLinks: { with: { source: { columns: { key: true, adapterType: true } } } },
    },
    orderBy: [asc(schema.events.normalizedTitle)],
    limit: LIST_CAP * 4, // headroom so the low-confidence filter still fills a page
  });
}

function toRow(event: LoadedAdminEvent): AdminEventRow {
  const canonical = event.sourceLinks.find((link) => link.isCanonical) ?? null;
  const adapterType = canonical?.source.adapterType ?? null;
  return {
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    status: event.status,
    category: event.category,
    venueName: event.venue?.name ?? null,
    nextStartAt: event.instances[0]?.startAt ?? null,
    canonicalSourceKey: canonical?.source.key ?? null,
    canonicalAdapterType: adapterType,
    lowConfidence: (adapterType !== null && LOW_CONFIDENCE_ADAPTERS.has(adapterType)) || event.category === null,
    lockedFields: event.lockedFields,
    hasTitleSuggestion: event.titleSuggestion !== null,
  };
}

export async function adminEventList(db: Db, opts: AdminEventListOpts): Promise<AdminEventRow[]> {
  const rows = (await loadAdminEvents(db, opts.q)).map(toRow);
  const filtered = opts.filter === 'low-confidence' ? rows.filter((row) => row.lowConfidence) : rows;
  return filtered.slice(0, LIST_CAP);
}

export async function venueOptions(db: Db): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.venues.id, name: schema.venues.name })
    .from(schema.venues)
    .orderBy(asc(schema.venues.name));
}
