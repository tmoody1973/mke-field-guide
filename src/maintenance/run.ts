import 'dotenv/config';
import { db } from '@/db';
import { runRetention } from '@/maintenance/retention';

async function main() {
  const result = await runRetention(db);
  console.log(
    `retention: ${result.instancesDeleted} instances, ${result.eventsDeleted} events, ${result.rawEventsDeleted} raw payloads removed`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
