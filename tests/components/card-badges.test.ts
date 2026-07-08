import { describe, expect, it } from 'vitest';
import { audienceLabel, cardBadges } from '@/components/card-badges';

const base = {
  eventId: 'e1', slug: 's', title: 'T', venueName: null, neighborhood: null, category: 'music',
  status: 'scheduled', isFree: null, priceMin: null, priceMax: null, audienceTags: [] as string[],
  isStationEvent: false,
};

describe('cardBadges', () => {
  it('orders cancelled > free > station > audience', () => {
    const badges = cardBadges({
      ...base, status: 'cancelled', isFree: true, isStationEvent: true, audienceTags: ['21-plus'],
    });
    expect(badges.map((badge) => badge.label)).toEqual(['Cancelled', 'Free', 'Radio Milwaukee', '21+']);
    expect(badges[0].strike).toBe(true);
  });
  it('emits nothing for a plain paid event', () => {
    expect(cardBadges(base)).toEqual([]);
  });
});

describe('audienceLabel', () => {
  it('surfaces 21+ and family, defaults to All ages', () => {
    expect(audienceLabel(['21-plus'])).toBe('21+');
    expect(audienceLabel(['family-friendly'])).toBe('Family');
    expect(audienceLabel([])).toBe('All ages');
  });
});
