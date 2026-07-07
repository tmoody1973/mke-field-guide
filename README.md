# MKE Events (working title)

Milwaukee event discovery platform with deep Radio Milwaukee integration.

- Spec: `docs/superpowers/specs/2026-07-07-mke-events-mvp-design.md`
- Plans: `docs/superpowers/plans/`

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (Neon Postgres pooled connection string). `TICKETMASTER_API_KEY` and `EVENTBRITE_PRIVATE_TOKEN` are optional — only needed to ingest the two API sources.
3. `npm run db:migrate` — apply schema
4. `npm run db:seed` — register wave-1 sources
5. `npm run ingest -- urban-milwaukee` — pull real events
6. `npm run dev` — visit http://localhost:3000/events

## Commands

| Command | Purpose |
|---|---|
| `npm run test` | Vitest unit + persistence tests (PGlite, no cloud DB needed) |
| `npm run db:generate` | Generate SQL migration from schema changes |
| `npm run db:migrate` | Apply migrations to Neon |
| `npm run ingest -- <source-key>` | Run ingestion for one source |

## Architecture (Phase 1)

Adapter fetch → `raw_events` (replayable payloads) → Zod-validated normalize → idempotent canonical upsert (`events`, `event_instances`, `venues`, `event_source_links`) → server-rendered `/events`.

## Sources (wave 1, 11 seeded)

| Key | Type | Strategy | Notes |
|---|---|---|---|
| urban-milwaukee | iCal | feed | Broad community calendar |
| linnemans | iCal | feed | Riverwest music venue |
| wmse | iCal | feed | Station event calendar |
| mke-shows | iCal | feed | Local/indie music aggregator |
| ticketmaster-milwaukee | API | ticketmaster adapter | Needs `TICKETMASTER_API_KEY` |
| eventbrite-cooperage | API | eventbrite adapter | Needs `EVENTBRITE_PRIVATE_TOKEN` |
| radio-milwaukee | HTML | selectors | Brightspot CMS community calendar |
| milwaukee-world-festival | HTML | selectors | Henry Maier Festival Park (multi-day festivals expand to one instance per day) |
| pabst-theater-group | HTML | selectors + `crawlDetails` | Covers Pabst, Riverside, Turner Hall, Miller High Life, Vivarium, The Fitzgerald; detail-page crawl fixes listing-only midnight placeholder times |
| milwaukee-downtown | HTML | selectors | BID #21 signature events; only cards with enumerable dates are published (vague "Returning `<month>`" cards excluded) |
| brewers | API | mlb adapter | MLB Stats API, home games only, no key required |

### Deferred sources

- **visit-milwaukee** — deferred: the `/events/` listing is a JS-rendered SimpleView widget (empty mount point in static HTML, no JSON-LD). Its internal events API (`/includes/rest_v2/plugins_events_events_by_date/find/`) requires a private token (verified: HTTP 403 "Invalid credentials" without it), and the public RSS feed (`/event/rss/`) has placeholder pubDates plus free-text validity windows unfit for accurate occurrence data. Retry via the Firecrawl fallback (`firecrawl-jsonld`/selectors on rendered HTML) once `FIRECRAWL_API_KEY` is set. Details in `.superpowers/sdd/task-6-report.md`.
- **county-parks** — deferred: the entire `county.milwaukee.gov` zone sits behind a Cloudflare "managed challenge" (`cf-mitigated: challenge`, "Just a moment..." interstitial) that returns HTTP 403 to every path tested (listing page, `robots.txt`, alternate event-detail URL patterns like `/County-Events/...` and `/JazzInThePark-CathedralSquare`), regardless of user-agent — it requires real browser JS execution to pass, so no fixture could even be captured. The legacy `milwaukeecountyparks.com` domain is a dead parking-page redirect, not an unprotected mirror. This blocks capture the same way a client-rendered app shell would; per the Global Constraints, retry via the Firecrawl fallback once `FIRECRAWL_API_KEY` is set. Details in `.superpowers/sdd/task-8-report.md`.
- **shepherd-express** (City Spark platform) — deferred to the post-2c source backlog: its RSS is a nonstandard article feed, not structured event data. Revisit as an html-class source once City Spark's markup is captured and inspected.

Both `visit-milwaukee` and `county-parks` are blocked on `FIRECRAWL_API_KEY`; `shepherd-express` needs source-specific investigation regardless of key. Dedup + Trigger.dev scheduling land in Plan 2c.
