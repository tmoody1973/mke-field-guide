import { EventCard } from '@/components/event-card';
import { chicagoDayHeading, chicagoDayKey } from '@/lib/display';
import type { EventCardMeta } from '@/lib/card-data';

export interface CardItem {
  meta: EventCardMeta;
  startAt: Date;
}

/** Station events float to the top of their day; slug keeps ties deterministic. */
function byBoostThenTime(a: CardItem, b: CardItem): number {
  if (a.meta.isStationEvent !== b.meta.isStationEvent) return a.meta.isStationEvent ? -1 : 1;
  return a.startAt.getTime() - b.startAt.getTime() || a.meta.slug.localeCompare(b.meta.slug);
}

function groupByDay(items: CardItem[]): Map<string, CardItem[]> {
  const byDay = new Map<string, CardItem[]>();
  for (const item of items) {
    const key = chicagoDayKey(item.startAt);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  return byDay;
}

export function DayList({ items }: { items: CardItem[] }) {
  const groups = [...groupByDay(items).entries()];
  return (
    <div className="flex flex-col gap-9">
      {groups.map(([key, dayItems]) => (
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(258px,1fr))] gap-5 [grid-auto-rows:1fr]">
            {[...dayItems].sort(byBoostThenTime).map((item) => (
              <EventCard key={`${item.meta.eventId}-${item.startAt.getTime()}`} meta={item.meta} startAt={item.startAt} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
