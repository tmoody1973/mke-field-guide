/** America/Chicago wall-clock parts (year/month/day/hour/minute/second) at the given instant. */
export function chicagoParts(utcMs: number): Record<string, string> {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(utcMs)) parts[p.type] = p.value;
  return parts;
}

/** Offset (minutes) of America/Chicago from UTC at the given instant, negative = behind UTC. */
export function chicagoOffsetMinutes(utcMs: number): number {
  const parts = chicagoParts(utcMs);
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return (asUtc - utcMs) / 60_000;
}

/** Converts a naive America/Chicago wall-clock time into a UTC ISO string. */
export function chicagoWallTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetMin = chicagoOffsetMinutes(utcGuess);
  return new Date(utcGuess - offsetMin * 60_000).toISOString();
}

/**
 * Rolls a same-day-derived end time forward 24h when it lands strictly before
 * the start (a cross-midnight show like "9:00 PM - 1:00 AM"). Ends at or after
 * the start — and unparseable inputs — pass through unchanged.
 */
export function rollEndAtForward(startIso: string, endIso: string): string {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end >= start) return endIso;
  return new Date(end + 86_400_000).toISOString();
}
