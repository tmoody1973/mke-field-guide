import { describe, expect, test } from 'vitest';
import { normalizedEventSchema } from '@/lib/validation/normalized-event';

describe('normalizedEventSchema', () => {
  test('parses a minimal valid event and applies defaults', () => {
    const result = normalizedEventSchema.parse({
      sourceEventId: '12345@urbanmilwaukee.com',
      title: 'Jazz in the Park',
      startAt: '2026-07-11T00:00:00.000Z',
    });
    expect(result.startAt).toBeInstanceOf(Date);
    expect(result.timezone).toBe('America/Chicago');
    expect(result.status).toBe('scheduled');
  });

  test('rejects empty title', () => {
    const result = normalizedEventSchema.safeParse({
      sourceEventId: 'x',
      title: '',
      startAt: '2026-07-11T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  test('rejects endAt before startAt', () => {
    const result = normalizedEventSchema.safeParse({
      sourceEventId: 'x',
      title: 'Backwards Event',
      startAt: '2026-07-11T00:00:00.000Z',
      endAt: '2026-07-10T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid url', () => {
    const result = normalizedEventSchema.safeParse({
      sourceEventId: 'x',
      title: 'Event',
      url: 'not-a-url',
      startAt: '2026-07-11T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  test('accepts venue coordinates and isFree', () => {
    const result = normalizedEventSchema.parse({
      sourceEventId: 'x',
      title: 'Geo Event',
      startAt: '2026-07-11T00:00:00.000Z',
      venueLat: 43.0389,
      venueLng: -87.9065,
      isFree: true,
    });
    expect(result.venueLat).toBe(43.0389);
    expect(result.isFree).toBe(true);
  });

  test('rejects out-of-range latitude', () => {
    const result = normalizedEventSchema.safeParse({
      sourceEventId: 'x',
      title: 'Bad Geo',
      startAt: '2026-07-11T00:00:00.000Z',
      venueLat: 99,
    });
    expect(result.success).toBe(false);
  });
});
