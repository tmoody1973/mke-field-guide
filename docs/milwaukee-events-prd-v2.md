# Milwaukee Events Platform PRD

## Overview

This product is a Milwaukee-focused event discovery and distribution platform that aggregates events from tourism calendars, civic calendars, neighborhood organizations, venue pages, festival operators, and marketplaces into a canonical event graph. The product will power a consumer-facing web app, SEO landing pages, venue and neighborhood pages, embeddable widgets, and partner-facing submission and review tools.[cite:24][cite:19][cite:20][cite:55][cite:57]

The core strategic idea is to build a local event search engine and syndication layer rather than a simple calendar. That means the platform must normalize fragmented event data, deduplicate overlapping listings, maintain freshness, and publish reusable outputs for both users and local partners.[cite:22][cite:18][cite:39]

The recommended technical direction is a Next.js application deployed on Cloudflare, with queue-based ingestion, Postgres/PostGIS for normalized storage and geospatial queries, a search index for fast faceting, Firecrawl for difficult web extraction, and an AI agent layer used selectively for repair, enrichment, review, and editorial support rather than as the primary crawler runtime.[cite:36][cite:39][cite:30][cite:32]

## Problem

Milwaukee event information is fragmented across many destination sites, municipal calendars, business districts, venue pages, ticketing platforms, and community organizations. Users must search across multiple sites to answer basic questions such as what is happening tonight, what is happening this weekend in a specific neighborhood, or which venues have relevant programming.[cite:24][cite:50][cite:52][cite:20][cite:55][cite:57]

Publishers, neighborhood organizations, media outlets, and property or place-based websites also lack a clean, reusable event data layer. While some sites expose public event calendars or event submission flows, that does not create a shared structured dataset that can be embedded, searched, or reused across Milwaukee’s local web ecosystem.[cite:19][cite:48][cite:24]

This fragmentation reduces discoverability, weakens search visibility, and creates duplicated effort for organizers and local publishers. The absence of a canonical event graph also makes it difficult to support neighborhood-specific guides, venue pages, recurring-series pages, or partner widgets with consistently accurate time, location, and category data.[cite:22][cite:67][cite:18]

## Vision

The product will become Milwaukee’s canonical event layer: the best place to discover what is happening and the easiest structured source for partners to display or reuse Milwaukee event data. The platform will combine broad local coverage with clean entity resolution across events, venues, organizers, dates, and neighborhoods.[cite:24][cite:55][cite:20]

The public experience will help people find events by time, place, and intent. The distribution layer will let venues, real-estate sites, local media, neighborhood associations, and community organizations embed widgets such as “This weekend in Bay View,” “Events near this address,” or “Upcoming events at this venue.”[cite:24][cite:52][cite:55]

The long-term moat is not scraping volume alone. The moat comes from freshness, canonical normalization, duplicate resolution, local geography, partner distribution, and the ability to publish high-quality SEO pages and structured data that are more useful than source-native calendars.[cite:22][cite:39][cite:67]

## Goals

### Product goals

- Build the best Milwaukee event discovery web experience for tonight, this weekend, neighborhoods, venues, and categories.
- Build a reusable event data platform that powers widgets and syndication.
- Establish durable local SEO authority for Milwaukee event queries.
- Create an admin and review workflow that keeps event quality high without requiring full manual curation.[cite:24][cite:22][cite:39]

### Business goals

- Grow organic traffic through event, neighborhood, venue, and category landing pages.[cite:22][cite:24]
- Create widget distribution partnerships with local media, venues, BIDs, real-estate sites, and neighborhood organizations.[cite:52][cite:55]
- Build a data and workflow foundation for future organizer tools, sponsored placements, premium widgets, and local guides.[cite:19][cite:48]

### User goals

- Find relevant events quickly by date, neighborhood, and category.
- Trust that dates, times, venues, and status are current.
- Browse recurring local patterns such as festivals, markets, live music, and civic events in one place.
- Share or embed useful local event streams without maintaining a custom calendar stack.[cite:24][cite:50][cite:20][cite:55]

## Non-goals

- Building a ticketing platform in the MVP.
- Replacing source-of-truth event management systems used by venues or aggregators.
- Using AI agents as the primary method for all extraction, scheduling, or search ranking.
- Launching in multiple cities before Milwaukee data quality and distribution workflows are proven.[cite:22][cite:39][cite:30]

## Users

### Primary audiences

1. Local residents looking for events by time, neighborhood, and interest.
2. Visitors looking for broad “what’s happening in Milwaukee” discovery.
3. Neighborhood and district organizations that want curated local event streams.
4. Local media, blogs, and community organizations that want embeddable event widgets.
5. Venues and organizers that want more visibility and eventually submission or claim tools.[cite:24][cite:19][cite:52][cite:55]

