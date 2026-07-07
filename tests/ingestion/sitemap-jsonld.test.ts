import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { htmlAdapter } from '@/ingestion/adapters/html';
import {
  crawlSitemapJsonLd,
  parseSitemapEntries,
  selectDetailUrls,
} from '@/ingestion/adapters/html/sitemap';

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), 'tests/fixtures/html', name), 'utf8');

const sitemapXml = fixture('visit-milwaukee-sitemap.xml');
const detailHtml = fixture('visit-milwaukee-detail.html');
// The real rendered listing page: event cards but zero JSON-LD.
const listingHtml = fixture('visit-milwaukee.html');

const okText = (body: string) => ({ ok: true, text: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseSitemapEntries', () => {
  test('extracts loc and optional lastmod per url entry', () => {
    const entries = parseSitemapEntries(sitemapXml);
    expect(entries).toHaveLength(7);
    expect(entries[0]).toEqual({
      loc: 'https://www.visitmilwaukee.org/',
      lastmod: '2026-07-01T13:35:37Z',
    });
    expect(entries[4]).toEqual({ loc: 'https://www.visitmilwaukee.org/event/undated-event/22222/' });
  });
});

describe('selectDetailUrls', () => {
  const entries = parseSitemapEntries(sitemapXml);

  test('filters to urlFilter matches, newest lastmod first, undated entries last', () => {
    expect(selectDetailUrls(entries, '/event/', 10)).toEqual([
      'https://www.visitmilwaukee.org/event/newest-event/33333/',
      'https://www.visitmilwaukee.org/event/derek-hough-symphony-of-dance%3a-encore/19156/',
      'https://www.visitmilwaukee.org/event/older-event/11111/',
      'https://www.visitmilwaukee.org/event/undated-event/22222/',
    ]);
  });

  test('limit caps the crawl after ordering', () => {
    expect(selectDetailUrls(entries, '/event/', 2)).toEqual([
      'https://www.visitmilwaukee.org/event/newest-event/33333/',
      'https://www.visitmilwaukee.org/event/derek-hough-symphony-of-dance%3a-encore/19156/',
    ]);
  });
});

describe('htmlAdapter sitemap-jsonld strategy', () => {
  const config = {
    strategy: 'sitemap-jsonld',
    sourceKey: 'visit-milwaukee',
    sitemapUrl: 'https://www.visitmilwaukee.org/sitemap.xml',
    urlFilter: '/event/',
    limit: 2,
    delayMs: 1,
  };

  test('extracts detail-page JSON-LD with venue; a page without JSON-LD counts as parseSkipped', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okText(sitemapXml)) // sitemap
      .mockResolvedValueOnce(okText(listingHtml)) // newest-event: rendered page, no JSON-LD
      .mockResolvedValueOnce(okText(detailHtml)); // derek-hough detail page
    vi.stubGlobal('fetch', mockFetch);

    const { records, parseSkipped } = await htmlAdapter.fetch(config);

    expect(mockFetch).toHaveBeenCalledTimes(3); // 1 sitemap + limit(2) details
    expect(parseSkipped).toBe(1);
    expect(records).toHaveLength(1);
    const payload = records[0].payload as Record<string, unknown>;
    expect(payload.name).toBe('Derek Hough - Symphony of Dance: Encore');
    expect(payload.venueName).toBe('The Riverside Theater');
    expect(payload.venueAddress).toContain('116 W. Wisconsin Avenue');
    expect(payload.venueLat).toBeCloseTo(43.0389679);
    // Enricher upgraded JSON-LD's date-only 2026-07-07 using the page's inline
    // "8:00 PM"/"10:00 PM" vars (CDT, UTC-5).
    expect(payload.startDate).toBe('2026-07-08T01:00:00.000Z');
    expect(payload.endDate).toBe('2026-07-08T03:00:00.000Z');
  });

  test('normalize produces a valid event from an extracted record', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okText(sitemapXml))
      .mockResolvedValue(okText(detailHtml));
    vi.stubGlobal('fetch', mockFetch);
    const { records } = await htmlAdapter.fetch({ ...config, limit: 1 });
    const normalized = htmlAdapter.normalize(records[0]);
    expect(normalized).not.toBeNull();
    expect(normalized?.title).toBe('Derek Hough - Symphony of Dance: Encore');
    expect(normalized?.startAt.toISOString()).toBe('2026-07-08T01:00:00.000Z');
  });

  test('a failed detail fetch counts as parseSkipped and never aborts the crawl', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okText(sitemapXml))
      .mockRejectedValueOnce(new Error('detail fetch down'))
      .mockResolvedValueOnce(okText(detailHtml));
    vi.stubGlobal('fetch', mockFetch);
    const { records, parseSkipped } = await htmlAdapter.fetch(config);
    expect(parseSkipped).toBe(1);
    expect(records).toHaveLength(1);
  });

  test('rejects a config missing sitemap fields', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      htmlAdapter.fetch({ strategy: 'sitemap-jsonld', sourceKey: 'visit-milwaukee' }),
    ).rejects.toThrow();
  });
});

describe('crawlSitemapJsonLd pacing', () => {
  test('sleeps delayMs between detail fetches but not before the first', async () => {
    const sleeps: number[] = [];
    const sleepFn = async (ms: number) => { sleeps.push(ms); };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okText(sitemapXml))
      .mockResolvedValue(okText(detailHtml)));
    await crawlSitemapJsonLd(
      {
        strategy: 'sitemap-jsonld',
        sourceKey: 'visit-milwaukee',
        sitemapUrl: 'https://www.visitmilwaukee.org/sitemap.xml',
        urlFilter: '/event/',
        limit: 3,
        delayMs: 2000,
      },
      sleepFn,
    );
    expect(sleeps).toEqual([2000, 2000]);
  });
});
