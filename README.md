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

`npm run test` runs the full suite (448 tests) against in-memory PGlite — no database or keys required.

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
| `npm run dedup:judge` | Annotate pending review pairs with an advisory AI verdict, confidence, and rationale (no-op without `AI_GATEWAY_API_KEY`) |
| `npm run judge:eval` | Run the advisory judge against the 38-pair golden set; reports accuracy + the promotion-gate false-`same` count (key-gated) |
| `npm run retention` | Delete expired instances/empty events, prune superseded raw payloads |
| `npm run trigger:dev` | Run the Trigger.dev dev server locally (schedules + tasks) |
| `npm run trigger:deploy` | Deploy Trigger.dev tasks and schedules to the cloud project |
| `npm run enrich` | Embedding + tagging sweep (fingerprint-gated; no-op without `AI_GATEWAY_API_KEY`) |
| `npm run titles:suggest` | Advisory title-cleanup pass over scraper-sourced events, propose-only (key-gated no-op) |
| `npm run search:eval` | Run the 10-query search eval: hit@3, p50/p95 latency, zero-result probes |
| `npm run e2e` | Playwright E2E (search, filter, detail+ics, presets, newsletter, admin gates) against a local server |
| `npm run venues:backfill-slugs` | One-time slug backfill for venue pages (new venues get slugs at insert) |
| `npm run venues:assign-neighborhoods` | Apply the curated venue→neighborhood map; reports unmapped venues + stale keys |
| `npm run venues:merge -- --keep <slug-or-id> --absorb <slug-or-id>` | Merge a duplicate venue row into its canonical (repoint events, backfill nulls, alias, delete) |
| `npm run venues:propose` | Advisory venue-merge pass over in-band trigram candidates, propose-only (key-gated no-op) |
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

**Same-show auto-merge.** A review-band pair (0.55–0.80) skips the queue and auto-merges when venue affinity is ≥ 0.9 *and* the start times are within 15 minutes — same venue, same start time is the same show, and title variants (support-act suffixes like "w/ Jay Som") are exactly why these pairs land mid-band instead of clearing 0.80 on title alone. This applies only to the review band; the ≥ 0.80 ladder path is unchanged. Survivor selection for these merges prefers the venue's own listing over the confidence ladder — currently `pabst-theater-group`, `cactus-club`, `x-ray-arcade`, `marcus-center`, `jazz-gallery`, and `eventbrite-cooperage` — since a venue is ground truth for its own stage; if neither or both sides are venue-owned, the standard ladder decides. `dedupSweep` also drains the *existing* pending queue for any row that now meets the rule (`npm run dedup:resolve-same-show` runs this standalone); a drained row's `event_reviews` entry cascades away with its deleted duplicate event.

### AI dedup judge (advisory)

Every review-band pair that's still `pending` after the same-show drain gets adjudicated by a haiku-class LLM judge, so a human's decision in `/admin/review` becomes a five-second read of a verdict and rationale instead of a cold side-by-side comparison. Two triggers run the identical annotation pass: the tail of `dedupSweep` (`src/dedup/sweep.ts`) after each daily dedup run, and the standalone `npm run dedup:judge` (`src/dedup/run-judge.ts`) for a manual or ad-hoc pass. Both call `judgePendingReviews` (`src/dedup/judge-sweep.ts`), which fetches pending pairs with `judged_at IS NULL` (default batch of 50) and, for each, sends one structured `generateText` call on `anthropic/claude-haiku-4-5` via the AI Gateway — the same pattern the enrichment tagging sweep already uses in production (`src/enrichment/tag.ts`). The prompt carries only the pair's facts (titles, venue names, same-venue-id flag, start-time delta, source keys, URL-match flag, deterministic score) — no descriptions — and the model returns `sameEvent`, a `confidence` 0–1, and a one-sentence `rationale` capped at 240 characters.

