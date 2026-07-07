# Phase 2c: Dedup, Review Queue & Trigger.dev Scheduling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close MOO-255 by adding cross-source dedup/clustering with a review queue, scheduled ingestion via Trigger.dev, and the accumulated must-fix list from the 2a/2b review cycles.

**Architecture:** Dedup is a post-ingest sweep: candidate pairs blocked by same Chicago calendar day (cross-source only), scored by pg_trgm title similarity + venue affinity + start-time proximity + URL match; high scores auto-merge (links + instances repointed onto the confidence-ladder winner, receipt in `event_clusters`), ambiguous scores land in `event_reviews`. Scheduling is two declarative Trigger.dev schedules (daily near-term, weekly deep) fanning out to one `ingest-source` task serialized per source via `concurrencyKey`; the same-source link race is ALSO fixed at the persistence layer (catch-and-refetch) so CLI runs are safe. Instance supersede becomes source-aware (new `event_instances.source_id`) BEFORE dedup can consolidate multi-source instances — task order enforces this.

**Tech Stack:** Next.js 16 / Drizzle 0.45 / Neon (HTTP driver — **no transactions**) / PGlite 0.5.4 tests (pg_trgm contrib) / Zod 4 / Vitest 4 / Trigger.dev v4 SDK.

## Global Constraints

Every task's requirements implicitly include all of these:

- Functions ≤ 20 lines; files focused (≤ ~400 lines); extract helpers rather than grow functions.
- All timestamps `timestamp(..., { withTimezone: true })` (timestamptz). Never naive.
- Zod validation at every boundary: adapter configs, payloads, Trigger task payloads.
- Secrets env-only (`.env`, gitignored). Never in committed files. Trigger.dev project ref is NOT a secret (committable).
- Tests run on PGlite only (no cloud DB), replaying the real `drizzle/*.sql` migrations via `tests/helpers/test-db.ts`.
- ANY date logic goes through `src/lib/chicago-time.ts` helpers (UTC-vs-Chicago bugs shipped twice already).
- Neon HTTP driver has NO transactions: order multi-row writes so partial failure is recoverable; compensate or make idempotent; comment the ordering rationale.
- jsonld fallback-id format (`name|startDate|venueName`) is FROZEN. Do not touch.
- The multi-day day-instance pattern (one event, one instance per day, shared sourceEventId — e.g. Summerfest 1 event / 9 instances) must survive every change; supersede stays disabled when a sourceEventId repeats within a batch.
- Trigger.dev imports from `@trigger.dev/sdk` (v4 path — never `@trigger.dev/sdk/v3`).
- `console.*` only in CLI entrypoints (`src/**/run.ts`, `src/db/seed.ts`) — never in library code.
- Live ingest runs against production Neon are authorized but ALWAYS sequential until Task 12 is verified.

**Commands:** `npm run test` / `npm run typecheck` / `npm run db:generate` / `npm run db:migrate`. Run `db:migrate` against production only in the task that says so.

---

### Task 1: Relocate chicago-time.ts to src/lib + pin year-boundary behavior

**Files:**
- Move: `src/ingestion/adapters/html/chicago-time.ts` → `src/lib/chicago-time.ts` (git mv, content unchanged)
- Modify: `src/ingestion/adapters/mlb.ts:3`, `src/ingestion/adapters/html/sources/radio-milwaukee.ts:5`, `src/ingestion/adapters/html/sources/milwaukee-world-festival.ts:23`, `src/ingestion/adapters/html/sources/pabst-theater-group.ts:11`, `src/ingestion/adapters/html/sources/milwaukee-downtown.ts:24`
- Test: `tests/lib/chicago-time.test.ts` (create)

**Interfaces:**
- Consumes: existing exports `chicagoParts(utcMs)`, `chicagoOffsetMinutes(utcMs)`, `chicagoWallTimeToIso(year, month, day, hour, minute)`.
- Produces: same three functions importable as `@/lib/chicago-time` (Task 2 adds a fourth export here; all later date work imports this path).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/chicago-time.test.ts
import { describe, expect, it } from 'vitest';
import { chicagoWallTimeToIso } from '@/lib/chicago-time';

