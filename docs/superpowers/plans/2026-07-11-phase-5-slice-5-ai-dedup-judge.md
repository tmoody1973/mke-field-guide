# Phase 5 Slice 5: AI Dedup Judge (Annotate-Only) + Judge Eval Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every pending review-band pair gets adjudicated by a haiku-class LLM judge with structured output — verdict, confidence, and rationale rendered in `/admin/review` so a human decision takes seconds — plus an offline eval harness (golden set of real pairs + curated negatives) that gates any future promotion to auto-merge.

**Architecture:** The judge mirrors the proven enrichment pattern exactly: a never-throws structured call (`generateText` + `Output.object` on `anthropic/claude-haiku-4-5` via the AI Gateway — src/enrichment/tag.ts is the template), driven by a batch sweep that no-ops without `AI_GATEWAY_API_KEY` and never blocks anything. Verdicts land as four new nullable columns on `event_reviews` (migration 0017) — they cascade with the pair, and `judged_at IS NULL` is the re-judge gate (fingerprint analog). The sweep wires into the tail of `dedupSweep` (after `resolvePendingSameShow`), so the daily 8:00 cron annotates new pairs automatically. **This slice is ANNOTATE-ONLY: the judge never merges, never rejects, never touches events.** The trust boundary is explicit: promotion to auto-merge is a future one-line ruling gated on the eval harness (`npm run judge:eval` over a 38-pair golden set — real dup pairs from production history + curated hard negatives) showing zero false-`same` at the confidence bar, plus live agreement with Tarik's decisions. Framework note (Tarik-researched, 2026-07-11): Vercel's new **Eve** agent framework (Gateway-native, per-agent Vercel Sandbox + file tools, Slack/Discord channels, durable sessions) is the earmarked candidate for the *conversational/research* wing — an admin copilot or web-fetch time-verification agent — where sandboxed tools and channels earn their keep; the judge is one schema'd completion per pair inside an existing cron and stays on the bare AI SDK.

**Tech Stack:** unchanged (Next 16.2.10 / Drizzle 0.45.2 on Neon HTTP / `ai` v7 via AI Gateway / Zod 4 / Vitest 4 + PGlite / Trigger.dev v4 pinned CLI 4.5.1).

## Global Constraints

Every task's requirements implicitly include all of these (Slice 1–4 constraints carry forward; additions in bold):

- **NO PRODUCTION WRITES during implementation.** Sanctioned prod writes live ONLY in the ship checklist: `npm run db:migrate` (0017, pure DDL) and one manual `dedup-daily` trigger to annotate the live queue.
- **`git add` scoped paths only; `git add -A` forbidden. `.env`/`.env.example` untouched** (no new env — `AI_GATEWAY_API_KEY` is reused; absence = judge no-ops, exactly like enrichment).
- **Dual-deploy rule — TRIPPED:** Tasks 3 touches `src/dedup/sweep.ts` (cron-reachable). Ship checklist MUST run `npm run trigger:deploy`.
- **ANNOTATE-ONLY IS A HARD INVARIANT:** no code path in this slice calls `mergeEvents`, `applyReview`, or `claimPendingReview` from judge code. The judge writes ONLY the four new `event_reviews` columns. A reviewer finding any judge-initiated mutation of events/instances/links/status is a Critical.
- **Frozen as ever:** ≥0.80 auto-merge semantics (thresholds/weights/verdicts/survivor choice), same-show rule constants (`SAME_SHOW_VENUE_AFFINITY_MIN = 0.9`, `SAME_SHOW_TIME_DELTA_MAX_MINUTES = 15` — the doors-vs-showtime Δ30min pairs stay queued BY DESIGN; the judge annotates them, the human merges), `tests/dedup/same-show.test.ts` (zero edits), `src/search/hybrid.ts`, `normalizeName`, enrichment-owned columns, `LOCKED_FIELD_VALUES`, lock-aware merge behavior (Slice 4).
- **Never-throws AI calls:** `judgePair` returns `null` on any model/network/validation failure (tag.ts:47-59 contract); a failed judgment is a skip, never a crash, and `judged_at` stays NULL so the next sweep retries.
- ANY date rendering through `src/lib/display.ts` helpers (`chicagoDateLabel`). Zod 4 idioms. `'use server'` discipline (no new action files this slice — the UI change is read-only rendering).
- Tests on PGlite (`tests/helpers/test-db.ts` picks up 0017 automatically); the judge fn is injected (`judgeFn` param defaulting to the real one) so sweeps are tested with fakes — zero AI calls in tests. vitest `maxWorkers: 2`; per-file runs are the arbiter.
- Logic fns ≤ 20 lines where feasible; files ≤ ~300 lines; comments only for constraints code can't show.
- Implementers: **scrutinize plan code, don't transcribe blindly** — verify all anchors; 20+ plan-authored defects have been caught by reviewers across this project.

**Commands:** `npm run test` / `npm run typecheck` / `npm run build` / `npx vitest run <file>` / `npm run db:generate` / `npm run judge:eval` (new) / (ship only) `npm run db:migrate`, `npm run trigger:deploy`.

## Decisions (made in planning; flagged ones await Tarik)

