/** PRD confidence ladder: API/feed > JSON-LD/HTML parser > Firecrawl. */
const ADAPTER_RANK: Record<string, number> = { api: 4, ical: 3, rss: 3, html: 2, firecrawl: 1 };

export interface EventProvenance {
  eventId: string;
  adapterType: string;
  createdAt: Date;
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
