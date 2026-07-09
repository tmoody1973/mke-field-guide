# Phase 5 Slice 2: Dedup Review Queue + Survivor Picker + Dedup Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship MOO-258's review-queue AC: an admin-tier `/admin/review` queue over the pending duplicate pairs (27 in prod at planning time), side-by-side pair view, approve-merge/reject with a **per-pair survivor picker** (Tarik's explicit want), plus fixes for the three ledger dedup bugs — M2 (`applyReview` approve is a silent no-op status update on a row the merge already cascade-deleted; the function is exported, uncalled, untested), M3 (a chain merge deletes the earlier merge's `event_clusters` receipts), M4 (`findCandidates` has no ORDER BY, so greedy consumption topology is nondeterministic) — and the deferred newsletter hardening (per-IP throttle + honeypot; `subscribe.ts` catch-logging parity).

**Architecture:** Bug fixes land FIRST (Tasks 1–3) because the UI wires directly into `applyReview`. The fixes work *with* the existing cascade design, not against it: `event_reviews.event_a_id/event_b_id` cascade on event deletion is **load-bearing** (`resolvePendingSameShow` and `tests/dedup/same-show.test.ts` assert reviews vanish after merge), so an approved review's durable record is the `event_clusters` receipt (`decided_by: 'review'`) — `applyReview` drops its dead post-merge UPDATE, gains an explicit `survivorEventId` param + envelope return, re-points `staff_picks` off the doomed duplicate, and defaults its suggestion to `pickSameShowSurvivor` (venue-owned preference) instead of the plain ladder. M3 is fixed by re-pointing receipts inside `mergeEvents` before the duplicate row is deleted (chain history preserved; no FK change). M4 is fixed by scoring all candidates then sorting by total desc before the greedy consume loop (plus a stable SQL ORDER BY) — **the ≥0.80 auto-merge semantics are unchanged, only the order becomes deterministic**. The UI reuses Slice 1's admin foundation verbatim: `requireStaff('admin')` page gate, `currentStaffRole()` + role check in actions, pure-fn/`'use server'` two-file split, `useActionState` envelope forms. Newsletter throttle is table-backed (serverless-safe), hashed IPs only.

**Tech Stack:** unchanged from Slice 1 (Next 16.2.10 / Drizzle 0.45.2 on Neon HTTP / Zod 4 / vendored RetroUI / Vitest 4 + PGlite / Playwright / Trigger.dev v4). One new table (`subscription_attempts`, pure DDL).

## Global Constraints

Every task's requirements implicitly include all of these (Slice 1 constraints carry forward; additions in bold):

