# Venue Registry + Waterfall Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground venue identity in an external registry (Overture Maps places, ~92k Milwaukee-metro POIs) so venue duplicates resolve by *real-world identity* — two records pointing at the same registry entity — instead of name-string similarity, closing the trigram blind spots the 2026-07-12 coverage recon proved (Shank Hall dash-variant at 0.282 similarity; ~25 address-string venue rows that can never name-match).

**Architecture:** A `venue_registry` table holds the Overture Milwaukee slice (imported by CLI from the public S3 parquet; refreshed manually). A weekly **resolution waterfall** runs per venue: **Tier 0** — local registry match (trigram name + street-number evidence); **Tier 1** — geocode.earth forward-geocoding of the venue's address (transient, never persisted) to add a distance-in-meters signal, then re-match; **Tier 2** — the existing haiku pair-judge for residue pairs (now fed address-match candidates the trigram band can't see); **human gate always** — every merge is still a click in `/admin/venues`. The sweep is **annotate-only on venues** (writes ONLY `venues.registry_id`/`registry_matched_at` — the judge precedent) and **propose-only on merges** (writes ONLY `venue_merge_suggestions` rows, now with `source`/`evidence` so registry-backed proposals are distinguishable from LLM ones — the dataset a future auto-merge ruling would be judged on). Foursquare's paid API is NOT used: Foursquare's data already arrives free inside Overture (per-place Apache 2.0 rows). Google is NOT used (deferred ruling; place_id-only storage restriction).

**Tech Stack:** unchanged (Drizzle on Neon HTTP / Zod 4 / Vitest + PGlite / Trigger.dev v4 pinned CLI 4.5.1) + DuckDB CLI (local dev tool only, already installed at `~/.local/bin/duckdb` — never a prod dependency) + geocode.earth REST (free tier 25k req/mo; results are open data, permanently storable).

## Global Constraints

Slice 1–6 constraints carry forward; additions in bold:

- **NO PRODUCTION WRITES during implementation.** Ship-only: `npm run db:migrate` (0019), one live `registry:import`, one live `registry:resolve`.
- **ANNOTATE-ONLY on venues (judge precedent):** sweep code writes ONLY `venues.registry_id` and `venues.registry_matched_at`. It must NEVER write `venues.name/normalized_name/address/lat/lng/neighborhood/slug` or any other column. Geocode results are TRANSIENT (used for matching in-memory, never persisted). A reviewer finding any other venue column written by sweep code = Critical.
- **PROPOSE-ONLY on merges (unchanged hard invariant):** merge-adjacent writes are ONLY `venue_merge_suggestions` rows. NO agent code path calls `mergeVenues`/`mergeVenuesWithDb`/`mergeEvents`.
- **Half-budget cron rule (frozen, enforced at S6 final review):** per-tick external-call worst case ≤ half the 600s task maxDuration. New schedule: `GEOCODE_LIMIT = 25` × 10s = 250s ≤ 300s. The new schedule is SEPARATE from `venue-proposals-weekly` (whose 20 × 15s = 300s budget is already fully spent).
- **Advisory-never-blocks:** geocode client never throws, `AbortSignal.timeout(10_000)` inside the try; `hasGeocodeKey()` no-key = tier skipped (tier 0 still runs); `hasGatewayKey()` continues to gate LLM calls.
- **Frozen:** everything from prior slices — `normalizeName`, `hybrid.ts`, same-show constants, judge files, `LOCKED_FIELD_VALUES`, lock-aware merges, enrichment sweep files (`title-suggest*` untouched), `mergeVenuesWithDb` internals. `src/maintenance/venue-proposals.ts` is NOT frozen (Tasks 4–6 extend it), but `proposeVenueMerge`/`buildVenuePrompt`/`venueProposalSchema` bodies are — only the candidate query and sweep grow.
- **Registry data is internal-only this slice** (used for matching, not displayed publicly). README documents sources/licenses (Overture CDLA-Permissive-2.0 + Apache-2.0 rows; geocode.earth open data). Displaying registry data publicly later triggers an attribution review first.
- **`.env`/`.env.example` APPEND-ONLY:** one new var `GEOCODE_EARTH_API_KEY` appended to `.env.example` with a comment. (AI_GATEWAY_API_KEY has a history of vanishing in edits — append, never rewrite.)
- Zod 4 idioms; DB failures caught + `console.error` + generic message; tests on PGlite with DI'd fns (`geocodeFn`, `proposeFn`) — ZERO network calls in tests; `maxWorkers: 2`; per-file runs are the arbiter.
- **`git add` scoped; -A forbidden.**
- Implementers: scrutinize plan code, verify anchors (30+ plan-authored defects caught to date). Reviewers: verify reported counts against `git diff --stat`.

**Commands:** standard + `npm run registry:import` / `npm run registry:resolve` (new) / (ship) `db:migrate`, `trigger:deploy` (verify **8** tasks register, up from 7).

## Decisions

