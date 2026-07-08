import Link from 'next/link';
import { EventCard } from '@/components/event-card';
import { SectionHeader } from '@/components/section-header';
import { NewsletterForm } from '@/components/newsletter-form';
import { NEIGHBORHOODS, neighborhoodByName } from '@/lib/neighborhoods';
import { onAccent } from '@/lib/design';
import { chicagoDateLabel } from '@/lib/display';
import type { CardItem } from '@/app/events/day-list';
import type { NeighborhoodCount } from '@/queries/home';
import type { PickWithEvent } from '@/queries/picks';

const HERO_CHIPS = [
  { label: 'Tonight', href: '/events/tonight' },
  { label: 'This weekend', href: '/events/this-weekend' },
  { label: 'Free events', href: '/free-events' },
  { label: 'Family friendly', href: '/events?audience=family-friendly' },
  { label: 'Live music', href: '/live-music' },
] as const;

/** Server-rendered hero: date badge, headline, GET-to-/events search, chip shortcuts. */
export function Hero() {
  return (
    <section className="relative overflow-hidden border-b-[3px] border-ink bg-rm-orange">
      <div className="relative z-[2] mx-auto max-w-[1000px] px-5 pb-16 pt-[60px] text-center">
        <span className="mb-[22px] inline-block border-[3px] border-ink bg-ink px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.16em] text-cream">
          {chicagoDateLabel(new Date())} · Milwaukee, WI
        </span>
        <h1 className="text-balance mb-2.5 font-head text-[clamp(40px,7vw,86px)] leading-[0.92] tracking-[-0.01em] text-ink">
          What&apos;s happening
          <br />
          in Milwaukee?
        </h1>
        <p className="mx-auto mb-7 max-w-[560px] text-[17px] font-semibold text-ink">
          Search by the plain truth of what you want — <em>&quot;chill outdoor jazz with the kids Sunday&quot;</em> — or tap a chip and go.
        </p>
        <form method="get" action="/events" className="mx-auto flex max-w-[640px] border-[3px] border-ink bg-cream shadow-[6px_6px_0_#1F2528]">
          <input
            type="text"
            name="q"
            placeholder="Try: free family fun this weekend in Bay View"
            aria-label="Search Milwaukee events"
            className="min-w-0 flex-1 bg-transparent px-[18px] py-4 text-base font-semibold text-ink outline-none"
          />
          <button type="submit" className="flex items-center border-l-[3px] border-ink bg-ink px-[22px] font-head text-xl text-rm-orange hover:bg-black">
            GO ⌕
          </button>
        </form>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          {HERO_CHIPS.map((chip) => (
            <Link
              key={chip.href}
              href={chip.href}
              className="border-[3px] border-ink bg-cream px-3.5 py-2 text-[13px] font-extrabold uppercase tracking-[0.04em] text-ink shadow-[3px_3px_0_#1F2528] transition-transform duration-100 hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#1F2528] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
            >
              {chip.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();
}

const PICKS_MODULE_LIMIT = 3;

export function PicksModule({ picks }: { picks: PickWithEvent[] }) {
  return (
    <section className="mx-auto max-w-[1240px] px-5 pb-5 pt-14">
      <SectionHeader eyebrow="Curated by our DJs" eyebrowColor="#C9366B" title="Staff picks this week" seeAllHref="/picks" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-[22px]">
        {picks.slice(0, PICKS_MODULE_LIMIT).map((pick) => (
          <Link
            key={pick.id}
            href={`/events/${pick.meta.slug}`}
            className="flex flex-col overflow-hidden border-[3px] border-ink bg-cream no-underline shadow-[6px_6px_0_#1F2528] transition-[transform,box-shadow] duration-100 hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_#1F2528]"
          >
            <div className="flex items-center gap-3.5 border-b-[3px] border-ink bg-rm-orange p-4">
              <span className="flex size-[52px] flex-none items-center justify-center border-[3px] border-ink bg-cream font-head text-xl">
                {initials(pick.curatorName)}
              </span>
              <div className="min-w-0">
                <div className="text-base font-extrabold text-ink">{pick.curatorName}</div>
                {pick.curatorRole && <div className="text-xs font-bold uppercase tracking-[0.08em] text-ink">{pick.curatorRole}</div>}
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-3.5 p-[18px]">
              <p className="font-accent text-[23px] leading-[1.15] text-ink">{pick.blurb}</p>
              <div className="mt-auto border-t-2 border-ink/15 pt-3">
                <div className="text-base font-extrabold leading-tight text-ink">{pick.meta.title}</div>
                <div className="mt-1 text-[13px] font-semibold text-ink-muted">
                  {pick.meta.venueName}
                  {pick.nextStartAt && ` · ${chicagoDateLabel(pick.nextStartAt)}`}
                </div>
                {pick.showUrl && (
                  <a
                    href={pick.showUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="mt-2 inline-block text-xs font-extrabold uppercase tracking-[0.04em] text-rm-pink hover:underline"
                  >
                    Their show ↗
                  </a>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

interface CardModuleProps {
  title: string;
  seeAllHref: string;
  items: CardItem[];
  live?: boolean;
}

export function CardModule({ title, seeAllHref, items, live }: CardModuleProps) {
  return (
    <section className="mx-auto max-w-[1240px] px-5 pt-10">
      <div className="mb-[22px] flex items-center gap-3">
        {live && <span className="size-3.5 rounded-full border-2 border-ink bg-rm-red" />}
        <h2 className="font-head text-[clamp(26px,3.6vw,40px)] uppercase leading-[0.9]">{title}</h2>
        <Link href={seeAllHref} className="ml-auto border-b-[3px] border-rm-orange text-[13px] font-extrabold uppercase tracking-[0.04em] text-ink no-underline hover:text-rm-orange">
          See all →
        </Link>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(258px,1fr))] gap-5 [grid-auto-rows:1fr]">
        {items.map((item) => (
          <EventCard key={`${item.meta.eventId}-${item.startAt.getTime()}`} meta={item.meta} startAt={item.startAt} />
        ))}
      </div>
    </section>
  );
}

export function StationModule({ items }: { items: CardItem[] }) {
  return (
    <section className="mt-14 border-y-[3px] border-ink bg-ink">
      <div className="mx-auto max-w-[1240px] px-5 py-11">
        <div className="mb-6 flex flex-wrap items-center gap-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny local brand mark, no optimization needed */}
          <img src="/brand/crescendo-charcoal.png" alt="Radio Milwaukee" className="h-[34px] w-auto" style={{ filter: 'brightness(0) invert(1)' }} />
          <h2 className="font-head text-[clamp(26px,3.8vw,44px)] leading-[0.9] text-cream">Radio Milwaukee events</h2>
          <span className="border-2 border-cream bg-rm-orange px-2.5 py-[5px] text-xs font-extrabold uppercase tracking-[0.1em] text-ink">
            Station presents
          </span>
        </div>
        <p className="mb-[26px] max-w-[620px] font-semibold text-ink-muted">
          Live in the Backyard, on the block, in the studio. When the station throws it, you hear it here first — and it&apos;s almost always free.
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(258px,1fr))] gap-5 [grid-auto-rows:1fr]">
          {items.map((item) => (
            <EventCard key={`${item.meta.eventId}-${item.startAt.getTime()}`} meta={item.meta} startAt={item.startAt} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function HoodsModule({ hoods }: { hoods: NeighborhoodCount[] }) {
  const countByName = new Map(hoods.map((hood) => [hood.name, hood.count]));
  return (
    <section className="mx-auto max-w-[1240px] px-5 pb-2 pt-14">
      <h2 className="mb-6 font-head text-[clamp(26px,3.8vw,44px)] leading-[0.9]">By neighborhood</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-[18px]">
        {NEIGHBORHOODS.map((hood) => {
          const accent = neighborhoodByName(hood.name)?.accent ?? hood.accent;
          const textColor = onAccent(accent);
          const count = countByName.get(hood.name) ?? 0;
          return (
            <Link
              key={hood.slug}
              href={`/neighborhoods/${hood.slug}`}
              className="relative flex min-h-[132px] flex-col justify-between overflow-hidden border-[3px] border-ink p-4 shadow-[6px_6px_0_#1F2528] transition-transform duration-100 hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_#1F2528]"
              style={{ background: accent }}
            >
              {count > 0 && (
                <span className="text-[13px] font-extrabold" style={{ color: textColor }}>
                  {count} {count === 1 ? 'event' : 'events'}
                </span>
              )}
              <span className="font-head text-[26px] leading-[0.9]" style={{ color: textColor }}>
                {hood.name}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function NewsletterModule() {
  return (
    <section className="mx-auto mt-14 max-w-[1240px] px-5">
      <div className="flex flex-wrap items-center justify-between gap-6 border-[3px] border-ink bg-rm-pink px-7 py-9 shadow-[8px_8px_0_#1F2528]">
        <div className="max-w-[520px]">
          <span className="mb-3 inline-block bg-ink px-2.5 py-[5px] text-[11px] font-extrabold uppercase tracking-[0.14em] text-cream">
            Every Thursday
          </span>
          <h2 className="mb-2 font-head text-[clamp(28px,4vw,46px)] leading-[0.9] text-cream">This weekend in MKE</h2>
          <p className="text-[15px] font-semibold text-cream">
            The five things worth leaving the house for, hand-picked and in your inbox before you make weekend plans.
          </p>
        </div>
        <NewsletterForm source="homepage" />
      </div>
    </section>
  );
}
