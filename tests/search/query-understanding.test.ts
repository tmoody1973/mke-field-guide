import { describe, expect, it } from 'vitest';
import { parseSearchInput, presetWindow } from '@/search/query-understanding';

const NOW = new Date('2026-07-07T19:00:00-05:00'); // Tuesday, 7 PM Chicago
const chi = (s: string) => new Date(s).toISOString();

describe('parseSearchInput', () => {
  it('strips "tonight" into a 17:00→03:00 window', () => {
    const parsed = parseSearchInput('live music tonight', NOW);
    expect(parsed.text).toBe('live music');
    expect(parsed.window?.start.toISOString()).toBe(chi('2026-07-07T19:00:00-05:00')); // clamped to now (already past 17:00)
    expect(parsed.window?.end.toISOString()).toBe(chi('2026-07-08T03:00:00-05:00'));
  });

  it('parses "this weekend" to Fri 17:00 → Mon 00:00', () => {
    const parsed = parseSearchInput('something chill this weekend', NOW);
    expect(parsed.text).toBe('something chill');
    expect(parsed.window?.start.toISOString()).toBe(chi('2026-07-10T17:00:00-05:00'));
    expect(parsed.window?.end.toISOString()).toBe(chi('2026-07-13T00:00:00-05:00'));
  });

  it('parses "sunday afternoon" as next Sunday + afternoon time-of-day', () => {
    const parsed = parseSearchInput('with the kids sunday afternoon', NOW);
    expect(parsed.text).toBe('with the kids');
    expect(parsed.timeOfDay).toBe('afternoon');
    expect(parsed.window?.start.toISOString()).toBe(chi('2026-07-12T00:00:00-05:00'));
    expect(parsed.window?.end.toISOString()).toBe(chi('2026-07-13T00:00:00-05:00'));
  });

  it('leaves plain queries untouched', () => {
    const parsed = parseSearchInput('pabst theater comedy', NOW);
    expect(parsed).toEqual({ text: 'pabst theater comedy', window: null, timeOfDay: null });
  });

  it('clamps preset windows that started in the past to now', () => {
    const w = presetWindow('today', NOW);
    expect(w.start.toISOString()).toBe(NOW.toISOString());
    expect(w.end.toISOString()).toBe(chi('2026-07-08T00:00:00-05:00'));
  });

  it('"friday night" resolves to the coming Friday evening', () => {
    const parsed = parseSearchInput('friday night', NOW);
    expect(parsed.text).toBe('');
    expect(parsed.window?.start.toISOString()).toBe(chi('2026-07-10T17:00:00-05:00'));
    expect(parsed.window?.end.toISOString()).toBe(chi('2026-07-11T03:00:00-05:00'));
  });
});