### Core use cases

- A resident wants to find live music tonight in Bay View.
- A family wants free weekend events in Milwaukee.
- A property or neighborhood page wants nearby events automatically embedded.
- A local editor wants to publish a “best of this weekend” guide backed by structured data.
- An admin needs to resolve duplicate listings from multiple sources for the same event.[cite:24][cite:55][cite:57][cite:52]

## Product scope

### MVP scope

The MVP includes:

- Source ingestion from a curated first wave of Milwaukee sources.
- Canonical event, venue, organizer, and occurrence data model.
- Public web app with search and browse by date, neighborhood, venue, and category.
- Event detail pages and venue pages.
- Time-based SEO pages such as “this weekend” and “tonight.”
- Embeddable widgets with filtered views.
- Admin review UI for duplicate and conflict resolution.
- Structured data output using event markup on canonical pages.[cite:24][cite:20][cite:55][cite:22][cite:67]

### Post-MVP scope

- Partner submission and claim flows.
- Editorial AI copilot for weekend picks and summaries.
- Personalized recommendations.
- More neighborhoods, municipalities, and partner-specific feeds.
- Monetization layers such as premium placement, sponsored modules, and white-label widgets.[cite:19][cite:48][cite:39]

## Source strategy

The product should not begin by scraping every Milwaukee site indiscriminately. It should start with a tiered registry of high-value sources and a source-specific ingestion strategy for each domain.[cite:39][cite:30]

### Initial source set

| Source | Type | Why it matters | Suggested method |
|---|---|---|---|
| Visit Milwaukee Events | Destination aggregator | Broad local event inventory and strong SEO relevance.[cite:24] | Listing parser + detail parser; canonical-source candidate. |
| Visit Milwaukee event submission pages | Submission signal | Indicates an ecosystem where publisher-side feeds or partnerships may emerge.[cite:19][cite:48] | Monitor workflows and eventual partner strategy. |
| Milwaukee World Festival calendar | Festival/operator | Strong coverage of major seasonal festivals and operator-led events.[cite:50] | Deterministic parser; Firecrawl fallback. |
| Milwaukee Downtown signature events | BID/district | Important downtown recurring and branded programming.[cite:52] | HTML parser with recurring-series support. |
| South Milwaukee CivicEngage calendar | Municipal | Template pattern useful for municipal ingestion at scale.[cite:20] | Deterministic parser. |
| Discover North Shore events calendar | Neighborhood/community | Useful for geography-based coverage outside the urban core.[cite:55] | HTML parser. |
| Eventbrite Milwaukee | Marketplace | Broad commercial event inventory and discovery value.[cite:57] | Official API/feed first; scraping only if necessary. |
| Milwaukee Magazine calendar | Editorial/community | Secondary discovery source and event coverage signal.[cite:58] | HTML parser. |

### Source prioritization principles

- Prefer APIs, feeds, and stable structured sources first.
- Parse JSON-LD or schema.org data before invoking LLM extraction.
- Use Firecrawl selectively for hard pages, inconsistent HTML, or discovery tasks.
- Maintain source-specific adapters rather than a single generic scraper.[cite:22][cite:67][cite:30][cite:32][cite:74]

## Functional requirements

### Ingestion and extraction

- Maintain a source registry with per-source crawl strategy, fetch frequency, selectors, adapter type, and health status.[cite:39]
- Support adapters for API, feed, deterministic HTML parsing, and Firecrawl-based extraction.[cite:30][cite:32]
- Store raw extracted payloads for replay and parser debugging.[cite:74][cite:77]
- Support source page tracking with URL, content hash, last fetch time, and fetch status.[cite:39]
- Detect updates using ETag, Last-Modified, content hashing, or listing-page diffs when available.[cite:39][cite:42]

### Normalization and canonicalization

- Normalize into canonical entities for event, event instance, venue, organizer, source, and source page.[cite:67][cite:68]
- Support one-off events, recurring events, and event series using series and schedule fields aligned with schema.org concepts.[cite:18][cite:68]
- Map extracted fields to canonical event properties including title, description, start date, end date, event status, venue, organizer, and image.[cite:22][cite:67]
- Preserve field provenance and confidence per source contribution.[cite:74][cite:77]

### Deduplication and quality

- Cluster likely duplicate events using title similarity, date/time proximity, venue match, organizer match, and canonical URL similarity.
- Auto-merge very high-confidence duplicates.
- Route ambiguous matches to review.
- Surface conflicts such as mismatched dates, venues, or status changes.[cite:22][cite:67]

### Public experience

- Provide search and browse by date, category, venue, neighborhood, and free/paid status.
- Provide curated landing pages such as tonight, this weekend, free events, live music, and neighborhood pages.
- Provide canonical event detail pages and venue pages.
- Render pages server-side for crawlability and performance.[cite:24][cite:22]

