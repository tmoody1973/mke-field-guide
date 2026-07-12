import type { Metadata } from 'next';
import { asc, gte } from 'drizzle-orm';
import { db } from '@/db';
import { eventInstances } from '@/db/schema';
import { searchEvents } from '@/search/hybrid';
import { loadCardMeta } from '@/lib/card-data';
import { loadVenueCoords, type VenueCoords } from '@/queries/venue-coords';
import { loadPickedEventIds } from '@/queries/picked-events';
import { embedQueryWithTimeout } from './embed-query';
import { FacetChips } from './facet-chips';
import { FilterBar } from './filter-bar';
import { DayList, type CardItem } from './day-list';
import type { SortWithinDayOptions } from './sort-modes';
import { buildFacetHref } from './facet-href';
import { hasActiveSearchInputs, parseSearchParams, resolveSearch, type RawSearchParams, type SearchParams } from './search-params';

export const dynamic = 'force-dynamic';

const DEFAULT_LISTING_LIMIT = 100;

export async function generateMetadata({ searchParams }: { searchParams: Promise<RawSearchParams> }): Promise<Metadata> {
  const isFiltered = hasActiveSearchInputs(parseSearchParams(await searchParams));
  return {
    title: 'Browse Milwaukee events',
    description: 'Search and filter every upcoming Milwaukee event — by date, category, neighborhood, and price.',
    alternates: { canonical: '/events' },
    robots: isFiltered ? { index: false, follow: true } : undefined,
  };
}

/** Browse: one card per INSTANCE (Summerfest shows once per day-group — Decision 3). */
async function fetchDefaultListing(): Promise<CardItem[]> {
  const instances = await db.query.eventInstances.findMany({
    where: gte(eventInstances.startAt, new Date()),
    orderBy: [asc(eventInstances.startAt)],
    limit: DEFAULT_LISTING_LIMIT,
    with: { event: { with: { venue: true } } },
  });
  const metaById = await loadCardMeta(db, [...new Set(instances.map((instance) => instance.eventId))]);
  return instances.flatMap((instance) => {
    const meta = metaById.get(instance.eventId);
    return meta ? [{ meta, startAt: instance.startAt }] : [];
  });
}

/** Search: one card per EVENT at its next start (Decision 3). */
async function fetchSearchResults(rawParams: RawSearchParams, now: Date): Promise<CardItem[]> {
  const parsed = parseSearchParams(rawParams);
  const { text, filters } = resolveSearch(parsed, now);
  const queryEmbedding = await embedQueryWithTimeout(text ?? '');
  const hits = await searchEvents(db, { text, queryEmbedding, filters });
  const metaById = await loadCardMeta(db, hits.map((hit) => hit.eventId));
  return hits.flatMap((hit) => {
    const meta = metaById.get(hit.eventId);
    return meta ? [{ meta, startAt: hit.nextStartAt }] : [];
  });
}

function SearchForm({ query }: { query?: string }) {
  return (
    <form method="get" action="/events" className="flex border-[3px] border-ink bg-cream shadow-[5px_5px_0_#1F2528]">
      <input
        type="text"
        name="q"
        defaultValue={query}
        placeholder="Search or ask — 'free live music tonight in Riverwest'"
        aria-label="Search Milwaukee events"
        className="min-w-0 flex-1 bg-transparent px-4 py-[15px] text-base font-semibold outline-none"
      />
      <button type="submit" className="flex items-center border-l-[3px] border-ink bg-ink px-5 font-head text-lg text-rm-orange hover:bg-black">
        GO ⌕
      </button>
    </form>
  );
}

const ACTIVE_CHIP_DEFS: Array<{ key: keyof SearchParams; label: (value: string) => string }> = [
  { key: 'date', label: (value) => value.replace(/-/g, ' ') },
  { key: 'cat', label: (value) => value },
  { key: 'neighborhood', label: (value) => value },
  { key: 'audience', label: (value) => (value === '21-plus' ? '21+' : 'Family') },
  { key: 'tod', label: (value) => value },
  { key: 'free', label: () => 'Free' },
  { key: 'from', label: (value) => `from ${value}` },
  { key: 'to', label: (value) => `to ${value}` },
];

