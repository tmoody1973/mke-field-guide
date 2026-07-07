import 'dotenv/config';
import { db } from '@/db';
import * as schema from '@/db/schema';

async function main() {
  await db
    .insert(schema.sources)
    .values({
      key: 'urban-milwaukee',
      name: 'Urban Milwaukee Events',
      url: 'https://urbanmilwaukee.com/events/',
      adapterType: 'ical',
      config: { icalUrl: 'https://urbanmilwaukee.com/events/?ical=1' },
    })
    .onConflictDoNothing({ target: schema.sources.key });
  console.log('Seeded sources: urban-milwaukee');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
