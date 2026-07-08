import { SITE_URL } from '@/lib/site';

export interface CalendarEventInput {
  slug: string;
  title: string;
  description: string | null;
  venueName: string | null;
  venueAddress: string | null;
  startAt: Date;
  endAt: Date | null;
  url: string;
}

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function resolveEnd(input: CalendarEventInput): Date {
  return input.endAt ?? new Date(input.startAt.getTime() + DEFAULT_DURATION_MS);
}

function location(input: CalendarEventInput): string {
  return [input.venueName, input.venueAddress ?? 'Milwaukee, WI'].filter(Boolean).join(', ');
}

export function googleCalendarUrl(input: CalendarEventInput): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${utcStamp(input.startAt)}/${utcStamp(resolveEnd(input))}`,
    details: `${input.description ?? ''}\n\n${input.url}`.trim(),
    location: location(input),
    ctz: 'America/Chicago',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function buildIcs(input: CalendarEventInput): string {
  const host = new URL(SITE_URL).host;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Radio Milwaukee//Events//EN',
    'BEGIN:VEVENT',
    `UID:${input.slug}@${host}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(input.startAt)}`,
    `DTEND:${utcStamp(resolveEnd(input))}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `LOCATION:${escapeIcsText(location(input))}`,
    `DESCRIPTION:${escapeIcsText(input.description ?? '')}`,
    `URL:${input.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
