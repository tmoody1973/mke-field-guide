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

  test('registry routes html adapterType', () => {
    expect(resolveAdapter({ adapterType: 'html', config: {} }).adapterType).toBe('html');
  });
});
