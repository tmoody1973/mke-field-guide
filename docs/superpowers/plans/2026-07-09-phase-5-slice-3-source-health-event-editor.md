# Phase 5 Slice 3: Source Health Dashboard + Event Editor + Low-Confidence Review + Riders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close MOO-258's two remaining ACs — (1) a source health dashboard (per-source status, last fetch, published/skipped counts, deep link to the Trigger.dev run detail) and (2) an event editor (correct title/time/venue/status/category on canonical events, writes provenance, edits survive re-ingestion) — plus the spec-§7 low-confidence events review surface and the eight riders triaged to this slice (stuck-'approved' sweep surface, prune batching, tie-break tests, breakdown display cast, playwright worker pinning, allowlist domain-shape lint, `Db` alias consolidation).

**Architecture:** One additive migration (0015) carries everything: `sources.last_run_id` (threaded from the Trigger task so the dashboard can deep-link `https://cloud.trigger.dev/projects/v3/{ref}/runs/{runId}` — format live-verified during planning), `events.locked_fields text[]` (the durability mechanism: an admin edit locks that field; `updateEventRow` filters locked columns out of the re-ingest clobber set, and a `time` lock makes ingestion skip instance upsert/supersede for that event), and `event_edits` (the provenance table: who/field/old→new/when, FK-cascade per the codebase's cascade-is-the-contract precedent). The dashboard is read-only over columns `src/ingestion/ingest.ts` already writes on every run (verified live: three prod sources are `failing` right now with real `last_error` values). The editor spans two tables — **times live on `event_instances`, not `events`** — and reuses the Slice 1/2 admin idiom verbatim: `requireStaff('admin')` pages, pure-fn + `'use server'` two-file actions, `useActionState` envelopes, `revalidatePath` lists. "Low-confidence" is a composed query concept (canonical source adapter `html`/`firecrawl`, or never-enriched `category IS NULL`), not a stored column. The stuck-'approved' surface exploits a structural fact: a completed merge cascade-deletes its review row, so ANY surviving `status='approved'` row is stuck by definition — one query, one CAS return-to-queue action.

**Tech Stack:** unchanged (Next 16.2.10 / Drizzle 0.45.2 on Neon HTTP / Zod 4 / vendored RetroUI / Vitest 4 + PGlite / Playwright / Trigger.dev v4, CLI pinned 4.5.1).

## Global Constraints

Every task's requirements implicitly include all of these (Slice 1/2 constraints carry forward; additions in bold):

- **NO PRODUCTION WRITES during implementation.** The ONLY sanctioned prod writes are in the ship checklist (Task 10): `npm run db:migrate` (migration 0015, additive DDL) and `vercel env add TRIGGER_PROJECT_REF`. Live prod reads remain the norm.
- **`git add` scoped paths only; `git add -A` forbidden. `.env`/`.env.example` append-only.**
- **Dual-deploy rule — THIS SLICE TRIPS IT:** Tasks 2 and 4 edit `src/ingestion/ingest.ts`, `src/ingestion/persist.ts`, and `src/trigger/ingest.ts` — ALL Trigger-task-reachable. The ship checklist MUST run `npm run trigger:deploy` (pinned CLI 4.5.1 — `@latest` hard-aborts on SDK mismatch) in addition to `vercel deploy --prod`.
- **`src/ingestion/persist.ts` edits are sanctioned ONLY as specified in Task 4** (locked-fields filtering). The `eventFields` exclusion contract (enrichment-owned columns NEVER in ingestion writes), `maintainLink`'s isCanonical guard, the create-path compensation delete, and `createOrAdoptEvent`'s race recovery are all load-bearing — extend, don't restructure.
- **Frozen as ever:** `src/search/hybrid.ts` (zero edits), trigger-maintained `search_tsv` (an events UPDATE auto-refreshes it — the editor needs NO manual FTS handling), jsonld fallback-id format, day-instance pattern, ≥0.80 auto-merge semantics + thresholds + weights, `pickCanonical` on the auto path, `VENUE_OWNED_SOURCE_KEYS` code-owned.
- **`tests/dedup/same-show.test.ts` is a frozen behavioral contract — no task may edit it.** Its cascade assertions are what make the stuck-'approved' detection sound.
- ANY date logic through `src/lib/chicago-time.ts` / `src/lib/display.ts` (`chicagoDateLabel`/`chicagoWeekMonday` live in display.ts). The UTC-vs-Chicago bug family has shipped 4 generations of bugs — datetime-local form values are wall-clock Chicago and MUST be converted explicitly.
- `'use server'` files export ONLY async functions; types live in plain modules (two-file split per `admin-reviews.ts`/`admin-reviews-actions.ts`).
- Next 16: `params`/`searchParams` are Promises; middleware file is `src/proxy.ts` (do not touch); verify uncertain APIs against `node_modules/next/dist/docs/` (repo AGENTS.md mandate).
- Zod 4 idioms (`z.uuid()`, `z.email()`, `z.iso.date()`, `z.iso.datetime()` top-level). Zod at every boundary; envelope returns `{ ok, message }`; DB failures caught + `console.error` + generic message.
- Admin surfaces in this slice are **admin-tier**: pages `await requireStaff('admin')` first statement; actions check `currentStaffRole()` AND `role === 'admin'` via the `isAdmin()` idiom (picks-tier DJs must NOT reach source health, the editor, or stuck-review tooling).
- Tests on PGlite only (`tests/helpers/test-db.ts` replays `drizzle/*.sql` name-sorted — migration 0015 is picked up automatically; keep it pure DDL). vitest `maxWorkers: 2` / `hookTimeout: 45_000`; full-suite verification on a quiet machine; per-file runs are the trustworthy arbiter.
- Neon HTTP: no transactions — multi-statement mutations must be recovery-ordered (write the durable/idempotent thing last; a re-run must converge).
- Logic functions ≤ 20 lines; files ≤ ~300 lines; match repo idiom; comments only for constraints code can't show.
- Implementers: **scrutinize this plan's code, don't transcribe blindly** — re-verify anchors in the actual files; 17+ plan-authored defects have been caught by reviewers across Phases 4–5.

**Commands:** `npm run test` / `npm run typecheck` / `npm run build` / `npx vitest run <file>` / `npm run e2e` / `npm run db:generate` / (ship only) `npm run db:migrate`, `npm run trigger:deploy`.

## Prerequisites & live findings (surface, don't block)

1. **⚠️ LIVE PROD INCIDENT (found during planning recon, 2026-07-09):** `ticketmaster-milwaukee` (439 published events), `eventbrite-cooperage`, and `county-parks` are `health_status='failing'` with `consecutive_failures=3` — `TICKETMASTER_API_KEY`, `EVENTBRITE_PRIVATE_TOKEN`, and `FIRECRAWL_API_KEY` were never synced into the Trigger.dev **prod** environment (only `DATABASE_URL` + `AI_GATEWAY_API_KEY` were). Last successful fetches: July 7. Every daily 6:00 cron since has failed those three. **Tarik-owned fix: add the three vars in the Trigger.dev dashboard (project `mke-events`, prod env), values from local `.env`.** Note backoff: at 3 consecutive failures `filterDueSources` starts skipping the source (24h→7d exponential) — after the vars land, either wait a cycle or manually trigger `ingest-source` per source key from the Trigger dashboard.
2. **That incident IS the dashboard's verification evidence.** MOO-258's "break a source URL → dashboard shows failing within one scheduled cycle" is satisfiable without breaking anything: screenshot the dashboard showing the three real failures (+ `last_error` text), then screenshot recovery after the env fix. Ship checklist step 7 sequences this.
3. Authed-e2e remains DEFERRED (Tarik ruling 2026-07-09, Slice 2) — signed-in editor/dashboard walks are Tarik's screenshots, which MOO-258's checklist wants anyway.
4. Neighborhood editorial long-tail (venue-grain `neighborhood` editing): **DEFERRED out of this slice** pending Tarik's call — MOO-258 has no venue-editor AC, and this slice should close the issue. See open ruling #4 below.

## Decisions (made in planning; flagged ones await Tarik)

1. **Durability = `events.locked_fields text[]`, auto-locked on edit (AWAITS TARIK — recommendation: yes).** Recon fact: a canonical-source re-ingest clobbers all 8 `eventFields` columns (`persist.ts:102-112`) and `upsertInstance`/`supersedeOtherInstances` rebuild instances — without a lock, every editor write is undone by the next 6:00 cron, making the AC a lie. Mechanism: editing title/status/venue locks that field; editing any instance time locks `'time'`. `updateEventRow` drops locked columns from its `.set()`; a `'time'` lock skips `upsertInstance` + `supersedeOtherInstances` for that event. Locks are visible in the editor with per-field "unlock" (unlock = source values flow again next ingest). Lock vocabulary: `['title','status','venue','time']`. `category` needs NO lock — ingestion never writes it and the enrichment tag sweep only selects `category IS NULL AND vibe_tags IS NULL` rows (`src/enrichment/sweep.ts:57-70`), so a non-null category is already durable. (Honest caveat surfaced in UI copy: clearing category AND vibe tags returns the event to tag-sweep candidacy.)
2. **Provenance = new `event_edits` audit table (AWAITS TARIK — recommendation: FK-cascade).** Grain: one row per changed field per save — `event_id` (FK cascade), `edited_by` (staff email from `currentStaffRole()`), `field`, `old_value`, `new_value` (text, nullable), `created_at`. `event_source_links` is the wrong home (per-source grain, no actor/old-value, rows move on merge). Cascade rationale: if an edited event is later merge-deleted as a duplicate, the merge's `event_clusters` receipt is the durable record — same contract as `event_reviews`. Unlock actions also write a row (`old_value:'locked'`, `new_value:'unlocked'`) so the trail is complete.
3. **Run-detail link = `sources.last_run_id` + `TRIGGER_PROJECT_REF` env.** `ingestSource` gains an optional trailing `runId?: string`, written by BOTH `reportOutcome` and `markFailed` (a failing run is exactly the one you want to open); `ingest-source` passes its run id from the task context. URL format verified live: `https://cloud.trigger.dev/projects/v3/${TRIGGER_PROJECT_REF}/runs/${lastRunId}`. Project ref (`proj_huidipgowadfhdfioztw`) ships as env (not code — it's deploy config), appended to `.env`/`.env.example` and added to Vercel at ship. No ref or no run id → the link cell renders a plain "—" (CLI/manual ingests have no run id; that's correct, not a bug).
4. **Low-confidence = composed filter on the new `/admin/events` list, not a stored score.** Definition (from spec §7/§8 + the PRD confidence ladder in `src/dedup/confidence.ts:1-2`): canonical source link's `adapter_type ∈ {html, firecrawl}` (rank ≤ 2) OR `category IS NULL` (never enriched). Surfaced as a filter tab; each row shows its signals (canonical adapter badge, untagged badge). This satisfies "low-confidence events review" as the browsable feeder into the editor, without inventing a scoring system the spec never asked for.
5. **Stuck-'approved' remedy = return-to-queue, not retry-merge.** A stuck row (crash between CAS claim and merge, `sweep.ts:170-174` accepted tradeoff) still has BOTH events alive — a completed merge would have cascade-deleted the row. The claim recorded no survivor choice, so silent retry is impossible; instead: banner on `/admin/review` listing `status='approved'` rows older than 15 minutes, with a "Return to queue" action (`UPDATE ... SET status='pending', resolved_at=NULL WHERE id=? AND status='approved'` — CAS, idempotent) so the admin re-decides with the survivor picker. A partially-crashed merge re-run converges: `mergeEvents`' steps are re-pointing UPDATEs + deletes, all idempotent.
6. **Editor scope = the AC fields exactly:** title, per-instance start/end times, venue (picker over existing venues), status (`scheduled|cancelled|postponed`, event-level — instance statuses stay source-fed), category (closed vocab from `src/enrichment/tag.ts`, or none). NOT in scope: slug (URL identity — never edited), description/imageUrl/summary (no AC, YAGNI), creating events or instances (aggregation site — sources create), deleting events (dedup merge is the removal path).
7. **Title edits recompute `normalized_title`** (`normalizeName`) so dedup candidate scoring and admin search stay coherent; slug intentionally unchanged. `search_tsv` refresh is automatic (BEFORE UPDATE trigger, `drizzle/0011`).
8. **Instance time edits guard the unique `(event_id, start_at)` index:** a 23505 on the moved start returns envelope "Another date of this event already starts at that time." — not a crash.
9. **`Db` alias consolidation = new canonical home `src/db/types.ts`, old sites re-export.** Both existing definitions are byte-identical; `persist.ts:9` and `card-data.ts:7` become `export type { Db } from '@/db/types'` so all ~17 importers compile unchanged; new Slice 3 code imports from `@/db/types`.
10. **Riders bundled, not scattered:** prune batching (bounded subquery-LIMIT delete), playwright `workers: process.env.CI ? 1 : 2`, allowlist domain-shape lint (warn + drop malformed entries — fail closed), breakdown display cast → zod safeParse (skip + log corrupt rows, matching the raced-away-pair tolerance), tie-break tests (equal-total sort tie-break; `pickCanonical` equal-createdAt boundary). Each rider's fix is small; one task, one reviewer.

## Open rulings for Tarik (asked at plan review — plan proceeds on recommendations if unaddressed)

1. Execution mode (subagent-driven recommended, as Slices 1–2).
2. Decision 1 mechanism (`locked_fields` auto-lock on edit) — approve or redirect.
3. Decision 2 provenance cascade (audit dies with a merge-deleted event) — approve or ask for survive-merge semantics.
4. Neighborhood editorial long-tail: defer (recommended) or fold a minimal venue-neighborhood editor into this slice.

---

### Task 1: Migration 0015 — `last_run_id`, `locked_fields`, `event_edits`

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0015_*.sql` (via `npm run db:generate` — do NOT hand-write; commit the `drizzle/meta` journal updates it produces)
- Test: `tests/db/event-edits.test.ts` (create)

**Interfaces:**
- Consumes: existing `sources`/`events` tables, `pgTable` idioms in `src/db/schema.ts`.
- Produces: `schema.sources.lastRunId: text | null`; `schema.events.lockedFields: string[]` (NOT NULL default `[]`); `schema.eventEdits` table + `eventEditsRelations`; type `EventEditRow = typeof schema.eventEdits.$inferSelect`. Tasks 2, 4, 5, 7 rely on these exact names.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/event-edits.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('migration 0015 surfaces', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('events.lockedFields defaults to an empty array', async () => {
    const [event] = await db
      .insert(schema.events)
      .values({ slug: 'lock-default', title: 'Lock Default', normalizedTitle: 'lock default' })
      .returning();
    expect(event.lockedFields).toEqual([]);
  });

  it('sources.lastRunId is writable and nullable', async () => {
    const [source] = await db
      .insert(schema.sources)
      .values({ key: 'run-id-src', name: 'Run Id', url: 'https://x.test', adapterType: 'ical', config: {} })
      .returning();
    expect(source.lastRunId).toBeNull();
    await db.update(schema.sources).set({ lastRunId: 'run_abc123' }).where(eq(schema.sources.id, source.id));
    const updated = await db.query.sources.findFirst({ where: eq(schema.sources.id, source.id) });
    expect(updated?.lastRunId).toBe('run_abc123');
  });

  it('event_edits rows cascade away with their event', async () => {
    const [event] = await db
      .insert(schema.events)
      .values({ slug: 'edit-cascade', title: 'Edit Cascade', normalizedTitle: 'edit cascade' })
      .returning();
    await db.insert(schema.eventEdits).values({
      eventId: event.id,
      editedBy: 'tarik@radiomilwaukee.org',
      field: 'title',
      oldValue: 'Old',
      newValue: 'New',
    });
    await db.delete(schema.events).where(eq(schema.events.id, event.id));
    const orphans = await db.query.eventEdits.findMany({ where: eq(schema.eventEdits.eventId, event.id) });
    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run tests/db/event-edits.test.ts`
Expected: FAIL — `lockedFields`/`lastRunId`/`eventEdits` do not exist on the schema module.

- [ ] **Step 3: Add the schema**

In `src/db/schema.ts` — inside `sources` (after `lastSkippedCount`, `:35`):

```typescript
  // Trigger.dev run id of the most recent ingest attempt (success OR failure) —
  // the admin dashboard deep-links to the run detail. Null for CLI/manual ingests.
  lastRunId: text('last_run_id'),
```

Inside `events` (after `audienceTags`, `:116`):

```typescript
  // Admin-locked fields ('title'|'status'|'venue'|'time'): ingestion must not
  // overwrite these — see updateEventRow/persistNormalizedEvent in ingestion/persist.ts.
  lockedFields: text('locked_fields').array().notNull().default([]),
```

New table + relations (after `eventReviews`, before `staffPicks`):

```typescript
// Provenance for manual admin edits (MOO-258 "writes provenance"). One row per
// changed field per save. Cascade: if the event is later merge-deleted as a
// duplicate, the event_clusters receipt is the durable record — same contract
// as event_reviews.
export const eventEdits = pgTable(
  'event_edits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    editedBy: text('edited_by').notNull(),
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('event_edits_event_idx').on(t.eventId, t.createdAt)],
);

export const eventEditsRelations = relations(eventEdits, ({ one }) => ({
  event: one(events, { fields: [eventEdits.eventId], references: [events.id] }),
}));
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate` — inspect the emitted `drizzle/0015_*.sql`: exactly two `ALTER TABLE ... ADD COLUMN` statements, one `CREATE TABLE "event_edits"`, one `CREATE INDEX`, one FK. Pure DDL, no data rewrites. Do NOT run `db:migrate` (ship step).

- [ ] **Step 5: Run test — verify it passes**

Run: `npx vitest run tests/db/event-edits.test.ts` — Expected: PASS (test-db replays 0015 automatically).

- [ ] **Step 6: Typecheck + commit**

`npm run typecheck` → clean.

```bash
git add src/db/schema.ts drizzle tests/db/event-edits.test.ts
git commit -m "feat: migration 0015 — sources.last_run_id, events.locked_fields, event_edits provenance table"
```

### Task 2: Thread the Trigger run id into source health writes

**Files:**
- Modify: `src/ingestion/ingest.ts` (`reportOutcome`, `markFailed`, `ingestSource`), `src/trigger/ingest.ts` (`ingestSourceTask`)
- Test: `tests/ingestion/ingest-run-id.test.ts` (create)

**Interfaces:**
- Consumes: `schema.sources.lastRunId` (Task 1).
- Produces: `ingestSource(db, source, adapter, runId?: string): Promise<IngestResult>` — fourth param optional; ALL existing callers compile unchanged. Task 3's dashboard reads `sources.lastRunId`.

Trigger-task-reachable — this task trips the dual-deploy rule (ship checklist).

- [ ] **Step 1: Write the failing test**

Model setup on `tests/ingestion/` neighbors (they build a source row + a stub adapter; copy the local idiom — do not invent one). Two cases:

```typescript
// tests/ingestion/ingest-run-id.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { SourceAdapter } from '@/ingestion/adapters/types';
import { ingestSource } from '@/ingestion/ingest';
import { createTestDb } from '../helpers/test-db';

// Stub adapters: one that fetches zero records successfully, one that throws.
// (Verify SourceAdapter's fetch return shape against adapters/types.ts before trusting these.)
const emptyAdapter = {
  fetch: async () => ({ records: [], parseSkipped: 0 }),
  normalize: () => null,
} as unknown as SourceAdapter;
const throwingAdapter = {
  fetch: async () => {
    throw new Error('boom');
  },
  normalize: () => null,
} as unknown as SourceAdapter;

describe('ingestSource run-id threading', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  async function seedSource(key: string) {
    const [source] = await db
      .insert(schema.sources)
      .values({ key, name: key, url: 'https://x.test', adapterType: 'ical', config: {} })
      .returning();
    return source;
  }

  it('writes lastRunId on the success path', async () => {
    const source = await seedSource('runid-ok');
    await ingestSource(db, source, emptyAdapter, 'run_success1');
    const row = await db.query.sources.findFirst({ where: eq(schema.sources.id, source.id) });
    expect(row?.lastRunId).toBe('run_success1');
    expect(row?.healthStatus).toBe('ok');
  });

  it('writes lastRunId on the failure path (the run you want to open)', async () => {
    const source = await seedSource('runid-fail');
    await expect(ingestSource(db, source, throwingAdapter, 'run_fail1')).rejects.toThrow('boom');
    const row = await db.query.sources.findFirst({ where: eq(schema.sources.id, source.id) });
    expect(row?.lastRunId).toBe('run_fail1');
    expect(row?.healthStatus).toBe('failing');
    expect(row?.lastError).toContain('boom');
  });

  it('leaves lastRunId untouched when no runId is given (CLI ingest)', async () => {
    const source = await seedSource('runid-none');
    await db.update(schema.sources).set({ lastRunId: 'run_prior' }).where(eq(schema.sources.id, source.id));
    await ingestSource(db, source, emptyAdapter);
    const row = await db.query.sources.findFirst({ where: eq(schema.sources.id, source.id) });
    expect(row?.lastRunId).toBe('run_prior'); // stale-but-honest beats null
  });
});
```

- [ ] **Step 2: Run it — verify it fails** (`npx vitest run tests/ingestion/ingest-run-id.test.ts` → FAIL: ingestSource takes 3 args / lastRunId never written)

- [ ] **Step 3: Implement**

`src/ingestion/ingest.ts` — thread `runId` through both writers (spread-conditional, same pattern the file already uses for `lastFetchAt`):

```typescript
async function reportOutcome(db: Db, sourceId: string, result: IngestResult, runId?: string): Promise<void> {
  const allSkipped = result.fetched > 0 && result.published === 0;
  await db
    .update(schema.sources)
    .set({
      healthStatus: allSkipped ? 'failing' : 'ok',
      lastError: allSkipped ? 'all records skipped normalization' : null,
      lastAttemptAt: new Date(),
      lastFetchedCount: result.fetched,
      lastPublishedCount: result.published,
      lastSkippedCount: result.skipped,
      consecutiveFailures: allSkipped ? sql`${schema.sources.consecutiveFailures} + 1` : 0,
      updatedAt: new Date(),
      ...(allSkipped ? {} : { lastFetchAt: new Date() }),
      ...(runId ? { lastRunId: runId } : {}),
    })
    .where(eq(schema.sources.id, sourceId));
}

async function markFailed(db: Db, sourceId: string, err: unknown, runId?: string): Promise<void> {
  await db
    .update(schema.sources)
    .set({
      healthStatus: 'failing',
      lastError: String(err),
      lastAttemptAt: new Date(),
      consecutiveFailures: sql`${schema.sources.consecutiveFailures} + 1`,
      updatedAt: new Date(),
      ...(runId ? { lastRunId: runId } : {}),
    })
    .where(eq(schema.sources.id, sourceId));
}

export async function ingestSource(
  db: Db,
  source: SourceRow,
  adapter: SourceAdapter,
  runId?: string,
): Promise<IngestResult> {
  try {
    const { records, parseSkipped } = await adapter.fetch(source.config);
    const result = await processRecords(db, source, adapter, records);
    result.skipped += parseSkipped;
    await reportOutcome(db, source.id, result, runId);
    return result;
  } catch (err) {
    try {
      await markFailed(db, source.id, err, runId);
    } catch (updateErr) {
      console.error('Failed to mark source as failing:', updateErr);
    }
    throw err;
  }
}
```

`src/trigger/ingest.ts` — pass the run id from the task context. **VERIFY FIRST against the installed SDK** (`node_modules/@trigger.dev/sdk` types or `mcp__trigger__search_docs`): in v4 the run fn's second arg exposes the context — expected shape `run: async ({ sourceKey }, { ctx }) => ... ctx.run.id`. If the installed 4.5.1 types differ, follow the types and say so in your report.

```typescript
  run: async ({ sourceKey }, { ctx }) => {
    const source = await db.query.sources.findFirst({
      where: eq(schema.sources.key, sourceKey),
    });
    if (!source) throw new AbortTaskRunError(`Unknown source key: ${sourceKey}`);
    const adapter = resolveAdapter(source);
    return ingestSource(db, source, adapter, ctx.run.id);
  },
```

- [ ] **Step 4: GREEN + neighbors** — `npx vitest run tests/ingestion/` → all green (existing ingest tests must pass unchanged — the param is optional).

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/ingestion/ingest.ts src/trigger/ingest.ts tests/ingestion/ingest-run-id.test.ts
git commit -m "feat: thread Trigger run id into source health writes (success and failure paths)"
```

### Task 3: Source health query + `/admin/sources` dashboard

**Files:**
- Create: `src/queries/admin-sources.ts`, `src/app/admin/sources/page.tsx`
- Modify: `src/app/admin/page.tsx` (hub card), `.env.example` (append `TRIGGER_PROJECT_REF`)
- Test: `tests/queries/admin-sources.test.ts` (create)

**Interfaces:**
- Consumes: `schema.sources` incl. `lastRunId` (Tasks 1–2); `backoffHours` from `src/ingestion/backoff.ts` and `cadenceOf` from `src/ingestion/cadence.ts` — **verify both export names/signatures in the actual files before use** (recon cites `backoff.ts:17-22`, `cadence.ts:20-30`); `requireStaff` from `@/lib/staff-guard`; `chicagoDateLabel` from `@/lib/display`.
- Produces: `sourceHealthRows(db): Promise<SourceHealthRow[]>` and `triggerRunUrl(runId: string | null): string | null` — Task 10's README documents them.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/queries/admin-sources.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { sourceHealthRows } from '@/queries/admin-sources';
import { createTestDb } from '../helpers/test-db';

describe('sourceHealthRows', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
    await db.insert(schema.sources).values([
      {
        key: 'healthy-src', name: 'Healthy', url: 'https://a.test', adapterType: 'ical', config: {},
        healthStatus: 'ok', lastFetchAt: new Date('2026-07-09T11:00:00Z'), lastAttemptAt: new Date('2026-07-09T11:00:00Z'),
        lastFetchedCount: 30, lastPublishedCount: 30, lastSkippedCount: 0, lastRunId: 'run_ok1',
      },
      {
        key: 'broken-src', name: 'Broken', url: 'https://b.test', adapterType: 'api',
        config: { cadence: 'daily' }, healthStatus: 'failing', lastError: 'TICKETMASTER_API_KEY is not set',
        consecutiveFailures: 3, lastAttemptAt: new Date('2026-07-09T11:00:00Z'),
        lastFetchAt: new Date('2026-07-07T22:00:00Z'), lastRunId: 'run_fail1',
      },
      { key: 'virgin-src', name: 'Virgin', url: 'https://c.test', adapterType: 'html', config: {} },
    ]);
  });

  it('returns failing sources first, then unknown, then ok; alphabetical within group', async () => {
    const rows = await sourceHealthRows(db);
    expect(rows.map((r) => r.key)).toEqual(['broken-src', 'virgin-src', 'healthy-src']);
  });

  it('computes the backoff window for a source at the failure threshold', async () => {
    const broken = (await sourceHealthRows(db)).find((r) => r.key === 'broken-src');
    // 3 consecutive failures = FAILURES_BEFORE_BACKOFF → a non-null future re-attempt bound.
    expect(broken?.inBackoffUntil).toBeInstanceOf(Date);
    expect(broken?.inBackoffUntil!.getTime()).toBeGreaterThan(new Date('2026-07-09T11:00:00Z').getTime());
  });

  it('carries the raw health fields the dashboard renders', async () => {
    const healthy = (await sourceHealthRows(db)).find((r) => r.key === 'healthy-src');
    expect(healthy).toMatchObject({
      healthStatus: 'ok', lastPublishedCount: 30, lastSkippedCount: 0, lastRunId: 'run_ok1', lastError: null,
    });
  });

  it('healthy and never-run sources have no backoff window', async () => {
    const rows = await sourceHealthRows(db);
    expect(rows.find((r) => r.key === 'healthy-src')?.inBackoffUntil).toBeNull();
    expect(rows.find((r) => r.key === 'virgin-src')?.inBackoffUntil).toBeNull();
  });
});
```

- [ ] **Step 2: RED run** (`npx vitest run tests/queries/admin-sources.test.ts` → module not found)

- [ ] **Step 3: Implement the query module**

```typescript
// src/queries/admin-sources.ts
import { asc, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { backoffHours, FAILURES_BEFORE_BACKOFF } from '@/ingestion/backoff';
import { cadenceOf } from '@/ingestion/cadence';
import type { Db } from '@/lib/card-data'; // Task 9 consolidates to @/db/types; until then this is the query-layer home

// NOTE: verify the exact exports of backoff.ts/cadence.ts before wiring — if
// FAILURES_BEFORE_BACKOFF is not exported, export it (one-line change, cite in report).

export interface SourceHealthRow {
  id: string;
  key: string;
  name: string;
  url: string;
  adapterType: string;
  cadence: string;
  healthStatus: 'ok' | 'failing' | 'unknown';
  lastFetchAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastFetchedCount: number | null;
  lastPublishedCount: number | null;
  lastSkippedCount: number | null;
  lastRunId: string | null;
  inBackoffUntil: Date | null;
}

function backoffUntil(consecutiveFailures: number, lastAttemptAt: Date | null): Date | null {
  if (consecutiveFailures < FAILURES_BEFORE_BACKOFF || !lastAttemptAt) return null;
  return new Date(lastAttemptAt.getTime() + backoffHours(consecutiveFailures) * 60 * 60_000);
}

const STATUS_ORDER = sql`CASE ${schema.sources.healthStatus} WHEN 'failing' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END`;

export async function sourceHealthRows(db: Db): Promise<SourceHealthRow[]> {
  const rows = await db.query.sources.findMany({
    orderBy: [asc(STATUS_ORDER), asc(schema.sources.key)],
  });
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    url: row.url,
    adapterType: row.adapterType,
    cadence: cadenceOf(row.config),
    healthStatus: row.healthStatus,
    lastFetchAt: row.lastFetchAt,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
    lastFetchedCount: row.lastFetchedCount,
    lastPublishedCount: row.lastPublishedCount,
    lastSkippedCount: row.lastSkippedCount,
    lastRunId: row.lastRunId,
    inBackoffUntil: backoffUntil(row.consecutiveFailures, row.lastAttemptAt),
  }));
}

/** Deep link to the Trigger.dev run detail — format live-verified 2026-07-09. */
export function triggerRunUrl(runId: string | null): string | null {
  const ref = process.env.TRIGGER_PROJECT_REF;
  if (!runId || !ref) return null;
  return `https://cloud.trigger.dev/projects/v3/${ref}/runs/${runId}`;
}
```

If drizzle's `findMany orderBy` rejects the raw `sql` CASE expression, fall back to fetching with `orderBy: [asc(schema.sources.key)]` and sorting the mapped array in TS (`failing < unknown < ok`, then key) — determinism is the requirement, not the mechanism; note the choice in your report.

- [ ] **Step 4: GREEN run** (`npx vitest run tests/queries/admin-sources.test.ts` → 4/4)

- [ ] **Step 5: The page**

```tsx
// src/app/admin/sources/page.tsx
import { db } from '@/db';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';
import { sourceHealthRows, triggerRunUrl, type SourceHealthRow } from '@/queries/admin-sources';

