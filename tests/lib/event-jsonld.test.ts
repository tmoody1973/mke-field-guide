import { describe, expect, it } from 'vitest';
import { buildEventJsonLd, safeJsonLdString } from '@/lib/event-jsonld';

const args = {
  title: 'Jazz in the Park',
  description: 'Golden hour horns.',
  status: 'scheduled',
  imageUrl: 'https://cdn.example.com/jazz.jpg',
  isFree: true,
  priceMin: null as string | null,
  canonicalUrl: 'https://easttown.com/jazz',
  isStationEvent: false,
  venueName: 'Cathedral Square Park',
  venueAddress: '520 E Wells St, Milwaukee, WI',
  url: 'https://example.com/events/jazz-in-the-park-abc12345',
  instances: [
    { startAt: new Date('2026-07-09T23:00:00Z'), endAt: new Date('2026-07-10T02:00:00Z') },
    { startAt: new Date('2026-07-16T23:00:00Z'), endAt: null },
  ],
};

describe('buildEventJsonLd', () => {
  it('emits one Event per instance (Google-recommended for recurring)', () => {
    const jsonLd = buildEventJsonLd(args);
    expect(jsonLd).toHaveLength(2);
    expect(jsonLd[0]['@type']).toBe('Event');
    expect(jsonLd[0].startDate).toBe('2026-07-09T23:00:00.000Z');
    expect(jsonLd[0].endDate).toBe('2026-07-10T02:00:00.000Z');
    expect(jsonLd[1].endDate).toBeUndefined();
    expect(jsonLd[0].location).toEqual({
      '@type': 'Place',
      name: 'Cathedral Square Park',
      address: '520 E Wells St, Milwaukee, WI',
    });
    expect(jsonLd[0].offers).toEqual({
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      url: 'https://easttown.com/jazz',
      availability: 'https://schema.org/InStock',
    });
  });
  it('maps cancelled status and caps at 10 instances', () => {
    const many = { ...args, status: 'cancelled', instances: Array.from({ length: 12 }, (_, index) => ({ startAt: new Date(Date.UTC(2026, 6, 9 + index)), endAt: null })) };
    const jsonLd = buildEventJsonLd(many);
    expect(jsonLd).toHaveLength(10);
    expect(jsonLd[0].eventStatus).toBe('https://schema.org/EventCancelled');
  });
  it('adds Radio Milwaukee as organizer for station events', () => {
    expect(buildEventJsonLd({ ...args, isStationEvent: true })[0].organizer).toEqual({
      '@type': 'Organization',
      name: 'Radio Milwaukee',
      url: 'https://radiomilwaukee.org',
    });
  });
});

describe('safeJsonLdString', () => {
  it('neutralizes script-breakout payloads while staying valid JSON', () => {
    const hostile = buildEventJsonLd({
      ...args,
      title: 'Totally Real Show</script><img src=x onerror=alert(1)>',
      description: 'a & b <i>c</i>',
    });
    const serialized = safeJsonLdString(hostile);
    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<img');
    const parsed = JSON.parse(serialized);
    expect(parsed[0].name).toContain('</script>'); // round-trips intact as DATA
  });
});