### Widgets and syndication

- Support embeddable widgets filtered by neighborhood, venue, category, and date window.
- Provide HTML-first or server-rendered widget output for good performance and broad compatibility.
- Support partner-specific branding or sizing options in later phases.
- Track widget-driven traffic attribution.[cite:52][cite:55][cite:24]

### Admin and editorial tools

- Admin dashboard for source health, crawl jobs, duplicate review, and low-confidence events.
- Event review workflows for date conflicts, venue conflicts, and category conflicts.
- Editorial tools for creating weekend picks and neighborhood guides using canonical event data.
- Agent-assisted source onboarding and parser repair workflows.[cite:39][cite:30][cite:74]

## Non-functional requirements

### Performance

- Public pages should be server-rendered or statically cached where appropriate to support strong crawlability and fast LCP.
- Search responses should feel near-instant for common local queries.
- Widget embeds should load quickly and degrade gracefully without heavy client JavaScript.[cite:22][cite:39]

### Freshness

- Upcoming events within the next 7 to 14 days should be rechecked more frequently than distant events.
- High-volatility sources should have more frequent crawl schedules than static institutional pages.
- Failed sources should back off and route to review rather than continually burning credits or queue capacity.[cite:39][cite:42]

### Reliability

- Every fetch and transform step should be observable with job-level logs and error states.
- Raw payload retention should make parser regressions debuggable.
- Low-confidence AI extraction should never overwrite high-confidence deterministic fields without review.[cite:74][cite:77]

### SEO

- Every canonical event page must emit Event structured data.
- Recurring series should use event schedules or series concepts where appropriate.
- Canonical tags, sitemaps, and internal linking must support event, venue, neighborhood, and category page discovery.[cite:22][cite:67][cite:18]

## Information architecture

### Public routes

- `/events`
- `/events/today`
- `/events/tonight`
- `/events/this-weekend`
- `/neighborhoods/[slug]/events`
- `/venues/[slug]`
- `/categories/[slug]`
- `/events/[slug]`
- `/free-events`
- `/live-music`

These routes should prioritize crawlable HTML, clean URLs, and durable internal linking between event, venue, neighborhood, and category nodes.[cite:22][cite:24]

### Admin routes

- `/admin/sources`
- `/admin/jobs`
- `/admin/reviews`
- `/admin/events/[id]`
- `/admin/duplicates`
- `/admin/widgets`

## Data model

The core model should separate raw extraction from canonical entities so the system can improve parsers without losing original evidence. This also makes agent-assisted review safer and more explainable.[cite:74][cite:77]

### Core entities

- `sources`
- `source_pages`
- `raw_events`
- `venues`
- `organizers`
- `events`
- `event_instances`
- `event_source_links`
- `event_clusters`
- `event_reviews`[cite:67][cite:68]

### Canonical event principles

- `events` represent the public-facing event concept.
- `event_instances` represent occurrences with time-specific data.
- `event_source_links` preserve source-level provenance.
- `raw_events` store extracted payloads from APIs, HTML, JSON-LD, or Firecrawl.[cite:18][cite:67][cite:74]

### Key fields

| Entity | Key fields |
|---|---|
| Event | title, normalized_title, summary, description, status, category, image_url, canonical_url, venue_id, organizer_id, quality_score, confidence_score |
| Event instance | start_at, end_at, timezone, instance_status, recurrence_rule, schedule_json |
| Venue | name, normalized_name, address, lat, lng, neighborhood, place_confidence |
| Source link | source_id, source_event_id, source_url, is_canonical, field_provenance, source_confidence |
| Raw event | source_url, extraction_method, extracted_payload, content_hash, extracted_at |

The model should align closely with schema.org event concepts and Google event rich result expectations around start dates, locations, status, and series behavior.[cite:22][cite:67][cite:18]

## System architecture

The recommended architecture is:

- Next.js App Router for public pages and admin views.
- Cloudflare Workers or Cloudflare-hosted app services for edge delivery and API endpoints.
- Cloudflare Queues and scheduled triggers for crawl and refresh jobs.
- Postgres with PostGIS for canonical storage and spatial queries.
- Search engine such as Typesense or Meilisearch for faceted retrieval.
- Firecrawl for difficult extraction or site crawling where deterministic parsing fails.
- AI agent layer for source onboarding, review, enrichment, and editorial assistance.[cite:36][cite:39][cite:30][cite:32]

### High-level flow