1. **Storage = columns on `event_reviews`, not a new table:** `judge_verdict` (`'same' | 'different' | 'unsure'`, nullable), `judge_confidence` (numeric, nullable), `judge_rationale` (text, nullable), `judged_at` (timestamptz, nullable). Rationale: judgments are properties OF a pending pair; they cascade with it on resolution (consistent with cascade-is-the-contract), and `judged_at IS NULL` gives the sweep its idempotent work-queue for free. The durable record of a HUMAN decision remains the receipt — judge annotations are advisory and ephemeral by design.
2. **Verdict is a 3-value enum, not a boolean:** `unsure` is a first-class output so the model has an honest escape hatch — forcing binary answers on genuinely ambiguous pairs (Summerfest-day vs headliner) manufactures false confidence. UI renders `unsure` as prominently as the others.
3. **Judge inputs are the pair's FACTS, not raw rows:** titles, venue names + same-venue-id flag, minimum start delta in minutes, up to 3 Chicago-rendered start dates per side, source keys per side, URL-match flag, deterministic score. No descriptions (token cost, and titles/venues/times carry the signal for this corpus). The prompt teaches the known confusion families from production history: doors-vs-showtime deltas (≤60min same venue = usually same show), support-act suffixes ("w/", "•"), case variants, "(Touring)" suffixes, year prefixes — and the known trap families: tribute vs original act, different bands same venue same night, watch-party vs the game itself, festival-day vs a specific set inside it.
4. **Sweep placement = tail of `dedupSweep`** (after `resolvePendingSameShow`), so freshly queued pairs are judged in the same cron tick that queues them. `DedupResult` gains a `judged` count (additive — the Trigger task output shape grows a field). Also exposed standalone as `npm run dedup:judge` for backfilling the current queue at ship.
5. **Promotion criteria written down now, wired NEVER (this slice):** auto-merge eligibility would require `judge_verdict = 'same' AND judge_confidence >= 0.9`, gated on (a) `judge:eval` showing **zero false-`same` at ≥0.9** on the golden set, and (b) ≥2 weeks of live annotations agreeing with every human approve/reject. Both criteria go in the README so the future ruling has a written bar. **(AWAITS TARIK only when that day comes — nothing in this slice asks.)**
6. **Golden set ships in-repo** (`eval/judge-pairs.json`): 24 positives distilled from real production dup history (Cactus Club doors-vs-showtime family, case variants, separator variants, "(Touring)", year prefixes, venue-variant families from Slices 2–4) + 14 curated hard negatives (tribute acts, double-headers, watch parties, festival-day-vs-set, same-title-different-venue recurring events). Tarik can edit the file anytime; `judge:eval` is key-gated and reports accuracy overall + the promotion-critical metric: **false-`same` count at confidence ≥ 0.9** (must be 0).
7. **Model = `anthropic/claude-haiku-4-5`** (same as tagging; ~19-pair backfill + a few pairs/day ≈ pennies). The eval harness is how we'd discover haiku is insufficient — switching models is a one-constant change judged by re-running the eval, not a guess.
8. **Eve earmark (Tarik, 2026-07-11):** Vercel's Eve (Gateway-native agents, per-agent Sandbox + file tools, channel deploys) is the recorded candidate for the admin copilot and the web-fetch verification agent (backlog). Out of scope here; noted so the next slice's recon starts there.
9. **Title-cleanup and venue-merge-proposal agents ride to a later slice** — this slice ships one agent end-to-end with its eval, proving the pattern before multiplying it. **(AWAITS TARIK confirm.)**

---

### Task 1: Migration 0017 — judge columns on `event_reviews`

**Files:**
- Modify: `src/db/schema.ts` (eventReviews table, after `resolvedAt`)
- Create: `drizzle/0017_*.sql` (via `npm run db:generate`; commit `drizzle/meta` updates)
- Test: `tests/db/judge-columns.test.ts` (create)

