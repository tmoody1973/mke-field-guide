import 'dotenv/config';
import { db } from '@/db';
import { dedupSweep } from '@/dedup/sweep';

async function main() {
  const result = await dedupSweep(db);
  console.log(`dedup: ${result.examined} pairs examined, ${result.merged} merged, ${result.queued} queued for review`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