1. Scheduler enqueues source crawl jobs.[cite:36][cite:39]
2. Source adapters fetch listing or detail pages using API, feed, deterministic HTML, or Firecrawl paths.[cite:30][cite:32]
3. Raw extracted records are stored with schema version and source metadata.[cite:74]
4. Normalizers map raw records into canonical event, venue, and organizer entities.
5. Duplicate matcher clusters overlapping source records.
6. Confidence scorer determines auto-publish, hold, or review behavior.
7. Publisher updates the search index, public pages, and widget outputs.
8. Agent workflows handle low-confidence cases, source repair, and editorial tasks.[cite:39][cite:74][cite:77]

## Firecrawl strategy

Firecrawl should be used as a tool, not the core runtime. It is valuable for hard-source extraction, discovery of site content, and schema-based extraction when deterministic parsing is unavailable or too brittle.[cite:30][cite:31][cite:32][cite:74]

### Use Firecrawl for

- JavaScript-heavy event pages.
- Inconsistent listing or detail page structures.
- Discovery across a domain when listing URLs are not obvious.
- Schema-based extraction for hard pages using a declared event payload contract.[cite:30][cite:32][cite:74][cite:77]

### Avoid Firecrawl for

- Sources with stable APIs or feeds.
- Pages already exposing clean Event JSON-LD.
- High-frequency bulk refresh where deterministic methods are cheaper and faster.[cite:22][cite:67][cite:30]

## Agent strategy

AI agents should support the pipeline where judgment or adaptation matters, but the core ingestion and publishing loop should remain deterministic and observable. This prevents unnecessary cost, latency, and opaque failures.[cite:39][cite:74]

### Use agents for

- Source onboarding and adapter drafting.
- Parser repair suggestions after source changes.
- Duplicate review explanations.
- Category, neighborhood, and audience enrichment.
- Editorial guide generation such as “best events this weekend.”[cite:30][cite:74][cite:77]

### Do not use agents for

- Routine crawl scheduling.
- First-pass extraction when structured data already exists.
- Real-time public search ranking.
- Canonical page rendering.[cite:22][cite:39]

## Freshness strategy

Freshness is a product requirement, not an operational afterthought. Cloudflare Queues supports asynchronous processing with batching, retries, and delays, making it suitable for scheduled crawls, staggered rechecks, and failure backoff.[cite:36][cite:39][cite:42]

### Freshness rules

- Recheck listing pages before detail pages to minimize unnecessary fetches.
- Recheck near-term events more aggressively than distant ones.
- Store `last_seen_at`, fetch status, and content hash to detect changes.
- Expire passed events automatically after a retention window.
- Mark cancellations, postponements, and reschedules as status updates, not new events.[cite:22][cite:67][cite:39]

### Confidence ladder

- API/feed: highest confidence.
- JSON-LD or schema.org: high confidence.
- Deterministic HTML parser: medium confidence.
- Firecrawl or LLM extraction: medium to low confidence until corroborated or reviewed.[cite:22][cite:67][cite:74][cite:77]

## SEO strategy

The product’s SEO strategy should be built on canonical event pages, neighborhood pages, venue pages, category pages, and time-based pages, each with clean URLs, internal linking, and structured data. Google’s event guidance emphasizes accurate event properties such as start date and location, while schema.org also distinguishes event schedules and event series behavior.[cite:22][cite:67][cite:18][cite:68]

### SEO requirements

- Event JSON-LD on every canonical event page.[cite:22][cite:67]
- Event schedule or series modeling for recurring programming.[cite:18][cite:68]
- XML sitemaps split by events, venues, and neighborhoods.
- Canonical tags to suppress duplicate URLs.
- Unique titles and descriptions based on canonical fields.
- Strong internal linking between event, venue, neighborhood, and category pages.[cite:22]

### Priority landing pages

- This weekend in Milwaukee.
- Tonight in Milwaukee.
- Free events in Milwaukee.
- Live music in Milwaukee.
- Neighborhood pages such as Bay View events and Downtown Milwaukee events.
- Venue pages for major event venues and recurring hosts.[cite:24][cite:52][cite:55]

## Widget strategy

Widgets are a distribution and moat feature, not just a nice-to-have. They allow the platform to become the event layer behind neighborhood pages, venue sites, local publisher pages, and real-estate experiences.[cite:52][cite:55]

### Initial widget types

- Upcoming events near this address.
- This weekend in this neighborhood.
- Events at this venue.
- Free family events.
- Live music tonight.[cite:24][cite:55]

### Widget requirements

- JavaScript embed snippet with data attributes for filters.
- Server-rendered or HTML-first output where feasible.
- Shadow DOM or style isolation for host compatibility.
- Attribution and analytics tagging for partner measurement.

## Success metrics

### User metrics

- Organic sessions to event, neighborhood, and venue pages.
- Search-to-click rate within the app.
- Return visits for time-based pages such as tonight and this weekend.
- Engagement with neighborhood and category filters.

