import type { FetchedRecord } from '../../types';
import { cactusClubParser } from './cactus-club';
import { countyParksParser } from './county-parks';
import { milwaukeeDowntownParser } from './milwaukee-downtown';
import { milwaukeeWorldFestivalParser } from './milwaukee-world-festival';
import { enrichPabstTheaterGroupDetail, pabstTheaterGroupParser } from './pabst-theater-group';
import { radioMilwaukeeParser } from './radio-milwaukee';
import { squarespaceEventsParser } from './squarespace-events';
import { enrichVisitMilwaukeeDetail } from './visit-milwaukee';

export type SelectorParser = (
  html: string,
  baseUrl: string,
) => { records: FetchedRecord[]; skipped: number };

/** Enriches a listing record with data from its fetched detail page (crawlDetails config). */
export type DetailEnricher = (record: FetchedRecord, html: string) => FetchedRecord;

export const selectorParsers: Record<string, SelectorParser> = {
  'radio-milwaukee': radioMilwaukeeParser,
  'pabst-theater-group': pabstTheaterGroupParser,
  'milwaukee-world-festival': milwaukeeWorldFestivalParser,
  'milwaukee-downtown': milwaukeeDowntownParser,
  'county-parks': countyParksParser,
  'x-ray-arcade': squarespaceEventsParser({
    baseUrl: 'https://xrayarcade.com',
    fallbackVenueName: 'X-Ray Arcade',
    fallbackVenueAddress: '5036 South Packard Avenue, Cudahy',
    skipTitle: /(?=.*closed)(?=.*private)/i,
  }),
  'jazz-gallery': squarespaceEventsParser({
    baseUrl: 'https://jazzgallerycenterforarts.org',
    fallbackVenueName: 'Jazz Gallery Center for the Arts',
    fallbackVenueAddress: '926 East Center Street, Milwaukee, WI, 53212',
  }),
  'cactus-club': cactusClubParser,
};

export const detailEnrichers: Record<string, DetailEnricher> = {
  'pabst-theater-group': enrichPabstTheaterGroupDetail,
  'visit-milwaukee': enrichVisitMilwaukeeDetail,
};
