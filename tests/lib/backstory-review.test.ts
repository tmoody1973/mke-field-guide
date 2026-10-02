import { describe, expect, it } from 'vitest';
import { clock, directAudioUrl, minutesEstimate, publishPreview, shortcutAction, splitForReview, toReviewItems } from '@/lib/backstory-review';
import type { Episode } from '@/lib/backstory-types';

const base = { quote: 'a quote long enough', startMs: 1000, removeReason: null };
const EPISODE = {
  story: {} as Episode['story'],
  speakers: [],
  mentions: [
    { id: 'm1', entityType: 'person', name: 'Joe Sasto', subjectConfidence: 0.9, reviewStatus: 'pending', doNotUse: false, attention: null, ...base },
    { id: 'm2', entityType: 'person', name: 'Luke Zaum', subjectConfidence: 0.3, reviewStatus: 'pending', doNotUse: false, attention: 'passing_mention', ...base },
    { id: 'm3', entityType: 'organization', name: '414 Art Revival', subjectConfidence: null, reviewStatus: 'rejected', doNotUse: false, attention: null, ...base, removeReason: 'wrong' },
  ],
  places: [
    { id: 'p1', mentionId: 'm9', name: 'Cafe Corazon', officialName: 'Café Corazón', category: 'restaurant', geocodeLabel: null, geocodeConfidence: null, neighborhood: null, reviewStatus: 'pending', attention: 'no_pin', ...base },
    { id: 'p2', mentionId: 'm8', name: 'Lupi & Iris', officialName: null, category: 'restaurant', geocodeLabel: 'x', geocodeConfidence: 0.9, neighborhood: null, reviewStatus: 'pending', attention: null, ...base },
  ],
  topics: [{ id: 't1', topic: 'food-drink', confidence: 0.9, reviewStatus: 'approved', attention: null, ...base }],
  actions: [{ id: 'a1', kind: 'visit', label: 'Visit Café Corazón', place: 'Café Corazón', reviewStatus: 'pending', attention: null, ...base }],
} as unknown as Episode;

describe('toReviewItems / splitForReview', () => {
  it('puts undecided flagged items in "needs you", everything else in "looks right", in a stable order', () => {
    const { needsYou, looksRight } = splitForReview(toReviewItems(EPISODE));
    expect(needsYou.map((i) => i.title)).toEqual(['Café Corazón', 'Luke Zaum']);
    expect(looksRight.map((i) => i.title)).toEqual(['Lupi & Iris', 'Joe Sasto', '414 Art Revival', 'food-drink', 'Visit Café Corazón']);
  });
  it('lets places and organizations be located and renamed, but not topics', () => {
    const items = toReviewItems(EPISODE);
    expect(items.find((i) => i.id === 'm3')).toMatchObject({ canLocate: true, renameMentionId: 'm3' });
    expect(items.find((i) => i.id === 'p1')).toMatchObject({ canLocate: true, renameMentionId: 'm9', hasPin: false });
    expect(items.find((i) => i.id === 't1')).toMatchObject({ canLocate: false, renameMentionId: null });
  });
});

describe('publishPreview', () => {
  it('counts what Alexa could share if published now: removed items and unpinned pending places stay off', () => {
    expect(publishPreview(toReviewItems(EPISODE))).toEqual({ people: 2, organizations: 0, places: 1, topics: 1, actions: 1 });
  });
});

describe('minutesEstimate', () => {
  it('about 45 seconds per item that needs you and 5 per other item, at least a minute', () => {
    expect(minutesEstimate(20, 4)).toBe(5);
    expect(minutesEstimate(0, 0)).toBe(1);
  });
});

describe('shortcutAction', () => {
  it('maps J/K/Y/R/H and ? when focus is not in a text field', () => {
    expect(['j', 'k', 'y', 'r', 'h', '?'].map((key) => shortcutAction(key, 'BUTTON'))).toEqual(['next', 'prev', 'keep', 'remove', 'hear', 'help']);
  });
  it('stays out of the way while typing', () => {
    expect(shortcutAction('j', 'INPUT')).toBeNull();
    expect(shortcutAction('y', 'TEXTAREA')).toBeNull();
    expect(shortcutAction('j', 'SELECT')).toBeNull();
  });
});

describe('directAudioUrl', () => {
  it('skips the Podtrac tracking hop, which ad blockers block, and goes straight to Dovetail', () => {
    expect(directAudioUrl('https://dts.podtrac.com/redirect.mp3/dovetail.prxu.org/13497/abc/UM.mp3?x=1')).toBe('https://dovetail.prxu.org/13497/abc/UM.mp3?x=1');
  });
  it('leaves any other address alone', () => {
    expect(directAudioUrl('https://example.com/a.mp3')).toBe('https://example.com/a.mp3');
  });
});

describe('clock', () => {
  it('shows minutes and seconds', () => {
    expect(clock(95_400)).toBe('1:35');
    expect(clock(0)).toBe('0:00');
  });
});
