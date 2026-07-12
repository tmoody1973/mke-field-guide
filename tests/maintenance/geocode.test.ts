import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGeocodeUrl, geocodeAddress, GEOCODE_TIMEOUT_MS, hasGeocodeKey } from '@/maintenance/geocode';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hasGeocodeKey', () => {
  it('is true when GEOCODE_EARTH_API_KEY is set, false when absent/empty', () => {
    vi.stubEnv('GEOCODE_EARTH_API_KEY', 'test-key');
    expect(hasGeocodeKey()).toBe(true);

    vi.stubEnv('GEOCODE_EARTH_API_KEY', '');
    expect(hasGeocodeKey()).toBe(false);
  });
});

describe('buildGeocodeUrl', () => {
  it('targets /v1/search with the address text, size=1, and the api key', () => {
    vi.stubEnv('GEOCODE_EARTH_API_KEY', 'test-key');

    const url = new URL(buildGeocodeUrl('1434 N Farwell Ave, Milwaukee, WI'));

    expect(url.origin + url.pathname).toBe('https://api.geocode.earth/v1/search');
    expect(url.searchParams.get('text')).toBe('1434 N Farwell Ave, Milwaukee, WI');
    expect(url.searchParams.get('size')).toBe('1');
    expect(url.searchParams.get('api_key')).toBe('test-key');
  });

  it('falls back to an empty api_key param when no key is set', () => {
    vi.stubEnv('GEOCODE_EARTH_API_KEY', '');

    const url = new URL(buildGeocodeUrl('123 Main St'));

    expect(url.searchParams.get('api_key')).toBe('');
  });
});

describe('geocodeAddress', () => {
  it('parses [lon, lat] from the first GeoJSON feature', async () => {
    vi.stubEnv('GEOCODE_EARTH_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          { geometry: { coordinates: [-87.8891, 43.0625] } },
          { geometry: { coordinates: [-1, -1] } },
        ],
      }),
    });

    const result = await geocodeAddress('1434 N Farwell Ave', fetchMock as unknown as typeof fetch);

    expect(result).toEqual({ lon: -87.8891, lat: 43.0625 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(buildGeocodeUrl('1434 N Farwell Ave'));
    expect(calledInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null on empty features', async () => {
    vi.stubEnv('GEOCODE_EARTH_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });

    const result = await geocodeAddress('Nowhere', fetchMock as unknown as typeof fetch);

    expect(result).toBeNull();
  });

  it('returns null on a non-200 response', async () => {
    vi.stubEnv('GEOCODE_EARTH_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });

    const result = await geocodeAddress('Somewhere', fetchMock as unknown as typeof fetch);

    expect(result).toBeNull();
  });

  it('returns null when fetch throws (e.g. timeout/network error) — never throws', async () => {
    vi.stubEnv('GEOCODE_EARTH_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockRejectedValue(new Error('network boom'));

    await expect(geocodeAddress('Somewhere', fetchMock as unknown as typeof fetch)).resolves.toBeNull();
  });

  it('returns null on a malformed response shape (schema mismatch)', async () => {
    vi.stubEnv('GEOCODE_EARTH_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nonsense: true }) });

    const result = await geocodeAddress('Somewhere', fetchMock as unknown as typeof fetch);

    expect(result).toBeNull();
  });

  it('returns null and never calls fetch when no key is configured', async () => {
    vi.stubEnv('GEOCODE_EARTH_API_KEY', '');
    const fetchMock = vi.fn();

    const result = await geocodeAddress('Somewhere', fetchMock as unknown as typeof fetch);

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes the documented timeout constant', () => {
    expect(GEOCODE_TIMEOUT_MS).toBe(10_000);
  });
});
