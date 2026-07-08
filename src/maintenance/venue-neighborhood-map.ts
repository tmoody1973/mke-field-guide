/**
 * Curated venue → neighborhood assignments (normalized_name → NEIGHBORHOODS name).
 * Completed 2026-07-08 against the live venue list (top venues by upcoming-event
 * volume; keys are EXACT stored normalized_name values). Unmapped venues stay NULL
 * and are reported by assign-neighborhoods for the next curation pass — venues
 * outside the city (Cudahy, West Allis, Brookfield, Spring Green) and DIY
 * "ask a punk" spaces are deliberately unmapped.
 */
export const VENUE_NEIGHBORHOODS: Record<string, string> = {
  // Downtown (incl. Westown + Deer District + Marcus Center complex)
  'pabst theater': 'Downtown',
  'turner hall ballroom': 'Downtown',
  'riverside theatre wi': 'Downtown',
  'the riverside theater': 'Downtown',
  'miller high life theatre': 'Downtown',
  'fiserv forum': 'Downtown',
  'landmark credit union live': 'Downtown',
  '1134 n vel r phillips ave': 'Downtown',
  'bradley symphony center': 'Downtown',
  'uihlein hall marcus center': 'Downtown',
  'todd wehr theater at marcus center': 'Downtown',
  'wilson theater at vogel hall': 'Downtown',
  '929 n water st': 'Downtown',

  // East Town
  'cathedral square park': 'East Town',

  // Third Ward
  '345 n broadway': 'Third Ward',

  // Walker's Point (incl. Harbor District + H-D Museum campus)
  'the laughing tap': "Walker's Point",
  'radio milwaukee': "Walker's Point",
  'the cooperage': "Walker's Point",
  'next act theatre': "Walker's Point",
  'anodyne coffee roasting co 224 w bruce st': "Walker's Point",
  'sabbatic 700 s 2nd st': "Walker's Point",
  'harley davidson museum': "Walker's Point",

  // Bay View
  'cactus club 2496 s wentworth ave': 'Bay View',
  'sugar maple 441 east lincoln avenue': 'Bay View',
  'club garibaldi 2501 s superior st': 'Bay View',
  'humboldt park bandshell': 'Bay View',
  'the vine at humboldt': 'Bay View',

  // Riverwest
  'linnemans': 'Riverwest',
  'linneman s riverwest inn 1001 e locust st': 'Riverwest',
  'company brewing': 'Riverwest',
  'lakefront brewery inc': 'Riverwest',
  'falcon bowl 801 east clarke street': 'Riverwest',
  'falcon hall 801': 'Riverwest',
  'falcon nest 801 e clarke st': 'Riverwest',
  'quarters rock n roll palace 900 e center st': 'Riverwest',
  'jazz gallery center for the arts 926 e center st milwaukee wi 53212': 'Riverwest',

  // Lakefront
  'henry maier festival park': 'Lakefront',
  'american family insurance amphitheater summerfest grounds': 'Lakefront',
  'the american family insurance amphitheater': 'Lakefront',
  'red arrow park': 'Downtown',
  '116 w wisconsin ave': 'Downtown',
  '405 w kilbourn ave': 'Downtown',
  '500 w kilbourn ave': 'Downtown',
  '420 s 1st st': "Walker's Point",
  'bmo pavilion': 'Lakefront',
  '200 n harbor dr': 'Lakefront',

  // East Side (Lower East Side / Brady–Farwell / Lake Park)
  'shank hall': 'East Side',
  'vivarium': 'East Side',
  'waterford wine spirits milwaukee': 'East Side',
  'lake park summer stage': 'East Side',

  // West Side (Near West / Washington Park / Menomonee Valley ballpark)
  'the rave eagles club': 'West Side',
  'american family field': 'West Side',
  'al mcguire center': 'West Side',
  'washington park bandshell': 'West Side',
  'enderis park': 'West Side',
  'still oak a great lakes distillery tasting room': 'West Side',
  'on tap': 'West Side',
};
