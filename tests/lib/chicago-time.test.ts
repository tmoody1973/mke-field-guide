import { describe, expect, it } from 'vitest';
import { chicagoWallTimeToIso } from '@/lib/chicago-time';

describe('chicagoWallTimeToIso', () => {
  it('converts a CST winter wall time (UTC-6)', () => {
    expect(chicagoWallTimeToIso(2026, 1, 15, 19, 0)).toBe('2026-01-16T01:00:00.000Z');
  });

  it('converts a CDT summer wall time (UTC-5)', () => {
    expect(chicagoWallTimeToIso(2026, 7, 4, 12, 0)).toBe('2026-07-04T17:00:00.000Z');
  });

  it('crosses the Dec 31 → Jan 1 boundary without year drift', () => {
    expect(chicagoWallTimeToIso(2026, 12, 31, 23, 30)).toBe('2027-01-01T05:30:00.000Z');
  });

  it('handles Jan 1 midnight wall time', () => {
    expect(chicagoWallTimeToIso(2027, 1, 1, 0, 0)).toBe('2027-01-01T06:00:00.000Z');
  });
});