**Interfaces:**
- Produces: `schema.eventReviews.judgeVerdict` (text enum `['same','different','unsure']`, nullable), `.judgeConfidence` (numeric, nullable), `.judgeRationale` (text, nullable), `.judgedAt` (timestamptz, nullable). Tasks 3–5 rely on these exact names.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/judge-columns.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('migration 0017: judge columns', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('judge columns default null and round-trip', async () => {
    const [a] = await db.insert(schema.events)
      .values({ slug: 'ja', title: 'JA', normalizedTitle: 'ja' }).returning();
    const [b] = await db.insert(schema.events)
      .values({ slug: 'jb', title: 'JB', normalizedTitle: 'jb' }).returning();
    const [review] = await db.insert(schema.eventReviews)
      .values({ eventAId: a.id, eventBId: b.id, score: '0.7000', breakdown: {} }).returning();
    expect(review.judgeVerdict).toBeNull();
    expect(review.judgedAt).toBeNull();
    await db.update(schema.eventReviews)
      .set({ judgeVerdict: 'same', judgeConfidence: '0.9300', judgeRationale: 'case variant', judgedAt: new Date() })
      .where(eq(schema.eventReviews.id, review.id));
    const updated = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, review.id) });
    expect(updated).toMatchObject({ judgeVerdict: 'same', judgeRationale: 'case variant' });
    expect(Number(updated?.judgeConfidence)).toBeCloseTo(0.93);
    expect(updated?.judgedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: RED run** — `npx vitest run tests/db/judge-columns.test.ts` → FAIL (columns absent).

- [ ] **Step 3: Schema** — in `src/db/schema.ts`, inside `eventReviews` after `resolvedAt`:

```typescript
    // Advisory AI adjudication (annotate-only — a human still decides). Cascades
    // with the pair; judged_at IS NULL is the sweep's re-judge gate.
    judgeVerdict: text('judge_verdict', { enum: ['same', 'different', 'unsure'] }),
    judgeConfidence: numeric('judge_confidence'),
    judgeRationale: text('judge_rationale'),
    judgedAt: timestamp('judged_at', { withTimezone: true }),
```

- [ ] **Step 4: Generate** — `npm run db:generate`; inspect `drizzle/0017_*.sql`: four `ADD COLUMN`s, pure DDL. Do NOT migrate.

- [ ] **Step 5: GREEN** — 1/1. **Step 6: Typecheck + commit**

```bash
git add src/db/schema.ts drizzle tests/db/judge-columns.test.ts
git commit -m "feat: migration 0017 — advisory judge columns on event_reviews"
```

### Task 2: `judgePair` — the structured adjudication call

**Files:**
- Create: `src/dedup/judge.ts`
- Test: `tests/dedup/judge.test.ts` (create)

**Interfaces:**
- Produces (Tasks 3 and 5 import these exact names):
  - `judgmentSchema` (zod) and `Judgment = z.infer<typeof judgmentSchema>` — `{ sameEvent: boolean; confidence: number; rationale: string }`
  - `JudgePairInput` — see code below
  - `judgePair(input: JudgePairInput): Promise<Judgment | null>` — never throws
  - `buildJudgePrompt(input: JudgePairInput): string` — exported for unit tests and the eval harness
  - `verdictFrom(judgment: Judgment): 'same' | 'different' | 'unsure'` — pure mapping incl. the low-confidence → `unsure` floor

- [ ] **Step 1: Write the failing tests** (pure — no AI calls)

```typescript
// tests/dedup/judge.test.ts
import { describe, expect, it } from 'vitest';
import { buildJudgePrompt, judgmentSchema, verdictFrom, type JudgePairInput } from '@/dedup/judge';

const INPUT: JudgePairInput = {
  aTitle: 'Colin Bracewell • Floryence',
  bTitle: 'Colin Bracewell w/ Floryence',
  venueA: 'Cactus Club',
  venueB: 'Cactus Club',
  sameVenueId: true,
  startDeltaMinutes: 30,
  aStarts: ['Fri, Sep 18, 7:30 PM'],
  bStarts: ['Fri, Sep 18, 8:00 PM'],
  aSources: ['mke-shows'],
  bSources: ['radio-milwaukee'],
  urlMatch: false,
  score: 0.6873,
};

describe('buildJudgePrompt', () => {
  it('carries every pair fact and the confusion-family guidance', () => {
    const prompt = buildJudgePrompt(INPUT);
    for (const fragment of [
      'Colin Bracewell • Floryence', 'Colin Bracewell w/ Floryence', 'Cactus Club',
      'same venue record: yes', '30 minutes', 'mke-shows', 'radio-milwaukee',
      'doors', 'tribute',
    ]) {
      expect(prompt).toContain(fragment);
    }
  });
});

describe('judgmentSchema', () => {
  it('accepts a valid judgment and clamps nothing silently', () => {
    const parsed = judgmentSchema.safeParse({ sameEvent: true, confidence: 0.93, rationale: 'same bill, doors vs showtime' });
    expect(parsed.success).toBe(true);
  });
  it('rejects out-of-range confidence and oversized rationale', () => {
    expect(judgmentSchema.safeParse({ sameEvent: true, confidence: 1.2, rationale: 'x' }).success).toBe(false);
    expect(judgmentSchema.safeParse({ sameEvent: true, confidence: 0.5, rationale: 'x'.repeat(400) }).success).toBe(false);
  });
});

describe('verdictFrom', () => {
  it('maps high-confidence booleans to same/different and low confidence to unsure', () => {
    expect(verdictFrom({ sameEvent: true, confidence: 0.95, rationale: '' })).toBe('same');
    expect(verdictFrom({ sameEvent: false, confidence: 0.9, rationale: '' })).toBe('different');
    expect(verdictFrom({ sameEvent: true, confidence: 0.55, rationale: '' })).toBe('unsure');
  });
});
```

- [ ] **Step 2: RED run** (`npx vitest run tests/dedup/judge.test.ts` → module not found)

- [ ] **Step 3: Implement**

```typescript
// src/dedup/judge.ts
// Advisory dedup adjudicator (annotate-only). Mirrors enrichment/tag.ts: one
// structured haiku call per pair via the AI Gateway; any failure returns null
// so the sweep skips and retries next run. NEVER merges — a human decides.
import { generateText, Output } from 'ai';
import { z } from 'zod';

const JUDGE_MODEL = 'anthropic/claude-haiku-4-5';
const MAX_RATIONALE_CHARS = 240;
/** Below this confidence a boolean answer is rendered as 'unsure' — an honest escape hatch. */
export const UNSURE_BELOW = 0.7;

export const judgmentSchema = z.object({
  sameEvent: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(MAX_RATIONALE_CHARS),
});
export type Judgment = z.infer<typeof judgmentSchema>;

export interface JudgePairInput {
  aTitle: string;
  bTitle: string;
  venueA: string | null;
  venueB: string | null;
  sameVenueId: boolean;
  startDeltaMinutes: number | null;
  aStarts: string[]; // Chicago-rendered, at most 3
  bStarts: string[];
  aSources: string[];
  bSources: string[];
  urlMatch: boolean;
  score: number;
}

export function buildJudgePrompt(input: JudgePairInput): string {
  return [
    'Two Milwaukee event listings from different sources may describe the same real-world event.',
    'Decide whether they are the SAME event occurrence.',
    '',
    `Listing A: "${input.aTitle}" at ${input.venueA ?? 'unknown venue'} — ${input.aStarts.join('; ') || 'no dates'} (sources: ${input.aSources.join(', ')})`,
    `Listing B: "${input.bTitle}" at ${input.venueB ?? 'unknown venue'} — ${input.bStarts.join('; ') || 'no dates'} (sources: ${input.bSources.join(', ')})`,
    `same venue record: ${input.sameVenueId ? 'yes' : 'no'} · closest start delta: ${
      input.startDeltaMinutes === null ? 'unknown' : `${input.startDeltaMinutes} minutes`
    } · canonical URLs match: ${input.urlMatch ? 'yes' : 'no'} · deterministic similarity score: ${input.score.toFixed(2)}`,
    '',
    'Common SAME-event patterns in this corpus: one source lists doors time, the other showtime',
    '(deltas up to ~60 minutes at the same venue); support-act suffixes ("w/ X", "• X"); ALL-CAPS or',
    'punctuation variants; "(Touring)" suffixes; a year prefix ("2026 …").',
    'Common DIFFERENT-event traps: a tribute act vs the original artist; two different bands at the',
    'same venue the same night; a watch party vs the game itself; a festival day vs one specific set',
    'or headliner inside it; the same recurring series title at two different venues.',
    '',
    'sameEvent: true only if these are the same occurrence a person would attend.',
    'confidence: 0-1, your honest certainty. Use low confidence when genuinely ambiguous.',
    `rationale: one sentence, under ${MAX_RATIONALE_CHARS} characters, naming the deciding signal.`,
  ].join('\n');
}

export function verdictFrom(judgment: Judgment): 'same' | 'different' | 'unsure' {
  if (judgment.confidence < UNSURE_BELOW) return 'unsure';
  return judgment.sameEvent ? 'same' : 'different';
}

/** Never throws: any model, network, or validation failure yields null (skip + retry next sweep). */
export async function judgePair(input: JudgePairInput): Promise<Judgment | null> {
  try {
    const { output } = await generateText({
      model: JUDGE_MODEL,
      output: Output.object({ schema: judgmentSchema }),
      prompt: buildJudgePrompt(input),
    });
    return output;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: GREEN** — 5/5. **Step 5: Typecheck + commit**

```bash
git add src/dedup/judge.ts tests/dedup/judge.test.ts
git commit -m "feat: judgePair — structured advisory adjudication call (haiku via gateway)"
```

### Task 3: Judge sweep + wiring into `dedupSweep`

**Files:**
- Create: `src/dedup/judge-sweep.ts`, `src/dedup/run-judge.ts` (CLI)
- Modify: `src/dedup/sweep.ts` (tail of `dedupSweep` + `DedupResult`), `package.json` (script `"dedup:judge": "tsx src/dedup/run-judge.ts"`)
- Test: `tests/dedup/judge-sweep.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 columns; Task 2's `judgePair`, `verdictFrom`, `Judgment`, `JudgePairInput`; `hasGatewayKey` from `@/enrichment/embed` (verify export); `chicagoDateLabel` from `@/lib/display`; existing `dedupSweep`/`DedupResult` (src/dedup/sweep.ts:9-66).
- Produces: `judgePendingReviews(db, opts?: { limit?: number; judgeFn?: typeof judgePair }): Promise<{ judged: number; skipped: number }>`; `DedupResult` gains `judged: number`.

- [ ] **Step 1: Write the failing tests** — DI'd `judgeFn`, zero AI calls; seed with direct inserts (copy tests/dedup neighbors' idiom):

