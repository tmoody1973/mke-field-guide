// Marcus Performing Arts Center — thin instance of the shared Tribe Events
// REST JSON factory (see tribe-events.ts for the generic parsing logic).
// Every Marcus event's feed attaches a real hall-level venue (Uihlein Hall,
// Peck Pavilion, Todd Wehr Theater, Wilson Theater at Vogel Hall, South
// Outdoor Grounds), so no fallback venue is configured here.
import type { FetchedRecord } from '../../types';
import { parseTribeEventsJson, tribeEventsParser } from './tribe-events';
import type { SelectorParser } from './index';

const MARCUS_CENTER_OPTIONS = { listingLabel: 'Marcus Center Tribe Events' };

export function parseMarcusCenterJson(
  html: string,
  listingUrl: string,
): { records: FetchedRecord[]; skipped: number } {
  return parseTribeEventsJson(html, listingUrl, MARCUS_CENTER_OPTIONS);
}

export const marcusCenterParser: SelectorParser = tribeEventsParser(MARCUS_CENTER_OPTIONS);
