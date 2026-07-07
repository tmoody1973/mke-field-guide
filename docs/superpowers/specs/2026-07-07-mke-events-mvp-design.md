# MKE Events — Discovery MVP Design

**Date:** 2026-07-07
**Status:** Approved by Tarik (brainstorming session)
**Naming:** "MKE Events" is a working title. Final brand name is a pre-launch decision owned by Tarik; it does not block implementation.

## 1. Product frame

A standalone Milwaukee event discovery site with deep Radio Milwaukee integration. The site aggregates Milwaukee's fragmented event landscape (tourism calendars, venues, festivals, BIDs, civic and community sources) into one fast, searchable, trustworthy place — and converts visitors into Radio Milwaukee listeners through four mechanics:

1. **Staff picks with editorial voice** — DJs/hosts curate weekly picks with personality.
2. **Persistent live-stream player** — 88Nine/HYFIN streaming one click away while browsing.
3. **Newsletter capture** — "This Weekend in MKE" signups feeding the station's audience funnel.
4. **Station events prominence** — Radio Milwaukee's own events get featured placement.

**Brand model:** standalone city brand ("MKE Events", working title) with visible "powered by Radio Milwaukee" attribution and station integration woven throughout — not hosted under radiomilwaukee.org.

**Source documents:** `docs/milwaukee-events-prd-v2.md` (platform PRD) and `docs/milwaukee_event_sources.json` (122-source registry). This spec selects and sequences from those; where this spec and the PRD differ (e.g., hosting platform), this spec wins for the MVP.

### In scope (Discovery MVP — PRD Phase 1)

- Ingestion from ~14 wave-1 sources (below) into a canonical event graph with dedup.
- Public search/browse with facet filtering and hybrid keyword + semantic search.
- Event, venue, neighborhood, and category pages; time-based SEO landing pages.
- Staff picks editorial layer; station event prominence; stream mini-player; newsletter capture.
- Admin review UI (source health, duplicate/conflict review, event editor, picks manager).
- Event JSON-LD structured data, split sitemaps, canonical URLs.

### Out of scope (later phases, per PRD)

- Embeddable partner widgets.
- Organizer accounts, event submission/claim flows, external sync (Eventbrite/Meetup connectors).
- Hospitality-specific source class and fields.
- Full ESP automation for the newsletter (MVP produces a digest page + capture form).
- Multi-city expansion; ticketing.

## 2. Architecture

| Layer | Choice | Notes |
|---|---|---|
| Web app | Next.js App Router on Vercel | SSR for SEO-critical pages, ISR for landing pages, RSC for search. |
| Database | Neon Postgres | Single system of record. Extensions: **PostGIS** (neighborhood polygons, near-me), **pgvector** (semantic embeddings), **pg_trgm** (typo tolerance). |
| ORM | Drizzle | Schema + migrations. |
| Jobs | Trigger.dev | All ingestion: per-source scheduled tasks, staggered recheck frequency, retries with backoff, run observability. Replaces the PRD's Cloudflare Queues. |
| UI system | **RetroUI (retroui.dev) + RetroUI Pro components** | Neobrutalist Tailwind/React components (shadcn-style). Distinctive brand look; Pro components available for richer patterns. |
| Auth (admin only) | Clerk | Station-staff email allowlist. No public accounts in MVP. |
| AI (selective) | Ingest-time only | Embedding generation for published events; enrichment tagging (category, vibe, audience, free/paid) via structured-output calls. **Extraction stays deterministic.** No LLM in the search hot path. |
| Hard-page fallback | Firecrawl | Only when an HTML parser breaks or a page is JS-heavy. |

**Pipeline flow:** Trigger.dev schedule → source adapter fetch → `raw_events` (payload retained) → normalize (Zod-validated) → dedup/cluster → confidence score → auto-publish or hold for review → embed + enrich → live.

## 3. Data model

Canonical entities from the PRD: `sources`, `source_pages`, `raw_events`, `venues`, `organizers`, `events`, `event_instances`, `event_source_links`, `event_clusters`, `event_reviews`. Key fields per PRD §Data model.

MVP additions:

- `events.embedding` (pgvector, HNSW index) — built from title + description + tags.
- Enrichment fields on `events`: `vibe_tags text[]`, `audience_tags text[]`, `is_free boolean`, `price_min`, `price_max`.
- `events.is_station_event boolean` — Radio Milwaukee prominence flag.
- `neighborhoods` — slug, name, PostGIS polygon boundary. Venues auto-assign neighborhood via point-in-polygon.
- `staff_picks` — event_id, curator (name, photo, show URL), blurb, week_of, sort_order.

Organizer/sync tables from PRD §Expanded schema are explicitly **not** created in the MVP.

## 4. Ingestion

### Wave-1 sources (~14, by confidence ladder)