```typescript
// tests/dedup/judge-sweep.test.ts — skeletons; flesh with local seeding helpers
describe('judgePendingReviews', () => {
  it('annotates unjudged pending pairs and skips already-judged ones', async () => {
    // seed 2 pending reviews (pairs of real event rows w/ venues + instances);
    // pre-set judgedAt on the second. Fake judgeFn returns
    // { sameEvent: true, confidence: 0.93, rationale: 'case variant' }.
    // → result { judged: 1, skipped: 0 }; first row has judgeVerdict 'same',
    //   judgeConfidence ~0.93, rationale, judgedAt set; second row untouched
    //   (its judgedAt/verdict unchanged — assert exact prior values).
  });

  it('a null judgment is a skip and leaves judgedAt NULL for retry', async () => {
    // fake judgeFn returns null → { judged: 0, skipped: 1 }; columns still NULL.
  });

  it('maps low confidence to unsure via verdictFrom', async () => {
    // fake returns { sameEvent: true, confidence: 0.5, ... } → judgeVerdict 'unsure'.
  });

  it('builds inputs from live pair state (titles, venues, delta, chicago dates, sources)', async () => {
    // capture the input the fake judgeFn receives; assert aTitle/bTitle, venue names,
    // sameVenueId true/false as seeded, startDeltaMinutes computed, aStarts rendered
    // via chicagoDateLabel, source keys present.
  });

  it('resolved (rejected) rows are never judged', async () => {
    // seed a rejected review → not selected; { judged: 0, skipped: 0 }.
  });

  it('ANNOTATE-ONLY invariant: events, instances, links, and review status are byte-untouched', async () => {
    // snapshot counts + the pending row's status before; run sweep; assert events/instances/
    // links counts identical, status still 'pending', resolvedAt still null.
  });
});
```

- [ ] **Step 2: RED run** (`npx vitest run tests/dedup/judge-sweep.test.ts`)

- [ ] **Step 3: Implement**

```typescript
// src/dedup/judge-sweep.ts
// Advisory annotation pass over pending review pairs (annotate-only — writes
// ONLY the judge_* columns; a human still resolves every pair). No-key = no-op,
// exactly like the enrichment sweep.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { hasGatewayKey } from '@/enrichment/embed';
import { chicagoDateLabel } from '@/lib/display';
import type { Db } from '@/db/types';
import { judgePair, verdictFrom, type JudgePairInput, type Judgment } from './judge';

const DEFAULT_JUDGE_LIMIT = 50;
const MAX_STARTS_IN_PROMPT = 3;

export interface JudgeSweepResult {
  judged: number;
  skipped: number;
}

type PendingRow = typeof schema.eventReviews.$inferSelect;

async function fetchUnjudgedPending(db: Db, limit: number): Promise<PendingRow[]> {
  return db.query.eventReviews.findMany({
    where: and(eq(schema.eventReviews.status, 'pending'), isNull(schema.eventReviews.judgedAt)),
    limit,
  });
}

interface PairSide {
  title: string;
  venueName: string | null;
  venueId: string | null;
  starts: Date[];
  sources: string[];
  canonicalUrl: string | null;
}

async function loadSide(db: Db, eventId: string): Promise<PairSide | null> {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    with: {
      venue: { columns: { name: true } },
      instances: { columns: { startAt: true } },
      sourceLinks: { with: { source: { columns: { key: true } } } },
    },
  });
  if (!event) return null;
  return {
    title: event.title,
    venueName: event.venue?.name ?? null,
    venueId: event.venueId,
    starts: event.instances.map((i) => i.startAt).sort((a, b) => a.getTime() - b.getTime()),
    sources: event.sourceLinks.map((l) => l.source.key),
    canonicalUrl: event.canonicalUrl,
  };
}

function minDeltaMinutes(a: Date[], b: Date[]): number | null {
  let min: number | null = null;
  for (const x of a) for (const y of b) {
    const delta = Math.abs(x.getTime() - y.getTime()) / 60_000;
    if (min === null || delta < min) min = delta;
  }
  return min === null ? null : Math.round(min);
}

function toJudgeInput(review: PendingRow, a: PairSide, b: PairSide): JudgePairInput {
  return {
    aTitle: a.title,
    bTitle: b.title,
    venueA: a.venueName,
    venueB: b.venueName,
    sameVenueId: a.venueId !== null && a.venueId === b.venueId,
    startDeltaMinutes: minDeltaMinutes(a.starts, b.starts),
    aStarts: a.starts.slice(0, MAX_STARTS_IN_PROMPT).map(chicagoDateLabel),
    bStarts: b.starts.slice(0, MAX_STARTS_IN_PROMPT).map(chicagoDateLabel),
    aSources: a.sources,
    bSources: b.sources,
    urlMatch: a.canonicalUrl !== null && a.canonicalUrl === b.canonicalUrl,
    score: Number(review.score),
  };
}

async function recordJudgment(db: Db, reviewId: string, judgment: Judgment): Promise<void> {
  await db
    .update(schema.eventReviews)
    .set({
      judgeVerdict: verdictFrom(judgment),
      judgeConfidence: judgment.confidence.toFixed(4),
      judgeRationale: judgment.rationale,
      judgedAt: new Date(),
    })
    .where(and(eq(schema.eventReviews.id, reviewId), isNull(schema.eventReviews.judgedAt)));
}

export async function judgePendingReviews(
  db: Db,
  opts: { limit?: number; judgeFn?: typeof judgePair } = {},
): Promise<JudgeSweepResult> {
  if (!hasGatewayKey()) return { judged: 0, skipped: 0 };
  const judgeFn = opts.judgeFn ?? judgePair;
  const rows = await fetchUnjudgedPending(db, opts.limit ?? DEFAULT_JUDGE_LIMIT);
  const result: JudgeSweepResult = { judged: 0, skipped: 0 };
  for (const review of rows) {
    const [a, b] = await Promise.all([loadSide(db, review.eventAId), loadSide(db, review.eventBId)]);
    if (!a || !b) {
      result.skipped += 1; // pair raced away mid-sweep — tolerate, next sweep won't see it
      continue;
    }
    const judgment = await judgeFn(toJudgeInput(review, a, b));
    if (!judgment) {
      result.skipped += 1; // judgedAt stays NULL — retried next sweep
      continue;
    }
    await recordJudgment(db, review.id, judgment);
    result.judged += 1;
  }
  return result;
}
```

