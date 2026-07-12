# Events Filter Bar — Grid/List, Recommended/Near Me, Show Map

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MOO-263 — a slim filter bar above the `/events` results: `View: [Grid][List] | Sort: Recommended · Near Me | 📍 Show Map`, text-first with underline-active states in the existing ChipLink idiom. Tarik rulings (2026-07-12): Recommended = editorial boost (picks → station events → chronological, within each day); Near Me = prompt-on-click geolocation, sort by distance, denied → inline notice; map = MapLibre + OpenFreeMap (key-free, own pins); venue coords via **registry JOIN at read** (annotate-only write surface untouched).

**Architecture:** `/events` stays a fully server-rendered page with URL-state (recon-verified: no client state anywhere in the tree today). Three new URL params ride the existing `buildFacetHref` + `ChipLink` idiom: `view` (grid|list), `sort` (recommended|near), `map` (1). Near Me is the one genuinely-client control: a small `'use client'` button that requests geolocation on click and navigates to `?sort=near&lat=..&lng=..` (coords rounded to 3 decimals ≈ 110m — no precise location in shareable URLs); the server then sorts by distance. **Sort modes are applied post-fetch inside the day-grouping layer** — results are already capped ≤100 and `DayList` already re-sorts within each day (`byBoostThenTime`), so BOTH the default-listing branch and the search branch get sorting for free and `src/search/hybrid.ts` (eval-baselined, FROZEN) is untouched. Coords and picks arrive by batch hydration mirroring `loadCardMeta`: `loadVenueCoords` (COALESCE `venues.lat/lng`, else `venue_registry.lon/lat` via `venues.registry_id`) and `loadPickedEventIds` (current Chicago week, matching the homepage's `picksForWeek` semantics). The map is a dynamic-imported client component (repo's first `next/dynamic` — the recon confirmed none exists) rendered when `map=1`, pinning the current result set's venues that have coords.

**Attribution review (discharging the registry-slice rule "displaying registry data publicly triggers an attribution review first"):** Overture places rows are CDLA-Permissive-2.0 (+ per-place Apache-2.0) — neither requires UI attribution for derived coordinate display. OpenFreeMap tiles are OSM-derived and DO require attribution: the map keeps MapLibre's default attribution control ("© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors"). Surface this resolution to Tarik at ship.

## Global Constraints

- **FROZEN:** `src/search/hybrid.ts` and the entire search pipeline (RRF math, legs, `browseSelect`, ORDER BYs), `search_tsv` maintenance, `normalizeName`, `query-understanding.ts`, dedup/judge/enrichment files, `loadCardMeta`'s existing shape (extend by NEW functions, never edit its query). The registry sweep files (`src/maintenance/registry-*.ts`) are read-pattern sources only.
- **NO WRITES anywhere:** this is a read-only feature. No venue column writes (coords come from JOIN at read — Tarik ruling). No new tables/migrations.
- **URL-param semantics:** `view`/`sort`/`map`/`lat`/`lng` must NOT count as search inputs — `hasActiveSearchInputs` (search-params.ts:45) behavior stays identical so the default-listing vs search branch decision is unchanged. Zod-validate all five (enum/enum/literal/number/number; invalid → ignored, never crash).
- **e2e invariants that must keep passing (recon-verified):** chip mutual-preservation (`free=1` survives adding `cat=music`); "Clear all" returns to EXACTLY `/events` (it therefore also clears view/sort/map — acceptable and simplest); the `main a[href^="/events/"]` selector shape (list rows must keep event links matching it); the `/\d+ events?/` count line; zero horizontal overflow at 390px including the new bar.
- Day-grouping is preserved in every mode: days stay chronological; sort modes reorder WITHIN each day. Near Me with no coords for a venue → sorts last within day (stable). Recommended = picked (current Chicago week) first, then `isStationEvent`, then start time — a strict extension of today's `byBoostThenTime`.
- Geolocation: requested ONLY on Near Me click; nothing persisted; denied/unavailable → inline notice + current sort unchanged; coords rounded to 3 decimals before entering the URL.
- MapLibre loaded ONLY when `map=1` (dynamic import, `ssr: false`); zero effect on the page's JS budget otherwise (homepage LCP slice just shipped — don't regress `/events` FCP for non-map users). OpenFreeMap public style URL, no API key, no env var.
- Zod 4 idioms; tests on PGlite with zero network; `maxWorkers: 2`; per-file runs arbitrate flakes. `git add` scoped; `-A` forbidden. `.env*` untouched.
- Implementers: verify recon anchors (line numbers may drift); read `node_modules/next/dist/docs/` before any Next-specific API use (repo rule).

## Decisions

