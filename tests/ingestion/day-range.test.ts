import { describe, expect, it } from 'vitest';
import { dedupeDayRecords, expandDayRange } from '@/ingestion/adapters/html/day-range';
import type { FetchedRecord } from '@/ingestion/adapters/types';

const d = (year: number, month: number, day: number) => ({ year, month, day });

describe('expandDayRange', () => {
  it('expands an inclusive same-month range', () => {
    expect(expandDayRange(d(2026, 6, 25), d(2026, 6, 27), 31)).toEqual([
      d(2026, 6, 25), d(2026, 6, 26), d(2026, 6, 27),
    ]);
  });

  it('expands across a year boundary', () => {
    expect(expandDayRange(d(2026, 12, 30), d(2027, 1, 2), 31)).toEqual([
      d(2026, 12, 30), d(2026, 12, 31), d(2027, 1, 1), d(2027, 1, 2),
    ]);
  });

  it('returns [] for a reversed range', () => {
    expect(expandDayRange(d(2026, 7, 10), d(2026, 7, 9), 31)).toEqual([]);
  });

  it('caps the fan-out at maxDays', () => {
    expect(expandDayRange(d(2026, 1, 1), d(2026, 12, 31), 5)).toHaveLength(5);
  });
});

describe('dedupeDayRecords', () => {
  const rec = (id: string, startDate: string): FetchedRecord => ({
    sourceEventId: id,
    payload: { startDate },
  });

  it('keeps day-instances of one event and drops true duplicates', () => {
    const records = [rec('a', '2026-06-25'), rec('a', '2026-06-26'), rec('a', '2026-06-25')];
    expect(dedupeDayRecords(records)).toHaveLength(2);
  });
});