- **NO PRODUCTION WRITES during implementation.** The ONLY sanctioned prod write in this slice is the `npm run db:migrate` step in the ship checklist (Task 8), executed at ship time, stated explicitly there. Live prod reads remain the norm. Working the actual 27-pair queue happens AFTER deploy, by Tarik, in the UI.
- **`git add` scoped paths only; `git add -A` forbidden. `.env`/`.env.example` append-only.**
- **Dual-deploy rule: ANY edit under `src/dedup/` is Trigger-task-reachable** (`src/trigger/maintenance.ts:4` imports `dedupSweep`, which imports candidates/confidence/merge/scoring) — the ship checklist MUST run `npm run trigger:deploy` in addition to `vercel deploy --prod`, or the 8:00 cron keeps running the old bundle.
- **Frozen: the ≥0.80 auto-merge path's SEMANTICS** (thresholds `AUTO_MERGE_THRESHOLD = 0.8` / `REVIEW_THRESHOLD = 0.55`, weights, `pickCanonical` for the auto path, same-show rule constants). Task 1 changes only processing ORDER. Frozen as ever: `src/search/hybrid.ts` (zero edits), trigger-maintained `search_tsv`, enrichment-owned columns out of `eventFields`, `maintainLink` isCanonical guard, jsonld fallback-id format, day-instance pattern.
- **`tests/dedup/same-show.test.ts` is a behavioral contract** — its assertions (including "review rows cascade to zero after a same-show merge") must stay green UNTOUCHED. No task in this plan is licensed to edit that file.
- ANY date logic through `src/lib/chicago-time.ts` / `src/lib/display.ts` (UTC-vs-Chicago family: 3+ shipped bugs; the same-day comparison pattern lives in `src/dedup/candidates.ts`). `chicagoWeekMonday`/`chicagoDateLabel` are in `display.ts`.
- `'use server'` files export ONLY async functions; types live in plain modules (two-file split per `subscribe.ts`/`newsletter.ts` and `admin-picks.ts`/`admin-picks-actions.ts`).
- Next 16: `params`/`searchParams` are Promises; middleware file is `src/proxy.ts` (exists — do not touch); verify uncertain APIs against `node_modules/next/dist/docs/` (repo AGENTS.md mandate) — **specifically `headers()`'s await-signature in Task 7 (zero prior `headers()` usage in this repo)**.
- Zod 4 idioms (`z.uuid()`, `z.email()`, `z.iso.date()` top-level). Zod at every boundary.
- Tests on PGlite only (`tests/helpers/test-db.ts` replays `drizzle/*.sql` name-sorted — the new migration is picked up automatically; keep it pure DDL). vitest `maxWorkers: 2` / `hookTimeout: 45_000`; PGlite boots ~12s; full-suite verification on a quiet machine; per-file runs are always trustworthy.
- Neon HTTP: no transactions — `mergeEvents`' step order (links → instances → delete → receipt) is recovery-ordered on purpose; keep new steps consistent with that discipline.
- Admin surfaces in this slice are **admin-tier**: pages gate with `await requireStaff('admin')`; actions check `currentStaffRole()` AND `role === 'admin'` (picks-tier DJs must NOT reach merge tooling).
- Logic functions ≤ 20 lines; files ≤ ~300 lines; match repo idiom; comments only for constraints code can't show.
- Implementers: **scrutinize this plan's code, don't transcribe blindly** — recon line numbers may have drifted (Slice 1's verified-email fix shifted `staff-guard.ts`); re-verify anchors in the actual files. 14 plan-authored defects were caught by reviewers in Phase 4 and 3 more in Slice 1.

**Commands:** `npm run test` / `npm run typecheck` / `npm run build` / `npx vitest run <file>` / `npm run e2e` / `npm run db:generate` / (ship only) `npm run db:migrate`, `npm run trigger:deploy`.

## Prerequisites (Tarik-owned — surface, don't block coding)

1. **Authed-e2e decision (AWAITING TARIK, Decision 9):** adding `@clerk/testing` + a fixture Clerk test user would let Playwright exercise the signed-in queue. If declined, the key-guarded redirect spec is the e2e scope and the queue is human-verified (which MOO-258's checklist wants as screenshots anyway).
2. Turnstile stays deferred (needs Tarik's Cloudflare keys) — honeypot + throttle ship now (Decision 7).
3. After ship: Tarik works the 27-pair queue in the UI — resolving one real ambiguous duplicate with both source links visible IS MOO-258's verification-checklist item.

## Decisions (made in planning; flagged ones await Tarik)

1. **Cascade-is-the-contract for approved reviews.** `event_reviews` rows for an approved pair are ALLOWED to cascade away with the deleted duplicate — the durable audit is the `event_clusters` receipt (`decided_by: 'review'`; 34 exist in prod). Rationale: the cascade is load-bearing for `resolvePendingSameShow` (same-show tests assert it), and a schema change (SET NULL + snapshots) would ripple through that contract for no user-visible gain. `rejected` rows DO persist (status + resolvedAt) — they also suppress re-queueing via `findCandidates`' NOT-EXISTS-review check + the unique pair index.
2. **`applyReview` survivor semantics change:** default suggestion switches from `pickCanonical` (plain ladder) to `pickSameShowSurvivor` (venue-owned wins, else ladder) — the same preference Tarik ruled for auto-merges; and the UI ALWAYS passes an explicit `survivorEventId` from the picker, validated to be one of the pair. The old behavior had zero callers, so this is a contract definition, not a breaking change.
3. **`staff_picks` re-point on approve:** before the merge deletes the duplicate, `UPDATE staff_picks SET event_id = survivor WHERE event_id = duplicate` — closes Slice 1's known pick-vanishes-on-merge hole (no unique constraint on `staff_picks.event_id`; safe). Auto-merge paths are NOT changed (station-run crons shouldn't silently move picks; review-approve is a human decision).
4. **M3 fix = receipt re-pointing inside `mergeEvents`:** before deleting the duplicate event, re-point `event_clusters.canonical_event_id` rows from the duplicate to the new canonical. A chain A←B then C←A leaves both receipts alive under C. No FK change, no schema change.
5. **M4 fix = deterministic highest-confidence-first consumption:** `dedupSweep` scores ALL candidates, sorts by `total` desc (tie-break `eventAId`, `eventBId` asc), THEN runs the existing greedy loop unchanged; `findCandidates` also gains a stable SQL `ORDER BY` so the input order is reproducible. Verdict semantics untouched.
6. **No undo.** `mergeEvents` is irreversible and Neon HTTP has no transactions. The UI carries explicit "cannot be undone" copy, a `confirm()` on approve, and the survivor radio is required (no default-submit accident).
7. **Newsletter hardening = table-backed hashed-IP throttle (5 attempts/rolling hour) + honeypot field**, both server-side. IPs stored ONLY as SHA-256 hashes; rows pruned opportunistically after 24h. `NEWSLETTER_THROTTLE_DISABLED=1` kill-switch (documented, set by the Playwright webServer env so e2e re-runs don't flake; NEVER set in Vercel). Turnstile deferred pending keys. `subscribe.ts` catch gains `console.error` (parity with the Slice 1 admin-picks fix).
8. **`VENUE_OWNED_SOURCE_KEYS` stays code-owned** (`src/dedup/confidence.ts`, currently `['pabst-theater-group']`). The queue page displays it read-only with a note; extending it is a reviewed one-line code change (documented in README), not runtime config — it changes merge behavior and deserves a commit trail.
9. **Authed e2e (AWAITING TARIK):** recommend deferring `@clerk/testing` + fixture user unless Tarik wants it now; the queue's proof-of-life is his own screenshot-verified session per MOO-258's checklist.
10. **Slice 3 (next plan):** source health dashboard (per-run stats columns already on `sources`) + event editor with provenance; neighborhood editorial long-tail rides there too. Spec §7's "low-confidence events" review (event-level, not pair-level) also rides to Slice 3 — it belongs with the event editor, not the duplicate queue.

---

### Task 1: M4 — deterministic candidate ordering and consumption

Nondeterminism today: `findCandidates`' final SELECT (src/dedup/candidates.ts, ends ~:67) has no ORDER BY, and `dedupSweep` greedily fills `consumed` in whatever order Postgres returns — so which pair claims a shared event in a 3+-way cluster is unspecified. Fix both layers; change NOTHING about scoring or verdicts.

**Files:**
- Modify: `src/dedup/candidates.ts` (append ORDER BY), `src/dedup/sweep.ts` (score-all → sort → existing loop)
- Test: `tests/dedup/determinism.test.ts` (create)

**Interfaces:**
- Consumes: `findCandidates(db): Promise<CandidateRow[]>`, `scorePair(signals): ScoredPair`, existing `dedupSweep(db): Promise<DedupResult>` — all signatures unchanged.
- Produces: same signatures; behavior guarantee "highest-total pair consumes first, stable tie-break" that Task 3's tests and future sweeps rely on.

- [ ] **Step 1: Write the failing test**

Copy the seeding helpers (`seedSources`, `normalized`, `persistNormalizedEvent` usage) from `tests/dedup/same-show.test.ts` — do not invent columns. Build a 3-event cluster where A↔B scores higher than B↔C, both in auto-merge range, sharing event B:

```typescript
// tests/dedup/determinism.test.ts
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import * as schema from '@/db/schema';
import { dedupSweep } from '@/dedup/sweep';
// copy the same-show.test.ts helper imports/definitions here (seedSources, normalized, persist)

describe('dedupSweep determinism (M4)', () => {
  it('consumes the highest-scoring pair first in a shared-event cluster', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    // A and B: near-identical titles + same venue/time => highest pair score
    // C: similar-but-weaker title vs B, same venue/time => lower pair score, still >= 0.8
    // (tune titles until scorePair puts (A,B) above (B,C); assert that precondition explicitly)
    const a = await persistNormalizedEvent(db, sources.api, normalized('src-a', 'The National at the Riverside'));
    const b = await persistNormalizedEvent(db, sources.otherHtml, normalized('src-b', 'The National at the Riverside Theater'));
    const c = await persistNormalizedEvent(db, sources.pabst, normalized('src-c', 'The National — Riverside show'));

    const result = await dedupSweep(db);

    // B must have been consumed by the (A,B) pair — the higher-scoring one —
    // regardless of Postgres row order. Exactly one of A/B survives that merge.
    const events = await db.query.events.findMany();
    const ids = events.map((row) => row.id);
    expect(result.merged).toBeGreaterThanOrEqual(1);
    expect(ids).not.toContain(/* the (A,B) loser id — assert via cluster receipt below */);
    const receipts = await db.query.eventClusters.findMany();
    // The FIRST receipt written must be the (A,B) merge, not (B,C):
    expect([a.eventId, b.eventId]).toContain(receipts[0].canonicalEventId);
  });

  it('is idempotent-stable: two sweeps over identical seeds produce identical receipt sets', async () => {
    // seed the same cluster into two fresh DBs, sweep each, compare
    // (canonicalEventId slug/title pairs, decidedBy) as multisets — must be equal.
  });
});
```

The test above is a SKELETON where marked — the implementer must (a) copy the exact helper definitions, (b) print `scorePair` totals for the two pairs in the test (assert `expect(scoreAB.total).toBeGreaterThan(scoreBC.total)`) so the precondition is pinned, (c) complete the second test's body per its comment. If tuning titles into the >0.8 band proves fiddly, drop both pairs into the review band instead and assert on `event_reviews` insertion order — determinism is the requirement, not the band.

- [ ] **Step 2: Run it — verify it fails (or flakes)**

Run: `npx vitest run tests/dedup/determinism.test.ts` — expected: assertion failure or nondeterministic pass. Run it 3×; document what you saw in your report. (A nondeterministic test failing only sometimes IS the bug being demonstrated.)

- [ ] **Step 3: Add the SQL ORDER BY**

In `src/dedup/candidates.ts`, append to the end of the final SELECT (after the last `NOT EXISTS`, before the query closes):

```sql
ORDER BY title_similarity DESC, p.event_a_id ASC, p.event_b_id ASC
```

(Alias ordering is valid Postgres. This stabilizes the INPUT; total-score ordering happens in Step 4 because `total` only exists after `scorePair`.)

- [ ] **Step 4: Sort scored candidates before the greedy loop**

In `src/dedup/sweep.ts` `dedupSweep`: currently the loop iterates `findCandidates` results, calling `scorePair` per row and consuming greedily. Restructure minimally — score first, sort, then run the EXISTING loop body unchanged over the sorted array:

```typescript
const candidates = await findCandidates(db);
const scoredCandidates = candidates
  .map((candidate) => ({ candidate, scored: scorePair(candidate) }))
  .sort(
    (x, y) =>
      y.scored.total - x.scored.total ||
      x.candidate.eventAId.localeCompare(y.candidate.eventAId) ||
      x.candidate.eventBId.localeCompare(y.candidate.eventBId),
  );
for (const { candidate, scored } of scoredCandidates) {
  // existing loop body, verbatim, minus its own scorePair call
}
```

Verify `scorePair`'s exact parameter shape against `src/dedup/scoring.ts` (`PairSignals` — CandidateRow is signal-shaped; if the existing loop adapts fields, keep that adaptation). Do NOT touch verdict logic, `consumed` handling, `mergePair`, or `queuePair`.

- [ ] **Step 5: Run the new test + the full dedup suite**

Run: `npx vitest run tests/dedup/determinism.test.ts` → PASS, 3× in a row.
Run: `npx vitest run tests/dedup/` → ALL PASS (sweep, same-show, merge, scoring, confidence, trgm untouched and green).

- [ ] **Step 6: Commit**

```bash
git add src/dedup/candidates.ts src/dedup/sweep.ts tests/dedup/determinism.test.ts
git commit -m "fix: deterministic dedup candidate ordering — score-sort-consume + stable SQL ORDER BY (M4)"
```

### Task 2: M3 — chain merges must not destroy earlier receipts

`event_clusters.canonical_event_id` cascades on `events(id)`. Merge #1 writes receipt {canonical: A, merged: B}; a later merge that consumes A as the duplicate deletes A → cascade destroys B's receipt. History lost.

**Files:**
- Modify: `src/dedup/merge.ts` (one re-point before the delete)
- Test: `tests/dedup/chain-merge.test.ts` (create)

**Interfaces:**
- Consumes/Produces: `mergeEvents(db, canonicalId, duplicateId, scored, decidedBy)` — signature unchanged; new guarantee: receipts keyed on the duplicate are re-pointed to the new canonical before deletion.

- [ ] **Step 1: Write the failing test**

Same helper-copy note as Task 1. Chain: merge B into A, then merge A into C; assert BOTH receipts survive, both pointing at C.

```typescript
// tests/dedup/chain-merge.test.ts
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import * as schema from '@/db/schema';
import { mergeEvents } from '@/dedup/merge';
// copy seeding helpers from tests/dedup/same-show.test.ts

const scoredStub = {
  titleSimilarity: 0.9, venueAffinity: 1, startDeltaMinutes: 0, urlMatch: false,
  total: 0.9, verdict: 'merge',
} as const;

describe('chain merges preserve receipts (M3)', () => {
  it('re-points earlier receipts when their canonical is merged away', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const a = await persistNormalizedEvent(db, sources.api, normalized('s-a', 'Chain Show A'));
    const b = await persistNormalizedEvent(db, sources.otherHtml, normalized('s-b', 'Chain Show B'));
    const c = await persistNormalizedEvent(db, sources.pabst, normalized('s-c', 'Chain Show C'));

    await mergeEvents(db, a.eventId, b.eventId, scoredStub, 'review'); // receipt 1: canonical A
    await mergeEvents(db, c.eventId, a.eventId, scoredStub, 'review'); // A merged away

    const receipts = await db.query.eventClusters.findMany();
    expect(receipts).toHaveLength(2);
    expect(receipts.every((row) => row.canonicalEventId === c.eventId)).toBe(true);
    const mergedTitles = receipts.map((row) => row.mergedEventTitle).sort();
    expect(mergedTitles).toEqual(['Chain Show A', 'Chain Show B']);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run tests/dedup/chain-merge.test.ts` → FAIL: receipts has length 1 (B's receipt cascaded away with A).

- [ ] **Step 3: Re-point receipts in `mergeEvents`**

In `src/dedup/merge.ts`, immediately BEFORE `await db.delete(schema.events).where(eq(schema.events.id, duplicateId));` insert:

```typescript
  // A chain merge would cascade-delete the duplicate's earlier receipts with it —
  // re-point them to the new canonical so merge history survives (ledger M3).
  await db.update(schema.eventClusters)
    .set({ canonicalEventId: canonicalId })
    .where(eq(schema.eventClusters.canonicalEventId, duplicateId));
```

- [ ] **Step 4: Run the test + dedup suite**

Run: `npx vitest run tests/dedup/chain-merge.test.ts` → PASS. Run: `npx vitest run tests/dedup/` → ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dedup/merge.ts tests/dedup/chain-merge.test.ts
git commit -m "fix: re-point event_clusters receipts on chain merge so history survives (M3)"
```

### Task 3: M2 — `applyReview` overhaul: survivor param, envelope, picks re-point, first tests

Current `applyReview` (src/dedup/sweep.ts:104-122): approve runs `mergeEvents` (which cascade-deletes the review row) and THEN updates the row's status — a silent 0-row no-op. It also hardcodes `pickCanonical`, ignoring the venue-owned preference, and returns nothing. It has zero callers and zero tests. This task makes it the review-queue engine.

**Files:**
- Modify: `src/dedup/sweep.ts` (export `provenanceFor`; rewrite `applyReview`)
- Test: `tests/dedup/apply-review.test.ts` (create)

**Interfaces:**
- Consumes: `mergeEvents` (Task 2 form), `pickSameShowSurvivor`, `provenanceFor` (currently module-local at sweep.ts:81 — make it `export async function`), `schema.staffPicks`.
- Produces (Tasks 4–5 rely on these EXACT signatures):
  - `interface ApplyReviewResult { ok: boolean; message: string }` (exported from sweep.ts)
  - `applyReview(db: Db, reviewId: string, verdict: 'approved' | 'rejected', survivorEventId?: string): Promise<ApplyReviewResult>`
  - `provenanceFor(db: Db, ids: [string, string])` — exported, signature otherwise verbatim as found.

- [ ] **Step 1: Write the failing test**

Seed pattern: copy from `tests/dedup/same-show.test.ts:108-153` (two persisted events + a manually inserted pending `event_reviews` row; remember `event_a_id < event_b_id` sorted invariant).

```typescript
// tests/dedup/apply-review.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import * as schema from '@/db/schema';
import { applyReview } from '@/dedup/sweep';
// copy seeding helpers (seedSources, normalized, persistNormalizedEvent) from same-show.test.ts

async function seedPendingPair(db, sources, titleA = 'Review Show', titleB = 'Review Show Live') {
  const first = await persistNormalizedEvent(db, sources.api, normalized(`s-${titleA}`, titleA));
  const second = await persistNormalizedEvent(db, sources.pabst, normalized(`s-${titleB}`, titleB));
  const [eventAId, eventBId] = [first.eventId, second.eventId].sort();
  const [review] = await db.insert(schema.eventReviews).values({
    eventAId, eventBId, score: '0.6800',
    breakdown: { titleSimilarity: 0.65, venueAffinity: 1, startDeltaMinutes: 0, urlMatch: false, total: 0.68, verdict: 'review' },
  }).returning();
  return { review, apiEventId: first.eventId, pabstEventId: second.eventId };
}

describe('applyReview (M2)', () => {
  it('reject persists status and resolvedAt; both events survive', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review } = await seedPendingPair(db, sources);
    const result = await applyReview(db, review.id, 'rejected');
    expect(result.ok).toBe(true);
    const [row] = await db.select().from(schema.eventReviews).where(eq(schema.eventReviews.id, review.id));
    expect(row.status).toBe('rejected');
    expect(row.resolvedAt).not.toBeNull();
    expect(await db.query.events.findMany()).toHaveLength(2);
  });

  it('approve with an explicit survivor merges onto it and writes a review receipt', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review, apiEventId } = await seedPendingPair(db, sources);
    const result = await applyReview(db, review.id, 'approved', apiEventId);
    expect(result.ok).toBe(true);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(apiEventId);
    expect(await db.query.eventReviews.findMany()).toHaveLength(0); // cascade IS the contract
    const receipts = await db.query.eventClusters.findMany();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].canonicalEventId).toBe(apiEventId);
    expect(receipts[0].decidedBy).toBe('review');
  });

  it('approve without a survivor defaults to the venue-owned side', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review, pabstEventId } = await seedPendingPair(db, sources);
    const result = await applyReview(db, review.id, 'approved');
    expect(result.ok).toBe(true);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(pabstEventId); // pabst-theater-group is VENUE_OWNED
  });

  it('rejects a survivor that is not one of the pair, changing nothing', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review } = await seedPendingPair(db, sources);
    const result = await applyReview(db, review.id, 'approved', '00000000-0000-0000-0000-000000000000');
    expect(result.ok).toBe(false);
    expect(await db.query.events.findMany()).toHaveLength(2);
    expect((await db.query.eventReviews.findMany())[0].status).toBe('pending');
  });

  it('re-points a staff pick off the merged-away duplicate', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review, apiEventId, pabstEventId } = await seedPendingPair(db, sources);
    await db.insert(schema.staffPicks).values({
      eventId: apiEventId, curatorName: 'Tarik', blurb: 'keep me', weekOf: '2026-07-06',
    });
    const result = await applyReview(db, review.id, 'approved', pabstEventId); // api side is the duplicate
    expect(result.ok).toBe(true);
    const picks = await db.query.staffPicks.findMany();
    expect(picks).toHaveLength(1);
    expect(picks[0].eventId).toBe(pabstEventId);
  });

  it('is a not-found envelope on a second application', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const { review } = await seedPendingPair(db, sources);
    expect((await applyReview(db, review.id, 'rejected')).ok).toBe(true);
    expect((await applyReview(db, review.id, 'rejected')).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run tests/dedup/apply-review.test.ts` → FAIL (current applyReview returns void — TypeScript may fail compile first; that counts as RED, note it).

- [ ] **Step 3: Rewrite `applyReview` and export `provenanceFor`**

In `src/dedup/sweep.ts`: change `async function provenanceFor` to `export async function provenanceFor` (body untouched). Replace `applyReview` with:

```typescript
export interface ApplyReviewResult {
  ok: boolean;
  message: string;
}

export async function applyReview(
  db: Db,
  reviewId: string,
  verdict: 'approved' | 'rejected',
  survivorEventId?: string,
): Promise<ApplyReviewResult> {
  const review = await db.query.eventReviews.findFirst({
    where: eq(schema.eventReviews.id, reviewId),
  });
  if (!review || review.status !== 'pending') {
    return { ok: false, message: 'Review not found or already resolved.' };
  }
  if (verdict === 'rejected') {
    await db.update(schema.eventReviews)
      .set({ status: 'rejected', resolvedAt: new Date() })
      .where(eq(schema.eventReviews.id, reviewId));
    return { ok: true, message: 'Pair rejected — it will not be suggested again.' };
  }
  const [a, b] = await provenanceFor(db, [review.eventAId, review.eventBId]);
  const survivor = survivorEventId ?? pickSameShowSurvivor(a, b).eventId;
  if (survivor !== review.eventAId && survivor !== review.eventBId) {
    return { ok: false, message: 'Survivor must be one of the paired events.' };
  }
  const duplicate = survivor === review.eventAId ? review.eventBId : review.eventAId;
  // Human decision moves picks with it; the merge below would otherwise cascade-delete them.
  await db.update(schema.staffPicks)
    .set({ eventId: survivor })
    .where(eq(schema.staffPicks.eventId, duplicate));
  const breakdown = review.breakdown as ScoredPair;
  // mergeEvents deletes the duplicate event; THIS review row cascades away with it.
  // The durable record of an approved review is the event_clusters receipt (decidedBy 'review').
  await mergeEvents(db, survivor, duplicate, breakdown, 'review');
  return { ok: true, message: 'Merged. Recorded as a cluster receipt.' };
}
```

Verify the imports sweep.ts already has (`pickSameShowSurvivor` is imported for the same-show path; `ScoredPair` from scoring; add `schema.staffPicks` usage — schema is already imported wholesale). Function is 33 lines — acceptable for this decision-dense core (flag in your report if the reviewer should weigh a split; do not pre-split).

- [ ] **Step 4: Run the tests — verify green**

Run: `npx vitest run tests/dedup/apply-review.test.ts` → 6/6 PASS.
Run: `npx vitest run tests/dedup/` → ALL PASS (same-show contract untouched).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` → clean.

```bash
git add src/dedup/sweep.ts tests/dedup/apply-review.test.ts
git commit -m "fix: applyReview — survivor param honoring venue-owned default, envelope result, picks re-point; cascade documented as the approved-review contract (M2)"
```

### Task 4: Pending-pairs admin query

**Files:**
- Create: `src/queries/admin-reviews.ts`
- Test: `tests/queries/admin-reviews.test.ts`

**Interfaces:**
- Consumes: `provenanceFor` (exported in Task 3), `pickSameShowSurvivor` from `@/dedup/confidence`, `type Db` from `@/lib/card-data`, drizzle relations `events.{venue,instances,sourceLinks→source}` (verified present in `src/db/schema.ts` relations).
- Produces (Task 6 relies on these EXACT shapes):

```typescript
export interface ReviewBreakdown {
  titleSimilarity: number;
  venueAffinity: number;
  startDeltaMinutes: number | null;
  urlMatch: boolean;
  total: number;
}
export interface ReviewSide {
  eventId: string;
  slug: string;
  title: string;
  status: string;
  category: string | null;
  isFree: boolean | null;
  venueName: string | null;
  instanceStarts: Date[]; // ALL instances, past included, ascending — a dupe may be past-only
  sources: { key: string; name: string; isCanonical: boolean; sourceUrl: string | null }[];
  hasStaffPick: boolean;
}
export interface PendingReviewPair {
  reviewId: string;
  score: string;
  breakdown: ReviewBreakdown;
  createdAt: Date;
  a: ReviewSide;
  b: ReviewSide;
  suggestedSurvivorId: string;
}
export async function pendingReviewPairs(db: Db): Promise<PendingReviewPair[]>; // pending only, score desc
```

- [ ] **Step 1: Write the failing test**

Copy seeding helpers from `tests/dedup/same-show.test.ts`; insert pending `event_reviews` rows exactly as Task 3's `seedPendingPair` does (reuse that shape). Cover: (a) two pairs return ordered by score desc; (b) side fields populated (title/venue/sources with key+isCanonical/instanceStarts including a PAST instance); (c) `suggestedSurvivorId` is the pabst (venue-owned) side; (d) `hasStaffPick` true only for the side with a seeded pick; (e) a review whose event was deleted out from under it is SKIPPED, not thrown (delete one event after inserting the review — the review row cascades, but simulate the race by deleting between fetches if feasible; at minimum assert an empty queue returns `[]`).

```typescript
// tests/queries/admin-reviews.test.ts — structure
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import * as schema from '@/db/schema';
import { pendingReviewPairs } from '@/queries/admin-reviews';
// copied helpers + seedPendingPair (Task 3's, with score override param)

describe('pendingReviewPairs', () => {
  it('returns pending pairs ordered by score desc with full side detail', async () => { /* (a)+(b) */ });
  it('suggests the venue-owned side as survivor', async () => { /* (c) */ });
  it('marks sides that carry staff picks', async () => { /* (d) */ });
  it('returns [] when the queue is empty', async () => { /* (e) */ });
});
```

Write the bodies out fully — the skeleton above is the shape, not the deliverable; every assertion named in (a)–(e) must exist in code.

- [ ] **Step 2: Run it — verify it fails** (`Cannot find module '@/queries/admin-reviews'`)

- [ ] **Step 3: Implement**

```typescript
// src/queries/admin-reviews.ts
import { asc, desc, eq, inArray } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { pickSameShowSurvivor } from '@/dedup/confidence';
import { provenanceFor } from '@/dedup/sweep';
import type { Db } from '@/lib/card-data';

// (interfaces exactly as the Interfaces block above)

type LoadedEvent = NonNullable<Awaited<ReturnType<typeof loadReviewEvents>>>[number];

async function loadReviewEvents(db: Db, ids: string[]) {
  return db.query.events.findMany({
    where: inArray(schema.events.id, ids),
    with: {
      venue: true,
      instances: { orderBy: [asc(schema.eventInstances.startAt)] }, // no future-only filter
      sourceLinks: { with: { source: true } },
    },
  });
}

function toSide(event: LoadedEvent, pickEventIds: Set<string>): ReviewSide {
  return {
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    status: event.status,
    category: event.category,
    isFree: event.isFree,
    venueName: event.venue?.name ?? null,
    instanceStarts: event.instances.map((instance) => instance.startAt),
    sources: event.sourceLinks.map((link) => ({
      key: link.source.key,
      name: link.source.name,
      isCanonical: link.isCanonical,
      sourceUrl: link.sourceUrl,
    })),
    hasStaffPick: pickEventIds.has(event.id),
  };
}

export async function pendingReviewPairs(db: Db): Promise<PendingReviewPair[]> {
  const reviews = await db.query.eventReviews.findMany({
    where: eq(schema.eventReviews.status, 'pending'),
    orderBy: [desc(schema.eventReviews.score), asc(schema.eventReviews.createdAt)],
  });
  if (reviews.length === 0) return [];
  const eventIds = [...new Set(reviews.flatMap((row) => [row.eventAId, row.eventBId]))];
  const events = await loadReviewEvents(db, eventIds);
  const byId = new Map(events.map((event) => [event.id, event]));
  const picks = await db
    .select({ eventId: schema.staffPicks.eventId })
    .from(schema.staffPicks)
    .where(inArray(schema.staffPicks.eventId, eventIds));
  const pickEventIds = new Set(picks.map((pick) => pick.eventId));

  const pairs: PendingReviewPair[] = [];
  for (const review of reviews) {
    const eventA = byId.get(review.eventAId);
    const eventB = byId.get(review.eventBId);
    if (!eventA || !eventB) continue; // pair raced away (merge cascade) — tolerate, don't throw
    const [provA, provB] = await provenanceFor(db, [review.eventAId, review.eventBId]);
    pairs.push({
      reviewId: review.id,
      score: review.score,
      breakdown: review.breakdown as ReviewBreakdown,
      createdAt: review.createdAt,
      a: toSide(eventA, pickEventIds),
      b: toSide(eventB, pickEventIds),
      suggestedSurvivorId: pickSameShowSurvivor(provA, provB).eventId,
    });
  }
  return pairs;
}
```

Verify `provenanceFor`'s exact return contract in sweep.ts before transcribing (`[a, b]` provenance order corresponds to the ids array passed in). The per-pair `provenanceFor` loop is N+1 by design — 27 pairs on an admin page; do not prematurely batch.

- [ ] **Step 4: Run the test — verify it passes** (`npx vitest run tests/queries/admin-reviews.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add src/queries/admin-reviews.ts tests/queries/admin-reviews.test.ts
git commit -m "feat: pendingReviewPairs admin query — side detail, venue-owned survivor suggestion"
```

### Task 5: Review decision actions

**Files:**
- Create: `src/app/actions/admin-reviews.ts` (pure), `src/app/actions/admin-reviews-actions.ts` (`'use server'`)
- Test: `tests/actions/admin-reviews.test.ts`

**Interfaces:**
- Consumes: `applyReview`, `ApplyReviewResult` (Task 3); `currentStaffRole` from `@/lib/staff-guard`; `db` from `@/db`.
- Produces (Task 6's forms rely on these EXACT signatures):
  - `interface ReviewActionState { ok: boolean; message: string }` (pure module)
  - `approveReviewWithDb(db: Db, input: Record<string, FormDataEntryValue | null>): Promise<ReviewActionState>` — requires BOTH `reviewId` and `survivorEventId` valid uuids
  - `rejectReviewWithDb(db: Db, input: Record<string, FormDataEntryValue | null>): Promise<ReviewActionState>`
  - `'use server'`: `approveReviewAction(prev, formData)`, `rejectReviewAction(prev, formData)` — **admin tier enforced** (`currentStaffRole()` non-null AND `role === 'admin'`); NO redirect (queue re-renders in place); approve revalidates `['/admin/review', '/', '/picks', '/digest']` (picks may have been re-pointed), reject revalidates `/admin/review` only.

- [ ] **Step 1: Write the failing test** — PGlite, reusing Task 3's seeding: approve happy path with explicit survivor (assert merged + envelope ok); approve with missing `survivorEventId` → `{ ok: false }` mentioning survivor, nothing merged; approve with malformed reviewId → error envelope; reject happy path (status rejected). Full test code, no skeletons — mirror `tests/actions/admin-picks.test.ts` file conventions.

- [ ] **Step 2: RED run** (module not found)

- [ ] **Step 3: Implement the pure module**

```typescript
// src/app/actions/admin-reviews.ts
import { z } from 'zod';
import { applyReview } from '@/dedup/sweep';
import type { Db } from '@/lib/card-data';

export interface ReviewActionState {
  ok: boolean;
  message: string;
}

const approveSchema = z.object({ reviewId: z.uuid(), survivorEventId: z.uuid() });
const rejectSchema = z.object({ reviewId: z.uuid() });

type ReviewInput = Record<string, FormDataEntryValue | null>;

export async function approveReviewWithDb(db: Db, input: ReviewInput): Promise<ReviewActionState> {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Pick a survivor before approving.' };
  return applyReview(db, parsed.data.reviewId, 'approved', parsed.data.survivorEventId);
}

export async function rejectReviewWithDb(db: Db, input: ReviewInput): Promise<ReviewActionState> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Unknown review.' };
  return applyReview(db, parsed.data.reviewId, 'rejected');
}
```

- [ ] **Step 4: GREEN run**, then implement the `'use server'` wrappers

```typescript
// src/app/actions/admin-reviews-actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { currentStaffRole } from '@/lib/staff-guard';
import {
  approveReviewWithDb,
  rejectReviewWithDb,
  type ReviewActionState,
} from '@/app/actions/admin-reviews';

const NOT_AUTHORIZED: ReviewActionState = { ok: false, message: 'Not authorized.' };

async function isAdmin(): Promise<boolean> {
  const staff = await currentStaffRole();
  return staff !== null && staff.role === 'admin';
}

export async function approveReviewAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  if (!(await isAdmin())) return NOT_AUTHORIZED;
  const result = await approveReviewWithDb(db, {
    reviewId: formData.get('reviewId'),
    survivorEventId: formData.get('survivorEventId'),
  });
  if (result.ok) {
    for (const path of ['/admin/review', '/', '/picks', '/digest']) revalidatePath(path);
  }
  return result;
}

export async function rejectReviewAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  if (!(await isAdmin())) return NOT_AUTHORIZED;
  const result = await rejectReviewWithDb(db, { reviewId: formData.get('reviewId') });
  if (result.ok) revalidatePath('/admin/review');
  return result;
}
```

- [ ] **Step 5: Typecheck + both test files green; commit**

```bash
git add src/app/actions/admin-reviews.ts src/app/actions/admin-reviews-actions.ts tests/actions/admin-reviews.test.ts
git commit -m "feat: review decision actions — admin-tier approve (survivor required) and reject"
```

### Task 6: `/admin/review` queue UI

**Files:**
- Create: `src/app/admin/review/page.tsx`, `src/components/admin/review-decision-form.tsx`
- Modify: `src/app/admin/page.tsx` (the existing "Review queue & sources" placeholder card at ~:24-31 becomes a `<Link href="/admin/review">`; drop "coming in Slice 2" copy — re-verify line refs, they've drifted)

**Interfaces:**
- Consumes: `requireStaff('admin')`; `pendingReviewPairs` + types (Task 4); `approveReviewAction`/`rejectReviewAction` + `ReviewActionState` (Task 5 — TYPE from the pure module only); `VENUE_OWNED_SOURCE_KEYS` from `@/dedup/confidence` (read-only display); `chicagoDateLabel` from `@/lib/display`; RetroUI `Badge`, `Button`, `Card*`.
- Produces: route `/admin/review` (Task 8 e2e + README document it).

- [ ] **Step 1: Client decision form**

```tsx
// src/components/admin/review-decision-form.tsx
'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { ReviewActionState } from '@/app/actions/admin-reviews';

const initialState: ReviewActionState = { ok: false, message: '' };

interface ReviewDecisionFormProps {
  reviewId: string;
  suggestedSurvivorId: string;
  sides: { eventId: string; title: string }[];
  approveAction: (prev: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;
  rejectAction: (prev: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;
}

export function ReviewDecisionForm({
  reviewId,
  suggestedSurvivorId,
  sides,
  approveAction,
  rejectAction,
}: ReviewDecisionFormProps) {
  const [approveState, approveFormAction, approvePending] = useActionState(approveAction, initialState);
  const [rejectState, rejectFormAction, rejectPending] = useActionState(rejectAction, initialState);
  const pending = approvePending || rejectPending;
  return (
    <div className="grid gap-2 border-t-[3px] border-ink pt-3">
      <form
        action={approveFormAction}
        onSubmit={(event) => {
          if (!window.confirm('Merge these two events? This cannot be undone.')) event.preventDefault();
        }}
        className="grid gap-2"
      >
        <input type="hidden" name="reviewId" value={reviewId} />
        <fieldset className="grid gap-1">
          <legend className="text-sm font-medium text-ink">Survivor (keeps its page and data)</legend>
          {sides.map((side) => (
            <label key={side.eventId} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="survivorEventId"
                value={side.eventId}
                defaultChecked={side.eventId === suggestedSurvivorId}
                required
              />
              Keep “{side.title}”
            </label>
          ))}
        </fieldset>
        <div>
          <Button type="submit" disabled={pending}>
            {approvePending ? 'Merging…' : 'Approve merge'}
          </Button>
        </div>
      </form>
      <form action={rejectFormAction}>
        <input type="hidden" name="reviewId" value={reviewId} />
        <Button type="submit" variant="outline" disabled={pending}>
          {rejectPending ? 'Saving…' : 'Not a duplicate'}
        </Button>
      </form>
      {approveState.message && !approveState.ok ? (
        <p role="status" className="text-sm text-rm-red">{approveState.message}</p>
      ) : null}
      {rejectState.message && !rejectState.ok ? (
        <p role="status" className="text-sm text-rm-red">{rejectState.message}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Queue page**

```tsx
// src/app/admin/review/page.tsx
import Link from 'next/link';
import { db } from '@/db';
import { approveReviewAction, rejectReviewAction } from '@/app/actions/admin-reviews-actions';
import { ReviewDecisionForm } from '@/components/admin/review-decision-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VENUE_OWNED_SOURCE_KEYS } from '@/dedup/confidence';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';
import { pendingReviewPairs, type ReviewSide } from '@/queries/admin-reviews';

const MAX_STARTS_SHOWN = 5;

function SideColumn({ side }: { side: ReviewSide }) {
  return (
    <div className="grid content-start gap-2">
      <Link href={`/events/${side.slug}`} target="_blank" className="font-head text-lg text-ink underline">
        {side.title}
      </Link>
      <p className="text-sm text-ink-muted">
        {side.venueName ?? 'Venue TBA'}
        {side.category ? ` · ${side.category}` : ''}
        {side.isFree ? ' · Free' : ''}
        {side.status !== 'scheduled' ? ` · ${side.status}` : ''}
      </p>
      <div className="text-sm text-ink-muted">
        {side.instanceStarts.slice(0, MAX_STARTS_SHOWN).map((start) => (
          <div key={start.toISOString()}>{chicagoDateLabel(start)}</div>
        ))}
        {side.instanceStarts.length > MAX_STARTS_SHOWN ? (
          <div>+{side.instanceStarts.length - MAX_STARTS_SHOWN} more</div>
        ) : null}
        {side.instanceStarts.length === 0 ? <div>No instances</div> : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {side.sources.map((source) => (
          <Badge key={source.key} variant={source.isCanonical ? 'default' : 'outline'}>
            {source.key}
            {source.isCanonical ? ' ★' : ''}
          </Badge>
        ))}
        {side.hasStaffPick ? <Badge variant="secondary">staff pick</Badge> : null}
      </div>
    </div>
  );
}

export default async function AdminReviewPage() {
  await requireStaff('admin');
  const pairs = await pendingReviewPairs(db);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">Duplicate review</h1>
        <p className="mt-1 text-ink-muted">
          {pairs.length} pending pair{pairs.length === 1 ? '' : 's'}. Approving merges the pair onto
          the survivor you pick — links, dates, and staff picks move with it; this cannot be undone.
          Venue-owned sources preferred by default: {VENUE_OWNED_SOURCE_KEYS.join(', ')}.
        </p>
      </div>
      {pairs.length === 0 ? (
        <p className="text-ink-muted">
          Queue is clear. The daily 8:00 dedup sweep adds new ambiguous pairs here.
        </p>
      ) : (
        <ul className="grid gap-4">
          {pairs.map((pair) => (
            <li key={pair.reviewId}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    Score {Number(pair.score).toFixed(2)}
                    <span className="text-sm font-normal text-ink-muted">
                      title {Math.round(pair.breakdown.titleSimilarity * 100)}% · venue{' '}
                      {Math.round(pair.breakdown.venueAffinity * 100)}% ·{' '}
                      {pair.breakdown.startDeltaMinutes === null
                        ? 'time unknown'
                        : `Δ${pair.breakdown.startDeltaMinutes}min`}
                      {pair.breakdown.urlMatch ? ' · url match' : ''}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SideColumn side={pair.a} />
                    <SideColumn side={pair.b} />
                  </div>
                  <ReviewDecisionForm
                    reviewId={pair.reviewId}
                    suggestedSurvivorId={pair.suggestedSurvivorId}
                    sides={[
                      { eventId: pair.a.eventId, title: pair.a.title },
                      { eventId: pair.b.eventId, title: pair.b.title },
                    ]}
                    approveAction={approveReviewAction}
                    rejectAction={rejectReviewAction}
                  />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Verify `chicagoDateLabel(date: Date)`'s signature in `src/lib/display.ts` before transcribing (Slice 1 confirmed it, but re-check).

- [ ] **Step 3: Admin landing card becomes a link** — in `src/app/admin/page.tsx`, wrap the existing admin-only "Review queue & sources" card in `<Link href="/admin/review" className="block">` (mirroring the picks card) and change the description to "Approve or reject flagged duplicate pairs with a survivor picker." Keep the `staff.role === 'admin'` conditional exactly as is.

- [ ] **Step 4: Typecheck, build, read-only dev walk**

`npm run typecheck` → clean; `npm run build` → clean (route `/admin/review` in the table). Dev walk (`.env` points at PROD — READ-ONLY: do NOT submit approve/reject): unauthenticated `/admin/review` → sign-in redirect; with your dev keyless/allowlisted session, the queue renders 27 pairs with radios pre-checked on the venue-owned-or-ladder side. STOP before any submission; report what rendered.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/review src/components/admin/review-decision-form.tsx src/app/admin/page.tsx
git commit -m "feat: /admin/review queue — side-by-side pairs, survivor picker, approve/reject (admin tier)"
```

### Task 7: Newsletter hardening — hashed-IP throttle, honeypot, catch logging

The newsletter form is an unauthenticated, unthrottled public write (pre-launch backlog item, recorded on MOO-258). Hardening is server-side only: a table-backed per-IP throttle (serverless-safe) + a honeypot field. Privacy: raw IPs are never stored — SHA-256 hashes only, pruned after 24h.

**Files:**
- Modify: `src/db/schema.ts` (add `subscriptionAttempts`), `src/app/actions/subscribe.ts` (catch logging + export success message const), `src/app/actions/newsletter.ts` (honeypot + throttle wiring), `src/components/newsletter-form.tsx` (honeypot input), `playwright.config.ts` (webServer env kill-switch), `.env.example` (APPEND kill-switch doc)
- Create: `src/lib/subscribe-throttle.ts`, `drizzle/00XX_*.sql` (generated)
- Test: `tests/lib/subscribe-throttle.test.ts`

**Interfaces:**
- Consumes: `type Db` from `@/lib/card-data`; `subscribeWithDb` (unchanged signature).
- Produces:
  - `subscriptionAttempts` table `{ id uuid pk, ipHash text notNull, createdAt timestamptz notNull default now }` + index `(ip_hash, created_at)`
  - `hashIp(ip: string): string` (sha256 hex, `node:crypto`)
  - `registerAttempt(db: Db, ip: string, now?: Date): Promise<{ allowed: boolean }>` — counts the hash's attempts in the rolling window BEFORE inserting the new attempt; allowed = count < MAX; also opportunistically deletes rows older than 24h; honors `process.env.NEWSLETTER_THROTTLE_DISABLED === '1'` by returning allowed without touching the DB
  - `MAX_ATTEMPTS_PER_WINDOW = 5`, `WINDOW_MINUTES = 60` (exported consts)
  - `SUBSCRIBE_SUCCESS_MESSAGE` exported from `subscribe.ts` (currently an inline literal — export the existing constant, do NOT change its text; the honeypot response must be indistinguishable from success)

- [ ] **Step 1: Add the table to `src/db/schema.ts`** (match the file's existing style):

```typescript
export const subscriptionAttempts = pgTable(
  'subscription_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipHash: text('ip_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('subscription_attempts_ip_idx').on(table.ipHash, table.createdAt)],
);
```

Run: `npm run db:generate` → new migration file under `drizzle/` (pure DDL — verify it contains ONLY the CREATE TABLE + INDEX; PGlite replays it automatically). **Do NOT run `db:migrate` — that is the ship checklist's stated prod-write step.**

- [ ] **Step 2: Write the failing throttle test**

```typescript
// tests/lib/subscribe-throttle.test.ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import * as schema from '@/db/schema';
import {
  MAX_ATTEMPTS_PER_WINDOW,
  hashIp,
  registerAttempt,
} from '@/lib/subscribe-throttle';

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.delete(schema.subscriptionAttempts);
  delete process.env.NEWSLETTER_THROTTLE_DISABLED;
});

describe('hashIp', () => {
  it('is deterministic and never contains the raw ip', () => {
    expect(hashIp('203.0.113.7')).toBe(hashIp('203.0.113.7'));
    expect(hashIp('203.0.113.7')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashIp('203.0.113.7')).not.toContain('203');
  });
});

describe('registerAttempt', () => {
  it('allows the first MAX attempts then blocks within the window', async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_WINDOW; attempt += 1) {
      expect((await registerAttempt(db, '203.0.113.7')).allowed).toBe(true);
    }
    expect((await registerAttempt(db, '203.0.113.7')).allowed).toBe(false);
  });

  it('scopes the window per ip', async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_WINDOW + 1; attempt += 1) {
      await registerAttempt(db, '203.0.113.7');
    }
    expect((await registerAttempt(db, '198.51.100.9')).allowed).toBe(true);
  });

  it('forgets attempts older than the window (injected now)', async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_WINDOW + 1; attempt += 1) {
      await registerAttempt(db, '203.0.113.7', past);
    }
    expect((await registerAttempt(db, '203.0.113.7')).allowed).toBe(true);
  });

  it('kill-switch bypasses without writing rows', async () => {
    process.env.NEWSLETTER_THROTTLE_DISABLED = '1';
    expect((await registerAttempt(db, '203.0.113.7')).allowed).toBe(true);
    expect(await db.select().from(schema.subscriptionAttempts)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: RED run**, then implement `src/lib/subscribe-throttle.ts`

```typescript
// src/lib/subscribe-throttle.ts
import { createHash } from 'node:crypto';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/lib/card-data';

export const MAX_ATTEMPTS_PER_WINDOW = 5;
export const WINDOW_MINUTES = 60;
const PRUNE_AFTER_HOURS = 24;

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

/** Counts BEFORE inserting so the blocked attempt itself is still recorded (abuse visibility). */
export async function registerAttempt(
  db: Db,
  ip: string,
  now: Date = new Date(),
): Promise<{ allowed: boolean }> {
  if (process.env.NEWSLETTER_THROTTLE_DISABLED === '1') return { allowed: true };
  const ipHash = hashIp(ip);
  const windowStart = new Date(now.getTime() - WINDOW_MINUTES * 60_000);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.subscriptionAttempts)
    .where(
      and(
        eq(schema.subscriptionAttempts.ipHash, ipHash),
        gte(schema.subscriptionAttempts.createdAt, windowStart),
      ),
    );
  await db.insert(schema.subscriptionAttempts).values({ ipHash, createdAt: now });
  const pruneBefore = new Date(now.getTime() - PRUNE_AFTER_HOURS * 60 * 60_000);
  await db.delete(schema.subscriptionAttempts).where(lt(schema.subscriptionAttempts.createdAt, pruneBefore));
  return { allowed: count < MAX_ATTEMPTS_PER_WINDOW };
}
```

- [ ] **Step 4: GREEN run** (`npx vitest run tests/lib/subscribe-throttle.test.ts` → 5/5)

- [ ] **Step 5: Wire the wrapper + honeypot + logging**

`src/app/actions/subscribe.ts`: export the existing success-message constant (name it `SUBSCRIBE_SUCCESS_MESSAGE` if unnamed — keep the exact user-facing text) and add `console.error('subscribeWithDb failed', error)` in the catch (parity with admin-picks).

`src/app/actions/newsletter.ts` — FIRST verify `headers()` against `node_modules/next/dist/docs/` (expected: `const headerList = await headers()` from `next/headers`; adjust if the bundled docs differ):

```typescript
'use server';

import { headers } from 'next/headers';
import { db } from '@/db';
import {
  SUBSCRIBE_SUCCESS_MESSAGE,
  subscribeWithDb,
  type SubscribeState,
} from '@/app/actions/subscribe';
import { registerAttempt } from '@/lib/subscribe-throttle';

const THROTTLED_MESSAGE = 'Too many signups from your network — try again in an hour.';

async function clientIp(): Promise<string> {
  const headerList = await headers();
  return headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function subscribeAction(
  _prev: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  // Honeypot: bots fill the invisible field; respond exactly like success, store nothing.
  if (formData.get('company')) return { ok: true, message: SUBSCRIBE_SUCCESS_MESSAGE };
  const { allowed } = await registerAttempt(db, await clientIp());
  if (!allowed) return { ok: false, message: THROTTLED_MESSAGE };
  return subscribeWithDb(db, { email: formData.get('email'), source: formData.get('source') });
}
```

`src/components/newsletter-form.tsx`: inside the form, add the honeypot input (verify the form's existing markup and match idiom):

```tsx
<input
  type="text"
  name="company"
  tabIndex={-1}
  autoComplete="off"
  aria-hidden="true"
  className="sr-only"
/>
```

(`sr-only` hides it visually while staying in the DOM; verify the utility exists in globals.css/Tailwind — if not, use an inline `style={{ position: 'absolute', left: '-9999px' }}`.)

`playwright.config.ts`: add `env: { ...process.env, NEWSLETTER_THROTTLE_DISABLED: '1' }` to the existing `webServer` block (verify its current shape first) — e2e re-runs in one hour must not trip the throttle. APPEND to `.env.example`:

```bash
# Set to 1 to disable the newsletter per-IP throttle (e2e only — NEVER set in Vercel).
NEWSLETTER_THROTTLE_DISABLED=
```

- [ ] **Step 6: Typecheck + affected tests + build**

`npm run typecheck` → clean. `npx vitest run tests/lib/subscribe-throttle.test.ts tests/actions/` → green (existing subscribe tests untouched — `subscribeWithDb`'s signature didn't change). `npm run build` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts drizzle src/lib/subscribe-throttle.ts src/app/actions/subscribe.ts src/app/actions/newsletter.ts src/components/newsletter-form.tsx playwright.config.ts .env.example tests/lib/subscribe-throttle.test.ts
git commit -m "feat: newsletter hardening — hashed-IP throttle (5/hr) + honeypot + catch logging"
```

### Task 8: E2E, README, full gates, ship checklist

**Files:**
- Modify: `e2e/admin.spec.ts` (one more redirect spec), `README.md` (review queue + newsletter hardening sections)

- [ ] **Step 1: Extend the admin e2e** — inside the existing key-guarded `describe` in `e2e/admin.spec.ts`, add:

```typescript
  test('unauthenticated /admin/review redirects to the admin sign-in', async ({ page }) => {
    await page.goto('/admin/review');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });
```

- [ ] **Step 2: README** — read the Admin section added in Slice 1 and extend it: `/admin/review` (admin tier only — picks-tier DJs don't see it), what approve does (merge onto the chosen survivor; links/dates/picks move; irreversible; recorded as an `event_clusters` receipt), what reject does (persists, suppresses the pair forever), the venue-owned default and how to extend `VENUE_OWNED_SOURCE_KEYS` (one-line edit in `src/dedup/confidence.ts`, goes through review). Add a Newsletter hardening note (throttle 5/hr per hashed IP, honeypot, `NEWSLETTER_THROTTLE_DISABLED` for local e2e only).

- [ ] **Step 3: Full gates, sequentially, quiet machine** — `npm run test` (expect ~375+, all green; contention flakes re-run per-file before believing them), `npm run typecheck`, `npm run build`, `npm run e2e` (12 passed + 3 skipped without keys, or all passing with keys).

- [ ] **Step 4: Commit**

```bash
git add e2e/admin.spec.ts README.md
git commit -m "feat: admin review e2e gate spec + README for review queue and newsletter hardening"
```

- [ ] **Step 5: Ship checklist (finishing-a-development-branch pass — do NOT execute inside this task)**

1. Merge `phase-5-slice-2` → `main` locally (standing choice).
2. **Prod migration (THE sanctioned prod write):** `npm run db:migrate` — creates `subscription_attempts` only; verify with a read that the table exists and is empty.
3. `vercel deploy --prod`.
4. **`npm run trigger:deploy`** — MANDATORY (Tasks 1–3 touched `src/dedup/*`; the 8:00 cron must run the fixed bundle).
5. Live smoke: `/admin/review` 307 → sign-in unauthenticated; public routes 200.
6. Tarik: work the queue — resolve at least one real ambiguous duplicate (survivor picked, both source links visible on the merged event) → screenshot; that is MOO-258's review-queue verification item. Reject at least one non-duplicate to evidence the reject path.
7. Evidence comment on MOO-258; queue count before/after.

## Verification summary (what "done" means for this slice)

- MOO-258 AC "Review queue: ambiguous duplicate clusters and field conflicts with approve/merge/reject actions" — Tasks 3–6 (survivor picker exceeds the AC; "field conflicts" surface as the side-by-side diff of title/venue/times/sources).
- MOO-258 verification item "Resolve one real ambiguous duplicate through the queue; show merged event with both source links" — ship checklist step 6 (human, post-deploy).
- Ledger M2/M3/M4 — Tasks 3/2/1 respectively, each with first-ever regression tests.
- Pre-launch backlog "newsletter per-IP throttle/honeypot before marketing push" — Task 7 (Turnstile deferred, Decision 7).
- Slice 1 riders addressed here: staff-pick re-point on merge (Task 3), `subscribe.ts` catch logging (Task 7). Remaining riders (playwright worker pinning, allowlist domain-shape lint, Db-alias consolidation) ride on to Slice 3 unless trivially adjacent during execution.