| Tier | Sources | Adapter |
|---|---|---|
| API (highest confidence) | Ticketmaster Discovery (Fiserv Forum, Marcus Center, The Rave, American Family Field, Improv, Live Nation venues), Eventbrite | `api` |
| Confirmed feeds | Urban Milwaukee (iCal), MKE Shows (export), WMSE (RSS), Linneman's (iCal), Shepherd Express (RSS), Brewers (iCal) | `ical` / `rss` |
| HTML parsers | Visit Milwaukee, Milwaukee World Festival calendar, Pabst Theater Group, Milwaukee County Parks, Radio Milwaukee community calendar, Milwaukee Downtown BID | `html` (+ `firecrawl` fallback) |

Each source is a registry row: adapter type, schedule, selectors/config, health status, last fetch, content hash. One adapter interface, implementations: `api`, `ical`, `rss`, `html`, `firecrawl` (fallback only).

### Dedup

Blocking key: same date bucket + venue. Candidate scoring: title trigram similarity, start-time proximity, canonical URL match. High-confidence clusters auto-merge — the higher-confidence source (API > JSON-LD > feed > HTML > Firecrawl) wins field conflicts, provenance preserved per field. Ambiguous matches go to the admin review queue.

### Freshness

- Events ≤14 days out: recheck daily (listing pages before detail pages).
- Events further out: recheck weekly.
- Failing sources: exponential backoff + health flag + admin surfacing; never retry-loop.
- Passed events expire from listings automatically; cancellations/postponements are status updates, not new events.

## 5. Search & filtering

- **Facet filters, all URL-addressable** (shareable + crawlable): date presets (tonight, today, this weekend, this week, custom), category, neighborhood, venue, free/price, vibe tags, audience (family-friendly, all-ages, 21+), time of day. Facets are indexed columns; filtering is instant.
- **Hybrid search, one input box:** weighted Postgres FTS (title > venue/organizer > description) with pg_trgm typo tolerance, run alongside pgvector cosine similarity, merged with reciprocal rank fusion. Handles both `"pabst theater comedy"` and `"something chill outdoors with the kids sunday afternoon"`.
- **Light query understanding:** date/time phrases parsed heuristically into filters before retrieval. No LLM in the hot path.
- **Indexes:** HNSW (embedding), GIN (tsvector, trigram), b-tree/GiST on facet and geo columns.
- **Target:** search responses < 300 ms.

## 6. Public experience

Routes: `/events` (search + filters), `/events/tonight`, `/events/today`, `/events/this-weekend`, `/free-events`, `/live-music`, `/neighborhoods/[slug]`, `/venues/[slug]`, `/categories/[slug]`, `/events/[slug]`, `/picks`.

Homepage: search box first, then modules — Staff Picks this week, Tonight, This Weekend, Radio Milwaukee events, neighborhood tiles.

SEO: Event JSON-LD on every event page; recurring series use schedule markup; sitemaps split by events/venues/neighborhoods; canonical tags on filter states; internal linking between event ↔ venue ↔ neighborhood ↔ category pages.

### Radio Milwaukee integration

- **Persistent mini-player:** sticky bottom bar, 88Nine/HYFIN stream toggle, survives navigation.
- **Staff picks:** curator photo + blurb, linking to their show on radiomilwaukee.org.
- **Newsletter:** capture form ("This Weekend in MKE"); site auto-assembles a weekly digest page (picks + weekend highlights) the team pastes into their existing ESP.
- **Station events:** badge, homepage module, boosted placement in relevant lists.

## 7. Admin

`/admin` behind Clerk (email allowlist): source health dashboard, review queue (ambiguous duplicates, field conflicts, low-confidence events), event editor, staff-picks manager. Job-run detail links to the Trigger.dev dashboard — no rebuilt observability.

## 8. Error handling

- Zod validation at every boundary: adapter output, normalization, API inputs.
- Events failing validation are held, never published.
- Adapter failures set source health + backoff and surface in admin.
- Enrichment/embedding failures never block publishing — they queue for retry.
- Low-confidence extraction never overwrites higher-confidence fields without review.

## 9. Testing

- Per-source parser unit tests against recorded fixture payloads (raw payload retention doubles as fixture source).
- Dedup-scoring unit tests (merge, hold, conflict cases).
- Pipeline integration tests on Neon branch databases.
- Playwright E2E for critical flows: search, filter, event detail, tonight/weekend pages, newsletter signup.

## 10. Success metrics

**Audience:** organic sessions to event/landing pages; search usage and zero-result rate; newsletter signups; stream-player starts; station-event clickthroughs.
**Data quality:** duplicate rate among published events; freshness SLA hit rate for near-term events; % events with valid venue + geo; % low-confidence events routed to review before publication.

## 11. Decisions log

| Decision | Choice |
|---|---|
| Brand model | Standalone brand, deep Radio Milwaukee integration |
| Launch scope | Discovery MVP (PRD Phase 1; widgets/organizer accounts later) |
| Conversion mechanics | All four: staff picks, stream player, newsletter, station events |
| Stack | Vercel + Neon (PostGIS/pgvector/pg_trgm) + Trigger.dev + Drizzle |
| Ingestion/search approach | Deterministic adapters, one database, hybrid FTS + vector search |
| UI system | RetroUI + RetroUI Pro, Tailwind, neobrutalist aesthetic |
| Naming | "MKE Events" placeholder; final name chosen by Tarik pre-launch |