1. **Registry source = Overture Maps places theme** (release `2026-05-20.0` or newer at import time), Milwaukee-metro bbox slice (lon −88.6..−87.7, lat 42.6..43.45, ~92k POIs — the 2026-07-12 recon's parquet). Overture embeds Foursquare OS Places rows (per-place Apache 2.0) plus Meta/Microsoft sources under CDLA-Permissive-2.0, and its **GERS ids** are stable entity identifiers built for exactly this join. Refresh is MANUAL (re-run `registry:import`; upsert by id) — venue churn is slow; no cron.
2. **Waterfall tiers (the resolution order):** Tier 0 local registry (free, covers ~65% by name alone, ~80% with address evidence) → Tier 1 geocode.earth (address → coords, transient; free tier; results storable but we deliberately persist nothing) → Tier 2 existing haiku pair-judge (now also fed address-match candidate pairs) → human Apply/Dismiss. **Foursquare API: NO** (its data is already in the registry via Overture; the paid API's 500 free calls add nothing). **Google: DEFERRED** (needs a ruling; place_id-only storage).
3. **Annotation acceptance rule (Task 3 constants, deterministic):** `NAME_ACCEPT = 0.92` trigram similarity alone; or `NAME_WITH_STREET = 0.75` + street-number match; or `NAME_WITH_DISTANCE = 0.60` + geocoded distance ≤ `DISTANCE_ACCEPT_METERS = 100`. Below all three → no annotation, gate stamped anyway (one-shot attempt discipline, same as `title_suggested_at`; re-attempt = admin clears gate in SQL or a future refresh CLI flag). **Address-only venue names never annotate by address equality alone** — a street address can hold multiple POIs (the Humboldt Park / Vine-at-Humboldt trap from the recon); they flow to Tier 2 as pairs instead.
4. **Registry-duplicate proposals:** two venues annotated with the SAME `registry_id` → `venue_merge_suggestions` row with `source: 'registry'`, `confidence: '0.9800'`, `evidence` jsonb, rationale naming the shared entity. Keep side = the venue whose `normalized_name` has higher trigram similarity to the registry name (tie → higher event count). Rides the existing unique-pair index / `onConflictDoNothing()` / durable-dismiss machinery unchanged.
5. **Candidate-query upgrades (Task 6):** trigram candidates now EXCLUDE pairs where both venues carry DIFFERENT registry_ids (registry says different places — don't spend a haiku call), and EXCLUDE pairs where either side's `normalized_name` already exists in `venue_aliases` (closes the S6 recorded Decision-4 deviation). NEW second candidate source: **address-match pairs** — venues sharing street number + first street-name token in their own `address` fields, regardless of name similarity (this is what catches "Shank Hall" vs "Shank Hall - 1434 N Farwell Ave Milwaukee" at 0.282).
6. **`evidence` jsonb shape** (suggestions): `{ tier: 'registry-id' | 'address-pair', registryId?: string, registryName?: string, registryAddress?: string | null, simKeep?: number, simAbsorb?: number }`. Nullable — LLM-only proposals keep `evidence: null`, `source: 'llm'` (the migration default backfills existing rows).
7. **New weekly schedule `venue-resolution-weekly`, Mon 8:30 America/Chicago** — 30 minutes BEFORE `venue-proposals-weekly` (9:00) so fresh annotations inform that run's candidate exclusions. `CRON_RESOLUTION_LIMIT = 50` venues/tick (tier 0 is DB-only); `GEOCODE_LIMIT = 25` geocode calls/tick (25 × 10s = 250s ≤ half of 600s).
8. **No auto-merge, no eval harness this slice.** Registry-backed proposals are still human-applied. The `source` column IS the future dataset: if the `source='registry'` apply-rate is ~100% over a sustained window, THAT evidence supports a future auto-merge ruling for the registry-id class only (explicit Tarik ruling required, same bar as the judge's condition (b)).

---

### Task 1: Migration 0019 — `venue_registry` + venue annotation columns + suggestion provenance

**Files:**
- Modify: `src/db/schema.ts` (venues table after `neighborhood`; `venueMergeSuggestions` after `status`; new table + relations after `venueMergeSuggestionsRelations`)
- Create: `drizzle/0019_*.sql` via `npm run db:generate` (+ meta journal)
- Test: `tests/db/venue-registry.test.ts` (create)

**Interfaces:**
- Produces: `schema.venues.registryId` (text, nullable), `.registryMatchedAt` (timestamptz, nullable); `schema.venueMergeSuggestions.source` (text enum `['llm','registry']` NOT NULL default `'llm'`), `.evidence` (jsonb, nullable); `schema.venueRegistry` — `id` (text PK, the Overture GERS id), `name` (text NOT NULL), `category` (text), `address` (text), `locality` (text), `lon` (numeric NOT NULL), `lat` (numeric NOT NULL), `confidence` (numeric), `importedAt` (timestamptz NOT NULL default now); GIN trigram index on `lower(name)`.

- [ ] **Step 1: Failing test**

```typescript
// tests/db/venue-registry.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('migration 0019: venue registry + annotation columns', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('registry rows round-trip and the trigram index answers similarity queries', async () => {
    await db.insert(schema.venueRegistry).values({
      id: '08f2baa6d2c54e5b0399cb9f5f3a1b2c',
      name: 'Shank Hall',
      category: 'music_venue',
      address: '1434 N Farwell Ave',
      locality: 'Milwaukee',
      lon: '-87.8934',
      lat: '43.0521',
      confidence: '0.99',
    });
    const rows = await db.execute(sql`
      SELECT id, similarity(lower(name), 'shank hall') AS sim FROM venue_registry
      WHERE similarity(lower(name), 'shank hall') > 0.9
    `);
    expect(rows.rows).toHaveLength(1);
    expect(Number((rows.rows[0] as Record<string, unknown>).sim)).toBeGreaterThan(0.9);
  });

  it('venue annotation columns default null and round-trip', async () => {
    const [venue] = await db.insert(schema.venues)
      .values({ name: 'Shank Hall', normalizedName: 'shank hall' }).returning();
    expect(venue.registryId).toBeNull();
    expect(venue.registryMatchedAt).toBeNull();
    await db.update(schema.venues)
      .set({ registryId: '08f2baa6d2c54e5b0399cb9f5f3a1b2c', registryMatchedAt: new Date() })
      .where(eq(schema.venues.id, venue.id));
    const updated = await db.query.venues.findFirst({ where: eq(schema.venues.id, venue.id) });
    expect(updated?.registryId).toBe('08f2baa6d2c54e5b0399cb9f5f3a1b2c');
    expect(updated?.registryMatchedAt).toBeInstanceOf(Date);
  });

  it('suggestion provenance defaults to llm/null and accepts registry evidence', async () => {
    const [keep] = await db.insert(schema.venues).values({ name: 'K', normalizedName: 'k reg' }).returning();
    const [absorb] = await db.insert(schema.venues).values({ name: 'A', normalizedName: 'a reg' }).returning();
    const [plain] = await db.insert(schema.venueMergeSuggestions).values({
      keepVenueId: keep.id, absorbVenueId: absorb.id, confidence: '0.8000', rationale: 'llm says same',
    }).returning();
    expect(plain.source).toBe('llm');
    expect(plain.evidence).toBeNull();
    await db.update(schema.venueMergeSuggestions)
      .set({ source: 'registry', evidence: { tier: 'registry-id', registryId: 'x' } })
      .where(eq(schema.venueMergeSuggestions.id, plain.id));
    const updated = await db.query.venueMergeSuggestions.findFirst({
      where: eq(schema.venueMergeSuggestions.id, plain.id),
    });
    expect(updated?.source).toBe('registry');
    expect(updated?.evidence).toEqual({ tier: 'registry-id', registryId: 'x' });
  });
});
```

- [ ] **Step 2: RED run** (`npx vitest run tests/db/venue-registry.test.ts`)

- [ ] **Step 3: Schema** — in `src/db/schema.ts` (verify `jsonb` and `index` are already imported from `drizzle-orm/pg-core`; add to the import if absent). Inside `venues` after `neighborhood`:

```typescript
    // Annotate-only registry link (judge precedent): the resolution sweep writes ONLY
    // these two columns. registryId is an Overture GERS id into venue_registry (loose
    // reference, no FK — registry refreshes replace rows). registryMatchedAt is the
    // one-shot attempt gate: stamped on every attempt, including "no confident match".
    registryId: text('registry_id'),
    registryMatchedAt: timestamp('registry_matched_at', { withTimezone: true }),
```

Inside `venueMergeSuggestions` after `status`:

```typescript
    // Proposal provenance: 'registry' rows carry real-world-identity evidence (shared
    // GERS entity / address match) — the dataset a future auto-merge ruling is judged on.
    source: text('source', { enum: ['llm', 'registry'] }).notNull().default('llm'),
    evidence: jsonb('evidence'),
```

After `venueMergeSuggestionsRelations`:

```typescript
// Overture Maps places slice for Milwaukee metro (imported via registry:import;
// refreshed manually — venue churn is slow). Internal-only this slice: used to
// resolve venue identity, never displayed publicly.
export const venueRegistry = pgTable(
  'venue_registry',
  {
    id: text('id').primaryKey(), // Overture GERS id — stable real-world-entity identifier
    name: text('name').notNull(),
    category: text('category'),
    address: text('address'),
    locality: text('locality'),
    lon: numeric('lon').notNull(),
    lat: numeric('lat').notNull(),
    confidence: numeric('confidence'),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('venue_registry_name_trgm_idx').using('gin', sql`lower(${t.name}) gin_trgm_ops`)],
);
```

(Verify `sql` is imported in schema.ts; add `import { sql } from 'drizzle-orm';` if absent. If the generated SQL for the GIN index is wrong or missing, hand-append `CREATE INDEX "venue_registry_name_trgm_idx" ON "venue_registry" USING gin (lower("name") gin_trgm_ops);` to the generated migration and note it in your report.)

- [ ] **Step 4: Generate** — `npm run db:generate`; inspect 0019: CREATE TABLE venue_registry + GIN index + two ADD COLUMNs on venues + two ADD COLUMNs on venue_merge_suggestions, pure DDL. NO db:migrate.
- [ ] **Step 5: GREEN (3/3) + typecheck + commit**

```bash
git add src/db/schema.ts drizzle tests/db/venue-registry.test.ts
git commit -m "feat: migration 0019 — venue_registry + annotation columns + suggestion provenance"
```

### Task 2: Registry import — DuckDB slice script + `registry:import` CLI

**Files:**
- Create: `scripts/venue-registry-slice.sql` (DuckDB, run locally), `src/maintenance/registry-import.ts`
- Modify: `package.json` (`"registry:import": "tsx src/maintenance/registry-import.ts"`)
- Test: `tests/maintenance/registry-import.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's `schema.venueRegistry`.
- Produces: `importRegistryRows(db, rows: RegistryRow[]): Promise<{ upserted: number }>` where `RegistryRow = { id: string; name: string; category: string | null; address: string | null; locality: string | null; lon: number; lat: number; confidence: number | null }`; `registryRowSchema` (Zod, exported); CLI reads a JSONL file path from `process.argv[2]`, validates each line with `registryRowSchema` (invalid lines counted + skipped, never crash), batches upserts 500/statement.

- [ ] **Step 1: DuckDB slice script** (documentation artifact + the exact command the ship step runs):

```sql
-- scripts/venue-registry-slice.sql
-- Local-only (DuckDB CLI): slices Overture places to Milwaukee metro as JSONL.
-- Usage: duckdb -init /dev/null -batch < scripts/venue-registry-slice.sql
-- Then:  npm run registry:import /tmp/overture-mke.jsonl
INSTALL httpfs; LOAD httpfs;
SET s3_region='us-west-2';
COPY (
  SELECT
    id,
    names.primary AS name,
    categories.primary AS category,
    addresses[1].freeform AS address,
    addresses[1].locality AS locality,
    bbox.xmin AS lon,
    bbox.ymin AS lat,
    confidence
  FROM read_parquet('s3://overturemaps-us-west-2/release/2026-05-20.0/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin > -88.6 AND bbox.xmax < -87.7
    AND bbox.ymin > 42.6  AND bbox.ymax < 43.45
    AND names.primary IS NOT NULL
) TO '/tmp/overture-mke.jsonl' (FORMAT JSON);
```

- [ ] **Step 2: Failing tests** (fixture rows inline — no DuckDB, no network):

```typescript
// tests/maintenance/registry-import.test.ts — flesh each with explicit assertions
describe('registryRowSchema', () => {
  it('accepts a full row and a row with null category/address/locality/confidence', () => {});
  it('rejects rows missing id, name, or coordinates', () => {});
});
describe('importRegistryRows', () => {
  it('inserts new rows and reports an honest upserted count', () => {});
  it('re-import updates name/address in place by id (upsert, no duplicate rows)', () => {});
});
```

(The upsert test imports the same id twice with a changed name and asserts one row with the new name via `db.query.venueRegistry.findMany()`.)

- [ ] **Step 3: RED → implement.** Core shape (write exactly; CLI mirrors `run-title-suggest.ts`'s dotenv/guarded-main idiom):

```typescript
// src/maintenance/registry-import.ts (core — CLI wrapper below it in the same file)
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import type { Db } from '@/db/types';

const IMPORT_BATCH_SIZE = 500;

export const registryRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
  locality: z.string().nullable().default(null),
  lon: z.number(),
  lat: z.number(),
  confidence: z.number().nullable().default(null),
});
export type RegistryRow = z.infer<typeof registryRowSchema>;

export async function importRegistryRows(db: Db, rows: RegistryRow[]): Promise<{ upserted: number }> {
  let upserted = 0;
  for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
    const batch = rows.slice(start, start + IMPORT_BATCH_SIZE);
    const inserted = await db
      .insert(schema.venueRegistry)
      .values(batch.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        address: row.address,
        locality: row.locality,
        lon: String(row.lon),
        lat: String(row.lat),
        confidence: row.confidence === null ? null : String(row.confidence),
      })))
      .onConflictDoUpdate({
        target: schema.venueRegistry.id,
        set: {
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          address: sql`excluded.address`,
          locality: sql`excluded.locality`,
          lon: sql`excluded.lon`,
          lat: sql`excluded.lat`,
          confidence: sql`excluded.confidence`,
          importedAt: sql`now()`,
        },
      })
      .returning({ id: schema.venueRegistry.id });
    upserted += inserted.length;
  }
  return { upserted };
}
```

CLI wrapper: read the JSONL path from `process.argv[2]` (exit 1 with usage message if absent), `readFileSync` + split lines, `registryRowSchema.safeParse(JSON.parse(line))` per line inside try/catch (malformed JSON = invalid), collect valid rows, log `imported N, invalid M`. (~92k rows ≈ 25MB — fine to read whole.)

- [ ] **Step 4: GREEN + typecheck + commit**

```bash
git add scripts/venue-registry-slice.sql src/maintenance/registry-import.ts package.json tests/maintenance/registry-import.test.ts
git commit -m "feat: venue registry import — Overture slice script + JSONL upsert CLI"
```

### Task 3: Registry matcher — candidates + deterministic acceptance

**Files:**
- Create: `src/maintenance/registry-match.ts`
- Test: `tests/maintenance/registry-match.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's `schema.venueRegistry`; `Db` from `@/db/types`.
- Produces: `RegistryMatch = { registryId: string; registryName: string; registryAddress: string | null; nameSimilarity: number }`; `streetNumber(address: string | null): string | null` (leading digits of the first token, e.g. `"1434 N Farwell Ave"` → `"1434"`, `"Shank Hall - 1434 N Farwell"` → `null` — it reads the START of the string only); `findRegistryCandidates(db, normalizedName: string): Promise<RegistryCandidate[]>` (top `CANDIDATE_LIMIT = 5` by trigram similarity ≥ `CANDIDATE_FLOOR = 0.55`, each `{ registryId, registryName, registryAddress, lon: number, lat: number, nameSimilarity: number }`); `acceptMatch(candidate, venue: { normalizedName: string; address: string | null }, distanceMeters: number | null): boolean`; `matchVenueToRegistry(db, venue, coords?: { lon: number; lat: number }): Promise<RegistryMatch | null>`.
- Acceptance constants (exact, from Decision 3): `NAME_ACCEPT = 0.92`, `NAME_WITH_STREET = 0.75`, `NAME_WITH_DISTANCE = 0.60`, `DISTANCE_ACCEPT_METERS = 100`.

