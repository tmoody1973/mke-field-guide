# Venue-Owned Sources: Cactus Club + X-Ray Arcade + Marcus Center + Jazz Gallery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboard four venue-owned event sources — cactusclubmilwaukee.com, xrayarcade.com, marcuscenter.org, jazzgallerycenterforarts.org — and make them (plus the already-live `eventbrite-cooperage`) the preferred survivors over aggregator copies of the same events (the pabst-theater-group precedent), so venue-published titles and SHOWTIMEs (not aggregator DOORS times) win at merge. (Scope ruled by Tarik 2026-07-12: this set now; Shank/Rave/Landmark/MPM/Eventbrite-directory/Anodyne/MSO deferred — see Deferred Sources.)

**Architecture:** Everything rides the existing `html` adapter's per-source `SelectorParser` pattern (`src/ingestion/adapters/html/sources/`) — zero adapter changes. Two of the "HTML" listings are actually JSON endpoints (a parser receives the fetched text and may `JSON.parse` it): Squarespace `?format=json` events collections and Marcus Center's The Events Calendar REST API. The Squarespace parser is built as a CONFIGURABLE FACTORY (`squarespaceEventsParser(options)`) because two of the four sources share the format exactly (X-Ray Arcade, Jazz Gallery) and future venue sites will keep being Squarespace (The Cooperage already is) — each new one costs a registry line + seed row, no parser code. Cactus Club is a cheerio selector parse of its WordPress events grid. "Primary over other sources" = add the venue-owned keys to `VENUE_OWNED_SOURCE_KEYS` (`src/dedup/confidence.ts:5`), which the dedup survivor picker already prefers. Recon fixtures were captured live on 2026-07-12 and sit in the session scratchpad (paths per task).

**Tech Stack:** unchanged. No migrations. No new env vars. No new Trigger tasks (ingest crons discover sources from the DB).

## Global Constraints

All prior-slice constraints carry forward; specifics for this slice:

