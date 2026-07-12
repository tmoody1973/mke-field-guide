import { describe, expect, it } from 'vitest';
import {
  hasActiveSearchInputs,
  parseSearchParams,
  resolveSearch,
  searchParamsSchema,
} from '@/app/events/search-params';

const NOW = new Date('2026-07-07T19:00:00-05:00'); // Tuesday, 7 PM Chicago
const chi = (s: string) => new Date(s).toISOString();

describe('searchParamsSchema', () => {
  it('accepts a fully populated valid query', () => {
    const result = searchParamsSchema.safeParse({
      q: 'jazz',
      date: 'tonight',
      cat: 'music',
      venue: 'the-rave',
      neighborhood: 'bay-view',
      free: '1',
      vibe: 'chill',
      audience: 'family',
      tod: 'evening',
      maxPrice: '20',
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ date: 'tonight', free: '1', tod: 'evening', maxPrice: 20 });
  });

  it('drops an invalid enum value instead of failing the whole parse', () => {
    const result = searchParamsSchema.safeParse({ date: 'next-year', q: 'jazz' });
    expect(result.success).toBe(true);
    expect(result.data?.date).toBeUndefined();
    expect(result.data?.q).toBe('jazz');
  });

  it('drops an invalid free literal', () => {
    const result = searchParamsSchema.safeParse({ free: 'yes' });
    expect(result.success).toBe(true);
    expect(result.data?.free).toBeUndefined();
  });

  it('coerces maxPrice from a numeric string and drops it when non-numeric', () => {
    const valid = searchParamsSchema.safeParse({ maxPrice: '15' });
    expect(valid.data?.maxPrice).toBe(15);

    const invalid = searchParamsSchema.safeParse({ maxPrice: 'free-ish' });
    expect(invalid.success).toBe(true);
    expect(invalid.data?.maxPrice).toBeUndefined();
  });
});

describe('parseSearchParams', () => {
  it('collapses repeated query keys (arrays) to their first value', () => {
    const parsed = parseSearchParams({ q: ['first', 'second'], date: 'today' });
    expect(parsed.q).toBe('first');
    expect(parsed.date).toBe('today');
  });

  it('ignores unknown keys and invalid values without throwing', () => {
    const parsed = parseSearchParams({ foo: 'bar', tod: 'midnight' });
    expect(parsed.tod).toBeUndefined();
  });
});

describe('hasActiveSearchInputs', () => {
  it('is false with no params', () => {
    expect(hasActiveSearchInputs(searchParamsSchema.parse({}))).toBe(false);
  });

  it('is true when only a facet param is present', () => {
    expect(hasActiveSearchInputs(searchParamsSchema.parse({ date: 'tonight' }))).toBe(true);
  });

  it('is true when maxPrice is 0', () => {
    expect(hasActiveSearchInputs(searchParamsSchema.parse({ maxPrice: '0' }))).toBe(true);
  });
});

describe('resolveSearch', () => {
  it('lets an in-query phrase win over the date param when both are present', () => {
    const params = searchParamsSchema.parse({ q: 'jazz this weekend', date: 'tonight' });
    const { text, filters } = resolveSearch(params, NOW);
    expect(text).toBe('jazz');
    expect(filters.window?.start.toISOString()).toBe(chi('2026-07-10T17:00:00-05:00'));
    expect(filters.window?.end.toISOString()).toBe(chi('2026-07-13T00:00:00-05:00'));
  });

  it('falls back to the date preset window when the query has no phrase', () => {
    const params = searchParamsSchema.parse({ q: 'jazz', date: 'tonight' });
    const { text, filters } = resolveSearch(params, NOW);
    expect(text).toBe('jazz');
    expect(filters.window?.start.toISOString()).toBe(chi('2026-07-07T19:00:00-05:00'));
    expect(filters.window?.end.toISOString()).toBe(chi('2026-07-08T03:00:00-05:00'));
  });

  it('maps free="1" to filters.free === true', () => {
    const params = searchParamsSchema.parse({ free: '1' });
    const { filters } = resolveSearch(params, NOW);
    expect(filters.free).toBe(true);
  });

  it('passes tod through as timeOfDay when the query has no time-of-day phrase', () => {
    const params = searchParamsSchema.parse({ tod: 'morning' });
    const { filters } = resolveSearch(params, NOW);
    expect(filters.timeOfDay).toBe('morning');
  });

  it('lets an in-query time-of-day phrase win over the tod param', () => {
    const params = searchParamsSchema.parse({ q: 'family fun sunday afternoon', tod: 'night' });
    const { filters } = resolveSearch(params, NOW);
    expect(filters.timeOfDay).toBe('afternoon');
  });

  it('coerces maxPrice through to filters.maxPrice', () => {
    const params = searchParamsSchema.parse({ maxPrice: '25' });
    const { filters } = resolveSearch(params, NOW);
    expect(filters.maxPrice).toBe(25);
  });

  it('produces no text and no window/facets for an empty query', () => {
    const params = searchParamsSchema.parse({});
    const { text, filters } = resolveSearch(params, NOW);
    expect(text).toBeUndefined();
    expect(filters).toEqual({
      window: undefined,
      category: undefined,
      venue: undefined,
      neighborhood: undefined,
      free: undefined,
      vibe: undefined,
      audience: undefined,
      timeOfDay: undefined,
      maxPrice: undefined,
    });
  });
});