Matcher rules (implement per these exactly):
- Candidates: raw `sql` via `db.execute` — `SELECT id, name, address, lon, lat, similarity(lower(name), ${normalizedName}) AS sim FROM venue_registry WHERE similarity(lower(name), ${normalizedName}) >= ${CANDIDATE_FLOOR} ORDER BY sim DESC LIMIT ${CANDIDATE_LIMIT}` (`Number()`-coerce sim/lon/lat).
- `acceptMatch` returns true when: `sim >= NAME_ACCEPT`; OR `sim >= NAME_WITH_STREET` AND both street numbers are non-null and equal (`streetNumber(candidate.registryAddress) === streetNumber(venue.address)`); OR `distanceMeters !== null` AND `distanceMeters <= DISTANCE_ACCEPT_METERS` AND `sim >= NAME_WITH_DISTANCE`.
- `matchVenueToRegistry`: fetch candidates; compute haversine meters to each when `coords` given (write a ≤15-line `haversineMeters(a, b)` helper in this file — 6371km radius, standard formula); return the FIRST candidate (they're sim-ordered) that `acceptMatch` accepts, else null. Never annotates by address equality alone — that path does not exist here by design (Decision 3's multi-POI-per-address trap).

- [ ] **Step 1: Failing tests** — seed PGlite `venue_registry` fixtures; cover exactly:

