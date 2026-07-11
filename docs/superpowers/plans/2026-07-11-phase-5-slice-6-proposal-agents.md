# Phase 5 Slice 6: Proposal Agents — Title Cleanup + Venue-Merge Proposals (Human-Gated) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two more advisory agents on the proven judge pattern — one proposes cleaned titles for scraper-junk events ("BILLY ALLEN AND THE POLLIES SHOW ON 7/18: VIVARIUM @ 7PM" → "Billy Allen + The Pollies"), one proposes venue merges for the long-tail variant clusters — both rendered as one-click Apply/Dismiss in the existing admin surfaces, with every Apply flowing through the lock/provenance/merge machinery a human already trusts.

**Architecture:** Same shape as Slice 5's judge, minus any promotion path: **PROPOSE-ONLY is the hard invariant** — agent code writes ONLY suggestion storage (two nullable columns on `events` for titles; a `venue_merge_suggestions` table for venues), and the Apply buttons call the *existing human mutations* (`updateEventWithDb` → provenance row + title lock; `mergeVenuesWithDb` → repoint/backfill/alias/delete). Title sweep rides the enrich-daily cron tail (it's enrichment-domain: fingerprint-style `title_suggested_at IS NULL` gate, scraper-sourced candidates only, model returns changed:false for already-clean titles). Venue proposals get a new weekly schedule: SQL trigram candidates (the same 0.45–0.92 similarity band the Slice 4 recon used) judged pairwise with venue context (addresses, hoods, event counts, sample titles); suggestions FK-cascade on either venue's deletion, so an applied merge self-cleans its own suggestion. Dismiss is durable (title: suggestion nulled, gate timestamp kept → never re-proposed; venue: status 'dismissed' + unique pair index). No eval harness this slice: unlike the judge, these agents have no autonomy path — a human applies 100% of proposals forever, and the live Apply/Dismiss ratio IS the quality signal.

**Tech Stack:** unchanged (`ai` v7 via AI Gateway / haiku / Drizzle on Neon HTTP / Zod 4 / Vitest + PGlite / Trigger.dev v4 pinned CLI 4.5.1).

## Global Constraints

Slice 1–5 constraints carry forward; additions in bold:

- **NO PRODUCTION WRITES during implementation.** Ship-only: `npm run db:migrate` (0018), one live title-sweep + venue-proposal run.
- **PROPOSE-ONLY HARD INVARIANT:** agent code writes ONLY `events.title_suggestion`/`title_suggested_at` and `venue_merge_suggestions` rows. NO agent code path calls `updateEventWithDb`, `mergeVenues`, `mergeEvents`, or touches `events.title`/locks/instances/links. Apply actions are `'use server'` wrappers gated on admin — human-initiated only. A reviewer finding agent-initiated application is a Critical.
- **Dual-deploy — TRIPPED:** Tasks 3 and 6 touch `src/enrichment/sweep.ts` and `src/trigger/maintenance.ts`. Ship runs `npm run trigger:deploy` (registers the NEW weekly schedule).
- **Advisory-never-blocks (judge precedent):** never-throws AI calls with `AbortSignal.timeout(15_000)`; no-key = no-op via `hasGatewayKey()`; cron tails wrapped in try/catch shields; capped per-tick limits with oldest-first ordering.
- **Frozen:** everything from prior slices — ≥0.80 auto-merge semantics, same-show constants, `same-show.test.ts`, `hybrid.ts`, `normalizeName`, `LOCKED_FIELD_VALUES`, lock-aware merges, the judge (`judge.ts`/`judge-sweep.ts` untouched), enrichment tag/embed logic (the title sweep is ADDITIVE tail in `enrichSweep`, the existing tag→embed ordering and fingerprint logic byte-identical).
- Zod 4 idioms; `'use server'` discipline (types from plain modules); envelope returns; DB failures caught + `console.error` + generic message; ALL dates via `chicagoDateLabel`.
- Tests on PGlite; DI'd agent fns (`suggestFn`/`proposeFn`) so tests make ZERO AI calls; `maxWorkers: 2`; per-file runs are the arbiter.
- **`git add` scoped; -A forbidden. `.env`/`.env.example` untouched** (no new env).
- Implementers: scrutinize plan code, verify anchors; 25+ plan-authored defects caught to date. Reviewers: verify reported counts against `git diff --stat` (3 prior line-count misreports).

**Commands:** standard + `npm run titles:suggest` / `npm run venues:propose` (new) / (ship) `db:migrate`, `trigger:deploy`.

## Decisions

