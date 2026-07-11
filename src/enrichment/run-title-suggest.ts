// Standalone advisory title-cleanup pass over scraper-sourced events (propose-only).
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { suggestTitles } from './title-suggest-sweep';

async function main(): Promise<void> {
  const { db } = await import('@/db');
  const result = await suggestTitles(db);
  console.log(`suggested ${result.suggested}, alreadyClean ${result.alreadyClean}, skipped ${result.skipped}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
