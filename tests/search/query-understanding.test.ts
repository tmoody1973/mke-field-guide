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
    expect(parsed).toEqual({ text: 'pabst theater comedy', window: null, timeOfDay: null, free: false });
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

describe('tonight dead zone', () => {
  it('covers the in-progress night between midnight and 3am Chicago', () => {
    const now = new Date('2026-07-08T06:30:00Z'); // 01:30 CDT
    const window = presetWindow('tonight', now);
    expect(window.start).toEqual(now);
    expect(window.end.toISOString()).toBe('2026-07-08T08:00:00.000Z'); // 03:00 CDT
  });
  it('still targets the coming evening after 3am', () => {
    const now = new Date('2026-07-08T14:00:00Z'); // 09:00 CDT
    const window = presetWindow('tonight', now);
    expect(window.start.toISOString()).toBe('2026-07-08T22:00:00.000Z'); // 17:00 CDT
  });
});

describe('free-word extraction', () => {
  it('maps the word free to the free flag and strips it from text', () => {
    const parsed = parseSearchInput('free live music tonight', new Date('2026-07-08T22:00:00Z'));
    expect(parsed.free).toBe(true);
    expect(parsed.text).toBe('live music');
    expect(parsed.window).not.toBeNull();
  });
  it('leaves free=false when the word is absent', () => {
    expect(parseSearchInput('jazz', new Date()).free).toBe(false);
  });
});
