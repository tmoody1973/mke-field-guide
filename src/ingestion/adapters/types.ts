import type { NormalizedEvent } from '@/lib/validation/normalized-event';

export interface FetchedRecord {
  sourceEventId: string;
  sourceUrl?: string;
  /** Plain-JSON payload; stored verbatim in raw_events and replayable. */
  payload: unknown;
}

export interface FetchOutcome {
  records: FetchedRecord[];
  /** Items the parser recognized as event cards but could not extract (vague dates, missing fields). */
  parseSkipped: number;
}

export interface SourceAdapter {
  adapterType: string;
  fetch(config: unknown): Promise<FetchOutcome>;
  /** Must derive everything from record.payload. Returns null to skip invalid records. */
  normalize(record: FetchedRecord): NormalizedEvent | null;
}