**Three verdicts.** `verdictFrom` (`src/dedup/judge.ts`) maps the model's raw output down to `same`, `different`, or `unsure`: below `UNSURE_BELOW` (0.7) confidence the verdict is always `unsure` regardless of `sameEvent`, otherwise it's `same` or `different` as the model called it. `unsure` exists as an honest escape hatch — the prompt explicitly instructs the model to keep confidence low whenever a known DIFFERENT-event trap (tribute act vs. original, same-venue double-header, watch party vs. the game, festival day vs. one set) could plausibly apply, so a pair the model can't confidently rule on surfaces as "unsure" rather than a guessed same/different.

**ANNOTATE-ONLY.** The judge never merges, never rejects, and never touches `event_reviews.status` — a human still resolves every pair through the existing approve/reject flow in `/admin/review`. `recordJudgment` writes only the four `judge_*` columns (`judgeVerdict`, `judgeConfidence`, `judgeRationale`, `judgedAt`), and the `UPDATE` is itself guarded on `status = 'pending' AND judged_at IS NULL` so a pair a human already resolved — or that cascaded away via a same-show merge — mid-sweep can never be overwritten; the sweep reports an honest `judged`/`skipped` split rather than assuming every fetched row landed. `judgePair` never throws (any model, network, or validation failure returns `null`, leaving `judgedAt` untouched for retry next sweep), and every gateway call carries a 15-second abort so a hung request is a skip, not a stalled cron. `dedupSweep` additionally wraps the whole judge call in its own `try/catch` — a gateway outage annotates zero pairs but never fails the cron tick or discards that run's merge/queue counts.

**No key, no cost.** Like the enrichment sweep, `judgePendingReviews` gates on `hasGatewayKey()` (`AI_GATEWAY_API_KEY` present) and returns `{ judged: 0, skipped: 0 }` immediately if it's unset — no-key is a no-op, not an error. Where it does run, the cost is the same order of magnitude as the enrichment tagging sweep already in production: one short haiku call per pending pair, facts only (no descriptions in the prompt), rationale capped at 240 characters.

**Eval + promotion gate.** `npm run judge:eval` (`src/dedup/judge-eval.ts`) runs the judge offline against the in-repo golden set (`eval/judge-pairs.json`: 24 real duplicate pairs from production history + 14 curated hard negatives, 38 total) and prints per-pair verdicts plus a summary: accuracy, unsure rate, and — the number that matters — **false-`same` count at confidence ≥ 0.9** (`falseSameAtBar`, `AUTO_MERGE_CONFIDENCE_BAR`), which must be 0. This is the written promotion criteria (Decision 5): auto-merge on the judge's word would require verdict `same` at confidence ≥ 0.9, and granting that is gated on (a) `judge:eval` showing zero false-`same` at that bar on the golden set, **and** (b) at least two weeks of live annotations agreeing with every human approve/reject in `/admin/review`. Both conditions are a future explicit ruling — nothing auto-merges today; the judge is advisory only.

## AI proposal agents (advisory)

Two more haiku-class agents propose fixes for long-tail data mess that the deterministic pipeline can't clean up on its own — scraper-junk titles and near-duplicate venue rows. Both follow the same PROPOSE-ONLY contract as the dedup judge above, taken one step further: the judge only annotates a human decision, these two **write nothing but a suggestion**. Applying one routes through the exact mutation path a human editing by hand would use — full lock, provenance, and merge machinery included — so there is no new way for AI output to reach `events` or `venues` directly.

### Title cleanup

`suggestTitle` (`src/enrichment/title-suggest.ts`) sends one structured `generateText` call on `anthropic/claude-haiku-4-5` per candidate event, 15-second abort, and never throws — any model, network, or validation failure returns `null`. The prompt carries the raw title plus venue/date/sources (already shown separately on the site, so the model is told to strip them), and asks for a `cleanTitle`, a `changed` flag, a `confidence`, and a short `rationale`; instructions cover stripping embedded venue/date/price junk, fixing shouty ALL-CAPS to natural casing while preserving intentional artist stylization, and keeping the full bill (support acts, `w/`/`+`/`•` separators) intact.