describe('chicagoWallTimeToIso', () => {
  it('converts a CST winter wall time (UTC-6)', () => {
    expect(chicagoWallTimeToIso(2026, 1, 15, 19, 0)).toBe('2026-01-16T01:00:00.000Z');
  });

  it('converts a CDT summer wall time (UTC-5)', () => {
    expect(chicagoWallTimeToIso(2026, 7, 4, 12, 0)).toBe('2026-07-04T17:00:00.000Z');
  });

  it('crosses the Dec 31 → Jan 1 boundary without year drift', () => {
    expect(chicagoWallTimeToIso(2026, 12, 31, 23, 30)).toBe('2027-01-01T05:30:00.000Z');
  });

  it('handles Jan 1 midnight wall time', () => {
    expect(chicagoWallTimeToIso(2027, 1, 1, 0, 0)).toBe('2027-01-01T06:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/chicago-time.test.ts`
Expected: FAIL — `Cannot find module '@/lib/chicago-time'` (alias resolves to `src/lib/`, file not there yet).

- [ ] **Step 3: Move the file and update the five imports**

```bash
git mv src/ingestion/adapters/html/chicago-time.ts src/lib/chicago-time.ts
```

In each of the five importers, replace the old specifier with `@/lib/chicago-time`:
- `src/ingestion/adapters/mlb.ts:3`: `import { chicagoParts } from './html/chicago-time';` → `import { chicagoParts } from '@/lib/chicago-time';`
- `src/ingestion/adapters/html/sources/radio-milwaukee.ts:5`: `from '../chicago-time'` → `from '@/lib/chicago-time'`
- `src/ingestion/adapters/html/sources/milwaukee-world-festival.ts:23`: same replacement
- `src/ingestion/adapters/html/sources/pabst-theater-group.ts:11`: same replacement
- `src/ingestion/adapters/html/sources/milwaukee-downtown.ts:24`: same replacement

- [ ] **Step 4: Run tests + typecheck to verify green**

Run: `npx vitest run tests/lib/chicago-time.test.ts && npm run typecheck && npm run test`
Expected: new file PASS (4 tests), typecheck clean, full suite green (111 + 4).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: relocate chicago-time to src/lib, pin year-boundary conversions"
```

---

### Task 2: Cross-midnight end-time rollover (radio-milwaukee drops 9PM–1AM shows today)

A "9:00 PM - 1:00 AM" card computes endAt on the SAME calendar day as startAt → endAt < startAt → the `normalizedEventSchema` refine rejects it → record silently dropped. Fix at the source that derives end from start's date.

**Files:**
- Modify: `src/lib/chicago-time.ts` (add `rollEndAtForward`)
- Modify: `src/ingestion/adapters/html/sources/radio-milwaukee.ts` (`explicitOccurrence` ~line 42, `recurringOccurrence` ~line 57)
- Test: `tests/lib/chicago-time.test.ts`, `tests/ingestion/sources-radio-milwaukee.test.ts`

**Interfaces:**
- Consumes: `chicagoWallTimeToIso` (Task 1 location).
- Produces: `rollEndAtForward(startIso: string, endIso: string): string` exported from `@/lib/chicago-time`.

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/lib/chicago-time.test.ts`:

```typescript
import { rollEndAtForward } from '@/lib/chicago-time';

describe('rollEndAtForward', () => {
  it('rolls a cross-midnight end forward 24h', () => {
    const start = '2026-07-11T02:00:00.000Z'; // 9:00 PM Jul 10 Chicago
    const end = '2026-07-10T06:00:00.000Z'; // 1:00 AM Jul 10 Chicago (same-day derived)
    expect(rollEndAtForward(start, end)).toBe('2026-07-11T06:00:00.000Z');
  });

  it('leaves end after start untouched', () => {
    const start = '2026-07-11T02:00:00.000Z';
    const end = '2026-07-11T04:00:00.000Z';
    expect(rollEndAtForward(start, end)).toBe(end);
  });

  it('leaves end equal to start untouched', () => {
    const iso = '2026-07-11T02:00:00.000Z';
    expect(rollEndAtForward(iso, iso)).toBe(iso);
  });

  it('returns end unchanged when either side is unparseable', () => {
    expect(rollEndAtForward('garbage', '2026-07-11T02:00:00.000Z')).toBe('2026-07-11T02:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/lib/chicago-time.test.ts`
Expected: FAIL — `rollEndAtForward` is not exported.

- [ ] **Step 3: Implement `rollEndAtForward`**

Append to `src/lib/chicago-time.ts`:

```typescript
/**
 * Rolls a same-day-derived end time forward 24h when it lands strictly before
 * the start (a cross-midnight show like "9:00 PM - 1:00 AM"). Ends at or after
 * the start — and unparseable inputs — pass through unchanged.
 */
export function rollEndAtForward(startIso: string, endIso: string): string {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end >= start) return endIso;
  return new Date(end + 86_400_000).toISOString();
}
```

- [ ] **Step 4: Run unit tests to verify pass**

Run: `npx vitest run tests/lib/chicago-time.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing parser test**

In `tests/ingestion/sources-radio-milwaukee.test.ts`, copy the existing explicit-occurrence promo fixture block (the test that exercises `EXPLICIT_TIME_RE` with a normal "6:00 PM - 9:00 PM"-style time text) into a new test, changing ONLY the time text to a cross-midnight window (e.g. `9:00 PM - 1:00 AM` with the same explicit date). Assert:

```typescript
it('rolls a cross-midnight end time to the next day instead of dropping the record', () => {
  // fixture: copy of the explicit-time promo block with time text "9:00 PM - 1:00 AM"
  const records = parseRadioMilwaukeeHtml(html, LISTING_URL); // match existing test helper usage
  expect(records).toHaveLength(1);
  const payload = records[0].payload as { startDate: string; endDate: string };
  expect(Date.parse(payload.endDate)).toBeGreaterThan(Date.parse(payload.startDate));
  expect(Date.parse(payload.endDate) - Date.parse(payload.startDate)).toBe(4 * 3_600_000);
});
```

(Use the same parser entrypoint name and fixture constants the file already uses — do not invent new helpers.)

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run tests/ingestion/sources-radio-milwaukee.test.ts`
Expected: new test FAILS — either 0 records (dropped downstream) or `endDate` before `startDate` in the raw payload.

- [ ] **Step 7: Apply rollover in both occurrence builders**

In `src/ingestion/adapters/html/sources/radio-milwaukee.ts`, import `rollEndAtForward` alongside the existing chicago-time imports, then in BOTH `explicitOccurrence` and `recurringOccurrence` change the return to roll the end:

```typescript
  const startDate = chicagoWallTimeToIso(year, month, Number(day), start.hour, start.minute);
  const endDate = rollEndAtForward(
    startDate,
    chicagoWallTimeToIso(year, month, Number(day), end.hour, end.minute),
  );
  return { startDate, endDate };
```

(In `recurringOccurrence` the day variable is `day` (already a number) — adjust the `Number(day)` call to match each function's existing locals exactly.)

- [ ] **Step 8: Run tests + typecheck**

Run: `npm run test && npm run typecheck`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "fix: roll cross-midnight end times forward instead of dropping records"
```

---

### Task 3: Extract shared day-range module (mwf + downtown duplication)

**Files:**
- Create: `src/ingestion/adapters/html/day-range.ts`
- Modify: `src/ingestion/adapters/html/sources/milwaukee-world-festival.ts` (lines ~41-55, 122-137), `src/ingestion/adapters/html/sources/milwaukee-downtown.ts` (lines ~38-52, 114-127)
- Test: `tests/ingestion/day-range.test.ts` (create)

**Interfaces:**
- Consumes: `FetchedRecord` from `src/ingestion/adapters/types.ts`.
- Produces: `type DayDate = { year: number; month: number; day: number }`, `expandDayRange(start: DayDate, end: DayDate, maxDays: number): DayDate[]`, `dedupeDayRecords(records: FetchedRecord[]): FetchedRecord[]` — all from `@/ingestion/adapters/html/day-range`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/ingestion/day-range.test.ts
import { describe, expect, it } from 'vitest';
import { dedupeDayRecords, expandDayRange } from '@/ingestion/adapters/html/day-range';
import type { FetchedRecord } from '@/ingestion/adapters/types';

const d = (year: number, month: number, day: number) => ({ year, month, day });

describe('expandDayRange', () => {
  it('expands an inclusive same-month range', () => {
    expect(expandDayRange(d(2026, 6, 25), d(2026, 6, 27), 31)).toEqual([
      d(2026, 6, 25), d(2026, 6, 26), d(2026, 6, 27),
    ]);
  });

  it('expands across a year boundary', () => {
    expect(expandDayRange(d(2026, 12, 30), d(2027, 1, 2), 31)).toEqual([
      d(2026, 12, 30), d(2026, 12, 31), d(2027, 1, 1), d(2027, 1, 2),
    ]);
  });

  it('returns [] for a reversed range', () => {
    expect(expandDayRange(d(2026, 7, 10), d(2026, 7, 9), 31)).toEqual([]);
  });

  it('caps the fan-out at maxDays', () => {
    expect(expandDayRange(d(2026, 1, 1), d(2026, 12, 31), 5)).toHaveLength(5);
  });
});

describe('dedupeDayRecords', () => {
  const rec = (id: string, startDate: string): FetchedRecord => ({
    sourceEventId: id,
    payload: { startDate },
  });

  it('keeps day-instances of one event and drops true duplicates', () => {
    const records = [rec('a', '2026-06-25'), rec('a', '2026-06-26'), rec('a', '2026-06-25')];
    expect(dedupeDayRecords(records)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ingestion/day-range.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the module**

```typescript
// src/ingestion/adapters/html/day-range.ts
import type { FetchedRecord } from '../types';

export type DayDate = { year: number; month: number; day: number };

const DAY_MS = 86_400_000;

/** Expands an inclusive calendar-day range, capped at maxDays; [] when invalid or reversed. */
export function expandDayRange(start: DayDate, end: DayDate, maxDays: number): DayDate[] {
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const days: DayDate[] = [];
  for (let t = startMs; t <= endMs && days.length < maxDays; t += DAY_MS) {
    const date = new Date(t);
    days.push({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
  }
  return days;
}

/** Drops records whose (sourceEventId, payload.startDate) repeats — day-instance-safe dedupe. */
export function dedupeDayRecords(records: FetchedRecord[]): FetchedRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const startDate = (record.payload as { startDate?: string }).startDate ?? '';
    const key = `${record.sourceEventId}|${startDate}`;
    return seen.has(key) ? false : seen.add(key);
  });
}
```

- [ ] **Step 4: Run new tests to verify pass**

Run: `npx vitest run tests/ingestion/day-range.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire both parsers to the shared module**

In `milwaukee-world-festival.ts`: delete the local `type DayDate`, `expandRange`, and the trailing dedupe filter. Import `{ type DayDate, expandDayRange, dedupeDayRecords }` from `../day-range`. In `extractDays`, replace the `expandRange(...)` call:

```typescript
    days.push(
      ...expandDayRange(
        { year, month: m1, day: Number(day1) },
        { year, month: m2, day: Number(day2 ?? day1) },
        MAX_RANGE_DAYS,
      ),
    );
```

And the final return of `parseMilwaukeeWorldFestivalHtml` becomes:

```typescript
  return dedupeDayRecords(records);
```

In `milwaukee-downtown.ts`: same deletions and import. The three `expandRange(...)` call sites become `expandDayRange({ year: y, month: m, day: d }, { ... }, MAX_RANGE_DAYS)` with each site's existing locals, e.g. the cross-range case:

```typescript
    return expandDayRange(
      { year: Number(y1), month: MONTHS[m1], day: Number(d1) },
      { year: Number(y2), month: MONTHS[m2], day: Number(d2) },
      MAX_RANGE_DAYS,
    );
```

Final return of `parseMilwaukeeDowntownHtml` becomes `return dedupeDayRecords(records);`. Keep each parser's own `MAX_RANGE_DAYS` constant (31 vs 60 — intentionally different caps).

- [ ] **Step 6: Run full suite + typecheck**

Run: `npm run test && npm run typecheck`
Expected: green — the existing mwf/downtown fixture tests prove behavior is unchanged.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract shared day-range expansion from mwf/downtown parsers"
```

---

### Task 4: Adapter hygiene — detail-crawl delay, enricher-throw pin, doubleheader pin, vitest timeout

**Files:**
- Modify: `src/ingestion/adapters/html/index.ts` (`crawlDetailPages`, ~lines 56-69), `vitest.config.ts`
- Test: `tests/ingestion/html-adapter.test.ts`, `tests/ingestion/mlb-adapter.test.ts`

**Interfaces:**
- Produces: `crawlDetailPages(records, limit, enricher, sleepFn?)` becomes a named export of `src/ingestion/adapters/html/index.ts` (exported for tests; `htmlAdapter` behavior unchanged apart from pacing).

- [ ] **Step 1: Write the failing tests**

Append to `tests/ingestion/html-adapter.test.ts` (reuse the file's existing imports/mocking conventions; import `crawlDetailPages` from `@/ingestion/adapters/html`):

```typescript
describe('crawlDetailPages pacing and failure isolation', () => {
  const record = (id: string): FetchedRecord => ({
    sourceEventId: id,
    sourceUrl: `https://example.com/${id}`,
    payload: { id },
  });

  it('sleeps between detail fetches but not before the first', async () => {
    const sleeps: number[] = [];
    const sleepFn = async (ms: number) => { sleeps.push(ms); };
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>')));
    await crawlDetailPages([record('a'), record('b'), record('c')], 10, (r) => r, sleepFn);
    expect(sleeps).toEqual([250, 250]);
  });

  it('keeps crawling when an enricher throws, leaving that record unenriched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>')));
    const enricher = vi.fn((r: FetchedRecord) => {
      if (r.sourceEventId === 'a') throw new Error('boom');
      return { ...r, payload: { ...(r.payload as object), enriched: true } };
    });
    const out = await crawlDetailPages([record('a'), record('b')], 10, enricher, async () => {});
    expect((out[0].payload as { enriched?: boolean }).enriched).toBeUndefined();
    expect((out[1].payload as { enriched?: boolean }).enriched).toBe(true);
  });
});
```

And in `tests/ingestion/mlb-adapter.test.ts`, add a doubleheader case mirroring the file's existing fixture pattern: two games in the schedule payload on the SAME date with different `gamePk` values (copy an existing home-game fixture object twice, changing only `gamePk`). Assert:

```typescript
it('emits both games of a doubleheader as distinct records', async () => {
  // fixture: same-date home games, gamePk 111 and 222 (copy existing fixture shape)
  const records = /* invoke the adapter fetch the same way existing tests do */;
  expect(records).toHaveLength(2);
  expect(new Set(records.map((r) => r.sourceEventId)).size).toBe(2);
});
```

(If the adapter's fetch return shape has changed by the time this runs, destructure `records` accordingly — match the file's other tests.)

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run tests/ingestion/html-adapter.test.ts tests/ingestion/mlb-adapter.test.ts`
Expected: html-adapter FAILS (`crawlDetailPages` not exported); doubleheader case may already PASS (safe-by-construction) — if it passes, keep it as the regression pin and note it in the report.

- [ ] **Step 3: Implement delay + export**

In `src/ingestion/adapters/html/index.ts`, replace `crawlDetailPages` with:

```typescript
/** Pause between sequential detail-page fetches; polite pacing for small venue sites. */
const DETAIL_CRAWL_DELAY_MS = 250;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function crawlDetailPages(
  records: FetchedRecord[],
  limit: number,
  enricher: DetailEnricher,
  sleepFn: (ms: number) => Promise<void> = defaultSleep,
): Promise<FetchedRecord[]> {
  const out: FetchedRecord[] = [];
  let attempted = 0;
  for (const record of records) {
    const eligible = attempted < limit && record.sourceUrl !== undefined;
    if (eligible) {
      if (attempted > 0) await sleepFn(DETAIL_CRAWL_DELAY_MS);
      attempted += 1;
    }
    out.push(eligible ? await enrichOne(record, enricher) : record);
  }
  return out;
}
```

Also harden `enrichOne` so a THROWING enricher (not just a failed fetch) leaves the record unenriched — wrap the enricher call inside the existing try:

```typescript
async function enrichOne(record: FetchedRecord, enricher: DetailEnricher): Promise<FetchedRecord> {
  if (!record.sourceUrl) return record;
  try {
    const html = await fetchText(record.sourceUrl, `HTML detail ${record.sourceUrl}`);
    return enricher(record, html);
  } catch {
    return record;
  }
}
```

(The try already wraps both calls — verify the enricher call is inside it; if it already is, no change needed here.)

- [ ] **Step 4: Bump the PGlite-safe test timeout**

`vitest.config.ts` test block becomes:

```typescript
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
  },
```

- [ ] **Step 5: Run full suite (twice, to check the flake)**

Run: `npm run test && npm run test && npm run typecheck`
Expected: green both times — the 5s PGlite full-suite flake in `persist.test.ts`/`ingest.test.ts` no longer reproduces.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: pace detail-page crawls, pin enricher-throw and doubleheader behavior, raise vitest timeout"
```

---

### Task 5: Source run stats + failure tracking + backoff module

Adds per-run observability columns ("99 fetched / 1 published" must be visible) and the consecutive-failure counter that scheduling backoff (Task 12) reads.

**Files:**
- Modify: `src/db/schema.ts` (sources table), `src/ingestion/ingest.ts`
- Create: `src/ingestion/backoff.ts`, migration via `npm run db:generate`
- Test: `tests/ingestion/backoff.test.ts` (create), `tests/ingestion/ingest.test.ts`

**Interfaces:**
- Produces: sources columns `consecutiveFailures` (int, notNull, default 0), `lastAttemptAt` (timestamptz), `lastFetchedCount`/`lastPublishedCount`/`lastSkippedCount` (int, nullable). `backoffHours(consecutiveFailures: number): number` and `shouldSkipForBackoff(source: { consecutiveFailures: number; lastAttemptAt: Date | null }, now: Date): boolean` from `@/ingestion/backoff`. Task 12 consumes both.

- [ ] **Step 1: Add columns to the sources table**

In `src/db/schema.ts`, add `integer` to the `drizzle-orm/pg-core` import list, and append to the `sources` columns (after `lastError`):

```typescript
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastFetchedCount: integer('last_fetched_count'),
  lastPublishedCount: integer('last_published_count'),
  lastSkippedCount: integer('last_skipped_count'),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: new file `drizzle/0002_*.sql` containing five `ALTER TABLE "sources" ADD COLUMN ...` statements. Inspect it. Do NOT run db:migrate yet (deferred to Task 12's production step; PGlite tests replay the file immediately).

- [ ] **Step 3: Write the failing backoff tests**

```typescript
// tests/ingestion/backoff.test.ts
import { describe, expect, it } from 'vitest';
import { backoffHours, shouldSkipForBackoff } from '@/ingestion/backoff';

describe('backoffHours', () => {
  it('is 0 below three consecutive failures', () => {
    expect(backoffHours(0)).toBe(0);
    expect(backoffHours(2)).toBe(0);
  });

  it('doubles from 24h starting at the third failure', () => {
    expect(backoffHours(3)).toBe(24);
    expect(backoffHours(4)).toBe(48);
    expect(backoffHours(5)).toBe(96);
  });

  it('caps at one week', () => {
    expect(backoffHours(12)).toBe(168);
  });
});

describe('shouldSkipForBackoff', () => {
  const now = new Date('2026-07-07T12:00:00Z');

  it('never skips a healthy source', () => {
    expect(shouldSkipForBackoff({ consecutiveFailures: 0, lastAttemptAt: new Date('2026-07-07T11:00:00Z') }, now)).toBe(false);
  });

  it('skips inside the backoff window', () => {
    expect(shouldSkipForBackoff({ consecutiveFailures: 3, lastAttemptAt: new Date('2026-07-07T00:00:00Z') }, now)).toBe(true);
  });

  it('allows a retry once the window has elapsed', () => {
    expect(shouldSkipForBackoff({ consecutiveFailures: 3, lastAttemptAt: new Date('2026-07-06T00:00:00Z') }, now)).toBe(false);
  });

  it('never skips when lastAttemptAt is unknown', () => {
    expect(shouldSkipForBackoff({ consecutiveFailures: 5, lastAttemptAt: null }, now)).toBe(false);
  });
});
```

- [ ] **Step 4: Run to verify failure, then implement**

Run: `npx vitest run tests/ingestion/backoff.test.ts` → FAIL (module missing). Then create:

```typescript
// src/ingestion/backoff.ts
export const FAILURES_BEFORE_BACKOFF = 3;
export const BASE_BACKOFF_HOURS = 24;
export const MAX_BACKOFF_HOURS = 24 * 7;

export interface BackoffSource {
  consecutiveFailures: number;
  lastAttemptAt: Date | null;
}

/** Hours a source must wait after its Nth consecutive failure; 0 below the backoff floor. */
export function backoffHours(consecutiveFailures: number): number {
  if (consecutiveFailures < FAILURES_BEFORE_BACKOFF) return 0;
  const doublings = consecutiveFailures - FAILURES_BEFORE_BACKOFF;
  return Math.min(BASE_BACKOFF_HOURS * 2 ** doublings, MAX_BACKOFF_HOURS);
}

/** True while a repeatedly-failing source is still inside its exponential backoff window. */
export function shouldSkipForBackoff(source: BackoffSource, now: Date): boolean {
  const waitHours = backoffHours(source.consecutiveFailures);
  if (waitHours === 0 || !source.lastAttemptAt) return false;
  return now.getTime() - source.lastAttemptAt.getTime() < waitHours * 3_600_000;
}
```

Run again: PASS.

- [ ] **Step 5: Write the failing ingest stat tests**

Append to `tests/ingestion/ingest.test.ts` (reuse its existing seeded-source + stub-adapter helpers):

```typescript
it('records run stats on the source row after a successful run', async () => {
  // arrange: source + adapter stub where fetch returns 3 records, normalize nulls 1 of them
  await ingestSource(db, source, adapter);
  const row = await db.query.sources.findFirst({ where: eq(schema.sources.id, source.id) });
  expect(row?.lastFetchedCount).toBe(3);
  expect(row?.lastPublishedCount).toBe(2);
  expect(row?.lastSkippedCount).toBe(1);
  expect(row?.consecutiveFailures).toBe(0);
  expect(row?.lastAttemptAt).toBeInstanceOf(Date);
});

it('increments consecutiveFailures on a thrown fetch and resets it on the next success', async () => {
  // arrange: adapter whose fetch throws once, then succeeds (mutable stub)
  await expect(ingestSource(db, source, throwingAdapter)).rejects.toThrow();
  let row = await db.query.sources.findFirst({ where: eq(schema.sources.id, source.id) });
  expect(row?.consecutiveFailures).toBe(1);
  await ingestSource(db, source, workingAdapter);
  row = await db.query.sources.findFirst({ where: eq(schema.sources.id, source.id) });
  expect(row?.consecutiveFailures).toBe(0);
});
```

Run: `npx vitest run tests/ingestion/ingest.test.ts` → new tests FAIL (columns null / untouched).

- [ ] **Step 6: Wire stats into ingest.ts**

Replace `reportOutcome` and the catch-path health write in `src/ingestion/ingest.ts` (import `sql` from `drizzle-orm`):

```typescript
async function reportOutcome(db: Db, sourceId: string, result: IngestResult): Promise<void> {
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
    })
    .where(eq(schema.sources.id, sourceId));
}

async function markFailed(db: Db, sourceId: string, err: unknown): Promise<void> {
  await db
    .update(schema.sources)
    .set({
      healthStatus: 'failing',
      lastError: String(err),
      lastAttemptAt: new Date(),
      consecutiveFailures: sql`${schema.sources.consecutiveFailures} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.sources.id, sourceId));
}
```

The `ingestSource` catch block now calls `markFailed(db, source.id, err)` (keep the inner try/console.error guard). Delete the old `setHealth` if nothing else uses it.

- [ ] **Step 7: Run full suite + typecheck**

Run: `npm run test && npm run typecheck`
Expected: green (existing health assertions still hold: ok on success, failing+lastError on all-skipped).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: per-run source stats, consecutive-failure tracking, backoff policy"
```

