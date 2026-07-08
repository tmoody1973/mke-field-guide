import { ChipLink } from '@/components/chip-link';
import { CATEGORIES } from '@/lib/design';
import { NEIGHBORHOODS } from '@/lib/neighborhoods';
import { buildFacetHref } from './facet-href';
import type { SearchParams } from './search-params';

const DATE_CHIPS = [
  { label: 'Tonight', value: 'tonight' },
  { label: 'Today', value: 'today' },
  { label: 'This weekend', value: 'this-weekend' },
  { label: 'This week', value: 'this-week' },
] as const;

const AUDIENCE_CHIPS = [
  // Values are the VERIFIED enrichment vocabulary (src/enrichment/tag.ts AUDIENCE_TAG_VALUES, checked in Task 5):
  { label: 'Family', value: 'family-friendly' },
  { label: '21+', value: '21-plus' },
] as const;

const TIME_CHIPS = [
  { label: 'Morning', value: 'morning' },
  { label: 'Afternoon', value: 'afternoon' },
  { label: 'Evening', value: 'evening' },
  { label: 'Late', value: 'night' },
] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-[78px] text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-muted">{label}</span>
      {children}
    </div>
  );
}

export function FacetChips({ params }: { params: SearchParams }) {
  return (
    <div className="flex flex-col gap-3">
      <Row label="When">
        {DATE_CHIPS.map((chip) => (
          <ChipLink
            key={chip.value}
            active={params.date === chip.value}
            href={buildFacetHref(params, { date: params.date === chip.value ? undefined : chip.value, from: undefined, to: undefined })}
          >
            {chip.label}
          </ChipLink>
        ))}
        <ChipLink active={params.free === '1'} href={buildFacetHref(params, { free: params.free === '1' ? undefined : '1' })}>
          Free only
        </ChipLink>
      </Row>
      <Row label="Category">
        {CATEGORIES.filter((category) => category.slug !== 'other').map((category) => (
          <ChipLink
            key={category.slug}
            active={params.cat === category.slug}
            href={buildFacetHref(params, { cat: params.cat === category.slug ? undefined : category.slug })}
          >
            {category.label}
          </ChipLink>
        ))}
      </Row>
      <Row label="Hood">
        {NEIGHBORHOODS.map((hood) => (
          <ChipLink
            key={hood.slug}
            active={params.neighborhood === hood.name}
            href={buildFacetHref(params, { neighborhood: params.neighborhood === hood.name ? undefined : hood.name })}
          >
            {hood.name}
          </ChipLink>
        ))}
      </Row>
      <Row label="Who / When">
        {AUDIENCE_CHIPS.map((chip) => (
          <ChipLink
            key={chip.value}
            active={params.audience === chip.value}
            href={buildFacetHref(params, { audience: params.audience === chip.value ? undefined : chip.value })}
          >
            {chip.label}
          </ChipLink>
        ))}
        {TIME_CHIPS.map((chip) => (
          <ChipLink
            key={chip.value}
            active={params.tod === chip.value}
            href={buildFacetHref(params, { tod: params.tod === chip.value ? undefined : chip.value })}
          >
            {chip.label}
          </ChipLink>
        ))}
      </Row>
      <CustomRange params={params} />
    </div>
  );
}

/** GET form → /events?from=…&to=…; hidden inputs preserve every other active param. */
function CustomRange({ params }: { params: SearchParams }) {
  const preserved = Object.entries(params).filter(
    ([key, value]) => value !== undefined && !['from', 'to', 'date'].includes(key),
  );
  return (
    <form method="get" action="/events" className="flex flex-wrap items-center gap-2">
      <span className="w-[78px] text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-muted">Dates</span>
      {preserved.map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={String(value)} />
      ))}
      <input type="date" name="from" defaultValue={params.from} required aria-label="From date" className="border-[3px] border-ink bg-cream px-2 py-1.5 text-[13px] font-bold" />
      <span className="text-[13px] font-extrabold">→</span>
      <input type="date" name="to" defaultValue={params.to} required aria-label="To date" className="border-[3px] border-ink bg-cream px-2 py-1.5 text-[13px] font-bold" />
      <button type="submit" className="border-[3px] border-ink bg-cream px-[13px] py-[7px] text-[13px] font-extrabold shadow-[2px_2px_0_rgba(31,37,40,0.25)] hover:bg-rm-orange">
        Apply
      </button>
    </form>
  );
}
