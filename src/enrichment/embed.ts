import { embedMany } from 'ai';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const MAX_PARALLEL_CALLS = 2;

/** Gates every enrichment AI call: absent key means search runs FTS-only, no network attempted. */
export function hasGatewayKey(): boolean {
  return !!process.env.AI_GATEWAY_API_KEY;
}

/** Embeds a batch of texts in one request, sorted the same order as the input. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL,
    values: texts,
    maxParallelCalls: MAX_PARALLEL_CALLS,
  });
  return embeddings;
}