---

### Task 6: Surface parse-time skips through the adapter interface

Cards the parsers see but cannot turn into records (yearless festival cards, vague "Returning June" cards, occurrence-less promos) are invisible today. Adapters gain a structured fetch outcome.

**Files:**
- Modify: `src/ingestion/adapters/types.ts`, `src/ingestion/ingest.ts`, `src/ingestion/adapters/html/index.ts`, `src/ingestion/adapters/html/sources/index.ts` (SelectorParser type), all four selector parsers, `src/ingestion/adapters/ical.ts`, `src/ingestion/adapters/ticketmaster.ts`, `src/ingestion/adapters/eventbrite.ts`, `src/ingestion/adapters/mlb.ts`
- Test: `tests/ingestion/sources-milwaukee-downtown.test.ts`, `tests/ingestion/sources-milwaukee-world-festival.test.ts`, `tests/ingestion/sources-radio-milwaukee.test.ts`, `tests/ingestion/sources-pabst-theater-group.test.ts`, `tests/ingestion/html-adapter.test.ts`, `tests/ingestion/ingest.test.ts` (+ mechanical return-shape updates in the ical/api adapter tests)

**Interfaces:**
- Produces (breaking, repo-wide):

```typescript
// types.ts
export interface FetchOutcome {
  records: FetchedRecord[];
  /** Items the parser recognized as event cards but could not extract (vague dates, missing fields). */
  parseSkipped: number;
}

export interface SourceAdapter {
  adapterType: string;
  fetch(config: unknown): Promise<FetchOutcome>;
  normalize(record: FetchedRecord): NormalizedEvent | null;
}
```

- `SelectorParser` becomes `(html: string, baseUrl: string) => { records: FetchedRecord[]; skipped: number }`; `IngestResult.skipped` now includes parse-time skips.

- [ ] **Step 1: Write the failing tests (counting rule: a matched event card yielding zero records increments skipped)**

Downtown fixture has exactly 7 vague cards ("Returning ..." / "Now through ...") — pin it. Append to `tests/ingestion/sources-milwaukee-downtown.test.ts`:

```typescript
it('counts vague cards as skipped instead of dropping them silently', () => {
  const { records, skipped } = parseMilwaukeeDowntownHtml(html, LISTING_URL);
  expect(records.length).toBeGreaterThan(0);
  expect(skipped).toBe(7);
});
```

