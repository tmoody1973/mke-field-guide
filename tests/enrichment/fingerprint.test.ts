import { describe, expect, it } from 'vitest';
import { buildEmbeddingText, contentFingerprint } from '@/enrichment/fingerprint';

describe('contentFingerprint', () => {
  it('produces a stable 64-char sha256 hex digest for the same input', () => {
    const event = { title: 'Summerfest', description: 'Music on the lakefront' };
    const first = contentFingerprint(event);
    const second = contentFingerprint({ ...event });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the title changes', () => {
    const before = contentFingerprint({ title: 'Summerfest', description: null });
    const after = contentFingerprint({ title: 'Summerfest 2026', description: null });
    expect(before).not.toBe(after);
  });

  it('changes when the description changes', () => {
    const before = contentFingerprint({ title: 'Summerfest', description: 'Day one' });
    const after = contentFingerprint({ title: 'Summerfest', description: 'Day two' });
    expect(before).not.toBe(after);
  });

  it('treats a null description as distinct from an empty-string description', () => {
    const nullDescription = contentFingerprint({ title: 'Summerfest', description: null });
    const emptyDescription = contentFingerprint({ title: 'Summerfest', description: '' });
    expect(nullDescription).not.toBe(emptyDescription);
  });
});

describe('buildEmbeddingText', () => {
  it('includes title, venue, category, description, and tags when present', () => {
    const text = buildEmbeddingText({
      title: 'Summerfest',
      description: 'Music on the lakefront',
      category: 'music',
      vibeTags: ['outdoor', 'lively'],
      audienceTags: ['family-friendly'],
      venueName: 'Henry Maier Festival Park',
    });
    expect(text).toContain('Summerfest');
    expect(text).toContain('Henry Maier Festival Park');
    expect(text).toContain('music');
    expect(text).toContain('Music on the lakefront');
    expect(text).toContain('outdoor');
    expect(text).toContain('family-friendly');
  });

  it('omits absent fields without leaving literal "null" in the text', () => {
    const text = buildEmbeddingText({
      title: 'Mystery Show',
      description: null,
      category: null,
      vibeTags: null,
      audienceTags: null,
      venueName: null,
    });
    expect(text).toBe('Mystery Show');
    expect(text).not.toContain('null');
  });
});
