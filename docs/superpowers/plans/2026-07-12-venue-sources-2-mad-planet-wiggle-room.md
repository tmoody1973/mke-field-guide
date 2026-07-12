# Venue Sources 2: Mad Planet + Wiggle Room — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two more venue-owned sources, both with ZERO current DB coverage: mad-planet.net (Squarespace — config-only on the shipped `squarespaceEventsParser` factory) and wiggleroommke.com (WordPress + The Events Calendar behind a Cloudflare challenge — reached via the existing `firecrawl-selectors` strategy against its tribe REST endpoint, which firecrawl returns wrapped in `<html><body>…</body></html>`).

**Architecture:** Task 1 is a pure factory-instance add (registry line + seed row + fixture test + survivor key). Task 2 factor-izes the tribe parsing the same way Squarespace was: extract `marcus-center.ts`'s generic tribe logic (envelope/event Zod schemas, entity decode, Chicago wall-time, day-range expansion, venue city/state pair rule, loud total-payload failure) into `tribeEventsParser(options)`; `marcus-center` becomes an instance with BYTE-EQUIVALENT behavior (its existing 6 tests pass UNCHANGED — that is the refactor proof); `wiggle-room` is a second instance whose input may arrive firecrawl-wrapped, so the factory's JSON extraction tolerates a wrapper (slice from first `{` to last `}` before `JSON.parse`; still throws loudly if no JSON is found). `VENUE_OWNED_SOURCE_KEYS` grows to 8.

**Tech Stack:** unchanged. No migrations, no env changes. **Dual-deploy TRIPPED by definition** (parser code is Trigger-task-reachable — the 2026-07-12 ship-correction lesson): ship runs `npm run trigger:deploy`.

## Global Constraints

All of `2026-07-12-venue-owned-sources.md`'s Global Constraints apply verbatim (deterministic parsers, per-record skip discipline, loud total-payload failure, fixtures verbatim, frozen dedup/persist/day-range/enrichment files, scoped git add, no production writes during implementation). Additions:

- **Refactor invariant (Task 2):** `tests/ingestion/sources-marcus-center.test.ts` passes with ZERO edits. Any needed test change means the refactor changed behavior — STOP, NEEDS_CONTEXT.
- Recon fixtures captured live 2026-07-12 in the session scratchpad: `madplanet-events.json` (5 upcoming, populated item locations; `website.location` = "Mad Planet", "533 E Center St", "Milwaukee, WI, 53212"), `wiggleroom-tribe.txt` (56KB, tribe REST JSON WRAPPED in `<html><body>` — keep the wrapper in the fixture, it IS the signal).

## Decisions

