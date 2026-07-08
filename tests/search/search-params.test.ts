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
