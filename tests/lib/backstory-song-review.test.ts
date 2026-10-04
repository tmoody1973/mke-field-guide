import { describe, expect, it } from 'vitest';
import { songDetail, toReviewItems } from '@/lib/backstory-review';
import { episodeSchema, type Episode } from '@/lib/backstory-types';

const SONG = {
  songId: 'sg1', kind: 'premiere', artist: 'Glitzy', title: 'Effort', album: "Say Sorry / You're Right", releaseDate: '2026-10-23',
  credits: [{ role: 'recording and mixing', name: 'Shane Hochstetler' }, { role: 'mastering', name: 'Carl Saff' }],
  releaseShow: { venue: 'Sugar Maple', date: '2026-10-23' }, audioUrl: 'https://cpa.ds.npr.org/s921/audio/2026/09/glitzy-effort.mp3',
  reviewStatus: 'pending', removeReason: null,
};
const EMPTY = { story: {} as Episode['story'], speakers: [], mentions: [], places: [], topics: [], actions: [] };

describe('song record on the review page', () => {
  it('episodeSchema reads a song, and older payloads without one', () => {
    expect(episodeSchema.shape.song.parse(SONG)).toMatchObject({ artist: 'Glitzy', title: 'Effort' });
    expect(episodeSchema.shape.song.parse(undefined)).toBeNull();
  });
  it('the song becomes one reviewable item, first', () => {
    const [item] = toReviewItems({ ...EMPTY, song: SONG } as unknown as Episode);
    expect(item).toMatchObject({ key: 'songs:sg1', table: 'songs', id: 'sg1', kind: 'song', title: 'Glitzy, "Effort"', status: 'pending' });
    expect(toReviewItems({ ...EMPTY, song: null } as unknown as Episode)).toEqual([]);
  });
  it('songDetail lists what an editor checks', () => {
    expect(songDetail(SONG as never)).toBe("Say Sorry / You're Right · released 2026-10-23 · Shane Hochstetler (recording and mixing), Carl Saff (mastering) · release show: Sugar Maple, 2026-10-23");
    expect(songDetail({ artist: 'Tank & The Bangas', credits: [], setList: ['Boxes & Squares', 'Move'] } as never)).toBe('set list: Boxes & Squares, Move');
  });
});
