import { createHash } from 'node:crypto';

// Distinct from any real description text: keeps "no description was ever captured"
// (null) distinguishable from "the source explicitly returned an empty string".
const NULL_DESCRIPTION_SENTINEL = '<none>';

/** Deterministic sha256 hex of the title/description pair that gates re-embedding. */
export function contentFingerprint(e: { title: string; description: string | null }): string {
  const description = e.description === null ? NULL_DESCRIPTION_SENTINEL : e.description;
  return createHash('sha256').update(`${e.title}\n${description}`).digest('hex');
}

interface EmbeddingSource {
  title: string;
  description: string | null;
  category: string | null;
  vibeTags: string[] | null;
  audienceTags: string[] | null;
  venueName: string | null;
}

/** Ordered, human-readable fields available to embed; only present ones are included. */
function embeddingTextParts(e: EmbeddingSource): string[] {
  const parts: string[] = [e.title];
  if (e.venueName) parts.push(e.venueName);
  if (e.category) parts.push(e.category);
  if (e.description) parts.push(e.description);
  if (e.vibeTags && e.vibeTags.length > 0) parts.push(e.vibeTags.join(', '));
  if (e.audienceTags && e.audienceTags.length > 0) parts.push(e.audienceTags.join(', '));
  return parts;
}

/** Builds the plain-text blob passed to the embedding model: title first, then context. */
export function buildEmbeddingText(e: EmbeddingSource): string {
  return embeddingTextParts(e).join('\n');
}
