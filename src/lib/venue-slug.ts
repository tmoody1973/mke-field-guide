import { createHash } from 'node:crypto';

/** venues.normalized_name is already lowercased/deaccented — this only reshapes it for URLs. */
export function venueSlug(normalizedName: string): string {
  const base = normalizedName
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (base) return base;
  return 'venue-' + createHash('sha256').update(normalizedName).digest('hex').slice(0, 8);
}

/** Reshapes a colliding slug into a distinct one by suffixing an 8-hex hash of the source name. */
export function disambiguateSlug(slug: string, normalizedName: string): string {
  return `${slug.slice(0, 39)}-${createHash('sha256').update(normalizedName).digest('hex').slice(0, 8)}`;
}
