import type { FetchedRecord } from '../types';

export type DayDate = { year: number; month: number; day: number };

const DAY_MS = 86_400_000;

/** Expands an inclusive calendar-day range, capped at maxDays; [] when invalid or reversed. */
export function expandDayRange(start: DayDate, end: DayDate, maxDays: number): DayDate[] {
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const days: DayDate[] = [];
  for (let t = startMs; t <= endMs && days.length < maxDays; t += DAY_MS) {
    const date = new Date(t);
    days.push({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
  }
  return days;
}

/** Drops records whose (sourceEventId, payload.startDate) repeats — day-instance-safe dedupe. */
export function dedupeDayRecords(records: FetchedRecord[]): FetchedRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const startDate = (record.payload as { startDate?: string }).startDate ?? '';
    const key = `${record.sourceEventId}|${startDate}`;
    return seen.has(key) ? false : seen.add(key);
  });
}
