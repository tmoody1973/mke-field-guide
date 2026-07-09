# MKE Field Guide

Milwaukee event discovery platform with deep Radio Milwaukee integration. (Brand name confirmed 2026-07-08; the site name lives in `SITE_NAME` in `src/lib/site.ts`.)

- Spec: `docs/superpowers/specs/2026-07-07-mke-events-mvp-design.md`
- Plans: `docs/superpowers/plans/`

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (Neon Postgres pooled connection string). `TICKETMASTER_API_KEY` and `EVENTBRITE_PRIVATE_TOKEN` are optional — only needed to ingest the two API sources. `RM_PLAYLIST_CONVEX_URL` powers the mini-player's now-playing line (public deployment URL, no secret); `NEXT_PUBLIC_SITE_URL` is the canonical origin for metadata/sitemaps (defaults to localhost).
3. `npm run db:migrate` — apply schema
4. `npm run db:seed` — register wave-1 sources
5. `npm run ingest -- urban-milwaukee` — pull real events
6. `npm run dev` — visit http://localhost:3000

## Commands

| Command | Purpose |
|---|---|
| `npm run test` | Vitest unit + persistence tests (PGlite, no cloud DB needed) |
| `npm run db:generate` | Generate SQL migration from schema changes |
| `npm run db:migrate` | Apply migrations to Neon |
| `npm run ingest -- <source-key>` | Run ingestion for one source |
| `npm run dedup` | Score cross-source candidate pairs, auto-merge or queue for review |
| `npm run dedup:resolve-same-show` | Standalone drain of the pending queue for pairs now meeting the same-show rule |
| `npm run retention` | Delete expired instances/empty events, prune superseded raw payloads |
| `npm run trigger:dev` | Run the Trigger.dev dev server locally (schedules + tasks) |
| `npm run trigger:deploy` | Deploy Trigger.dev tasks and schedules to the cloud project |
| `npm run enrich` | Embedding + tagging sweep (fingerprint-gated; no-op without `AI_GATEWAY_API_KEY`) |
| `npm run search:eval` | Run the 10-query search eval: hit@3, p50/p95 latency, zero-result probes |
| `npm run e2e` | Playwright E2E (search, filter, detail+ics, presets, newsletter) against a local server |
| `npm run venues:backfill-slugs` | One-time slug backfill for venue pages (new venues get slugs at insert) |
| `npm run venues:assign-neighborhoods` | Apply the curated venue→neighborhood map; reports unmapped venues + stale keys |
| `npm run station:flag [-- --dry-run]` | Heuristic `is_station_event` sweep (one-way; dry-run prints the would-flag list) |
| `npm run picks:add -- --slug … --curator … --blurb …` | Add a staff pick (defaults to the current Chicago week) |

## Architecture (Phase 1)

Adapter fetch → `raw_events` (replayable payloads) → Zod-validated normalize → idempotent canonical upsert (`events`, `event_instances`, `venues`, `event_source_links`) → server-rendered `/events`.

## Public site (Phase 4)

**Routes:** `/` (search-first homepage: hero, staff picks, Tonight, This Weekend, Radio Milwaukee events, neighborhood tiles, newsletter) · `/events` (browse + facet chips) · `/events/tonight|today|this-weekend` · `/free-events` · `/live-music` · `/events/[slug]` (detail + add-to-calendar: Google deep link and `/events/[slug]/ics` download) · `/venues/[slug]` · `/categories/[slug]` · `/neighborhoods/[slug]` · `/picks` · `/digest` (noindex; copy-paste source for the newsletter ESP).

**Mini-player:** persistent 4-station bar (88Nine, HYFIN, Rhythm Lab, 414 Music) in the root layout — survives navigation; switch-implies-play. Now-playing metadata comes from the RM playlist app's public Convex query via `/api/now-playing?station=<slug>` (15s cache, 20-min staleness guard, falls back to "Listen live"; renders fallback when `RM_PLAYLIST_CONVEX_URL` is unset). Note: the StreamGuys mounts 502 `HEAD` requests — health-check with ranged `GET`.

**Newsletter workflow:** the capture form writes `newsletter_subscribers` (idempotent on email); `/digest` auto-assembles this week's picks + weekend highlights for the team to paste into the existing ESP. No ESP automation in MVP.

**Neighborhoods:** curated mapping, not PostGIS — registry in `src/lib/neighborhoods.ts` (9 hoods incl. East Side), venue map in `src/maintenance/venue-neighborhood-map.ts` (~55 venues ≈ 70% of upcoming instances). New venues start unmapped; re-run `venues:assign-neighborhoods` after curation passes.

**Station events:** `is_station_event` is set by the heuristic sweep (venue/address at Radio Milwaukee, or title matching 88Nine/HYFIN/414 Live — bare "backyard" deliberately excluded; WMSE also runs one). One-way; admin override lands in Phase 5. Flagged events get the badge, homepage module, and float first within browse day-groups.