function ActiveChips({ params }: { params: SearchParams }) {
  const active = ACTIVE_CHIP_DEFS.filter(({ key }) => params[key] !== undefined);
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {active.map(({ key, label }) => (
        <a key={key} href={buildFacetHref(params, { [key]: undefined })} className="inline-flex items-center gap-1.5 border-2 border-ink bg-rm-orange px-2.5 py-[5px] text-xs font-extrabold no-underline hover:bg-ink hover:text-rm-orange">
          {label(String(params[key]))} ✕
        </a>
      ))}
      <a href="/events" className="border-b-2 border-rm-pink text-xs font-extrabold uppercase tracking-[0.06em] text-rm-pink no-underline">
        Clear all
      </a>
    </div>
  );
}

/** Every event with a resolvable venue id in the current result set (used for coords hydration). */
function uniqueVenueIds(items: CardItem[]): string[] {
  return [...new Set(items.flatMap((item) => (item.meta.venueId ? [item.meta.venueId] : [])))];
}

/** 'near' needs both lat and lng from the URL; either missing means no user point yet (e.g. sort=near before the first geolocation round-trip). */
function resolveUserPoint(params: SearchParams): { lat: number; lng: number } | undefined {
  if (params.lat === undefined || params.lng === undefined) return undefined;
  return { lat: params.lat, lng: params.lng };
}

function buildSortOptions(
  params: SearchParams,
  coordsByVenueId: Map<string, VenueCoords> | undefined,
  pickedEventIds: Set<string> | undefined,
): SortWithinDayOptions {
  if (params.sort === 'recommended') return { mode: 'recommended', pickedEventIds };
  if (params.sort === 'near') return { mode: 'near', coordsByVenueId, userPoint: resolveUserPoint(params) };
  return { mode: 'default' };
}

function ZeroState() {
  return (
    <div className="mx-auto my-5 max-w-[560px] border-[3px] border-dashed border-ink bg-cream-raised px-7 py-14 text-center">
      <div className="mb-3 font-head text-[40px] uppercase leading-[0.9]">Crickets.</div>
      <p className="mb-5 font-semibold text-ink-muted">Nothing on the calendar matches that yet. Loosen a filter, or let the city pick for you.</p>
      <a href="/events" className="inline-block border-[3px] border-ink bg-rm-orange px-5 py-3 text-sm font-extrabold uppercase tracking-[0.04em] text-ink no-underline shadow-[4px_4px_0_#1F2528] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#1F2528]">
        Reset filters
      </a>
    </div>
  );
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const rawParams = await searchParams;
  const params = parseSearchParams(rawParams);
  const isSearchActive = hasActiveSearchInputs(params);
  const now = new Date();
  const items = isSearchActive ? await fetchSearchResults(rawParams, now) : await fetchDefaultListing();

  // Coords/picks are read-only batch hydrations (Task 1 helpers) fetched only
  // when a mode actually needs them — near-me sort and map both consume venue
  // coords; only recommended consumes picks.
  const needsCoords = params.sort === 'near' || params.map === '1';
  const needsPicks = params.sort === 'recommended';
  const coordsByVenueId = needsCoords ? await loadVenueCoords(db, uniqueVenueIds(items)) : undefined;
  const pickedEventIds = needsPicks ? await loadPickedEventIds(db, now) : undefined;
  const sortOptions = buildSortOptions(params, coordsByVenueId, pickedEventIds);

  return (
    <div>
      <div className="border-b-[3px] border-ink bg-cream-raised">
        <div className="mx-auto max-w-[1240px] px-5 pb-5 pt-6">
          <div className="mb-[18px]">
            <SearchForm query={params.q} />
          </div>
          <FacetChips params={params} />
        </div>
      </div>
      <div className="mx-auto max-w-[1240px] px-5 pb-10 pt-[22px]">
        <div className="mb-[22px] flex flex-wrap items-center gap-3.5">
          <span className="font-head text-2xl leading-none">
            {items.length} {items.length === 1 ? 'event' : 'events'}
          </span>
          <ActiveChips params={params} />
        </div>
        <div className="mb-[22px]">
          <FilterBar params={params} />
        </div>
        {items.length === 0 ? <ZeroState /> : <DayList items={items} view={params.view} sort={sortOptions} />}
      </div>
    </div>
  );
}
