import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { reviewErrorMessage } from '@/lib/backstory';
import { episodeSchema, queueSchema } from '@/lib/backstory-types';

const QUEUE_ROW = {
  storyId: 'k1', title: 'Café Corazón and turkey talk', showSlug: 'this-bites', showName: 'This Bites',
  reviewer: 'Tarik Moody', contentType: 'episode', publishedAt: 1758207600000, stage: 'geocoded',
  reviewStatus: 'pending', doNotUse: false, needsReview: 'new',
};

const EPISODE = {
  story: {
    storyId: 'k1', title: 'Café Corazón and turkey talk', showSlug: 'this-bites', showName: 'This Bites', reviewer: 'Tarik Moody',
    publishedAt: 1758207600000, audioUrl: 'https://example.com/a.mp3', permalink: null, stage: 'geocoded', reviewStatus: 'pending',
    doNotUse: false, proposedSummary: 'The hosts preview a festival.', summary: null, latestRunId: 'run-1', approvedRunId: null,
    approvedBy: null, approvedAt: null,
  },
  speakers: [{ label: 'spk_0', name: null, source: null, sample: 'Welcome to This Bites.', startMs: 0, endMs: 3000 }],
  mentions: [{ id: 'm1', entityType: 'person', name: 'Joe Sasto', quote: 'chefs Joe Sasto and Dan Jacobs', startMs: 20000, subjectConfidence: 0.9, reviewStatus: 'pending', doNotUse: false }],
  places: [{ id: 'p1', mentionId: 'm2', name: 'Café Corazón', officialName: null, category: 'restaurant', geocodeLabel: null, geocodeConfidence: null, neighborhood: null, quote: 'a bittersweet farewell to Café Corazón in Bay View', startMs: 4000, reviewStatus: 'pending' }],
  topics: [{ id: 't1', topic: 'food-drink', confidence: 0.95, quote: 'a bittersweet farewell to Café Corazón', startMs: 4000, reviewStatus: 'pending' }],
  actions: [{ id: 'a1', kind: 'visit', label: 'Visit Café Corazón in Riverwest', quote: 'their Riverwest and Brown Deer locations remain open', startMs: 9000, reviewStatus: 'pending', place: 'Café Corazón' }],
};

describe('Backstory payload schemas', () => {
  it('accept the shapes Backstory returns', () => {
    expect(queueSchema.parse([QUEUE_ROW])).toHaveLength(1);
    expect(episodeSchema.parse(EPISODE).places[0].name).toBe('Café Corazón');
  });
  it('reject a payload missing an evidence quote', () => {
    const { quote: _dropped, ...noQuote } = EPISODE.topics[0];
    expect(() => episodeSchema.parse({ ...EPISODE, topics: [noQuote] })).toThrow();
  });
});

describe('reviewErrorMessage', () => {
  it('explains each Backstory refusal in plain words', () => {
    expect(reviewErrorMessage(new ConvexError({ code: 'not_a_reviewer' }))).toBe("You're signed in, but not on the Backstory reviewer list.");
    expect(reviewErrorMessage(new ConvexError({ code: 'search_busy' }))).toBe('The booking-link search is busy. Try again in a minute.');
    expect(reviewErrorMessage(new ConvexError({ code: 'stale_run' }))).toBe('This episode was re-processed since you opened it. Reload to review the new version.');
    expect(reviewErrorMessage(new ConvexError({ code: 'invalid_summary' }))).toBe('The summary must be between 1 and 1,500 characters.');
    expect(reviewErrorMessage(new ConvexError({ code: 'not_ready' }))).toBe('Still finding map pins for this episode. Try again in a minute.');
    expect(reviewErrorMessage(new ConvexError({ code: 'not_locatable' }))).toBe('Only places people can visit get a location, never a person.');
    expect(reviewErrorMessage(new ConvexError({ code: 'no_match' }))).toBe("Couldn't find that address in the Milwaukee area. Check it and try again.");
  });
  it('never leaks an unexpected error to the page', () => {
    expect(reviewErrorMessage(new Error('connect ECONNREFUSED 10.0.0.1'))).toBe('Backstory is unavailable right now. Try again in a minute.');
  });
});

