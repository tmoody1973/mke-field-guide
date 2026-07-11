/**
 * The venue-name half of a free-text location. Splits on the first comma, then
 * trims a trailing street address delimited by " - " ONLY when a digit follows
 * the dash — "Cactus Club - 2496 S Wentworth Ave" is a venue plus address,
 * "The Rave - Eagles Club" is just a name.
 */
export function splitLocationName(location: string | undefined): string | undefined {
  if (!location) return undefined;
  const head = location.split(',')[0]?.split(/\s-\s(?=\d)/)[0]?.trim();
  return head || undefined;
}
