import { milesBetween } from '@/queries/public-events';

const MILWAUKEE = { lat: 43.0389, lng: -87.9065 };
const MAX_MILES = 25;
// Words that appear in many venue names and prove nothing on their own.
const GENERIC = new Set([
  'the', 'and', 'bar', 'pub', 'club', 'cafe', 'grill', 'restaurant', 'tavern', 'lounge', 'hall', 'center', 'centre', 'theater', 'theatre',
  'park', 'church', 'milwaukee', 'mke', 'wisconsin', 'house', 'room', 'company', 'brewing', 'brewery', 'music', 'arts', 'art',
]);

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const distinctive = (s: string) => new Set(words(s).filter((w) => w.length >= 3 && !GENERIC.has(w)));
/** "822 S Water St, Milwaukee" → "822 water": the house number and first street word. */
const streetKey = (s: string | null) => {
  const m = s?.match(/\b(\d{1,6})\s+(?:(?:north|south|east|west|[NSEW])\.?\s+)?([A-Za-z0-9]+)/i);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
};

export interface GeoCandidate { title: string; label: string; lat: number; lng: number }

/**
 * Is Amazon's answer really this venue? Yes if it sits in the Milwaukee area and either shares a distinctive name word
 * or the same house number and street. Anything else is skipped and listed for a person, never guessed.
 */
export function acceptMatch(venue: { name: string; address: string | null }, candidate: GeoCandidate): { lat: number; lng: number; label: string } | null {
  if (milesBetween(MILWAUKEE, candidate) > MAX_MILES) return null;
  const mine = distinctive(venue.name);
  const theirs = distinctive(`${candidate.title} ${candidate.label}`);
  const sameName = [...mine].some((w) => theirs.has(w));
  const key = streetKey(venue.address);
  const sameStreet = key !== null && (streetKey(candidate.label) === key || streetKey(candidate.title) === key);
  return sameName || sameStreet ? { lat: candidate.lat, lng: candidate.lng, label: candidate.label } : null;
}
