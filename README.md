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
| `npm run enrich` | Embedding + tagging sweep (fingerprint-gated; no-op without `AI_GATEWAY_API_KEY`) |
| `npm run search:eval` | Run the 10-query search eval: hit@3, p50/p95 latency, zero-result probes |

## Architecture (Phase 1)

Adapter fetch → `raw_events` (replayable payloads) → Zod-validated normalize → idempotent canonical upsert (`events`, `event_instances`, `venues`, `event_source_links`) → server-rendered `/events`.

## Search (hybrid FTS + vector)

`/events` accepts URL-addressable params — `q`, `date` (`tonight`|`today`|`this-weekend`|`this-week`), `cat`, `venue`, `neighborhood` (dormant until neighborhood data lands), `free=1`, `vibe`, `audience`, `tod` (`morning`|`afternoon`|`evening`|`night`), `maxPrice` — plus preset routes `/events/tonight`, `/events/today`, `/events/this-weekend`, `/free-events`. Invalid params are silently dropped. Date phrases inside the query ("live music **tonight**", "**this weekend**") are stripped by pure chicago-time heuristics and win over the `date` param — no LLM in the hot path.

Retrieval is one SQL round trip: a future-instances base CTE (facets as indexed WHERE clauses) feeds two ranked legs — weighted FTS on a trigger-maintained `search_tsv` (title **A** / category+tags **B** / description **C**, plus trigram typo tolerance and venue-name affinity) and pgvector cosine over HNSW — fused with reciprocal rank fusion (k=60). The query embedding (`openai/text-embedding-3-small` via the AI Gateway) is the only query-time AI call, capped at 150ms; on timeout or when `AI_GATEWAY_API_KEY` is absent the search runs FTS-only.

Enrichment runs as a daily sweep (7:00 Chicago, between ingest and dedup), never blocking publishing: re-embeds on content-fingerprint change and tags events (`category`, `vibeTags`, `audienceTags` via `anthropic/claude-haiku-4-5`; `isFree` filled only when the adapter left it null). Eval baseline (2026-07-07, FTS-only, production): keyword hit@3 **5/5**, p95 **45.3ms** query-only; semantic queries deferred until the key lands.

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

## Sources (wave 1, 13 seeded)

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
| visit-milwaukee | HTML | `sitemap-jsonld` | Sitemap → statically-rendered detail pages with JSON-LD (JS listing is unusable); 150 pages/run, 2s crawl-delay per robots.txt, newest-lastmod first, weekly cadence; inline-JS time enricher upgrades date-only events. Some crawl budget lands on past-dated pages — the listing filter hides them and retention purges them |
| county-parks | HTML | `firecrawl-selectors` | CivicPlus calendar behind a Cloudflare challenge — Firecrawl renders it (needs `FIRECRAWL_API_KEY`, ~1 credit/run); page 1 covers ~3 days of a 30-page calendar → daily cadence; recurring programs expand to one instance per day-row |

### Deferred sources

- **shepherd-express** (City Spark platform) — deferred to the post-2c source backlog: its RSS is a nonstandard article feed, not structured event data. Revisit as an html-class source once City Spark's markup is captured and inspected.
