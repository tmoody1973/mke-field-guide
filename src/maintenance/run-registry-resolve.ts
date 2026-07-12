// Standalone weekly venue-registry resolution pass (annotate-only + registry-evidence proposals).
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolveVenues } from './registry-resolve';

async function main(): Promise<void> {
  const { db } = await import('@/db');
  const result = await resolveVenues(db);
  console.log(
    `annotated ${result.annotated}, unmatched ${result.unmatched}, suggested ${result.suggested}, skipped ${result.skipped}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
