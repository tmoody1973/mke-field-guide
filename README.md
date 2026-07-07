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

## Sources (wave 1, feed/API)

| Key | Type | Notes |
|---|---|---|
| urban-milwaukee | iCal | Broad community calendar |
| linnemans | iCal | Riverwest music venue |
| wmse | iCal | Station event calendar |
| mke-shows | iCal | Local/indie music aggregator |
| ticketmaster-milwaukee | API | Needs TICKETMASTER_API_KEY |
| eventbrite-cooperage | API | Needs EVENTBRITE_PRIVATE_TOKEN |

Brewers (MLB schedule) was evaluated but excluded from wave 1 — no verifiable static iCal export URL was found (mlb.com/brewers/schedule serves a JS-rendered "Add to Calendar" widget with a CSV download, not a stable `.ics` endpoint). Needs follow-up in a later plan.

HTML/JSON-LD sources (Visit Milwaukee, festivals, Pabst Theater Group, County Parks, Radio Milwaukee, Downtown BID) land in Plan 2b; dedup + scheduling in Plan 2c.