### Data quality metrics

- Percentage of near-term events updated within freshness targets.
- Duplicate rate among published events.
- Percentage of published events with valid venue and geo data.
- Percentage of published events with structured data completeness.
- Percentage of low-confidence events routed to review before publication.[cite:22][cite:39]

### Partner metrics

- Number of active widget installs.
- Widget-driven sessions and clicks.
- Number of claimed or submitted events in future phases.

## Risks and mitigations

| Risk | Description | Mitigation |
|---|---|---|
| Source instability | Source markup changes may break parsers. | Source-specific adapters, raw payload retention, review queue, and agent-assisted repair.[cite:74][cite:77] |
| Duplication noise | Same event appears across many Milwaukee sources. | Canonical event graph, confidence scoring, and review thresholds.[cite:22][cite:67] |
| Freshness decay | Event times or status change close to the event date. | Near-term recheck windows and queue-based update jobs.[cite:39][cite:42] |
| SEO dilution | Too many thin or duplicate faceted pages. | Curated landing pages, canonical tags, and strong internal linking.[cite:22] |
| Cost creep | Overusing browser or LLM extraction can become expensive. | Prefer APIs, feeds, JSON-LD, and deterministic parsers before Firecrawl.[cite:30][cite:32] |
| Trust erosion | Wrong dates or venues damage product credibility. | Confidence ladder, provenance, admin review, and source prioritization.[cite:22][cite:67][cite:74] |

## Rollout plan

### Phase 1: Core data and public MVP

- Stand up source registry and ingestion jobs.
- Integrate first wave of Milwaukee sources.
- Launch canonical events, event instances, venues, and search.
- Publish event pages, venue pages, and time-based pages.
- Add structured data and sitemaps.[cite:24][cite:20][cite:55][cite:22]

### Phase 2: Quality and distribution

- Launch duplicate review and source health dashboard.
- Add widgets for neighborhood, venue, and time-based feeds.
- Improve venue matching and neighborhood enrichment.
- Add editorial tooling for weekly guides.[cite:52][cite:55][cite:39]

### Phase 3: Partner and organizer tooling

- Add event submission intake.
- Add claim and correction flows.
- Explore partner feeds, premium widgets, and sponsorships.[cite:19][cite:48]

## Open questions

- Which Milwaukee neighborhoods should be first-class navigation and SEO entities at launch?
- Which venue families or category pages produce the strongest early search demand?
- Should the MVP include manual editor curation for homepage modules?
- Which partners should receive the first widget pilots: local media, BIDs, or real-estate/property pages?
- What is the acceptable confidence threshold for auto-publishing community-calendar events?

## Recommended next deliverables

- Drizzle schema and migrations based on the canonical model.
- TypeScript domain models and validation schemas.
- Source-by-source crawl matrix with exact adapter plans.
- Next.js route map for public pages, widgets, and admin views.
- Queue job design and freshness SLAs.
- UI wireframes for search, event detail, venue pages, widgets, and review dashboard.

## Organizer accounts and publishing network

The product can evolve from a discovery and syndication platform into a lightweight event operating system for Milwaukee hosts. In this model, organizers create an event once inside the platform, publish it to the local discovery network immediately, and optionally sync it to supported third-party event systems through official APIs where allowed.[cite:87][cite:81][cite:83]

This approach is stronger than treating external platforms as the source of truth. The internal product becomes the canonical event record, while external platforms such as Eventbrite become distribution endpoints with destination-specific adapters, validation rules, and sync logs.[cite:87][cite:90][cite:80]

### Organizer product goals

- Let event hosts create and manage events directly in the platform.
- Publish host-created events into the Milwaukee discovery app, SEO pages, and widgets.
- Sync host-created events to supported third-party platforms using official integrations.
- Store external IDs and sync state so updates can flow outward reliably.
- Give hosts a clear audit trail for successful and failed destination syncs.[cite:87][cite:137][cite:95][cite:102]

### Organizer MVP features

- User accounts and authentication.
- Organization profiles for hosts, venues, and producer teams.
- Membership and role-based access for organization admins, editors, and viewers.
- Event creation form with draft, review, scheduled, published, cancelled, and archived states.
- Venue management and organizer profile management.
- External account connection management using OAuth where supported.
- Destination-level publish and sync controls.
- Sync history, retry actions, and validation errors.[cite:80][cite:137][cite:102]

### User roles

| Role | Permissions |
|---|---|
| Platform admin | Manage all sources, users, organizations, sync policies, featured content, and review queues. |
| Organization owner | Manage organization settings, billing, members, venues, and all events for the organization. |
| Organization editor | Create and edit events, submit for review, and run outbound syncs. |
| Reviewer | Resolve event conflicts, approve flagged edits, and manage data quality queues. |
| Viewer | Read-only access to organization analytics and sync logs. |