NOTE for implementer: tests bypass the `hasGatewayKey()` gate by stubbing — check how `tests/enrichment/` handles it (vi.stubEnv of `AI_GATEWAY_API_KEY` or equivalent) and copy that idiom; the DI'd `judgeFn` means no real call happens either way.

`src/dedup/sweep.ts` — tail of `dedupSweep` (after the `resolvePendingSameShow` lines) plus the result type:

```typescript
export interface DedupResult {
  examined: number;
  merged: number;
  queued: number;
  judged: number;
}
```

```typescript
  const backlog = await resolvePendingSameShow(db);
  result.merged += backlog.merged;
  // Advisory annotation of whatever is left pending — annotate-only, never merges.
  const judgeOutcome = await judgePendingReviews(db);
  result.judged = judgeOutcome.judged;
  return result;
```

(with `import { judgePendingReviews } from './judge-sweep';` and `result` initialized with `judged: 0`; the existing `tests/dedup/sweep.test.ts`/`determinism.test.ts` assertions on DedupResult may need the additive field — extend those assertions, do NOT weaken them; no-key test env means `judged: 0` everywhere existing tests run.)

`src/dedup/run-judge.ts` (CLI, guarded-main per `src/maintenance/assign-neighborhoods.ts` idiom):

```typescript
// Standalone advisory judge pass over pending review pairs (annotate-only).
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { judgePendingReviews } from './judge-sweep';

async function main(): Promise<void> {
  const { db } = await import('@/db');
  const result = await judgePendingReviews(db);
  console.log(`judged ${result.judged}, skipped ${result.skipped}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: GREEN + dedup canary** — `npx vitest run tests/dedup/` ALL green (incl. frozen same-show; extend sweep/determinism DedupResult assertions additively).

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/dedup/judge-sweep.ts src/dedup/run-judge.ts src/dedup/sweep.ts package.json tests/dedup/judge-sweep.test.ts tests/dedup/sweep.test.ts tests/dedup/determinism.test.ts
git commit -m "feat: advisory judge sweep wired into dedupSweep tail (annotate-only)"
```

### Task 4: Judge annotations in `/admin/review`

**Files:**
- Modify: `src/queries/admin-reviews.ts` (PendingReviewPair + pendingReviewPairs), `src/app/admin/review/page.tsx` (render badge + rationale)
- Test: `tests/queries/admin-reviews.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `PendingReviewPair` gains `judge: { verdict: 'same' | 'different' | 'unsure'; confidence: number; rationale: string } | null`.

- [ ] **Step 1: Failing test** — extend `tests/queries/admin-reviews.test.ts` with the file's seeding idiom: one judged pending pair (set the four columns directly) and one unjudged; assert the judged pair carries `judge: { verdict: 'same', confidence ~0.93, rationale }` and the unjudged carries `judge: null`.

- [ ] **Step 2: RED run.**

- [ ] **Step 3: Query** — in `pendingReviewPairs`'s pair-building loop:

```typescript
      judge:
        review.judgedAt === null || review.judgeVerdict === null
          ? null
          : {
              verdict: review.judgeVerdict,
              confidence: Number(review.judgeConfidence ?? 0),
              rationale: review.judgeRationale ?? '',
            },
```

(and the interface field `judge: { verdict: 'same' | 'different' | 'unsure'; confidence: number; rationale: string } | null;` on `PendingReviewPair`.)

- [ ] **Step 4: Page** — in `src/app/admin/review/page.tsx`, inside the pair Card between the header and the side-by-side grid:

```tsx
                  {pair.judge ? (
                    <p className="text-sm text-ink-muted">
                      <Badge
                        variant={
                          pair.judge.verdict === 'same'
                            ? 'default'
                            : pair.judge.verdict === 'different'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        AI: {pair.judge.verdict} {Math.round(pair.judge.confidence * 100)}%
                      </Badge>{' '}
                      {pair.judge.rationale}
                    </p>
                  ) : null}
```

(Verify `Badge` import already present; advisory copy note in the page intro: append "AI verdicts are advisory — you decide." to the existing header paragraph.)

- [ ] **Step 5: GREEN + gates** — extended query tests green; `npm run typecheck` && `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add src/queries/admin-reviews.ts src/app/admin/review/page.tsx tests/queries/admin-reviews.test.ts
git commit -m "feat: render advisory judge verdicts and rationale in the review queue"
```

### Task 5: Judge eval harness + golden set

