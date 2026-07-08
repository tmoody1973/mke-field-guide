export const INK = '#1F2528';
export const CREAM = '#F7F1DB';
export const ORANGE = '#F8971D';
export const BLUE = '#32588E';
export const GOLD = '#F2C230';
export const PINK = '#C9366B';
export const RED = '#E8342A';

/** Accents whose luminance demands cream text (mockup EventCard + detail logic, exact set). */
const DARK_ACCENTS = new Set([BLUE, PINK, RED, INK]);

/**
 * Enrichment tagging vocabulary. Verified against the closed category enum in
 * src/enrichment/tag.ts (CATEGORY_VALUES) — same nine slugs, no delta.
 */
export const CATEGORIES = [
  { slug: 'music', label: 'Music', accent: ORANGE },
  { slug: 'arts', label: 'Arts', accent: BLUE },
  { slug: 'sports', label: 'Sports', accent: BLUE },
  { slug: 'family', label: 'Family', accent: GOLD },
  { slug: 'festival', label: 'Festival', accent: PINK },
  { slug: 'community', label: 'Community', accent: GOLD },
  { slug: 'comedy', label: 'Comedy', accent: PINK },
  { slug: 'food-drink', label: 'Food & Drink', accent: GOLD },
  { slug: 'other', label: 'More', accent: BLUE },
] as const;

export function accentForCategory(category: string | null, isStationEvent: boolean): string {
  if (isStationEvent) return ORANGE;
  const entry = CATEGORIES.find((candidate) => candidate.slug === category);
  return entry?.accent ?? BLUE;
}

export function onAccent(accent: string): string {
  return DARK_ACCENTS.has(accent) ? CREAM : INK;
}

/** Whole-dollar amounts drop the decimal; fractional amounts keep exactly two places. */
function formatDollars(numeric: string): string {
  const amount = Number(numeric);
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export function priceLabel(price: {
  isFree: boolean | null;
  priceMin: string | null;
  priceMax: string | null;
}): string {
  if (price.isFree) return 'Free';
  if (price.priceMin !== null) return `From ${formatDollars(price.priceMin)}`;
  return 'See tickets';
}
