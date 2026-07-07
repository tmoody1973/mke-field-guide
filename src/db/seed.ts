import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';

type SeedSource = typeof schema.sources.$inferInsert;

const SOURCES: SeedSource[] = [
  {
    key: 'urban-milwaukee',
    name: 'Urban Milwaukee Events',
    url: 'https://urbanmilwaukee.com/events/',
    adapterType: 'ical',
    config: { icalUrl: 'https://urbanmilwaukee.com/events/?ical=1' },
  },
  {
    key: 'linnemans',
    name: "Linneman's Riverwest Inn",
    url: 'https://linnemans.com/events/',
    adapterType: 'ical',
    config: { icalUrl: 'https://linnemans.com/events/?ical=1' },
  },
  {
    key: 'wmse',
    name: 'WMSE 91.7FM Events',
    url: 'https://wmse.org/event/',
    adapterType: 'ical',
    config: { icalUrl: 'https://wmse.org/event/?ical=1' },
  },
  {
    key: 'mke-shows',
    name: 'MKE Shows',
    url: 'https://mkeshows.com/',
    adapterType: 'ical',
    config: { icalUrl: 'https://mkeshows.com/api/export/ics' },
  },
  {
    key: 'ticketmaster-milwaukee',
    name: 'Ticketmaster Milwaukee',
    url: 'https://www.ticketmaster.com/discover/milwaukee',
    adapterType: 'api',
    config: { adapter: 'ticketmaster', city: 'Milwaukee', stateCode: 'WI' },
  },
  {
    key: 'eventbrite-cooperage',
    name: 'Eventbrite — The Cooperage',
    url: 'https://www.eventbrite.com/o/the-cooperage-17113476605',
    adapterType: 'api',
    config: { adapter: 'eventbrite', organizerIds: ['17113476605'] },
  },
  {
    key: 'radio-milwaukee',
    name: 'Radio Milwaukee Community Calendar',
    url: 'https://radiomilwaukee.org/community-calendar',
    adapterType: 'html',
    config: {
      strategy: 'selectors',
      listingUrls: ['https://radiomilwaukee.org/community-calendar'],
      sourceKey: 'radio-milwaukee',
    },
  },
  {
    key: 'milwaukee-world-festival',
    name: 'Milwaukee World Festival (Henry Maier Festival Park)',
    url: 'https://www.milwaukeeworldfestival.com/find-events/calendar',
    adapterType: 'html',
    config: {
      strategy: 'selectors',
      listingUrls: ['https://www.milwaukeeworldfestival.com/find-events/calendar'],
      sourceKey: 'milwaukee-world-festival',
    },
  },
  {
    key: 'pabst-theater-group',
    name: 'Pabst Theater Group Events',
    url: 'https://www.pabsttheatergroup.com/events',
    adapterType: 'html',
    config: {
      strategy: 'selectors',
      listingUrls: ['https://www.pabsttheatergroup.com/events'],
      sourceKey: 'pabst-theater-group',
      crawlDetails: { limit: 30 },
    },
  },
  {
    key: 'milwaukee-downtown',
    name: 'Milwaukee Downtown Signature Events (BID #21)',
    url: 'https://www.milwaukeedowntown.com/signature-events/',
    adapterType: 'html',
    config: {
      strategy: 'selectors',
      listingUrls: ['https://www.milwaukeedowntown.com/signature-events/'],
      sourceKey: 'milwaukee-downtown',
    },
  },
];

async function main() {
  for (const source of SOURCES) {
    await db
      .insert(schema.sources)
      .values(source)
      .onConflictDoUpdate({
        target: schema.sources.key,
        set: {
          name: sql`excluded.name`,
          url: sql`excluded.url`,
          adapterType: sql`excluded.adapter_type`,
          config: sql`excluded.config`,
          updatedAt: new Date(),
        },
      });
  }
  console.log(`Seeded ${SOURCES.length} sources: ${SOURCES.map((s) => s.key).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
