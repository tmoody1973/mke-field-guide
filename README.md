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
| `npm run dedup` | Score cross-source candidate pairs, auto-merge or queue for review |
| `npm run retention` | Delete expired instances/empty events, prune superseded raw payloads |
| `npm run trigger:dev` | Run the Trigger.dev dev server locally (schedules + tasks) |
| `npm run trigger:deploy` | Deploy Trigger.dev tasks and schedules to the cloud project |

## Architecture (Phase 1)

Adapter fetch → `raw_events` (replayable payloads) → Zod-validated normalize → idempotent canonical upsert (`events`, `event_instances`, `venues`, `event_source_links`) → server-rendered `/events`.

## Dedup & review queue

`npm run dedup` finds candidate pairs across sources that share a Chicago-local calendar day (the blocking key). Venue is a scoring signal, not a blocker — a Henry Maier Festival Park listing and the same show billed under an amphitheater name can still be compared. Pairs already sharing a source, or already reviewed, are excluded.

| Signal | Weight | Notes |
|---|---|---|
| Title trigram similarity | 0.55 | pg_trgm `similarity()` on normalized titles |
| Venue affinity | 0.15 | 1 if same venue, trigram on names otherwise, 0.5 if either unknown |
| Time proximity | 0.15 | linear decay over a ±180 min window; midnight-placeholder starts score neutral (0.5) |
| Exact URL match | 0.15 | `canonical_url` equality |

| Score | Verdict |
|---|---|
| ≥ 0.80 | Auto-merge |
| 0.55 – 0.80 | Queued to `event_reviews` (`pending`) |
| < 0.55 | Ignored |

The event that survives a merge is picked by a confidence ladder — `api` > `ical`/`rss` (tied) > `html` > `firecrawl` — ties go to the older event. Merging repoints `event_source_links` and `event_instances` onto the canonical event (instance collisions on `(event_id, start_at)` collapse), backfills only null canonical fields from the duplicate, deletes the duplicate, and records a receipt in `event_clusters` (score breakdown, decided-by). Pending reviews are resolved through `applyReview` (approve re-runs the merge; reject just closes the row) — an admin UI over `event_reviews`/`event_clusters` is Phase 5.

## Scheduling (Trigger.dev)

Trigger.dev project `mke-events` (`proj_huidipgowadfhdfioztw`) runs four declarative schedules, all `America/Chicago`:

| Schedule | Cron | Scope |
|---|---|---|
| `ingest-daily` | 6:00 daily | Sources with daily cadence |
| `ingest-weekly` | 5:00 Mon | All sources (superset — also covers weekly-cadence sources) |
| `dedup-daily` | 8:00 daily | Equivalent to `npm run dedup` |
| `retention-weekly` | 4:00 Mon | Equivalent to `npm run retention` |

Each source ingest runs through a single `ingest` queue (`concurrencyLimit: 1`) keyed per source (`concurrencyKey: source.key`), so repeat runs of the same source serialize while different sources still run in parallel. A source is skipped after 3 consecutive failures for `24h · 2^(n-3)` hours, capped at 7 days — Trigger's own run-level retries handle transient failures separately. Cadence comes from `sources.config.cadence` (`daily` | `weekly`, default `daily`); only `milwaukee-downtown` is `weekly`.

For local dev: `npm run trigger:dev` (CLI login). Deploys (`npm run trigger:deploy`) read `DATABASE_URL` and adapter API keys from the Trigger.dev dashboard's environment variables, not from `.env`.

## Retention

`npm run retention` (also `retention-weekly`) deletes, in order:
1. `event_instances` more than 90 days past `start_at`
2. `events` left with zero remaining instances
3. `raw_events` payloads superseded by a newer row for the same `(source, sourceEventId)`, once that superseded row is 30+ days old — the newest payload per source event is kept forever

`/events` already filters to upcoming instances at query time, independent of retention.

## Sources (wave 1, 11 seeded)

Per-run stats (`last_fetched_count` / `last_published_count` / `last_skipped_count`) are recorded on each source after every ingest, including HTML sources' parse-time skips — a matched-but-unextractable card (e.g. a vague "Returning `<month>`" listing) counts as a skip, not silent data loss.

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

Both `visit-milwaukee` and `county-parks` are blocked on `FIRECRAWL_API_KEY`; `shepherd-express` needs source-specific investigation regardless of key.