1. **Title storage = two columns on `events`** (`title_suggestion text`, `title_suggested_at timestamptz`): a suggestion is a property of the event; `title_suggested_at` is the never-re-propose gate (survives both Apply and Dismiss — one shot per event unless an admin clears it in SQL; re-proposal churn on a declined suggestion is noise, not value). Dismiss nulls `title_suggestion` only. Apply routes through `updateEventWithDb` (title change → `event_edits` provenance row + `title` lock, ingestion can't revert) then nulls the suggestion.
2. **Venue storage = `venue_merge_suggestions` table** (`keep_venue_id` FK cascade, `absorb_venue_id` FK cascade, `confidence numeric`, `rationale text`, `status ['pending','dismissed']`, `created_at`; UNIQUE (keep, absorb)): FK cascade means an applied merge (which deletes the absorbed venue) auto-deletes its own suggestion — no post-apply bookkeeping. Dismissed rows persist and block re-proposal via the unique index (the sweep also excludes any existing pair either direction).
3. **Title candidates = scraper-sourced events** (canonical link adapter `html`/`firecrawl` — the same low-confidence definition as `/admin/events`) with `title_suggested_at IS NULL`, oldest-first, 25/tick on the enrich cron tail. The model gets title + venue + Chicago dates + source keys and returns `{ cleanTitle, changed, confidence, rationale }`; `changed: false` (or cleanTitle === title) still stamps the gate — "already clean" is a one-shot verdict too.
4. **Venue candidates = SQL trigram pairs** (`similarity(normalized_name) BETWEEN 0.45 AND 0.92`, both venues having ≥0 events, excluding pairs already suggested either direction and names already covered by `venue_aliases`), capped 20/run, weekly. The model gets both venues' full context (names, addresses, hoods, event counts, 3 sample event titles each) and returns `{ samePlace, confidence, keep: 'a' | 'b', rationale }`; only `samePlace: true` writes a suggestion (keep side per model, displayed to the human who can still merge the other direction via the manual form).
5. **New weekly schedule `venue-proposals-weekly`, Mon 9:00 America/Chicago** (after retention 4:00 / deep ingest 5:00 / enrich 7:00 / dedup 8:00) — venue drift is slow; weekly matches curation cadence. Title sweep needs no new schedule (enrich tail).
6. **No eval harness** (deviation from the judge, justified): these agents never act autonomously — a human applies 100% of proposals, so the promotion-gate machinery has nothing to gate. The Apply/Dismiss ratio in `event_edits` + suggestion rows is the ongoing quality record. If an auto-apply ambition ever emerges, an eval comes with it (ruling required then).
7. **UI placement:** title suggestions as a highlighted banner in the event editor (`/admin/events/[id]/edit`) with Apply/Dismiss + a "suggested" chip on `/admin/events` rows; venue proposals as cards at the top of `/admin/venues` with Apply/Dismiss. Both Apply paths show the exact resulting state ("title becomes …" / "X absorbs Y — Z events repoint").

---

### Task 1: Migration 0018 — title suggestion columns + `venue_merge_suggestions`

**Files:**
- Modify: `src/db/schema.ts` (events table after `lockedFields`; new table + relations after `venueAliases`)
- Create: `drizzle/0018_*.sql` via `npm run db:generate` (+ meta journal)
- Test: `tests/db/proposal-storage.test.ts` (create)

**Interfaces:**
- Produces: `schema.events.titleSuggestion` (text, nullable), `.titleSuggestedAt` (timestamptz, nullable); `schema.venueMergeSuggestions` — `id`, `keepVenueId` (uuid NOT NULL FK→venues ON DELETE CASCADE), `absorbVenueId` (same), `confidence` (numeric NOT NULL), `rationale` (text NOT NULL), `status` (text enum `['pending','dismissed']` NOT NULL default `'pending'`), `createdAt`; `venueMergeSuggestionsRelations` (keepVenue, absorbVenue one-relations); UNIQUE index `venue_merge_suggestions_pair_idx` on (keepVenueId, absorbVenueId).

- [ ] **Step 1: Failing test**

```typescript
// tests/db/proposal-storage.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('migration 0018: proposal storage', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('title suggestion columns default null and round-trip', async () => {
    const [event] = await db.insert(schema.events)
      .values({ slug: 'ts1', title: 'RAW TITLE @ 7PM', normalizedTitle: 'raw title 7pm' }).returning();
    expect(event.titleSuggestion).toBeNull();
    expect(event.titleSuggestedAt).toBeNull();
    await db.update(schema.events)
      .set({ titleSuggestion: 'Raw Title', titleSuggestedAt: new Date() })
      .where(eq(schema.events.id, event.id));
    const updated = await db.query.events.findFirst({ where: eq(schema.events.id, event.id) });
    expect(updated?.titleSuggestion).toBe('Raw Title');
    expect(updated?.titleSuggestedAt).toBeInstanceOf(Date);
  });

  it('venue suggestions enforce pair uniqueness and cascade with either venue', async () => {
    const [keep] = await db.insert(schema.venues).values({ name: 'K', normalizedName: 'k v' }).returning();
    const [absorb] = await db.insert(schema.venues).values({ name: 'A', normalizedName: 'a v' }).returning();
    await db.insert(schema.venueMergeSuggestions).values({
      keepVenueId: keep.id, absorbVenueId: absorb.id, confidence: '0.8800', rationale: 'same place',
    });
    await expect(
      db.insert(schema.venueMergeSuggestions).values({
        keepVenueId: keep.id, absorbVenueId: absorb.id, confidence: '0.5000', rationale: 'dup',
      }),
    ).rejects.toThrow();
    await db.delete(schema.venues).where(eq(schema.venues.id, absorb.id));
    expect(await db.query.venueMergeSuggestions.findMany()).toEqual([]);
  });
});
```

- [ ] **Step 2: RED run** (`npx vitest run tests/db/proposal-storage.test.ts`)

- [ ] **Step 3: Schema** — in `src/db/schema.ts`, inside `events` after `lockedFields`:

```typescript
    // Advisory AI title-cleanup proposal (propose-only — a human applies via the
    // editor, which locks + records provenance). titleSuggestedAt is a one-shot
    // gate: set on every sweep verdict (incl. "already clean") and kept on dismiss.
    titleSuggestion: text('title_suggestion'),
    titleSuggestedAt: timestamp('title_suggested_at', { withTimezone: true }),
```

After `venueAliasesRelations`:

```typescript
// Advisory AI venue-merge proposals (propose-only — a human applies via the
// existing mergeVenues path). FK cascade: an applied merge deletes the absorbed
// venue and this row with it; 'dismissed' rows persist and block re-proposal
// together with the unique pair index.
export const venueMergeSuggestions = pgTable(
  'venue_merge_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    keepVenueId: uuid('keep_venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    absorbVenueId: uuid('absorb_venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    confidence: numeric('confidence').notNull(),
    rationale: text('rationale').notNull(),
    status: text('status', { enum: ['pending', 'dismissed'] }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('venue_merge_suggestions_pair_idx').on(t.keepVenueId, t.absorbVenueId)],
);

export const venueMergeSuggestionsRelations = relations(venueMergeSuggestions, ({ one }) => ({
  keepVenue: one(venues, { fields: [venueMergeSuggestions.keepVenueId], references: [venues.id] }),
  absorbVenue: one(venues, { fields: [venueMergeSuggestions.absorbVenueId], references: [venues.id] }),
}));
```

- [ ] **Step 4: Generate** — `npm run db:generate`; inspect 0018: two ADD COLUMNs + CREATE TABLE + unique index + two FKs, pure DDL. NO db:migrate.
- [ ] **Step 5: GREEN (2/2) + typecheck + commit**

```bash
git add src/db/schema.ts drizzle tests/db/proposal-storage.test.ts
git commit -m "feat: migration 0018 — title suggestion columns + venue_merge_suggestions"
```

### Task 2: `suggestTitle` — the cleanup call

**Files:**
- Create: `src/enrichment/title-suggest.ts`
- Test: `tests/enrichment/title-suggest.test.ts` (create)

**Interfaces:**
- Produces: `titleSuggestionSchema` + `TitleSuggestion = { cleanTitle: string; changed: boolean; confidence: number; rationale: string }`; `SuggestTitleInput = { title: string; venueName: string | null; startsChicago: string[]; sourceKeys: string[] }`; `suggestTitle(input): Promise<TitleSuggestion | null>` (never throws, 15s abort); `buildTitlePrompt(input): string` (exported for tests).

- [ ] **Step 1: Failing tests** (pure — prompt fragments + schema bounds, per tests/dedup/judge.test.ts's idiom):

```typescript
// tests/enrichment/title-suggest.test.ts
import { describe, expect, it } from 'vitest';
import { buildTitlePrompt, titleSuggestionSchema, type SuggestTitleInput } from '@/enrichment/title-suggest';

const INPUT: SuggestTitleInput = {
  title: 'BILLY ALLEN AND THE POLLIES SHOW ON 7/18: VIVARIUM @ 7PM',
  venueName: 'Vivarium',
  startsChicago: ['Sat, Jul 18, 7:00 PM'],
  sourceKeys: ['visit-milwaukee'],
};

describe('buildTitlePrompt', () => {
  it('carries the event facts and the preservation rules', () => {
    const prompt = buildTitlePrompt(INPUT);
    for (const fragment of [
      'BILLY ALLEN AND THE POLLIES SHOW ON 7/18: VIVARIUM @ 7PM',
      'Vivarium', 'Sat, Jul 18, 7:00 PM', 'visit-milwaukee',
      'never invent', 'support act', 'changed: false',
    ]) {
      expect(prompt).toContain(fragment);
    }
  });
});

describe('titleSuggestionSchema', () => {
  it('bounds cleanTitle length, confidence range, and rationale length', () => {
    expect(titleSuggestionSchema.safeParse({ cleanTitle: 'Billy Allen + The Pollies', changed: true, confidence: 0.95, rationale: 'stripped date/venue junk' }).success).toBe(true);
    expect(titleSuggestionSchema.safeParse({ cleanTitle: 'x'.repeat(400), changed: true, confidence: 0.9, rationale: 'r' }).success).toBe(false);
    expect(titleSuggestionSchema.safeParse({ cleanTitle: 'ok', changed: true, confidence: 1.2, rationale: 'r' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: RED**, then implement:

```typescript
// src/enrichment/title-suggest.ts
// Advisory title-cleanup proposal (propose-only — a human applies via the editor,
// which locks + records provenance). Mirrors dedup/judge.ts: one structured haiku
// call, 15s abort, never throws.
import { generateText, Output } from 'ai';
import { z } from 'zod';

const TITLE_MODEL = 'anthropic/claude-haiku-4-5';
const TITLE_TIMEOUT_MS = 15_000;
const MAX_TITLE_CHARS = 300;
const MAX_RATIONALE_CHARS = 200;

export const titleSuggestionSchema = z.object({
  cleanTitle: z.string().min(1).max(MAX_TITLE_CHARS),
  changed: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(MAX_RATIONALE_CHARS),
});
export type TitleSuggestion = z.infer<typeof titleSuggestionSchema>;

export interface SuggestTitleInput {
  title: string;
  venueName: string | null;
  startsChicago: string[];
  sourceKeys: string[];
}

export function buildTitlePrompt(input: SuggestTitleInput): string {
  return [
    'Clean up this scraped Milwaukee event title for a public events calendar.',
    `Raw title: "${input.title}"`,
    `Venue (already shown separately on the site): ${input.venueName ?? 'unknown'}`,
    `Date/time (already shown separately): ${input.startsChicago.join('; ') || 'unknown'}`,
    `Sources: ${input.sourceKeys.join(', ')}`,
    '',
    'Rules:',
    '- Remove embedded venue names, dates, times, and ticket/price junk — the site displays those separately.',
    '- Fix ALL-CAPS or shouty casing to natural title casing; keep intentional stylization (e.g. an artist named "JADY" stays if the casing is the artist\'s own — when unsure, prefer natural casing).',
    '- Preserve the full bill: keep support act names and separators like "w/", "+", "•" in the artist\'s own style.',
    '- never invent, add, translate, or reorder information that is not in the raw title.',
    `- If the raw title is already clean, return it unchanged with changed: false.`,
    '',
    'cleanTitle: the cleaned title (or the original if already clean).',
    'changed: false if the raw title needed no cleanup.',
    'confidence: 0-1, your certainty that cleanTitle is faithful and strictly better.',
    `rationale: one short sentence (under ${MAX_RATIONALE_CHARS} chars) naming what was removed or fixed.`,
  ].join('\n');
}

/** Never throws: any model/network/validation failure yields null (skip; gate stays open for retry). */
export async function suggestTitle(input: SuggestTitleInput): Promise<TitleSuggestion | null> {
  try {
    const { output } = await generateText({
      model: TITLE_MODEL,
      output: Output.object({ schema: titleSuggestionSchema }),
      prompt: buildTitlePrompt(input),
      abortSignal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
    });
    return output;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: GREEN + typecheck + commit**

```bash
git add src/enrichment/title-suggest.ts tests/enrichment/title-suggest.test.ts
git commit -m "feat: suggestTitle — advisory title-cleanup call"
```

### Task 3: Title sweep + enrich-cron tail + CLI

**Files:**
- Create: `src/enrichment/title-suggest-sweep.ts`, `src/enrichment/run-title-suggest.ts` (CLI)
- Modify: `src/enrichment/sweep.ts` (tail of `enrichSweep` + `EnrichResult.titleSuggestions`), `package.json` (`"titles:suggest": "tsx src/enrichment/run-title-suggest.ts"`)
- Test: `tests/enrichment/title-suggest-sweep.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 columns; Task 2's `suggestTitle`/`TitleSuggestion`/`SuggestTitleInput`; `hasGatewayKey` from './embed'; `chicagoDateLabel` from '@/lib/display'; `Db` from '@/db/types'.
- Produces: `suggestTitles(db, opts?: { limit?: number; suggestFn?: typeof suggestTitle }): Promise<{ suggested: number; alreadyClean: number; skipped: number }>`; `EnrichResult` gains `titleSuggestions: number`; cron tail uses `CRON_TITLE_LIMIT = 25`.

Sweep semantics (implement per these exact rules, judge-sweep.ts:118-175 is the structural template):
- Candidates: events whose CANONICAL source link's adapter is `html`/`firecrawl` (join eventSourceLinks WHERE isCanonical + sources) AND `titleSuggestedAt IS NULL`, `orderBy asc(events.createdAt)`, limit.
- Per candidate: load venue name + up to 3 instance starts (chicagoDateLabel) + source keys → `suggestFn`.
- Null result → `skipped += 1`, gate stays NULL (retry next sweep).
- Result with `changed: false` OR `cleanTitle === title` → stamp `titleSuggestedAt` only (`alreadyClean += 1`) — one-shot verdict.
- Result with a real change → write BOTH columns, guarded `WHERE titleSuggestedAt IS NULL` (mid-flight idempotence), `suggested += 1` only when the UPDATE hit a row (rows-affected honest count, the S5 lesson).
- `hasGatewayKey()` gate first.
- `enrichSweep` tail: after the embed sweep, `try { const t = await suggestTitles(db, { limit: CRON_TITLE_LIMIT }); result.titleSuggestions = t.suggested; } catch (error) { console.error('title suggest sweep failed', error); }` — shield idiom, `titleSuggestions` initialized 0. Existing tag→embed ordering and all current logic byte-untouched.
- CLI mirrors run-judge.ts (dotenv, guarded main, default limit 50).

- [ ] **Step 1: Failing tests** — DI'd `suggestFn`, zero AI calls; seed events with canonical html-source links (copy tests/queries/admin-events.test.ts's seeding idiom for source+link+event):

```typescript
// tests/enrichment/title-suggest-sweep.test.ts — skeletons; flesh with real helpers
describe('suggestTitles', () => {
  it('proposes for a scraper-sourced junk title and stamps both columns', async () => {});
  it('stamps only the gate for an already-clean verdict (changed: false)', async () => {});
  it('never selects api/ical-sourced events or already-gated events', async () => {});
  it('null suggestion = skip, gate stays NULL for retry', async () => {});
  it('PROPOSE-ONLY invariant: events.title, lockedFields, instances, links byte-untouched', async () => {});
  it('respects limit oldest-first', async () => {});
});
```

Each skeleton becomes real code with explicit before/after assertions (the invariant test does full-row masked toEqual per tests/dedup/judge-sweep.test.ts's ANNOTATE-ONLY test idiom — read it and copy the shape).

- [ ] **Step 2: RED → implement → GREEN**; `npx vitest run tests/enrichment/` ALL green (existing tag/embed tests untouched and passing = the additive-tail proof); `npm run typecheck`.
- [ ] **Step 3: Commit**

```bash
git add src/enrichment/title-suggest-sweep.ts src/enrichment/run-title-suggest.ts src/enrichment/sweep.ts package.json tests/enrichment/title-suggest-sweep.test.ts
git commit -m "feat: advisory title-suggestion sweep on the enrich cron tail"
```

### Task 4: Title suggestion UI — editor banner + list chip + Apply/Dismiss

**Files:**
- Modify: `src/app/actions/admin-events.ts` (two pure fns), `src/app/actions/admin-events-actions.ts` (two wrappers), `src/app/admin/events/[id]/edit/page.tsx` (banner), `src/queries/admin-events.ts` + `src/app/admin/events/page.tsx` (chip: `AdminEventRow.hasTitleSuggestion`)
- Create: `src/components/admin/title-suggestion-banner.tsx`
- Test: `tests/actions/admin-events.test.ts` (extend, 3 cases)

**Interfaces:**
- Consumes: Task 1 columns; existing `updateEventWithDb` (the diff/lock/provenance path) and `EventActionState`.
- Produces: `applyTitleSuggestionWithDb(db, editedBy, input): Promise<EventActionState>` — reads the suggestion; calls `updateEventWithDb` with the event's CURRENT status/category/venueId and the suggested title (one-field diff → provenance + `title` lock); on success nulls `titleSuggestion` (gate timestamp kept). `dismissTitleSuggestionWithDb(db, editedBy, input)` — nulls `titleSuggestion` only, writes an `event_edits` row (`field: 'title-suggestion'`, `oldValue: <the suggestion>`, `newValue: 'dismissed'`) so declines are visible in history. Wrappers `applyTitleSuggestionAction`/`dismissTitleSuggestionAction` (admin gate + revalidate, mirroring `updateEventAction`).

- [ ] **Step 1: Failing tests** (extend tests/actions/admin-events.test.ts with its own seeding idiom):

```typescript
  it('applyTitleSuggestion routes through the editor mutation: title updated, locked, provenance row, suggestion cleared, gate kept', async () => {});
  it('applyTitleSuggestion with no suggestion present returns a friendly envelope', async () => {});
  it('dismissTitleSuggestion clears the suggestion, keeps the gate, and audits the decline', async () => {});
```

(Flesh out; the apply case asserts: `events.title` = suggestion, `lockedFields` contains 'title', an `event_edits` row with the old→new titles exists, `titleSuggestion` NULL, `titleSuggestedAt` still set.)

- [ ] **Step 2: RED → implement.** `applyTitleSuggestionWithDb` shape (write exactly; ≤20-line helpers where natural):

```typescript
const suggestionSchema = z.object({ eventId: z.uuid() });

export async function applyTitleSuggestionWithDb(
  db: Db,
  editedBy: string,
  input: EventEditInput,
): Promise<EventActionState> {
  const parsed = suggestionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Unknown event.' };
  try {
    const event = await db.query.events.findFirst({ where: eq(schema.events.id, parsed.data.eventId) });
    if (!event) return { ok: false, message: 'Event not found.' };
    if (!event.titleSuggestion) return { ok: false, message: 'No pending title suggestion.' };
    // Route through the human mutation: provenance row + title lock for free.
    const applied = await updateEventWithDb(db, editedBy, {
      eventId: event.id,
      title: event.titleSuggestion,
      status: event.status,
      category: event.category ?? '',
      venueId: event.venueId ?? '',
    });
    if (!applied.ok) return applied;
    await db.update(schema.events)
      .set({ titleSuggestion: null })
      .where(eq(schema.events.id, event.id));
    return { ok: true, message: 'Suggestion applied — title locked against re-ingest.' };
  } catch (error) {
    console.error('applyTitleSuggestionWithDb failed', error);
    return { ok: false, message: 'Could not apply the suggestion. Try again.' };
  }
}
```

`dismissTitleSuggestionWithDb` mirrors it (recordEdits-style audit row via the existing `recordEdits` helper with `field: 'title-suggestion'`, then null the suggestion). Wrappers mirror `updateEventAction` exactly (admin gate → call → revalidate on ok).

- [ ] **Step 3: Banner component** (`title-suggestion-banner.tsx`, useActionState per review-decision-form idiom, ≤70 lines): renders `AI suggests: "{suggestion}"` + rationale-free (rationale isn't stored — the suggestion IS the pitch), Apply button (confirm(): "Apply this title? It will be locked against re-ingestion.") + Dismiss button, envelope message. Editor page renders it above the event form when `event.titleSuggestion` is non-null, passing both actions. List page: `AdminEventRow` gains `hasTitleSuggestion: boolean` (from `titleSuggestion IS NOT NULL`), rendered as a `<Badge variant="secondary">AI title</Badge>` chip beside the low-confidence chip; extend the existing admin-events query test with one assertion.
- [ ] **Step 4: GREEN + typecheck + build + commit**

```bash
git add src/app/actions/admin-events.ts src/app/actions/admin-events-actions.ts src/app/admin/events/[id]/edit/page.tsx src/components/admin/title-suggestion-banner.tsx src/queries/admin-events.ts src/app/admin/events/page.tsx tests/actions/admin-events.test.ts tests/queries/admin-events.test.ts
git commit -m "feat: title-suggestion banner + apply/dismiss through the editor mutation"
```

### Task 5: `proposeVenueMerge` + trigram candidates

**Files:**
- Create: `src/maintenance/venue-proposals.ts` (call + candidate SQL together — they change together)
- Test: `tests/maintenance/venue-proposals.test.ts` (create)

**Interfaces:**
- Produces: `venueProposalSchema` + `VenueProposal = { samePlace: boolean; confidence: number; keep: 'a' | 'b'; rationale: string }`; `VenuePairInput = { nameA, nameB, addressA, addressB, hoodA, hoodB, eventCountA, eventCountB, sampleTitlesA, sampleTitlesB }` (strings nullable, counts numbers, samples string[]); `proposeVenueMerge(input): Promise<VenueProposal | null>` (never throws, 15s abort); `buildVenuePrompt(input)` exported; `findVenuePairCandidates(db, limit): Promise<CandidatePair[]>` where `CandidatePair = { venueAId, venueBId, similarity: number }`.

- Candidate SQL (raw `sql` via db.execute, pg_trgm): self-join venues on `a.id < b.id`, `similarity(a.normalized_name, b.normalized_name) BETWEEN 0.45 AND 0.92`, EXCLUDE pairs with an existing suggestion row in EITHER direction (NOT EXISTS on venue_merge_suggestions both orderings), ORDER BY similarity DESC LIMIT `limit`. (0.92 ceiling: near-identical names above that are auto-merge territory the dedup layer already handles via events; the band is where judgment lives.)
- Prompt teaches the known traps from Slice 4's curation: rooms-within-a-building (Falcon Bowl vs Falcon Nest — DIFFERENT), park vs its bandshell (DIFFERENT unless the corpus treats them as one), venue vs its street address (SAME place), "The X" vs "X" (SAME), name + embedded address (SAME). `samePlace: true` requires the model to name which side has the cleaner canonical name (`keep`).

- [ ] **Step 1: Failing tests** — prompt fragments + schema bounds (pure) + candidate SQL against seeded PGlite venues (three venues: two similar names in-band, one distinct; one pre-existing suggestion pair excluded both directions):

```typescript
describe('findVenuePairCandidates', () => {
  it('returns in-band trigram pairs, excludes suggested pairs in either direction, orders by similarity', async () => {});
});
describe('buildVenuePrompt', () => {
  it('carries both venues\' facts and the rooms/address/The-prefix trap guidance', () => {});
});
describe('venueProposalSchema', () => {
  it('bounds confidence and requires keep a|b', () => {});
});
```

(Flesh out with explicit fixtures; trigram is available in PGlite — tests/dedup rely on it already.)

- [ ] **Step 2: RED → implement → GREEN + typecheck + commit**

```bash
git add src/maintenance/venue-proposals.ts tests/maintenance/venue-proposals.test.ts
git commit -m "feat: proposeVenueMerge call + trigram candidate query"
```

### Task 6: Venue proposal sweep + weekly schedule + CLI

**Files:**
- Modify: `src/maintenance/venue-proposals.ts` (add the sweep), `src/trigger/maintenance.ts` (new schedule), `package.json` (`"venues:propose": "tsx src/maintenance/run-venue-proposals.ts"`)
- Create: `src/maintenance/run-venue-proposals.ts` (CLI)
- Test: `tests/maintenance/venue-proposals.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 table; Task 5's pieces; `hasGatewayKey`.
- Produces: `proposeVenueMerges(db, opts?: { limit?: number; proposeFn?: typeof proposeVenueMerge }): Promise<{ proposed: number; rejected: number; skipped: number }>` — per candidate pair: load both venues' context (name/address/neighborhood/event count/3 sample event titles ordered by createdAt desc) → `proposeFn` → `samePlace: false` → `rejected += 1` AND write a `status: 'dismissed'` suggestion row (the model's own no = durable no-re-propose; rationale stored); `samePlace: true` → pending row with keep/absorb per the model's `keep` side; null → `skipped`, no row (retry next run); insert `.onConflictDoNothing()` on the pair index. New schedule in src/trigger/maintenance.ts:

```typescript
/** Weekly venue-merge proposals (advisory; humans apply in /admin/venues). Key-gated no-op. */
export const venueProposalsWeekly = schedules.task({
  id: 'venue-proposals-weekly',
  cron: { pattern: '0 9 * * 1', timezone: 'America/Chicago' },
  run: async () => proposeVenueMerges(db, { limit: CRON_PROPOSAL_LIMIT }),
});
```

with `CRON_PROPOSAL_LIMIT = 20` (20 × 15s worst = 300s, half the 600s budget — the S5 rule). CLI mirrors run-judge.ts.

- [ ] **Step 1: Failing tests** (extend; DI'd proposeFn):

```typescript
  it('writes a pending suggestion for samePlace with the model\'s keep side', async () => {});
  it('writes a dismissed suggestion for a model no (durable, never re-proposed)', async () => {});
  it('null proposal = skip, no row, candidate reappears next run', async () => {});
  it('PROPOSE-ONLY invariant: venues and events tables byte-untouched', async () => {});
  it('no-key = no-op', async () => {});
```

- [ ] **Step 2: RED → implement → GREEN**; `npx vitest run tests/maintenance/` ALL green; typecheck.
- [ ] **Step 3: Commit**

```bash
git add src/maintenance/venue-proposals.ts src/maintenance/run-venue-proposals.ts src/trigger/maintenance.ts package.json tests/maintenance/venue-proposals.test.ts
git commit -m "feat: weekly advisory venue-merge proposal sweep"
```

### Task 7: Venue proposal cards in `/admin/venues`

**Files:**
- Create: `src/app/actions/admin-venue-suggestions.ts` (pure), `src/components/admin/venue-proposal-card.tsx`
- Modify: `src/app/actions/admin-venues-actions.ts` (two wrappers), `src/queries/admin-venues.ts` (`pendingVenueSuggestions(db)`), `src/app/admin/venues/page.tsx` (cards above the form)
- Test: `tests/actions/admin-venue-suggestions.test.ts` (create), `tests/queries/admin-venues.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 table + relations; existing `mergeVenuesWithDb` (Slice 4) + `VenueActionState`.
- Produces: `pendingVenueSuggestions(db): Promise<VenueSuggestionRow[]>` where `VenueSuggestionRow = { suggestionId, keepVenueId, keepName, keepEventCount, absorbVenueId, absorbName, absorbEventCount, confidence: number, rationale }` (status pending, newest first); `applyVenueSuggestionWithDb(db, input): Promise<VenueActionState>` — looks up the pending suggestion by id, calls `mergeVenuesWithDb(db, { keepId, absorbId })` (the FK cascade then deletes the suggestion row itself — assert that in the test); `dismissVenueSuggestionWithDb(db, input)` — CAS `status: 'dismissed'` WHERE pending. Wrappers with admin gate + revalidatePath(['/admin/venues','/admin/events','/','/events']).

- [ ] **Step 1: Failing tests**:

```typescript
  it('applyVenueSuggestion merges via the existing core and the suggestion row cascades away', async () => {});
  it('apply on an already-resolved suggestion returns an envelope, not a crash', async () => {});
  it('dismiss is a CAS to dismissed and survives a second dismiss cleanly', async () => {});
  it('pendingVenueSuggestions carries names/counts and excludes dismissed', async () => {});
```

- [ ] **Step 2: RED → implement.** Card component (≤70 lines, review-decision-form idiom): "**Keep** {keepName} ({keepEventCount} events) ← **absorb** {absorbName} ({absorbEventCount})" + confidence % + rationale + Apply (confirm(): "Merge these venues? {absorbName} is deleted, its name becomes an alias, and {absorbEventCount} events repoint. This cannot be undone.") + Dismiss. Page: `const suggestions = await pendingVenueSuggestions(db);` renders a "Proposed merges" section above the manual form when non-empty.
- [ ] **Step 3: GREEN + typecheck + build + commit**

```bash
git add src/app/actions/admin-venue-suggestions.ts src/app/actions/admin-venues-actions.ts src/components/admin/venue-proposal-card.tsx src/queries/admin-venues.ts src/app/admin/venues/page.tsx tests/actions/admin-venue-suggestions.test.ts tests/queries/admin-venues.test.ts
git commit -m "feat: venue-merge proposal cards with apply/dismiss in /admin/venues"
```

### Task 8: README, gates, ship checklist

**Files:**
- Modify: `README.md` (proposal-agents subsection extending the AI-judge section + two Commands rows)

- [ ] **Step 1: README** — extend the AI section: the two proposal agents, PROPOSE-ONLY contract (agents write only suggestion storage; every Apply is a human action through the lock/provenance/merge machinery), the one-shot title gate + durable dismisses, the weekly venue-proposal schedule, the trap guidance (rooms/bandshells stay separate), no-eval rationale (no autonomy path — the Apply/Dismiss record is the quality signal), Commands rows (`titles:suggest`, `venues:propose`). Claims source-traced (reviewer audits).
- [ ] **Step 2: Full gates, quiet machine** — `npm run test` (~485+), `npm run typecheck`, `npm run build`, `npm run e2e` (17).
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: advisory proposal agents — title cleanup + venue merges"
```

- [ ] **Step 4: Ship checklist (finishing pass — do NOT execute in-task)**

1. Merge → main, push. 2. `npm run db:migrate` (0018; verify by read). 3. `vercel deploy --prod`. 4. **`npm run trigger:deploy` MANDATORY** (enrich tail + NEW venue-proposals-weekly schedule must register — verify 7 tasks detected, up from 6). 5. Live title sweep: `npm run titles:suggest` (local key present) — record suggested/alreadyClean counts; spot-read 5 suggestions by SQL for sanity. 6. Live venue proposals: `npm run venues:propose` — record proposed/rejected; expect the Shank Hall dash-variant + address-only rows to surface. 7. Tarik eyeballs both surfaces, applies at least one title + one venue proposal (screenshots optional — the event_edits rows and merge receipts are the durable evidence). 8. Evidence comment + close the slice issue.

## Verification summary

- Scraper-junk titles get one-shot advisory suggestions applied through the existing lock/provenance mutation (Tasks 2–4); Slice 4's surfaced long-tail venue clusters get weekly advisory merge proposals applied through the existing merge core (Tasks 5–7).
- PROPOSE-ONLY regression-tested on both sweeps (byte-untouched invariant tests, judge-sweep idiom).
- All S5 reliability lessons pre-applied: 15s aborts, cron shields, capped oldest-first batches, rows-affected-honest counts, durable dismisses.

## Open rulings for Tarik (asked at plan review)

1. Execution mode (subagent-driven recommended).
2. Confirm: NO auto-apply for any title suggestion (even pure case fixes) — every apply is a human click. (Recommended: yes, keep the human gate absolute; the click is cheap and the apply-rate data feeds any future loosening.)
