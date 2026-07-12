import { describe, expect, it } from 'vitest';
import { haversineMeters } from '@/lib/geo';

describe('haversineMeters', () => {
  it('returns zero for identical points', () => {
    const point = { lat: 43.0389, lng: -87.9065 };
    expect(haversineMeters(point, point)).toBeCloseTo(0, 6);
  });

  it('approximates the known distance between two Milwaukee landmarks', () => {
    // Milwaukee City Hall to the Milwaukee Art Museum: roughly 2.1 km apart.
    const cityHall = { lat: 43.0400, lng: -87.9106 };
    const artMuseum = { lat: 43.0398, lng: -87.8965 };

    const distance = haversineMeters(cityHall, artMuseum);

    expect(distance).toBeGreaterThan(1_000);
    expect(distance).toBeLessThan(1_400);
  });

  it('is symmetric', () => {
    const a = { lat: 43.05, lng: -87.9 };
    const b = { lat: 43.02, lng: -87.85 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});
