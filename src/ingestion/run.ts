import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { icalAdapter } from '@/ingestion/adapters/ical';
import type { SourceAdapter } from '@/ingestion/adapters/types';
import { ingestSource } from '@/ingestion/ingest';

const adapters: Record<string, SourceAdapter> = {
  ical: icalAdapter,
};

async function main() {
  const key = process.argv[2];
  if (!key) {
    console.error('Usage: npm run ingest -- <source-key>');
    process.exit(1);
  }
  const source = await db.query.sources.findFirst({ where: eq(schema.sources.key, key) });
  if (!source) {
    console.error(`Unknown source key: ${key}. Run npm run db:seed first.`);
    process.exit(1);
  }
  const adapter = adapters[source.adapterType];
  if (!adapter) {
    console.error(`No adapter registered for type: ${source.adapterType}`);
    process.exit(1);
  }
  const result = await ingestSource(db, source, adapter);
  console.log(`${key}: ${result.fetched} fetched, ${result.published} published, ${result.skipped} skipped`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
