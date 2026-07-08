import { embed } from 'ai';
import { hasGatewayKey } from '@/enrichment/embed';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const DEFAULT_TIMEOUT_MS = 150;

/** Resolves to undefined after `ms` — the losing side of the race when embedding is slow. */
function timeoutAfter(ms: number): Promise<undefined> {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), ms));
}

async function embedOnce(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: EMBEDDING_MODEL, value: text });
  return embedding;
}

/**
 * Embeds the query text for the vector search leg. Returns undefined — triggering the FTS-only
 * fallback in `searchEvents` — when the gateway key is absent, the text is empty, the call times
 * out, or the embedding call fails for any reason. Never throws.
 */
export async function embedQueryWithTimeout(text: string, ms = DEFAULT_TIMEOUT_MS): Promise<number[] | undefined> {
  if (!hasGatewayKey() || !text) return undefined;
  try {
    return await Promise.race([embedOnce(text), timeoutAfter(ms)]);
  } catch {
    return undefined;
  }
}
