import { describe, expect, it } from 'vitest';
import { chicagoWallTimeToIso, rollEndAtForward } from '@/lib/chicago-time';

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

describe('rollEndAtForward', () => {
  it('rolls a cross-midnight end forward 24h', () => {
    const start = '2026-07-11T02:00:00.000Z'; // 9:00 PM Jul 10 Chicago
    const end = '2026-07-10T06:00:00.000Z'; // 1:00 AM Jul 10 Chicago (same-day derived)
    expect(rollEndAtForward(start, end)).toBe('2026-07-11T06:00:00.000Z');
  });

  it('leaves end after start untouched', () => {
    const start = '2026-07-11T02:00:00.000Z';
    const end = '2026-07-11T04:00:00.000Z';
    expect(rollEndAtForward(start, end)).toBe(end);
  });

  it('leaves end equal to start untouched', () => {
    const iso = '2026-07-11T02:00:00.000Z';
    expect(rollEndAtForward(iso, iso)).toBe(iso);
  });

  it('returns end unchanged when either side is unparseable', () => {
    expect(rollEndAtForward('garbage', '2026-07-11T02:00:00.000Z')).toBe('2026-07-11T02:00:00.000Z');
  });
});
