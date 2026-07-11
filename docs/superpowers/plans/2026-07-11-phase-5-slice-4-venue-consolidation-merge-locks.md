# Phase 5 Slice 4: Venue Consolidation + Lock-Aware Merges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the venue-variant class of review-queue noise at all three layers (retro-merge existing duplicate venue rows, alias-resolve variant names at ingest, stop minting dash-address variants at the adapter) and close the final review's two backlog Importants (dedup merges ignore `lockedFields` — instance re-adds onto time-locked survivors; venue backfill refills a locked-null venue).

**Architecture:** Prod has 15+ venue clusters where one physical venue exists as multiple rows ("Riverside Theater" ×4, "Cactus Club" vs "Cactus Club - 2496 S Wentworth Ave"…) because iCal `LOCATION` splits on comma only and mke-shows delimits with " - ". Split venue rows depress dedup `venueAffinity` from 1.0 (same `venue_id`) to trigram ~0.35, which is exactly the 0.15-weighted gap that drops same-show pairs from 0.85 (auto-merge) to ~0.75 (review queue) — every such show floods the queue forever. The fix is three-layered and does NOT touch `normalizeName` (its blast radius is every event slug, title-similarity score, and index): (1) a new `venue_aliases` table maps variant normalized names → canonical venue, consulted at the single entry point `findOrCreateVenue`; (2) `mergeVenues` + a `venues:merge` CLI repoints events, backfills the survivor's nulls **including `neighborhood`** (the recon's landmine: the neighborhood map is keyed on stored normalized names, several of which are variant keys — an unaware merge silently un-hoods Bay View venues), records the variant name as an alias, then deletes the duplicate row; (3) the iCal/county-parks location split learns the dash-address shape (`" - "` followed by a street number — "The Rave - Eagles Club" style names stay intact). Separately, `mergeEvents` gains lock-awareness at its exactly-two lock-relevant touch points: a `'time'`-locked survivor keeps its curated dates (the duplicate's instances die with the duplicate instead of moving), and a `'venue'`-locked survivor's deliberately-null venue is excluded from the COALESCE backfill (title/status are NOT NULL, never backfilled — no other interaction exists).

**Tech Stack:** unchanged (Next 16.2.10 / Drizzle 0.45.2 on Neon HTTP / Zod 4 / Vitest 4 + PGlite / Playwright / Trigger.dev v4, CLI pinned 4.5.1).

## Global Constraints

Every task's requirements implicitly include all of these (Slice 1–3 constraints carry forward; additions in bold):

- **NO PRODUCTION WRITES during implementation.** Sanctioned prod writes live ONLY in the ship checklist (Task 7): `npm run db:migrate` (migration 0016, pure DDL) and the curated `venues:merge` runs, executed at ship time.
- **`git add` scoped paths only; `git add -A` forbidden. `.env`/`.env.example` append-only** (untouched this slice — no new env).
- **Dual-deploy rule — THIS SLICE TRIPS IT:** Tasks 2–5 edit `src/ingestion/persist.ts`, `src/ingestion/adapters/*`, and `src/dedup/merge.ts` — all Trigger-task-reachable. Ship checklist MUST run `npm run trigger:deploy` (pinned CLI 4.5.1).
- **`normalizeName` (src/ingestion/naming.ts) is FROZEN.** It shapes every venue key, event slug, `normalizedTitle`, and title-similarity score. The alias layer lives BESIDE it, never inside it.
- **Frozen as ever:** `src/search/hybrid.ts` (zero edits); ≥0.80 auto-merge SEMANTICS — thresholds (`AUTO_MERGE_THRESHOLD = 0.8` / `REVIEW_THRESHOLD = 0.55`), weights (title .55 / venue .15 / time .15 / url .15), verdict logic, `pickCanonical`/`pickSameShowSurvivor` survivor choice, same-show rule constants. **Task 5 changes merge MECHANICS for locked survivors only** — which pairs merge and who survives is untouched; what a merge writes when the survivor carries a lock is the sanctioned change. Also frozen: trigger-maintained `search_tsv`, enrichment-owned columns out of ingestion's `eventFields`, `maintainLink` isCanonical guard, jsonld fallback-id, day-instance pattern, `LOCKED_FIELD_VALUES` vocabulary.
- **`tests/dedup/same-show.test.ts` is a frozen behavioral contract — no task may edit it; it must stay green through Task 5.**
- **The category/vibe/audience backfill atomicity invariant in `backfillMissingFields` (merge.ts:69-80 comment) must survive Task 5** — those three columns fill together or not at all, or a merge permanently hides an untagged canonical from every future tag sweep.
- Neon HTTP: no transactions — every multi-statement mutation recovery-ordered; a re-run must converge (mergeVenues and the merge.ts edits both).
- ANY date logic through `src/lib/chicago-time.ts`/`src/lib/display.ts`. Zod 4 idioms at every boundary. `'use server'` files export only async fns (no new ones this slice — CLI + library code only).
- Tests on PGlite only (`tests/helpers/test-db.ts` replays `drizzle/*.sql` name-sorted — migration 0016 picked up automatically; keep it pure DDL). vitest `maxWorkers: 2`; per-file runs are the trustworthy arbiter.
- Logic functions ≤ 20 lines where feasible; files ≤ ~300 lines; match repo idiom; comments only for constraints code can't show.
- Implementers: **scrutinize plan code, don't transcribe blindly** — re-verify every anchor; 18 plan-authored defects have been caught by reviewers across Phases 4–5.

**Commands:** `npm run test` / `npm run typecheck` / `npm run build` / `npx vitest run <file>` / `npm run e2e` / `npm run db:generate` / (ship only) `npm run db:migrate`, `npm run trigger:deploy`, `npm run venues:merge -- …`.

## Prerequisites & live findings

1. **Prod variant clusters (quantified 2026-07-11, trigram sweep on `venues.normalized_name`):** Riverside Theater / The Riverside Theater / Riverside Theatre / Riverside Theatre - WI; Pabst Theater / The Pabst Theater; Cactus Club / Cactus Club - 2496 S Wentworth Ave; Miller High Life / Miller High Life Theatre; Cathedral Square / Cathedral Square Park; The Rave-Eagles Club / Eagles Club\/The Rave\/Eagles Ballroom; Henry Maier Festival Park / (Summerfest Grounds); (The) American Family Insurance Amphitheater / … - Summerfest Grounds; Linneman's ("linnemans" / "linneman s riverwest inn 1001 e locust st" — both already in the neighborhood map). **Deliberately NOT merged (ambiguous, distinct spaces):** Falcon Bowl vs Falcon Hall vs Falcon Nest (rooms at 801 E Clarke); Humboldt/Washington Park vs their Bandshells (park ≠ stage); address-only "venues". The curated list lives in ship step 5; Tarik can veto lines there.
2. **16 pending review pairs in prod** are mostly this exact class (Cactus Club variants) — after ship + the curated merges, the next 8:00 sweep's same-show drain should clear them as auto-merges (venueAffinity returns to 1.0). Queue count before/after is ship evidence.
3. Slice 3's locked Billy Allen title is the live durability canary — it must still read "Billy Allen + The Pollies" after this slice ships (it's visit-milwaukee weekly; Monday's run is the conclusive check).

## Decisions (made in planning; flagged ones await Tarik)

1. **Aliases are a table, not config:** `venue_aliases` (id, `normalized_name` UNIQUE, `venue_id` FK→venues ON DELETE CASCADE, `created_at`). Written by `mergeVenues` (the deleted variant's normalized name → survivor) and readable by hand-insert for future curation. Consulted at the TOP of `findOrCreateVenue` — one indexed select per new-venue-name record; the alias hit skips insert/conflict entirely. Cascade rationale: if the canonical venue is ever deleted, its aliases are meaningless.
2. **`mergeVenues` order (no transactions):** backfill survivor's null `address`/`lat`/`lng`/`neighborhood` from the duplicate → repoint `events.venue_id` → upsert alias (variant name → survivor) → delete duplicate venue. A crash at any point leaves a convergent state for a re-run; the alias upsert (`onConflictDoNothing`) and the repoint UPDATE are idempotent. Survivor keeps its own `name`/`slug` (inbound links preserved); the duplicate's slug 404s and drops from the sitemap next crawl — acceptable (venue pages are force-dynamic, no cache to bust).
3. **Adapter fix is the targeted dash-address split**, shared helper `splitLocationName(location)`: split on the FIRST of `,` or ` - ` **only when the dash is followed by a digit** (`/\s-\s(?=\d)/`) — "Cactus Club - 2496 S Wentworth Ave" → "Cactus Club"; "The Rave - Eagles Club" intact. Applied in `ical.ts` normalize and `county-parks.ts` `splitVenue`. `venueAddress` keeps the full original string (unchanged behavior).
4. **`mergeEvents` lock-awareness = exactly two changes:** (a) fetch the CANONICAL's `lockedFields` (one PK select; today only the duplicate is fetched); if it contains `'time'`, skip `moveInstances` entirely — the admin curated the survivor's dates, and the duplicate's instances cascade-delete with the duplicate row (same semantics as persist's time-lock skip). (b) if it contains `'venue'`, exclude `venue_id` from the backfill COALESCE (the admin's deliberate null survives). No receipt-shape change; `event_edits` are untouched (the loser's cascade is the documented contract). Title/status: NOT NULL, never backfilled, no interaction — documented, not coded.
5. **Neighborhood map keys migrate in the same slice:** variant keys whose venues get merged are replaced by the canonical's key (e.g. `'cactus club 2496 s wentworth ave'` → `'cactus club'`), verified by `assign-neighborhoods`' staleKeys/unmapped rot report going quiet for the merged set. Without this, the map re-diverges the moment anyone re-runs the assigner.
6. **CLI over admin UI for venue merges** (this slice): `npm run venues:merge -- --keep <slug-or-id> --absorb <slug-or-id>` with a `--dry-run` default OFF but a confirmation print of both rows before writing. Venue merging is a low-frequency curation task with real irreversibility; an admin UI can ride a later slice if the CLI sees regular use. **(AWAITS TARIK if he'd rather have the UI now.)**
7. **Homepage LCP (perf-71) stays OUT of this slice** — different domain (frontend perf), deserves its own bounded pass. **(AWAITS TARIK.)**
8. **Riders:** delete the stale "Task 9 consolidates to @/db/types" comment in `src/queries/admin-sources.ts:5` (consolidation landed); add the missing `normalizedTitle`-held assertion to `tests/ingestion/locked-fields.test.ts` (final-review Minor).

---

### Task 1: Migration 0016 — `venue_aliases`

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0016_*.sql` (via `npm run db:generate`; commit the `drizzle/meta` journal updates)
- Test: `tests/db/venue-aliases.test.ts` (create)

**Interfaces:**
- Consumes: `venues` table, `pgTable` idioms.
- Produces: `schema.venueAliases` — columns `id` (uuid PK), `normalizedName` (text NOT NULL UNIQUE), `venueId` (uuid NOT NULL FK→venues.id ON DELETE CASCADE), `createdAt`. Plus `venueAliasesRelations`. Tasks 2 and 4 rely on these exact names.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/venue-aliases.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('migration 0016: venue_aliases', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  async function seedVenue(name: string, normalized: string) {
    const [venue] = await db
      .insert(schema.venues)
      .values({ name, normalizedName: normalized })
      .returning();
    return venue;
  }

  it('stores an alias and enforces normalized_name uniqueness', async () => {
    const venue = await seedVenue('Cactus Club', 'cactus club');
    await db.insert(schema.venueAliases).values({
      normalizedName: 'cactus club 2496 s wentworth ave',
      venueId: venue.id,
    });
    await expect(
      db.insert(schema.venueAliases).values({
        normalizedName: 'cactus club 2496 s wentworth ave',
        venueId: venue.id,
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('aliases cascade away with their venue', async () => {
    const venue = await seedVenue('Doomed Hall', 'doomed hall');
    await db.insert(schema.venueAliases).values({ normalizedName: 'doomed hall annex', venueId: venue.id });
    await db.delete(schema.venues).where(eq(schema.venues.id, venue.id));
    const orphans = await db.query.venueAliases.findMany({
      where: eq(schema.venueAliases.normalizedName, 'doomed hall annex'),
    });
    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 2: RED run** — `npx vitest run tests/db/venue-aliases.test.ts` → FAIL (venueAliases not on schema).

- [ ] **Step 3: Add the schema** — in `src/db/schema.ts`, after `venuesRelations` (~:186):

```typescript
// Variant venue names (e.g. "Cactus Club - 2496 S Wentworth Ave") resolved to their
// canonical venue at ingest — written by mergeVenues when it absorbs a variant row.
// Cascade: an alias is meaningless without its canonical venue.
export const venueAliases = pgTable(
  'venue_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    normalizedName: text('normalized_name').notNull(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('venue_aliases_normalized_name_idx').on(t.normalizedName)],
);

export const venueAliasesRelations = relations(venueAliases, ({ one }) => ({
  venue: one(venues, { fields: [venueAliases.venueId], references: [venues.id] }),
}));
```

- [ ] **Step 4: Generate** — `npm run db:generate`; inspect `drizzle/0016_*.sql`: one CREATE TABLE, one UNIQUE INDEX, one FK. Pure DDL. Do NOT run db:migrate.

- [ ] **Step 5: GREEN run** — `npx vitest run tests/db/venue-aliases.test.ts` → 2/2.

- [ ] **Step 6: Typecheck + commit**

```bash
git add src/db/schema.ts drizzle tests/db/venue-aliases.test.ts
git commit -m "feat: migration 0016 — venue_aliases table for variant-name resolution"
```

### Task 2: Alias resolution in `findOrCreateVenue`

**Files:**
- Modify: `src/ingestion/persist.ts` (`findOrCreateVenue` only)
- Test: `tests/ingestion/persist.test.ts` (extend)

**Interfaces:**
- Consumes: `schema.venueAliases` (Task 1); existing `findOrCreateVenue` flow (persist.ts:77-87 pre-slice: normalize → insert-on-conflict → re-select).
- Produces: unchanged signature `findOrCreateVenue` (private) / `persistNormalizedEvent` public behavior: a normalized venue name with an alias row resolves to the alias's `venueId` — no new venue row minted. Task 4's `mergeVenues` relies on this to make merges sticky.

Trigger-task-reachable; the ONLY sanctioned change is the alias lookup at the top of `findOrCreateVenue`. The lock machinery (`LOCK_COLUMNS`, `LOCKED_FIELD_VALUES`, `unlockedEventFields`, time-lock skip) and the 23505 race recovery are byte-untouched.

- [ ] **Step 1: Write the failing test** — extend `tests/ingestion/persist.test.ts` using its existing venue-test idiom (the file already has "two events at same venue share one venue row" cases around :45-108 — copy the local seeding helpers):

```typescript
  it('an aliased variant venue name resolves to the canonical venue instead of minting a row', async () => {
    // 1. seed canonical venue directly: insert venues { name: 'Cactus Club', normalizedName: 'cactus club' }
    // 2. insert venue_aliases { normalizedName: 'cactus club 2496 s wentworth ave', venueId: canonical.id }
    // 3. persistNormalizedEvent with venueName 'Cactus Club - 2496 S Wentworth Ave'
    // 4. assert the event's venueId === canonical.id
    // 5. assert venues count did NOT grow (no variant row minted)
  });

  it('a name with no alias behaves exactly as before (creates, then reuses)', async () => {
    // persist two events with venueName 'Brand New Hall' — one venue row, both events share it
    // (regression guard: the lookup must not break the create path)
  });
```

Flesh the skeletons with the file's real helpers; assert counts with explicit selects.

- [ ] **Step 2: RED run** — `npx vitest run tests/ingestion/persist.test.ts` → the alias case fails (variant row gets minted).

- [ ] **Step 3: Implement** — in `src/ingestion/persist.ts`, `findOrCreateVenue` gains the lookup as its first act:

```typescript
async function resolveVenueAlias(db: Db, normalized: string): Promise<string | null> {
  const alias = await db.query.venueAliases.findFirst({
    where: eq(schema.venueAliases.normalizedName, normalized),
  });
  return alias?.venueId ?? null;
}

async function findOrCreateVenue(db: Db, n: NormalizedEvent): Promise<string> {
  const name = n.venueName as string;
  const normalized = normalizeName(name);
  // Variant names absorbed by a venue merge resolve to their canonical venue —
  // without this, re-ingest re-mints the variant row the merge just deleted.
  const aliased = await resolveVenueAlias(db, normalized);
  if (aliased) return aliased;
  const inserted = await insertVenueRow(db, n, name, normalized, venueSlug(normalized));
  if (inserted.length > 0) return inserted[0].id;
  const existing = await db.query.venues.findFirst({
    where: eq(schema.venues.normalizedName, normalized),
  });
  if (!existing) throw new Error(`Venue lookup failed after conflict: ${name}`);
  return existing.id;
}
```

- [ ] **Step 4: GREEN + neighbors** — `npx vitest run tests/ingestion/` → ALL green (the whole ingestion suite is the regression net for the untouched create path and lock machinery).

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/ingestion/persist.ts tests/ingestion/persist.test.ts
git commit -m "feat: resolve venue-name aliases to canonical venues at ingest"
```

### Task 3: Dash-address location split (iCal + county-parks)

**Files:**
- Create: `src/ingestion/adapters/venue-location.ts`
- Modify: `src/ingestion/adapters/ical.ts` (:71), `src/ingestion/adapters/html/county-parks.ts` (`splitVenue`, ~:75-81 — verify anchor)
- Test: `tests/ingestion/venue-location.test.ts` (create), `tests/ingestion/ical-adapter.test.ts` (extend one case)

**Interfaces:**
- Produces: `splitLocationName(location: string | undefined): string | undefined` — the venue-name half of a location string: text before the first `,`, further trimmed at ` - ` ONLY when the dash is followed by a digit (street number). Both adapters call it.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/ingestion/venue-location.test.ts
import { describe, expect, it } from 'vitest';
import { splitLocationName } from '@/ingestion/adapters/venue-location';

describe('splitLocationName', () => {
  it('strips a dash-delimited street address (the mke-shows shape)', () => {
    expect(splitLocationName('Cactus Club - 2496 S Wentworth Ave')).toBe('Cactus Club');
  });
  it('keeps dashes that are part of the venue name', () => {
    expect(splitLocationName('The Rave - Eagles Club')).toBe('The Rave - Eagles Club');
  });
  it('still splits on comma first', () => {
    expect(splitLocationName('Turner Hall Ballroom, 1040 N 4th St, Milwaukee')).toBe('Turner Hall Ballroom');
  });
  it('applies the dash rule to the comma-split head', () => {
    expect(splitLocationName('Linneman’s Riverwest Inn - 1001 E Locust St, Milwaukee, WI')).toBe(
      'Linneman’s Riverwest Inn',
    );
  });
  it('passes through clean names and handles undefined/empty', () => {
    expect(splitLocationName('Pabst Theater')).toBe('Pabst Theater');
    expect(splitLocationName(undefined)).toBeUndefined();
    expect(splitLocationName('   ')).toBeUndefined();
  });
});
```

- [ ] **Step 2: RED run** (`npx vitest run tests/ingestion/venue-location.test.ts` → module not found)

- [ ] **Step 3: Implement**

```typescript
// src/ingestion/adapters/venue-location.ts
/**
 * The venue-name half of a free-text location. Splits on the first comma, then
 * trims a trailing street address delimited by " - " ONLY when a digit follows
 * the dash — "Cactus Club - 2496 S Wentworth Ave" is a venue plus address,
 * "The Rave - Eagles Club" is just a name.
 */
export function splitLocationName(location: string | undefined): string | undefined {
  if (!location) return undefined;
  const head = location.split(',')[0]?.split(/\s-\s(?=\d)/)[0]?.trim();
  return head || undefined;
}
```

`src/ingestion/adapters/ical.ts:71` becomes:

```typescript
    const venueName = splitLocationName(p.location);
```

(with the import added; `venueAddress: p.location` unchanged). In `county-parks.ts`, apply the same helper to the name half inside `splitVenue` — read the actual function first and keep its address-half behavior byte-identical; only the name half gains the dash rule. If `splitVenue`'s shape makes the helper a poor fit, apply the regex inline with a comment referencing venue-location.ts and note it in your report.

- [ ] **Step 4: Extend the iCal adapter test** — in `tests/ingestion/ical-adapter.test.ts`, add one normalize case: a VEVENT whose `LOCATION:Cactus Club - 2496 S Wentworth Ave` yields `venueName === 'Cactus Club'` AND `venueAddress === 'Cactus Club - 2496 S Wentworth Ave'` (copy the file's existing fixture idiom).

- [ ] **Step 5: GREEN + neighbors** — `npx vitest run tests/ingestion/venue-location.test.ts tests/ingestion/ical-adapter.test.ts tests/ingestion/county-parks.test.ts` (verify the county-parks test filename — adjust to actual) → all green.

- [ ] **Step 6: Typecheck + commit**

```bash
git add src/ingestion/adapters/venue-location.ts src/ingestion/adapters/ical.ts src/ingestion/adapters/html/county-parks.ts tests/ingestion/venue-location.test.ts tests/ingestion/ical-adapter.test.ts
git commit -m "feat: dash-address venue-name split for iCal and county-parks locations"
```

### Task 4: `mergeVenues` + `venues:merge` CLI

**Files:**
- Create: `src/maintenance/merge-venues.ts`
- Modify: `package.json` (script `"venues:merge": "tsx src/maintenance/merge-venues.ts"`)
- Test: `tests/maintenance/venue-merge.test.ts` (create)

**Interfaces:**
- Consumes: `schema.venues`, `schema.venueAliases` (Task 1), `schema.events.venueId` (the ONLY FK into venues — recon-verified).
- Produces: `mergeVenues(db, keepId: string, absorbId: string): Promise<MergeVenuesResult>` where `MergeVenuesResult = { eventsRepointed: number; aliasRecorded: string }`. CLI: `npm run venues:merge -- --keep <slug-or-id> --absorb <slug-or-id>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/maintenance/venue-merge.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { mergeVenues } from '@/maintenance/merge-venues';
import { createTestDb } from '../helpers/test-db';

describe('mergeVenues', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  async function seedVenue(values: Partial<typeof schema.venues.$inferInsert> & { name: string; normalizedName: string }) {
    const [venue] = await db.insert(schema.venues).values(values).returning();
    return venue;
  }

  async function seedEventAt(venueId: string, slug: string) {
    const [event] = await db
      .insert(schema.events)
      .values({ slug, title: slug, normalizedTitle: slug, venueId })
      .returning();
    return event;
  }

  it('repoints events, backfills survivor nulls (incl. neighborhood), records the alias, deletes the duplicate', async () => {
    const keep = await seedVenue({ name: 'Cactus Club', normalizedName: 'cactus club', slug: 'cactus-club' });
    const absorb = await seedVenue({
      name: 'Cactus Club - 2496 S Wentworth Ave',
      normalizedName: 'cactus club 2496 s wentworth ave',
      address: '2496 S Wentworth Ave',
      neighborhood: 'Bay View',
      slug: 'cactus-club-2496-s-wentworth-ave',
    });
    await seedEventAt(absorb.id, 'show-at-variant');
    await seedEventAt(keep.id, 'show-at-canonical');

    const result = await mergeVenues(db, keep.id, absorb.id);

    expect(result.eventsRepointed).toBe(1);
    const survivor = await db.query.venues.findFirst({ where: eq(schema.venues.id, keep.id) });
    // Landmine guard: the survivor inherits the variant's neighborhood + address (its own were null)
    expect(survivor).toMatchObject({ neighborhood: 'Bay View', address: '2496 S Wentworth Ave', slug: 'cactus-club' });
    expect(await db.query.venues.findFirst({ where: eq(schema.venues.id, absorb.id) })).toBeUndefined();
    const alias = await db.query.venueAliases.findFirst({
      where: eq(schema.venueAliases.normalizedName, 'cactus club 2496 s wentworth ave'),
    });
    expect(alias?.venueId).toBe(keep.id);
    const moved = await db.query.events.findFirst({ where: eq(schema.events.slug, 'show-at-variant') });
    expect(moved?.venueId).toBe(keep.id);
  });

  it('survivor values win over duplicate values (COALESCE, not overwrite)', async () => {
    const keep = await seedVenue({ name: 'Pabst Theater', normalizedName: 'pabst theater', neighborhood: 'Downtown' });
    const absorb = await seedVenue({ name: 'The Pabst Theater', normalizedName: 'the pabst theater', neighborhood: 'WRONG' });
    await mergeVenues(db, keep.id, absorb.id);
    const survivor = await db.query.venues.findFirst({ where: eq(schema.venues.id, keep.id) });
    expect(survivor?.neighborhood).toBe('Downtown');
  });

  it('re-run converges: merging an already-absorbed pair is a clean no-op envelope', async () => {
    const keep = await seedVenue({ name: 'Turner Hall', normalizedName: 'turner hall' });
    const absorb = await seedVenue({ name: 'Turner Hall Ballroom', normalizedName: 'turner hall ballroom' });
    await mergeVenues(db, keep.id, absorb.id);
    await expect(mergeVenues(db, keep.id, absorb.id)).rejects.toThrow(/not found/i);
    // (the CLI surfaces this as "absorb venue not found — already merged?"; the alias row persists)
  });

  it('refuses to merge a venue into itself', async () => {
    const keep = await seedVenue({ name: 'Vivarium', normalizedName: 'vivarium' });
    await expect(mergeVenues(db, keep.id, keep.id)).rejects.toThrow(/itself/i);
  });
});
```

- [ ] **Step 2: RED run** (`npx vitest run tests/maintenance/venue-merge.test.ts` → module not found)

- [ ] **Step 3: Implement** — model the guarded-main CLI on `src/maintenance/assign-neighborhoods.ts` (exported core + `fileURLToPath(import.meta.url) === process.argv[1]` main):

```typescript
// src/maintenance/merge-venues.ts
// Absorb a duplicate venue row into its canonical: repoint events, backfill the
// survivor's null address/lat/lng/neighborhood, record the variant's normalized
// name as an alias (so re-ingest can't re-mint it), delete the duplicate.
// No transactions on Neon HTTP — ordered so a crash converges on re-run.
import { fileURLToPath } from 'node:url';
import { eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import type { Db } from '@/db/types';

export interface MergeVenuesResult {
  eventsRepointed: number;
  aliasRecorded: string;
}

export async function mergeVenues(db: Db, keepId: string, absorbId: string): Promise<MergeVenuesResult> {
  if (keepId === absorbId) throw new Error('Refusing to merge a venue into itself.');
  const keep = await db.query.venues.findFirst({ where: eq(schema.venues.id, keepId) });
  const absorb = await db.query.venues.findFirst({ where: eq(schema.venues.id, absorbId) });
  if (!keep) throw new Error(`Keep venue not found: ${keepId}`);
  if (!absorb) throw new Error(`Absorb venue not found: ${absorbId} — already merged?`);

  // 1. Backfill survivor nulls (COALESCE — survivor's own values always win).
  //    neighborhood is load-bearing: the curated map may only know the variant's key.
  await db.execute(sql`
    UPDATE venues k
    SET address = COALESCE(k.address, a.address),
        lat = COALESCE(k.lat, a.lat),
        lng = COALESCE(k.lng, a.lng),
        neighborhood = COALESCE(k.neighborhood, a.neighborhood),
        updated_at = now()
    FROM venues a
    WHERE k.id = ${keepId} AND a.id = ${absorbId}
  `);
  // 2. Repoint events (the only FK into venues).
  const repointed = await db
    .update(schema.events)
    .set({ venueId: keepId, updatedAt: new Date() })
    .where(eq(schema.events.venueId, absorbId))
    .returning({ id: schema.events.id });
  // 3. Record the alias BEFORE deleting — a crash between 3 and 4 leaves both the
  //    alias and the row; findOrCreateVenue prefers the alias, and a re-run finishes.
  await db
    .insert(schema.venueAliases)
    .values({ normalizedName: absorb.normalizedName, venueId: keepId })
    .onConflictDoNothing({ target: schema.venueAliases.normalizedName });
  // 4. Delete the duplicate (its aliases, if any, cascade — re-point them first).
  await db
    .update(schema.venueAliases)
    .set({ venueId: keepId })
    .where(eq(schema.venueAliases.venueId, absorbId));
  await db.delete(schema.venues).where(eq(schema.venues.id, absorbId));

  return { eventsRepointed: repointed.length, aliasRecorded: absorb.normalizedName };
}

async function resolveVenueArg(db: Db, arg: string): Promise<string> {
  // A non-uuid arg in an id equality makes Postgres throw on the cast — only
  // include the id term when the arg actually parses as a uuid (repo idiom).
  const isUuid = z.uuid().safeParse(arg).success;
  const venue = await db.query.venues.findFirst({
    where: isUuid
      ? or(eq(schema.venues.id, arg), eq(schema.venues.slug, arg))
      : eq(schema.venues.slug, arg),
  });
  if (!venue) throw new Error(`No venue matches id or slug: ${arg}`);
  return venue.id;
}

function argValue(flag: string): string {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${flag} <slug-or-id>`);
  return value;
}

async function main(): Promise<void> {
  const { db } = await import('@/db');
  const keepId = await resolveVenueArg(db, argValue('--keep'));
  const absorbId = await resolveVenueArg(db, argValue('--absorb'));
  const keep = await db.query.venues.findFirst({ where: eq(schema.venues.id, keepId) });
  const absorb = await db.query.venues.findFirst({ where: eq(schema.venues.id, absorbId) });
  console.log(`KEEP   ${keep?.name} (${keep?.normalizedName})`);
  console.log(`ABSORB ${absorb?.name} (${absorb?.normalizedName})`);
  const result = await mergeVenues(db, keepId, absorbId);
  console.log(`repointed ${result.eventsRepointed} events; alias recorded: ${result.aliasRecorded}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

NOTE: `resolveVenueArg` matching `eq(schema.venues.id, arg)` against a non-uuid arg will error on Postgres uuid casting — guard it: only include the id term when `z.uuid().safeParse(arg).success` (import zod, mirror the repo's uuid-guard idiom). The implementer writes that guard; the naive `or` above is illustrative of intent, not final code.

Add to `package.json` scripts: `"venues:merge": "tsx src/maintenance/merge-venues.ts"`.

- [ ] **Step 4: GREEN run** — `npx vitest run tests/maintenance/venue-merge.test.ts` → 4/4.

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/maintenance/merge-venues.ts package.json tests/maintenance/venue-merge.test.ts
git commit -m "feat: mergeVenues + venues:merge CLI — absorb variant venue rows, record aliases"
```

### Task 5: Lock-aware `mergeEvents`

The frozen-adjacent task — **reviewer gets the adversarial framing.**

**Files:**
- Modify: `src/dedup/merge.ts`
- Test: `tests/dedup/merge-locks.test.ts` (create)

**Interfaces:**
- Consumes: `schema.events.lockedFields`; existing `mergeEvents(db, canonicalId, duplicateId, scored, decidedBy)` — signature UNCHANGED.
- Produces: same signature; new behavior guarantee: a `'time'`-locked canonical's instance set is byte-identical before/after any merge; a `'venue'`-locked canonical's `venue_id` (including deliberate null) survives backfill. All other merge behavior byte-identical.

- [ ] **Step 1: Write the failing tests** — seed with `persistNormalizedEvent` or direct inserts per `tests/dedup/` neighbors (copy helpers from `tests/dedup/merge.test.ts` if it exists, else `chain-merge.test.ts` — verify which):

```typescript
// tests/dedup/merge-locks.test.ts — skeletons; flesh out with local helpers
describe('mergeEvents respects survivor locks', () => {
  it("a 'time'-locked survivor keeps its exact instance set; the duplicate's instances die with it", async () => {
    // canonical: 1 instance at T1, lockedFields ['time']
    // duplicate: instances at T1 (collision) and T2 (novel)
    // mergeEvents(...) →
    //   canonical still has EXACTLY one instance, at T1 (T2 was NOT moved)
    //   duplicate row deleted; receipt written; links moved (provenance intact)
  });

  it("an unlocked survivor still receives the duplicate's novel instances (regression)", async () => {
    // same seed WITHOUT the lock → canonical ends with T1 + T2 (today's behavior, byte-identical)
  });

  it("a 'venue'-locked survivor's deliberately-null venue survives backfill", async () => {
    // canonical: venueId null, lockedFields ['venue']; duplicate: venueId set
    // merge → canonical venueId STILL null; other null fields (e.g. description) DID backfill
  });

  it('an unlocked survivor still backfills venue from the duplicate (regression)', async () => {
    // same seed without lock → canonical venueId === duplicate's venueId
  });

  it('category/vibe/audience still fill together from a tagged duplicate onto a locked survivor', async () => {
    // 'time'-locked canonical untagged; duplicate tagged → all three enrichment
    // columns land together (the atomicity invariant survives the lock changes)
  });
});
```

- [ ] **Step 2: RED run** — `npx vitest run tests/dedup/merge-locks.test.ts` → lock cases fail (locks ignored today).

- [ ] **Step 3: Implement** — in `src/dedup/merge.ts`:

```typescript
export async function mergeEvents(
  db: Db,
  canonicalId: string,
  duplicateId: string,
  scored: ScoredPair,
  decidedBy: 'auto' | 'review',
): Promise<void> {
  const duplicate = await db.query.events.findFirst({ where: eq(schema.events.id, duplicateId) });
  if (!duplicate) return;
  const canonical = await db.query.events.findFirst({
    where: eq(schema.events.id, canonicalId),
    columns: { lockedFields: true },
  });
  const locked = canonical?.lockedFields ?? [];
  await db
    .update(schema.eventSourceLinks)
    .set({ eventId: canonicalId, isCanonical: false })
    .where(eq(schema.eventSourceLinks.eventId, duplicateId));
  // Admin 'time' lock: the survivor's dates are curated — the duplicate's
  // instances die with the duplicate row instead of moving (same contract as
  // persistNormalizedEvent's time-lock skip).
  if (!locked.includes('time')) await moveInstances(db, canonicalId, duplicateId);
  await backfillMissingFields(db, canonicalId, duplicateId, locked);
  await db.update(schema.eventClusters)
    .set({ canonicalEventId: canonicalId })
    .where(eq(schema.eventClusters.canonicalEventId, duplicateId));
  await db.delete(schema.events).where(eq(schema.events.id, duplicateId));
  await db.insert(schema.eventClusters).values({
    canonicalEventId: canonicalId,
    mergedEventSlug: duplicate.slug,
    mergedEventTitle: duplicate.title,
    score: scored.total.toFixed(4),
    breakdown: scoredBreakdown(scored),
    decidedBy,
  });
}
```

`backfillMissingFields` gains the lock param; the ONLY conditional column is `venue_id` (title/status are NOT NULL and never appear here — the category/vibe/audience atomicity comment stays verbatim):

```typescript
async function backfillMissingFields(
  db: Db,
  canonicalId: string,
  duplicateId: string,
  locked: string[],
): Promise<void> {
  // Admin 'venue' lock: a deliberately-cleared venue must not be refilled from
  // the duplicate — the survivor keeps its own venue_id verbatim.
  const venueExpr = locked.includes('venue')
    ? sql`c.venue_id`
    : sql`COALESCE(c.venue_id, d.venue_id)`;
  await db.execute(sql`
    UPDATE events c
    SET summary = COALESCE(c.summary, d.summary),
        description = COALESCE(c.description, d.description),
        category = COALESCE(c.category, d.category),
        vibe_tags = COALESCE(c.vibe_tags, d.vibe_tags),
        audience_tags = COALESCE(c.audience_tags, d.audience_tags),
        image_url = COALESCE(c.image_url, d.image_url),
        canonical_url = COALESCE(c.canonical_url, d.canonical_url),
        is_free = COALESCE(c.is_free, d.is_free),
        venue_id = ${venueExpr},
        updated_at = now()
    FROM events d
    WHERE c.id = ${canonicalId} AND d.id = ${duplicateId}
  `);
}
```

(Keep the existing atomicity doc-comment above the function verbatim; the recovery-ordering header comment gains one line noting the canonical lock fetch.)

- [ ] **Step 4: GREEN + the full dedup canary** — `npx vitest run tests/dedup/` → ALL green including the FROZEN `same-show.test.ts` (unlocked events everywhere in that suite = byte-identical behavior proof).

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/dedup/merge.ts tests/dedup/merge-locks.test.ts
git commit -m "feat: mergeEvents respects survivor time/venue locks"
```

### Task 6: Neighborhood-map key migration + riders

**Files:**
- Modify: `src/maintenance/venue-neighborhood-map.ts`, `src/queries/admin-sources.ts` (:5 stale comment), `tests/ingestion/locked-fields.test.ts` (one assertion)

- [ ] **Step 1: Map keys** — for every curated ship-list pair (Decision/ship step 5), ensure the CANONICAL's normalized key carries the neighborhood and delete the variant key it replaces. Known from recon (verify each against the file):
  - `'cactus club 2496 s wentworth ave': 'Bay View'` → add `'cactus club': 'Bay View'`, remove the variant key.
  - `'linneman s riverwest inn 1001 e locust st'` → covered by existing `'linnemans'` key; remove the variant.
  - `'the riverside theater'` + `'riverside theatre wi'` → keep exactly one canonical key (`'riverside theater'` — matches the survivor row post-merge; verify the survivor's actual normalized_name in the ship list), remove others.
  - Sweep the whole map for keys matching other ship-list variants (pabst, miller high life, cathedral square, henry maier, amfam, rave/eagles) and consolidate the same way. Do NOT touch Falcon/bandshell/address-only entries (not merged).
- [ ] **Step 2: Rider — stale comment** — `src/queries/admin-sources.ts:5`: replace the "Task 9 consolidates to @/db/types; until then…" comment line with nothing (the import stays; consolidation landed — verify the import already reads from '@/lib/card-data' and switch it to '@/db/types' while there, one line, typecheck is the gate).
- [ ] **Step 3: Rider — locked-fields assertion** — in `tests/ingestion/locked-fields.test.ts`, the locked-title case: add `expect(updated?.normalizedTitle).toBe(<the admin-set normalized title>)` beside the existing title assertion (LOCK_COLUMNS protects both together; the test now proves it).
- [ ] **Step 4: Verify** — `npx vitest run tests/ingestion/locked-fields.test.ts tests/maintenance/` green; `npm run typecheck` clean. For the map: run `npx vitest run tests/maintenance/assign-neighborhoods.test.ts` if it exists (verify filename), else typecheck-only + the ship-time rot report is the verifier.
- [ ] **Step 5: Commit**

```bash
git add src/maintenance/venue-neighborhood-map.ts src/queries/admin-sources.ts tests/ingestion/locked-fields.test.ts
git commit -m "chore: canonical neighborhood-map keys for merged venues + slice-4 riders"
```

### Task 7: Gates, README, ship checklist

**Files:**
- Modify: `README.md` (venue consolidation section + merge-locks note in the existing locks section)

- [ ] **Step 1: README** — add a "Venue consolidation" subsection under the dedup docs: what `venue_aliases` does (variant → canonical at ingest), the `venues:merge` CLI (flags, what it repoints/backfills/records, irreversibility), the dash-address adapter rule, and the neighborhood-map consequence (canonical keys). In the existing field-locks section, add: dedup merges now respect the survivor's `time` and `venue` locks (duplicate instances die with the duplicate; locked-null venue survives backfill).
- [ ] **Step 2: Full gates, sequentially, quiet machine** — `npm run test` (expect ~440+, all green), `npm run typecheck`, `npm run build`, `npm run e2e` (16 expected with keys).
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: venue consolidation + lock-aware merge documentation"
```

- [ ] **Step 4: Ship checklist (finishing-a-development-branch pass — do NOT execute inside this task)**

1. Merge `phase-5-slice-4` → `main` locally; push to origin (repo is public now).
2. **Prod migration (sanctioned write #1):** `npm run db:migrate` — 0016 `venue_aliases`; verify empty by read.
3. `vercel deploy --prod`; **`npm run trigger:deploy` — MANDATORY** (persist/adapters/merge all task-reachable).
4. Live smoke: public routes 200; `/admin/sources` 307.
5. **Curated venue merges (sanctioned write #2), via CLI against prod — Tarik may veto any line before execution:**
   - Cactus Club ← Cactus Club - 2496 S Wentworth Ave
   - Riverside Theater ← The Riverside Theater ← Riverside Theatre ← Riverside Theatre - WI (three absorbs onto one survivor; pick the row with the most events as keeper — check with a count query first)
   - Pabst Theater ← The Pabst Theater
   - Miller High Life Theatre ← Miller High Life
   - Cathedral Square Park ← Cathedral Square (park is the fuller name; verify which row the neighborhood map + more events favor)
   - Henry Maier Festival Park ← Henry Maier Festival Park (Summerfest Grounds)
   - American Family Insurance Amphitheater ← variants
   - The Rave-Eagles Club ← Eagles Club/The Rave/Eagles Ballroom
   - Linneman's ← linneman s riverwest inn variant
   - SKIPPED (ambiguous): Falcon Bowl/Hall/Nest, park-vs-bandshell pairs, address-only venues.
   For each: run with `--keep`/`--absorb`, eyeball the KEEP/ABSORB confirmation lines, record counts.
6. Run `npm run venues:assign-neighborhoods` against prod — rot report should show NO staleKeys for the merged set and no newly-unmapped merged venues.
7. **Queue-drain evidence:** note pending `event_reviews` count before ship; after the next 8:00 dedup sweep (or a manual `dedup-daily` trigger), the variant-venue pairs should auto-merge via the restored same-show path — record before/after counts.
8. Verify the Billy Allen locked title still reads "Billy Allen + The Pollies" (lock canary).
9. Ledger + evidence comment (new Linear issue for this slice — see open ruling #4).

## Verification summary (what "done" means for this slice)

- Final-review backlog Importants closed: `mergeEvents` consults survivor `lockedFields` at both touch points, regression-tested with the full dedup suite as the byte-identical canary (Task 5).
- Venue-variant queue-filler class killed at three layers: retro (Task 4 + ship merges), resolution (Task 2 aliases), prevention (Task 3 adapter split) — evidenced by the post-ship queue drain (ship step 7).
- The neighborhood landmine defused: merges backfill `neighborhood`, map keys migrate (Tasks 4+6), rot report clean (ship step 6).
- Riders: stale comment gone, `normalizedTitle`-held assertion added (Task 6).

## Open rulings for Tarik (asked at plan review)

1. Execution mode (subagent-driven recommended).
2. Venue merging stays CLI-only this slice (admin UI later if it sees regular use) — approve or ask for the UI now.
3. Homepage LCP (perf-71) deferred to its own pass — approve.
4. Create a new Linear issue for this slice (post-MVP data quality — MOO-258 is admin tools and shouldn't absorb it) — approve and I'll open it with the plan summary.
