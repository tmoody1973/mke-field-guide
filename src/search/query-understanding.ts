import { chicagoParts, chicagoWallTimeToIso } from '@/lib/chicago-time';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export interface ParsedQuery {
  text: string;
  window: { start: Date; end: Date } | null;
  timeOfDay: TimeOfDay | null;
}

interface CivilDate {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const MS_PER_DAY = 86_400_000;

/** Chicago calendar date + weekday (0=Sun) for `now`, independent of local machine time. */
function chicagoCivilDate(now: Date): CivilDate {
  const parts = chicagoParts(now.getTime());
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, weekday };
}

/** Shifts a civil date by `deltaDays`, letting UTC absorb month/year rollover. */
function addCivilDays(civil: Pick<CivilDate, 'year' | 'month' | 'day'>, deltaDays: number) {
  const shifted = new Date(Date.UTC(civil.year, civil.month - 1, civil.day) + deltaDays * MS_PER_DAY);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function wallTime(civil: { year: number; month: number; day: number }, hour: number, minute: number): Date {
  return new Date(chicagoWallTimeToIso(civil.year, civil.month, civil.day, hour, minute));
}

/** A start that already elapsed (e.g. "tonight" said after 5pm) collapses to right now. */
function clampToNow(candidate: Date, now: Date): Date {
  return candidate.getTime() < now.getTime() ? now : candidate;
}

function todayWindow(civil: CivilDate, now: Date): { start: Date; end: Date } {
  const nextMidnight = addCivilDays(civil, 1);
  return { start: now, end: wallTime(nextMidnight, 0, 0) };
}

function tonightWindow(civil: CivilDate, now: Date): { start: Date; end: Date } {
  const start = wallTime(civil, 17, 0);
  const end = wallTime(addCivilDays(civil, 1), 3, 0);
  return { start: clampToNow(start, now), end };
}

function tomorrowWindow(civil: CivilDate): { start: Date; end: Date } {
  const tomorrow = addCivilDays(civil, 1);
  return { start: wallTime(tomorrow, 0, 0), end: wallTime(addCivilDays(tomorrow, 1), 0, 0) };
}

/** Coming Friday 17:00, or the past/current Friday when today already sits inside the weekend. */
function thisWeekendWindow(civil: CivilDate, now: Date): { start: Date; end: Date } {
  const daysSinceFriday = (civil.weekday - 5 + 7) % 7;
  const daysToFriday = daysSinceFriday <= 2 ? -daysSinceFriday : 7 - daysSinceFriday;
  const friday = addCivilDays(civil, daysToFriday);
  const start = wallTime(friday, 17, 0);
  const end = wallTime(addCivilDays(friday, 3), 0, 0);
  return { start: clampToNow(start, now), end };
}

function thisWeekWindow(civil: CivilDate, now: Date): { start: Date; end: Date } {
  const daysUntilMonday = (8 - civil.weekday) % 7 || 7;
  return { start: now, end: wallTime(addCivilDays(civil, daysUntilMonday), 0, 0) };
}

/** Next occurrence of `targetWeekday` (today counts), whole day or 17:00→03:00 for "night". */
function weekdayWindow(civil: CivilDate, now: Date, targetWeekday: number, isNight: boolean): { start: Date; end: Date } {
  const daysUntil = (targetWeekday - civil.weekday + 7) % 7;
  const day = addCivilDays(civil, daysUntil);
  const start = wallTime(day, isNight ? 17 : 0, 0);
  const end = wallTime(addCivilDays(day, 1), isNight ? 3 : 0, 0);
  return { start: clampToNow(start, now), end };
}

export function presetWindow(
  preset: 'tonight' | 'today' | 'this-weekend' | 'this-week',
  now: Date,
): { start: Date; end: Date } {
  const civil = chicagoCivilDate(now);
  if (preset === 'today') return todayWindow(civil, now);
  if (preset === 'tonight') return tonightWindow(civil, now);
  if (preset === 'this-weekend') return thisWeekendWindow(civil, now);
  return thisWeekWindow(civil, now);
}

interface PhraseRule {
  pattern: RegExp;
  resolve: (now: Date, match: RegExpMatchArray) => Partial<ParsedQuery>;
}

function resolveWeekdayTime(now: Date, match: RegExpMatchArray): Partial<ParsedQuery> {
  const timeOfDay = match[2].toLowerCase() as TimeOfDay;
  const targetWeekday = WEEKDAYS.indexOf(match[1].toLowerCase() as (typeof WEEKDAYS)[number]);
  const window = weekdayWindow(chicagoCivilDate(now), now, targetWeekday, timeOfDay === 'night');
  return { window, timeOfDay };
}

function resolveWeekdayOnly(now: Date, match: RegExpMatchArray): Partial<ParsedQuery> {
  const targetWeekday = WEEKDAYS.indexOf(match[1].toLowerCase() as (typeof WEEKDAYS)[number]);
  return { window: weekdayWindow(chicagoCivilDate(now), now, targetWeekday, false), timeOfDay: null };
}

const WEEKDAY_GROUP = `(${WEEKDAYS.join('|')})`;
const TIME_OF_DAY_GROUP = '(morning|afternoon|evening|night)';

const PHRASES: PhraseRule[] = [
  { pattern: new RegExp(`\\b${WEEKDAY_GROUP}\\s+${TIME_OF_DAY_GROUP}\\b`, 'i'), resolve: resolveWeekdayTime },
  { pattern: /\bthis weekend\b/i, resolve: (now) => ({ window: presetWindow('this-weekend', now), timeOfDay: null }) },
  { pattern: /\bthis week\b/i, resolve: (now) => ({ window: presetWindow('this-week', now), timeOfDay: null }) },
  { pattern: /\btonight\b/i, resolve: (now) => ({ window: presetWindow('tonight', now), timeOfDay: null }) },
  { pattern: /\btoday\b/i, resolve: (now) => ({ window: presetWindow('today', now), timeOfDay: null }) },
  { pattern: /\btomorrow\b/i, resolve: (now) => ({ window: tomorrowWindow(chicagoCivilDate(now)), timeOfDay: null }) },
  { pattern: new RegExp(`\\b${WEEKDAY_GROUP}\\b`, 'i'), resolve: resolveWeekdayOnly },
  { pattern: new RegExp(`\\b${TIME_OF_DAY_GROUP}\\b`, 'i'), resolve: (_now, match) => ({ window: null, timeOfDay: match[1].toLowerCase() as TimeOfDay }) },
];

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function parseSearchInput(raw: string, now: Date): ParsedQuery {
  for (const { pattern, resolve } of PHRASES) {
    const match = raw.match(pattern);
    if (!match || match.index === undefined) continue;
    const stripped = raw.slice(0, match.index) + raw.slice(match.index + match[0].length);
    const resolved = resolve(now, match);
    return { text: collapseWhitespace(stripped), window: resolved.window ?? null, timeOfDay: resolved.timeOfDay ?? null };
  }
  return { text: collapseWhitespace(raw), window: null, timeOfDay: null };
}
