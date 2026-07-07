export const FAILURES_BEFORE_BACKOFF = 3;
export const BASE_BACKOFF_HOURS = 24;
export const MAX_BACKOFF_HOURS = 24 * 7;

export interface BackoffSource {
  consecutiveFailures: number;
  lastAttemptAt: Date | null;
}

/** Hours a source must wait after its Nth consecutive failure; 0 below the backoff floor. */
export function backoffHours(consecutiveFailures: number): number {
  if (consecutiveFailures < FAILURES_BEFORE_BACKOFF) return 0;
  const doublings = consecutiveFailures - FAILURES_BEFORE_BACKOFF;
  return Math.min(BASE_BACKOFF_HOURS * 2 ** doublings, MAX_BACKOFF_HOURS);
}

/** True while a repeatedly-failing source is still inside its exponential backoff window. */
export function shouldSkipForBackoff(source: BackoffSource, now: Date): boolean {
  const waitHours = backoffHours(source.consecutiveFailures);
  if (waitHours === 0 || !source.lastAttemptAt) return false;
  return now.getTime() - source.lastAttemptAt.getTime() < waitHours * 3_600_000;
}