### Organizer workflow

1. A host creates an account and organization.
2. The organization adds members, venues, and branding.
3. The organization connects an external destination such as Eventbrite through OAuth when supported.[cite:80][cite:137]
4. A user creates an event in the platform using the canonical event form.
5. The event is published locally to the Milwaukee discovery network.
6. The user chooses supported external destinations and runs a publish or sync action.
7. Destination adapters validate required fields and transform the canonical event into platform-specific payloads.
8. External IDs are stored and subsequent edits trigger update sync jobs rather than new creates.
9. The user can review sync history and retry failed jobs with corrected data.[cite:87][cite:80][cite:102]

### Key product rule

Local publication and external sync must be separate actions. An organizer should be able to publish an event to the Milwaukee network even if a third-party destination rejects a field or fails authentication. Eventbrite’s developer platform clearly supports OAuth, create-event flows, and event management actions, making it the strongest first sync target.[cite:80][cite:137][cite:87]

## Integration strategy

Not all external platforms are equally suitable as sync targets. The integration layer should classify destinations by creation support, access model, reliability, and strategic value.[cite:80][cite:95][cite:110]

### Destination comparison

| Destination | Capability | Access pattern | Recommended use |
|---|---|---|---|
| Eventbrite | Strong create/update/publish support for event workflows.[cite:87][cite:80] | OAuth 2.0.[cite:80][cite:137] | Primary outbound sync target for ticketed and organizer-managed events. |
| Meetup | GraphQL API with OAuth 2; access appears tied to Meetup Pro contexts.[cite:95][cite:102][cite:103] | OAuth 2 over GraphQL.[cite:102] | Conditional secondary destination for approved or higher-tier use cases. |
| Facebook / Meta events | Event access exists, but Event access on Users and Pages is restricted to Facebook Marketing Partners.[cite:110] | Restricted Meta ecosystem.[cite:110][cite:134] | Do not treat as default MVP sync target. |
| ICS / calendar export | Broad compatibility, no partner approval required. | File/feed export. | Useful universal outbound format. |
| Platform widgets and local pages | Fully controlled first-party distribution. | Internal. | Default publish destination for all host-created events. |

### Integration principles

- Build first-party publishing before third-party sync.
- Use official APIs only for outward sync in the MVP.
- Separate connection management from content publishing.
- Map canonical fields into destination-specific payloads rather than tailoring the internal model to any one provider.
- Store destination constraints and validation rules per connector.[cite:80][cite:137][cite:102][cite:110]

### Eventbrite connector requirements

- OAuth connection flow using Eventbrite’s authentication model.[cite:80][cite:137]
- Ability to create draft events, update events, and publish events where supported.[cite:87][cite:132]
- Support for ticket classes and destination-required fields if the organizer wants Eventbrite commerce features.[cite:87][cite:131]
- Storage of external Eventbrite event ID for future updates.
- Webhook or polling support for destination-side changes if needed.[cite:81][cite:90]

### Meetup connector requirements

- OAuth 2 connection flow to Meetup’s GraphQL API.[cite:102]
- Support gated by real access review because current docs indicate post-2025 GraphQL and platform constraints.[cite:95][cite:103]
- Restrict rollout to approved organizations or premium plans until technical and policy viability is confirmed.

### Facebook connector requirements

- Treat as roadmap or partner-specific integration only.
- Do not build MVP assumptions around broad public event creation or retrieval.
- Reassess only if Meta partner access and a compliant use case are confirmed.[cite:110][cite:134]

## Expanded schema for organizer accounts and sync jobs

The organizer layer adds identity, organizations, connections, destinations, and sync telemetry on top of the canonical event graph. This keeps the public discovery product and the organizer workflows in one system while preserving a clean source-of-truth model.[cite:87][cite:80]

### Additional core entities

- `users`
- `organizations`
- `organization_members`
- `organization_venues`
- `external_connections`
- `event_destinations`
- `sync_jobs`
- `sync_attempts`
- `sync_payload_snapshots`
- `event_change_log`

### Recommended schema

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  full_name text,
  avatar_url text,
  auth_provider text not null default 'password',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  website_url text,
  logo_url text,
  default_timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','reviewer','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table organization_venues (
  organization_id uuid not null references organizations(id) on delete cascade,
  venue_id uuid not null references venues(id) on delete cascade,
  primary key (organization_id, venue_id)
);

alter table events add column organization_id uuid references organizations(id);
alter table events add column author_user_id uuid references users(id);
alter table events add column workflow_state text not null default 'draft'
  check (workflow_state in ('draft','in_review','scheduled','published','cancelled','archived'));