Equivalent pins in the mwf test (cards without a 4-digit year → skipped), radio-milwaukee (promo without a resolvable occurrence → skipped), pabst (its parser's drop conditions; if the fixture has no drop case, assert `skipped === 0`). In `tests/ingestion/ingest.test.ts` add:

```typescript
it('folds parse-time skips into IngestResult.skipped', async () => {
  // adapter stub: fetch resolves { records: [oneGoodRecord], parseSkipped: 4 }
  const result = await ingestSource(db, source, adapter);
  expect(result.fetched).toBe(1);
  expect(result.skipped).toBe(4);
});
```

Run the touched files: expected FAIL (parsers return arrays, not `{records, skipped}`).

- [ ] **Step 2: Change the types**

Apply the `FetchOutcome`/`SourceAdapter` change in `types.ts` verbatim as above. In `src/ingestion/adapters/html/sources/index.ts` change:

```typescript
export type SelectorParser = (html: string, baseUrl: string) => { records: FetchedRecord[]; skipped: number };
```

- [ ] **Step 3: Update the four selector parsers**

Pattern (downtown shown; mirror in the other three — each card-match site that `return`s/`continue`s without producing records increments a `skipped` counter):

```typescript
export function parseMilwaukeeDowntownHtml(
  html: string,
  listingUrl: string,
): { records: FetchedRecord[]; skipped: number } {
  const $ = cheerio.load(html);
  const records: FetchedRecord[] = [];
  let skipped = 0;
  $('h4.fusion-title-heading').each((_, el) => {
    const card = cardFields($, el, listingUrl);
    if (!card) { skipped += 1; return; }
    const days = extractDays(card.dateText);
    if (days.length === 0) { skipped += 1; return; }
    for (const day of days) records.push(dayRecord(card, day, listingUrl));
  });
  return { records: dedupeDayRecords(records), skipped };
}
```

mwf: `cardFields` null → skipped; `extractDays(dateText)` empty → skipped. radio-milwaukee: promo whose occurrence resolves `undefined` (or missing title/url per its existing guards) → skipped. pabst: apply the same rule to its guard sites.

- [ ] **Step 4: Update the html adapter**

In `src/ingestion/adapters/html/index.ts`: `parseListing` returns `{ records, skipped }` (jsonld strategies return `{ records: extractJsonLdEvents(html, url), skipped: 0 }`); `fetch` sums page skips and returns the outcome:

```typescript
  async fetch(rawConfig: unknown): Promise<FetchOutcome> {
    const config = configSchema.parse(rawConfig);
    const all: FetchedRecord[] = [];
    let parseSkipped = 0;
    for (const url of config.listingUrls) {
      const html =
        config.strategy === 'firecrawl-jsonld'
          ? await fetchRenderedHtml(url)
          : await fetchText(url, `HTML listing ${url}`);
      const parsed = parseListing(config, html, url);
      all.push(...parsed.records);
      parseSkipped += parsed.skipped;
    }
    const deduped = dedupe(all);
    const enricher = detailEnrichers[config.sourceKey];
    if (!config.crawlDetails || !enricher) return { records: deduped, parseSkipped };
    return { records: await crawlDetailPages(deduped, config.crawlDetails.limit, enricher), parseSkipped };
  },
```

- [ ] **Step 5: Update the simple adapters mechanically**

`ical.ts`, `ticketmaster.ts`, `eventbrite.ts`, `mlb.ts`: wrap each `fetch`'s current return value as `{ records: <previous value>, parseSkipped: 0 }` and change the return type to `Promise<FetchOutcome>`. (Intentional filters — MLB away games, TM pagination caps — are NOT parse skips.) Update their tests' destructuring accordingly (`const { records } = await adapter.fetch(...)`).

- [ ] **Step 6: Fold into IngestResult**

In `src/ingestion/ingest.ts` `ingestSource`:

```typescript
    const { records, parseSkipped } = await adapter.fetch(source.config);
    const result = await processRecords(db, source, adapter, records);
    result.skipped += parseSkipped;
    await reportOutcome(db, source.id, result);
    return result;
```

(`fetched` stays `records.length` — skips are visible in `skipped` and the Task 5 columns.)

- [ ] **Step 7: Run full suite + typecheck; fix every compile error the interface change surfaces**

Run: `npm run test && npm run typecheck`
Expected: green. The compiler is the checklist here — every `.fetch(` call site and parser signature must be updated.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: surface parse-time skips through a structured adapter fetch outcome"
```

---

### Task 7: Same-source concurrent-ingest link race — catch-and-refetch

Two concurrent ingests of one source both miss the link lookup, both insert an event, and the second link insert hits `event_source_links_source_event_idx` → today the batch aborts after a compensating delete. Fix: adopt the winner's event.

**Files:**
- Modify: `src/ingestion/persist.ts`
- Test: `tests/ingestion/persist.test.ts`

**Interfaces:**
- Produces: `createOrAdoptEvent(db, source, n, venueId): Promise<{ eventId: string; created: boolean }>` — exported from `src/ingestion/persist.ts` for direct race-path testing. `persistNormalizedEvent` signature and behavior unchanged for callers.

- [ ] **Step 1: Write the failing test**

Append to `tests/ingestion/persist.test.ts` (reuse its existing seeded source + `NormalizedEvent` fixture helpers):

```typescript
it('adopts the existing event when a concurrent ingest wins the link race', async () => {
  const n = makeNormalized({ sourceEventId: 'race-1', title: 'Race Show' });
  const first = await persistNormalizedEvent(db, source, n);
  // Simulate the race: a second worker that missed the link lookup calls the create path directly.
  const second = await createOrAdoptEvent(db, source, { ...n, title: 'Race Show (updated)' }, null);
  expect(second.eventId).toBe(first.eventId);
  expect(second.created).toBe(false);
  const allEvents = await db.query.events.findMany();
  expect(allEvents).toHaveLength(1);
  expect(allEvents[0].title).toBe('Race Show (updated)');
  const links = await db.query.eventSourceLinks.findMany();
  expect(links).toHaveLength(1);
});
```

Run: `npx vitest run tests/ingestion/persist.test.ts`
Expected: FAIL — `createOrAdoptEvent` not exported (and the raw call would today throw the unique violation).

- [ ] **Step 2: Implement**

In `src/ingestion/persist.ts` add a unique-violation detector and the adopt path, and extract the link lookup that `persistNormalizedEvent` already does inline:

```typescript
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  if (e.code === '23505' || e.cause?.code === '23505') return true;
  return typeof e.message === 'string' && e.message.includes('duplicate key value violates unique constraint');
}

async function findLink(db: Db, source: SourceRef, sourceEventId: string) {
  return db.query.eventSourceLinks.findFirst({
    where: and(
      eq(schema.eventSourceLinks.sourceId, source.id),
      eq(schema.eventSourceLinks.sourceEventId, sourceEventId),
    ),
  });
}

/** Exported for race-path testing: the create path a worker takes after a missed link lookup. */
export async function createOrAdoptEvent(
  db: Db,
  source: SourceRef,
  n: NormalizedEvent,
  venueId: string | null,
): Promise<{ eventId: string; created: boolean }> {
  try {
    return { eventId: await createEventWithLink(db, source, n, venueId), created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await findLink(db, source, n.sourceEventId);
    if (!winner) throw err;
    await updateExistingEvent(db, winner.id, winner.eventId, n, venueId);
    return { eventId: winner.eventId, created: false };
  }
}
```

`persistNormalizedEvent` now uses both helpers:

```typescript
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
    await updateExistingEvent(db, existingLink.id, existingLink.eventId, n, venueId);
    outcome = { eventId: existingLink.eventId, created: false };
  } else {
    outcome = await createOrAdoptEvent(db, source, n, venueId);
  }
  await upsertInstance(db, outcome.eventId, n);
  if (opts.supersede) await supersedeOtherInstances(db, outcome.eventId, n.startAt);
  return outcome;
}
```

(`createEventWithLink`'s compensating delete stays exactly as is — it runs before the catch in `createOrAdoptEvent` sees the error, so no orphan event survives the adopt path.)

- [ ] **Step 3: Run tests + typecheck**

Run: `npm run test && npm run typecheck`
Expected: green, including the new race test.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: adopt the winning event on same-source link race instead of aborting the batch"
```

---

### Task 8: Source-aware instance supersede (prerequisite for any dedup consolidation)

`supersedeOtherInstances` deletes ALL other instances of an event. Once dedup consolidates multi-source instances onto one canonical event, a single-instance source re-ingest would wipe the other sources' instances. Instances gain provenance.

**Files:**
- Modify: `src/db/schema.ts` (eventInstances), `src/ingestion/persist.ts`
- Create: generated migration + custom backfill migration
- Test: `tests/ingestion/persist.test.ts`

**Interfaces:**
- Produces: `eventInstances.sourceId` (uuid, nullable, FK sources ON DELETE SET NULL); `upsertInstance` stamps it; `supersedeOtherInstances(db, eventId, sourceId, keepStartAt)` deletes only the ingesting source's other instances. Tasks 10/11 rely on instances carrying `sourceId`.

- [ ] **Step 1: Add the column**

In `src/db/schema.ts` `eventInstances` columns, after `eventId`:

```typescript
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
```

- [ ] **Step 2: Generate + backfill migrations**

Run: `npm run db:generate` → inspect `drizzle/0003_*.sql` (ALTER TABLE ADD COLUMN + FK).
Run: `npx drizzle-kit generate --custom --name=backfill-instance-source` → fill the new empty `drizzle/0004_backfill-instance-source.sql` with:

```sql
UPDATE "event_instances" i
SET "source_id" = l."source_id"
FROM "event_source_links" l
WHERE l."event_id" = i."event_id" AND i."source_id" IS NULL;
```

(Every event has exactly one link pre-dedup, so the backfill is unambiguous. PGlite tests replay both files automatically.)

- [ ] **Step 3: Write the failing test**

Append to `tests/ingestion/persist.test.ts`:

```typescript
it('supersede only deletes the ingesting source\'s other instances', async () => {
  // sourceA persists the event with two different startAts (no supersede)
  const n1 = makeNormalized({ sourceEventId: 'multi-1', startAt: new Date('2026-08-01T00:00:00Z') });
  const { eventId } = await persistNormalizedEvent(db, sourceA, n1);
  await persistNormalizedEvent(db, sourceA, { ...n1, startAt: new Date('2026-08-02T00:00:00Z') });
  // a consolidated instance from sourceB sits on the same event (post-dedup state)
  await db.insert(schema.eventInstances).values({
    eventId, sourceId: sourceB.id, startAt: new Date('2026-08-03T00:00:00Z'),
  });
  // sourceA re-ingests with supersede at a new time
  await persistNormalizedEvent(db, sourceA, { ...n1, startAt: new Date('2026-08-05T00:00:00Z') }, { supersede: true });
  const instances = await db.query.eventInstances.findMany({
    where: eq(schema.eventInstances.eventId, eventId),
  });
  const bySource = new Map(instances.map((i) => [i.sourceId, i.startAt.toISOString()]));
  expect(instances).toHaveLength(2);
  expect(bySource.get(sourceA.id)).toBe('2026-08-05T00:00:00.000Z');
  expect(bySource.get(sourceB.id)).toBe('2026-08-03T00:00:00.000Z');
});

it('stamps sourceId on upserted instances', async () => {
  const n = makeNormalized({ sourceEventId: 'stamp-1' });
  const { eventId } = await persistNormalizedEvent(db, source, n);
  const [instance] = await db.query.eventInstances.findMany({
    where: eq(schema.eventInstances.eventId, eventId),
  });
  expect(instance.sourceId).toBe(source.id);
});
```

(Seed a second source row `sourceB` the same way the file seeds its first; if the file only has one seeded source, add one.)

Run: FAIL — `sourceId` null / sourceB instance deleted.

- [ ] **Step 4: Implement**

In `src/ingestion/persist.ts`:

```typescript
async function upsertInstance(db: Db, eventId: string, sourceId: string, n: NormalizedEvent): Promise<void> {
  await db
    .insert(schema.eventInstances)
    .values({ eventId, sourceId, startAt: n.startAt, endAt: n.endAt, timezone: n.timezone, status: n.status })
    .onConflictDoUpdate({
      target: [schema.eventInstances.eventId, schema.eventInstances.startAt],
      set: { endAt: n.endAt, status: n.status, sourceId },
    });
}

async function supersedeOtherInstances(
  db: Db,
  eventId: string,
  sourceId: string,
  keepStartAt: Date,
): Promise<void> {
  await db.delete(schema.eventInstances).where(
    and(
      eq(schema.eventInstances.eventId, eventId),
      eq(schema.eventInstances.sourceId, sourceId),
      ne(schema.eventInstances.startAt, keepStartAt),
    ),
  );
}
```

Call sites in `persistNormalizedEvent`: `await upsertInstance(db, outcome.eventId, source.id, n);` and `if (opts.supersede) await supersedeOtherInstances(db, outcome.eventId, source.id, n.startAt);`.

- [ ] **Step 5: Run full suite + typecheck**

