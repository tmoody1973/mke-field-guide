import { describe, expect, it } from 'vitest';
import {
  chicagoDateLabel, chicagoDayHeading, chicagoDayKey, chicagoDayShort, chicagoTimeLabel, chicagoWeekMonday,
} from '@/lib/display';

// 2026-07-09T02:00:00Z is Jul 8, 9:00 PM in Chicago (CDT) — the UTC/Chicago split day.
const splitDay = new Date('2026-07-09T02:00:00Z');

describe('chicago display helpers', () => {
  it('formats headings in Chicago time, not UTC', () => {
    expect(chicagoDayHeading(splitDay)).toBe('Wednesday, July 8');
    expect(chicagoDayShort(splitDay)).toBe('WED');
    expect(chicagoTimeLabel(splitDay)).toBe('9:00 PM');
    expect(chicagoDateLabel(splitDay)).toBe('Wed, Jul 8');
    expect(chicagoDayKey(splitDay)).toBe('2026-07-08');
  });
  it('finds the Chicago Monday of the current week', () => {
    expect(chicagoWeekMonday(new Date('2026-07-08T12:00:00Z'))).toBe('2026-07-06'); // Wed → Mon
    expect(chicagoWeekMonday(new Date('2026-07-12T20:00:00Z'))).toBe('2026-07-06'); // Sun → same week's Mon
    expect(chicagoWeekMonday(new Date('2026-07-13T12:00:00Z'))).toBe('2026-07-13'); // Mon → itself
  });
});
