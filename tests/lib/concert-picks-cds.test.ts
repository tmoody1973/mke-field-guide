import { describe, expect, it, vi } from 'vitest';
import { fetchLatestConcertPicks, cdsParagraphs } from '@/lib/concert-picks-cds';

const DOC = {
  id: 'g-s921-16698', title: 'MKE Concert Picks: Beet Street wins again, Beck finally returns', publishDateTime: '2026-09-30T12:00:00-05:00',
  webPages: [{ href: 'https://radiomilwaukee.org/concerts/2026-09-30/milwaukee-concerts-this-week', rels: ['canonical'] }],
  collections: [{ href: '/v1/documents/1178217169', rels: ['byline'] }],
  layout: [{ href: '#/assets/a' }, { href: '#/assets/b' }, { href: '#/assets/c' }],
  assets: {
    a: { text: 'After giving yourself a couple days to regroup, point yourself toward <a href="x">Landmark Credit Union Live</a> for Beck.' },
    b: { text: '<h2>Best concerts in Milwaukee this week</h2>' },
    c: { text: 'Oct. 2: Bright Eyes w/Lullaby For The Working Class @ Turner Hall, 7:30 p.m.<br>Oct. 3: Cracker @ Shank Hall, noon' },
  },
};
const OTHER = { ...DOC, id: 'g-1', title: 'Milwaukee Music Premiere: Glitzy', webPages: [{ href: 'https://radiomilwaukee.org/local-music/x', rels: ['canonical'] }] };

function fakeCds(byline = 'Brett Krzykowski') {
  return vi.fn(async (url: string) => {
    if (url.includes('/documents/1178217169')) return new Response(JSON.stringify({ resources: [{ id: '1178217169', title: byline }] }));
    return new Response(JSON.stringify({ resources: [OTHER, DOC] }));
  });
}

describe('cdsParagraphs', () => {
  it('text in layout order; line breaks keep list lines apart; markup removed', () => {
    expect(cdsParagraphs(DOC)).toEqual([
      'After giving yourself a couple days to regroup, point yourself toward Landmark Credit Union Live for Beck.',
      'Best concerts in Milwaukee this week',
      'Oct. 2: Bright Eyes w/Lullaby For The Working Class @ Turner Hall, 7:30 p.m.\nOct. 3: Cracker @ Shank Hall, noon',
    ]);
  });
});

describe('fetchLatestConcertPicks', () => {
  it("finds the station's newest Concert Picks story and its writer", async () => {
    const fetch = fakeCds();
    const article = await fetchLatestConcertPicks(fetch as never, 'token');
    expect(article).toMatchObject({ id: 'g-s921-16698', byline: 'Brett Krzykowski', url: 'https://radiomilwaukee.org/concerts/2026-09-30/milwaukee-concerts-this-week' });
    expect(article?.paragraphs).toHaveLength(3);
    const [first] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(first).toContain('sort=publishDateTime%3Adesc');
  });
  it('none this week → null; CDS error → throws', async () => {
    expect(await fetchLatestConcertPicks((async () => new Response(JSON.stringify({ resources: [OTHER] }))) as never, 't')).toBeNull();
    await expect(fetchLatestConcertPicks((async () => new Response('no', { status: 503 })) as never, 't')).rejects.toThrow(/503/);
  });
});
