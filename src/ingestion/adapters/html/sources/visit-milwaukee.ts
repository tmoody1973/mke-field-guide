import { chicagoWallTimeToIso, rollEndAtForward } from '@/lib/chicago-time';
import type { FetchedRecord } from '../../types';

// visitmilwaukee.org detail pages carry date-only startDate/endDate in their
// JSON-LD, but the inline script the Vue widget reads embeds display strings
// with the time of day:
//   var startDate = "Tuesday, July 7, 2026 8:00 PM";
//   var endDate   = "Tuesday, July 7, 2026 10:00 PM";
// This enricher upgrades the payload dates to timed ISO instants — but only
// when the var's written date matches the JSON-LD date, so recurring events
// surfacing an unrelated occurrence date never clobber the record.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LONG_DATE = /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/;
const CLOCK_TIME = /(\d{1,2}):(\d{2})\s*([AP]M)/i;

const MONTH_NUMBERS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function inlineVarText(html: string, varName: string): string | undefined {
  const match = new RegExp(`var ${varName}\\s*=\\s*"([^"]*)"`).exec(html);
  return match?.[1];
}

function to24Hour(hour12: number, meridiem: string): number {
  const isPm = meridiem.toUpperCase() === 'PM';
  if (hour12 === 12) return isPm ? 12 : 0;
  return isPm ? hour12 + 12 : hour12;
}

function timedIsoMatchingDate(
  text: string | undefined,
  expectedDate: string | undefined,
): string | undefined {
  if (!text || !expectedDate || !DATE_ONLY.test(expectedDate)) return undefined;
  const dateMatch = LONG_DATE.exec(text);
  const timeMatch = CLOCK_TIME.exec(text);
  if (!dateMatch || !timeMatch) return undefined;
  const month = MONTH_NUMBERS[dateMatch[1].toLowerCase()];
  if (!month) return undefined;
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (isoDate !== expectedDate) return undefined;
  const hour = to24Hour(Number(timeMatch[1]), timeMatch[3]);
  return chicagoWallTimeToIso(year, month, day, hour, Number(timeMatch[2]));
}

type DatePayload = Record<string, unknown> & { startDate?: string; endDate?: string };

// With a timed start, a same-day date-only endDate would normalize to midnight
// (before the start) and get the whole record rejected — drop it instead.
function endDateFor(
  payload: DatePayload,
  startIso: string | undefined,
  endIso: string | undefined,
): string | undefined {
  if (endIso) return endIso;
  if (startIso && payload.endDate === payload.startDate) return undefined;
  return payload.endDate;
}

export function enrichVisitMilwaukeeDetail(record: FetchedRecord, html: string): FetchedRecord {
  const payload = record.payload as DatePayload;
  const startIso = timedIsoMatchingDate(inlineVarText(html, 'startDate'), payload.startDate);
  const rawEndIso = timedIsoMatchingDate(inlineVarText(html, 'endDate'), payload.endDate);
  // A written end earlier than the start is a cross-midnight show ("11 PM - 1 AM").
  const endIso = startIso && rawEndIso ? rollEndAtForward(startIso, rawEndIso) : rawEndIso;
  if (!startIso && !endIso) return record;
  return {
    ...record,
    payload: {
      ...payload,
      startDate: startIso ?? payload.startDate,
      endDate: endDateFor(payload, startIso, endIso),
    },
  };
}