```typescript
describe('streetNumber', () => {
  it('extracts a leading street number and returns null for name-first or null addresses', () => {});
});
describe('findRegistryCandidates', () => {
  it('returns sim-ordered candidates above the floor with numeric coercion', () => {});
});
describe('acceptMatch / matchVenueToRegistry', () => {
  it('accepts on name similarity alone at >= 0.92 (Shank Hall exact)', () => {});
  it('accepts mid-similarity only with matching street numbers (The Cooperage vs The Cooperage MKE at 822)', () => {});
  it('accepts low-band similarity only within 100m when coords are provided', () => {});
  it('rejects the park-feature trap: "humboldt park bandshell" does NOT match "Humboldt Park Pond" (sim < 0.92, no street/distance evidence)', () => {});
});
```

- [ ] **Step 2: RED → implement → GREEN + typecheck + commit**

```bash
git add src/maintenance/registry-match.ts tests/maintenance/registry-match.test.ts
git commit -m "feat: registry matcher — trigram candidates + deterministic acceptance rule"
```

### Task 4: Resolution sweep (annotate-only) + registry-duplicate proposals

**Files:**
- Create: `src/maintenance/registry-resolve.ts`
- Test: `tests/maintenance/registry-resolve.test.ts` (create)

**Interfaces:**
- Consumes: Task 3's matcher exports; Task 1 columns; `GeocodeResult`/`geocodeAddress`/`hasGeocodeKey` from Task 5 — **define the DI seam now**: `resolveVenues(db, opts?: { limit?: number; geocodeLimit?: number; geocodeFn?: (address: string) => Promise<{ lon: number; lat: number } | null> }): Promise<{ annotated: number; unmatched: number; suggested: number; skipped: number }>`. Default `geocodeFn` is wired in Task 5 — until then the sweep imports nothing network-touching and `opts.geocodeFn ?? null` (null = tier 1 skipped). Task 6's cron consumes `resolveVenues` + `CRON_RESOLUTION_LIMIT`.
- Produces: `resolveVenues` (above); `DEFAULT_RESOLUTION_LIMIT = 50`, `DEFAULT_GEOCODE_LIMIT = 25` (exported for the cron).

