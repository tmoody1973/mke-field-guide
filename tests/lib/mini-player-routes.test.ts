import { describe, expect, it } from 'vitest';
import { showsMiniPlayer } from '@/lib/site';

describe('showsMiniPlayer', () => {
  it('shows the 88Nine player on public pages', () => {
    expect(showsMiniPlayer('/')).toBe(true);
    expect(showsMiniPlayer('/events/tonight')).toBe(true);
    expect(showsMiniPlayer('/administer-fun')).toBe(true); // only the admin section, not lookalike paths
  });
  it('hides it in the admin, where it covered the review page\'s publish bar', () => {
    expect(showsMiniPlayer('/admin')).toBe(false);
    expect(showsMiniPlayer('/admin/backstory/abc')).toBe(false);
  });
});