- **NO PRODUCTION WRITES during implementation.** Read-only GETs against the three live sites are allowed for verification. Ship-only: `db:seed` (or scoped source-insert), deploy, live ingest runs.
- **Frozen:** dedup engine semantics (≥0.80 auto-merge, same-show constants 0.9/15min, `hybrid.ts`, `same-show.test.ts`), `normalizeName`, judge files, enrichment files, lock-aware merges, `persist.ts` locked-column filtering, jsonld fallback-id format, **the day-instance pattern** (multi-day runs = one event, day instances — the Summerfest invariant; Task 3 REUSES it, never re-implements it).
- Parsers are DETERMINISTIC: no AI calls, no network beyond the configured listing fetch. Failures skip the record with an incremented `skipped` count, never throw the whole parse away (match the sibling parsers' discipline).
- ALL wall-clock date parsing through `src/lib/chicago-time.ts` helpers (`chicagoWallTimeToIso` — verify exact signature before use). X-Ray's epoch-ms timestamps are absolute — do NOT route them through wall-time conversion.
- Tests: real captured fixtures (copy from scratchpad paths; trim per task instructions but keep items VERBATIM — hand-editing fixture content destroys signal, the S5 lesson); PGlite where DB needed; per-file runs are the arbiter.
- `git add` scoped; `-A` forbidden. `.env`/`.env.example` untouched.
- Implementers: scrutinize plan code and verify anchors (30+ plan-authored defects caught to date); the FetchedRecord field mapping MUST be checked against `src/ingestion/adapters/types.ts` and a sibling parser before transcribing. Reviewers: verify counts vs `git diff --stat`.

**Commands:** standard. Ship adds `npm run db:seed` (idempotency verified FIRST) + one `npm run ingest` per new source (check `src/ingestion/run.ts` for the per-source invocation idiom).

## Decisions (rulings taken at plan review)

1. **Marcus Center venues = hall-level names** (`Uihlein Hall`, `Peck Pavilion`, `Todd Wehr Theater`, `Wilson Theater at Vogel Hall`, `South Outdoor Grounds`), each with venueAddress `929 N Water St, Milwaukee, WI` — the rooms-within-a-building precedent (Falcon Bowl ≠ Falcon Nest) says halls booked and billed separately stay separate. Bonus: the existing address-only venue row "929 N. Water St." (4 events) becomes a merge-proposal candidate against these named halls via the S6 sweep.
2. **X-Ray Arcade closure notices are skipped:** any item whose title matches `/closed/i` AND `/private/i` (e.g. `*CLOSED* for a Private Event`) is not an event; count it in `skipped`. Real events keep flowing.
3. **Multi-day Marcus runs (18 of 39 today — Spamalot etc.) use the existing day-range/day-instance machinery** (`src/ingestion/adapters/html/day-range.ts`): one event, one all-day instance per day of the run. Per-performance showtimes aren't in the feed; do not invent them.
4. **Venue-owned preference:** `VENUE_OWNED_SOURCE_KEYS` gains `'cactus-club'`, `'x-ray-arcade'`, `'marcus-center'`, `'jazz-gallery'`, **and `'eventbrite-cooperage'`** (the Cooperage's Squarespace site is redundant with its already-live venue-scoped Eventbrite source — Tarik-ruled: preference key only, no new parser). Duplicates vs aggregators then resolve with the venue-owned record as survivor when merged (auto ≥0.80 same-show, or human-approved in the queue). NOTE the S4 learning: aggregator DOORS vs venue SHOWTIME pairs at Δ30min stay QUEUED by design (frozen 15-min window) — this slice makes the venue side the preferred survivor when a human approves them; it does not change the window.
5. **Source keys / names / cadence:** `cactus-club` ("Cactus Club (venue site)"), `x-ray-arcade` ("X-Ray Arcade (venue site)"), `marcus-center` ("Marcus Performing Arts Center (venue site)"), `jazz-gallery` ("Jazz Gallery Center for the Arts (venue site)") — all `adapterType: 'html'`, daily cadence (same as other html sources; verify how cadence is expressed in seed rows and copy it).
6. **Squarespace venue naming:** per-item `location.addressTitle`/`addressLine1`/`addressLine2` when non-empty; else the factory options' venue fallback. Fallbacks come from each site's own `website.location` payload (X-Ray: "X-Ray Arcade", "5036 South Packard Avenue, Cudahy"; Jazz Gallery: "Jazz Gallery Center for the Arts", "926 East Center Street, Milwaukee, WI, 53212" — Jazz Gallery items carry EMPTY location strings, the fallback is load-bearing there). The existing DB row "X-Ray Arcade - 5036 S Packard Ave" (78 events) will pair with the new clean venue in the 0.45–0.92 trigram band → weekly proposal → human Apply consolidates (expected in the ship evidence).

---

### Task 1: Squarespace events parser factory (X-Ray Arcade + Jazz Gallery)

**Files:**
- Create: `src/ingestion/adapters/html/sources/squarespace-events.ts`
- Modify: `src/ingestion/adapters/html/sources/index.ts` (register `'x-ray-arcade'` and `'jazz-gallery'` as factory instances), `src/db/seed.ts` (two source rows)
- Test: `tests/ingestion/sources-squarespace-events.test.ts` (create) + fixtures `tests/fixtures/html/x-ray-arcade.json`, `tests/fixtures/html/jazz-gallery.json`

**Interfaces:**
- Consumes: `FetchedRecord` from `../../types` (READ IT FIRST — map only real fields); `SelectorParser` type from `./index`.
- Produces: `squarespaceEventsParser(options: SquarespaceEventsOptions): SelectorParser` where `SquarespaceEventsOptions = { baseUrl: string; fallbackVenueName: string; fallbackVenueAddress: string; skipTitle?: RegExp }`; registered instances `'x-ray-arcade'` (baseUrl `https://xrayarcade.com`, fallback "X-Ray Arcade" / "5036 South Packard Avenue, Cudahy", skipTitle for closure notices) and `'jazz-gallery'` (baseUrl `https://jazzgallerycenterforarts.org`, fallback "Jazz Gallery Center for the Arts" / "926 East Center Street, Milwaukee, WI, 53212").

Parser rules (exact):
- `JSON.parse(html)`; items = `parsed.upcoming` ONLY (ignore `past`). Zod-validate the envelope minimally (`upcoming: z.array(z.unknown())`) and each item with a Zod schema of the fields used; invalid item → `skipped += 1`.
- Skip rule (Decision 2, X-Ray instance): title matching `options.skipTitle` (X-Ray passes a regex requiring both `/closed/i` and `/private/i` semantics — implement as one regex or a two-test predicate, your call, tested either way) → `skipped += 1`. Jazz Gallery passes no skipTitle.
- Field mapping: `title` (plain text, trim); start = `new Date(item.startDate)` (epoch ms, ABSOLUTE — no wall-time conversion); end = `new Date(item.endDate)`; url = `options.baseUrl + item.fullUrl`; sourceEventId = `item.id`; venueName = `item.location?.addressTitle` when non-empty else `options.fallbackVenueName` (Jazz Gallery items carry EMPTY-STRING location fields — empty string counts as absent); venueAddress = join of non-empty `location.addressLine1` + `addressLine2` else `options.fallbackVenueAddress`; image = `item.assetUrl` if present; description = `item.excerpt` with tags stripped (reuse the codebase's existing HTML-strip helper if one exists — grep before writing one; ≤10 lines if new).

- [ ] **Step 1: Fixtures** — copy from scratchpad, trimmed, items VERBATIM (no hand-edits inside items):
  - `/private/tmp/claude-502/-Users-tarikmoody-Documents-Projects-super-events-mke/7ba08e17-d63b-460e-aadb-6ab54a637c3e/scratchpad/xray-calendar.json` → `tests/fixtures/html/x-ray-arcade.json`: envelope with `upcoming` (first 5 items + the `*CLOSED* for a Private Event` item) and `past` (first 1 item — proves the parser ignores it).
  - `/private/tmp/claude-502/-Users-tarikmoody-Documents-Projects-super-events-mke/7ba08e17-d63b-460e-aadb-6ab54a637c3e/scratchpad/jazzgallery-events.json` → `tests/fixtures/html/jazz-gallery.json`: envelope with all 6 `upcoming` items (they have empty location strings — that's the signal).
- [ ] **Step 2: Failing tests** (fixture-driven, no network):

```typescript
  it('parses upcoming Squarespace items into records with absolute instants and venue fields', () => {});
  it('skips the *CLOSED* private-event notice and counts it (x-ray instance)', () => {});
  it('ignores the past collection entirely', () => {});
  it('falls back to configured venue name/address when item location is empty strings (jazz-gallery instance)', () => {});
  it('tolerates a malformed item without dropping the batch', () => {});
```

(The first test asserts an exact known record from the x-ray fixture: title `Ste Martaen Presents: MEETSTOP VEGAN DELI POP-UP`, start `new Date(1783872000069)`, url `https://xrayarcade.com/calendar/2026/07/12/ste-martaen`, venueName `X-Ray Arcade`, address containing `5036 South Packard Avenue`.)

- [ ] **Step 3: RED → implement factory + register both instances in `selectorParsers` → GREEN.**
- [ ] **Step 4: Seed rows** in `src/db/seed.ts` (copy the pabst-theater-group entry shape exactly; verify how seed handles existing rows — it must be idempotent by key or the ship step needs a scoped insert; report which):

```typescript
  {
    key: 'x-ray-arcade',
    name: 'X-Ray Arcade (venue site)',
    url: 'https://xrayarcade.com/calendar',
    adapterType: 'html',
    config: {
      strategy: 'selectors',
      listingUrls: ['https://xrayarcade.com/calendar?format=json'],
      sourceKey: 'x-ray-arcade',
    },
  },
  {
    key: 'jazz-gallery',
    name: 'Jazz Gallery Center for the Arts (venue site)',
    url: 'https://jazzgallerycenterforarts.org/events',
    adapterType: 'html',
    config: {
      strategy: 'selectors',
      listingUrls: ['https://jazzgallerycenterforarts.org/events?format=json'],
      sourceKey: 'jazz-gallery',
    },
  },
```

(Verify the config schema the html adapter parses — if `strategy: 'selectors'` requires other fields, match the minimal working sibling. If the adapter's fetch path rejects a JSON content-type, STOP and report NEEDS_CONTEXT with the exact check that rejects it.)
- [ ] **Step 5: Full ingestion test file green + typecheck + commit**

```bash
git add src/ingestion/adapters/html/sources/squarespace-events.ts src/ingestion/adapters/html/sources/index.ts src/db/seed.ts tests/ingestion/sources-squarespace-events.test.ts tests/fixtures/html/x-ray-arcade.json tests/fixtures/html/jazz-gallery.json
git commit -m "feat: squarespace events parser factory — x-ray-arcade + jazz-gallery venue sources"
```

### Task 2: Cactus Club parser (WordPress events grid)

**Files:**
- Create: `src/ingestion/adapters/html/sources/cactus-club.ts`
- Modify: `src/ingestion/adapters/html/sources/index.ts`, `src/db/seed.ts`
- Test: `tests/ingestion/sources-cactus-club.test.ts` (create) + fixture `tests/fixtures/html/cactus-club.html`

**Interfaces:**
- Consumes: cheerio (as sibling parsers do — copy `county-parks.ts`'s load/iterate idiom); `chicagoWallTimeToIso` from `@/lib/chicago-time` (verify signature).
- Produces: `cactusClubParser: SelectorParser` registered under `'cactus-club'`.

Parser rules (exact, from the live card markup):
- Cards: `.eventEntryInner`. Per card: date `.eventDate` text like `Sat 07/18/26` → parse `MM/DD/YY` (two-digit year = `20YY`); time `.eventTime` text like `1:00PM` (also handles `10:00PM`); combine → Chicago wall time → ISO via the chicago-time helper. Missing/unparseable date or time → `skipped += 1`.
- Title: the `.eventThumb a` element's `title` attribute (cheerio decodes entities — `&#8211;` arrives as `–`; assert that in the test). URL: same anchor's `href`. sourceEventId: the URL slug (last non-empty path segment).
- venueName = `'Cactus Club'`, venueAddress = `'2496 S Wentworth Ave, Milwaukee, WI'` (constants — the venue publishes only its own events).
- Image: from the anchor's `style` attribute `background-image:url(...)` (regex extract). Admittance text `.admittance` (e.g. `All Ages`) → append to description if the FetchedRecord has a description-like field; otherwise drop (do NOT invent fields).

- [ ] **Step 1: Fixture** — copy `/private/tmp/claude-502/-Users-tarikmoody-Documents-Projects-super-events-mke/7ba08e17-d63b-460e-aadb-6ab54a637c3e/scratchpad/cactus-list.html` (the live 2026-07-12 capture, 95KB, ~35 cards) to `tests/fixtures/html/cactus-club.html` unmodified.
- [ ] **Step 2: Failing tests**:

```typescript
  it('parses event cards with Chicago wall-time instants (07/18/26 + 1:00PM → correct UTC ISO)', () => {});
  it('decodes entity titles from the anchor title attribute', () => {});
  it('derives stable sourceEventIds from URL slugs', () => {});
  it('skips a card missing its date without dropping the batch', () => {});
```

- [ ] **Step 3: RED → implement → GREEN.**
- [ ] **Step 4: Seed row** (same shape; `listingUrls: ['https://www.cactusclubmilwaukee.com/events/']`, key/name per Decision 5).
- [ ] **Step 5: Green + typecheck + commit**

```bash
git add src/ingestion/adapters/html/sources/cactus-club.ts src/ingestion/adapters/html/sources/index.ts src/db/seed.ts tests/ingestion/sources-cactus-club.test.ts tests/fixtures/html/cactus-club.html
git commit -m "feat: cactus-club venue source — WordPress events grid parser"
```

### Task 3: Marcus Center parser (The Events Calendar REST)

**Files:**
- Create: `src/ingestion/adapters/html/sources/marcus-center.ts`
- Modify: `src/ingestion/adapters/html/sources/index.ts`, `src/db/seed.ts`
- Test: `tests/ingestion/sources-marcus-center.test.ts` (create) + fixture `tests/fixtures/html/marcus-center.json`

**Interfaces:**
- Consumes: `chicagoWallTimeToIso`; the day-range helper from `../day-range` (READ it and its call sites — Task 3 reuses, never re-implements, the day-instance pattern).
- Produces: `marcusCenterParser: SelectorParser` registered under `'marcus-center'`.

Parser rules (exact):
- `JSON.parse(html)`; items = `parsed.events` (Zod-validate fields used; invalid → skipped).
- Single-day event (`start_date` date-part === `end_date` date-part): one instance at `start_date` (format `2026-07-14 19:00:00`, wall Chicago per the feed's own `timezone` field) → chicago-time helper.
- Multi-day run (Decision 3): day-range instances across `start_date`..`end_date` via the existing day-range machinery (all-day, no invented showtimes).
- Title: decode HTML entities (`&#8217;` → `'`) — grep for an existing decode helper (jsonld.ts or payload.ts likely has one) before writing one.
- venueName = `event.venue.venue` (hall names per Decision 1), venueAddress = `event.venue.address + ', Milwaukee, WI'` (feed gives `929 N Water St`); url = `event.url`; sourceEventId = `String(event.id)`; image = `event.image.url` when present (validate shape — tribe returns `image: false` when absent, not null: the Zod schema must union `z.literal(false)`).

- [ ] **Step 1: Fixture** — copy `/private/tmp/claude-502/-Users-tarikmoody-Documents-Projects-super-events-mke/7ba08e17-d63b-460e-aadb-6ab54a637c3e/scratchpad/marcus-events.json` to `tests/fixtures/html/marcus-center.json`, trimmed to `{ events: [...], total, rest_url }` with 8 items VERBATIM: at least 2 multi-day runs (Spamalot-shaped), 2 different halls, 1 with `image: false` if present (verify — if none, note it).
- [ ] **Step 2: Failing tests**:

```typescript
  it('parses single-day events with hall-level venues and Chicago wall times', () => {});
  it('expands a multi-day run through the day-range machinery (one event, N day instances)', () => {});
  it('decodes entity titles (Monty Python’s Spamalot)', () => {});
  it('tolerates image: false and a malformed event without dropping the batch', () => {});
```

- [ ] **Step 3: RED → implement → GREEN.**
- [ ] **Step 4: Seed row** (`listingUrls: ['https://www.marcuscenter.org/wp-json/tribe/events/v1/events?per_page=50']` — verify live with one GET that the endpoint without `start_date` returns upcoming-from-today; if it returns past events, add `start_date` handling to the parser config the way sibling configs handle dynamic params, and report which).
- [ ] **Step 5: Green + typecheck + commit**

```bash
git add src/ingestion/adapters/html/sources/marcus-center.ts src/ingestion/adapters/html/sources/index.ts src/db/seed.ts tests/ingestion/sources-marcus-center.test.ts tests/fixtures/html/marcus-center.json
git commit -m "feat: marcus-center venue source — Events Calendar REST parser"
```

### Task 4: Venue-owned survivor preference

**Files:**
- Modify: `src/dedup/confidence.ts` (line 5)
- Test: extend the existing test covering `VENUE_OWNED_SOURCE_KEYS` preference (locate it — grep `pabst-theater-group` under tests/dedup; extend, do not fork)

**Interfaces:**
- Consumes/Produces: `VENUE_OWNED_SOURCE_KEYS = ['pabst-theater-group', 'cactus-club', 'x-ray-arcade', 'marcus-center', 'jazz-gallery', 'eventbrite-cooperage'] as const;`

- [ ] **Step 1: Failing test** — extend the existing survivor-preference test with one case per new key (venue-owned record beats an aggregator record).
- [ ] **Step 2: RED → one-line implement → GREEN.** Verify no other logic hardcodes the old single-key assumption (grep `pabst-theater-group` across src — report every hit and why it's unaffected).
- [ ] **Step 3: `npx vitest run tests/dedup/` ALL green (frozen files untouched) + typecheck + commit**

```bash
git add src/dedup/confidence.ts tests/dedup
git commit -m "feat: venue-owned survivor preference for four new venue sources + cooperage"
```

### Task 5: README, gates, ship checklist

**Files:**
- Modify: `README.md` (sources table: three rows matching the existing rows' format; one line on venue-owned preference listing all four keys)

- [ ] **Step 1: README** — claims source-traced (reviewer audits): three sources, their mechanisms (Squarespace JSON / WordPress grid / Events Calendar REST), venue-owned survivor preference.
- [ ] **Step 2: Full gates, quiet machine** — `npm run test`, `npm run typecheck`, `npm run build`, `npm run e2e`.
- [ ] **Step 3: Commit** (`git add README.md`, `docs: three venue-owned sources — cactus club, x-ray arcade, marcus center`)
- [ ] **Step 4: Ship checklist (finishing pass — do NOT execute in-task)**

1. Merge → main, push. 2. Seed the four source rows in prod (idempotent `npm run db:seed` if Task 1 verified idempotency; else the scoped insert the implementer prepared) — verify by SQL (source count +4). 3. `vercel deploy --prod`. 4. NO trigger:deploy needed UNLESS any `src/trigger/` file changed (it shouldn't have — verify `git diff` for src/trigger/ is empty; if the ingest cron enumerates sources in code rather than DB, STOP and reassess). 5. Live ingest each source once (per-source invocation per `src/ingestion/run.ts`); record fetched/inserted/skipped per source — expect ~35 Cactus / ~90+ X-Ray (minus closures) / 39 Marcus (18 multi-day runs) / 6 Jazz Gallery. 6. Spot-check by SQL: hall venues created; day instances for one Spamalot-shaped run; X-Ray/Cactus/Jazz events attached to the right venues; dedup queue growth (aggregator dupes) noted honestly. 7. Evidence comment (incl. wrong predictions) + close the slice issue. 8. Surface for Tarik's later queue pass: new dedup review pairs where venue-owned records should win as survivors.

## Deferred sources (recon'd 2026-07-12, Tarik-ruled out of this slice)

- **Shank Hall** — already double-covered (mke-shows + ticketmaster-milwaukee, 60 events); site is TicketWeb-backed static HTML; addable later as a selector parser if title/showtime authority is wanted.
- **The Rave** — covered (radio-milwaukee + ticketmaster-milwaukee, 71 events); ancient ASP page, latin-1 encoding, no structured data. Skip.
- **Landmark CU Live** — covered (ticketmaster-milwaukee + visit-milwaukee, 25 events); its site IS a Ticketmaster widget. Skip.
- **Milwaukee Public Market** — Webflow, ~4 events listed; tiny yield. Revisit if their calendar grows.
- **Eventbrite Milwaukee directory** — aggregator, not venue-owned; Eventbrite deprecated API location search; scraping the directory is heavy + ToS-gray. Belongs to the source-onboarding-agent backlog item.
- **Anodyne Coffee** — Shopify + client-rendered JS events widget; needs widget-API reverse-engineering. Defer.
- **MSO (mso.org)** — WordPress month-paginated calendar (Bradley Symphony Center: 3 events in DB today); real parser work, moderate yield. Defer; decent next candidate.

## Verification summary

- Four venue-owned sources live on the existing adapter chassis (Tasks 1–3), five keys preferred as merge survivors (Task 4), documented (Task 5).
- The doors-vs-showtime queue gets its venue-owned side; the X-Ray dash-variant venue pair surfaces to the weekly proposal sweep; the "929 N. Water St." address-only row becomes resolvable against named halls.
- No migrations, no env changes, no new Trigger tasks — the smallest possible blast radius for four new sources.
