# MKE Field Guide

> Your field guide to Milwaukee events — powered by Radio Milwaukee.

**Live:** [mke-field-guide.vercel.app](https://mke-field-guide.vercel.app)

MKE Field Guide aggregates Milwaukee's fragmented event landscape — venue calendars, ticketing APIs, festival grounds, civic feeds, community calendars — into one fast, searchable, trustworthy place, and connects visitors to Radio Milwaukee's four stations along the way.

## Features

- **13 live sources, fully autonomous pipeline** — iCal/RSS feeds, Ticketmaster & Eventbrite APIs, MLB Stats API, and HTML scrapers (with a Firecrawl fallback for JS-rendered sites), running on daily/weekly cloud crons with health tracking and exponential backoff
- **Hybrid search** — weighted Postgres full-text + pgvector semantic retrieval fused with reciprocal rank fusion, date-phrase understanding ("live music tonight"), URL-addressable facets; eval-baselined at 9/10 hit@3 with p95 76ms (no LLM in the hot path)
- **Cross-source dedup** — trigram/venue/time/URL-scored candidate pairs with auto-merge, a venue-owned same-show rule, and a human review queue with a per-pair survivor picker
- **Admin suite** (Clerk-gated, two-tier staff allowlist) — source health dashboard with Trigger.dev run links, event editor with field locks + edit provenance, duplicate review queue, staff-picks manager
- **Radio Milwaukee integration** — persistent 4-station mini-player with live now-playing metadata, staff picks with editorial voice, station-event prominence, weekly newsletter digest
- **SEO-first public site** — per-instance Event JSON-LD, split sitemaps, canonical filter states, add-to-calendar (Google + .ics) on every event

## Tech stack

| Layer | Technology |
|---|---|
| Web app | Next.js (App Router) on Vercel |
| Database | Neon Postgres (pgvector, pg_trgm) via Drizzle ORM |
| Jobs | Trigger.dev v4 (scheduled ingestion, dedup, enrichment, retention) |
| Auth (admin) | Clerk + app-side email allowlist |
| AI (ingest-time only) | Vercel AI Gateway — embeddings (`text-embedding-3-small`) + tagging (`claude-haiku-4-5`) |
| UI | Tailwind v4 + vendored RetroUI (neobrutalist), custom Radio Milwaukee theme |
| Testing | Vitest + PGlite (real Postgres in-memory, no cloud DB needed), Playwright E2E |

## Quick start

**Prerequisites:** Node.js 20+, a [Neon](https://neon.tech) Postgres database (free tier works).

```bash
git clone <repo-url> && cd mke-events
npm install
cp .env.example .env   # fill in DATABASE_URL at minimum
npm run db:migrate     # apply schema
npm run db:seed        # register wave-1 sources
npm run ingest -- urban-milwaukee   # pull real events (no API key needed)
npm run dev            # http://localhost:3000
```

`npm run test` runs the full suite (424 tests) against in-memory PGlite — no database or keys required.

## Environment variables

Only `DATABASE_URL` is required to run the public site locally. Everything else degrades gracefully.

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Neon Postgres pooled connection string | Yes |
| `TICKETMASTER_API_KEY` | Ticketmaster Discovery source | No |
| `EVENTBRITE_PRIVATE_TOKEN` | Eventbrite source | No |
| `FIRECRAWL_API_KEY` | JS-rendered scraper sources (county-parks) | No |
| `AI_GATEWAY_API_KEY` | Embeddings + tagging; semantic half of search (absent = FTS-only) | No |
| `RM_PLAYLIST_CONVEX_URL` | Mini-player now-playing metadata | No |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for metadata/sitemaps | No |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` + sign-in URLs | Admin auth (absent = `/admin` unusable, public site unaffected) | No |
| `ADMIN_ALLOWLIST_EMAILS` / `PICKS_ALLOWLIST_EMAILS` | Two-tier staff access (emails or `@domain` rules) | No |
| `TRIGGER_PROJECT_REF` | Admin dashboard links to Trigger.dev run detail | No |
| `NEWSLETTER_THROTTLE_DISABLED` | e2e-only throttle bypass — never set in a deployment | No |

## Project structure

```
src/
├── app/            # Next.js routes (public site + /admin suite + server actions)
├── components/     # UI components (RetroUI-based, admin forms)
├── db/             # Drizzle schema, seed, canonical Db type
├── ingestion/      # Source adapters (ical/api/html/firecrawl), normalize, persist
├── dedup/          # Candidate scoring, merge engine, review workflow
├── enrichment/     # Embedding + tagging sweep (fingerprint-gated)
├── search/         # Hybrid FTS+vector retrieval, query understanding, eval harness
├── queries/        # Read-side query modules (home, admin dashboards, detail)
├── lib/            # Chicago-time helpers, staff auth, display, site constants
├── maintenance/    # Retention, backfills, station flagging, picks CLI
├── trigger/        # Trigger.dev task + schedule definitions
└── proxy.ts        # Clerk middleware (admin segment only)
tests/              # Vitest suites (PGlite-backed) mirroring src/
e2e/                # Playwright specs
drizzle/            # SQL migrations (replayed verbatim by the test harness)
docs/superpowers/   # Design spec + per-slice implementation plans
```

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
| `npm run e2e` | Playwright E2E (search, filter, detail+ics, presets, newsletter, admin gates) against a local server |
| `npm run venues:backfill-slugs` | One-time slug backfill for venue pages (new venues get slugs at insert) |
| `npm run venues:assign-neighborhoods` | Apply the curated venue→neighborhood map; reports unmapped venues + stale keys |
| `npm run station:flag [-- --dry-run]` | Heuristic `is_station_event` sweep (one-way; dry-run prints the would-flag list) |
| `npm run picks:add -- --slug … --curator … --blurb …` | Add a staff pick (defaults to the current Chicago week) |

---

# How it works

Design spec: `docs/superpowers/specs/2026-07-07-mke-events-mvp-design.md` · per-slice implementation plans: `docs/superpowers/plans/`

## Ingestion pipeline

Adapter fetch → `raw_events` (replayable payloads) → Zod-validated normalize → idempotent canonical upsert (`events`, `event_instances`, `venues`, `event_source_links`) → server-rendered `/events`.

## Public site

**Routes:** `/` (search-first homepage: hero, staff picks, Tonight, This Weekend, Radio Milwaukee events, neighborhood tiles, newsletter) · `/events` (browse + facet chips) · `/events/tonight|today|this-weekend` · `/free-events` · `/live-music` · `/events/[slug]` (detail + add-to-calendar: Google deep link and `/events/[slug]/ics` download) · `/venues/[slug]` · `/categories/[slug]` · `/neighborhoods/[slug]` · `/picks` · `/digest` (noindex; copy-paste source for the newsletter ESP).

**Mini-player:** persistent 4-station bar (88Nine, HYFIN, Rhythm Lab, 414 Music) in the root layout — survives navigation; switch-implies-play. Now-playing metadata comes from the RM playlist app's public Convex query via `/api/now-playing?station=<slug>` (15s cache, 20-min staleness guard, falls back to "Listen live"; renders fallback when `RM_PLAYLIST_CONVEX_URL` is unset). Note: the StreamGuys mounts 502 `HEAD` requests — health-check with ranged `GET`.

**Newsletter workflow:** the capture form writes `newsletter_subscribers` (idempotent on email); `/digest` auto-assembles this week's picks + weekend highlights for the team to paste into the existing ESP. No ESP automation in MVP.

**Neighborhoods:** curated mapping, not PostGIS — registry in `src/lib/neighborhoods.ts` (9 hoods incl. East Side), venue map in `src/maintenance/venue-neighborhood-map.ts` (~55 venues ≈ 70% of upcoming instances). New venues start unmapped; re-run `venues:assign-neighborhoods` after curation passes.

**Station events:** `is_station_event` is set by the heuristic sweep (venue/address at Radio Milwaukee, or title matching 88Nine/HYFIN/414 Live — bare "backyard" deliberately excluded; WMSE also runs one). One-way; flagged events get the badge, homepage module, and float first within browse day-groups.

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

The event that survives a merge is picked by a confidence ladder — `api` > `ical`/`rss` (tied) > `html` > `firecrawl` — ties go to the older event. Merging repoints `event_source_links` and `event_instances` onto the canonical event (instance collisions on `(event_id, start_at)` collapse), backfills only null canonical fields from the duplicate, deletes the duplicate, and records a receipt in `event_clusters` (score breakdown, decided-by). Pending reviews are resolved through `applyReview` (approve re-runs the merge; reject just closes the row) via the `/admin/review` queue.

**Same-show auto-merge.** A review-band pair (0.55–0.80) skips the queue and auto-merges when venue affinity is ≥ 0.9 *and* the start times are within 15 minutes — same venue, same start time is the same show, and title variants (support-act suffixes like "w/ Jay Som") are exactly why these pairs land mid-band instead of clearing 0.80 on title alone. This applies only to the review band; the ≥ 0.80 ladder path is unchanged. Survivor selection for these merges prefers the venue's own listing over the confidence ladder — currently `pabst-theater-group` — since a venue is ground truth for its own stage; if neither or both sides are venue-owned, the standard ladder decides. `dedupSweep` also drains the *existing* pending queue for any row that now meets the rule (`npm run dedup:resolve-same-show` runs this standalone); a drained row's `event_reviews` entry cascades away with its deleted duplicate event.

## Admin: auth & picks manager

`/admin` is a Clerk-gated segment (proxy middleware matches `/admin(.*)`, `/__clerk(.*)`) — the public site is unaffected. Without Clerk keys configured, `.env` absent falls back to Clerk's keyless dev mode; every `/admin` route stays unusable until keys are added. Six env vars, all under the "Phase 5: admin auth" block in `.env.example`.

Staff access is a two-tier email allowlist, app-side (not a Clerk org/role feature): `admin` (all tools) and `picks` (staff-picks manager only); an email on both lists resolves to `admin`. Both lists are comma-separated, case-insensitive, and accept two entry kinds: exact emails and `@domain` rules (e.g. `@radiomilwaukee.org` grants the tier to every Clerk-verified address at exactly that domain — subdomains and lookalike suffixes don't match). An empty `PICKS_ALLOWLIST_EMAILS` collapses this to single-tier — only `ADMIN_ALLOWLIST_EMAILS` grants access. Unauthenticated visitors are redirected to `/admin/sign-in`; authenticated but non-allowlisted (or under-tiered) visitors land on `/admin/denied`.

**Picks manager** (`/admin/picks`, `+ /new`, `+ /[id]/edit`) is the day-to-day way to create and reorder weekly staff picks — it replaces routine use of `npm run picks:add`, which stays available for scripting/backfill. Changes revalidate the homepage, `/picks`, and `/digest` immediately.

**Merge-cascade caveat:** picks reference an `event` row directly. If a dedup merge deletes the pick's event as the merged-away duplicate, the pick row is deleted with it — re-add the pick against the surviving event after a merge, don't assume it silently follows the merge.

## Admin: review queue

`/admin/review` is `admin`-tier only — `picks`-tier staff don't see it in the nav and are redirected if they hit the URL directly. It lists every pending pair from `event_reviews` (the 0.55–0.80 band, minus anything the same-show auto-merge already drained) side by side: title, venue, category, upcoming instance starts, and source badges per side, with the venue-owned/confidence-ladder pick pre-selected as the suggested survivor. "Field conflicts" show up as that side-by-side diff rather than a separate merge-conflict UI — title, venue, times, and sources are all visible for both candidates before you decide.

**Approve** merges the pair onto whichever survivor you pick in the form (defaults to the suggestion, but either side is selectable): the other event's source links, instances, and staff picks re-point onto the survivor, null canonical fields backfill from the loser, the loser event is deleted, and a receipt (score breakdown, decided-by) is written to `event_clusters`. This is irreversible — there is no un-merge.

**Reject** just closes the `event_reviews` row as `rejected`; the pair is never re-offered by a future dedup sweep. Nothing about the two events themselves changes.

The venue-owned survivor preference is a short allowlist, currently `VENUE_OWNED_SOURCE_KEYS = ['pabst-theater-group']` in `src/dedup/confidence.ts`. Adding a venue is a one-line edit to that array; if neither or both sides of a pair are venue-owned, the standard confidence ladder decides instead. Since the edit ships in `src/dedup/*`, it rides the same `npm run trigger:deploy` step as any other dedup change — the daily 8:00 sweep otherwise keeps running the previously-deployed bundle.

**Newsletter hardening.** `subscribeAction` throttles to 5 attempts per hour per hashed IP (`subscription_attempts`, SHA-256 of `x-forwarded-for`, pruned after 24h in bounded batches of `PRUNE_BATCH = 500` per request) and rejects silently-successful bot submissions via a honeypot field (`hp_field` — invisible to real users, named to avoid autofill heuristics; a filled value returns the normal success message but writes nothing). `NEWSLETTER_THROTTLE_DISABLED=1` bypasses the throttle entirely and is for local/e2e use only — never set it in a deployed environment. Turnstile/CAPTCHA was considered and deferred; the throttle + honeypot pair is the pre-launch bar.

**Stuck-approved reviews.** A completed merge cascade-deletes its `event_reviews` row, so any row still sitting in `approved` is a claim whose merge crashed between the claim and the cascade-delete — not a slow one. `stuckApprovedReviews` (`src/queries/admin-reviews.ts`) surfaces `approved` rows whose `resolvedAt` is more than 15 minutes old (`STUCK_AFTER_MINUTES`), so an in-flight merge isn't flagged prematurely. When any exist, `/admin/review` shows a banner above the pending list with a **return to queue** action per row — a compare-and-swap update (`approved` → `pending`, only if still `approved`) that loses cleanly with "Review is no longer stuck." if two admins race the same stuck row. Returning a review re-lists the original pair for a fresh decision; it does not touch the events themselves.

## Admin: source health & event editor

**`/admin/sources`** is a read-only per-source health dashboard, `admin`-tier. Each card shows `healthStatus` — `ok`, `failing`, or `unknown` (never ingested; not an error state) — sorted failing-first, then unknown, then ok, then by source key. `lastFetchAt` is the last *successful* ingest; `lastAttemptAt` is the last attempt regardless of outcome, so a failing source shows both "last success" and "last attempt" side by side. A `failing` card also shows the consecutive-failure count and, once a source has crossed the backoff floor, the backoff window it's waiting out: `FAILURES_BEFORE_BACKOFF = 3` (`src/ingestion/backoff.ts`), then `24h · 2^(failures-3)` capped at 7 days (168h) — the same schedule the ingestion scheduler itself honors, computed here purely for display from `consecutiveFailures` and `lastAttemptAt`. Each card links to the source's last Trigger.dev run (`triggerRunUrl`, `src/queries/admin-sources.ts`); the link only renders once `TRIGGER_PROJECT_REF` is set — without it the card shows "Last run: —" instead of a dead link.

**`/admin/events`** lists canonical events with a title search (case-insensitive, normalized-title match) and a **low confidence** filter: an event is low-confidence if its canonical source link's adapter type is `html` or `firecrawl` (the bottom of the confidence ladder — scraped, not API-sourced) **or** its `category` is still `null` (never enriched). Either condition alone is enough — an API-sourced event with no category yet still counts. Selecting an event opens the editor.

**The editor** (`/admin/events/[id]/edit`) has three independent forms: event fields (title, status, category, venue — `updateEventAction`), per-instance start/end time (`updateInstanceTimeAction`, one form per date on multi-date events), and per-field unlock (`unlockFieldAction`). The page itself gates on `requireStaff('admin')`; each of the three server actions re-checks independently via `currentStaffRole()` and rejects unless the role is `admin`, before touching the database.

**Field locks.** The lock vocabulary is `title`, `status`, `venue`, `time` (`LOCKED_FIELD_VALUES`, `src/ingestion/persist.ts` — the same module that enforces locks on ingest, so the admin action layer imports the list rather than duplicating it). Saving a changed title, status, or venue through the event form automatically adds that field to the event's `lockedFields`; saving a changed instance time automatically locks `time` on the parent event. Once a field is locked, re-ingestion of that event from its source leaves the locked column(s) untouched — for `time` specifically, `persistNormalizedEvent` skips instance upsert/supersede entirely rather than partially touching a locked event's dates. Unlocking a field (from the Locks section of the editor) removes it from `lockedFields`; the very next ingest run then lets the source's value flow through again, silently overwriting the manual edit. **`category` needs no lock.** Ingestion never writes `category` at all — it isn't one of the columns `persist.ts` sets — so there's nothing for a lock to protect it from. The only automated writer of `category` is the enrichment sweep (`src/enrichment/sweep.ts`), which only selects rows where **both** `category` and `vibeTags` are `null`; editing `category` to any value removes the row from that candidate set immediately, and manually clearing both `category` and `vibeTags` back to `null` is how an admin deliberately returns an event to tag-sweep candidacy — no lock bookkeeping needed either way.

**Provenance.** Every field change made through the editor writes one row to `event_edits` (`event_id` FK, `edited_by` the verified staff email, `field`, `old_value`, `new_value`, `created_at`) — shown as an edit-history list on the event's editor page, newest first. `event_edits` cascades on event delete like `event_reviews` — if the edited event is later merge-deleted as a duplicate, its edit history goes with it; the `event_clusters` receipt (which points at the merge survivor) is the durable record of that merge, not `event_edits`. Because the Neon HTTP driver has no transactions, the two mutation paths order their writes deliberately for different failure modes: `updateEventWithDb` and `unlockFieldWithDb` write the audit row *before* the field update, so a crash between them produces a duplicate history row on retry rather than a silently-lost lock; `updateInstanceTimeWithDb` moves the instance, then locks `time`, then writes the audit row — locking before auditing shrinks the window where a crash would leave a genuinely-moved, unlocked time for the next ingest to silently revert, at the cost of possibly losing one (cosmetic) history row instead.

**Staff allowlist lint:** the parser (`src/lib/staff-auth.ts`) validates entry shape (`@domain` rules must look like a domain, bare emails must contain `@` with a non-empty local part) and drops anything malformed with a `console.warn` — fail closed, so a typo'd entry matches no one instead of silently matching everyone or crashing.

## Scheduling (Trigger.dev)

Four declarative schedules, all `America/Chicago`:

| Schedule | Cron | Scope |
|---|---|---|
| `ingest-daily` | 6:00 daily | Sources with daily cadence |
| `ingest-weekly` | 5:00 Mon | All sources (superset — also covers weekly-cadence sources) |
| `dedup-daily` | 8:00 daily | Equivalent to `npm run dedup` |
| `retention-weekly` | 4:00 Mon | Equivalent to `npm run retention` |

Each source ingest runs through a single `ingest` queue (`concurrencyLimit: 1`) keyed per source (`concurrencyKey: source.key`), so repeat runs of the same source serialize while different sources still run in parallel. A source is skipped after 3 consecutive failures for `24h · 2^(n-3)` hours, capped at 7 days — Trigger's own run-level retries handle transient failures separately. Cadence comes from `sources.config.cadence` (`daily` | `weekly`, default `daily`). Every run (success or failure) records its Trigger.dev run id on the source row, which is what the admin dashboard's "Open last run" links use.

For local dev: `npm run trigger:dev` (CLI login). Deploys (`npm run trigger:deploy`) read `DATABASE_URL` and adapter API keys from the Trigger.dev dashboard's environment variables, not from `.env`.

## Retention

`npm run retention` (also `retention-weekly`) deletes, in order:
1. `event_instances` more than 90 days past `start_at`
2. `events` left with zero remaining instances
3. `raw_events` payloads superseded by a newer row for the same `(source, sourceEventId)`, once that superseded row is 30+ days old — the newest payload per source event is kept forever

`/events` already filters to upcoming instances at query time, independent of retention.

## Sources (wave 1, 13 live)

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

- **shepherd-express** (City Spark platform) — deferred to the source backlog: its RSS is a nonstandard article feed, not structured event data. Revisit as an html-class source once City Spark's markup is captured and inspected.

## License

[MIT](LICENSE) © 2026 Radio Milwaukee.