Sweep semantics (exact):
- Candidates: venues `WHERE registry_matched_at IS NULL ORDER BY created_at ASC LIMIT`.
- Per venue: Tier 0 `matchVenueToRegistry(db, venue)` (no coords). On null AND venue.address non-null AND geocodeFn present AND geocode budget remaining: Tier 1 — `geocodeFn(venue.address)` (budget decrements on every call, null result included); on coords, `matchVenueToRegistry(db, venue, coords)`. Geocode results are TRANSIENT — never written anywhere.
- Match → UPDATE venues SET `registry_id`, `registry_matched_at = now()` guarded `WHERE registry_matched_at IS NULL`, `.returning()`; `annotated += 1` only on a row hit (honest counts).
- No match → stamp `registry_matched_at` only, same guard; `unmatched += 1` on hit.
- Guard miss (raced) → `skipped += 1`.
- After the annotation loop: **duplicate scan** — `SELECT registry_id FROM venues WHERE registry_id IS NOT NULL GROUP BY registry_id HAVING count(*) > 1`; for each group, load its venues with per-venue trigram sim to the registry name; keep = highest sim (tie → higher event count via the same `count(events)` pattern `loadVenueContext` uses at venue-proposals.ts:173-176); write one suggestion per (keep, absorb) pair: `source: 'registry'`, `confidence: '0.9800'`, `rationale: 'Both records resolve to registry entity "<registryName>" (<registryAddress ?? 'address unknown'>).'`, `evidence: { tier: 'registry-id', registryId, registryName, registryAddress, simKeep, simAbsorb }`, `.onConflictDoNothing().returning()` — `suggested += 1` only on landed rows.
- The sweep never throws to its caller for per-venue failures: wrap each venue's iteration body in try/catch (`console.error` + `skipped += 1`).

