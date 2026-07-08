/**
 * Curated venue → neighborhood assignments (normalized_name → NEIGHBORHOODS name).
 * Completed at execution against the live venue list; unmapped venues stay NULL and
 * are reported by assign-neighborhoods for the next curation pass.
 */
export const VENUE_NEIGHBORHOODS: Record<string, string> = {
  'pabst theater': 'Downtown',
  'turner hall ballroom': 'Downtown',
  'riverside theater': 'Downtown',
  'cactus club': 'Bay View',
  'the laughing tap': "Walker's Point",
  "linneman's riverwest inn": 'Riverwest',
  'company brewing': 'Riverwest',
  'lakefront brewery': 'Riverwest',
  'radio milwaukee': "Walker's Point",
  'henry maier festival park': 'Lakefront',
  'american family field': 'West Side',
  'fiserv forum': 'Downtown',
  'cathedral square park': 'East Town',
  // …completed at execution from the live venue list
};
