import { describe, expect, it } from 'vitest';
import { parseApproval, parseDecision, parseDoNotUse, parseNeighborhood, parseSpeaker } from '@/app/actions/admin-backstory';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe('Backstory form parsers', () => {
  it('parses an item decision into the mutation arguments', () => {
    expect(parseDecision(form({ storyId: 's1', table: 'places', id: 'p1', status: 'rejected' }))).toEqual({
      ok: true, storyId: 's1', args: { item: { table: 'places', id: 'p1' }, status: 'rejected' },
    });
  });
  it('refuses a table or status Backstory does not have', () => {
    expect(parseDecision(form({ storyId: 's1', table: 'stories', id: 'x', status: 'approved' })).ok).toBe(false);
    expect(parseDecision(form({ storyId: 's1', table: 'places', id: 'p1', status: 'maybe' })).ok).toBe(false);
  });
  it('carries the run id with an approval so a stale page is caught', () => {
    expect(parseApproval(form({ storyId: 's1', runId: 'run-1', summary: 'A summary.' }))).toEqual({
      ok: true, storyId: 's1', args: { storyId: 's1', runId: 'run-1', summary: 'A summary.' },
    });
  });
  it('allows an empty speaker name (it clears the name)', () => {
    expect(parseSpeaker(form({ storyId: 's1', label: 'spk_0', name: '' }))).toMatchObject({ ok: true, args: { name: '' } });
  });
  it('only accepts a neighborhood from the Field Guide list, or none', () => {
    expect(parseNeighborhood(form({ storyId: 's1', placeId: 'p1', neighborhood: 'Bay View' }))).toMatchObject({ ok: true, args: { neighborhood: 'Bay View' } });
    expect(parseNeighborhood(form({ storyId: 's1', placeId: 'p1', neighborhood: '' }))).toMatchObject({ ok: true, args: { neighborhood: null } });
    expect(parseNeighborhood(form({ storyId: 's1', placeId: 'p1', neighborhood: 'Atlantis' })).ok).toBe(false);
  });
  it('parses the do-not-use toggle for a story or a mention', () => {
    expect(parseDoNotUse(form({ storyId: 's1', table: 'mentions', id: 'm1', doNotUse: 'true' }))).toEqual({
      ok: true, storyId: 's1', args: { target: { table: 'mentions', id: 'm1' }, doNotUse: true },
    });
  });
});
