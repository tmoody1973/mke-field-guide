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
    key: 'comedysportz',
    name: 'ComedySportz Milwaukee (venue site)',
    url: 'https://cszmke.com/milwaukee-comedysportz-milwaukee-events',
    adapterType: 'html',
    config: {
      // Public SpotHopper JSON API — no auth, CORS-open. No per-event URL
      // exists in the feed; every event links back to the listing page above.
      strategy: 'selectors',
      listingUrls: ['https://www.spothopperapp.com/api/spots/8096/events'],
      sourceKey: 'comedysportz',
    },
  },
  {
    key: 'milwaukee-improv',
    name: 'Milwaukee Improv (venue site)',
    url: 'https://improv.com/milwaukee/calendar/',
    adapterType: 'html',
    config: {
      // Calendar listing has no structured data, but its plain-GET `?start=`
      // pagination enumerates detail-page URLs, and each detail page carries
      // one Event JSON-LD block per showtime. Daily cadence (the default,
      // matching the other venue-owned rows): the bounded crawl is light
      // (~43 fetches) and comedy on-sales roll continuously.
      strategy: 'calendar-jsonld',
      sourceKey: 'milwaukee-improv',
      calendarUrl: 'https://improv.com/milwaukee/calendar/',
    },
  },
  {
    key: 'mso',
    name: 'Milwaukee Symphony Orchestra (venue site)',
    url: 'https://www.mso.org/concerts/calendar/',
    adapterType: 'html',
    config: {
      // No usable API (Tribe REST 401s) or JSON-LD; a bare fetch renders the
      // current month and its own #month_switcher options are the only
      // trustworthy source of month URLs — gap months (e.g. Aug 2026) are
      // absent from that list and never constructed. Grid times lack am/pm,
      // so a bounded per-production detail crawl supplies authoritative
      // performance times and venue.
      strategy: 'mso-calendar',
      sourceKey: 'mso',
      calendarUrl: 'https://www.mso.org/concerts/calendar/',
    },
  },
  {
    key: 'milwaukee-rep',
    name: 'Milwaukee Repertory Theater (venue site)',
    url: 'https://www.milwaukeerep.com/shows/current-season/',
    adapterType: 'html',
    config: {
      // Listing card date text is UNTRUSTED (live wrong-end-year bug observed
      // on multiple cards); each show's own detail page h2.tight-paragraph
      // range is authoritative. ~12 shows/season expand into all-day
      // day-instance runs via the day-range machinery (dark days included —
      // documented limitation, see README). Daily cadence (the default,
      // matching the other venue-owned rows): the bounded ~13-fetch crawl is
      // light even though the season itself changes slowly.
      strategy: 'milwaukee-rep-season',
      sourceKey: 'milwaukee-rep',
      listingUrl: 'https://www.milwaukeerep.com/shows/current-season/',
    },
  },
  {
    key: 'mad-planet',
    name: 'Mad Planet (venue site)',
    url: 'https://www.mad-planet.net/events',
    adapterType: 'html',
    config: {
      strategy: 'selectors',
      listingUrls: ['https://www.mad-planet.net/events?format=json'],
      sourceKey: 'mad-planet',
    },
  },
  {
    key: 'wiggle-room',
    name: 'Wiggle Room (venue site)',
    url: 'https://wiggleroommke.com/event/',
    adapterType: 'html',
    config: {
      // Cloudflare returns a 403 on a plain fetch; Firecrawl renders past it
      // but wraps the JSON body in <html><body>...</body></html> — the
      // tribe-events factory's JSON extraction tolerates that wrapper.
      strategy: 'firecrawl-selectors',
      listingUrls: ['https://wiggleroommke.com/wp-json/tribe/events/v1/events?per_page=50'],
      sourceKey: 'wiggle-room',
    },
  },
  {
    key: 'centro-cafe',
    name: 'Centro Café / Bar Centro (venue site)',
    url: 'https://centrocaferiverwest.com/event/',
    adapterType: 'html',
    config: {
      strategy: 'selectors',
      listingUrls: ['https://centrocaferiverwest.com/wp-json/tribe/events/v1/events?per_page=50'],
      sourceKey: 'centro-cafe',
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