alter table events add column source_type text not null default 'platform'
  check (source_type in ('platform','ingested','partner_feed'));

create table external_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null check (provider in ('eventbrite','meetup','facebook','ics','other')),
  provider_account_id text,
  provider_account_name text,
  oauth_access_token text,
  oauth_refresh_token text,
  token_expires_at timestamptz,
  scopes jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','expired','revoked','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table event_destinations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  connection_id uuid not null references external_connections(id) on delete cascade,
  provider text not null,
  external_event_id text,
  sync_status text not null default 'not_synced'
    check (sync_status in ('not_synced','queued','syncing','synced','warning','failed','disabled')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, connection_id)
);

create table sync_jobs (
  id uuid primary key default gen_random_uuid(),
  event_destination_id uuid not null references event_destinations(id) on delete cascade,
  job_type text not null check (job_type in ('create','update','publish','unpublish','cancel','delete','refresh')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  requested_by_user_id uuid references users(id),
  scheduled_for timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table sync_attempts (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid not null references sync_jobs(id) on delete cascade,
  attempt_number integer not null,
  request_payload jsonb,
  response_payload jsonb,
  response_status integer,
  error_message text,
  created_at timestamptz not null default now()
);

create table sync_payload_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_destination_id uuid not null references event_destinations(id) on delete cascade,
  payload_version integer not null,
  provider_payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (event_destination_id, payload_version)
);

create table event_change_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid references users(id),
  change_type text not null,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);
```

### TypeScript domain model

```ts
export type OrgRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer';
export type WorkflowState = 'draft' | 'in_review' | 'scheduled' | 'published' | 'cancelled' | 'archived';
export type Provider = 'eventbrite' | 'meetup' | 'facebook' | 'ics' | 'other';
export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error';
export type DestinationSyncStatus = 'not_synced' | 'queued' | 'syncing' | 'synced' | 'warning' | 'failed' | 'disabled';
export type SyncJobType = 'create' | 'update' | 'publish' | 'unpublish' | 'cancel' | 'delete' | 'refresh';
export type SyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface User {
  id: string;
  email: string;
  fullName?: string | null;
  avatarUrl?: string | null;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  defaultTimezone: string;
}

export interface OrganizationMember {
  organizationId: string;
  userId: string;
  role: OrgRole;
}

export interface ExternalConnection {
  id: string;
  organizationId: string;
  provider: Provider;
  providerAccountId?: string | null;
  providerAccountName?: string | null;
  status: ConnectionStatus;
  scopes: string[];
  tokenExpiresAt?: string | null;
}

