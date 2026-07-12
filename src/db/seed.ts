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
      cadence: 'weekly',
    },
  },
  {
    key: 'visit-milwaukee',
    name: 'Visit Milwaukee Events',
    url: 'https://www.visitmilwaukee.org/events/',
    adapterType: 'html',
    config: {
      // Listing page is JS-rendered without structured data; detail pages are
      // server-rendered with JSON-LD, and the public sitemap enumerates them.
      strategy: 'sitemap-jsonld',
      sourceKey: 'visit-milwaukee',
      sitemapUrl: 'https://www.visitmilwaukee.org/sitemap.xml',
      urlFilter: '/event/',
      limit: 150,
      delayMs: 2000, // robots.txt declares Crawl-delay: 2
      cadence: 'weekly',
    },
  },
  {
    key: 'county-parks',
    name: 'Milwaukee County Parks Events Calendar',
    url: 'https://county.milwaukee.gov/EN/Parks/Experience/Events-Calendar',
    adapterType: 'html',
    config: {
      // The whole county.milwaukee.gov zone sits behind a Cloudflare managed
      // challenge (plain HTTP: HTTP 403 on every path — see README "Deferred
      // sources"); Firecrawl renders past it. The result has no JSON-LD, so
      // the (also-Firecrawl) 'firecrawl-selectors' strategy pairs
      // fetchRenderedHtml with the registered selector parser.
      strategy: 'firecrawl-selectors',
      listingUrls: ['https://county.milwaukee.gov/EN/Parks/Experience/Events-Calendar'],
      sourceKey: 'county-parks',
      // The widget paginates via an internal AJAX call not present in the
      // rendered markup ("Showing page 1 of 30"); only page 1 (sorted
      // StartDate Ascending, ~3 days deep) is captured per run. Daily cadence
      // is required so that rolling window is never missed between runs —
      // unlike the other weekly html sources, whose single page already
      // lists every upcoming event.
      cadence: 'daily',
    },
  },
  {
    key: 'x-ray-arcade',
    name: 'X-Ray Arcade (venue site)',
    url: 'https://xrayarcade.com/calendar',
    adapterType: 'html',
    config: {
      strategy: 'selectors',
      listingUrls: ['https://xrayarcade.com/calendar?format=json'],
      sourceKey: 'x-ray-arcade',
    },
  },
  {
    key: 'jazz-gallery',
    name: 'Jazz Gallery Center for the Arts (venue site)',
    url: 'https://jazzgallerycenterforarts.org/events',
    adapterType: 'html',
    config: {
      strategy: 'selectors',
      listingUrls: ['https://jazzgallerycenterforarts.org/events?format=json'],
      sourceKey: 'jazz-gallery',
    },
  },
  {
    key: 'cactus-club',
    name: 'Cactus Club (venue site)',
    url: 'https://www.cactusclubmilwaukee.com/events/',
    adapterType: 'html',
    config: {
      strategy: 'selectors',
      listingUrls: ['https://www.cactusclubmilwaukee.com/events/'],
      sourceKey: 'cactus-club',
    },
  },
  {
    key: 'marcus-center',
    name: 'Marcus Performing Arts Center (venue site)',
    url: 'https://www.marcuscenter.org/events/',
    adapterType: 'html',
    config: {
      // Live-verified: no start_date param returns events sorted ascending
      // from today (the venue's local "today"), so no dynamic date param
      // is needed — unlike county-parks' AJAX pagination quirk.
      strategy: 'selectors',
      listingUrls: ['https://www.marcuscenter.org/wp-json/tribe/events/v1/events?per_page=50'],
      sourceKey: 'marcus-center',
    },
  },
  {
    key: 'brewers',
    name: 'Milwaukee Brewers (home games)',
    url: 'https://www.mlb.com/brewers/schedule',
    adapterType: 'api',
    config: { adapter: 'mlb', teamId: 158, daysAhead: 120, homeOnly: true },
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