function statusVariant(status: SourceHealthRow['healthStatus']): 'default' | 'destructive' | 'secondary' {
  if (status === 'failing') return 'destructive';
  if (status === 'ok') return 'default';
  return 'secondary'; // 'unknown' = never ingested, not an error
}

function SourceCard({ row }: { row: SourceHealthRow }) {
  const runUrl = triggerRunUrl(row.lastRunId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {row.name}
          <Badge variant={statusVariant(row.healthStatus)}>{row.healthStatus}</Badge>
          <Badge variant="outline">{row.adapterType}</Badge>
          <Badge variant="outline">{row.cadence}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm text-ink-muted">
        <p>
          Last success: {row.lastFetchAt ? chicagoDateLabel(row.lastFetchAt) : 'never'} · Last attempt:{' '}
          {row.lastAttemptAt ? chicagoDateLabel(row.lastAttemptAt) : 'never'}
        </p>
        <p>
          Fetched {row.lastFetchedCount ?? '—'} · Published {row.lastPublishedCount ?? '—'} · Skipped{' '}
          {row.lastSkippedCount ?? '—'}
        </p>
        {row.healthStatus === 'failing' ? (
          <p className="text-rm-red">
            {row.consecutiveFailures} consecutive failure{row.consecutiveFailures === 1 ? '' : 's'}
            {row.inBackoffUntil ? ` · backing off until ${chicagoDateLabel(row.inBackoffUntil)}` : ''}
            {row.lastError ? ` — ${row.lastError}` : ''}
          </p>
        ) : null}
        <p>
          {runUrl ? (
            <a href={runUrl} target="_blank" rel="noreferrer" className="underline">
              Open last run in Trigger.dev
            </a>
          ) : (
            <span>Last run: —</span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function AdminSourcesPage() {
  await requireStaff('admin');
  const rows = await sourceHealthRows(db);
  const failing = rows.filter((row) => row.healthStatus === 'failing').length;
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">Source health</h1>
        <p className="mt-1 text-ink-muted">
          {rows.length} sources · {failing} failing. Failing sources back off exponentially after 3
          consecutive failures; job detail lives in Trigger.dev (no rebuilt observability).
        </p>
      </div>
      <ul className="grid gap-4">
        {rows.map((row) => (
          <li key={row.id}>
            <SourceCard row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Verify `Badge` supports `variant="destructive"` in the vendored RetroUI component (`src/components/ui/badge.tsx`) — if not, use the closest existing variant and note it.

- [ ] **Step 6: Hub card + env example**

`src/app/admin/page.tsx` — inside the existing `staff.role === 'admin'` block, ADD a second admin card (keep the review card; sharpen both descriptions):

```tsx
        {staff.role === 'admin' ? (
          <>
            <Link href="/admin/review" className="block">
              <Card>
                <CardHeader>
                  <CardTitle>Review queue</CardTitle>
                  <CardDescription>
                    Approve or reject flagged duplicate pairs with a survivor picker.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
            <Link href="/admin/sources" className="block">
              <Card>
                <CardHeader>
                  <CardTitle>Source health</CardTitle>
                  <CardDescription>
                    Per-source status, last fetch, counts, and Trigger.dev run links.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </>
        ) : null}
```

APPEND to `.env.example` (append-only file):

```bash
# Trigger.dev project ref for admin dashboard run-detail links (proj_...).
TRIGGER_PROJECT_REF=
```

- [ ] **Step 7: Typecheck + build + commit**

`npm run typecheck` && `npm run build` → clean.

```bash
git add src/queries/admin-sources.ts src/app/admin/sources/page.tsx src/app/admin/page.tsx .env.example tests/queries/admin-sources.test.ts
git commit -m "feat: admin source health dashboard with backoff windows and Trigger run links"
```

### Task 4: Locked-fields persist contract (ingestion respects admin edits)

The merge-path-adjacent task of this slice — **reviewer gets the adversarial framing** (attack scenarios: locked-title event re-ingested by canonical source; locked-time event whose source shifts its start; adopt-path race on a locked event; unlocked event behaves byte-identically to today).

**Files:**
- Modify: `src/ingestion/persist.ts` (`findLink`, `maintainLink`, `updateEventRow`, `persistNormalizedEvent`)
- Test: `tests/ingestion/locked-fields.test.ts` (create)

**Interfaces:**
- Consumes: `schema.events.lockedFields` (Task 1); existing `persistNormalizedEvent` seeding idiom from `tests/ingestion/persist.test.ts` (copy its helpers — do not invent).
- Produces: unchanged public signature `persistNormalizedEvent(db, source, n, opts)`. Internal: `findLink` now returns the link WITH `event: { lockedFields: string[] }`; `updateEventRow(db, eventId, n, venueId, locked: string[])`. Task 5 relies on the semantics: a field in `lockedFields` is never source-overwritten; `'time'` in `lockedFields` means ingestion leaves `event_instances` alone for that event.

- [ ] **Step 1: Write the failing test**

Copy the seeding helpers from `tests/ingestion/persist.test.ts` (source row builder + `NormalizedEvent` factory). Cases:

```typescript
// tests/ingestion/locked-fields.test.ts — skeleton; copy exact local helpers
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { createTestDb } from '../helpers/test-db';

describe('locked fields survive re-ingestion', () => {
  // beforeAll: createTestDb, seed one source, persist one normalized event
  // (title 'Source Title', startAt T1) => eventId

  it('a locked title is not overwritten; unlocked fields still update', async () => {
    // 1. lock: UPDATE events SET locked_fields = ['title'], title = 'Admin Title', normalized_title = 'admin title'
    // 2. re-persist the same normalized event with title 'Source Title v2' AND a new imageUrl
    // 3. assert title === 'Admin Title' (lock held) and imageUrl === new value (unlocked column updated)
  });

  it('a locked venue is not overwritten', async () => {
    // lock ['venue'] with venueId = null (admin cleared it); re-persist with venueName set;
    // assert events.venueId stays null while title (unlocked) updated
  });

  it("a 'time' lock freezes instances: no upsert, no supersede", async () => {
    // 1. persist event with startAt T1 (one instance)
    // 2. admin move: UPDATE event_instances SET start_at = T2; UPDATE events SET locked_fields = ['time']
    // 3. re-persist same event with startAt T1 and supersede: true
    // 4. assert exactly ONE instance remains, startAt === T2
    //    (without the lock, upsert would recreate T1 and supersede would delete T2)
  });

  it('an event with no locks behaves byte-identically to today', async () => {
    // re-persist with changed title/time; assert full overwrite + instance replacement
    // (this is the regression guard for the whole existing pipeline)
  });

  it('the adopt-path race respects locks', async () => {
    // use createOrAdoptEvent's exported race path (see persist.test.ts idiom):
    // event exists with locked title via another link; adopt re-persist must not clobber it
  });
});
```

Every skeleton comment must become real code; assert preconditions explicitly (e.g. the pre-lock title actually was source-written).

- [ ] **Step 2: RED run** (`npx vitest run tests/ingestion/locked-fields.test.ts` — the lock cases fail: locks don't exist yet)

- [ ] **Step 3: Implement in `src/ingestion/persist.ts`**

`findLink` gains the event's locks (relation `eventSourceLinksRelations.event` already exists):

```typescript
async function findLink(db: Db, source: SourceRef, sourceEventId: string) {
  return db.query.eventSourceLinks.findFirst({
    where: and(
      eq(schema.eventSourceLinks.sourceId, source.id),
      eq(schema.eventSourceLinks.sourceEventId, sourceEventId),
    ),
    with: { event: { columns: { lockedFields: true } } },
  });
}
```

Lock vocabulary → column mapping + filtered update (replaces `updateEventRow`):

```typescript
// Admin lock vocabulary → the eventFields columns each lock protects.
// 'time' is handled in persistNormalizedEvent (instances, not an events column).
const LOCK_COLUMNS: Record<string, (keyof ReturnType<typeof eventFields>)[]> = {
  title: ['title', 'normalizedTitle'],
  status: ['status'],
  venue: ['venueId'],
};

function unlockedEventFields(
  n: NormalizedEvent,
  venueId: string | null,
  locked: string[],
): Partial<ReturnType<typeof eventFields>> {
  const fields: Partial<ReturnType<typeof eventFields>> = { ...eventFields(n, venueId) };
  for (const lock of locked) for (const column of LOCK_COLUMNS[lock] ?? []) delete fields[column];
  return fields;
}

async function updateEventRow(
  db: Db,
  eventId: string,
  n: NormalizedEvent,
  venueId: string | null,
  locked: string[],
): Promise<void> {
  await db
    .update(schema.events)
    .set({ ...unlockedEventFields(n, venueId, locked), updatedAt: new Date() })
    .where(eq(schema.events.id, eventId));
}
```

`maintainLink` passes the locks it now carries:

```typescript
async function maintainLink(
  db: Db,
  link: { id: string; eventId: string; isCanonical: boolean; event: { lockedFields: string[] } },
  n: NormalizedEvent,
  venueId: string | null,
): Promise<void> {
  if (link.isCanonical) await updateEventRow(db, link.eventId, n, venueId, link.event.lockedFields);
  await touchLinkLastSeen(db, link.id);
}
```

`persistNormalizedEvent` guards instance maintenance (one cheap PK select; the create path is by definition unlocked but the adopt path may not be — fetch by outcome id, don't guess):

```typescript
async function lockedFieldsFor(db: Db, eventId: string): Promise<string[]> {
  const row = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: { lockedFields: true },
  });
  return row?.lockedFields ?? [];
}

export async function persistNormalizedEvent(
  db: Db,
  source: SourceRef,
  n: NormalizedEvent,
  opts: PersistOptions = {},
): Promise<{ eventId: string; created: boolean }> {
  const venueId = n.venueName ? await findOrCreateVenue(db, n) : null;
  const existingLink = await findLink(db, source, n.sourceEventId);
  let outcome: { eventId: string; created: boolean };
  if (existingLink) {
    await maintainLink(db, existingLink, n, venueId);
    outcome = { eventId: existingLink.eventId, created: false };
  } else {
    outcome = await createOrAdoptEvent(db, source, n, venueId);
  }
  // Admin 'time' lock: ingestion must not rebuild this event's instances —
  // upsert would resurrect the source's start and supersede would delete the admin's.
  const locked = outcome.created ? [] : await lockedFieldsFor(db, outcome.eventId);
  if (!locked.includes('time')) {
    await upsertInstance(db, outcome.eventId, source.id, n);
    if (opts.supersede) await supersedeOtherInstances(db, outcome.eventId, source.id, n.startAt);
  }
  return outcome;
}
```

`createOrAdoptEvent`'s adopt branch calls `maintainLink(db, winner, ...)` — `winner` comes from the same upgraded `findLink`, so locks flow automatically. Signature unchanged.

- [ ] **Step 4: GREEN + full ingestion/dedup neighbors**

`npx vitest run tests/ingestion/ tests/dedup/` → ALL green. The dedup suite is the canary that persist's observable behavior for unlocked events (every event in those tests) is untouched.

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/ingestion/persist.ts tests/ingestion/locked-fields.test.ts
git commit -m "feat: locked-fields persist contract — admin edits survive canonical re-ingest"
```

### Task 5: Event edit mutations + provenance writes (pure layer)

**Files:**
- Create: `src/app/actions/admin-events.ts`
- Test: `tests/actions/admin-events.test.ts` (create)

**Interfaces:**
- Consumes: `schema.eventEdits` (Task 1); lock semantics (Task 4); `CATEGORY_VALUES` from `src/enrichment/tag.ts` (**verify the exact export name in that file** — the closed 9-value vocab: music, comedy, sports, festival, family, food-drink, arts, community, other); `Db` from `@/db/types` (Task 9 creates it — until then import from `@/lib/card-data` and Task 9 mechanically switches it, OR land Task 9's `src/db/types.ts` re-export first if executing in order; the executor should follow plan order, so use `@/lib/card-data` and note it).
- Produces (Task 7's wrappers call these exact names):
  - `updateEventWithDb(db, editedBy: string, input: EventEditInput): Promise<EventActionState>` — diffs title/status/category/venueId, writes the row, appends `event_edits` rows per changed field, unions locks (title/status/venue changes lock; category does not).
  - `updateInstanceTimeWithDb(db, editedBy: string, input): Promise<EventActionState>` — moves one instance's startAt/endAt, locks `'time'`, writes an `event_edits` row; 23505 → friendly envelope.
  - `unlockFieldWithDb(db, editedBy: string, input): Promise<EventActionState>` — removes one lock, writes an audit row.
  - `EventActionState = { ok: boolean; message: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/actions/admin-events.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import {
  unlockFieldWithDb,
  updateEventWithDb,
  updateInstanceTimeWithDb,
} from '@/app/actions/admin-events';
import { createTestDb } from '../helpers/test-db';

const EDITOR = 'tarik@radiomilwaukee.org';

describe('admin event editing', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  async function seedEvent(slug: string) {
    const [event] = await db
      .insert(schema.events)
      .values({ slug, title: 'Original Title', normalizedTitle: 'original title' })
      .returning();
    return event;
  }

  it('updates changed fields, recomputes normalizedTitle, and writes one provenance row per change', async () => {
    const event = await seedEvent('edit-basic');
    const result = await updateEventWithDb(db, EDITOR, {
      eventId: event.id, title: 'Fixed Title', status: 'cancelled', category: 'music', venueId: '',
    });
    expect(result.ok).toBe(true);
    const updated = await db.query.events.findFirst({ where: eq(schema.events.id, event.id) });
    expect(updated).toMatchObject({
      title: 'Fixed Title', normalizedTitle: 'fixed title', status: 'cancelled', category: 'music',
    });
    // title + status changed AND lock; category changed, NO lock (enrichment already respects non-null)
    expect([...(updated?.lockedFields ?? [])].sort()).toEqual(['status', 'title']);
    const edits = await db.query.eventEdits.findMany({
      where: eq(schema.eventEdits.eventId, event.id),
      orderBy: [asc(schema.eventEdits.createdAt)],
    });
    expect(edits.map((edit) => edit.field).sort()).toEqual(['category', 'status', 'title']);
    expect(edits.find((edit) => edit.field === 'title')).toMatchObject({
      editedBy: EDITOR, oldValue: 'Original Title', newValue: 'Fixed Title',
    });
  });

  it('a no-change save writes nothing', async () => {
    const event = await seedEvent('edit-noop');
    const result = await updateEventWithDb(db, EDITOR, {
      eventId: event.id, title: 'Original Title', status: 'scheduled', category: '', venueId: '',
    });
    expect(result.ok).toBe(true);
    expect(await db.query.eventEdits.findMany({ where: eq(schema.eventEdits.eventId, event.id) })).toEqual([]);
    expect((await db.query.events.findFirst({ where: eq(schema.events.id, event.id) }))?.lockedFields).toEqual([]);
  });

  it('rejects a category outside the closed vocabulary', async () => {
    const event = await seedEvent('edit-badcat');
    const result = await updateEventWithDb(db, EDITOR, {
      eventId: event.id, title: 'Original Title', status: 'scheduled', category: 'polka-core', venueId: '',
    });
    expect(result.ok).toBe(false);
  });

  it('moves an instance time, locks time, and reports a start collision as an envelope', async () => {
    const event = await seedEvent('edit-time');
    const t1 = new Date('2026-08-01T01:00:00Z');
    const t2 = new Date('2026-08-02T01:00:00Z');
    const [a] = await db.insert(schema.eventInstances).values({ eventId: event.id, startAt: t1 }).returning();
    await db.insert(schema.eventInstances).values({ eventId: event.id, startAt: t2 });

    const moved = await updateInstanceTimeWithDb(db, EDITOR, {
      instanceId: a.id, startAt: '2026-08-03T01:00:00.000Z', endAt: '',
    });
    expect(moved.ok).toBe(true);
    expect((await db.query.events.findFirst({ where: eq(schema.events.id, event.id) }))?.lockedFields).toContain('time');

    const collided = await updateInstanceTimeWithDb(db, EDITOR, {
      instanceId: a.id, startAt: t2.toISOString(), endAt: '',
    });
    expect(collided.ok).toBe(false);
    expect(collided.message).toMatch(/already starts/i);
  });

  it('rejects endAt at or before startAt', async () => {
    const event = await seedEvent('edit-endat');
    const [inst] = await db
      .insert(schema.eventInstances)
      .values({ eventId: event.id, startAt: new Date('2026-08-05T01:00:00Z') })
      .returning();
    const result = await updateInstanceTimeWithDb(db, EDITOR, {
      instanceId: inst.id, startAt: '2026-08-05T01:00:00.000Z', endAt: '2026-08-05T00:00:00.000Z',
    });
    expect(result.ok).toBe(false);
  });

  it('unlock removes exactly one lock and audits it', async () => {
    const event = await seedEvent('edit-unlock');
    await db.update(schema.events).set({ lockedFields: ['title', 'time'] }).where(eq(schema.events.id, event.id));
    const result = await unlockFieldWithDb(db, EDITOR, { eventId: event.id, field: 'title' });
    expect(result.ok).toBe(true);
    expect((await db.query.events.findFirst({ where: eq(schema.events.id, event.id) }))?.lockedFields).toEqual(['time']);
    const edits = await db.query.eventEdits.findMany({ where: eq(schema.eventEdits.eventId, event.id) });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ field: 'title', oldValue: 'locked', newValue: 'unlocked' });
  });
});
```

- [ ] **Step 2: RED run** (`npx vitest run tests/actions/admin-events.test.ts` → module not found)

- [ ] **Step 3: Implement**

```typescript
// src/app/actions/admin-events.ts
// Pure, DB-injected event-edit mutations (no 'use server' — the repo's admin-reviews.ts pattern).
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import { CATEGORY_VALUES } from '@/enrichment/tag';
import { normalizeName } from '@/ingestion/naming';
import type { Db } from '@/lib/card-data';

export interface EventActionState {
  ok: boolean;
  message: string;
}

const LOCKABLE = ['title', 'status', 'venue', 'time'] as const;

const emptyToNull = (value: string) => (value === '' ? null : value);

const updateEventSchema = z.object({
  eventId: z.uuid(),
  title: z.string().trim().min(1, 'Title is required.').max(300),
  status: z.enum(['scheduled', 'cancelled', 'postponed']),
  category: z.enum(CATEGORY_VALUES).or(z.literal('')).transform(emptyToNull),
  venueId: z.uuid().or(z.literal('')).transform(emptyToNull),
});
export type EventEditInput = Record<string, FormDataEntryValue | null>;

const instanceTimeSchema = z
  .object({
    instanceId: z.uuid(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime().or(z.literal('')).transform(emptyToNull),
  })
  .refine((v) => v.endAt === null || new Date(v.endAt) > new Date(v.startAt), {
    message: 'End must be after start.',
  });

const unlockSchema = z.object({ eventId: z.uuid(), field: z.enum(LOCKABLE) });

function invalidMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.';
}

interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  lock: 'title' | 'status' | 'venue' | null;
}

function diffEvent(
  current: { title: string; status: string; category: string | null; venueId: string | null },
  next: { title: string; status: string; category: string | null; venueId: string | null },
): FieldChange[] {
  const changes: FieldChange[] = [];
  if (next.title !== current.title)
    changes.push({ field: 'title', oldValue: current.title, newValue: next.title, lock: 'title' });
  if (next.status !== current.status)
    changes.push({ field: 'status', oldValue: current.status, newValue: next.status, lock: 'status' });
  if (next.category !== current.category)
    changes.push({ field: 'category', oldValue: current.category, newValue: next.category, lock: null });
  if (next.venueId !== current.venueId)
    changes.push({ field: 'venue', oldValue: current.venueId, newValue: next.venueId, lock: 'venue' });
  return changes;
}

async function recordEdits(db: Db, eventId: string, editedBy: string, changes: FieldChange[]): Promise<void> {
  await db.insert(schema.eventEdits).values(
    changes.map((change) => ({
      eventId,
      editedBy,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue,
    })),
  );
}

export async function updateEventWithDb(
  db: Db,
  editedBy: string,
  input: EventEditInput,
): Promise<EventActionState> {
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidMessage(parsed.error) };
  const { eventId, ...next } = parsed.data;
  try {
    const current = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
    if (!current) return { ok: false, message: 'Event not found.' };
    const changes = diffEvent(current, next);
    if (changes.length === 0) return { ok: true, message: 'No changes.' };
    const locks = new Set([...current.lockedFields, ...changes.flatMap((c) => (c.lock ? [c.lock] : []))]);
    // Recovery order (no transactions on Neon HTTP): the event row LAST — if the
    // audit insert fails nothing changed; a re-run re-diffs and converges.
    await recordEdits(db, eventId, editedBy, changes);
    await db
      .update(schema.events)
      .set({
        title: next.title,
        normalizedTitle: normalizeName(next.title),
        status: next.status,
        category: next.category,
        venueId: next.venueId,
        lockedFields: [...locks],
        updatedAt: new Date(),
      })
      .where(eq(schema.events.id, eventId));
    return { ok: true, message: 'Event updated.' };
  } catch (error) {
    console.error('updateEventWithDb failed', error);
    return { ok: false, message: 'Could not save the event. Try again.' };
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  if (e.code === '23505' || e.cause?.code === '23505') return true;
  return typeof e.message === 'string' && e.message.includes('duplicate key value violates unique constraint');
}

async function lockTime(db: Db, eventId: string): Promise<void> {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: { lockedFields: true },
  });
  if (!event || event.lockedFields.includes('time')) return;
  await db
    .update(schema.events)
    .set({ lockedFields: [...event.lockedFields, 'time'], updatedAt: new Date() })
    .where(eq(schema.events.id, eventId));
}

export async function updateInstanceTimeWithDb(
  db: Db,
  editedBy: string,
  input: EventEditInput,
): Promise<EventActionState> {
  const parsed = instanceTimeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidMessage(parsed.error) };
  const { instanceId, startAt, endAt } = parsed.data;
  try {
    const instance = await db.query.eventInstances.findFirst({
      where: eq(schema.eventInstances.id, instanceId),
    });
    if (!instance) return { ok: false, message: 'Instance not found.' };
    await db
      .update(schema.eventInstances)
      .set({ startAt: new Date(startAt), endAt: endAt ? new Date(endAt) : null })
      .where(eq(schema.eventInstances.id, instanceId));
    await recordEdits(db, instance.eventId, editedBy, [
      {
        field: 'time',
        oldValue: instance.startAt.toISOString(),
        newValue: new Date(startAt).toISOString(),
        lock: null,
      },
    ]);
    await lockTime(db, instance.eventId);
    return { ok: true, message: 'Time updated.' };
  } catch (error) {
    if (isUniqueViolation(error))
      return { ok: false, message: 'Another date of this event already starts at that time.' };
    console.error('updateInstanceTimeWithDb failed', error);
    return { ok: false, message: 'Could not save the time. Try again.' };
  }
}

export async function unlockFieldWithDb(
  db: Db,
  editedBy: string,
  input: EventEditInput,
): Promise<EventActionState> {
  const parsed = unlockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidMessage(parsed.error) };
  const { eventId, field } = parsed.data;
  try {
    const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
    if (!event) return { ok: false, message: 'Event not found.' };
    if (!event.lockedFields.includes(field)) return { ok: true, message: 'Already unlocked.' };
    await recordEdits(db, eventId, editedBy, [
      { field, oldValue: 'locked', newValue: 'unlocked', lock: null },
    ]);
    await db
      .update(schema.events)
      .set({ lockedFields: event.lockedFields.filter((f) => f !== field), updatedAt: new Date() })
      .where(eq(schema.events.id, eventId));
    return { ok: true, message: `Unlocked ${field} — source values apply on the next ingest.` };
  } catch (error) {
    console.error('unlockFieldWithDb failed', error);
    return { ok: false, message: 'Could not unlock. Try again.' };
  }
}
```

NOTE for implementer: `updateEventWithDb`/`updateInstanceTimeWithDb` exceed 20 lines as single mutation units — mirror how `applyReview` was adjudicated in Slice 2: extract helpers where natural (`diffEvent`, `recordEdits`, `lockTime` already are), don't contort. If `CATEGORY_VALUES` has a different name in `tag.ts`, follow the source. `z.enum(CATEGORY_VALUES)` needs the const tuple type — if `tag.ts` exports a plain `string[]`, use `z.enum(CATEGORY_VALUES as [string, ...string[]])` and note it.

- [ ] **Step 4: GREEN run** (`npx vitest run tests/actions/admin-events.test.ts` → 6/6)

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/app/actions/admin-events.ts tests/actions/admin-events.test.ts
git commit -m "feat: event edit mutations with per-field provenance rows and lock semantics"
```

### Task 6: Admin events list + low-confidence filter (query + page)

**Files:**
- Create: `src/queries/admin-events.ts`, `src/app/admin/events/page.tsx`
- Test: `tests/queries/admin-events.test.ts` (create)

**Interfaces:**
- Consumes: schema relations (`events.sourceLinks.source`, `events.venue`, `events.instances`); `normalizeName` from `@/ingestion/naming`.
- Produces (Task 7 links into this page; README documents it):
  - `adminEventList(db, opts: { q?: string; filter?: 'all' | 'low-confidence' }): Promise<AdminEventRow[]>` (cap 50, next-instance ascending order)
  - `AdminEventRow = { eventId, slug, title, status, category, venueName, nextStartAt: Date | null, canonicalSourceKey: string | null, canonicalAdapterType: string | null, lowConfidence: boolean, lockedFields: string[] }`
  - `venueOptions(db): Promise<{ id: string; name: string }[]>` (ordered by name — the editor's picker)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/queries/admin-events.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { adminEventList, venueOptions } from '@/queries/admin-events';
import { createTestDb } from '../helpers/test-db';

describe('adminEventList', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
    const [apiSource] = await db.insert(schema.sources)
      .values({ key: 'api-src', name: 'API', url: 'https://a.test', adapterType: 'api', config: {} }).returning();
    const [htmlSource] = await db.insert(schema.sources)
      .values({ key: 'html-src', name: 'HTML', url: 'https://b.test', adapterType: 'html', config: {} }).returning();

    const [tagged] = await db.insert(schema.events)
      .values({ slug: 'tagged-api', title: 'Tagged Api Event', normalizedTitle: 'tagged api event', category: 'music' }).returning();
    const [scraped] = await db.insert(schema.events)
      .values({ slug: 'scraped-html', title: 'Scraped Html Event', normalizedTitle: 'scraped html event', category: 'arts' }).returning();
    const [untagged] = await db.insert(schema.events)
      .values({ slug: 'untagged-api', title: 'Untagged Api Event', normalizedTitle: 'untagged api event' }).returning();

    await db.insert(schema.eventSourceLinks).values([
      { eventId: tagged.id, sourceId: apiSource.id, sourceEventId: 't1' },
      { eventId: scraped.id, sourceId: htmlSource.id, sourceEventId: 's1' },
      { eventId: untagged.id, sourceId: apiSource.id, sourceEventId: 'u1' },
    ]);
    await db.insert(schema.eventInstances).values([
      { eventId: tagged.id, startAt: new Date('2026-08-01T00:00:00Z') },
      { eventId: scraped.id, startAt: new Date('2026-08-02T00:00:00Z') },
      { eventId: untagged.id, startAt: new Date('2026-08-03T00:00:00Z') },
    ]);
  });

  it('low-confidence filter = scraper-sourced OR never-enriched, nothing else', async () => {
    const rows = await adminEventList(db, { filter: 'low-confidence' });
    expect(rows.map((r) => r.slug).sort()).toEqual(['scraped-html', 'untagged-api']);
    expect(rows.find((r) => r.slug === 'scraped-html')?.lowConfidence).toBe(true);
  });

  it('search matches on normalized title', async () => {
    const rows = await adminEventList(db, { q: 'TAGGED api' });
    expect(rows.map((r) => r.slug).sort()).toEqual(['tagged-api', 'untagged-api']);
  });

  it('carries the canonical source and lock state for each row', async () => {
    const rows = await adminEventList(db, {});
    const scraped = rows.find((r) => r.slug === 'scraped-html');
    expect(scraped).toMatchObject({
      canonicalSourceKey: 'html-src', canonicalAdapterType: 'html', lockedFields: [],
    });
  });

  it('venueOptions returns name-ordered venues', async () => {
    await db.insert(schema.venues).values([
      { name: 'Zeta Hall', normalizedName: 'zeta hall' },
      { name: 'Alpha Room', normalizedName: 'alpha room' },
    ]);
    const options = await venueOptions(db);
    expect(options.map((v) => v.name)).toEqual(['Alpha Room', 'Zeta Hall']);
  });
});
```

- [ ] **Step 2: RED run** (`npx vitest run tests/queries/admin-events.test.ts`)

- [ ] **Step 3: Implement the query module**

```typescript
// src/queries/admin-events.ts
import { asc, ilike, inArray } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { normalizeName } from '@/ingestion/naming';
import type { Db } from '@/lib/card-data';

const LIST_CAP = 50;
const LOW_CONFIDENCE_ADAPTERS = new Set(['html', 'firecrawl']); // PRD ladder rank <= 2

export interface AdminEventRow {
  eventId: string;
  slug: string;
  title: string;
  status: string;
  category: string | null;
  venueName: string | null;
  nextStartAt: Date | null;
  canonicalSourceKey: string | null;
  canonicalAdapterType: string | null;
  lowConfidence: boolean;
  lockedFields: string[];
}

export interface AdminEventListOpts {
  q?: string;
  filter?: 'all' | 'low-confidence';
}

type LoadedAdminEvent = Awaited<ReturnType<typeof loadAdminEvents>>[number];

async function loadAdminEvents(db: Db, q?: string) {
  return db.query.events.findMany({
    where: q ? ilike(schema.events.normalizedTitle, `%${normalizeName(q)}%`) : undefined,
    with: {
      venue: { columns: { name: true } },
      instances: { orderBy: [asc(schema.eventInstances.startAt)], limit: 1 },
      sourceLinks: { with: { source: { columns: { key: true, adapterType: true } } } },
    },
    orderBy: [asc(schema.events.normalizedTitle)],
    limit: LIST_CAP * 4, // headroom so the low-confidence filter still fills a page
  });
}

function toRow(event: LoadedAdminEvent): AdminEventRow {
  const canonical = event.sourceLinks.find((link) => link.isCanonical) ?? null;
  const adapterType = canonical?.source.adapterType ?? null;
  return {
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    status: event.status,
    category: event.category,
    venueName: event.venue?.name ?? null,
    nextStartAt: event.instances[0]?.startAt ?? null,
    canonicalSourceKey: canonical?.source.key ?? null,
    canonicalAdapterType: adapterType,
    lowConfidence: (adapterType !== null && LOW_CONFIDENCE_ADAPTERS.has(adapterType)) || event.category === null,
    lockedFields: event.lockedFields,
  };
}

export async function adminEventList(db: Db, opts: AdminEventListOpts): Promise<AdminEventRow[]> {
  const rows = (await loadAdminEvents(db, opts.q)).map(toRow);
  const filtered = opts.filter === 'low-confidence' ? rows.filter((row) => row.lowConfidence) : rows;
  return filtered.slice(0, LIST_CAP);
}

export async function venueOptions(db: Db): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.venues.id, name: schema.venues.name })
    .from(schema.venues)
    .orderBy(asc(schema.venues.name));
}
```

(Composability note for the reviewer: the low-confidence predicate spans a relation — filtering in TS over a capped, headroomed fetch is the admin-scale tradeoff, same N+1 family the review queue already accepts at `admin-reviews.ts:71`. 983 events today; revisit with a SQL EXISTS if the corpus 10×es.)

- [ ] **Step 4: GREEN run** (4/4)

- [ ] **Step 5: The list page**

```tsx
// src/app/admin/events/page.tsx
import Link from 'next/link';
import { db } from '@/db';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';
import { adminEventList, type AdminEventRow } from '@/queries/admin-events';

