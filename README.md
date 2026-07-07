# MKE Events (working title)

Milwaukee event discovery platform with deep Radio Milwaukee integration.

- Spec: `docs/superpowers/specs/2026-07-07-mke-events-mvp-design.md`
- Plans: `docs/superpowers/plans/`

## Setup

1. `npm install`
2. Create a Neon Postgres project; put the pooled connection string in `.env` as `DATABASE_URL`.
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
