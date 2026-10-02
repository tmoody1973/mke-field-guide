import { describe, expect, it } from 'vitest';
import { buildIcs, googleCalendarUrl } from '@/lib/calendar-links';

const input = {
  slug: 'jazz-in-the-park-abc12345',
  title: 'Jazz in the Park',
  description: 'Golden hour, cold drink; live horns.',
  venueName: 'Cathedral Square Park',
  venueAddress: '520 E Wells St, Milwaukee, WI',
  startAt: new Date('2026-07-09T23:00:00Z'), // 6:00 PM CDT
  endAt: new Date('2026-07-10T02:00:00Z'),
  url: 'https://example.com/events/jazz-in-the-park-abc12345',
};

describe('googleCalendarUrl', () => {
  it('builds a render URL with UTC stamps and Chicago ctz', () => {
    const url = new URL(googleCalendarUrl(input));
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Jazz in the Park');
    expect(url.searchParams.get('dates')).toBe('20260709T230000Z/20260710T020000Z');
    expect(url.searchParams.get('ctz')).toBe('America/Chicago');
    expect(url.searchParams.get('location')).toBe('Cathedral Square Park, 520 E Wells St, Milwaukee, WI');
  });
  it('defaults a missing end to start + 2h', () => {
    const url = new URL(googleCalendarUrl({ ...input, endAt: null }));
    expect(url.searchParams.get('dates')).toBe('20260709T230000Z/20260710T010000Z');
  });
});

describe('buildIcs', () => {
  it('emits UTC times, a stable UID, and escaped text', () => {
    const ics = buildIcs({ ...input, description: 'Line one\nsemi; comma, done' });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('UID:jazz-in-the-park-abc12345@');
    expect(ics).toContain('DTSTART:20260709T230000Z');
    expect(ics).toContain('DTEND:20260710T020000Z');
    expect(ics).toContain('DESCRIPTION:Line one\\nsemi\\; comma\\, done');
    expect(ics).toContain('URL:https://example.com/events/jazz-in-the-park-abc12345');
    expect(ics.split('\r\n')).toContain('END:VEVENT');
  });
});