- [ ] **Step 1: Failing tests** — DI'd `geocodeFn`, zero network; seed registry + venues fixtures:

```typescript
describe('resolveVenues', () => {
  it('annotates a strong name match and stamps the gate (registry_id + registry_matched_at set)', () => {});
  it('stamps gate-only for a no-confidence venue (registry_id stays NULL, never re-attempted next run)', () => {});
  it('tier 1: geocodeFn coords rescue a low-sim match within 100m; geocode budget is respected', () => {});
  it('writes a registry-duplicate suggestion with source/evidence/keep-side per the sim rule', () => {});
  it('ANNOTATE-ONLY invariant: all venue columns except registry_id/registry_matched_at byte-untouched; events untouched', () => {});
  it('suggestion insert is conflict-safe and counts stay honest (pre-existing pair row → no phantom suggested)', () => {});
});
```

(The invariant test does full-row masked toEqual — mask ONLY `registryId`/`registryMatchedAt` to null, then `toEqual` the before-rows; copy the shape from `tests/maintenance/venue-proposals.test.ts`'s PROPOSE-ONLY test.)

- [ ] **Step 2: RED → implement → GREEN**; `npx vitest run tests/maintenance/` ALL green; typecheck.
- [ ] **Step 3: Commit**

```bash
git add src/maintenance/registry-resolve.ts tests/maintenance/registry-resolve.test.ts
git commit -m "feat: annotate-only venue resolution sweep + registry-duplicate proposals"
```

### Task 5: geocode.earth client (Tier 1)

**Files:**
- Create: `src/maintenance/geocode.ts`
- Modify: `src/maintenance/registry-resolve.ts` (default `geocodeFn` wiring only — one import + one `??` default), `.env.example` (APPEND one line)
- Test: `tests/maintenance/geocode.test.ts` (create)

**Interfaces:**
- Produces: `hasGeocodeKey(): boolean` (`Boolean(process.env.GEOCODE_EARTH_API_KEY)`); `geocodeAddress(address: string): Promise<{ lon: number; lat: number } | null>` — never throws, `AbortSignal.timeout(10_000)` inside the try, returns null on no-key/HTTP error/empty results/invalid shape; `GEOCODE_TIMEOUT_MS = 10_000`; `buildGeocodeUrl(address: string): string` (exported for tests).

- [ ] **Step 1: Failing tests** (pure — URL construction + response parsing via an injected fetch; zero network):

```typescript
describe('buildGeocodeUrl', () => {
  it('targets /v1/search with the address text, size=1, and the api key', () => {});
});
describe('geocodeAddress', () => {
  it('parses [lon, lat] from the first GeoJSON feature', () => {});
  it('returns null on empty features, non-200, thrown fetch, and missing key — never throws', () => {});
});
```

- [ ] **Step 2: RED → implement** (write exactly):

```typescript
// src/maintenance/geocode.ts
// Tier-1 of the venue-resolution waterfall: forward-geocode a venue's address so the
// registry matcher gains a distance signal. Results are TRANSIENT by design — matching
// evidence only, never persisted (geocode.earth results are open data and storable,
// but we deliberately keep venue columns annotation-only).
import { z } from 'zod';

export const GEOCODE_TIMEOUT_MS = 10_000;
const GEOCODE_ENDPOINT = 'https://api.geocode.earth/v1/search';

const geocodeResponseSchema = z.object({
  features: z.array(z.object({
    geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  })),
});

export function hasGeocodeKey(): boolean {
  return Boolean(process.env.GEOCODE_EARTH_API_KEY);
}

export function buildGeocodeUrl(address: string): string {
  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set('api_key', process.env.GEOCODE_EARTH_API_KEY ?? '');
  url.searchParams.set('text', address);
  url.searchParams.set('size', '1');
  return url.toString();
}

/** Never throws: no key, HTTP error, timeout, or malformed response all yield null. */
export async function geocodeAddress(
  address: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ lon: number; lat: number } | null> {
  if (!hasGeocodeKey()) return null;
  try {
    const response = await fetchFn(buildGeocodeUrl(address), {
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = geocodeResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.features.length === 0) return null;
    const [lon, lat] = parsed.data.features[0].geometry.coordinates;
    return { lon, lat };
  } catch {
    return null;
  }
}
```

`.env.example` append (do not touch existing lines):

```
# geocode.earth (venue-resolution tier 1; free tier — sweep no-ops without it)
GEOCODE_EARTH_API_KEY=
```

`registry-resolve.ts` default wiring: `const geocodeFn = opts.geocodeFn ?? (hasGeocodeKey() ? geocodeAddress : null);`

- [ ] **Step 3: GREEN + typecheck + commit**

```bash
git add src/maintenance/geocode.ts src/maintenance/registry-resolve.ts .env.example tests/maintenance/geocode.test.ts
git commit -m "feat: geocode.earth tier-1 client — transient coords for registry matching"
```

### Task 6: Weekly schedule + CLI + candidate-query upgrades

**Files:**
- Modify: `src/trigger/maintenance.ts` (new schedule), `src/maintenance/venue-proposals.ts` (candidate query exclusions + address-match candidates), `package.json` (`"registry:resolve": "tsx src/maintenance/run-registry-resolve.ts"`)
- Create: `src/maintenance/run-registry-resolve.ts` (CLI)
- Test: `tests/maintenance/venue-proposals.test.ts` (extend), `tests/maintenance/registry-resolve.test.ts` (extend: no-key tier skip)

**Interfaces:**
- Consumes: Task 4's `resolveVenues`/`DEFAULT_RESOLUTION_LIMIT`; existing `findVenuePairCandidates` (venue-proposals.ts:117-135) and `proposeVenueMerges` (:235-276).
- Produces: schedule `venue-resolution-weekly`; `findAddressMatchCandidates(db, limit): Promise<CandidatePair[]>` (exported); `proposeVenueMerges` now judges the UNION of trigram + address-match candidates (deduped by pair, combined cap unchanged at the existing limit).

- [ ] **Step 1: Candidate query changes** in `findVenuePairCandidates` — add two exclusions to the existing WHERE (keep everything else byte-identical):

```sql
      AND NOT (a.registry_id IS NOT NULL AND b.registry_id IS NOT NULL
               AND a.registry_id <> b.registry_id)
      AND NOT EXISTS (
        SELECT 1 FROM venue_aliases al
        WHERE al.normalized_name = a.normalized_name
           OR al.normalized_name = b.normalized_name
      )
```

(The first: the registry says different real places — don't spend a haiku call. The second closes the Slice-6 recorded Decision-4 deviation: alias-covered names are already-resolved variants.)

New `findAddressMatchCandidates` — same shape/exclusions as the trigram query, but candidates are pairs whose OWN addresses share street number + first street-name token, with NO similarity floor (this catches "Shank Hall" vs "Shank Hall - 1434 N Farwell Ave Milwaukee" at 0.282). Implement with a ≤20-line SQL using `split_part(a.address, ' ', 1)` for the number and `lower(split_part(a.address, ' ', 3))` guarded by regex `a.address ~ '^[0-9]+ '` on both sides; also apply BOTH exclusions above plus the existing suggested-pair NOT EXISTS; `similarity` column still reported (computed, may be below 0.45); ORDER BY similarity DESC LIMIT.

`proposeVenueMerges`: fetch both lists, dedupe by `(min(id),max(id))` pair key (address-match wins are a superset risk — plain `Set` on joined ids), slice to the existing limit, judge as before. Suggestions written by this path keep `source: 'llm'` but registry-blind pairs that came from the address source get `evidence: { tier: 'address-pair' }` — thread a per-candidate `evidence` value through `writeSuggestion` (extend its signature with an optional `evidence` param defaulting to null; the existing call sites pass nothing).

- [ ] **Step 2: New schedule** in `src/trigger/maintenance.ts` (copy the `venueProposalsWeekly` idiom exactly; verify current line anchors — it sits near :281):

```typescript
/** Weekly venue-registry resolution (annotate-only + registry-evidence proposals; geocode tier no-ops without its key). Runs 30 min before venue-proposals-weekly so fresh annotations inform its exclusions. Worst case: 25 geocode calls × 10s = 250s, under half the 600s budget. */
export const venueResolutionWeekly = schedules.task({
  id: 'venue-resolution-weekly',
  cron: { pattern: '30 8 * * 1', timezone: 'America/Chicago' },
  run: async () => resolveVenues(db, { limit: CRON_RESOLUTION_LIMIT }),
});
```

with `const CRON_RESOLUTION_LIMIT = 50;` beside `CRON_PROPOSAL_LIMIT` (near :259). CLI `run-registry-resolve.ts` mirrors `run-venue-proposals.ts` (dotenv, guarded main, module default limit).

- [ ] **Step 3: Failing tests → RED → implement → GREEN**:

```typescript
  it('trigram candidates exclude pairs with different registry ids', () => {});
  it('trigram candidates exclude alias-covered names (either side)', () => {});
  it('address-match candidates surface a below-band dash-variant pair (Shank Hall shape)', () => {});
  it('combined candidate list dedupes pairs and respects the limit', () => {});
  it('address-pair suggestions carry evidence tier address-pair; trigram ones keep evidence null', () => {});
```

`npx vitest run tests/maintenance/` ALL green; one full `npx vitest run` (per-file re-runs arbitrate PGlite flakes); typecheck.
- [ ] **Step 4: Commit**

```bash
git add src/trigger/maintenance.ts src/maintenance/venue-proposals.ts src/maintenance/run-registry-resolve.ts package.json tests/maintenance/venue-proposals.test.ts tests/maintenance/registry-resolve.test.ts
git commit -m "feat: weekly venue-resolution schedule + registry/alias-aware candidate queries"
```

### Task 7: Admin surface — provenance on proposal cards

**Files:**
- Modify: `src/queries/admin-venues.ts` (`pendingVenueSuggestions` gains `source`, `evidence`), `src/components/admin/venue-proposal-card.tsx` (badge + evidence line)
- Test: `tests/queries/admin-venues.test.ts` (extend, 1 case)

**Interfaces:**
- Consumes: Task 1 columns; existing `VenueSuggestionRow`.
- Produces: `VenueSuggestionRow` gains `source: 'llm' | 'registry'` and `registryName: string | null` (from `evidence.registryName` when present, else null — extract in the query layer so the component stays dumb).

- [ ] **Step 1: Failing test** — extend the pending-suggestions query test: a `source: 'registry'` row with evidence surfaces `source` and `registryName`; an LLM row surfaces `source: 'llm'`, `registryName: null`.
- [ ] **Step 2: RED → implement.** Card: `<Badge variant="secondary">{source === 'registry' ? 'Registry match' : 'AI proposal'}</Badge>` beside the confidence %, and when `registryName` is non-null one muted line: `Registry entity: {registryName}`. Keep the card ≤70 lines total — if the additions push past, move the badge+line into a ≤15-line `ProposalProvenance` component in the same file.
- [ ] **Step 3: GREEN + typecheck + build + commit**

```bash
git add src/queries/admin-venues.ts src/components/admin/venue-proposal-card.tsx tests/queries/admin-venues.test.ts
git commit -m "feat: proposal provenance — registry vs AI badges on venue cards"
```

### Task 8: README, gates, ship checklist

**Files:**
- Modify: `README.md` (venue-registry subsection extending the AI/venues sections + Commands rows + data-sources note)

- [ ] **Step 1: README** — the registry (what/why, Overture + GERS ids, licenses: CDLA-Permissive-2.0 with per-place Apache-2.0 rows; internal-use-only note), the waterfall tiers (registry → geocode.earth transient coords → LLM pair judge → human gate ALWAYS), annotate-only + propose-only contracts, the one-shot `registry_matched_at` gate, manual refresh story, Commands rows (`registry:import`, `registry:resolve`), and the honest limits (DIY spaces won't resolve; a street address can hold multiple POIs so address equality never auto-annotates). Claims source-traced (reviewer audits).
- [ ] **Step 2: Full gates, quiet machine** — `npm run test`, `npm run typecheck`, `npm run build`, `npm run e2e`.
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: venue registry + waterfall resolution"
```

- [ ] **Step 4: Ship checklist (finishing pass — do NOT execute in-task)**

1. Merge → main, push. 2. `npm run db:migrate` (0019; verify by read). 3. Local: `duckdb -init /dev/null -batch < scripts/venue-registry-slice.sql` then `npm run registry:import /tmp/overture-mke.jsonl` — expect ~92k rows; verify count by SQL. 4. `vercel deploy --prod`. 5. **`npm run trigger:deploy` MANDATORY (pinned 4.5.1; verify 8 tasks register — new weekly schedule).** 6. Live `npm run registry:resolve` — record annotated/unmatched/suggested; **expect the Shank Hall dash-variant pair to finally surface** (via registry-id or address-pair path) and the address-string rows to start resolving. Spot-read 5 annotations + all new suggestions by SQL. 7. Tarik applies ≥1 registry-sourced proposal in `/admin/venues`. 8. Evidence comment (honest counts incl. wrong predictions) + close the slice issue (create it at execution start if not yet filed).

## Verification summary

- Venue identity grounded in a real-world registry with stable GERS ids; duplicates resolve by shared entity, not string luck (Tasks 1–4).
- The waterfall degrades gracefully: no geocode key → tier 0 only; no gateway key → no LLM judgments; registry missing → sweeps no-op on empty candidates. Nothing blocks ingest or the site.
- ANNOTATE-ONLY and PROPOSE-ONLY both regression-tested byte-level (Task 4), provenance visible to the human (Task 7), future auto-merge decidable from the `source='registry'` apply record (Decision 8).
- Closes two recorded S6 items: the Decision-4 `venue_aliases` exclusion deviation and the trigram long-suffix blind spot (address-match candidates).

## Open rulings for Tarik (ask at plan review)

1. **Sequencing:** homepage LCP (perf-71) was ruled next after Slice 6 — does this registry slice jump the queue or wait?
2. **geocode.earth signup:** free-tier key (25k req/mo, no card needed per their site) → `GEOCODE_EARTH_API_KEY` in local `.env` + Trigger prod env. Without it the slice still ships (tier 0 covers most of the value); tier 1 activates whenever the key lands.
3. **Google tier (place_id-only) for the residue:** recommended DEFER — the residue is mostly DIY spaces Google won't have either.
4. **Auto-merge for the registry-id class:** recommended DEFER until the `source='registry'` apply record accumulates (same evidence bar as the judge's promotion condition (b)). Nothing in this slice auto-merges.
