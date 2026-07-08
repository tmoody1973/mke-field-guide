import 'dotenv/config';
import { db } from '@/db';
import { hasGatewayKey } from '@/enrichment/embed';
import { enrichSweep } from '@/enrichment/sweep';

async function main() {
  if (!hasGatewayKey()) {
    console.log('enrich: AI_GATEWAY_API_KEY not set — skipping (search continues to run FTS-only)');
  }
  const result = await enrichSweep(db);
  console.log(`enrich: ${result.embedded} embedded, ${result.tagged} tagged, ${result.skipped} skipped`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
