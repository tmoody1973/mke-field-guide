import type { FetchedRecord } from '../../types';

export type SelectorParser = (html: string, baseUrl: string) => FetchedRecord[];

export const selectorParsers: Record<string, SelectorParser> = {};