describe('custom date range', () => {
  it('resolves from/to into a Chicago whole-day window', () => {
    const { filters } = resolveSearch(
      parseSearchParams({ from: '2026-07-10', to: '2026-07-12' }),
      new Date('2026-07-08T12:00:00Z'),
    );
    expect(filters.window?.start.toISOString()).toBe('2026-07-10T05:00:00.000Z'); // Jul 10 00:00 CDT
    expect(filters.window?.end.toISOString()).toBe('2026-07-13T05:00:00.000Z'); // Jul 13 00:00 CDT (exclusive)
  });
  it('drops malformed and inverted ranges', () => {
    expect(parseSearchParams({ from: 'nonsense', to: '2026-07-12' }).from).toBeUndefined();
    const { filters } = resolveSearch(
      parseSearchParams({ from: '2026-07-12', to: '2026-07-10' }),
      new Date('2026-07-08T12:00:00Z'),
    );
    expect(filters.window).toBeUndefined();
  });
  it('counts a complete range as an active search input', () => {
    expect(hasActiveSearchInputs(parseSearchParams({ from: '2026-07-10', to: '2026-07-12' }))).toBe(true);
  });
  it('drops regex-valid but impossible calendar days', () => {
    const { filters } = resolveSearch(
      parseSearchParams({ from: '2026-02-30', to: '2026-03-02' }),
      new Date('2026-02-01T12:00:00Z'),
    );
    expect(filters.window).toBeUndefined();
  });

  it('spans a DST spring-forward boundary correctly', () => {
    const { filters } = resolveSearch(
      parseSearchParams({ from: '2026-03-07', to: '2026-03-08' }),
      new Date('2026-03-01T12:00:00Z'),
    );
    expect(filters.window?.start.toISOString()).toBe('2026-03-07T06:00:00.000Z'); // 00:00 CST
    expect(filters.window?.end.toISOString()).toBe('2026-03-09T05:00:00.000Z'); // 00:00 CDT, exclusive — window crosses spring-forward
  });
});

describe('free-word facet mapping', () => {
  it('turns a free-only query into a pure facet search', () => {
    const { text, filters } = resolveSearch(parseSearchParams({ q: 'free' }), new Date());
    expect(filters.free).toBe(true);
    expect(text).toBeUndefined();
  });
});

describe('free-word facet mapping', () => {
  it('carries the parsed free flag into filters', () => {
    const { filters } = resolveSearch(parseSearchParams({ q: 'free family fun' }), new Date());
    expect(filters.free).toBe(true);
  });
});

describe('filter-bar params (view/sort/map/lat/lng)', () => {
  it('parses all five new params when valid', () => {
    const result = searchParamsSchema.safeParse({
      view: 'list',
      sort: 'near',
      map: '1',
      lat: '43.05',
      lng: '-87.9',
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      view: 'list',
      sort: 'near',
      map: '1',
      lat: 43.05,
      lng: -87.9,
    });
  });

  it('drops an invalid view value instead of failing the whole parse', () => {
    const result = searchParamsSchema.safeParse({ view: 'banana' });
    expect(result.success).toBe(true);
    expect(result.data?.view).toBeUndefined();
  });

  it('drops an invalid sort value instead of failing the whole parse', () => {
    const result = searchParamsSchema.safeParse({ sort: 'closest' });
    expect(result.success).toBe(true);
    expect(result.data?.sort).toBeUndefined();
  });

  it('drops a non-numeric lat/lng instead of crashing', () => {
    const result = searchParamsSchema.safeParse({ lat: 'abc', lng: 'xyz' });
    expect(result.success).toBe(true);
    expect(result.data?.lat).toBeUndefined();
    expect(result.data?.lng).toBeUndefined();
  });

  it('drops an invalid map literal', () => {
    const result = searchParamsSchema.safeParse({ map: 'yes' });
    expect(result.success).toBe(true);
    expect(result.data?.map).toBeUndefined();
  });

  it('does NOT trip hasActiveSearchInputs when only the five new params are present', () => {
    const params = searchParamsSchema.parse({
      view: 'list',
      sort: 'near',
      map: '1',
      lat: '43.05',
      lng: '-87.9',
    });
    expect(hasActiveSearchInputs(params)).toBe(false);
  });

  it('leaves existing param behavior unchanged alongside the new params', () => {
    const params = searchParamsSchema.parse({ date: 'tonight', view: 'list' });
    expect(hasActiveSearchInputs(params)).toBe(true);
  });
});