**Files:**
- Create: `eval/judge-pairs.json`, `src/dedup/judge-eval.ts`
- Modify: `package.json` (script `"judge:eval": "tsx src/dedup/judge-eval.ts"`)
- Test: `tests/dedup/judge-eval.test.ts` (create — the metrics fn, not the AI call)

**Interfaces:**
- Consumes: Task 2's `judgePair`, `verdictFrom`, `buildJudgePrompt` types; the fixture schema below.
- Produces: `npm run judge:eval` — key-gated CLI printing per-pair verdicts and the summary: accuracy, unsure rate, and **false-`same` count at confidence ≥ 0.9** (the promotion gate; must be 0). Exports `scoreEval(rows: EvalOutcome[]): EvalSummary` for unit tests.

- [ ] **Step 1: The golden set** — create `eval/judge-pairs.json` with exactly this content (24 positives from production dup history + 14 curated negatives; Tarik may edit anytime):

```json
[
  {"aTitle":"Colin Bracewell • Floryence","bTitle":"Colin Bracewell w/ Floryence","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["mke-shows"],"bSources":["radio-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"The Appleseed Cast w/ The Casket Lottery","bTitle":"The Appleseed Cast • Casket Lottery","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["radio-milwaukee"],"bSources":["mke-shows"],"urlMatch":false,"expected":"same"},
  {"aTitle":"JADY","bTitle":"Jady","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["mke-shows"],"bSources":["radio-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Iluka","bTitle":"ILUKA","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["mke-shows"],"bSources":["radio-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Billy Allen + The Pollies","bTitle":"BILLY ALLEN + THE POLLIES","venueA":"Vivarium","venueB":"Vivarium","sameVenueId":true,"startDeltaMinutes":30,"aSources":["visit-milwaukee"],"bSources":["mke-shows"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Dent May","bTitle":"Dent May","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["mke-shows"],"bSources":["radio-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Squirrel Flower w/ Sour Widows","bTitle":"Squirrel Flower • Sour Widows","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["radio-milwaukee"],"bSources":["mke-shows"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Sweeping Promises","bTitle":"Sweeping Promises • Youth Energy","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["mke-shows"],"bSources":["radio-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Monty Python's Spamalot (Touring)","bTitle":"Monty Python’s Spamalot","venueA":"Uihlein Hall Marcus Center","venueB":"929 N. Water St.","sameVenueId":false,"startDeltaMinutes":0,"aSources":["ticketmaster-milwaukee"],"bSources":["urban-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Milwaukee Dragon Boat Festival","bTitle":"2026 Milwaukee Dragon Boat Festival","venueA":"Henry Maier Festival Park","venueB":"Summerfest Grounds South Gate Plaza","sameVenueId":false,"startDeltaMinutes":480,"aSources":["milwaukee-world-festival"],"bSources":["visit-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Bastille Days","bTitle":"Bastille Days","venueA":"Cathedral Square Park","venueB":"520 E. Wells St.","sameVenueId":false,"startDeltaMinutes":0,"aSources":["visit-milwaukee"],"bSources":["urban-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Death Cab for Cutie","bTitle":"Death Cab For Cutie w/ Slow Pulp","venueA":"Riverside Theater","venueB":"The Riverside Theater","sameVenueId":false,"startDeltaMinutes":0,"aSources":["pabst-theater-group"],"bSources":["ticketmaster-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Beach Boys","bTitle":"The Beach Boys","venueA":"Riverside Theater","venueB":"Riverside Theatre - WI","sameVenueId":false,"startDeltaMinutes":5,"aSources":["pabst-theater-group"],"bSources":["ticketmaster-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"MKE Unplugged","bTitle":"MKE Unplugged","venueA":"Shank Hall","venueB":"Shank Hall - 1434 N Farwell Ave Milwaukee","sameVenueId":false,"startDeltaMinutes":0,"aSources":["urban-milwaukee"],"bSources":["mke-shows"],"urlMatch":false,"expected":"same"},
  {"aTitle":"St. Bernadette Parish Rummage Sale","bTitle":"St. Bernadette Parish Rummage Sale","venueA":"St. Bernadette Parish-Milwaukee","venueB":"8200 W. Denver Ave.","sameVenueId":false,"startDeltaMinutes":0,"aSources":["visit-milwaukee"],"bSources":["urban-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Ian McConnell","bTitle":"Ian McConnell","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["mke-shows"],"bSources":["radio-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Healing Gems","bTitle":"Healing Gems","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["mke-shows"],"bSources":["radio-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Dana and Alden","bTitle":"Dana and Alden","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["mke-shows"],"bSources":["radio-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Frail Talk","bTitle":"Frail Talk","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["mke-shows"],"bSources":["radio-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Croz Boyce","bTitle":"Croz Boyce","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":30,"aSources":["mke-shows"],"bSources":["radio-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Derek Hough: Dance for the Holidays","bTitle":"Derek Hough Dance For The Holidays","venueA":"Riverside Theater","venueB":"Riverside Theater","sameVenueId":true,"startDeltaMinutes":0,"aSources":["pabst-theater-group"],"bSources":["ticketmaster-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Brewers vs. Texas Rangers","bTitle":"Milwaukee Brewers vs. Texas Rangers","venueA":"American Family Field","venueB":"American Family Field","sameVenueId":true,"startDeltaMinutes":0,"aSources":["brewers"],"bSources":["ticketmaster-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Khruangbin","bTitle":"Khruangbin — A LA SALA Tour","venueA":"Miller High Life Theatre","venueB":"Miller High Life Theatre","sameVenueId":true,"startDeltaMinutes":15,"aSources":["pabst-theater-group"],"bSources":["ticketmaster-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Jazz in the Park","bTitle":"Jazz in the Park ft. Anderson Trio","venueA":"Cathedral Square Park","venueB":"Cathedral Square Park","sameVenueId":true,"startDeltaMinutes":0,"aSources":["visit-milwaukee"],"bSources":["urban-milwaukee"],"urlMatch":false,"expected":"same"},
  {"aTitle":"Nevermind — Nirvana Tribute","bTitle":"Nirvana","venueA":"The Rave-Eagles Club","venueB":"The Rave-Eagles Club","sameVenueId":true,"startDeltaMinutes":0,"aSources":["mke-shows"],"bSources":["ticketmaster-milwaukee"],"urlMatch":false,"expected":"different"},
  {"aTitle":"Dead Horses (early show)","bTitle":"Fox Face (late show)","venueA":"Cactus Club","venueB":"Cactus Club","sameVenueId":true,"startDeltaMinutes":180,"aSources":["mke-shows"],"bSources":["mke-shows"],"urlMatch":false,"expected":"different"},
  {"aTitle":"Brewers vs. Cubs Watch Party","bTitle":"Brewers vs. Chicago Cubs","venueA":"Nomad World Pub","venueB":"American Family Field","sameVenueId":false,"startDeltaMinutes":0,"aSources":["urban-milwaukee"],"bSources":["brewers"],"urlMatch":false,"expected":"different"},
  {"aTitle":"Summerfest — Day 3","bTitle":"Hozier at the AmFam Amphitheater","venueA":"Henry Maier Festival Park","venueB":"The American Family Insurance Amphitheater","sameVenueId":false,"startDeltaMinutes":120,"aSources":["milwaukee-world-festival"],"bSources":["ticketmaster-milwaukee"],"urlMatch":false,"expected":"different"},
  {"aTitle":"Open Mic Night","bTitle":"Open Mic Night","venueA":"Linnemans","venueB":"The Coffee House","sameVenueId":false,"startDeltaMinutes":30,"aSources":["linnemans"],"bSources":["urban-milwaukee"],"urlMatch":false,"expected":"different"},
  {"aTitle":"Drag Brunch","bTitle":"Drag Bingo","venueA":"This Is It!","venueB":"This Is It!","sameVenueId":true,"startDeltaMinutes":360,"aSources":["urban-milwaukee"],"bSources":["visit-milwaukee"],"urlMatch":false,"expected":"different"},
  {"aTitle":"WMSE Backyard BBQ","bTitle":"88Nine Backyard Block Party","venueA":"Humboldt Park","venueB":"Radio Milwaukee","sameVenueId":false,"startDeltaMinutes":60,"aSources":["wmse"],"bSources":["radio-milwaukee"],"urlMatch":false,"expected":"different"},
  {"aTitle":"Milwaukee Night Market","bTitle":"Riverwest Night Market","venueA":"Wisconsin Avenue","venueB":"Riverwest","sameVenueId":false,"startDeltaMinutes":0,"aSources":["milwaukee-downtown"],"bSources":["urban-milwaukee"],"urlMatch":false,"expected":"different"},
  {"aTitle":"The Fitzgerald presents: Vinyl Night","bTitle":"Vinyl Night at Vivarium","venueA":"The Fitzgerald","venueB":"Vivarium","sameVenueId":false,"startDeltaMinutes":0,"aSources":["pabst-theater-group"],"bSources":["pabst-theater-group"],"urlMatch":false,"expected":"different"},
  {"aTitle":"Shakespeare in the Park: Hamlet","bTitle":"Shakespeare in the Park: Twelfth Night","venueA":"Kadish Park","venueB":"Kadish Park","sameVenueId":true,"startDeltaMinutes":1440,"aSources":["urban-milwaukee"],"bSources":["visit-milwaukee"],"urlMatch":false,"expected":"different"},
  {"aTitle":"Cactus Club Comedy Night","bTitle":"Comedy Night","venueA":"Cactus Club","venueB":"The Laughing Tap","sameVenueId":false,"startDeltaMinutes":15,"aSources":["mke-shows"],"bSources":["urban-milwaukee"],"urlMatch":false,"expected":"different"},
  {"aTitle":"Harley-Davidson Homecoming Festival","bTitle":"Harley-Davidson Museum Bike Night","venueA":"Veterans Park","venueB":"Harley-Davidson Museum","sameVenueId":false,"startDeltaMinutes":240,"aSources":["visit-milwaukee"],"bSources":["urban-milwaukee"],"urlMatch":false,"expected":"different"},
  {"aTitle":"Christmas in the Ward","bTitle":"Christmas in the Country","venueA":"Catalano Square","venueB":"Franklin","sameVenueId":false,"startDeltaMinutes":90,"aSources":["milwaukee-downtown"],"bSources":["visit-milwaukee"],"urlMatch":false,"expected":"different"},
  {"aTitle":"New Year's Eve at The Pfister","bTitle":"New Year's Eve Fireworks","venueA":"The Pfister Hotel","venueB":"Veterans Park","sameVenueId":false,"startDeltaMinutes":120,"aSources":["visit-milwaukee"],"bSources":["urban-milwaukee"],"urlMatch":false,"expected":"different"}
]
```

