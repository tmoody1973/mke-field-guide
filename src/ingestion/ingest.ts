import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { FetchedRecord, SourceAdapter } from './adapters/types';
import { canonicalJson } from './canonical-json';
import { persistNormalizedEvent, type Db } from './persist';

export type SourceRow = typeof schema.sources.$inferSelect;

export interface IngestResult {
  fetched: number;
  published: number;
  skipped: number;
}

export function contentHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

async function storeRaw(db: Db, source: SourceRow, record: FetchedRecord): Promise<void> {
  await db
    .insert(schema.rawEvents)
    .values({
      sourceId: source.id,
      sourceEventId: record.sourceEventId,
      sourceUrl: record.sourceUrl,
      extractionMethod: source.adapterType,
      payload: record.payload,
      contentHash: contentHash(record.payload),
    })
    .onConflictDoNothing();
}

async function processRecords(
  db: Db,
  source: SourceRow,
  adapter: SourceAdapter,
  records: FetchedRecord[],
): Promise<IngestResult> {
  const result = { fetched: records.length, published: 0, skipped: 0 };
  const idCounts = new Map<string, number>();
  for (const r of records) idCounts.set(r.sourceEventId, (idCounts.get(r.sourceEventId) ?? 0) + 1);
  for (const record of records) {
    await storeRaw(db, source, record);
    const normalized = adapter.normalize(record);
    if (!normalized) {
      result.skipped += 1;
      continue;
    }
    const supersede = idCounts.get(record.sourceEventId) === 1;
    await persistNormalizedEvent(db, { id: source.id, key: source.key }, normalized, { supersede });
    result.published += 1;
  }
  return result;
}

async function reportOutcome(db: Db, sourceId: string, result: IngestResult): Promise<void> {
  const allSkipped = result.fetched > 0 && result.published === 0;
  await db
    .update(schema.sources)
    .set({
      healthStatus: allSkipped ? 'failing' : 'ok',
      lastError: allSkipped ? 'all records skipped normalization' : null,
      lastAttemptAt: new Date(),
      lastFetchedCount: result.fetched,
      lastPublishedCount: result.published,
      lastSkippedCount: result.skipped,
      consecutiveFailures: allSkipped ? sql`${schema.sources.consecutiveFailures} + 1` : 0,
      updatedAt: new Date(),
      ...(allSkipped ? {} : { lastFetchAt: new Date() }),
    })
    .where(eq(schema.sources.id, sourceId));
}

async function markFailed(db: Db, sourceId: string, err: unknown): Promise<void> {
  await db
    .update(schema.sources)
    .set({
      healthStatus: 'failing',
      lastError: String(err),
      lastAttemptAt: new Date(),
      consecutiveFailures: sql`${schema.sources.consecutiveFailures} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.sources.id, sourceId));
}

export async function ingestSource(
  db: Db,
  source: SourceRow,
  adapter: SourceAdapter,
): Promise<IngestResult> {
  try {
    const { records, parseSkipped } = await adapter.fetch(source.config);
    const result = await processRecords(db, source, adapter, records);
    result.skipped += parseSkipped;
    await reportOutcome(db, source.id, result);
    return result;
  } catch (err) {
    try {
      await markFailed(db, source.id, err);
    } catch (updateErr) {
      console.error('Failed to mark source as failing:', updateErr);
    }
    throw err;
  }
}
