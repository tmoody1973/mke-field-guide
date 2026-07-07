import 'dotenv/config';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { icalAdapter } from '@/ingestion/adapters/ical';
import type { SourceAdapter } from '@/ingestion/adapters/types';
import { persistNormalizedEvent } from '@/ingestion/persist';

const adapters: Record<string, SourceAdapter> = {
  ical: icalAdapter,
};

function contentHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function main() {
  const key = process.argv[2];
  if (!key) {
    console.error('Usage: npm run ingest -- <source-key>');
    process.exit(1);
  }

  const source = await db.query.sources.findFirst({
    where: eq(schema.sources.key, key),
  });
  if (!source) {
    console.error(`Unknown source key: ${key}. Run npm run db:seed first.`);
    process.exit(1);
  }

  const adapter = adapters[source.adapterType];
  if (!adapter) {
    console.error(`No adapter registered for type: ${source.adapterType}`);
    process.exit(1);
  }

  try {
    const records = await adapter.fetch(source.config);
    let published = 0;
    let skipped = 0;

    for (const record of records) {
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

      const normalized = adapter.normalize(record);
      if (!normalized) {
        skipped += 1;
        continue;
      }
      await persistNormalizedEvent(db, source.id, normalized);
      published += 1;
    }

    await db
      .update(schema.sources)
      .set({ healthStatus: 'ok', lastFetchAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.sources.id, source.id));

    console.log(`${key}: ${records.length} fetched, ${published} published, ${skipped} skipped`);
  } catch (err) {
    try {
      await db
        .update(schema.sources)
        .set({ healthStatus: 'failing', updatedAt: new Date() })
        .where(eq(schema.sources.id, source.id));
    } catch (updateErr) {
      // A secondary failure (e.g., DB outage) must not mask the root cause.
      console.error('Failed to mark source as failing:', updateErr);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
