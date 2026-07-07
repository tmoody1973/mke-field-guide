import type { FetchedRecord } from '../../types';
import { milwaukeeWorldFestivalParser } from './milwaukee-world-festival';
import { enrichPabstTheaterGroupDetail, pabstTheaterGroupParser } from './pabst-theater-group';
import { radioMilwaukeeParser } from './radio-milwaukee';

export type SelectorParser = (html: string, baseUrl: string) => FetchedRecord[];

/** Enriches a listing record with data from its fetched detail page (crawlDetails config). */
export type DetailEnricher = (record: FetchedRecord, html: string) => FetchedRecord;

export const selectorParsers: Record<string, SelectorParser> = {
  'radio-milwaukee': radioMilwaukeeParser,
  'pabst-theater-group': pabstTheaterGroupParser,
  'milwaukee-world-festival': milwaukeeWorldFestivalParser,
};

export const detailEnrichers: Record<string, DetailEnricher> = {
  'pabst-theater-group': enrichPabstTheaterGroupDetail,
};
