// Standalone advisory judge pass over pending review pairs (annotate-only).
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { judgePendingReviews } from './judge-sweep';

async function main(): Promise<void> {
  const { db } = await import('@/db');
  const result = await judgePendingReviews(db);
  console.log(`judged ${result.judged}, skipped ${result.skipped}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
