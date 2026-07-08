import { asc, gte } from 'drizzle-orm';
import { db } from '@/db';
import { eventInstances } from '@/db/schema';
import { searchEvents, type SearchHit } from '@/search/hybrid';
import { embedQueryWithTimeout } from './embed-query';
import { hasActiveSearchInputs, parseSearchParams, resolveSearch, type RawSearchParams } from './search-params';

export const dynamic = 'force-dynamic';

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: '2-digit',
});

interface DisplayItem {
  id: string;
  startAt: Date;
  title: string;
  venueName: string | null;
}

const DEFAULT_LISTING_LIMIT = 100;

/** The unfiltered instance-listing query used when no search text or facets are present. */
async function fetchDefaultListing(): Promise<DisplayItem[]> {
  const instances = await db.query.eventInstances.findMany({
    where: gte(eventInstances.startAt, new Date()),
    orderBy: [asc(eventInstances.startAt)],
    limit: DEFAULT_LISTING_LIMIT,
    with: { event: { with: { venue: true } } },
  });
  return instances.map((instance) => ({
    id: instance.id,
    startAt: instance.startAt,
    title: instance.event.title,
    venueName: instance.event.venue?.name ?? null,
  }));
}

function hitToDisplayItem(hit: SearchHit): DisplayItem {
  return { id: hit.eventId, startAt: hit.nextStartAt, title: hit.title, venueName: hit.venueName };
}

/** Hybrid search branch: embeds the query (best-effort) and fuses FTS + vector legs with facets. */
async function fetchSearchResults(rawParams: RawSearchParams, now: Date): Promise<DisplayItem[]> {
  const parsed = parseSearchParams(rawParams);
  const { text, filters } = resolveSearch(parsed, now);
  const queryEmbedding = await embedQueryWithTimeout(text ?? '');
  const hits = await searchEvents(db, { text, queryEmbedding, filters });
  return hits.map(hitToDisplayItem);
}

function groupByDay(items: DisplayItem[]): Map<string, DisplayItem[]> {
  const byDay = new Map<string, DisplayItem[]>();
  for (const item of items) {
    const day = dayFormatter.format(item.startAt);
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  return byDay;
}

function ZeroState({ isSearchActive }: { isSearchActive: boolean }) {
  if (isSearchActive) {
    return <p className="mt-8 text-neutral-500">No events match that search. Try different terms or filters.</p>;
  }
  return (
    <p className="mt-8 text-neutral-500">
      No upcoming events yet. Run <code>npm run ingest -- urban-milwaukee</code>.
    </p>
  );
}

function SearchForm() {
  return (
    <form method="get" className="mt-6 flex gap-2">
      <input
        type="text"
        name="q"
        placeholder="Search events, e.g. jazz this weekend"
        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
      />
      <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
        Search
      </button>
    </form>
  );
}

const PRESET_LINKS = [
  { href: '/events/tonight', label: 'Tonight' },
  { href: '/events/today', label: 'Today' },
  { href: '/events/this-weekend', label: 'This Weekend' },
  { href: '/free-events', label: 'Free Events' },
] as const;

function PresetLinks() {
  return (
    <nav className="mt-3 flex flex-wrap gap-3 text-sm">
      {PRESET_LINKS.map((preset) => (
        <a key={preset.href} href={preset.href} className="text-neutral-600 underline">
          {preset.label}
        </a>
      ))}
    </nav>
  );
}

function DayList({ byDay }: { byDay: Map<string, DisplayItem[]> }) {
  return (
    <>
      {[...byDay.entries()].map(([day, dayItems]) => (
        <section key={day} className="mt-8">
          <h2 className="border-b pb-1 text-lg font-semibold">{day}</h2>
          <ul className="mt-3 space-y-3">
            {dayItems.map((item) => (
              <li key={item.id} className="flex gap-3">
                <span className="w-20 shrink-0 text-sm text-neutral-500">
                  {timeFormatter.format(item.startAt)}
                </span>
                <span>
                  <span className="font-medium">{item.title}</span>
                  {item.venueName && <span className="text-sm text-neutral-500"> · {item.venueName}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const rawParams = await searchParams;
  const isSearchActive = hasActiveSearchInputs(parseSearchParams(rawParams));
  const items = isSearchActive ? await fetchSearchResults(rawParams, new Date()) : await fetchDefaultListing();
  const byDay = groupByDay(items);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">MKE Events</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Upcoming Milwaukee events · powered by Radio Milwaukee
      </p>
      <SearchForm />
      <PresetLinks />
      {isSearchActive && <p className="mt-4 text-sm text-neutral-500">{items.length} results</p>}
      {items.length === 0 && <ZeroState isSearchActive={isSearchActive} />}
      <DayList byDay={byDay} />
    </main>
  );
}