1. **Sort at presentation layer, not SQL.** Both fetch branches produce ≤~100 `CardItem`s already grouped/sorted client... server-side in `DayList`. New `sortWithinDay(items, mode, coordsById, pickedIds, userPoint)` comparator module. No query ORDER BY changes anywhere.
2. **Coords resolution order:** `venues.lat/lng` (source-provided) → `venue_registry.lon/lat` via `registry_id` → none (excluded from map, last in near-sort). One batched query per page render, keyed by venueId.
3. **Recommended picks scope = current Chicago week** (`chicagoWeekMonday` from `src/lib/display.ts` — NOT chicago-time.ts; recon + memory both flag this trap), matching homepage `picksForWeek`.
4. **Map scope:** pins for the venues of the CURRENT result set only (whatever filters are active), popup = venue name + event count + link to first event. No clustering, no viewport-driven refetch — MVP.
5. **`EventListRow`** sibling component of `EventCard` in the same file family (`src/components/event-list-row.tsx`), same `{meta, startAt}` props, horizontal layout, reuses `cardBadges()`/`priceLabel()`/`accentForCategory()`.
6. **New deps:** `maplibre-gl` only. No react wrapper lib — a thin ~60-line client component with `useRef`/`useEffect` is smaller than the wrapper dependency.

### Task 1: URL params + hydration helpers (data layer)

**Files:**
- Modify: `src/app/events/search-params.ts` (add `view`/`sort`/`map`/`lat`/`lng` to schema + types; `hasActiveSearchInputs` untouched in behavior — verify by test)
- Create: `src/lib/geo.ts` (`haversineMeters(a, b)` ≤15 lines — self-contained; do NOT import from `src/maintenance/registry-match.ts`), `src/queries/venue-coords.ts` (`loadVenueCoords(db, venueIds): Promise<Map<string, { lat: number; lng: number }>>` — COALESCE venues → registry JOIN), `src/queries/picked-events.ts` (`loadPickedEventIds(db, now): Promise<Set<string>>` — current Chicago week)
- Test: `tests/queries/venue-coords.test.ts`, `tests/queries/picked-events.test.ts`, extend `tests/app/search-params.test.ts` (exists? implementer verifies; create if not)

Required cases: coords from venues.lat/lng win over registry; registry fills when venue coords null; neither → absent from map; picked-set honors Chicago week boundary; `view=list&sort=near&lat=43.05&lng=-87.9` does NOT activate the search branch; invalid enum/number params ignored.

- [ ] TDD: RED → implement → GREEN + typecheck; commit `feat: filter-bar data layer — url params, venue coords, picked-event hydration`

### Task 2: Filter bar UI + list view + sort modes

**Files:**
- Create: `src/app/events/filter-bar.tsx` (server component: View grid/list ChipLinks, Sort Recommended ChipLink, `NearMeButton` client child, Show Map ChipLink), `src/app/events/near-me-button.tsx` (`'use client'`: geolocation on click → `router.push` with rounded coords; denied → inline notice), `src/components/event-list-row.tsx`, `src/app/events/sort-modes.ts` (`sortWithinDay` comparators)
- Modify: `src/app/events/page.tsx` (render bar; hydrate coords/picks when needed; thread view/sort into DayList), `src/app/events/day-list.tsx` (accept `view` + pre-sorted comparator inputs; default behavior byte-identical when no new params)
- Test: `tests/app/sort-modes.test.ts` (comparator unit tests: picks>station>time; distance order; missing coords last; stable), extend day-list test if one exists

Required: default `/events` render (no new params) is byte-identical output to today (regression pin — snapshot or structural assertion); list rows keep `a[href^="/events/"]`; bar fits 390px with no overflow.

- [ ] TDD → GREEN + typecheck + build; commit `feat: events filter bar — grid/list view, recommended/near-me sort`

### Task 3: Map panel

**Files:**
- Create: `src/app/events/events-map.tsx` (`'use client'`, maplibre-gl via dynamic import pattern per Next docs; pins from a serializable `{ venueName, lat, lng, count, href }[]` prop; attribution control ON)
- Modify: `src/app/events/page.tsx` (when `map=1`: build pin list from result set + coords map, render `EventsMap` above the day list), `package.json` (+`maplibre-gl`)
- Test: pin-list builder unit test (pure function — venues without coords excluded, counts aggregated); the map component itself is verified by build + e2e presence check (canvas/container renders)

- [ ] TDD on the builder → implement → GREEN + typecheck + build; commit `feat: events map — maplibre pins for filtered results`

### Task 4: e2e + gates + ship

**Files:**
- Modify: `e2e/filter.spec.ts` or create `e2e/filter-bar.spec.ts`: view toggle → `?view=list` + list rows render + event links intact; sort link → `?sort=recommended`; map toggle → `?map=1` + map container present; existing chip/Clear-all assertions untouched and passing; 390px no-overflow re-check includes the bar

- [ ] Full gates quiet machine (test/typecheck/build/e2e) → commit e2e
- [ ] Ship (controller): merge FF → push → `vercel deploy --prod` → smoke `/events?view=list`, `?sort=recommended`, `?map=1` on prod → evidence (incl. attribution-review note) → MOO-263 Done. No trigger:deploy expected (no task-reachable paths — verify by diff).

## Verification summary

- Frozen search pipeline untouched (sorting is presentation-layer); write surface untouched (coords via JOIN — Tarik ruling honored).
- Every existing e2e invariant enumerated and preserved; new params proven inert to the search-branch decision.
- Map cost paid only by users who open it; registry coords go public WITH the attribution review discharged and documented.
