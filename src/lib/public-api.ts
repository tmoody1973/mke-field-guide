import { z } from 'zod';
import { MAX_RESULTS, type PublicEventsOptions } from '@/queries/public-events';

const KNOWN = new Set(['q', 'when', 'near', 'radius', 'free', 'ids', 'limit']);
const latLng = z.string().regex(/^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/).transform((s) => {
  const [lat, lng] = s.split(',').map(Number);
  return { lat, lng };
}).refine((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);

const schema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  when: z.enum(['tonight', 'today', 'this-weekend', 'this-week']).optional(),
  near: latLng.optional(),
  radius: z.coerce.number().min(0.1).max(5).optional(),
  free: z.enum(['1', 'true']).optional(),
  ids: z.string().transform((s) => s.split(',')).pipe(z.array(z.string().uuid()).min(1).max(MAX_RESULTS)).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_RESULTS).optional(),
});

export type ParsedQuery = { ok: true; opts: Omit<PublicEventsOptions, 'now'> } | { ok: false; error: string };

/** The public events API's query string: only known settings, each in range, so odd requests can't skip the cache. */
export function parsePublicEventsQuery(params: URLSearchParams): ParsedQuery {
  const unknown = [...params.keys()].filter((key) => !KNOWN.has(key));
  if (unknown.length) return { ok: false, error: `Unknown setting: ${unknown[0]}` };
  const result = schema.safeParse(Object.fromEntries(params));
  if (!result.success) return { ok: false, error: 'Bad query.' };
  const { q, when, near, radius, free, ids, limit } = result.data;
  return {
    ok: true,
    opts: {
      ...(q ? { q } : {}), ...(when ? { when } : {}), ...(near ? { near } : {}), ...(radius ? { radiusMiles: radius } : {}),
      ...(free ? { free: true } : {}), ...(ids ? { ids } : {}), ...(limit ? { limit } : {}),
    },
  };
}

export const PUBLIC_CACHE = { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=60', 'access-control-allow-origin': '*' };
