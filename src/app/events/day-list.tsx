import { EventCard } from '@/components/event-card';
import { EventListRow } from '@/components/event-list-row';
import { chicagoDayHeading, chicagoDayKey } from '@/lib/display';
import { sortWithinDay, type CardItem, type SortWithinDayOptions } from './sort-modes';
import type { ViewMode } from './search-params';

export type { CardItem };

const DEFAULT_SORT: SortWithinDayOptions = { mode: 'default' };

function groupByDay(items: CardItem[]): Map<string, CardItem[]> {
  const byDay = new Map<string, CardItem[]>();
  for (const item of items) {
    const key = chicagoDayKey(item.startAt);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  return byDay;
}

interface DayListProps {
  items: CardItem[];
  view?: ViewMode;
  sort?: SortWithinDayOptions;
}

/**
 * Groups items into chronological day sections (always) and reorders WITHIN
 * each day per `sort` (defaults to the original byBoostThenTime behavior, so
 * an unfiltered `/events` render stays byte-identical to pre-filter-bar output).
 */
export function DayList({ items, view = 'grid', sort = DEFAULT_SORT }: DayListProps) {
  const groups = [...groupByDay(items).entries()];
  return (
    <div className="flex flex-col gap-9">
      {groups.map(([key, dayItems]) => {
        const sortedItems = sortWithinDay(dayItems, sort);
        return (
          <section key={key}>
            <div className="mb-4 flex items-center gap-3">
              <h2 className="bg-ink px-3 pb-[5px] pt-2 font-head text-xl uppercase leading-none text-cream">
                {chicagoDayHeading(dayItems[0].startAt)}
              </h2>
              <span className="h-[3px] flex-1 bg-ink" />
              <span className="text-[13px] font-extrabold text-ink-muted">
                {dayItems.length} {dayItems.length === 1 ? 'event' : 'events'}
              </span>
            </div>
            {view === 'list' ? (
              <div className="flex flex-col gap-2.5">
                {sortedItems.map((item) => (
                  <EventListRow key={`${item.meta.eventId}-${item.startAt.getTime()}`} meta={item.meta} startAt={item.startAt} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(258px,1fr))] gap-5 [grid-auto-rows:1fr]">
                {sortedItems.map((item) => (
                  <EventCard key={`${item.meta.eventId}-${item.startAt.getTime()}`} meta={item.meta} startAt={item.startAt} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
