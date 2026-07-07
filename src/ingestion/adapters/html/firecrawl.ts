import { z } from 'zod';
import { fetchJson, requireEnv } from '../helpers';

const responseSchema = z.object({
  success: z.boolean(),
  data: z.object({ html: z.string() }),
});

export async function fetchRenderedHtml(url: string): Promise<string> {
  const apiKey = requireEnv('FIRECRAWL_API_KEY', 'get one at firecrawl.dev');
  const raw = await fetchJson(
    'https://api.firecrawl.dev/v1/scrape',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url, formats: ['html'] }),
    },
    `Firecrawl scrape ${url}`,
  );
  const parsed = responseSchema.parse(raw);
  if (!parsed.success) throw new Error(`Firecrawl scrape unsuccessful for ${url}`);
  return parsed.data.html;
}
