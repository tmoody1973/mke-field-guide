import Link from 'next/link';
import { accentForCategory, onAccent, priceLabel } from '@/lib/design';
import { chicagoTimeLabel } from '@/lib/display';
import type { EventCardMeta } from '@/lib/card-data';
import { cardBadges } from '@/components/card-badges';

interface EventListRowProps {
  meta: EventCardMeta;
  startAt: Date;
}

/** Compact horizontal sibling of EventCard for the List view: time | title | venue · neighborhood | badges. */
export function EventListRow({ meta, startAt }: EventListRowProps) {
  const accent = accentForCategory(meta.category, meta.isStationEvent);
  const venueLine = meta.neighborhood ? `${meta.venueName ?? 'Venue TBA'} · ${meta.neighborhood}` : meta.venueName ?? 'Venue TBA';

  return (
    <Link
      href={`/events/${meta.slug}`}
      aria-label={`${meta.title}${meta.venueName ? ` at ${meta.venueName}` : ''}`}
      className="flex min-w-0 items-center gap-3 border-[3px] border-ink bg-cream-raised px-3.5 py-2.5 shadow-[3px_3px_0_#1F2528] transition-[transform,box-shadow] duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0_#1F2528] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
    >
      <span
        className="flex-none whitespace-nowrap border-2 border-ink px-2 py-1 text-[12px] font-extrabold uppercase tabular-nums"
        style={{ background: accent, color: onAccent(accent) }}
      >
        {chicagoTimeLabel(startAt)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold leading-tight text-ink">{meta.title}</span>
      <span className="hidden min-w-0 max-w-[220px] flex-none truncate text-[13px] font-semibold text-ink-muted sm:inline">
        {venueLine}
      </span>
      <span className="flex flex-none flex-wrap items-center justify-end gap-1.5">
        <span className="whitespace-nowrap text-[12px] font-extrabold text-ink">{priceLabel(meta)}</span>
        {cardBadges(meta).map((badge) => (
          <span
            key={badge.label}
            className="inline-block whitespace-nowrap border-2 border-ink px-[6px] py-[2px] text-[9px] font-extrabold uppercase tracking-[0.08em]"
            style={{ background: badge.bg, color: badge.fg, textDecoration: badge.strike ? 'line-through' : undefined }}
          >
            {badge.label}
          </span>
        ))}
      </span>
    </Link>
  );
}
