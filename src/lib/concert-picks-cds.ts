import { isConcertPicks } from '@/lib/concert-picks';
import type { ConcertPicksArticle } from '@/queries/concert-picks-import';

const CDS = 'https://content.api.npr.org/v1';
const STATION = 'https://organization.api.npr.org/v4/services/s921'; // Radio Milwaukee
const NEWEST = 50; // Concert Picks is weekly; the newest 50 station stories cover well over a week

interface CdsLink { href: string; rels?: string[] }
interface CdsDoc {
  id: string; title: string; publishDateTime: string;
  webPages?: CdsLink[]; collections?: CdsLink[]; layout?: { href: string }[]; assets?: Record<string, { text?: string }>;
}

/** The story's text in layout order: markup removed, line breaks kept so a list's lines stay apart. */
export function cdsParagraphs(doc: CdsDoc): string[] {
  return (doc.layout ?? [])
    .map(({ href }) => doc.assets?.[href.replace('#/assets/', '')]?.text ?? '')
    .map((html) => html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
      .trim())
    .filter(Boolean);
}

async function cds(fetchImpl: typeof fetch, url: string, token: string): Promise<{ resources?: CdsDoc[] }> {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`CDS request failed: HTTP ${response.status} for ${url}`);
  return response.json();
}

/** Radio Milwaukee's newest MKE Concert Picks article, with its writer's name; null when none is recent. */
export async function fetchLatestConcertPicks(fetchImpl: typeof fetch, token: string): Promise<ConcertPicksArticle | null> {
  const params = new URLSearchParams({ ownerHrefs: STATION, profileIds: 'story', sort: 'publishDateTime:desc', limit: String(NEWEST) });
  const { resources = [] } = await cds(fetchImpl, `${CDS}/documents?${params}`, token);
  const canonical = (doc: CdsDoc) => doc.webPages?.find((p) => p.rels?.includes('canonical'))?.href ?? null;
  const doc = resources.find((d) => isConcertPicks({ title: d.title, url: canonical(d) }));
  if (!doc) return null;
  const bylineHref = doc.collections?.find((c) => c.rels?.includes('byline'))?.href;
  const byline = bylineHref ? (await cds(fetchImpl, `${CDS}${bylineHref.replace(/^\/v1/, '')}`, token)).resources?.[0]?.title : undefined;
  return {
    id: doc.id, title: doc.title, url: canonical(doc)!, byline: byline ?? 'Radio Milwaukee',
    publishDateTime: doc.publishDateTime, paragraphs: cdsParagraphs(doc),
  };
}