function EventRow({ row }: { row: AdminEventRow }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-head text-lg text-ink">{row.title}</span>
            {row.status !== 'scheduled' ? <Badge variant="secondary">{row.status}</Badge> : null}
            {row.lowConfidence ? <Badge variant="outline">low confidence</Badge> : null}
            {row.lockedFields.length > 0 ? <Badge variant="outline">🔒 {row.lockedFields.join(', ')}</Badge> : null}
          </div>
          <p className="text-sm text-ink-muted">
            {row.venueName ?? 'Venue TBA'}
            {row.category ? ` · ${row.category}` : ' · untagged'}
            {row.nextStartAt ? ` · ${chicagoDateLabel(row.nextStartAt)}` : ' · no upcoming date'}
            {row.canonicalSourceKey ? ` · ${row.canonicalSourceKey} (${row.canonicalAdapterType})` : ''}
          </p>
        </div>
        <Link href={`/admin/events/${row.eventId}/edit`}>
          <Button variant="outline">Edit</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  await requireStaff('admin');
  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const filter = params.filter === 'low-confidence' ? 'low-confidence' : 'all';
  const rows = await adminEventList(db, { q, filter });
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">Events</h1>
        <p className="mt-1 text-ink-muted">
          Edit canonical events. Low confidence = scraper-sourced (html/firecrawl) or never enriched.
        </p>
      </div>
      <form className="flex flex-wrap items-center gap-2" action="/admin/events" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search titles…"
          className="border-[3px] border-ink bg-paper px-3 py-2 text-base"
        />
        {filter === 'low-confidence' ? <input type="hidden" name="filter" value="low-confidence" /> : null}
        <Button type="submit" variant="outline">Search</Button>
        <Link href={`/admin/events${q ? `?q=${encodeURIComponent(q)}` : ''}`}>
          <Button variant={filter === 'all' ? 'default' : 'outline'}>All</Button>
        </Link>
        <Link href={`/admin/events?filter=low-confidence${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
          <Button variant={filter === 'low-confidence' ? 'default' : 'outline'}>Low confidence</Button>
        </Link>
      </form>
      {rows.length === 0 ? (
        <p className="text-ink-muted">No events match.</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => (
            <li key={row.eventId}>
              <EventRow row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Match the search input's classes to an existing admin form input (check the picks pages) rather than trusting the classes above. Add the hub card: in `src/app/admin/page.tsx`'s admin-only fragment (Task 3 made it a `<>...</>`), append a third card linking `/admin/events` titled "Event editor" / "Fix titles, times, venues, status, and categories; review low-confidence events."

- [ ] **Step 6: Typecheck + build + commit**

```bash
git add src/queries/admin-events.ts src/app/admin/events/page.tsx src/app/admin/page.tsx tests/queries/admin-events.test.ts
git commit -m "feat: admin events list with search and low-confidence filter"
```

### Task 7: Event editor page + forms + `'use server'` wrappers

**Files:**
- Create: `src/app/actions/admin-events-actions.ts`, `src/app/admin/events/[id]/edit/page.tsx`, `src/components/admin/event-edit-form.tsx`, `src/components/admin/instance-time-form.tsx`, `src/components/admin/unlock-button.tsx`
- Test: covered by Task 5's pure-fn tests + typecheck/build + reviewer trace (UI layer carries no logic beyond wiring — same treatment as Slice 2's queue UI task)

**Interfaces:**
- Consumes: Task 5's `updateEventWithDb`/`updateInstanceTimeWithDb`/`unlockFieldWithDb` + `EventActionState`; Task 6's `venueOptions`; `currentStaffRole` from `@/lib/staff-guard`; `chicagoDateLabel` from `@/lib/display`.
- Produces: `updateEventAction`, `updateInstanceTimeAction`, `unlockFieldAction` — `(prev: EventActionState, formData: FormData) => Promise<EventActionState>`.

- [ ] **Step 1: The `'use server'` wrappers**

```typescript
// src/app/actions/admin-events-actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { currentStaffRole } from '@/lib/staff-guard';
import {
  unlockFieldWithDb,
  updateEventWithDb,
  updateInstanceTimeWithDb,
  type EventActionState,
} from '@/app/actions/admin-events';

const NOT_AUTHORIZED: EventActionState = { ok: false, message: 'Not authorized.' };

// The editor identity for provenance rows: the verified staff email, or null if not admin.
async function adminEmail(): Promise<string | null> {
  const staff = await currentStaffRole();
  return staff !== null && staff.role === 'admin' ? staff.email : null;
}

// Public pages: event detail is force-dynamic (no revalidate needed); card surfaces are listed.
const EDIT_REVALIDATE_PATHS = ['/admin/events', '/', '/events', '/picks', '/digest'];

function revalidateEdits(): void {
  for (const path of EDIT_REVALIDATE_PATHS) revalidatePath(path);
}

export async function updateEventAction(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const email = await adminEmail();
  if (!email) return NOT_AUTHORIZED;
  const result = await updateEventWithDb(db, email, {
    eventId: formData.get('eventId'),
    title: formData.get('title'),
    status: formData.get('status'),
    category: formData.get('category'),
    venueId: formData.get('venueId'),
  });
  if (result.ok) revalidateEdits();
  return result;
}

export async function updateInstanceTimeAction(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const email = await adminEmail();
  if (!email) return NOT_AUTHORIZED;
  const result = await updateInstanceTimeWithDb(db, email, {
    instanceId: formData.get('instanceId'),
    startAt: formData.get('startAt'),
    endAt: formData.get('endAt'),
  });
  if (result.ok) revalidateEdits();
  return result;
}

export async function unlockFieldAction(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const email = await adminEmail();
  if (!email) return NOT_AUTHORIZED;
  const result = await unlockFieldWithDb(db, email, {
    eventId: formData.get('eventId'),
    field: formData.get('field'),
  });
  if (result.ok) revalidateEdits();
  return result;
}
```

Verify `currentStaffRole()`'s return shape exposes `email` (`src/lib/staff-guard.ts:22-31`) — if it returns only a role, extend it there minimally (it already resolves the verified email internally) and cite the change.

- [ ] **Step 2: Timezone handling for the time form — READ THIS**

`<input type="datetime-local">` values are wall-clock strings with NO zone (`2026-08-01T19:00`). This event site is America/Chicago wall-clock by contract. The client form MUST convert deliberately: render defaults by formatting the stored UTC instant into Chicago wall-clock parts (`chicagoParts(utcMs)` from `src/lib/chicago-time.ts` — verified: returns `{ year, month, day, hour, minute, second }` as 2-digit strings, h23), and submit by converting the wall-clock string back to a UTC ISO instant (`chicagoWallTimeToIso(year, month, day, hour, minute)` — verified signature, DST-aware). The server schema accepts only `z.iso.datetime()`. DO NOT use `new Date('2026-08-01T19:00')` semantics (that's machine-local) — this is the UTC-vs-Chicago family, 4 shipped generations strong. Both helpers are pure and client-importable.

- [ ] **Step 3: The edit page (RSC)**

```tsx
// src/app/admin/events/[id]/edit/page.tsx
import { notFound } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import * as schema from '@/db/schema';
import {
  unlockFieldAction,
  updateEventAction,
  updateInstanceTimeAction,
} from '@/app/actions/admin-events-actions';
import { EventEditForm } from '@/components/admin/event-edit-form';
import { InstanceTimeForm } from '@/components/admin/instance-time-form';
import { UnlockButton } from '@/components/admin/unlock-button';
import { Badge } from '@/components/ui/badge';
import { CATEGORY_VALUES } from '@/enrichment/tag';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';
import { venueOptions } from '@/queries/admin-events';

const HISTORY_SHOWN = 20;

export default async function AdminEventEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff('admin');
  const { id } = await params;
  const eventId = z.uuid().catch('').parse(id);
  if (!eventId) notFound();
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    with: {
      venue: true,
      instances: { orderBy: [asc(schema.eventInstances.startAt)] },
      sourceLinks: { with: { source: true } },
    },
  });
  if (!event) notFound();
  const [venues, edits] = await Promise.all([
    venueOptions(db),
    db.query.eventEdits.findMany({
      where: eq(schema.eventEdits.eventId, eventId),
      orderBy: [desc(schema.eventEdits.createdAt)],
      limit: HISTORY_SHOWN,
    }),
  ]);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">{event.title}</h1>
        <p className="mt-1 text-ink-muted">
          Edited fields lock against ingestion overwrites; unlock to let source values flow again.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {event.sourceLinks.map((link) => (
            <Badge key={link.id} variant={link.isCanonical ? 'default' : 'outline'}>
              {link.source.key}
              {link.isCanonical ? ' ★' : ''}
            </Badge>
          ))}
        </div>
      </div>
      <EventEditForm
        event={{
          eventId: event.id,
          title: event.title,
          status: event.status,
          category: event.category,
          venueId: event.venueId,
          lockedFields: event.lockedFields,
        }}
        categories={CATEGORY_VALUES}
        venues={venues}
        action={updateEventAction}
      />
      <section className="grid gap-2">
        <h2 className="font-head text-xl text-ink">Dates</h2>
        {event.instances.map((instance) => (
          <InstanceTimeForm
            key={instance.id}
            instance={{
              instanceId: instance.id,
              startAt: instance.startAt.toISOString(),
              endAt: instance.endAt?.toISOString() ?? null,
              status: instance.status,
            }}
            action={updateInstanceTimeAction}
          />
        ))}
        {event.instances.length === 0 ? <p className="text-ink-muted">No instances.</p> : null}
      </section>
      {event.lockedFields.length > 0 ? (
        <section className="grid gap-2">
          <h2 className="font-head text-xl text-ink">Locks</h2>
          <div className="flex flex-wrap gap-2">
            {event.lockedFields.map((field) => (
              <UnlockButton key={field} eventId={event.id} field={field} action={unlockFieldAction} />
            ))}
          </div>
        </section>
      ) : null}
      <section className="grid gap-1">
        <h2 className="font-head text-xl text-ink">Edit history</h2>
        {edits.length === 0 ? <p className="text-ink-muted">No manual edits yet.</p> : null}
        {edits.map((edit) => (
          <p key={edit.id} className="text-sm text-ink-muted">
            {chicagoDateLabel(edit.createdAt)} · {edit.editedBy} · {edit.field}:{' '}
            {edit.oldValue ?? '—'} → {edit.newValue ?? '—'}
          </p>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: The client forms**

`src/components/admin/instance-time-form.tsx` — the Chicago-conversion-critical one, complete:

```tsx
'use client';

import { useActionState } from 'react';
import type { EventActionState } from '@/app/actions/admin-events';
import { Button } from '@/components/ui/button';
import { chicagoParts, chicagoWallTimeToIso } from '@/lib/chicago-time';

const initialState: EventActionState = { ok: false, message: '' };

/** UTC ISO instant → Chicago wall-clock string for <input type="datetime-local">. */
function toChicagoLocalValue(iso: string): string {
  const p = chicagoParts(Date.parse(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Chicago wall-clock 'YYYY-MM-DDTHH:mm' → UTC ISO instant (DST-aware); '' passes through. */
function toIsoInstant(local: string): string {
  if (!local) return '';
  const [datePart, timePart] = local.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  return chicagoWallTimeToIso(year, month, day, hour, minute);
}

interface InstanceTimeFormProps {
  instance: { instanceId: string; startAt: string; endAt: string | null; status: string };
  action: (prev: EventActionState, formData: FormData) => Promise<EventActionState>;
}

export function InstanceTimeForm({ instance, action }: InstanceTimeFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // datetime-local values are Chicago wall clock; the server accepts only UTC ISO.
        const form = event.currentTarget;
        const start = form.elements.namedItem('startLocal') as HTMLInputElement;
        const end = form.elements.namedItem('endLocal') as HTMLInputElement;
        (form.elements.namedItem('startAt') as HTMLInputElement).value = toIsoInstant(start.value);
        (form.elements.namedItem('endAt') as HTMLInputElement).value = toIsoInstant(end.value);
      }}
      className="flex flex-wrap items-end gap-2 border-t-[3px] border-ink pt-3"
    >
      <input type="hidden" name="instanceId" value={instance.instanceId} />
      <input type="hidden" name="startAt" />
      <input type="hidden" name="endAt" />
      <label className="grid gap-1 text-sm text-ink">
        Starts (Chicago)
        <input
          type="datetime-local"
          name="startLocal"
          defaultValue={toChicagoLocalValue(instance.startAt)}
          required
          className="border-[3px] border-ink bg-paper px-2 py-1 text-base"
        />
      </label>
      <label className="grid gap-1 text-sm text-ink">
        Ends (optional)
        <input
          type="datetime-local"
          name="endLocal"
          defaultValue={instance.endAt ? toChicagoLocalValue(instance.endAt) : ''}
          className="border-[3px] border-ink bg-paper px-2 py-1 text-base"
        />
      </label>
      {instance.status !== 'scheduled' ? <span className="text-sm text-ink-muted">({instance.status})</span> : null}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Saving…' : 'Save time'}
      </Button>
      {state.message ? (
        <p role="status" className={`text-sm ${state.ok ? 'text-ink-muted' : 'text-rm-red'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
```

(Match the input border/background classes to an existing admin form input — check the picks form components and copy theirs if they differ.)

`src/components/admin/event-edit-form.tsx` — `useActionState` envelope form per the `ReviewDecisionForm` idiom:

```tsx
'use client';

import { useActionState } from 'react';
import type { EventActionState } from '@/app/actions/admin-events';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const initialState: EventActionState = { ok: false, message: '' };
const STATUS_VALUES = ['scheduled', 'cancelled', 'postponed'] as const;

interface EventEditFormProps {
  event: {
    eventId: string;
    title: string;
    status: string;
    category: string | null;
    venueId: string | null;
    lockedFields: string[];
  };
  categories: readonly string[]; // pass CATEGORY_VALUES down from the RSC (tag.ts is server-side)
  venues: { id: string; name: string }[];
  action: (prev: EventActionState, formData: FormData) => Promise<EventActionState>;
}

function LockBadge({ locked }: { locked: boolean }) {
  return locked ? <Badge variant="outline">🔒 locked</Badge> : null;
}

export function EventEditForm({ event, categories, venues, action }: EventEditFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const locked = new Set(event.lockedFields);
  const selectClass = 'border-[3px] border-ink bg-paper px-2 py-1 text-base';
  return (
    <form action={formAction} className="grid max-w-xl gap-3">
      <input type="hidden" name="eventId" value={event.eventId} />
      <label className="grid gap-1 text-sm text-ink">
        <span className="flex items-center gap-2">Title <LockBadge locked={locked.has('title')} /></span>
        <input name="title" defaultValue={event.title} required maxLength={300} className={selectClass} />
      </label>
      <label className="grid gap-1 text-sm text-ink">
        <span className="flex items-center gap-2">Status <LockBadge locked={locked.has('status')} /></span>
        <select name="status" defaultValue={event.status} className={selectClass}>
          {STATUS_VALUES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-ink">
        Category
        <select name="category" defaultValue={event.category ?? ''} className={selectClass}>
          <option value="">— untagged —</option>
          {categories.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-ink">
        <span className="flex items-center gap-2">Venue <LockBadge locked={locked.has('venue')} /></span>
        <select name="venueId" defaultValue={event.venueId ?? ''} className={selectClass}>
          <option value="">— no venue —</option>
          {venues.map((venue) => (
            <option key={venue.id} value={venue.id}>{venue.name}</option>
          ))}
        </select>
      </label>
      <div>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button>
      </div>
      {state.message ? (
        <p role="status" className={`text-sm ${state.ok ? 'text-ink-muted' : 'text-rm-red'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
```

NOTE the `categories` prop: the RSC (Step 3) must pass `CATEGORY_VALUES` down — add `categories={CATEGORY_VALUES}` to the `<EventEditForm>` call and import it in the page (server side), so `tag.ts` is never imported from a client module. Success messages render (the editor revalidates in place, no redirect — error-only messaging would hide successful saves).

`src/components/admin/unlock-button.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { EventActionState } from '@/app/actions/admin-events';
import { Button } from '@/components/ui/button';

const initialState: EventActionState = { ok: false, message: '' };

interface UnlockButtonProps {
  eventId: string;
  field: string;
  action: (prev: EventActionState, formData: FormData) => Promise<EventActionState>;
}

export function UnlockButton({ eventId, field, action }: UnlockButtonProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Source values will overwrite ${field} on the next ingest. Unlock?`))
          event.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="field" value={field} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Unlocking…' : `Unlock ${field}`}
      </Button>
      {state.message && !state.ok ? (
        <p role="status" className="text-sm text-rm-red">{state.message}</p>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 5: Typecheck + build + affected tests**

`npm run typecheck` && `npm run build` → clean. `npx vitest run tests/actions/admin-events.test.ts tests/queries/admin-events.test.ts` → green.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/admin-events-actions.ts src/app/admin/events/[id]/edit/page.tsx src/components/admin/event-edit-form.tsx src/components/admin/instance-time-form.tsx src/components/admin/unlock-button.tsx
git commit -m "feat: admin event editor — forms, locks, provenance history, Chicago-safe time editing"
```

### Task 8: Stuck-'approved' review surface + return-to-queue

**Files:**
- Modify: `src/queries/admin-reviews.ts` (add `stuckApprovedReviews`), `src/app/actions/admin-reviews.ts` (add `returnStuckReviewWithDb`), `src/app/actions/admin-reviews-actions.ts` (add `returnStuckReviewAction`), `src/app/admin/review/page.tsx` (banner section)
- Create: `src/components/admin/stuck-review-banner.tsx`
- Test: extend `tests/queries/admin-reviews.test.ts` + `tests/actions/admin-reviews.test.ts`

**Interfaces:**
- Consumes: `event_reviews` cascade contract (a completed merge deletes its review row — so a surviving `approved` row IS a stuck claim; `sweep.ts:170-174`).
- Produces: `stuckApprovedReviews(db, olderThanMinutes?: number): Promise<StuckReview[]>` where `StuckReview = { reviewId, resolvedAt: Date, aTitle: string, bTitle: string }`; `returnStuckReviewWithDb(db, input): Promise<ReviewActionState>`.

- [ ] **Step 1: Write the failing tests**

In `tests/queries/admin-reviews.test.ts` (extend, seed with the file's existing helpers):

```typescript
  it('stuckApprovedReviews surfaces approved rows older than the threshold, not fresh claims or pendings', async () => {
    // seed pair P1: status 'approved', resolvedAt 30 minutes ago  -> STUCK
    // seed pair P2: status 'approved', resolvedAt 1 minute ago    -> in-flight, excluded
    // seed pair P3: status 'pending'                              -> excluded
    // assert stuckApprovedReviews(db, 15) returns exactly P1 with both event titles
  });
```

In `tests/actions/admin-reviews.test.ts` (extend):

```typescript
  it('returnStuckReviewWithDb CAS-returns an approved row to pending and clears resolvedAt', async () => {
    // seed approved row; call; assert { ok: true }; row now status 'pending', resolvedAt null
  });

  it('returnStuckReviewWithDb refuses rows that are not approved (raced back already)', async () => {
    // seed pending row; call; assert { ok: false }; row unchanged
  });
```

Flesh both out with the file's local seeding idiom (persistNormalizedEvent or direct inserts — copy neighbors).

- [ ] **Step 2: RED run** (`npx vitest run tests/queries/admin-reviews.test.ts tests/actions/admin-reviews.test.ts`)

- [ ] **Step 3: Implement**

Query (`src/queries/admin-reviews.ts`):

```typescript
export interface StuckReview {
  reviewId: string;
  resolvedAt: Date;
  aTitle: string;
  bTitle: string;
}

const STUCK_AFTER_MINUTES = 15;

/**
 * A completed merge cascade-deletes its review row — so ANY surviving 'approved'
 * row is a claim whose merge crashed (sweep.ts accepted tradeoff). The age gate
 * only skips claims still in flight.
 */
export async function stuckApprovedReviews(
  db: Db,
  olderThanMinutes: number = STUCK_AFTER_MINUTES,
): Promise<StuckReview[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const rows = await db.query.eventReviews.findMany({
    where: and(eq(schema.eventReviews.status, 'approved'), lt(schema.eventReviews.resolvedAt, cutoff)),
    orderBy: [asc(schema.eventReviews.resolvedAt)],
  });
  if (rows.length === 0) return [];
  const eventIds = [...new Set(rows.flatMap((row) => [row.eventAId, row.eventBId]))];
  const events = await db.query.events.findMany({
    where: inArray(schema.events.id, eventIds),
    columns: { id: true, title: true },
  });
  const titles = new Map(events.map((event) => [event.id, event.title]));
  return rows.map((row) => ({
    reviewId: row.id,
    resolvedAt: row.resolvedAt!,
    aTitle: titles.get(row.eventAId) ?? '(deleted)',
    bTitle: titles.get(row.eventBId) ?? '(deleted)',
  }));
}
```

(Adjust the drizzle imports — `and`, `lt` join the existing import line.)

Pure action (`src/app/actions/admin-reviews.ts`):

```typescript
const returnStuckSchema = z.object({ reviewId: z.uuid() });

/** CAS: only an 'approved' (stuck) row returns to the queue; a raced re-approve loses cleanly. */
export async function returnStuckReviewWithDb(db: Db, input: ReviewInput): Promise<ReviewActionState> {
  const parsed = returnStuckSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Unknown review.' };
  const updated = await db
    .update(schema.eventReviews)
    .set({ status: 'pending', resolvedAt: null })
    .where(and(eq(schema.eventReviews.id, parsed.data.reviewId), eq(schema.eventReviews.status, 'approved')))
    .returning({ id: schema.eventReviews.id });
  if (updated.length === 0) return { ok: false, message: 'Review is no longer stuck.' };
  return { ok: true, message: 'Returned to the queue — decide it again below.' };
}
```

(Add the needed `and`/`eq`/`schema` imports; this file currently imports only `applyReview` — pull `drizzle-orm` + `@/db/schema` in.)

Wrapper (`src/app/actions/admin-reviews-actions.ts`): `returnStuckReviewAction` — `isAdmin()` gate, call through, `revalidatePath('/admin/review')` on success (mirror `rejectReviewAction` exactly).

Banner (`src/components/admin/stuck-review-banner.tsx`): `useActionState` list — for each stuck row a line "`{aTitle}` ↔ `{bTitle}` — approved {chicagoDateLabel} but never merged (crash mid-apply)" + "Return to queue" button; envelope message line. Page (`src/app/admin/review/page.tsx`): `const stuck = await stuckApprovedReviews(db);` render the banner section between the header and the pending list only when `stuck.length > 0`, styled as a warning Card.

- [ ] **Step 4: GREEN + neighbors** (`npx vitest run tests/queries/admin-reviews.test.ts tests/actions/admin-reviews.test.ts tests/dedup/` → all green)

- [ ] **Step 5: Typecheck + build + commit**

```bash
git add src/queries/admin-reviews.ts src/app/actions/admin-reviews.ts src/app/actions/admin-reviews-actions.ts src/app/admin/review/page.tsx src/components/admin/stuck-review-banner.tsx tests/queries/admin-reviews.test.ts tests/actions/admin-reviews.test.ts
git commit -m "feat: surface stuck approved reviews with return-to-queue CAS action"
```

### Task 9: Riders — display cast, tie-break tests, prune batching, playwright workers, allowlist lint, Db alias

Six small, unrelated fixes; one reviewer pass. Each gets its own RED where a behavior changes.

**Files:**
- Create: `src/db/types.ts`
- Modify: `src/queries/admin-reviews.ts` (breakdown zod), `src/dedup/sweep.ts` (export for tie test if needed), `src/lib/subscribe-throttle.ts` (prune batch), `playwright.config.ts` (workers), `src/lib/staff-auth.ts` (entry lint), `src/ingestion/persist.ts` + `src/lib/card-data.ts` (Db re-export)
- Test: `tests/queries/admin-reviews.test.ts`, `tests/dedup/determinism.test.ts`, `tests/dedup/confidence.test.ts`, `tests/lib/subscribe-throttle.test.ts`, `tests/lib/staff-auth.test.ts` (all extend)

- [ ] **Step 1: Breakdown display cast → zod (RED first)**

Extend `tests/queries/admin-reviews.test.ts`: seed a pending review whose `breakdown` is `{"garbage": true}`; assert `pendingReviewPairs` SKIPS that pair (and still returns healthy ones) instead of returning `NaN`-bound fields. RED: today the cast passes garbage through. Fix in `src/queries/admin-reviews.ts`:

```typescript
const reviewBreakdownSchema = z.object({
  titleSimilarity: z.number(),
  venueAffinity: z.number(),
  startDeltaMinutes: z.number().nullable(),
  urlMatch: z.boolean(),
  total: z.number(),
});
export type ReviewBreakdown = z.infer<typeof reviewBreakdownSchema>;
```

Replace the interface + in the loop replace `review.breakdown as ReviewBreakdown` with a `safeParse`; on failure `console.error('review breakdown corrupt', review.id)` and `continue` (the raced-away-pair tolerance pattern already on `:92`). Add the `z` import. GREEN.

- [ ] **Step 2: Tie-break tests (test-only unless a fix falls out)**

(a) `tests/dedup/determinism.test.ts`: exercise the exact-equal-total tie-break of `scoreAndSortCandidates` (`src/dedup/sweep.ts:31-40`). If it isn't exported, export it (mechanical, cite in report). Feed two fabricated scored candidates with identical `total` and shuffled ids; assert output order is `eventAId` lexicographic then `eventBId`.
(b) `tests/dedup/confidence.test.ts`: `pickCanonical` with equal adapter rank AND byte-identical `createdAt` → returns `a` (pins the `<=` boundary at `confidence.ts:23`). Both must pass WITHOUT changing dedup behavior — if either fails, STOP and report (that's a real bug, not a test gap).

- [ ] **Step 3: Prune batching (RED first)**

Extend `tests/lib/subscribe-throttle.test.ts`: seed `PRUNE_BATCH + 10` stale rows (batch constant exported), one call prunes at most `PRUNE_BATCH`, a second call finishes the job — bounded, convergent. Fix in `src/lib/subscribe-throttle.ts`:

```typescript
const PRUNE_BATCH = 500;
export { PRUNE_BATCH };
```

```typescript
  const stale = db
    .select({ id: schema.subscriptionAttempts.id })
    .from(schema.subscriptionAttempts)
    .where(lt(schema.subscriptionAttempts.createdAt, pruneBefore))
    .limit(PRUNE_BATCH);
  await db.delete(schema.subscriptionAttempts).where(inArray(schema.subscriptionAttempts.id, stale));
```

(Verify drizzle accepts a subquery in `inArray` on this version — it does in 0.4x; if the HTTP driver balks, materialize ids first: `const ids = await stale; if (ids.length) await db.delete(...).where(inArray(..., ids.map(r => r.id)))` — note which you shipped.)

- [ ] **Step 4: Playwright workers**

`playwright.config.ts`, top-level key in the `defineConfig` object: `workers: process.env.CI ? 1 : 2,` — kills the 4-worker dev-server contention flake (filter.spec). No test; Task 10's e2e run is the proof.

- [ ] **Step 5: Allowlist domain-shape lint (RED first)**

Extend `tests/lib/staff-auth.test.ts`: `parseEmailList('a@x.com, @radiomilwaukee.org, @x@y, @, bad domain, plain')` returns ONLY `['a@x.com', '@radiomilwaukee.org']`; malformed entries are dropped (fail closed) with a `console.warn` each (spy on it). Fix in `src/lib/staff-auth.ts`:

```typescript
const DOMAIN_RULE = /^@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

// Fail closed: a malformed entry matches no one; warn so an operator typo
// ('@x@y' or a pasted display name) is visible at first use instead of silently dead.
function isWellFormedEntry(entry: string): boolean {
  if (entry.startsWith('@')) return DOMAIN_RULE.test(entry);
  return entry.lastIndexOf('@') > 0;
}

export function parseEmailList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .filter((entry) => {
      if (isWellFormedEntry(entry)) return true;
      console.warn(`staff allowlist: ignoring malformed entry "${entry}"`);
      return false;
    });
}
```

Run the WHOLE `tests/lib/staff-auth.test.ts` after — the existing adversarial cases (lookalike, subdomain, multi-@, quoted-local smuggling) are the regression net; the last-@ anchor in `matchesEntry` is untouched.

- [ ] **Step 6: `Db` alias consolidation**

Create `src/db/types.ts`:

```typescript
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';

// The one canonical Db type. Historical homes (ingestion/persist.ts, lib/card-data.ts)
// re-export it so their ~17 importers compile unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;
```

In `src/ingestion/persist.ts` and `src/lib/card-data.ts`: delete the local definition (and its eslint-disable), replace with `export type { Db } from '@/db/types';`. Zero importer churn. `npm run typecheck` is the gate.

- [ ] **Step 7: Full rider verification + commit**

`npx vitest run tests/queries/admin-reviews.test.ts tests/dedup/ tests/lib/` → green. `npm run typecheck` → clean.

```bash
git add src/db/types.ts src/queries/admin-reviews.ts src/dedup/sweep.ts src/lib/subscribe-throttle.ts playwright.config.ts src/lib/staff-auth.ts src/ingestion/persist.ts src/lib/card-data.ts tests/queries/admin-reviews.test.ts tests/dedup/determinism.test.ts tests/dedup/confidence.test.ts tests/lib/subscribe-throttle.test.ts tests/lib/staff-auth.test.ts
git commit -m "fix: slice-3 riders — breakdown zod display parse, tie-break pins, prune batching, playwright workers, allowlist lint, Db alias home"
```

### Task 10: E2E, README, full gates, ship checklist

**Files:**
- Modify: `e2e/admin.spec.ts` (two redirect specs), `README.md` (source health + event editor + locks + provenance + stuck-reviews sections)

- [ ] **Step 1: Extend the admin e2e** — inside the existing key-guarded `describe`:

```typescript
  test('unauthenticated /admin/sources redirects to the admin sign-in', async ({ page }) => {
    await page.goto('/admin/sources');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });

  test('unauthenticated /admin/events redirects to the admin sign-in', async ({ page }) => {
    await page.goto('/admin/events');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });
```

- [ ] **Step 2: README** — extend the Admin section: `/admin/sources` (status/backoff semantics: `unknown` = never ingested; `failing` + consecutive counter; backoff window after 3; Trigger run link needs `TRIGGER_PROJECT_REF`), `/admin/events` (search, low-confidence definition, editor scope), field locks (what locks, what unlock means, category needs no lock and why), provenance (`event_edits`, cascade semantics), stuck-reviews banner (what it means, return-to-queue), riders (throttle prune batching, allowlist lint fail-closed behavior).

- [ ] **Step 3: Full gates, sequentially, quiet machine** — `npm run test` (expect ~410+, all green; contention flakes re-run per-file before believing them), `npm run typecheck`, `npm run build`, `npm run e2e` (16 expected with keys; workers now pinned to 2).

- [ ] **Step 4: Commit**

```bash
git add e2e/admin.spec.ts README.md
git commit -m "feat: slice-3 e2e gate specs + README for source health, event editor, locks, and stuck reviews"
```

- [ ] **Step 5: Ship checklist (finishing-a-development-branch pass — do NOT execute inside this task)**

1. Merge `phase-5-slice-3` → `main` locally (standing choice).
2. **Prod migration (sanctioned write #1):** `npm run db:migrate` — applies 0015 (2 ADD COLUMNs + `event_edits`); verify with reads: `event_edits` exists and is empty, `sources.last_run_id` all NULL, `events.locked_fields` all `{}`.
3. **Env (sanctioned write #2):** append `TRIGGER_PROJECT_REF=proj_huidipgowadfhdfioztw` to `.env`; `vercel env add TRIGGER_PROJECT_REF` (prod + preview).
4. `vercel deploy --prod`.
5. **`npm run trigger:deploy` — MANDATORY** (Tasks 2 and 4 touched `src/ingestion/*` + `src/trigger/*`; the 6:00/8:00 crons must run the new bundle; CLI pinned 4.5.1).
6. Live smoke: `/admin/sources`, `/admin/events` 307 → sign-in unauthenticated; `/`, `/events`, `/picks` 200.
7. **Source-health evidence (uses the REAL incident):** Tarik screenshots `/admin/sources` showing ticketmaster-milwaukee / eventbrite-cooperage / county-parks failing with their `last_error` lines → then adds `TICKETMASTER_API_KEY`, `EVENTBRITE_PRIVATE_TOKEN`, `FIRECRAWL_API_KEY` in the Trigger.dev dashboard (prod env) → manually re-triggers `ingest-source` for the three keys (or waits out backoff) → screenshots recovery (`ok`, fresh counts, working run link). That pair of screenshots IS MOO-258's "dashboard shows failing within one cycle" evidence, no URL-breaking needed.
8. **Event-editor evidence:** Tarik edits one real event (e.g. fix a scraped title or a placeholder midnight time via the editor), screenshots the edit + the lock badge + the history row, and confirms the edit survives the next morning's ingest.
9. Evidence comment on MOO-258 (both ACs + verification items); MOO-258 → Done when Tarik confirms all five ACs checked.

## Verification summary (what "done" means for this slice)

- MOO-258 AC "Source health dashboard: per-source status, last fetch, published/skipped counts, link to Trigger.dev run detail" — Tasks 1–3 (all four elements literal; run links live for every cron-driven ingest after the first post-deploy run).
- MOO-258 verification "Break a source URL → dashboard shows failing within one scheduled cycle" — ship step 7 via the real three-source incident (failing screenshots + recovery screenshots).
- MOO-258 AC "Event editor: correct title/time/venue/status/category on canonical events (writes provenance)" — Tasks 1, 4–7 (`event_edits` rows per change; locked fields make corrections durable against re-ingest — without Task 4 the AC would be cosmetic).
- Spec §7 "low-confidence events" review — Task 6's filter surface feeding the editor.
- Slice 2 riders addressed here: stuck-'approved' sweep surface (Task 8), prune batching, tie-break tests, breakdown display cast, playwright worker pinning, allowlist domain-shape lint, `Db` alias duality (Task 9).
- Riders that stay on the backlog (not this slice): homepage LCP/perf-71, ActiveChips labels, day-group calendar ordering, digest double-fetch, dark-accent station cards, neighborhood editorial long-tail (pending ruling #4), Turnstile (keys), RetroUI Pro (credentials), shepherd-express source.