**SEO:** per-instance Event JSON-LD on detail pages (Google's recommended shape for recurring events, capped at 10 instances); split sitemaps at `/sitemap/{core,events,venues,taxonomy}.xml` (robots.txt lists them, disallows `/digest`); filtered `/events` states are `noindex, follow` with canonical `/events`; preset routes are the indexable landing pages. The `maxPrice` search param works (against `price_min`) but is deliberately undocumented in the UI — no price writer populates the columns yet.

## Search (hybrid FTS + vector)

`/events` accepts URL-addressable params — `q`, `date` (`tonight`|`today`|`this-weekend`|`this-week`), `cat`, `venue`, `neighborhood` (dormant until neighborhood data lands), `free=1`, `vibe`, `audience`, `tod` (`morning`|`afternoon`|`evening`|`night`), `maxPrice` — plus preset routes `/events/tonight`, `/events/today`, `/events/this-weekend`, `/free-events`. Invalid params are silently dropped. Date phrases inside the query ("live music **tonight**", "**this weekend**") are stripped by pure chicago-time heuristics and win over the `date` param — no LLM in the hot path.

Retrieval is one SQL round trip: a future-instances base CTE (facets as indexed WHERE clauses) feeds two ranked legs — weighted FTS on a trigger-maintained `search_tsv` (title **A** / category+tags **B** / description **C**, plus trigram typo tolerance and venue-name affinity) and pgvector cosine over HNSW — fused with reciprocal rank fusion (k=60). The query embedding (`openai/text-embedding-3-small` via the AI Gateway) is the only query-time AI call, capped at 150ms; on timeout or when `AI_GATEWAY_API_KEY` is absent the search runs FTS-only.

Enrichment runs as a daily sweep (7:00 Chicago, between ingest and dedup), never blocking publishing: re-embeds on content-fingerprint change and tags events (`category`, `vibeTags`, `audienceTags` via `anthropic/claude-haiku-4-5`; `isFree` filled only when the adapter left it null). Eval baseline (2026-07-08, full hybrid, production, 1,022 events embedded + 1,020 tagged): hit@3 **9/10** (keyword 5/5, semantic 4/5 — the free-word→facet mapping fixed the free-family miss; date-night remains the honest miss pending ground-truth curation), query-only p95 **76.1ms**, zero-result probes all non-empty. The query-embed timeout is env-tunable via `SEARCH_EMBED_TIMEOUT_MS` (default 150ms, sized for Vercel-datacenter gateway latency; raise it for local/self-hosted runs).

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

**Same-show auto-merge.** A review-band pair (0.55–0.80) skips the queue and auto-merges when venue affinity is ≥ 0.9 *and* the start times are within 15 minutes — same venue, same start time is the same show, and title variants (support-act suffixes like "w/ Jay Som") are exactly why these pairs land mid-band instead of clearing 0.80 on title alone. This applies only to the review band; the ≥ 0.80 ladder path is unchanged. Survivor selection for these merges prefers the venue's own listing over the confidence ladder — currently `pabst-theater-group` — since a venue is ground truth for its own stage; if neither or both sides are venue-owned, the standard ladder decides. `dedupSweep` also drains the *existing* pending queue for any row that now meets the rule (`npm run dedup:resolve-same-show` runs this standalone); a drained row's `event_reviews` entry cascades away with its deleted duplicate event.

## Admin (Phase 5, Slice 1)

`/admin` is a Clerk-gated segment (proxy middleware matches `/admin(.*)`, `/__clerk(.*)`) — the public site is unaffected. Without Clerk keys configured, `.env` absent falls back to Clerk's keyless dev mode; every `/admin` route stays unusable until keys are added. Six env vars, all under the "Phase 5: admin auth" block in `.env.example`: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL` (`/admin/sign-in`), `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` (`/admin`), `ADMIN_ALLOWLIST_EMAILS`, `PICKS_ALLOWLIST_EMAILS`.

Staff access is a two-tier email allowlist, app-side (not a Clerk org/role feature): `admin` (all tools) and `picks` (staff-picks manager only); an email on both lists resolves to `admin`. Both lists are comma-separated, case-insensitive. An empty `PICKS_ALLOWLIST_EMAILS` collapses this to single-tier — only `ADMIN_ALLOWLIST_EMAILS` grants access. Unauthenticated visitors are redirected to `/admin/sign-in`; authenticated but non-allowlisted (or under-tiered) visitors land on `/admin/denied`.

**Picks manager** (`/admin/picks`, `+ /new`, `+ /[id]/edit`) is the day-to-day way to create and reorder weekly staff picks — it replaces routine use of `npm run picks:add`, which stays available for scripting/backfill. Changes revalidate the homepage, `/picks`, and `/digest` immediately.

**Merge-cascade caveat:** picks reference an `event` row directly. If a dedup merge (see below) deletes the pick's event as the merged-away duplicate, the pick row is deleted with it — re-add the pick against the surviving event after a merge, don't assume it silently follows the merge.

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
