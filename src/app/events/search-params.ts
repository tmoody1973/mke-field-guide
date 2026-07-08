import { z } from 'zod';
import { parseSearchInput, presetWindow, type TimeOfDay } from '@/search/query-understanding';
import type { SearchFilters } from '@/search/hybrid';
import { chicagoWallTimeToIso } from '@/lib/chicago-time';

const DATE_PRESETS = ['tonight', 'today', 'this-weekend', 'this-week'] as const;
const TIME_OF_DAY_VALUES = ['morning', 'afternoon', 'evening', 'night'] as const;

export type DatePreset = (typeof DATE_PRESETS)[number];

export const searchParamsSchema = z.object({
  q: z.string().optional().catch(undefined),
  date: z.enum(DATE_PRESETS).optional().catch(undefined),
  cat: z.string().optional().catch(undefined),
  venue: z.string().optional().catch(undefined),
  neighborhood: z.string().optional().catch(undefined),
  free: z.literal('1').optional().catch(undefined),
  vibe: z.string().optional().catch(undefined),
  audience: z.string().optional().catch(undefined),
  tod: z.enum(TIME_OF_DAY_VALUES).optional().catch(undefined),
  maxPrice: z.coerce.number().optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Next.js may deliver a repeated query key as an array; only the first occurrence is meaningful here. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Normalizes raw Next.js searchParams and validates them. Every field carries `.catch(undefined)`,
 * so an invalid value is dropped rather than rejecting the whole request.
 */
export function parseSearchParams(raw: RawSearchParams): SearchParams {
  const normalized: Record<string, string | undefined> = {};
  for (const key of Object.keys(raw)) normalized[key] = firstValue(raw[key]);
  return searchParamsSchema.parse(normalized);
}

/** True when the request carries any search text or facet — the trigger for the hybrid-search branch. */
export function hasActiveSearchInputs(params: SearchParams): boolean {
  return Boolean(
    params.q ||
      params.date ||
      params.cat ||
      params.venue ||
      params.neighborhood ||
      params.free ||
      params.vibe ||
      params.audience ||
      params.tod ||
      params.maxPrice !== undefined ||
      params.from ||
      params.to,
  );
}

interface ResolvedSearch {
  text?: string;
  filters: SearchFilters;
}

interface CivilDay {
  year: number;
  month: number;
  day: number;
}

function parseCivilDay(value: string): CivilDay {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

/** UTC absorbs month/year rollover; DST-safe because the wall-time conversion happens after. */
function nextCivilDay(civil: CivilDay): CivilDay {
  const shifted = new Date(Date.UTC(civil.year, civil.month - 1, civil.day) + 86_400_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function wallStart(civil: CivilDay): Date {
  return new Date(chicagoWallTimeToIso(civil.year, civil.month, civil.day, 0, 0));
}

/** Whole Chicago days, end-exclusive. Inverted ranges resolve to no window. */
function customRangeWindow(params: SearchParams): { start: Date; end: Date } | undefined {
  if (!params.from || !params.to) return undefined;
  const start = wallStart(parseCivilDay(params.from));
  const endStart = wallStart(parseCivilDay(params.to));
  if (start.getTime() > endStart.getTime()) return undefined;
  return { start, end: wallStart(nextCivilDay(parseCivilDay(params.to))) };
}

/** An in-query phrase (e.g. "this weekend") always wins over the `date` preset param. */
function resolveWindow(
  params: SearchParams,
  parsedWindow: { start: Date; end: Date } | null,
  now: Date,
): { start: Date; end: Date } | undefined {
  if (parsedWindow) return parsedWindow;
  if (params.date) return presetWindow(params.date, now);
  return customRangeWindow(params);
}

function resolveTimeOfDay(params: SearchParams, parsedTimeOfDay: TimeOfDay | null): TimeOfDay | undefined {
  return parsedTimeOfDay ?? params.tod ?? undefined;
}

function buildFilters(
  params: SearchParams,
  window: { start: Date; end: Date } | undefined,
  timeOfDay: TimeOfDay | undefined,
  freeFromQuery: boolean,
): SearchFilters {
  return {
    window,
    category: params.cat,
    venue: params.venue,
    neighborhood: params.neighborhood,
    free: params.free === '1' || freeFromQuery ? true : undefined,
    vibe: params.vibe,
    audience: params.audience,
    timeOfDay,
    maxPrice: params.maxPrice,
  };
}

/** Combines the `q` phrase parse with facet params into the args `searchEvents` expects. */
export function resolveSearch(params: SearchParams, now: Date): ResolvedSearch {
  const parsedQuery = params.q ? parseSearchInput(params.q, now) : null;
  const window = resolveWindow(params, parsedQuery?.window ?? null, now);
  const timeOfDay = resolveTimeOfDay(params, parsedQuery?.timeOfDay ?? null);
  const text = parsedQuery?.text ? parsedQuery.text : undefined;
  return { text, filters: buildFilters(params, window, timeOfDay, parsedQuery?.free ?? false) };
}
