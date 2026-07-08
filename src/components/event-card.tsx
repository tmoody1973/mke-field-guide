import Link from 'next/link';
import { accentForCategory, onAccent, priceLabel } from '@/lib/design';
import { chicagoDayShort, chicagoTimeLabel } from '@/lib/display';
import type { EventCardMeta } from '@/lib/card-data';
import { audienceLabel, cardBadges } from '@/components/card-badges';

interface EventCardProps {
  meta: EventCardMeta;
  startAt: Date;
}

export function EventCard({ meta, startAt }: EventCardProps) {
  const accent = accentForCategory(meta.category, meta.isStationEvent);
  const textOnAccent = onAccent(accent);
  return (
    <Link
      href={`/events/${meta.slug}`}
      aria-label={`${meta.title}${meta.venueName ? ` at ${meta.venueName}` : ''}`}
      className="flex h-full flex-col overflow-hidden border-[3px] border-ink bg-cream-raised shadow-[6px_6px_0_#1F2528] transition-[transform,box-shadow] duration-100 hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_#1F2528] active:translate-x-[6px] active:translate-y-[6px] active:shadow-none"
    >
      <div
        className="flex min-h-24 flex-col justify-between border-b-[3px] border-ink px-4 pb-3 pt-3.5"
        style={{ background: accent, color: textOnAccent }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em]">{meta.category ?? 'Event'}</span>
          {meta.isStationEvent && (
            /* eslint-disable-next-line @next/next/no-img-element -- tiny local brand mark, no optimization needed */
            <img
              src="/brand/crescendo-charcoal.png"
              alt=""
              className="h-auto w-11 opacity-90"
              style={textOnAccent === '#F7F1DB' ? { filter: 'brightness(0) invert(1) opacity(0.85)' } : undefined}
            />
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-head text-[26px] uppercase leading-[0.9]">{chicagoDayShort(startAt)}</span>
          <span className="text-[13px] font-bold">{chicagoTimeLabel(startAt)}</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 px-4 pb-4 pt-3.5">
        <div className="flex flex-wrap gap-1.5">
          {cardBadges(meta).map((badge) => (
            <span
              key={badge.label}
              className="inline-block border-2 border-ink px-[7px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.1em]"
              style={{ background: badge.bg, color: badge.fg, textDecoration: badge.strike ? 'line-through' : undefined }}
            >
              {badge.label}
            </span>
          ))}
        </div>
        <h3 className="text-balance text-[19px] font-extrabold leading-[1.08] tracking-[-0.01em] text-ink">
          {meta.title}
        </h3>
        <div className="mt-auto flex flex-col gap-0.5">
          <span className="text-sm font-bold text-ink">{meta.venueName ?? 'Venue TBA'}</span>
          {meta.neighborhood && <span className="text-[12.5px] font-semibold text-ink-muted">{meta.neighborhood}</span>}
        </div>
        <div className="flex items-center gap-2 border-t-2 border-ink/10 pt-2">
          <span className="text-[13px] font-extrabold text-ink">{priceLabel(meta)}</span>
          <span className="text-ink/30">•</span>
          <span className="text-[12.5px] font-semibold text-ink-muted">{audienceLabel(meta.audienceTags)}</span>
        </div>
      </div>
    </Link>
  );
}
