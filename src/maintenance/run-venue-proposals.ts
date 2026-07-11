// Standalone advisory venue-merge proposal pass over in-band trigram candidates (propose-only).
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { proposeVenueMerges } from './venue-proposals';

async function main(): Promise<void> {
  const { db } = await import('@/db');
  const result = await proposeVenueMerges(db);
  console.log(`proposed ${result.proposed}, rejected ${result.rejected}, skipped ${result.skipped}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