export interface EventDestination {
  id: string;
  eventId: string;
  connectionId: string;
  provider: Provider;
  externalEventId?: string | null;
  syncStatus: DestinationSyncStatus;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

export interface SyncJob {
  id: string;
  eventDestinationId: string;
  jobType: SyncJobType;
  status: SyncJobStatus;
  requestedByUserId?: string | null;
  scheduledFor?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}
```

## Organizer roadmap

### Phase A

- Launch user accounts, organizations, and organization-owned event publishing.
- Publish host-created events into first-party pages, widgets, and feeds.
- Add moderation and review rules for host-created content.

### Phase B

- Launch Eventbrite connector using OAuth and create/update/publish workflows.[cite:80][cite:137][cite:87]
- Add destination sync logs, retry queue, and field-level validation.
- Add ICS export and shareable calendar subscriptions.

### Phase C

- Evaluate Meetup connector for approved organizations.[cite:95][cite:102][cite:103]
- Add organizer analytics and destination performance metrics.
- Add billing plans for advanced sync and premium widget features.

### Phase D

- Add partner-grade syndication features and white-label distribution.
- Reassess Meta or other constrained destinations only with confirmed platform access.[cite:110][cite:134]

## Hospitality and restaurant events strategy

Restaurant and hospitality events are important to Milwaukee discovery, but they require a different source strategy than concerts, festivals, or civic calendars. Platforms such as OpenTable, Resy, and Tock are primarily reservation and hospitality systems, and their APIs are generally oriented toward approved partners, restaurant operators, reservation data, or booking flows rather than functioning as open public event feeds.[cite:153][cite:156][cite:148][cite:151]

This means the platform should not treat restaurant-platform APIs as the primary system of record for food and dining events. Instead, the product should use restaurant-owned event pages, direct hospitality experience pages, ticketed event platforms, and local editorial/community discovery sources as primary inputs, while using reservation platforms as enrichment or optional partner integrations.[cite:169][cite:172][cite:58][cite:55]

### Hospitality product goals

- Include chef dinners, wine tastings, special brunches, tasting menus, pop-ups, patio events, guest-chef nights, and other restaurant experiences in Milwaukee event discovery.
- Support category and SEO pages such as restaurant events this weekend, chef dinners, food events, and wine tastings.
- Add booking or reservation links where available.
- Create a future path for restaurant partners to sync or enrich their events using approved hospitality integrations.[cite:169][cite:172][cite:153]

### Recommended source priority for restaurant events

1. Restaurant-owned event and experience pages.
2. Ticketed event platforms such as Eventbrite when restaurants use them for dining experiences.[cite:169][cite:172][cite:87]
3. Local editorial and community calendars that list dining events.[cite:58][cite:55]
4. Reservation-platform metadata and booking links from OpenTable, Resy, or Tock where access is available.[cite:176][cite:148][cite:151]
5. Partner-grade restaurant system integrations for specific accounts or premium plans.[cite:156][cite:179]

### Platform comparison

| Platform | Access model | What it is best for | Limits for this product |
|---|---|---|---|
| OpenTable | Approved partner API network; sandbox access for approved API partners.[cite:153][cite:175] | Restaurant directory data, reservation links, booking flows, partner integrations.[cite:176][cite:183] | Not an open self-serve citywide event feed. |
| Resy | Partner-oriented integrations, no broadly self-serve public developer portal.[cite:148] | Reservation enrichment, restaurant discovery context, partner integrations, possible booking links.[cite:145][cite:179] | Restricted access; unsuitable as a default public ingestion layer. |
| Tock | API and webhook access available to eligible plans, requested by account owners.[cite:151] | Reservation updates, guest profile updates, operational data for participating restaurants.[cite:151] | Reservation creation/cancellation and general event manipulation are not available via API.[cite:151] |
| Toast | Restaurant system APIs exist, generally tied to partner or approved integration contexts.[cite:160][cite:162] | Restaurant operations, menus, orders, and ecosystem integration. | More POS and operations oriented than public event discovery. |
| SevenRooms | API access appears contract or partner oriented.[cite:165][cite:173] | Guest, CRM, and reservation-related workflows. | Better for operator integrations than public event discovery. |
| Eventbrite | Open developer platform with OAuth and event creation/read flows.[cite:80][cite:87] | Ticketed dinners, food pop-ups, chef collaborations, public dining experiences.[cite:169][cite:172] | Covers only experiences using Eventbrite. |

### Hospitality ingestion strategy

The hospitality ingestion layer should use a dedicated source class because restaurant events often appear on pages labeled as experiences, special menus, private dining, ticketed dinners, wine events, or chef collaborations rather than on standard calendar pages. Parsers should therefore look for both calendar-style event pages and dining-experience detail pages.[cite:169][cite:172][cite:179]

The data model should support additional hospitality fields, including reservation link, booking platform, dining format, prix-fixe indicator, beverage pairing indicator, and limited seating signals. These fields are valuable for both discovery and future partner workflows even when they are not present on every event source.[cite:176][cite:151][cite:183]

### Suggested hospitality fields

| Field | Purpose |
|---|---|
| `reservation_url` | Link to reservation or booking destination. |
| `booking_platform` | OpenTable, Resy, Tock, Eventbrite, direct, or other. |
| `experience_type` | Chef dinner, tasting menu, pop-up, brunch event, wine tasting, class, pairing dinner. |
| `prix_fixe_flag` | Indicates fixed-menu dining experience. |
| `limited_seating_flag` | Indicates scarcity or reservation urgency. |
| `menu_summary` | Short description of the menu or experience. |
| `ticket_required_flag` | Distinguishes reservations from ticketed dining events. |

### Hospitality pages and widgets

Priority hospitality pages should include:

- Restaurant events this weekend in Milwaukee.
- Chef dinners in Milwaukee.
- Wine tastings in Milwaukee.
- Pop-up dinners and food experiences.
- Dining events in Bay View, Third Ward, Downtown, and other strong neighborhood clusters.

Possible widgets include:

- Dining events near this address.
- This weekend’s food events.
- Tasting menus and chef dinners.
- Restaurant experiences at this venue or district.

### Organizer and partner opportunity

A strong long-term opportunity is to let participating restaurants create experiences directly in the platform and optionally attach booking links or partner reservation destinations. OpenTable’s partner model explicitly supports directory access and reservation links for approved integrations, while Tock provides eligible-plan APIs and webhooks, and Resy maintains partner-style integrations rather than an open public developer portal.[cite:176][cite:151][cite:148]

That means the hospitality roadmap should emphasize:

- first-party restaurant-event publishing,
- booking-link enrichment,
- Eventbrite support for ticketed dining experiences,
- approved hospitality integrations later for restaurants that connect accounts or join premium partner programs.[cite:87][cite:176][cite:151][cite:148]
EOF && cp output/milwaukee-events-prd.md output/milwaukee-events-prd-v2.md
