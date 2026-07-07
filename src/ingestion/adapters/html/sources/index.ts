import type { FetchedRecord } from '../../types';
import { pabstTheaterGroupParser } from './pabst-theater-group';
import { radioMilwaukeeParser } from './radio-milwaukee';

export type SelectorParser = (html: string, baseUrl: string) => FetchedRecord[];

export const selectorParsers: Record<string, SelectorParser> = {
  'radio-milwaukee': radioMilwaukeeParser,
  'pabst-theater-group': pabstTheaterGroupParser,
};
