export const AUTO_MERGE_THRESHOLD = 0.8;
export const REVIEW_THRESHOLD = 0.55;

const WEIGHTS = { title: 0.55, venue: 0.15, time: 0.15, url: 0.15 } as const;
const TIME_WINDOW_MINUTES = 180;

export interface PairSignals {
  /** pg_trgm similarity of the two normalized titles, 0..1. */
  titleSimilarity: number;
  /** 1 = same venue row; trigram similarity of venue names; 0.5 = unknown on either side. */
  venueAffinity: number;
  /** Minutes between closest same-day starts; null when a midnight placeholder is involved. */
  startDeltaMinutes: number | null;
  urlMatch: boolean;
}

export interface ScoredPair extends PairSignals {
  total: number;
  verdict: 'merge' | 'review' | 'ignore';
}

export function timeProximity(startDeltaMinutes: number | null): number {
  if (startDeltaMinutes === null) return 0.5;
  return 1 - Math.min(Math.abs(startDeltaMinutes), TIME_WINDOW_MINUTES) / TIME_WINDOW_MINUTES;
}

function verdictFor(total: number): ScoredPair['verdict'] {
  if (total >= AUTO_MERGE_THRESHOLD) return 'merge';
  if (total >= REVIEW_THRESHOLD) return 'review';
  return 'ignore';
}

export function scorePair(signals: PairSignals): ScoredPair {
  const total =
    WEIGHTS.title * signals.titleSimilarity +
    WEIGHTS.venue * signals.venueAffinity +
    WEIGHTS.time * timeProximity(signals.startDeltaMinutes) +
    WEIGHTS.url * (signals.urlMatch ? 1 : 0);
  return { ...signals, total, verdict: verdictFor(total) };
}
