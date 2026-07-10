import { asc } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { backoffHours, FAILURES_BEFORE_BACKOFF } from '@/ingestion/backoff';
import { cadenceOf } from '@/ingestion/cadence';
import type { Db } from '@/lib/card-data'; // Task 9 consolidates to @/db/types; until then this is the query-layer home

export interface SourceHealthRow {
  id: string;
  key: string;
  name: string;
  url: string;
  adapterType: string;
  cadence: string;
  healthStatus: 'ok' | 'failing' | 'unknown';
  lastFetchAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastFetchedCount: number | null;
  lastPublishedCount: number | null;
  lastSkippedCount: number | null;
  lastRunId: string | null;
  inBackoffUntil: Date | null;
}

function backoffUntil(consecutiveFailures: number, lastAttemptAt: Date | null): Date | null {
  if (consecutiveFailures < FAILURES_BEFORE_BACKOFF || !lastAttemptAt) return null;
  return new Date(lastAttemptAt.getTime() + backoffHours(consecutiveFailures) * 60 * 60_000);
}

const STATUS_RANK: Record<SourceHealthRow['healthStatus'], number> = {
  failing: 0,
  unknown: 1,
  ok: 2,
};

function byHealthThenKey(a: SourceHealthRow, b: SourceHealthRow): number {
  const rankDelta = STATUS_RANK[a.healthStatus] - STATUS_RANK[b.healthStatus];
  return rankDelta !== 0 ? rankDelta : a.key.localeCompare(b.key);
}

export async function sourceHealthRows(db: Db): Promise<SourceHealthRow[]> {
  // The relational query builder's `orderBy` only accepts column refs, not a raw
  // sql CASE expression — sorting failing/unknown/ok deterministically happens
  // here in TS after a stable key-ordered fetch.
  const rows = await db.query.sources.findMany({
    orderBy: [asc(schema.sources.key)],
  });
  return rows
    .map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      url: row.url,
      adapterType: row.adapterType,
      cadence: cadenceOf(row.config),
      healthStatus: row.healthStatus,
      lastFetchAt: row.lastFetchAt,
      lastAttemptAt: row.lastAttemptAt,
      lastError: row.lastError,
      consecutiveFailures: row.consecutiveFailures,
      lastFetchedCount: row.lastFetchedCount,
      lastPublishedCount: row.lastPublishedCount,
      lastSkippedCount: row.lastSkippedCount,
      lastRunId: row.lastRunId,
      inBackoffUntil: backoffUntil(row.consecutiveFailures, row.lastAttemptAt),
    }))
    .sort(byHealthThenKey);
}

/** Deep link to the Trigger.dev run detail — format live-verified 2026-07-09. */
export function triggerRunUrl(runId: string | null): string | null {
  const ref = process.env.TRIGGER_PROJECT_REF;
  if (!runId || !ref) return null;
  return `https://cloud.trigger.dev/projects/v3/${ref}/runs/${runId}`;
}
