import type { NormalizedEvent } from '@/lib/validation/normalized-event';

export interface FetchedRecord {
  sourceEventId: string;
  sourceUrl?: string;
  /** Plain-JSON payload; stored verbatim in raw_events and replayable. */
  payload: unknown;
}

export interface SourceAdapter {
  adapterType: string;
  fetch(config: unknown): Promise<FetchedRecord[]>;
  /** Must derive everything from record.payload. Returns null to skip invalid records. */
  normalize(record: FetchedRecord): NormalizedEvent | null;
}
