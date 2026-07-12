import { ChipLink } from '@/components/chip-link';
import { buildFacetHref } from './facet-href';
import { NearMeButton } from './near-me-button';
import type { SearchParams } from './search-params';

function BarLabel({ children }: { children: React.ReactNode }) {
  return <span className="flex-none text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-muted">{children}</span>;
}

/**
 * Slim, text-first filter bar above the results: View (grid/list), Sort
 * (Recommended, Near Me), and a Show Map toggle. Server-rendered — every
 * control is a plain URL-state link except NearMeButton, the one genuinely
 * client control (it needs the browser's geolocation API).
 */
export function FilterBar({ params }: { params: SearchParams }) {
  const isListView = params.view === 'list';
  const isRecommended = params.sort === 'recommended';
  const isMapOpen = params.map === '1';

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <BarLabel>View</BarLabel>
        <ChipLink active={!isListView} href={buildFacetHref(params, { view: undefined })}>
          Grid
        </ChipLink>
        <ChipLink active={isListView} href={buildFacetHref(params, { view: 'list' })}>
          List
        </ChipLink>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BarLabel>Sort</BarLabel>
        <ChipLink
          active={isRecommended}
          href={buildFacetHref(params, {
            sort: isRecommended ? undefined : 'recommended',
            lat: undefined,
            lng: undefined,
          })}
        >
          Recommended
        </ChipLink>
        <NearMeButton params={params} active={params.sort === 'near'} />
      </div>
      <ChipLink active={isMapOpen} href={buildFacetHref(params, { map: isMapOpen ? undefined : '1' })}>
        📍 Show Map
      </ChipLink>
    </div>
  );
}
