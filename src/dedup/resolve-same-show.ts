import 'dotenv/config';
import { db } from '@/db';
import { resolvePendingSameShow } from '@/dedup/sweep';

async function main() {
  const result = await resolvePendingSameShow(db);
  console.log(`dedup:resolve-same-show: ${result.merged} merged, ${result.kept} kept pending`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
