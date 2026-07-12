// Tier-1 of the venue-resolution waterfall: forward-geocode a venue's address so the
// registry matcher gains a distance signal. Results are TRANSIENT by design — matching
// evidence only, never persisted (geocode.earth results are open data and storable,
// but we deliberately keep venue columns annotation-only).
import { z } from 'zod';

export const GEOCODE_TIMEOUT_MS = 10_000;
const GEOCODE_ENDPOINT = 'https://api.geocode.earth/v1/search';

const geocodeResponseSchema = z.object({
  features: z.array(z.object({
    geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  })),
});

export function hasGeocodeKey(): boolean {
  return Boolean(process.env.GEOCODE_EARTH_API_KEY);
}

export function buildGeocodeUrl(address: string): string {
  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set('api_key', process.env.GEOCODE_EARTH_API_KEY ?? '');
  url.searchParams.set('text', address);
  url.searchParams.set('size', '1');
  return url.toString();
}

/** Never throws: no key, HTTP error, timeout, or malformed response all yield null. */
export async function geocodeAddress(
  address: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ lon: number; lat: number } | null> {
  if (!hasGeocodeKey()) return null;
  try {
    const response = await fetchFn(buildGeocodeUrl(address), {
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = geocodeResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.features.length === 0) return null;
    const [lon, lat] = parsed.data.features[0].geometry.coordinates;
    return { lon, lat };
  } catch {
    return null;
  }
}
