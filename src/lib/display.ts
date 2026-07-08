import { chicagoParts } from '@/lib/chicago-time';

const CHICAGO = 'America/Chicago';

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', { timeZone: CHICAGO, ...options });
}

const headingFormat = formatter({ weekday: 'long', month: 'long', day: 'numeric' });
const dayShortFormat = formatter({ weekday: 'short' });
const timeFormat = formatter({ hour: 'numeric', minute: '2-digit' });
const dateLabelFormat = formatter({ weekday: 'short', month: 'short', day: 'numeric' });

export function chicagoDayHeading(date: Date): string {
  return headingFormat.format(date);
}

export function chicagoDayShort(date: Date): string {
  return dayShortFormat.format(date).toUpperCase();
}

export function chicagoTimeLabel(date: Date): string {
  return timeFormat.format(date);
}

export function chicagoDateLabel(date: Date): string {
  return dateLabelFormat.format(date);
}

export function chicagoDayKey(date: Date): string {
  const parts = chicagoParts(date.getTime());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Monday (Chicago) of the week containing `now`, as YYYY-MM-DD. */
export function chicagoWeekMonday(now: Date): string {
  const parts = chicagoParts(now.getTime());
  const utcNoon = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12);
  const weekday = new Date(utcNoon).getUTCDay();
  const monday = new Date(utcNoon - ((weekday + 6) % 7) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}
