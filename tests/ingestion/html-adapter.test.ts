import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { htmlAdapter } from '@/ingestion/adapters/html';
import { resolveAdapter } from '@/ingestion/adapters/registry';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/html/jsonld-sample.html'), 'utf8');

afterEach(() => vi.unstubAllGlobals());

describe('htmlAdapter', () => {
  test('jsonld strategy fetches each listing url and extracts events', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html });
    vi.stubGlobal('fetch', mockFetch);
    const records = await htmlAdapter.fetch({
      strategy: 'jsonld',
      listingUrls: ['https://example.com/events/'],
      sourceKey: 'sample',
    });
    expect(records).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('unknown selector parser throws a clear error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => html }));
    await expect(
      htmlAdapter.fetch({
        strategy: 'selectors',
        listingUrls: ['https://example.com/'],
        sourceKey: 'nonexistent',
      }),
    ).rejects.toThrow('No selector parser registered for source: nonexistent');
  });

  test('dedupe keeps same-id records with different startDates, collapses identical pairs', async () => {
    // Two listing urls returning the same page: per-day records for one multi-day
    // event share a sourceEventId but differ in startDate — all must survive one
    // pass and still collapse across the duplicate listing fetch.
    const mwfHtml = readFileSync(
      join(process.cwd(), 'tests/fixtures/html/milwaukee-world-festival.html'),
      'utf8',
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => mwfHtml }));
    const url = 'https://www.milwaukeeworldfestival.com/find-events/calendar';
    const records = await htmlAdapter.fetch({
      strategy: 'selectors',
      listingUrls: [url, url],
      sourceKey: 'milwaukee-world-festival',
    });
    expect(records).toHaveLength(61); // 61 day-records once — not 122, and not 34 collapsed
    expect(records.filter((r) => r.sourceEventId === 'mwf:summerfest')).toHaveLength(9);
  });

  test('registry routes html adapterType', () => {
    expect(resolveAdapter({ adapterType: 'html', config: {} }).adapterType).toBe('html');
  });

  test('firecrawl-jsonld strategy posts to Firecrawl and parses rendered html', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc-test');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { html } }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const records = await htmlAdapter.fetch({
      strategy: 'firecrawl-jsonld',
      listingUrls: ['https://example.com/events/'],
      sourceKey: 'sample',
    });
    expect(records).toHaveLength(3);
    const [calledUrl, init] = mockFetch.mock.calls[0];
    expect(String(calledUrl)).toContain('api.firecrawl.dev');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer fc-test');
    vi.unstubAllEnvs();
  });
});