- [ ] **Step 2: Failing metrics test**

```typescript
// tests/dedup/judge-eval.test.ts
import { describe, expect, it } from 'vitest';
import { scoreEval, type EvalOutcome } from '@/dedup/judge-eval';

const outcome = (expected: 'same' | 'different', verdict: 'same' | 'different' | 'unsure', confidence: number): EvalOutcome =>
  ({ expected, verdict, confidence, aTitle: 'a', bTitle: 'b' });

describe('scoreEval', () => {
  it('computes accuracy, unsure rate, and the promotion-gate false-same count', () => {
    const summary = scoreEval([
      outcome('same', 'same', 0.95),
      outcome('same', 'unsure', 0.5),
      outcome('different', 'different', 0.9),
      outcome('different', 'same', 0.95), // the dangerous one
      outcome('different', 'same', 0.7),  // wrong but below the auto-merge bar
    ]);
    expect(summary.total).toBe(5);
    expect(summary.correct).toBe(2);
    expect(summary.unsure).toBe(1);
    expect(summary.falseSameAtBar).toBe(1); // only the >= 0.9 false-same counts against promotion
  });
});
```

- [ ] **Step 3: RED run**, then implement:

```typescript
// src/dedup/judge-eval.ts
// Offline judge eval over the golden set (eval/judge-pairs.json). Key-gated.
// The promotion gate for ever granting auto-merge: falseSameAtBar MUST be 0.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { hasGatewayKey } from '@/enrichment/embed';
import { judgePair, verdictFrom, type JudgePairInput } from './judge';

const PAIRS_PATH = join(process.cwd(), 'eval/judge-pairs.json');
/** Matches Decision 5's promotion bar — a false 'same' at or above this sinks promotion. */
const AUTO_MERGE_CONFIDENCE_BAR = 0.9;

const evalPairSchema = z.object({
  aTitle: z.string(),
  bTitle: z.string(),
  venueA: z.string().nullable(),
  venueB: z.string().nullable(),
  sameVenueId: z.boolean(),
  startDeltaMinutes: z.number().nullable(),
  aSources: z.array(z.string()),
  bSources: z.array(z.string()),
  urlMatch: z.boolean(),
  expected: z.enum(['same', 'different']),
});
type EvalPair = z.infer<typeof evalPairSchema>;

export interface EvalOutcome {
  aTitle: string;
  bTitle: string;
  expected: 'same' | 'different';
  verdict: 'same' | 'different' | 'unsure';
  confidence: number;
}

export interface EvalSummary {
  total: number;
  correct: number;
  unsure: number;
  falseSameAtBar: number;
}

export function scoreEval(rows: EvalOutcome[]): EvalSummary {
  return {
    total: rows.length,
    correct: rows.filter((row) => row.verdict === row.expected).length,
    unsure: rows.filter((row) => row.verdict === 'unsure').length,
    falseSameAtBar: rows.filter(
      (row) => row.expected === 'different' && row.verdict === 'same' && row.confidence >= AUTO_MERGE_CONFIDENCE_BAR,
    ).length,
  };
}

function toInput(pair: EvalPair): JudgePairInput {
  return {
    ...pair,
    aStarts: [], // golden pairs carry deltas, not absolute dates — the prompt handles 'no dates'
    bStarts: [],
    score: 0.7, // representative review-band score
  };
}

async function main(): Promise<void> {
  if (!hasGatewayKey()) {
    console.log('AI_GATEWAY_API_KEY not set — judge eval skipped.');
    return;
  }
  const pairs = z.array(evalPairSchema).parse(JSON.parse(readFileSync(PAIRS_PATH, 'utf-8')));
  const outcomes: EvalOutcome[] = [];
  for (const pair of pairs) {
    const judgment = await judgePair(toInput(pair));
    const verdict = judgment ? verdictFrom(judgment) : 'unsure';
    const confidence = judgment?.confidence ?? 0;
    outcomes.push({ aTitle: pair.aTitle, bTitle: pair.bTitle, expected: pair.expected, verdict, confidence });
    const mark = verdict === pair.expected ? 'PASS' : verdict === 'unsure' ? 'UNSURE' : 'FAIL';
    console.log(`${mark.padEnd(7)} [${pair.expected}] "${pair.aTitle}" vs "${pair.bTitle}" → ${verdict} ${(confidence * 100).toFixed(0)}%`);
  }
  const summary = scoreEval(outcomes);
  console.log('');
  console.log(`accuracy ${summary.correct}/${summary.total} · unsure ${summary.unsure} · FALSE-SAME AT >= ${AUTO_MERGE_CONFIDENCE_BAR}: ${summary.falseSameAtBar} (promotion gate: must be 0)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

