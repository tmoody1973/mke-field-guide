const STATUS_MAP: Record<string, string> = {
  scheduled: 'https://schema.org/EventScheduled',
  cancelled: 'https://schema.org/EventCancelled',
  postponed: 'https://schema.org/EventPostponed',
};

const MAX_INSTANCES = 10;

export interface EventJsonLdArgs {
  title: string;
  description: string | null;
  status: string;
  imageUrl: string | null;
  isFree: boolean | null;
  priceMin: string | null;
  canonicalUrl: string | null;
  isStationEvent: boolean;
  venueName: string | null;
  venueAddress: string | null;
  url: string;
  instances: Array<{ startAt: Date; endAt: Date | null }>;
}

function offers(args: EventJsonLdArgs): Record<string, unknown> | undefined {
  const price = args.isFree ? '0' : args.priceMin ?? undefined;
  if (price === undefined) return undefined;
  return {
    '@type': 'Offer',
    price,
    priceCurrency: 'USD',
    url: args.canonicalUrl ?? args.url,
    availability: 'https://schema.org/InStock',
  };
}

function baseEvent(args: EventJsonLdArgs): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: args.title,
    description: args.description ?? undefined,
    image: args.imageUrl ?? undefined,
    eventStatus: STATUS_MAP[args.status] ?? STATUS_MAP.scheduled,
    location: { '@type': 'Place', name: args.venueName ?? 'Milwaukee', address: args.venueAddress ?? 'Milwaukee, WI' },
    url: args.url,
    offers: offers(args),
    organizer: args.isStationEvent
      ? { '@type': 'Organization', name: 'Radio Milwaukee', url: 'https://radiomilwaukee.org' }
      : undefined,
  };
}

/** One Event object per upcoming instance — Google's recommended shape for recurring events. */
export function buildEventJsonLd(args: EventJsonLdArgs): Array<Record<string, unknown>> {
  return args.instances.slice(0, MAX_INSTANCES).map((instance) => ({
    ...baseEvent(args),
    startDate: instance.startAt.toISOString(),
    endDate: instance.endAt?.toISOString(),
  }));
}
