import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { crawlDetailPages, htmlAdapter } from '@/ingestion/adapters/html';
import { detailEnrichers } from '@/ingestion/adapters/html/sources';
import { resolveAdapter } from '@/ingestion/adapters/registry';
import type { FetchedRecord } from '@/ingestion/adapters/types';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/html/jsonld-sample.html'), 'utf8');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('htmlAdapter', () => {
  test('jsonld strategy fetches each listing url and extracts events', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html });
    vi.stubGlobal('fetch', mockFetch);
    const { records, parseSkipped } = await htmlAdapter.fetch({
      strategy: 'jsonld',
      listingUrls: ['https://example.com/events/'],
      sourceKey: 'sample',
    });
    expect(records).toHaveLength(3);
    expect(parseSkipped).toBe(0);
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
    const { records, parseSkipped } = await htmlAdapter.fetch({
      strategy: 'selectors',
      listingUrls: [url, url],
      sourceKey: 'milwaukee-world-festival',
    });
    expect(records).toHaveLength(61); // 61 day-records once — not 122, and not 34 collapsed
    expect(records.filter((r) => r.sourceEventId === 'mwf:summerfest')).toHaveLength(9);
    // Same listing fetched twice: 1 yearless card skipped per page, summed across both fetches.
    expect(parseSkipped).toBe(2);
  });

  test('registry routes html adapterType', () => {
    expect(resolveAdapter({ adapterType: 'html', config: {} }).adapterType).toBe('html');
  });

  describe('crawlDetails detail-page enrichment', () => {
    const TEST_KEY = 'crawl-details-test';

    beforeAll(() => {
      // Test-only enricher: detail body is the new startDate verbatim.
      detailEnrichers[TEST_KEY] = (record: FetchedRecord, detailHtml: string) => ({
        ...record,
        payload: { ...(record.payload as Record<string, unknown>), startDate: detailHtml.trim() },
      });
    });

    afterAll(() => {
      delete detailEnrichers[TEST_KEY];
    });

    const config = {
      strategy: 'jsonld' as const,
      listingUrls: ['https://example.com/events/'],
      sourceKey: TEST_KEY,
      crawlDetails: { limit: 10 },
    };

    test('enriches records via detail fetches; a rejected detail fetch keeps the record unenriched', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: async () => html }) // listing
        .mockResolvedValueOnce({ ok: true, text: async () => '2030-01-01T01:00:00.000Z' })
        .mockRejectedValueOnce(new Error('detail fetch down'))
        .mockResolvedValueOnce({ ok: true, text: async () => '2030-03-03T03:00:00.000Z' });
      vi.stubGlobal('fetch', mockFetch);
      const { records } = await htmlAdapter.fetch(config);
      expect(records).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(4); // 1 listing + 3 details
      const startDates = records.map((r) => (r.payload as { startDate?: string }).startDate);
      expect(startDates[0]).toBe('2030-01-01T01:00:00.000Z'); // enriched
      expect(startDates[1]).toBe('2026-09-01T19:00:00-05:00'); // failed fetch -> listing value kept
      expect(startDates[2]).toBe('2030-03-03T03:00:00.000Z'); // run continued past the failure
    });

    test('crawls at most `limit` detail pages', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: async () => html })
        .mockResolvedValue({ ok: true, text: async () => '2030-01-01T01:00:00.000Z' });
      vi.stubGlobal('fetch', mockFetch);
      await htmlAdapter.fetch({ ...config, crawlDetails: { limit: 1 } });
      expect(mockFetch).toHaveBeenCalledTimes(2); // 1 listing + 1 detail
    });

    test('without crawlDetails config, no detail pages are fetched', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html });
      vi.stubGlobal('fetch', mockFetch);
      await htmlAdapter.fetch({ ...config, crawlDetails: undefined });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  test('firecrawl-jsonld strategy posts to Firecrawl and parses rendered html', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc-test');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { html } }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const { records } = await htmlAdapter.fetch({
      strategy: 'firecrawl-jsonld',
      listingUrls: ['https://example.com/events/'],
      sourceKey: 'sample',
    });
    expect(records).toHaveLength(3);
    const [calledUrl, init] = mockFetch.mock.calls[0];
    expect(String(calledUrl)).toContain('api.firecrawl.dev');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer fc-test');
  });
});

describe('crawlDetailPages pacing and failure isolation', () => {
  const record = (id: string): FetchedRecord => ({
    sourceEventId: id,
    sourceUrl: `https://example.com/${id}`,
    payload: { id },
  });

  test('sleeps between detail fetches but not before the first', async () => {
    const sleeps: number[] = [];
    const sleepFn = async (ms: number) => { sleeps.push(ms); };
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>')));
    await crawlDetailPages([record('a'), record('b'), record('c')], 10, (r) => r, sleepFn);
    expect(sleeps).toEqual([250, 250]);
  });

  test('keeps crawling when an enricher throws, leaving that record unenriched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>')));
    const enricher = vi.fn((r: FetchedRecord) => {
      if (r.sourceEventId === 'a') throw new Error('boom');
      return { ...r, payload: { ...(r.payload as object), enriched: true } };
    });
    const out = await crawlDetailPages([record('a'), record('b')], 10, enricher, async () => {});
    expect((out[0].payload as { enriched?: boolean }).enriched).toBeUndefined();
    expect((out[1].payload as { enriched?: boolean }).enriched).toBe(true);
  });
});