The sweep (`suggestTitles`, `src/enrichment/title-suggest-sweep.ts`) only considers events whose *canonical* source link is scraper-sourced (`html` or `firecrawl` adapter — the bottom of the confidence ladder, same rank `/admin/events`'s low-confidence filter uses) and that have never been gated, oldest-first. Two triggers run it: the tail of `enrichSweep` (`src/enrichment/sweep.ts`) capped at `CRON_TITLE_LIMIT = 20`, wrapped in its own `try/catch` so a gateway outage there costs zero title suggestions but never discards that tick's embed/tag counts; and the standalone `npm run titles:suggest` (`src/enrichment/run-title-suggest.ts`, default limit 50) for a manual pass.

**One-shot gate, durable dismiss.** `title_suggested_at` is stamped on *every* verdict — a genuine suggestion, an already-clean call (`changed: false` or the model just echoed the input), or a race loss — so a given event is proposed at most once, ever. Dismissing a suggestion in the editor only clears `title_suggestion`; it does not clear `title_suggested_at`, so a dismissed event stays out of the candidate pool for good rather than coming back up next sweep.

**Apply/Dismiss** live as a banner on the event editor (`/admin/events/[id]/edit`) whenever `title_suggestion` is set. Apply (`applyTitleSuggestionWithDb`, `src/app/actions/admin-events.ts`) routes the suggested title through the same `updateEventWithDb` a manual title edit uses — writing an `event_edits` provenance row and locking `title` against the next re-ingest — before clearing the suggestion; Dismiss records an `event_edits` row (`field: 'title-suggestion'`) and clears the suggestion without touching the title or its lock.

### Venue merges

Candidate pairs come from `pg_trgm`: `findVenuePairCandidates` (`src/maintenance/venue-proposals.ts`) trigram-scores every venue pair on `normalized_name` and keeps similarity in `[0.45, 0.92]` — below the floor, the names aren't related enough to be worth a model call; at or above the ceiling is the dedup layer's territory (an obvious typo-level match, not a judgment call) — excluding any pair already recorded in `venue_merge_suggestions` in either `keep`/`absorb` ordering.

`proposeVenueMerge` sends one structured haiku call per candidate pair with full context for both sides — name, address, neighborhood, event count, and up to 3 sample event titles — and asks whether they're the same real-world place, a confidence, which name is the cleaner canonical form (`keep`), and a rationale. The prompt spells out both directions of trap: street-address variants (`"Cactus Club"` vs `"Cactus Club - 2496 S Wentworth Ave"`) and `"The X"` vs `"X"` are the *same* place; rooms booked and billed separately within one building (`"Falcon Bowl"` vs `"Falcon Nest"`) and a park vs its own bandshell or stage are *different* places even when they share an address, unless the sample titles show them booked as one venue.

A model **"no" is durable** — `proposeVenueMerges` (the sweep) writes a `dismissed` row rather than skipping, so the same pair is never re-proposed (the candidate query's `NOT EXISTS` check and the table's unique pair index both key off any existing row, regardless of status). The sweep is 15-second-abort and never-throws per pair like every other advisory agent here; a `null` result (timeout, parse failure) is skipped with no row written, so that pair legitimately retries next sweep.

It runs weekly on the new `venue-proposals-weekly` Trigger.dev schedule (`src/trigger/maintenance.ts`, Mon 9:00 `America/Chicago`, `CRON_PROPOSAL_LIMIT = 20` — 20 pairs at up to 15s each is 300s, half the 600s cron task budget), plus the standalone `npm run venues:propose` (`src/maintenance/run-venue-proposals.ts`, default limit 50) for a manual pass.

**Apply/Dismiss** are cards on `/admin/venues` (`VenueProposalCard`) for every `pending` row. Apply (`applyVenueSuggestionWithDb`, `src/app/actions/admin-venue-suggestions.ts`) routes straight through `mergeVenuesWithDb` — the identical repoint/backfill/alias/delete core `npm run venues:merge` and a manual `/admin/venues` merge use — so an applied suggestion is irreversible exactly like any other merge; the `absorb_venue_id` foreign key's `ON DELETE CASCADE` deletes the now-stale suggestion row for free once the absorbed venue is gone. Dismiss just flips `status` to `dismissed`, guarded to only take effect while the row is still `pending`.

### No eval harness, by design

Migration 0018 (`drizzle/0018_unknown_marvel_apes.sql`) is the entire footprint: `title_suggestion` (text) and `title_suggested_at` (timestamptz) on `events`, and the `venue_merge_suggestions` table (`keep_venue_id`/`absorb_venue_id` FKs with cascade delete, `confidence`, `rationale`, `status` enum `pending`/`dismissed`, unique index on the pair). Neither agent has an autonomy path to graduate into — unlike the dedup judge, which has a written promotion gate (`judge:eval` against a golden set, zero false-`same` at confidence ≥ 0.9) for a *future* auto-merge decision, these two propose-only agents have no such ceiling to earn: every suggestion, at any confidence, waits for a human Apply click. That click *is* the quality signal — the running `event_edits` history for titles and the suggestion table's own status column for venues are the ongoing record of how often the model's proposals hold up, with no separate offline eval required to interpret it.

## Venue consolidation

`venue_aliases` (`normalized_name` unique → `venue_id`) is the resolution layer for venue-name variants at ingest: `findOrCreateVenue` (`src/ingestion/persist.ts`) checks the alias table before inserting a new venue row, so a source that spells a venue three different ways still resolves to one canonical venue after the first merge, instead of re-minting a variant row on every re-ingest. A post-insert re-check (`reconcileInsertAgainstAlias`) closes the race where a concurrent merge writes the alias and deletes the variant row between the initial alias lookup and the insert — the zombie insert is compensate-deleted and the caller defers to the alias.

Aliases are populated by a merge, not written directly. `npm run venues:merge -- --keep <slug-or-id> --absorb <slug-or-id>` (`src/maintenance/merge-venues.ts`) and the `/admin/venues` UI (`admin`-tier, same `mergeVenues` core via a server action) both: backfill the survivor's null `address`/`lat`/`lng`/`neighborhood` from the absorbed row (COALESCE — the survivor's own values always win, and `neighborhood` is load-bearing since the curated map may only know the absorbed row's key), repoint every event's `venue_id` from the absorbed venue onto the survivor, record the absorbed row's normalized name as an alias to the survivor, then delete the absorbed venue row. This is irreversible — there is no un-merge, and re-ingesting under the absorbed name resolves straight to the survivor via the alias instead of reviving the old row. The write order (backfill → repoint → alias → delete) is deliberate: a crash after the alias is recorded but before the delete leaves both the alias and the stale row, and a plain re-run of the merge converges cleanly.

The location-parsing adapter (`splitLocationName`, `src/ingestion/adapters/venue-location.ts`) is the other half of keeping variants from being minted in the first place: it splits free-text `"<venue>, <address>"` locations on the first comma, then trims a trailing `" - <address>"` suffix — but only when a digit immediately follows the dash, so `"Cactus Club - 2496 S Wentworth Ave"` yields the venue name alone while `"The Rave - Eagles Club"` (no digit after the dash) is left intact as a single name.

Because `neighborhood` is backfilled onto the survivor's canonical row, the curated venue→neighborhood map (`src/maintenance/venue-neighborhood-map.ts`) keys on canonical venue identity — merging absorbs a variant's map entry along with its address data rather than orphaning it, and `npm run venues:assign-neighborhoods`'s rot report is what catches the map holding a stale key for a since-deleted variant.

## Admin: auth & picks manager

`/admin` is a Clerk-gated segment (proxy middleware matches `/admin(.*)`, `/__clerk(.*)`) — the public site is unaffected. Without Clerk keys configured, `.env` absent falls back to Clerk's keyless dev mode; every `/admin` route stays unusable until keys are added. Six env vars, all under the "Phase 5: admin auth" block in `.env.example`.

Staff access is a two-tier email allowlist, app-side (not a Clerk org/role feature): `admin` (all tools) and `picks` (staff-picks manager only); an email on both lists resolves to `admin`. Both lists are comma-separated, case-insensitive, and accept two entry kinds: exact emails and `@domain` rules (e.g. `@radiomilwaukee.org` grants the tier to every Clerk-verified address at exactly that domain — subdomains and lookalike suffixes don't match). An empty `PICKS_ALLOWLIST_EMAILS` collapses this to single-tier — only `ADMIN_ALLOWLIST_EMAILS` grants access. Unauthenticated visitors are redirected to `/admin/sign-in`; authenticated but non-allowlisted (or under-tiered) visitors land on `/admin/denied`.

**Picks manager** (`/admin/picks`, `+ /new`, `+ /[id]/edit`) is the day-to-day way to create and reorder weekly staff picks — it replaces routine use of `npm run picks:add`, which stays available for scripting/backfill. Changes revalidate the homepage, `/picks`, and `/digest` immediately.

**Merge-cascade caveat:** picks reference an `event` row directly. If a dedup merge deletes the pick's event as the merged-away duplicate, the pick row is deleted with it — re-add the pick against the surviving event after a merge, don't assume it silently follows the merge.

## Admin: review queue

`/admin/review` is `admin`-tier only — `picks`-tier staff don't see it in the nav and are redirected if they hit the URL directly. It lists every pending pair from `event_reviews` (the 0.55–0.80 band, minus anything the same-show auto-merge already drained) side by side: title, venue, category, upcoming instance starts, and source badges per side, with the venue-owned/confidence-ladder pick pre-selected as the suggested survivor. "Field conflicts" show up as that side-by-side diff rather than a separate merge-conflict UI — title, venue, times, and sources are all visible for both candidates before you decide.

**Approve** merges the pair onto whichever survivor you pick in the form (defaults to the suggestion, but either side is selectable): the other event's source links, instances, and staff picks re-point onto the survivor, null canonical fields backfill from the loser, the loser event is deleted, and a receipt (score breakdown, decided-by) is written to `event_clusters`. This is irreversible — there is no un-merge.

**Reject** just closes the `event_reviews` row as `rejected`; the pair is never re-offered by a future dedup sweep. Nothing about the two events themselves changes.

The venue-owned survivor preference is a short allowlist, currently `VENUE_OWNED_SOURCE_KEYS = ['pabst-theater-group', 'cactus-club', 'x-ray-arcade', 'marcus-center', 'jazz-gallery', 'eventbrite-cooperage']` in `src/dedup/confidence.ts`. Adding a venue is a one-line edit to that array; if neither or both sides of a pair are venue-owned, the standard confidence ladder decides instead. Since the edit ships in `src/dedup/*`, it rides the same `npm run trigger:deploy` step as any other dedup change — the daily 8:00 sweep otherwise keeps running the previously-deployed bundle.

**Newsletter hardening.** `subscribeAction` throttles to 5 attempts per hour per hashed IP (`subscription_attempts`, SHA-256 of `x-forwarded-for`, pruned after 24h in bounded batches of `PRUNE_BATCH = 500` per request) and rejects silently-successful bot submissions via a honeypot field (`hp_field` — invisible to real users, named to avoid autofill heuristics; a filled value returns the normal success message but writes nothing). `NEWSLETTER_THROTTLE_DISABLED=1` bypasses the throttle entirely and is for local/e2e use only — never set it in a deployed environment. Turnstile/CAPTCHA was considered and deferred; the throttle + honeypot pair is the pre-launch bar.

**Stuck-approved reviews.** A completed merge cascade-deletes its `event_reviews` row, so any row still sitting in `approved` is a claim whose merge crashed between the claim and the cascade-delete — not a slow one. `stuckApprovedReviews` (`src/queries/admin-reviews.ts`) surfaces `approved` rows whose `resolvedAt` is more than 15 minutes old (`STUCK_AFTER_MINUTES`), so an in-flight merge isn't flagged prematurely. When any exist, `/admin/review` shows a banner above the pending list with a **return to queue** action per row — a compare-and-swap update (`approved` → `pending`, only if still `approved`) that loses cleanly with "Review is no longer stuck." if two admins race the same stuck row. Returning a review re-lists the original pair for a fresh decision; it does not touch the events themselves.

## Admin: source health & event editor

**`/admin/sources`** is a read-only per-source health dashboard, `admin`-tier. Each card shows `healthStatus` — `ok`, `failing`, or `unknown` (never ingested; not an error state) — sorted failing-first, then unknown, then ok, then by source key. `lastFetchAt` is the last *successful* ingest; `lastAttemptAt` is the last attempt regardless of outcome, so a failing source shows both "last success" and "last attempt" side by side. A `failing` card also shows the consecutive-failure count and, once a source has crossed the backoff floor, the backoff window it's waiting out: `FAILURES_BEFORE_BACKOFF = 3` (`src/ingestion/backoff.ts`), then `24h · 2^(failures-3)` capped at 7 days (168h) — the same schedule the ingestion scheduler itself honors, computed here purely for display from `consecutiveFailures` and `lastAttemptAt`. Each card links to the source's last Trigger.dev run (`triggerRunUrl`, `src/queries/admin-sources.ts`); the link only renders once `TRIGGER_PROJECT_REF` is set — without it the card shows "Last run: —" instead of a dead link.

**`/admin/events`** lists canonical events with a title search (case-insensitive, normalized-title match) and a **low confidence** filter: an event is low-confidence if its canonical source link's adapter type is `html` or `firecrawl` (the bottom of the confidence ladder — scraped, not API-sourced) **or** its `category` is still `null` (never enriched). Either condition alone is enough — an API-sourced event with no category yet still counts. Selecting an event opens the editor.

**The editor** (`/admin/events/[id]/edit`) has three independent forms: event fields (title, status, category, venue — `updateEventAction`), per-instance start/end time (`updateInstanceTimeAction`, one form per date on multi-date events), and per-field unlock (`unlockFieldAction`). The page itself gates on `requireStaff('admin')`; each of the three server actions re-checks independently via `currentStaffRole()` and rejects unless the role is `admin`, before touching the database.

**Field locks.** The lock vocabulary is `title`, `status`, `venue`, `time` (`LOCKED_FIELD_VALUES`, `src/ingestion/persist.ts` — the same module that enforces locks on ingest, so the admin action layer imports the list rather than duplicating it). Saving a changed title, status, or venue through the event form automatically adds that field to the event's `lockedFields`; saving a changed instance time automatically locks `time` on the parent event. Once a field is locked, re-ingestion of that event from its source leaves the locked column(s) untouched — for `time` specifically, `persistNormalizedEvent` skips instance upsert/supersede entirely rather than partially touching a locked event's dates. Unlocking a field (from the Locks section of the editor) removes it from `lockedFields`; the very next ingest run then lets the source's value flow through again, silently overwriting the manual edit. **`category` needs no lock.** Ingestion never writes `category` at all — it isn't one of the columns `persist.ts` sets — so there's nothing for a lock to protect it from. The only automated writer of `category` is the enrichment sweep (`src/enrichment/sweep.ts`), which only selects rows where **both** `category` and `vibeTags` are `null`; editing `category` to any value removes the row from that candidate set immediately, and manually clearing both `category` and `vibeTags` back to `null` is how an admin deliberately returns an event to tag-sweep candidacy — no lock bookkeeping needed either way.

Dedup merges (`mergeEvents`, `src/dedup/merge.ts`) also consult the survivor's `lockedFields`, at the same two touch points ingestion does. A `time` lock on the canonical skips `moveInstances` entirely — the duplicate's own instances are deleted along with the duplicate row instead of being reparented onto the survivor, since the survivor's dates are curated and the duplicate's are not. A `venue` lock changes `backfillMissingFields`'s COALESCE to a straight passthrough of the canonical's own `venue_id`, including when that value is a deliberately-cleared `null` — an admin who unset an event's venue on purpose won't have it silently refilled from a merged-in duplicate. `title` and `status` are never backfilled by a merge regardless of lock state — only nulls are filled, and both columns are `NOT NULL`.

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

## Sources (wave 1, 17 live)

Per-run stats (`last_fetched_count` / `last_published_count` / `last_skipped_count`) are recorded on each source after every ingest, including HTML sources' parse-time skips — a matched-but-unextractable card (e.g. a vague "Returning `<month>`" listing) counts as a skip, not silent data loss. Watch `last_skipped_count` for anomalous jumps between runs on any source, not just failures — a parser silently falling out of sync with a site's markup (a Squarespace collection JSON shape change, a WordPress card class rename, a Tribe events REST field change) shows up there before it shows up as missing events.

| Key | Type | Strategy | Notes |
|---|---|---|---|
| urban-milwaukee | iCal | feed | Broad community calendar |
| linnemans | iCal | feed | Riverwest music venue |
| wmse | iCal | feed | Station event calendar |
| mke-shows | iCal | feed | Local/indie music aggregator |
| ticketmaster-milwaukee | API | ticketmaster adapter | Needs `TICKETMASTER_API_KEY` |
| eventbrite-cooperage | API | eventbrite adapter | Needs `EVENTBRITE_PRIVATE_TOKEN`; venue-owned (The Cooperage) |
| radio-milwaukee | HTML | selectors | Brightspot CMS community calendar |
| milwaukee-world-festival | HTML | selectors | Henry Maier Festival Park (multi-day festivals expand to one instance per day) |
| pabst-theater-group | HTML | selectors + `crawlDetails` | Covers Pabst, Riverside, Turner Hall, Miller High Life, Vivarium, The Fitzgerald; detail-page crawl fixes listing-only midnight placeholder times |
| milwaukee-downtown | HTML | selectors | BID #21 signature events; only cards with enumerable dates are published (vague "Returning `<month>`" cards excluded) |
| brewers | API | mlb adapter | MLB Stats API, home games only, no key required |
| visit-milwaukee | HTML | `sitemap-jsonld` | Sitemap → statically-rendered detail pages with JSON-LD (JS listing is unusable); 150 pages/run, 2s crawl-delay per robots.txt, newest-lastmod first, weekly cadence; inline-JS time enricher upgrades date-only events. Some crawl budget lands on past-dated pages — the listing filter hides them and retention purges them |
| county-parks | HTML | `firecrawl-selectors` | CivicPlus calendar behind a Cloudflare challenge — Firecrawl renders it (needs `FIRECRAWL_API_KEY`, ~1 credit/run); page 1 covers ~3 days of a 30-page calendar → daily cadence; recurring programs expand to one instance per day-row |
| x-ray-arcade | HTML | selectors | Squarespace events-collection JSON (`?format=json`, epoch-ms absolute dates, no chicago-time conversion needed); closure notices whose title matches both "closed" and "private" are skipped, not published |
| jazz-gallery | HTML | selectors | Squarespace events-collection JSON (`?format=json`); listing items with an empty/absent location fall back to the configured venue name and address |
| cactus-club | HTML | selectors | WordPress events grid (`.eventEntryInner` cards); text date + text time parsed as Chicago wall-clock via the chicago-time helpers |
| marcus-center | HTML | selectors | The Events Calendar REST JSON (`?per_page=50`); hall-level venues (Uihlein Hall, Peck Pavilion, Todd Wehr Theater, Wilson Theater at Vogel Hall, South Outdoor Grounds) with venueAddress from the feed's city/state when both are present, else "Milwaukee, WI"; multi-day runs expand to one all-day instance per calendar day through the existing day-range machinery — no showtime is invented |

### Deferred sources

- **shepherd-express** (City Spark platform) — deferred to the source backlog: its RSS is a nonstandard article feed, not structured event data. Revisit as an html-class source once City Spark's markup is captured and inspected.

## License

[MIT](LICENSE) © 2026 Radio Milwaukee.
