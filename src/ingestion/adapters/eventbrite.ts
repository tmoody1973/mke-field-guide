import type { FetchedRecord, SourceAdapter } from './types';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';

export const eventbriteAdapter: SourceAdapter = {
  adapterType: 'api',
  async fetch(): Promise<FetchedRecord[]> {
    throw new Error('Eventbrite adapter not implemented yet');
  },
  normalize(): NormalizedEvent | null {
    return null;
  },
};