Add `"judge:eval": "tsx src/dedup/judge-eval.ts"` to package.json scripts.

- [ ] **Step 4: GREEN** (metrics test) + typecheck. Do NOT run the live eval here (key-gated ship step).

- [ ] **Step 5: Commit**

```bash
git add eval/judge-pairs.json src/dedup/judge-eval.ts package.json tests/dedup/judge-eval.test.ts
git commit -m "feat: judge eval harness + 38-pair golden set with promotion gate metric"
```

### Task 6: README, gates, ship checklist

**Files:**
- Modify: `README.md` (AI judge section under the dedup docs)

- [ ] **Step 1: README** — new "AI dedup judge (advisory)" subsection: what it annotates and when (dedup cron tail + `npm run dedup:judge`), the three verdicts incl. why `unsure` exists, ANNOTATE-ONLY (a human resolves every pair; the judge writes only `judge_*` columns), no-key = no-op, cost order-of-magnitude, `npm run judge:eval` + the written promotion criteria from Decision 5 (zero false-`same` at ≥0.9 on the golden set AND ≥2 weeks live agreement — future Tarik ruling, nothing auto-merges today). Claims must trace to source (reviewer audits).
- [ ] **Step 2: Full gates, sequentially, quiet machine** — `npm run test` (~460+ expected), `npm run typecheck`, `npm run build`, `npm run e2e` (17 — no new routes).
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: advisory AI dedup judge — behavior, verdicts, eval, promotion criteria"
```

- [ ] **Step 4: Ship checklist (finishing pass — do NOT execute in-task)**

1. Merge → main, push. 2. `npm run db:migrate` (0017; verify columns by read). 3. `vercel deploy --prod`. 4. **`npm run trigger:deploy` MANDATORY** (sweep.ts touched). 5. `npm run judge:eval` against the gateway — record the baseline table + summary (the first datapoint for the promotion decision). 6. `npm run dedup:judge` (or manual `dedup-daily` trigger) → the ~19 pending pairs get annotated; verify by SQL (judged count, verdict distribution) + Tarik eyeballs `/admin/review` rationales. 7. Evidence comment + close the slice issue. 8. Live-agreement tracking starts: every future human approve/reject vs the pair's judge verdict is the promotion dataset.

## Verification summary

- Judge annotates every pending pair from the cron tail, annotate-only invariant regression-tested (Task 3's byte-untouched test) — the queue becomes 5-second decisions (Task 4's badges + rationale).
- The promotion gate exists as a number before anyone asks to automate: `judge:eval`'s false-`same`-at-bar over a golden set of 24 real positives + 14 curated hard negatives (Task 5).
- No new env, no new vendor, no framework: tag.ts pattern + AI Gateway + Trigger.dev, end to end.

## Open rulings for Tarik (asked at plan review)

1. Execution mode (subagent-driven recommended).
2. Scope confirm: judge-only this slice; title-cleanup + venue-merge-proposal agents ride to a later slice (recommended — prove one agent end-to-end with its eval first).
