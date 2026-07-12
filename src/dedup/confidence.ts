/** PRD confidence ladder: API/feed > JSON-LD/HTML parser > Firecrawl. */
const ADAPTER_RANK: Record<string, number> = { api: 4, ical: 3, rss: 3, html: 2, firecrawl: 1 };

/** Venue-owned listings are ground truth for their own stage (Tarik's ruling 2026-07-08). */
export const VENUE_OWNED_SOURCE_KEYS = ['pabst-theater-group', 'cactus-club', 'x-ray-arcade', 'marcus-center', 'jazz-gallery', 'eventbrite-cooperage', 'mad-planet', 'wiggle-room', 'centro-cafe', 'comedysportz'] as const;

export interface EventProvenance {
  eventId: string;
  adapterType: string;
  createdAt: Date;
  sourceKey: string;
}

export function adapterRank(adapterType: string): number {
  return ADAPTER_RANK[adapterType] ?? 0;
}

/** Higher-confidence source wins; ties go to the longer-lived event (stable slugs/URLs). */
export function pickCanonical(a: EventProvenance, b: EventProvenance): EventProvenance {
  const rankA = adapterRank(a.adapterType);
  const rankB = adapterRank(b.adapterType);
  if (rankA !== rankB) return rankA > rankB ? a : b;
  return a.createdAt.getTime() <= b.createdAt.getTime() ? a : b;
}

function isVenueOwned(provenance: EventProvenance): boolean {
  return (VENUE_OWNED_SOURCE_KEYS as readonly string[]).includes(provenance.sourceKey);
}

/**
 * Survivor pick for same-show review-band merges ONLY (src/dedup/sweep.ts's
 * isSameShow path) — never the >=0.80 ladder path, which stays on pickCanonical
 * unchanged. When exactly one side is the venue's own listing it wins as ground
 * truth for its own stage; two venue-owned sides or none fall back to the ladder.
 */
export function pickSameShowSurvivor(a: EventProvenance, b: EventProvenance): EventProvenance {
  const aOwned = isVenueOwned(a);
  const bOwned = isVenueOwned(b);
  if (aOwned !== bOwned) return aOwned ? a : b;
  return pickCanonical(a, b);
}
