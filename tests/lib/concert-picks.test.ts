import { describe, expect, it } from 'vitest';
import { isConcertPicks, parsePicks, spotlightFor } from '@/lib/concert-picks';
import article from '../fixtures/concert-picks-2026-09-30.json';

const published = new Date(article.publishDateTime);

describe('parsePicks', () => {
  it('reads every line of the real Sept. 30 list', () => {
    const { picks, unparsed } = parsePicks(article.paragraphs, published);
    expect(picks).toHaveLength(20);
    expect(unparsed).toEqual([]);
    expect(picks.find((p) => p.headliner === 'Bright Eyes')).toEqual({
      date: '2026-10-02', headliner: 'Bright Eyes', openers: ['Lullaby For The Working Class'], venue: 'Turner Hall',
      time: '7:30 p.m.', line: 'Oct. 2: Bright Eyes w/Lullaby For The Working Class @ Turner Hall, 7:30 p.m.', order: 5,
    });
  });
  it('noon, comma-separated bills, and venues with apostrophes', () => {
    const { picks } = parsePicks(article.paragraphs, published);
    expect(picks.find((p) => p.headliner === 'Cracker')).toMatchObject({ date: '2026-10-03', venue: 'Shank Hall', time: 'noon' });
    expect(picks.find((p) => p.headliner === 'Charming Disaster')).toMatchObject({ openers: ['Duo Mercury'], venue: 'Anodyne' });
    expect(picks.find((p) => p.headliner === 'Jesse Garwood Club')).toMatchObject({ venue: "Linneman's", openers: ['Becca Murray & The Wildflowers', 'Matty Timmons', 'Jackson Jaymes'] });
  });
  it('rolls the year over for a list that crosses New Year', () => {
    const { picks } = parsePicks(['Best concerts in Milwaukee this week', 'Dec. 31: A @ The Rave, 9 p.m.Jan. 2: B @ Cactus Club, 8 p.m.'], new Date('2026-12-30T12:00:00-06:00'));
    expect(picks.map((p) => p.date)).toEqual(['2026-12-31', '2027-01-02']);
  });
  it('a line it cannot read is reported, not guessed', () => {
    const { picks, unparsed } = parsePicks(['Best concerts in Milwaukee this week', 'Oct. 1: Somebody at The Rave 7 p.m.Oct. 2: Mt. Joy @ Landmark Credit Union Live, 8 p.m.'], published);
    expect(picks.map((p) => p.headliner)).toEqual(['Mt. Joy']);
    expect(unparsed).toEqual(['Oct. 1: Somebody at The Rave 7 p.m.']);
  });
});

describe('spotlightFor / isConcertPicks', () => {
  it('the write-up paragraphs that name the headliner, before the list', () => {
    expect(spotlightFor(article.paragraphs, 'Beck')).toMatch(/^After giving yourself a couple days to regroup/);
    expect(spotlightFor(article.paragraphs, 'Cracker')).toBeNull();
  });
  it('recognizes a Concert Picks article by title and address', () => {
    expect(isConcertPicks({ title: article.title, url: article.url })).toBe(true);
    expect(isConcertPicks({ title: 'MKE Concert Picks: x', url: 'https://radiomilwaukee.org/local-music/x' })).toBe(false);
    expect(isConcertPicks({ title: 'Milwaukee Music Premiere: x', url: 'https://radiomilwaukee.org/concerts/x' })).toBe(false);
  });
});
