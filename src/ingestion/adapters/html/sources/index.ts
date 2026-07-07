import type { FetchedRecord } from '../../types';
import { radioMilwaukeeParser } from './radio-milwaukee';

export type SelectorParser = (html: string, baseUrl: string) => FetchedRecord[];

export const selectorParsers: Record<string, SelectorParser> = {
  'radio-milwaukee': radioMilwaukeeParser,
};