Run: `npm run test && npm run typecheck`
Expected: green (post-backfill there are no null-sourceId rows in any environment, so the `eq(sourceId)` filter is total).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: source-aware instance supersede via event_instances.source_id"
```

---

### Task 9: Dedup schema (event_clusters, event_reviews, pg_trgm) + scoring module

**Files:**
- Modify: `src/db/schema.ts`, `tests/helpers/test-db.ts`
- Create: `src/dedup/scoring.ts`, `src/dedup/confidence.ts`, generated migration + custom pg_trgm migration
- Test: `tests/dedup/scoring.test.ts`, `tests/dedup/confidence.test.ts` (create), plus a trigram smoke test in `tests/dedup/trgm.test.ts`

**Interfaces:**
- Produces: tables `event_clusters`, `event_reviews`; pg_trgm available in prod AND PGlite; from `@/dedup/scoring`: `AUTO_MERGE_THRESHOLD = 0.8`, `REVIEW_THRESHOLD = 0.55`, `interface PairSignals { titleSimilarity: number; venueAffinity: number; startDeltaMinutes: number | null; urlMatch: boolean }`, `interface ScoredPair extends PairSignals { total: number; verdict: 'merge' | 'review' | 'ignore' }`, `timeProximity(startDeltaMinutes: number | null): number`, `scorePair(signals: PairSignals): ScoredPair`; from `@/dedup/confidence`: `adapterRank(adapterType: string): number`, `pickCanonical(a: EventProvenance, b: EventProvenance): EventProvenance` where `interface EventProvenance { eventId: string; adapterType: string; createdAt: Date }`.

- [ ] **Step 1: Add the tables**

Append to `src/db/schema.ts`:

```typescript
export const eventClusters = pgTable('event_clusters', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalEventId: uuid('canonical_event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  mergedEventSlug: text('merged_event_slug').notNull(),
  mergedEventTitle: text('merged_event_title').notNull(),
  score: numeric('score').notNull(),
  breakdown: jsonb('breakdown').notNull(),
  decidedBy: text('decided_by', { enum: ['auto', 'review'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const eventReviews = pgTable(
  'event_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['duplicate'] }).notNull().default('duplicate'),
    eventAId: uuid('event_a_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    eventBId: uuid('event_b_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    score: numeric('score').notNull(),
    breakdown: jsonb('breakdown').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('event_reviews_pair_idx').on(t.eventAId, t.eventBId)],
);
```

- [ ] **Step 2: Generate + pg_trgm migrations**

Run: `npm run db:generate` → inspect `drizzle/0005_*.sql` (two CREATE TABLE + index).
Run: `npx drizzle-kit generate --custom --name=enable-pg-trgm` → fill `drizzle/0006_enable-pg-trgm.sql` with:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

- [ ] **Step 3: Register pg_trgm in the PGlite harness**

`tests/helpers/test-db.ts` line 8 area becomes:

```typescript
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
// ...
  const client = new PGlite({ extensions: { pg_trgm } });
```

- [ ] **Step 4: Trigram smoke test (proves harness + migration order)**

```typescript
// tests/dedup/trgm.test.ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

describe('pg_trgm in the test harness', () => {
  it('computes trigram similarity', async () => {
    const db = await createTestDb();
    const result = await db.execute(sql`SELECT similarity('summerfest', 'summerfest 2026') AS sim`);
    const sim = Number((result.rows[0] as { sim: unknown }).sim);
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThanOrEqual(1);
  });
});
```

Run: `npx vitest run tests/dedup/trgm.test.ts` → PASS (if `CREATE EXTENSION` fails, the harness registration in Step 3 is wrong — fix before proceeding).

- [ ] **Step 5: Write the failing scoring tests**

```typescript
// tests/dedup/scoring.test.ts
import { describe, expect, it } from 'vitest';
import { scorePair, timeProximity } from '@/dedup/scoring';

describe('timeProximity', () => {
  it('is 1 at identical start times', () => expect(timeProximity(0)).toBe(1));
  it('decays linearly to 0 at 180 minutes', () => {
    expect(timeProximity(90)).toBeCloseTo(0.5);
    expect(timeProximity(180)).toBe(0);
    expect(timeProximity(400)).toBe(0);
  });
  it('is neutral 0.5 when a midnight placeholder is involved', () => {
    expect(timeProximity(null)).toBe(0.5);
  });
});

describe('scorePair', () => {
  it('auto-merges an identical cross-source listing', () => {
    const scored = scorePair({ titleSimilarity: 1, venueAffinity: 1, startDeltaMinutes: 0, urlMatch: false });
    expect(scored.total).toBeCloseTo(0.55 + 0.15 + 0.15);
    expect(scored.verdict).toBe('merge');
  });

  it('sends the amphitheater-headliner shape to review', () => {
    // identical title, different venue naming, midnight placeholder on one side
    const scored = scorePair({ titleSimilarity: 1, venueAffinity: 0.1, startDeltaMinutes: null, urlMatch: false });
    expect(scored.total).toBeCloseTo(0.55 + 0.015 + 0.075);
    expect(scored.verdict).toBe('review');
  });

  it('ignores unrelated events on the same day', () => {
    const scored = scorePair({ titleSimilarity: 0.2, venueAffinity: 0.5, startDeltaMinutes: 120, urlMatch: false });
    expect(scored.verdict).toBe('ignore');
  });

  it('url match pushes a borderline pair over the merge line', () => {
    const withUrl = scorePair({ titleSimilarity: 0.9, venueAffinity: 0.5, startDeltaMinutes: 30, urlMatch: true });
    const withoutUrl = scorePair({ ...withUrl, urlMatch: false });
    expect(withUrl.verdict).toBe('merge');
    expect(withoutUrl.verdict).toBe('review');
  });
});
```

```typescript
// tests/dedup/confidence.test.ts
import { describe, expect, it } from 'vitest';
import { adapterRank, pickCanonical } from '@/dedup/confidence';

describe('confidence ladder', () => {
  it('ranks api > ical > html > firecrawl', () => {
    expect(adapterRank('api')).toBeGreaterThan(adapterRank('ical'));
    expect(adapterRank('ical')).toBeGreaterThan(adapterRank('html'));
    expect(adapterRank('html')).toBeGreaterThan(adapterRank('firecrawl'));
  });

  it('picks the higher-confidence source as canonical', () => {
    const api = { eventId: 'a', adapterType: 'api', createdAt: new Date('2026-07-02T00:00:00Z') };
    const html = { eventId: 'b', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z') };
    expect(pickCanonical(api, html)).toBe(api);
    expect(pickCanonical(html, api)).toBe(api);
  });

  it('breaks ties by earlier createdAt', () => {
    const older = { eventId: 'a', adapterType: 'html', createdAt: new Date('2026-07-01T00:00:00Z') };
    const newer = { eventId: 'b', adapterType: 'html', createdAt: new Date('2026-07-02T00:00:00Z') };
    expect(pickCanonical(newer, older)).toBe(older);
  });
});
```

Run: FAIL (modules missing).

- [ ] **Step 6: Implement scoring + confidence**

```typescript
// src/dedup/scoring.ts
export const AUTO_MERGE_THRESHOLD = 0.8;
export const REVIEW_THRESHOLD = 0.55;

const WEIGHTS = { title: 0.55, venue: 0.15, time: 0.15, url: 0.15 } as const;
const TIME_WINDOW_MINUTES = 180;

export interface PairSignals {
  /** pg_trgm similarity of the two normalized titles, 0..1. */
  titleSimilarity: number;
  /** 1 = same venue row; trigram similarity of venue names; 0.5 = unknown on either side. */
  venueAffinity: number;
  /** Minutes between closest same-day starts; null when a midnight placeholder is involved. */
  startDeltaMinutes: number | null;
  urlMatch: boolean;
}

export interface ScoredPair extends PairSignals {
  total: number;
  verdict: 'merge' | 'review' | 'ignore';
}

export function timeProximity(startDeltaMinutes: number | null): number {
  if (startDeltaMinutes === null) return 0.5;
  return 1 - Math.min(Math.abs(startDeltaMinutes), TIME_WINDOW_MINUTES) / TIME_WINDOW_MINUTES;
}

function verdictFor(total: number): ScoredPair['verdict'] {
  if (total >= AUTO_MERGE_THRESHOLD) return 'merge';
  if (total >= REVIEW_THRESHOLD) return 'review';
  return 'ignore';
}

export function scorePair(signals: PairSignals): ScoredPair {
  const total =
    WEIGHTS.title * signals.titleSimilarity +
    WEIGHTS.venue * signals.venueAffinity +
    WEIGHTS.time * timeProximity(signals.startDeltaMinutes) +
    WEIGHTS.url * (signals.urlMatch ? 1 : 0);
  return { ...signals, total, verdict: verdictFor(total) };
}
```

```typescript
// src/dedup/confidence.ts
/** PRD confidence ladder: API/feed > JSON-LD/HTML parser > Firecrawl. */
const ADAPTER_RANK: Record<string, number> = { api: 4, ical: 3, rss: 3, html: 2, firecrawl: 1 };

export interface EventProvenance {
  eventId: string;
  adapterType: string;
  createdAt: Date;
}

export function adapterRank(adapterType: string): number {
  return ADAPTER_RANK[adapterType] ?? 0;
}

/** Higher-confidence source wins; ties go to the longer-lived event (stable slugs/URLs). */
export function pickCanonical(a: EventProvenance, b: EventProvenance): EventProvenance {
  const rankA = adapterRank(a.adapterType);
  const rankB = adapterRank(b.adapterType);
  if (rankA !== rankB) return rankA > rankB ? a : b;
  return a.createdAt.getTime() <= b.createdAt.getTime() ? a : b;
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run test && npm run typecheck`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: dedup schema (clusters, review queue, pg_trgm) and pair scoring"
```

---

### Task 10: Candidate query, merge pipeline, review queue, sweep + CLI

**Files:**
- Create: `src/dedup/candidates.ts`, `src/dedup/merge.ts`, `src/dedup/sweep.ts`, `src/dedup/run.ts`
- Modify: `package.json` (scripts)
- Test: `tests/dedup/sweep.test.ts` (create)

**Interfaces:**
- Consumes: Task 8's `eventInstances.sourceId`, Task 9's scoring/confidence modules and tables.
- Produces: `findCandidates(db): Promise<CandidateRow[]>`; `mergeEvents(db, canonicalId: string, duplicateId: string, scored: ScoredPair, decidedBy: 'auto' | 'review'): Promise<void>`; `dedupSweep(db, now?: Date): Promise<DedupResult>` with `interface DedupResult { examined: number; merged: number; queued: number }`; `applyReview(db, reviewId: string, verdict: 'approved' | 'rejected'): Promise<void>`; `npm run dedup` CLI. Task 12's scheduled task calls `dedupSweep`.

- [ ] **Step 1: Write the failing integration tests**

```typescript
// tests/dedup/sweep.test.ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { dedupSweep } from '@/dedup/sweep';
import { createTestDb } from '../helpers/test-db';

// Two sources with different confidence tiers.
async function seedSources(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [api] = await db.insert(schema.sources).values({
    key: 'tm-test', name: 'TM', url: 'https://tm.example', adapterType: 'api', config: {},
  }).returning();
  const [html] = await db.insert(schema.sources).values({
    key: 'mwf-test', name: 'MWF', url: 'https://mwf.example', adapterType: 'html', config: {},
  }).returning();
  return { api: { id: api.id, key: api.key }, html: { id: html.id, key: html.key } };
}

const FUTURE = new Date(Date.now() + 7 * 86_400_000);
FUTURE.setUTCHours(19, 0, 0, 0); // umbrella: an evening start well in the future

function normalized(sourceEventId: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceEventId,
    title,
    venueName: 'Test Hall',
    startAt: FUTURE,
    timezone: 'America/Chicago',
    status: 'scheduled' as const,
    ...overrides,
  };
}

describe('dedupSweep', () => {
  it('auto-merges an identical cross-source event onto the higher-confidence source', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const a = await persistNormalizedEvent(db, sources.api, normalized('tm-1', 'Hozier'));
    const b = await persistNormalizedEvent(db, sources.html, normalized('mwf-1', 'Hozier'));
    const result = await dedupSweep(db);
    expect(result.merged).toBe(1);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(a.eventId); // api outranks html
    const links = await db.query.eventSourceLinks.findMany({
      where: eq(schema.eventSourceLinks.eventId, a.eventId),
    });
    expect(links).toHaveLength(2); // provenance preserved
    const clusters = await db.query.eventClusters.findMany();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].canonicalEventId).toBe(a.eventId);
    void b;
  });

  it('keeps per-source day instances intact after a merge', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const dayTwo = new Date(FUTURE.getTime() + 86_400_000);
    await persistNormalizedEvent(db, sources.html, normalized('fest-1', 'Big Fest'));
    await persistNormalizedEvent(db, sources.html, normalized('fest-1', 'Big Fest', { startAt: dayTwo }));
    await persistNormalizedEvent(db, sources.api, normalized('tm-2', 'Big Fest'));
    await dedupSweep(db);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    const instances = await db.query.eventInstances.findMany();
    // html day 1 + html day 2 + api day 1 (same startAt as html day 1 collapses on the unique index)
    expect(instances.length).toBe(2);
    expect(new Set(instances.map((i) => i.startAt.toISOString())).size).toBe(2);
  });

  it('queues an ambiguous pair for review instead of merging', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    const midnight = new Date(FUTURE);
    midnight.setUTCHours(5, 0, 0, 0); // 00:00 America/Chicago (CDT) — placeholder time
    await persistNormalizedEvent(db, sources.api, normalized('tm-3', 'Khruangbin', { venueName: 'Amphitheater' }));
    await persistNormalizedEvent(db, sources.html, normalized('mwf-3', 'Khruangbin', {
      venueName: 'Festival Park', startAt: midnight,
    }));
    const result = await dedupSweep(db);
    expect(result.merged).toBe(0);
    expect(result.queued).toBe(1);
    const reviews = await db.query.eventReviews.findMany();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].status).toBe('pending');
    expect(await db.query.events.findMany()).toHaveLength(2);
  });

  it('is idempotent: a second sweep neither re-merges nor re-queues', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    await persistNormalizedEvent(db, sources.api, normalized('tm-4', 'Same Show'));
    await persistNormalizedEvent(db, sources.html, normalized('mwf-4', 'Same Show'));
    await dedupSweep(db);
    const again = await dedupSweep(db);
    expect(again.merged).toBe(0);
    expect(again.queued).toBe(0);
    expect(await db.query.eventClusters.findMany()).toHaveLength(1);
  });

  it('never pairs two events from the same source', async () => {
    const db = await createTestDb();
    const sources = await seedSources(db);
    await persistNormalizedEvent(db, sources.api, normalized('tm-5', 'Twin Show'));
    await persistNormalizedEvent(db, sources.api, normalized('tm-6', 'Twin Show'));
    const result = await dedupSweep(db);
    expect(result.merged).toBe(0);
    expect(result.queued).toBe(0);
  });
});
```

Run: FAIL (modules missing). NOTE: relation queries for the new tables require the schema relations — none are needed for `findMany` on plain tables, so no relations additions are required.

- [ ] **Step 2: Implement the candidate query**

```typescript
// src/dedup/candidates.ts
import { sql } from 'drizzle-orm';
import type { Db } from '@/ingestion/persist';

export interface CandidateRow {
  eventAId: string;
  eventBId: string;
  titleSimilarity: number;
  venueAffinity: number;
  startDeltaMinutes: number | null;
  urlMatch: boolean;
}

const MIN_TITLE_SIMILARITY = 0.3;

/**
 * Cross-source pairs of future events sharing a Chicago calendar day.
 * Midnight-placeholder starts (00:00 Chicago wall time) are excluded from the
 * time-delta signal; pairs already merged or reviewed are excluded entirely.
 */
export async function findCandidates(db: Db): Promise<CandidateRow[]> {
  const result = await db.execute(sql`
    WITH future_instances AS (
      SELECT i.event_id,
             i.start_at,
             (i.start_at AT TIME ZONE 'America/Chicago')::date AS chi_day,
             (i.start_at AT TIME ZONE 'America/Chicago')::time = '00:00:00' AS is_midnight
      FROM event_instances i
      WHERE i.start_at >= now() - interval '1 day'
    ),
    pairs AS (
      SELECT a.event_id AS event_a_id,
             b.event_id AS event_b_id,
             MIN(ABS(EXTRACT(EPOCH FROM (a.start_at - b.start_at)) / 60))
               FILTER (WHERE NOT a.is_midnight AND NOT b.is_midnight) AS start_delta_minutes
      FROM future_instances a
      JOIN future_instances b
        ON a.chi_day = b.chi_day AND a.event_id < b.event_id
      GROUP BY a.event_id, b.event_id
    )
    SELECT p.event_a_id,
           p.event_b_id,
           similarity(ea.normalized_title, eb.normalized_title) AS title_similarity,
           CASE
             WHEN ea.venue_id IS NOT NULL AND ea.venue_id = eb.venue_id THEN 1
             WHEN va.normalized_name IS NOT NULL AND vb.normalized_name IS NOT NULL
               THEN similarity(va.normalized_name, vb.normalized_name)
             ELSE 0.5
           END AS venue_affinity,
           p.start_delta_minutes,
           (ea.canonical_url IS NOT NULL AND ea.canonical_url = eb.canonical_url) AS url_match
    FROM pairs p
    JOIN events ea ON ea.id = p.event_a_id
    JOIN events eb ON eb.id = p.event_b_id
    LEFT JOIN venues va ON va.id = ea.venue_id
    LEFT JOIN venues vb ON vb.id = eb.venue_id
    WHERE similarity(ea.normalized_title, eb.normalized_title) >= ${MIN_TITLE_SIMILARITY}
      AND NOT EXISTS (
        SELECT 1
        FROM event_source_links la
        JOIN event_source_links lb ON la.source_id = lb.source_id
        WHERE la.event_id = p.event_a_id AND lb.event_id = p.event_b_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM event_reviews r
        WHERE r.event_a_id = p.event_a_id AND r.event_b_id = p.event_b_id
      )
  `);
  return (result.rows as Record<string, unknown>[]).map(toCandidateRow);
}

function toCandidateRow(row: Record<string, unknown>): CandidateRow {
  return {
    eventAId: String(row.event_a_id),
    eventBId: String(row.event_b_id),
    titleSimilarity: Number(row.title_similarity),
    venueAffinity: Number(row.venue_affinity),
    startDeltaMinutes: row.start_delta_minutes === null ? null : Number(row.start_delta_minutes),
    urlMatch: Boolean(row.url_match),
  };
}
```

- [ ] **Step 3: Implement the merge pipeline**

```typescript
// src/dedup/merge.ts
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/ingestion/persist';
import type { ScoredPair } from './scoring';

/**
 * No transactions on the Neon HTTP driver — steps are ordered so a crash leaves
 * a recoverable state: links move first (provenance is never lost), instances
 * next, the duplicate event row is deleted only once it is empty, and the
 * cluster receipt is written last. A duplicate stranded mid-merge has no
 * instances and is swept by retention; the next dedup run re-examines the rest.
 */
export async function mergeEvents(
  db: Db,
  canonicalId: string,
  duplicateId: string,
  scored: ScoredPair,
  decidedBy: 'auto' | 'review',
): Promise<void> {
  const duplicate = await db.query.events.findFirst({ where: eq(schema.events.id, duplicateId) });
  if (!duplicate) return;
  await db
    .update(schema.eventSourceLinks)
    .set({ eventId: canonicalId, isCanonical: false })
    .where(eq(schema.eventSourceLinks.eventId, duplicateId));
  await moveInstances(db, canonicalId, duplicateId);
  await backfillMissingFields(db, canonicalId, duplicateId);
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

function scoredBreakdown(scored: ScoredPair): Record<string, unknown> {
  const { titleSimilarity, venueAffinity, startDeltaMinutes, urlMatch, total } = scored;
  return { titleSimilarity, venueAffinity, startDeltaMinutes, urlMatch, total };
}

async function moveInstances(db: Db, canonicalId: string, duplicateId: string): Promise<void> {
  const canonicalStarts = await db
    .select({ startAt: schema.eventInstances.startAt })
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.eventId, canonicalId));
  const startList = canonicalStarts.map((r) => r.startAt);
  if (startList.length > 0) {
    await db.delete(schema.eventInstances).where(
      and(
        eq(schema.eventInstances.eventId, duplicateId),
        inArray(schema.eventInstances.startAt, startList),
      ),
    );
  }
  await db
    .update(schema.eventInstances)
    .set({ eventId: canonicalId })
    .where(eq(schema.eventInstances.eventId, duplicateId));
}

/** The higher-confidence canonical keeps its fields; only nulls are filled from the duplicate. */
async function backfillMissingFields(db: Db, canonicalId: string, duplicateId: string): Promise<void> {
  await db.execute(sql`
    UPDATE events c
    SET summary = COALESCE(c.summary, d.summary),
        description = COALESCE(c.description, d.description),
        category = COALESCE(c.category, d.category),
        image_url = COALESCE(c.image_url, d.image_url),
        canonical_url = COALESCE(c.canonical_url, d.canonical_url),
        is_free = COALESCE(c.is_free, d.is_free),
        venue_id = COALESCE(c.venue_id, d.venue_id),
        updated_at = now()
    FROM events d
    WHERE c.id = ${canonicalId} AND d.id = ${duplicateId}
  `);
}
```

- [ ] **Step 4: Implement the sweep + review application**

```typescript
// src/dedup/sweep.ts
import { eq, inArray } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/ingestion/persist';
import { findCandidates, type CandidateRow } from './candidates';
import { adapterRank, pickCanonical, type EventProvenance } from './confidence';
import { mergeEvents } from './merge';
import { scorePair, type ScoredPair } from './scoring';

export interface DedupResult {
  examined: number;
  merged: number;
  queued: number;
}

export async function dedupSweep(db: Db): Promise<DedupResult> {
  const candidates = await findCandidates(db);
  const result: DedupResult = { examined: candidates.length, merged: 0, queued: 0 };
  const consumed = new Set<string>();
  for (const candidate of candidates) {
    if (consumed.has(candidate.eventAId) || consumed.has(candidate.eventBId)) continue;
    const scored = scorePair(candidate);
    if (scored.verdict === 'merge') {
      await mergePair(db, candidate, scored, consumed);
      result.merged += 1;
    } else if (scored.verdict === 'review') {
      await queuePair(db, candidate, scored);
      result.queued += 1;
    }
  }
  return result;
}

async function mergePair(
  db: Db,
  candidate: CandidateRow,
  scored: ScoredPair,
  consumed: Set<string>,
): Promise<void> {
  const [a, b] = await provenanceFor(db, [candidate.eventAId, candidate.eventBId]);
  const canonical = pickCanonical(a, b);
  const duplicate = canonical.eventId === a.eventId ? b : a;
  await mergeEvents(db, canonical.eventId, duplicate.eventId, scored, 'auto');
  consumed.add(duplicate.eventId);
}

async function queuePair(db: Db, candidate: CandidateRow, scored: ScoredPair): Promise<void> {
  await db
    .insert(schema.eventReviews)
    .values({
      eventAId: candidate.eventAId,
      eventBId: candidate.eventBId,
      score: scored.total.toFixed(4),
      breakdown: { ...scored },
    })
    .onConflictDoNothing();
}

/** Provenance = each event's canonical link's source adapter type + event age. */
async function provenanceFor(db: Db, eventIds: string[]): Promise<EventProvenance[]> {
  const rows = await db
    .select({
      eventId: schema.events.id,
      createdAt: schema.events.createdAt,
      adapterType: schema.sources.adapterType,
    })
    .from(schema.events)
    .innerJoin(schema.eventSourceLinks, eq(schema.eventSourceLinks.eventId, schema.events.id))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.eventSourceLinks.sourceId))
    .where(inArray(schema.events.id, eventIds));
  return eventIds.map((id) => {
    const ranked = rows.filter((r) => r.eventId === id);
    if (ranked.length === 0) throw new Error(`No source link found for event ${id}`);
    return bestProvenance(ranked);
  });
}

function bestProvenance(rows: EventProvenance[]): EventProvenance {
  return rows.reduce((best, row) => (adapterRank(row.adapterType) > adapterRank(best.adapterType) ? row : best));
}

export async function applyReview(
  db: Db,
  reviewId: string,
  verdict: 'approved' | 'rejected',
): Promise<void> {
  const review = await db.query.eventReviews.findFirst({ where: eq(schema.eventReviews.id, reviewId) });
  if (!review || review.status !== 'pending') return;
  if (verdict === 'approved') {
    const [a, b] = await provenanceFor(db, [review.eventAId, review.eventBId]);
    const canonical = pickCanonical(a, b);
    const duplicate = canonical.eventId === a.eventId ? b : a;
    const breakdown = review.breakdown as ScoredPair;
    await mergeEvents(db, canonical.eventId, duplicate.eventId, breakdown, 'review');
  }
  await db
    .update(schema.eventReviews)
    .set({ status: verdict, resolvedAt: new Date() })
    .where(eq(schema.eventReviews.id, reviewId));
}
```

- [ ] **Step 5: CLI + script**

```typescript
// src/dedup/run.ts
import 'dotenv/config';
import { db } from '@/db';
import { dedupSweep } from '@/dedup/sweep';

async function main() {
  const result = await dedupSweep(db);
  console.log(`dedup: ${result.examined} pairs examined, ${result.merged} merged, ${result.queued} queued for review`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`package.json` scripts, after `"ingest"`:

```json
    "dedup": "tsx src/dedup/run.ts",
```

- [ ] **Step 6: Run the sweep tests until green, then the full suite**

Run: `npx vitest run tests/dedup/sweep.test.ts` → iterate to PASS. Then `npm run test && npm run typecheck` → green.

Watch out: `applyReview`'s `review.breakdown` cast assumes the breakdown JSON holds the ScoredPair fields — `queuePair` spreads the full `scored` object, so it does.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: dedup sweep with auto-merge, review queue, and confidence-ladder canonical selection"
```

---

### Task 11: Retention — expire passed instances, orphaned events, superseded raw payloads

Policy (also record in README): instances are deleted 90 days after their start; events with zero remaining instances are deleted (cascade cleans links); the NEWEST raw payload per (source, sourceEventId) is kept forever as the replay/fixture source, while superseded payloads are pruned after 30 days. The public /events page already filters past events at query time — retention is DB hygiene, not UX.

**Files:**
- Create: `src/maintenance/retention.ts`, `src/maintenance/run.ts`
- Modify: `package.json`
- Test: `tests/maintenance/retention.test.ts` (create)

**Interfaces:**
- Produces: `runRetention(db, now?: Date): Promise<RetentionResult>` with `interface RetentionResult { instancesDeleted: number; eventsDeleted: number; rawEventsDeleted: number }`; `npm run retention`. Task 12's weekly task calls `runRetention`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/maintenance/retention.test.ts
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { runRetention } from '@/maintenance/retention';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { createTestDb } from '../helpers/test-db';

const NOW = new Date('2026-07-07T12:00:00Z');
const OLD = new Date('2026-03-01T00:00:00Z'); // > 90 days before NOW
const RECENT = new Date('2026-07-01T00:00:00Z');

async function seedSource(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [row] = await db.insert(schema.sources).values({
    key: 's1', name: 'S1', url: 'https://s1.example', adapterType: 'ical', config: {},
  }).returning();
  return { id: row.id, key: row.key };
}

function normalized(id: string, startAt: Date) {
  return {
    sourceEventId: id, title: `Event ${id}`, startAt,
    timezone: 'America/Chicago', status: 'scheduled' as const,
  };
}

describe('runRetention', () => {
  it('deletes long-passed instances and the events they leave empty', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    await persistNormalizedEvent(db, source, normalized('old-1', OLD));
    await persistNormalizedEvent(db, source, normalized('new-1', RECENT));
    const result = await runRetention(db, NOW);
    expect(result.instancesDeleted).toBe(1);
    expect(result.eventsDeleted).toBe(1);
    expect(await db.query.events.findMany()).toHaveLength(1);
    expect(await db.query.eventSourceLinks.findMany()).toHaveLength(1); // cascade cleaned the old link
  });

  it('keeps a multi-instance event alive while only its passed instance is pruned', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    await persistNormalizedEvent(db, source, normalized('multi-1', OLD));
    await persistNormalizedEvent(db, source, { ...normalized('multi-1', RECENT) });
    const result = await runRetention(db, NOW);
    expect(result.instancesDeleted).toBe(1);
    expect(result.eventsDeleted).toBe(0);
    expect(await db.query.events.findMany()).toHaveLength(1);
  });

  it('prunes superseded raw payloads older than 30 days but always keeps the newest', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const base = {
      sourceId: source.id, sourceEventId: 'raw-1', extractionMethod: 'ical',
    };
    await db.insert(schema.rawEvents).values([
      { ...base, payload: { v: 1 }, contentHash: 'h1', extractedAt: new Date('2026-04-01T00:00:00Z') },
      { ...base, payload: { v: 2 }, contentHash: 'h2', extractedAt: new Date('2026-05-01T00:00:00Z') },
      { ...base, payload: { v: 3 }, contentHash: 'h3', extractedAt: new Date('2026-07-06T00:00:00Z') },
    ]);
    const result = await runRetention(db, NOW);
    expect(result.rawEventsDeleted).toBe(2);
    const remaining = await db.query.rawEvents.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].contentHash).toBe('h3');
  });
});
```

Run: FAIL (module missing).

- [ ] **Step 2: Implement**

```typescript
// src/maintenance/retention.ts
import { sql } from 'drizzle-orm';
import type { Db } from '@/ingestion/persist';

export const INSTANCE_RETENTION_DAYS = 90;
export const RAW_SUPERSEDED_RETENTION_DAYS = 30;

export interface RetentionResult {
  instancesDeleted: number;
  eventsDeleted: number;
  rawEventsDeleted: number;
}

/** DB hygiene: listings already hide passed events at query time; this reclaims the rows. */
export async function runRetention(db: Db, now: Date = new Date()): Promise<RetentionResult> {
  const instanceCutoff = new Date(now.getTime() - INSTANCE_RETENTION_DAYS * 86_400_000);
  const rawCutoff = new Date(now.getTime() - RAW_SUPERSEDED_RETENTION_DAYS * 86_400_000);
  const instances = await db.execute(sql`
    DELETE FROM event_instances WHERE start_at < ${instanceCutoff} RETURNING id
  `);
  const events = await db.execute(sql`
    DELETE FROM events e
    WHERE NOT EXISTS (SELECT 1 FROM event_instances i WHERE i.event_id = e.id)
    RETURNING id
  `);
  const raw = await db.execute(sql`
    DELETE FROM raw_events r
    WHERE r.extracted_at < ${rawCutoff}
      AND EXISTS (
        SELECT 1 FROM raw_events newer
        WHERE newer.source_id = r.source_id
          AND newer.source_event_id = r.source_event_id
          AND newer.extracted_at > r.extracted_at
      )
    RETURNING id
  `);
  return {
    instancesDeleted: instances.rows.length,
    eventsDeleted: events.rows.length,
    rawEventsDeleted: raw.rows.length,
  };
}
```

```typescript
// src/maintenance/run.ts
import 'dotenv/config';
import { db } from '@/db';
import { runRetention } from '@/maintenance/retention';

async function main() {
  const result = await runRetention(db);
  console.log(
    `retention: ${result.instancesDeleted} instances, ${result.eventsDeleted} events, ${result.rawEventsDeleted} raw payloads removed`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`package.json` scripts, after `"dedup"`:

```json
    "retention": "tsx src/maintenance/run.ts",
```

Known trade-off (document in the task report): deleting an expired canonical event cascades its `event_clusters` receipts — merge history for long-dead events is not preserved. Acceptable for MVP.

- [ ] **Step 3: Run tests + typecheck**

Run: `npm run test && npm run typecheck` → green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: retention job for passed instances, empty events, superseded raw payloads"
```

---

### Task 12: Trigger.dev — config, ingest fan-out task, dedup/retention schedules, cadence, env docs

**Files:**
- Create: `trigger.config.ts`, `src/trigger/ingest.ts`, `src/trigger/maintenance.ts`, `src/ingestion/cadence.ts`
- Modify: `package.json` (dependency + scripts), `src/db/seed.ts` (cadence for milwaukee-downtown), `.env.example`, README (Task 13 finishes docs)
- Test: `tests/ingestion/cadence.test.ts` (create)

**Interfaces:**
- Consumes: `ingestSource`/`resolveAdapter` (existing), `shouldSkipForBackoff` (Task 5), `dedupSweep` (Task 10), `runRetention` (Task 11).
- Produces: `cadenceOf(config: unknown): 'daily' | 'weekly'` and `filterDueSources(sources, cadence, now)` from `@/ingestion/cadence`; Trigger tasks `ingest-source`, `ingest-daily`, `ingest-weekly`, `dedup-daily`, `retention-weekly`.

- [ ] **Step 1: Install the SDK and obtain the project ref**

```bash
npm install @trigger.dev/sdk@latest
```

Obtain the Trigger.dev project ref via the trigger MCP tools available in the controller session (`mcp__trigger__list_orgs` → `mcp__trigger__list_projects`; if no project exists, `mcp__trigger__create_project_in_org` with name `mke-events`). The controller passes the literal ref (format `proj_...`) into this task's brief. It is not a secret.

- [ ] **Step 2: Write trigger.config.ts**

```typescript
// trigger.config.ts
import { defineConfig } from '@trigger.dev/sdk';

export default defineConfig({
  project: 'proj_REPLACE_WITH_REAL_REF',
  dirs: ['./src/trigger'],
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 30_000,
      maxTimeoutInMs: 600_000,
      factor: 3,
      randomize: true,
    },
  },
  maxDuration: 600,
});
```

- [ ] **Step 3: Write the failing cadence tests**

```typescript
// tests/ingestion/cadence.test.ts
import { describe, expect, it } from 'vitest';
import { cadenceOf, filterDueSources } from '@/ingestion/cadence';

const NOW = new Date('2026-07-07T11:00:00Z');

describe('cadenceOf', () => {
  it('defaults to daily', () => {
    expect(cadenceOf({})).toBe('daily');
    expect(cadenceOf(null)).toBe('daily');
    expect(cadenceOf({ strategy: 'selectors' })).toBe('daily');
  });

  it('honors an explicit weekly cadence', () => {
    expect(cadenceOf({ cadence: 'weekly' })).toBe('weekly');
  });
});

describe('filterDueSources', () => {
  const healthy = { consecutiveFailures: 0, lastAttemptAt: null };
  const backedOff = { consecutiveFailures: 5, lastAttemptAt: new Date('2026-07-07T10:00:00Z') };
  const daily = { key: 'a', config: {}, ...healthy };
  const weekly = { key: 'b', config: { cadence: 'weekly' }, ...healthy };
  const failing = { key: 'c', config: {}, ...backedOff };

  it('daily run takes only daily-cadence sources outside backoff', () => {
    expect(filterDueSources([daily, weekly, failing], 'daily', NOW).map((s) => s.key)).toEqual(['a']);
  });

  it('weekly run takes every cadence, still honoring backoff', () => {
    expect(filterDueSources([daily, weekly, failing], 'weekly', NOW).map((s) => s.key)).toEqual(['a', 'b']);
  });
});
```

Run: FAIL. Then implement:

```typescript
// src/ingestion/cadence.ts
import { z } from 'zod';
import { shouldSkipForBackoff, type BackoffSource } from './backoff';

const cadenceSchema = z.object({ cadence: z.enum(['daily', 'weekly']).default('daily') });

export type Cadence = 'daily' | 'weekly';

/** Reads the optional cadence field out of a source's config jsonb; anything else means daily. */
export function cadenceOf(config: unknown): Cadence {
  const parsed = cadenceSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data.cadence : 'daily';
}

export interface SchedulableSource extends BackoffSource {
  key: string;
  config: unknown;
}

/** Daily runs take daily sources; weekly runs take everything. Backoff always wins. */
export function filterDueSources<T extends SchedulableSource>(
  sources: T[],
  cadence: Cadence,
  now: Date,
): T[] {
  return sources.filter(
    (source) =>
      !shouldSkipForBackoff(source, now) &&
      (cadence === 'weekly' || cadenceOf(source.config) === 'daily'),
  );
}
```

Run: PASS.

- [ ] **Step 4: Write the Trigger tasks**

```typescript
// src/trigger/ingest.ts
import { AbortTaskRunError, queue, schedules, schemaTask } from '@trigger.dev/sdk';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { resolveAdapter } from '@/ingestion/adapters/registry';
import { filterDueSources, type Cadence } from '@/ingestion/cadence';
import { ingestSource } from '@/ingestion/ingest';

/**
 * concurrencyLimit 1 + a per-source concurrencyKey at trigger time = strictly
 * serial runs per source (the link-race guard), parallel across sources.
 */
export const ingestQueue = queue({ name: 'ingest', concurrencyLimit: 1 });

export const ingestSourceTask = schemaTask({
  id: 'ingest-source',
  schema: z.object({ sourceKey: z.string().min(1) }),
  queue: ingestQueue,
  maxDuration: 600,
  run: async ({ sourceKey }) => {
    const source = await db.query.sources.findFirst({
      where: eq(schema.sources.key, sourceKey),
    });
    if (!source) throw new AbortTaskRunError(`Unknown source key: ${sourceKey}`);
    const adapter = resolveAdapter(source);
    return ingestSource(db, source, adapter);
  },
});

async function fanOut(cadence: Cadence): Promise<{ triggered: number }> {
  const sources = await db.query.sources.findMany();
  const due = filterDueSources(sources, cadence, new Date());
  if (due.length > 0) {
    await ingestSourceTask.batchTrigger(
      due.map((source) => ({
        payload: { sourceKey: source.key },
        options: { concurrencyKey: source.key },
      })),
    );
  }
  return { triggered: due.length };
}

export const ingestDaily = schedules.task({
  id: 'ingest-daily',
  cron: { pattern: '0 6 * * *', timezone: 'America/Chicago' },
  run: async () => fanOut('daily'),
});

export const ingestWeekly = schedules.task({
  id: 'ingest-weekly',
  cron: { pattern: '0 5 * * 1', timezone: 'America/Chicago' },
  run: async () => fanOut('weekly'),
});
```

```typescript
// src/trigger/maintenance.ts
import { schedules } from '@trigger.dev/sdk';
import { db } from '@/db';
import { dedupSweep } from '@/dedup/sweep';
import { runRetention } from '@/maintenance/retention';

/** Runs after the 6:00 ingest fan-out has had time to drain; sweep is idempotent either way. */
export const dedupDaily = schedules.task({
  id: 'dedup-daily',
  cron: { pattern: '0 8 * * *', timezone: 'America/Chicago' },
  run: async () => dedupSweep(db),
});

export const retentionWeekly = schedules.task({
  id: 'retention-weekly',
  cron: { pattern: '0 4 * * 1', timezone: 'America/Chicago' },
  run: async () => runRetention(db),
});
```

- [ ] **Step 5: Seed cadence + scripts + env docs**

`src/db/seed.ts` milwaukee-downtown config gains cadence (annual signature events churn slowly):

```typescript
    config: {
      strategy: 'selectors',
      listingUrls: ['https://www.milwaukeedowntown.com/signature-events/'],
      sourceKey: 'milwaukee-downtown',
      cadence: 'weekly',
    },
```

`package.json` scripts:

```json
    "trigger:dev": "npx trigger.dev@latest dev",
    "trigger:deploy": "npx trigger.dev@latest deploy",
```

`.env.example` — append (with comment):

```bash
# Trigger.dev: `npx trigger.dev@latest login` handles CLI auth; tasks running in the
# Trigger.dev cloud read DATABASE_URL (and the API keys above) from the project's
# environment variables — sync them in the Trigger.dev dashboard before deploying.
```

- [ ] **Step 6: Verify build + suite**

Run: `npm run test && npm run typecheck && npm run build`
Expected: all green — `src/trigger/` must not break the Next build (it is outside `app/`; the config file is root-level and inert to Next).

- [ ] **Step 7: Live dev verification (controller-assisted)**

Run `npm run trigger:dev` in the background, then via the trigger MCP: `mcp__trigger__trigger_task` task `ingest-source` payload `{"sourceKey":"linnemans"}`, then `mcp__trigger__wait_for_run_to_complete`. Expected: run COMPLETED, output shows fetched/published counts, and the linnemans source row's `lastAttemptAt`/count columns updated. Confirm in the dashboard that the four declarative schedules registered (ingest-daily, ingest-weekly, dedup-daily, retention-weekly). Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: Trigger.dev scheduled ingestion with per-source serialization, cadence, and maintenance schedules"
```

---

### Task 13: Production migration, live sweep, README + registry docs

**Files:**
- Modify: `README.md`
- No source changes (docs + operations)

- [ ] **Step 1: Apply migrations to production Neon**

Run: `npm run db:migrate`
Expected: migrations 0002-0006 apply cleanly (columns, backfill, tables, pg_trgm — Neon supports pg_trgm natively).

- [ ] **Step 2: Sequential live ingest sweep**

Run `npm run ingest -- <key>` for all 11 sources, SEQUENTIALLY (urban-milwaukee, linnemans, wmse, mke-shows, ticketmaster-milwaukee, eventbrite-cooperage, radio-milwaukee, milwaukee-world-festival, pabst-theater-group, milwaukee-downtown, brewers). Expected: all healthy; the sources table now shows per-run counts (`last_fetched_count`/`last_published_count`/`last_skipped_count`) including parse-time skips for the HTML sources.

- [ ] **Step 3: Live dedup + retention**

Run: `npm run dedup` → record merged/queued counts. Verify the amphitheater-headliner overlap: query `event_reviews` (joined to events/titles) and `event_clusters` for mwf×ticketmaster pairs — the overlap must be visible as merges or pending reviews, not silence. Run: `npm run retention` → record deletions (expect the lingering passed urban-milwaukee events to clear).

Spot-check with SQL (via the Neon MCP or psql): total events/instances/links before vs after; no event has zero instances; no instance has null source_id.

- [ ] **Step 4: README updates**

Update README: add `dedup`, `retention`, `trigger:dev`, `trigger:deploy` to the commands table; new "Dedup & review queue" section (blocking, scoring weights, thresholds, confidence ladder, review-queue semantics); new "Scheduling" section (the four schedules + cadence config + backoff policy + retention policy numbers); note the parse-skip counting rule in the source-table intro. Move nothing else.

- [ ] **Step 5: Full-suite final check + commit**

Run: `npm run test && npm run typecheck && npm run build`

```bash
git add -A
git commit -m "docs: dedup, scheduling, retention operations guide (MOO-255)"
```

---

## Decisions log

| Decision | Choice |
|---|---|
| Dedup blocking key | Same Chicago calendar day, cross-source pairs only (venue moved from blocking to scoring — the amphitheater/festival-park naming split would otherwise hide real duplicates) |
| Scoring | SQL pg_trgm similarity (PGlite 0.5.4 ships the contrib) + venue affinity + time proximity (midnight placeholders neutral) + URL match; weights 0.55/0.15/0.15/0.15 |
| Thresholds | ≥ 0.80 auto-merge, 0.55–0.80 review queue, below ignore — conservative on purpose; tune from live review-queue contents |
| Merge mechanics | Repoint links → move instances (collisions collapse on the (event_id, start_at) unique index) → backfill null fields → delete duplicate → cluster receipt last; recoverable without transactions, retention sweeps stranded duplicates |
| Same-source race | Fixed at BOTH layers: persistence catch-and-refetch (protects CLI) + Trigger queue concurrencyLimit 1 with per-source concurrencyKey (protects schedules) |
| Schedule shape | 2 ingest schedules (daily 6:00, weekly Mon 5:00 America/Chicago) fanning out to one task — not per-source schedules (free-tier limit is 10; we have 11 sources) |
| Backoff | App-level: skip a source after 3 consecutive failures for 24h·2^(n−3), capped at 7 days; Trigger run-level retries handle transients |
| Retention | Instances 90 days past start; empty events deleted; newest raw payload per (source, sourceEventId) kept forever, superseded ones pruned after 30 days |
| allDay flag | DEFERRED to Phase 4 (UI concern): midnight-placeholder starts remain the convention; instances carry explicit times; revisit with the event detail page design |
| rss adapterType | Still enum-only with no adapter (unchanged) — first rss source onboarding owns it |
| visit-milwaukee | Out of scope for 2c: the parallel follow-up found a zero-Firecrawl sitemap→detail-JSON-LD path (809 events) needing a new strategy shape — Tarik decision pending |

## Deferred (post-2c backlog)

- Admin review UI over `event_reviews`/`event_clusters` (Phase 5 per spec; `applyReview` is ready for it).
- shepherd-express, visit-milwaukee (strategy decision), county-parks (Firecrawl retry).
- Unifying the html adapter's page-level `dedupe()` with `dedupeDayRecords` (rule-of-three not met).
- Trigram GIN index on `events.normalized_title` (Phase 3 hybrid search will revisit indexing wholesale).