1. **Mad Planet options:** baseUrl `https://www.mad-planet.net`, fallbacks "Mad Planet" / "533 E Center St, Milwaukee, WI, 53212", no skipTitle. Seed key `mad-planet`, name "Mad Planet (venue site)", listing `https://www.mad-planet.net/events?format=json`, strategy `selectors`.
2. **Wiggle Room via tribe REST through firecrawl:** seed key `wiggle-room`, name "Wiggle Room (venue site)", url `https://wiggleroommke.com/event/`, strategy `firecrawl-selectors`, listingUrls `['https://wiggleroommke.com/wp-json/tribe/events/v1/events?per_page=50']` (plain fetch gets Cloudflare 403; firecrawl returns the JSON body wrapped in html/body tags — verified live).
3. **Tribe factory options** (keep minimal — only what the two instances actually differ on): `{ listingLabel: string }` for error messages, plus nothing else unless extraction forces it. Venue names stay per-event from `event.venue.venue` (Wiggle Room's feed self-describes; Marcus halls unchanged). The wrapper-tolerant JSON extraction lives in the factory unconditionally (raw JSON has `{` first anyway).
4. **Survivor keys:** += `mad-planet`, `wiggle-room`, `centro-cafe` (9 total). One test case each, following the Task-4 idiom.
5. **Centro Café / Bar Centro (added mid-plan, 2026-07-12):** centrocaferiverwest.com is ALSO The Events Calendar, and its REST endpoint answers a PLAIN fetch (no Cloudflare) — a third tribe-factory instance, config-only once the factory exists. Seed key `centro-cafe`, name "Centro Café / Bar Centro (venue site)", url `https://centrocaferiverwest.com/event/`, strategy `selectors` (NOT firecrawl), listingUrls `['https://centrocaferiverwest.com/wp-json/tribe/events/v1/events?per_page=50']`. Feed venue = "bar centro", address `804 E. Center St.` with city present and state ABSENT — exercises the city/state both-present-pair fallback rule in production data (the Todd Wehr case). Scratchpad fixture: `centro-tribe.json` (10 events).

---

### Task 1: Mad Planet (config-only Squarespace instance)

**Files:**
- Modify: `src/ingestion/adapters/html/sources/index.ts` (one instance entry), `src/db/seed.ts` (one row), `src/dedup/confidence.ts` (add `'mad-planet'`)
- Test: `tests/ingestion/sources-squarespace-events.test.ts` (extend: one mad-planet instance test), `tests/dedup/confidence.test.ts` (extend: one case) + fixture `tests/fixtures/html/mad-planet.json`

- [ ] **Step 1: Fixture** — from scratchpad `madplanet-events.json`: envelope with first 3 `upcoming` items VERBATIM (they carry populated `location` fields — the test should assert per-item location is used, i.e. the opposite branch from jazz-gallery's fallback test).
- [ ] **Step 2: Failing tests** — (a) registered `selectorParsers['mad-planet']` parses the fixture: exact first-record assertion (title/start epoch-ms/url composed from baseUrl+fullUrl/venue fields from item location); (b) confidence test case: `mad-planet` record beats an aggregator record.
- [ ] **Step 3: RED → one registry entry + one seed row + one key → GREEN**; `npx vitest run tests/ingestion/sources-squarespace-events.test.ts tests/dedup/` green; typecheck.
- [ ] **Step 4: Commit** — `git add` the five files; message `feat: mad-planet venue source — squarespace factory instance`.

### Task 2: Tribe events factory + Wiggle Room + Centro Café instances

**Files:**
- Create: `src/ingestion/adapters/html/sources/tribe-events.ts` (the factory — marcus-center.ts's generic logic moves here)
- Modify: `src/ingestion/adapters/html/sources/marcus-center.ts` (becomes a thin instance file OR is deleted with its instance defined in index.ts — pick whichever keeps `selectorParsers['marcus-center']` and every existing marcus test import working UNCHANGED), `src/ingestion/adapters/html/sources/index.ts` (register `wiggle-room` + `centro-cafe`), `src/db/seed.ts` (two rows), `src/dedup/confidence.ts` (add `'wiggle-room'`, `'centro-cafe'`)
- Test: `tests/ingestion/sources-tribe-events.test.ts` (create — wiggle-room wrapper + centro cases), `tests/dedup/confidence.test.ts` (extend ×2) + fixtures `tests/fixtures/html/wiggle-room.txt` (the WRAPPED capture, trimmed to ~5 events verbatim INSIDE the wrapper) and `tests/fixtures/html/centro-cafe.json` (raw JSON capture, trimmed to ~4 events verbatim)
- UNCHANGED: `tests/ingestion/sources-marcus-center.test.ts` (the refactor proof)

- [ ] **Step 1: Fixtures** — from scratchpad `wiggleroom-tribe.txt` (keep the `<html><body>` wrapper; trim inner `events` to first 5 verbatim) and `centro-tribe.json` (raw; first 4 events verbatim). Prefer the parser NOT validating `total`/`total_pages`.
- [ ] **Step 2: Failing tests** — (a) wiggle-room instance parses the WRAPPED fixture into records (exact first-record assertion incl. venue from the feed); (b) centro instance parses the RAW fixture — assert venue `bar centro` with address falling back to `Milwaukee, WI` (feed has city but NO state — the both-present-pair rule); (c) non-JSON garbage (no braces) THROWS source-identified; (d) confidence cases ×2.
- [ ] **Step 3: RED → extract factory → marcus instance (existing tests UNTOUCHED and green) → wiggle-room + centro instances + seed rows + keys → GREEN.** `npx vitest run tests/ingestion/ tests/dedup/` ALL green; typecheck.
- [ ] **Step 4: README** — three source rows (mad-planet, wiggle-room, centro-cafe) matching the existing table format; venue-owned sentence → 9 keys.
- [ ] **Step 5: Commit** — message `feat: tribe events parser factory — wiggle-room + centro-cafe venue sources`.

### Ship checklist (finishing pass — controller only)

1. Full gates (test/typecheck/build/e2e). 2. Merge → main, push. 3. `npm run db:seed` (idempotent; verify 20 sources). 4. **`npm run trigger:deploy` MANDATORY** (task-reachable parser code — the standing lesson; verify 7 tasks). 5. NO vercel deploy needed unless README/site files changed (README row additions → deploy anyway, it's cheap). 6. Live ingest `mad-planet` + `wiggle-room` + `centro-cafe` (wiggle-room consumes ~1 firecrawl credit); record honest counts (~5 Mad Planet, ~7+ Wiggle Room, ~10 Centro). 7. Spot-check venues by SQL. 8. Evidence + close the slice issue.

## Notes

- README source-table rows for both are part of Task 2's commit? NO — keep README in the ship-time controller pass or a 30-second Task 2 addendum; simplest: Task 2 adds both rows matching the existing format (then vercel deploy at ship).
- Wiggle Room firecrawl budget: daily cron × 1 credit/run ≈ 30 credits/month — same budget class as county-parks, acceptable.
