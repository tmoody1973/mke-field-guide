# Phase 3: Hybrid Search & Filtering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close MOO-256: one search box handling both "pabst theater comedy" and "something chill outdoors with the kids sunday afternoon", plus URL-addressable facet filtering — p95 < 300ms on a committed 10-query eval set.

**Architecture:** Ingest-time AI only: a sweep task (contentHash-fingerprint-gated, never coupled to the publish path) embeds published events (`embedMany` via Vercel AI Gateway, `openai/text-embedding-3-small`, 1536d → pgvector HNSW) and tags them (`generateObject` via `anthropic/claude-haiku-4-5` → category/vibe/audience/price columns). Retrieval is ONE SQL round trip: an instances-window base CTE (facets as indexed WHERE clauses) feeding two ranked legs — weighted FTS on a generated tsvector (+ trigram typo/venue affinity) and vector cosine — merged by reciprocal rank fusion. Query-side date phrases are stripped by pure chicago-time heuristics before retrieval; the ONLY hot-path AI call is the query embedding, wrapped in a 150ms timeout that falls back to FTS-only, and skipped entirely when `AI_GATEWAY_API_KEY` is absent (credential-pending activation, like Ticketmaster/Eventbrite were).

**Tech Stack:** Next.js 16 App Router / Drizzle 0.45 / Neon (HTTP driver — no transactions) / pgvector + pg_trgm + native FTS / AI SDK v6 (`ai` package, gateway provider strings) / PGlite 0.5.4 + `@electric-sql/pglite-pgvector` (dev) / Zod 4 / Vitest 4 / Trigger.dev v4.

## Global Constraints

Every task's requirements implicitly include all of these:

- Functions ≤ 20 lines; files focused; extract helpers rather than grow functions.
- All timestamps timestamptz. ANY date logic through `src/lib/chicago-time.ts` helpers.
- Zod at every boundary: searchParams, AI structured output, task payloads, env-gated config.
- Secrets env-only. New key: `AI_GATEWAY_API_KEY` (documented, never committed, gracefully absent).
- Tests on PGlite only, replaying `drizzle/*.sql`; **AI calls are always mocked in tests** (`vi.mock('ai', ...)`) — no network, no key needed.
- AI usage: only via the `ai` package with gateway model strings (`openai/text-embedding-3-small`, `anthropic/claude-haiku-4-5`). **No LLM in the search hot path** — the sole query-time AI call is `embed()` for the query vector, timeout-capped with FTS-only fallback.
- **Enrichment-owned columns (`category`, `vibeTags`, `audienceTags`, `priceMin`, `priceMax`, `embedding`, `embeddedAt`, `contentFingerprint`) must NEVER enter `eventFields` in persist.ts** — that exclusion is what protects them from being overwritten on every re-ingest. `isFree` stays adapter-owned; enrichment only fills it when null.
- Re-embedding is gated on the content fingerprint (title/description change), never on `updatedAt` (which churns every crawl).
- Neon HTTP driver: no transactions; sweeps are idempotent, per-row.
- Frozen invariants: jsonld fallback-id format; the day-instance pattern; `maintainLink` isCanonical guard.
- Search results only ever include future instances (`startAt >= now` in the base CTE).
- Migration ordering: the `CREATE EXTENSION vector` custom migration MUST sort before any migration using the `vector` type (PGlite replays files name-sorted).
- Live ingest/enrich/eval against production is authorized; enrichment runs respect batch caps.

**Commands:** `npm run test` / `npm run typecheck` / `npm run db:generate` / `npm run db:migrate` (production only in the task that says so).

---

### Task 1: Vector foundations — deps, extension, embedding columns, PGlite gate

This task is the GATE for the whole vector path: it proves `CREATE EXTENSION vector`, a `vector(1536)` column, the `<=>` operator, and an HNSW index all work inside the PGlite test harness before anything builds on them.

**Files:**
- Modify: `package.json` (deps), `src/db/schema.ts` (events columns), `tests/helpers/test-db.ts`
- Create: `drizzle/0007_enable-pgvector.sql` (custom), generated `drizzle/0008_*.sql`, `drizzle/0009_embedding-hnsw.sql` (custom), `tests/search/pgvector.test.ts`

**Interfaces:**
- Produces: `events.embedding` (`vector(1536)`, nullable), `events.embeddedAt` (timestamptz, nullable), `events.contentFingerprint` (text, nullable); pgvector live in prod migrations AND PGlite; `ai` package installed.

- [ ] **Step 1: Install dependencies**

```bash
npm install ai
npm install -D @electric-sql/pglite-pgvector
```

Verify: `node -e "console.log(Object.keys(require('@electric-sql/pglite-pgvector')))"` — note the actual export name (expected something like `vector` or `pgvector`; use what it actually exports in Step 3).

- [ ] **Step 2: Extension migration (must sort before the column migration)**

Run: `npx drizzle-kit generate --custom --name=enable-pgvector` → fill `drizzle/0007_enable-pgvector.sql` with:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 3: Register pgvector in the PGlite harness**

`tests/helpers/test-db.ts` — extend the constructor (keep pg_trgm; use the companion package's real export name from Step 1):

```typescript
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { vector } from '@electric-sql/pglite-pgvector';
// ...
  const client = new PGlite({ extensions: { pg_trgm, vector } });
```

- [ ] **Step 4: Write the failing smoke test**

```typescript
// tests/search/pgvector.test.ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

describe('pgvector in the test harness', () => {
  it('computes cosine distance with the <=> operator', async () => {
    const db = await createTestDb();
    const result = await db.execute(sql`SELECT '[1,0,0]'::vector(3) <=> '[0,1,0]'::vector(3) AS dist`);
    expect(Number((result.rows[0] as { dist: unknown }).dist)).toBeCloseTo(1);
  });

  it('replayed the embedding column and HNSW index', async () => {
    const db = await createTestDb();
    const col = await db.execute(sql`
      SELECT data_type, udt_name FROM information_schema.columns
      WHERE table_name = 'events' AND column_name = 'embedding'
    `);
    expect((col.rows[0] as { udt_name: string }).udt_name).toBe('vector');
    const idx = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE indexname = 'events_embedding_hnsw_idx'`);
    expect(idx.rows).toHaveLength(1);
  });
});
```

Run: `npx vitest run tests/search/pgvector.test.ts` → FAILS (no extension registered / no column yet).

- [ ] **Step 5: Add the columns to the schema**

In `src/db/schema.ts`, add `vector` to the `drizzle-orm/pg-core` import, and append to the `events` columns (after `isStationEvent`):

```typescript
    embedding: vector('embedding', { dimensions: 1536 }),
    embeddedAt: timestamp('embedded_at', { withTimezone: true }),
    contentFingerprint: text('content_fingerprint'),
```

Run: `npm run db:generate` → inspect `drizzle/0008_*.sql` (three ADD COLUMN; the vector type requires 0007's extension — confirm 0007 sorts first).

- [ ] **Step 6: HNSW index migration**

Run: `npx drizzle-kit generate --custom --name=embedding-hnsw` → fill `drizzle/0009_embedding-hnsw.sql` with:

```sql
CREATE INDEX IF NOT EXISTS events_embedding_hnsw_idx ON "events" USING hnsw ("embedding" vector_cosine_ops);
```

- [ ] **Step 7: Run the smoke test until green, then the full suite**

Run: `npx vitest run tests/search/pgvector.test.ts && npm run test && npm run typecheck`
Expected: all green (195 existing + 2).

**STOP-GATE:** if the HNSW index statement fails inside PGlite, replace 0009 with an `ivfflat` index (`USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100)`) and note it; if BOTH fail in PGlite while working on Neon, STOP and report — the harness strategy needs a controller decision. Do not proceed with a red replay.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/db/schema.ts tests/helpers/test-db.ts tests/search/pgvector.test.ts drizzle/
git commit -m "feat: pgvector foundations — extension, embedding columns, HNSW, PGlite gate"
```

---

### Task 2: Enrichment columns + weighted FTS tsvector + keyword indexes

**Files:**
- Modify: `src/db/schema.ts`
- Create: generated `drizzle/0010_*.sql`, custom `drizzle/0011_search-tsv.sql`
- Test: `tests/search/fts.test.ts` (create)

**Interfaces:**
- Produces: events columns `vibeTags text[]`, `audienceTags text[]`, `priceMin numeric`, `priceMax numeric`; generated STORED column `search_tsv` (weighted A: title, B: category+tags, C: description) with GIN index; trigram GIN index on `normalized_title`. NOTE (deliberate spec deviation, decisions log): venue/organizer weight-B matching happens in the query's trigram leg (Task 4), not in this single-table tsvector — organizers is unpopulated and cross-table generated columns are impossible.

- [ ] **Step 1: Schema columns**

Append to `events` (after `contentFingerprint`):

```typescript
    vibeTags: text('vibe_tags').array(),
    audienceTags: text('audience_tags').array(),
    priceMin: numeric('price_min'),
    priceMax: numeric('price_max'),
```

Run: `npm run db:generate` → inspect `drizzle/0010_*.sql` (four ADD COLUMN).

- [ ] **Step 2: tsvector + indexes custom migration**

Run: `npx drizzle-kit generate --custom --name=search-tsv` → fill `drizzle/0011_search-tsv.sql`:

```sql
ALTER TABLE "events" ADD COLUMN "search_tsv" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english',
    coalesce("category", '') || ' ' ||
    coalesce(array_to_string("vibe_tags", ' '), '') || ' ' ||
    coalesce(array_to_string("audience_tags", ' '), '')
  ), 'B') ||
  setweight(to_tsvector('english', coalesce("description", '')), 'C')
) STORED;
--> statement-breakpoint
CREATE INDEX "events_search_tsv_idx" ON "events" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX "events_normalized_title_trgm_idx" ON "events" USING gin ("normalized_title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "events_vibe_tags_idx" ON "events" USING gin ("vibe_tags");
--> statement-breakpoint
CREATE INDEX "events_audience_tags_idx" ON "events" USING gin ("audience_tags");
```

(`search_tsv` stays OUT of the drizzle schema object — it's queried only via raw `sql` fragments, so drizzle-kit never tries to manage it. Add a comment in schema.ts noting the column exists migration-side.)

- [ ] **Step 3: Write the FTS behavior test (failing until migrations replay)**

```typescript
// tests/search/fts.test.ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { createTestDb } from '../helpers/test-db';

describe('weighted search_tsv', () => {
  it('ranks a title hit above a description hit', async () => {
    const db = await createTestDb();
    await db.insert(schema.events).values([
      { slug: 'a', title: 'Jazz Night', normalizedTitle: 'jazz night' },
      { slug: 'b', title: 'Open Mic', normalizedTitle: 'open mic', description: 'jazz jam session after the mic' },
    ]);
    const result = await db.execute(sql`
      SELECT slug, ts_rank("search_tsv", websearch_to_tsquery('english', 'jazz')) AS rank
      FROM events WHERE "search_tsv" @@ websearch_to_tsquery('english', 'jazz')
      ORDER BY rank DESC
    `);
    const slugs = result.rows.map((r) => (r as { slug: string }).slug);
    expect(slugs).toEqual(['a', 'b']);
  });

  it('matches enrichment tags at weight B', async () => {
    const db = await createTestDb();
    await db.insert(schema.events).values(
      { slug: 'c', title: 'Sunset Cruise', normalizedTitle: 'sunset cruise', vibeTags: ['chill', 'outdoors'] },
    );
    const result = await db.execute(sql`
      SELECT slug FROM events WHERE "search_tsv" @@ websearch_to_tsquery('english', 'outdoors')
    `);
    expect(result.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run to green + full suite + typecheck**

Run: `npx vitest run tests/search/fts.test.ts && npm run test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/ tests/search/fts.test.ts
git commit -m "feat: enrichment columns, weighted FTS tsvector, keyword indexes"
```

---

### Task 3: Query understanding — date-phrase heuristics (pure, no LLM)

**Files:**
- Create: `src/search/query-understanding.ts`
- Test: `tests/search/query-understanding.test.ts`

**Interfaces:**
- Produces:

```typescript
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
export interface ParsedQuery {
  text: string;                                  // query with date/time phrases stripped
  window: { start: Date; end: Date } | null;     // UTC instants derived from Chicago wall time
  timeOfDay: TimeOfDay | null;
}
export function parseSearchInput(raw: string, now: Date): ParsedQuery;
export function presetWindow(preset: 'tonight' | 'today' | 'this-weekend' | 'this-week', now: Date): { start: Date; end: Date };
```

Window semantics (all Chicago wall time, converted via `chicagoWallTimeToIso`):
`today` = now → next midnight; `tonight` = today 17:00 → tomorrow 03:00; `this-weekend` = coming Friday 17:00 → Monday 00:00 (if already inside the weekend, start = now); `this-week` = now → next Monday 00:00; weekday phrases ("friday", "friday night") = next occurrence of that weekday (whole day, or 17:00→03:00 for "night"); time-of-day words: morning 06–12, afternoon 12–17, evening 17–21, night 21–03 (as a TimeOfDay filter, not a window). Phrase list to strip (case-insensitive, with surrounding whitespace collapsed): tonight, today, tomorrow, this weekend, this week, {weekday} [night|morning|afternoon|evening], morning/afternoon/evening/night when standalone.

- [ ] **Step 1: Write the failing tests** — use a fixed `now` = `new Date('2026-07-07T19:00:00-05:00')` (a Tuesday evening, Chicago):

```typescript
// tests/search/query-understanding.test.ts
import { describe, expect, it } from 'vitest';
import { parseSearchInput, presetWindow } from '@/search/query-understanding';

const NOW = new Date('2026-07-07T19:00:00-05:00'); // Tuesday, 7 PM Chicago
const chi = (s: string) => new Date(s).toISOString();

describe('parseSearchInput', () => {
  it('strips "tonight" into a 17:00→03:00 window', () => {
    const parsed = parseSearchInput('live music tonight', NOW);
    expect(parsed.text).toBe('live music');
    expect(parsed.window?.start.toISOString()).toBe(chi('2026-07-07T19:00:00-05:00')); // clamped to now (already past 17:00)
    expect(parsed.window?.end.toISOString()).toBe(chi('2026-07-08T03:00:00-05:00'));
  });

  it('parses "this weekend" to Fri 17:00 → Mon 00:00', () => {
    const parsed = parseSearchInput('something chill this weekend', NOW);
    expect(parsed.text).toBe('something chill');
    expect(parsed.window?.start.toISOString()).toBe(chi('2026-07-10T17:00:00-05:00'));
    expect(parsed.window?.end.toISOString()).toBe(chi('2026-07-13T00:00:00-05:00'));
  });

  it('parses "sunday afternoon" as next Sunday + afternoon time-of-day', () => {
    const parsed = parseSearchInput('with the kids sunday afternoon', NOW);
    expect(parsed.text).toBe('with the kids');
    expect(parsed.timeOfDay).toBe('afternoon');
    expect(parsed.window?.start.toISOString()).toBe(chi('2026-07-12T00:00:00-05:00'));
    expect(parsed.window?.end.toISOString()).toBe(chi('2026-07-13T00:00:00-05:00'));
  });

  it('leaves plain queries untouched', () => {
    const parsed = parseSearchInput('pabst theater comedy', NOW);
    expect(parsed).toEqual({ text: 'pabst theater comedy', window: null, timeOfDay: null });
  });

  it('clamps preset windows that started in the past to now', () => {
    const w = presetWindow('today', NOW);
    expect(w.start.toISOString()).toBe(NOW.toISOString());
    expect(w.end.toISOString()).toBe(chi('2026-07-08T00:00:00-05:00'));
  });

  it('"friday night" resolves to the coming Friday evening', () => {
    const parsed = parseSearchInput('friday night', NOW);
    expect(parsed.text).toBe('');
    expect(parsed.window?.start.toISOString()).toBe(chi('2026-07-10T17:00:00-05:00'));
    expect(parsed.window?.end.toISOString()).toBe(chi('2026-07-11T03:00:00-05:00'));
  });
});
```

- [ ] **Step 2: Implement** — pure functions built on `chicagoParts(now.getTime())` for the current Chicago calendar date and `chicagoWallTimeToIso(...)` for window bounds; a PHRASES table of `{ pattern: RegExp, resolve: (now) => Partial<ParsedQuery> }`; strip matches, collapse whitespace, clamp `start` to `now` when the wall-time start is past. Keep every function ≤20 lines (table-driven).

- [ ] **Step 3: Run to green + full suite + typecheck; Commit**

```bash
git add src/search/query-understanding.ts tests/search/query-understanding.test.ts
git commit -m "feat: heuristic date-phrase parsing for search queries"
```

---

### Task 4: Hybrid retrieval — one-round-trip FTS + vector + RRF with facet WHERE clauses

**Files:**
- Create: `src/search/hybrid.ts`
- Test: `tests/search/hybrid.test.ts`

**Interfaces:**
- Produces:

```typescript
export interface SearchFilters {
  window?: { start: Date; end: Date };
  category?: string;
  venue?: string;            // venues.normalized_name exact
  neighborhood?: string;     // venues.neighborhood exact (data arrives later; param wired now)
  free?: boolean;
  vibe?: string;             // ANY(vibe_tags)
  audience?: string;         // ANY(audience_tags)
  timeOfDay?: TimeOfDay;
  maxPrice?: number;         // price_min <= maxPrice
}
export interface SearchHit {
  eventId: string; slug: string; title: string;
  venueName: string | null; nextStartAt: Date; isFree: boolean | null; score: number;
}
export async function searchEvents(
  db: Db,
  args: { text?: string; queryEmbedding?: number[]; filters?: SearchFilters; limit?: number },
): Promise<SearchHit[]>;
```

Query shape (single `db.execute(sql\`...\`)`): CTE `base` = future instances (`start_at >= now()`, window bounds, timeOfDay via `(start_at AT TIME ZONE 'America/Chicago')` hour ranges — night wraps 21→03) joined to events (+facet WHERE: category, free `is_free = true`, vibe `:vibe = ANY(vibe_tags)`, audience, maxPrice `price_min <= :maxPrice`) and venues (venue/neighborhood), grouped per event with `MIN(start_at) AS next_start_at`. Leg `fts` (only when `text` non-empty): `search_tsv @@ websearch_to_tsquery('english', :text)` OR `similarity(normalized_title, :text) > 0.3` OR venue trigram `similarity(v.normalized_name, :text) > 0.4`, ranked by `ts_rank(search_tsv, query) + 0.5 * similarity(normalized_title, :text) + 0.3 * COALESCE(similarity(v.normalized_name, :text), 0)` DESC → `ROW_NUMBER() AS r`. Leg `vec` (only when `queryEmbedding` present): `ORDER BY embedding <=> :vec::vector` LIMIT 50 → ROW_NUMBER. Merge: `FULL OUTER JOIN` on event_id, `score = COALESCE(1.0/(60+fts.r),0) + COALESCE(1.0/(60+vec.r),0)`, ORDER BY score DESC, `next_start_at` ASC tiebreak, LIMIT :limit (default 50). No text AND no embedding → base ordered by `next_start_at` (pure facet browse). Compose the SQL from guarded fragments; the function stays ≤20 lines by delegating fragment builders (`windowClause`, `facetClauses`, `ftsLeg`, `vecLeg`, `rrfSelect`) each ≤20 lines.

- [ ] **Step 1: Write the failing integration tests** (PGlite; hand-planted embeddings — NO AI):

```typescript
// tests/search/hybrid.test.ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { searchEvents } from '@/search/hybrid';
import { createTestDb } from '../helpers/test-db';

const FUTURE = (days: number, hour = 19) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

// deterministic unit-ish vectors: e1 points "comedy", e2 points "family outdoors"
const vec = (i: number) => `[${Array.from({ length: 1536 }, (_, k) => (k === i ? 1 : 0)).join(',')}]`;

async function seedEvent(db: Awaited<ReturnType<typeof createTestDb>>, opts: {
  slug: string; title: string; description?: string; vibeTags?: string[]; audienceTags?: string[];
  isFree?: boolean; category?: string; embeddingIndex?: number; startAt?: Date; venueName?: string;
}) {
  let venueId: string | null = null;
  if (opts.venueName) {
    const [v] = await db.insert(schema.venues).values({
      name: opts.venueName, normalizedName: opts.venueName.toLowerCase(),
    }).onConflictDoNothing({ target: schema.venues.normalizedName }).returning();
    venueId = v?.id ?? (await db.query.venues.findFirst({
      where: (t, { eq }) => eq(t.normalizedName, opts.venueName!.toLowerCase()),
    }))!.id;
  }
  const [e] = await db.insert(schema.events).values({
    slug: opts.slug, title: opts.title, normalizedTitle: opts.title.toLowerCase(),
    description: opts.description, vibeTags: opts.vibeTags, audienceTags: opts.audienceTags,
    isFree: opts.isFree, category: opts.category, venueId,
  }).returning();
  if (opts.embeddingIndex !== undefined) {
    await db.execute(sql`UPDATE events SET embedding = ${vec(opts.embeddingIndex)}::vector WHERE id = ${e.id}`);
  }
  await db.insert(schema.eventInstances).values({ eventId: e.id, startAt: opts.startAt ?? FUTURE(3) });
  return e;
}

describe('searchEvents', () => {
  it('keyword search ranks the title match first (FTS leg alone)', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'comedy', title: 'Comedy Showcase', venueName: 'Pabst Theater' });
    await seedEvent(db, { slug: 'music', title: 'Indie Night', description: 'no comedy here honestly' });
    const hits = await searchEvents(db, { text: 'comedy' });
    expect(hits[0].slug).toBe('comedy');
    expect(hits).toHaveLength(2);
  });

  it('typo-tolerant via trigram when FTS misses', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'pabst', title: 'Pabst Theater Tour' });
    const hits = await searchEvents(db, { text: 'pabts theater' });
    expect(hits.map((h) => h.slug)).toContain('pabst');
  });

  it('vector leg surfaces a semantic match FTS cannot see, and RRF fuses both legs', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'kids-picnic', title: 'Family Picnic', embeddingIndex: 2 });
    await seedEvent(db, { slug: 'metal', title: 'Metal Fest', embeddingIndex: 5 });
    const queryEmbedding = Array.from({ length: 1536 }, (_, k) => (k === 2 ? 1 : 0));
    const hits = await searchEvents(db, { queryEmbedding });
    expect(hits[0].slug).toBe('kids-picnic');
  });

  it('facets filter: free + vibe + window', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'free-chill', title: 'Beach Hang', isFree: true, vibeTags: ['chill'], startAt: FUTURE(2) });
    await seedEvent(db, { slug: 'paid', title: 'Beach Rave', isFree: false, vibeTags: ['party'], startAt: FUTURE(2) });
    await seedEvent(db, { slug: 'late', title: 'Beach Later', isFree: true, vibeTags: ['chill'], startAt: FUTURE(30) });
    const hits = await searchEvents(db, {
      filters: {
        free: true, vibe: 'chill',
        window: { start: new Date(), end: new Date(Date.now() + 7 * 86_400_000) },
      },
    });
    expect(hits.map((h) => h.slug)).toEqual(['free-chill']);
  });

  it('no text and no embedding returns the facet browse ordered by next start', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'soon', title: 'Soon Show', startAt: FUTURE(1) });
    await seedEvent(db, { slug: 'later', title: 'Later Show', startAt: FUTURE(5) });
    const hits = await searchEvents(db, {});
    expect(hits.map((h) => h.slug)).toEqual(['soon', 'later']);
  });

  it('never returns past instances', async () => {
    const db = await createTestDb();
    await seedEvent(db, { slug: 'past', title: 'Old Show', startAt: new Date(Date.now() - 86_400_000) });
    const hits = await searchEvents(db, { text: 'old show' });
    expect(hits).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement `src/search/hybrid.ts`** per the interface block (fragment builders + one `db.execute`). Map rows with a `toSearchHit` helper (numeric score via `Number(...)`).

- [ ] **Step 3: Iterate to green, then full suite + typecheck; Commit**

```bash
git add src/search/hybrid.ts tests/search/hybrid.test.ts
git commit -m "feat: one-round-trip hybrid retrieval with RRF and facet filters"
```

---

### Task 5: Enrichment & embedding pipeline (sweep-based, fingerprint-gated, key-gated)

**Files:**
- Create: `src/enrichment/fingerprint.ts`, `src/enrichment/embed.ts`, `src/enrichment/tag.ts`, `src/enrichment/sweep.ts`, `src/enrichment/run.ts`
- Modify: `package.json` (script), `.env.example`
- Test: `tests/enrichment/fingerprint.test.ts`, `tests/enrichment/sweep.test.ts`

**Interfaces:**
- Produces:

```typescript
// fingerprint.ts
export function contentFingerprint(e: { title: string; description: string | null }): string; // sha256 hex of title + ' ' + (description ?? '')
export function buildEmbeddingText(e: { title: string; description: string | null; category: string | null; vibeTags: string[] | null; audienceTags: string[] | null; venueName: string | null }): string;

// embed.ts
export function hasGatewayKey(): boolean;                       // !!process.env.AI_GATEWAY_API_KEY
export async function embedTexts(texts: string[]): Promise<number[][]>;  // embedMany, model 'openai/text-embedding-3-small', maxParallelCalls 2

// tag.ts
export const enrichmentSchema: z.ZodType<{ category: string | null; vibeTags: string[]; audienceTags: string[]; isFree: boolean | null }>;
export async function tagEvent(input: { title: string; description: string | null; venueName: string | null }): Promise<Enrichment | null>; // generateObject, model 'anthropic/claude-haiku-4-5'; null on ANY error (never throws)

// sweep.ts
export interface EnrichResult { embedded: number; tagged: number; skipped: number; }
export async function enrichSweep(db: Db, opts?: { embedLimit?: number; tagLimit?: number }): Promise<EnrichResult>; // defaults 200 / 50
```

Sweep behavior: no key → return `{0,0,0}` immediately (log once via the CLI only). Select events needing embedding: `embedding IS NULL OR content_fingerprint IS DISTINCT FROM <computed>` limit embedLimit; batch `embedTexts` (chunks of 64); per-row UPDATE embedding+embeddedAt+contentFingerprint. Select events needing tags: `category IS NULL AND vibe_tags IS NULL` limit tagLimit; `tagEvent` sequentially; UPDATE category/vibeTags/audienceTags and `is_free = COALESCE(is_free, :inferred)` (adapter value always wins). Every AI failure increments `skipped`, never throws. Tag vocab constrained in the prompt: category ∈ {music, comedy, sports, festival, family, food-drink, arts, community, other}; audienceTags ⊆ {family-friendly, all-ages, 21-plus, date-night, kids}; vibeTags free-form lowercase ≤5.

- [ ] **Step 1: Failing fingerprint tests** (stable hex, description-null vs empty distinct — use the ` ` separator; embedding text includes tags and venue when present)
- [ ] **Step 2: Implement fingerprint.ts; green**
- [ ] **Step 3: Failing sweep tests** — `vi.mock('ai', ...)` returning deterministic embeddings/objects; cases: (a) no key → `{0,0,0}` and zero mock calls; (b) with stubbed env key (`vi.stubEnv('AI_GATEWAY_API_KEY', 'test')`): new event gets embedding+fingerprint+embeddedAt; (c) unchanged fingerprint on second sweep → skipped, embed NOT re-called; (d) title change → re-embedded; (e) tagging fills category/tags and only fills isFree when null; (f) mock rejection → skipped counted, sweep completes.
- [ ] **Step 4: Implement embed.ts/tag.ts/sweep.ts; green**
- [ ] **Step 5: CLI + env docs** — `src/enrichment/run.ts` (dotenv, prints `enrich: N embedded, M tagged, K skipped`), script `"enrich": "tsx src/enrichment/run.ts"`; `.env.example` appends:

```bash
# Vercel AI Gateway — powers ingest-time embeddings + enrichment tagging AND the
# query-embedding half of hybrid search. Absent = search runs FTS-only, publishing unaffected.
AI_GATEWAY_API_KEY=
```

- [ ] **Step 6: Full suite + typecheck; Commit**

```bash
git add src/enrichment/ tests/enrichment/ package.json .env.example
git commit -m "feat: fingerprint-gated embedding and tagging sweep via AI Gateway"
```

---

### Task 6: Trigger.dev enrich schedule

**Files:**
- Modify: `src/trigger/maintenance.ts`
- Test: covered by typecheck + build (thin glue, per the Task-12 precedent in Phase 2c)

- [ ] **Step 1:** Add to `src/trigger/maintenance.ts`:

```typescript
import { enrichSweep } from '@/enrichment/sweep';

/** Between the 6:00 ingest fan-out and the 8:00 dedup sweep; fingerprint-gated and key-gated. */
export const enrichDaily = schedules.task({
  id: 'enrich-daily',
  cron: { pattern: '0 7 * * *', timezone: 'America/Chicago' },
  run: async () => enrichSweep(db),
});
```

- [ ] **Step 2:** `npm run test && npm run typecheck && npm run build` → green. Commit:

```bash
git add src/trigger/maintenance.ts
git commit -m "feat: daily enrichment schedule between ingest and dedup"
```

---

### Task 7: /events search + URL-addressable facets + preset routes

**Files:**
- Modify: `src/app/events/page.tsx`
- Create: `src/app/events/search-params.ts`, `src/app/events/tonight/page.tsx`, `src/app/events/today/page.tsx`, `src/app/events/this-weekend/page.tsx`, `src/app/free-events/page.tsx`
- Test: `tests/search/search-params.test.ts`

**Interfaces:**
- Produces: `searchParamsSchema` (Zod: `q, date ('tonight'|'today'|'this-weekend'|'this-week'), cat, venue, neighborhood, free ('1'), vibe, audience, tod, maxPrice` — all optional strings, coerced/validated) and `resolveSearch(params, now): { text?: string; filters: SearchFilters }` combining preset windows + parsed query phrases (query-embedded window wins over `date` param when both present). Page: parses `searchParams` prop through the schema, calls `embedQueryWithTimeout(text)` (only when key present AND text non-empty; `Promise.race` with 150ms timeout → undefined on miss) then `searchEvents`; renders the existing day-grouped list from hits (join instances via `nextStartAt` display), plus a GET `<form>` search box and preset links (`/events/tonight` etc.). Preset routes are 5-line server components rendering the main page component with fixed params. Keep the zero-state message. Design polish is Phase 4 — plain Tailwind like today.

- [ ] **Step 1: Failing tests for `search-params.ts`** (schema accepts/rejects; `resolveSearch` merges `date=tonight` + `q="jazz this weekend"` with the in-query phrase winning; `free='1'` → `free: true`)
- [ ] **Step 2: Implement search-params.ts; green**
- [ ] **Step 3: Rewrite page.tsx + preset routes** (verbatim structure above; `export const dynamic = 'force-dynamic'` retained everywhere)
- [ ] **Step 4:** `npm run test && npm run typecheck && npm run build`; manual spot: `npm run dev` + `curl -s "localhost:3000/events?q=music&free=1" | grep -c "MKE Events"` → 1. Commit:

```bash
git add src/app/ tests/search/search-params.test.ts
git commit -m "feat: URL-addressable hybrid search and facet filtering on /events"
```

---

### Task 8: Eval harness — 10-query set, hit@3, latency, zero-result checks

**Files:**
- Create: `src/search/eval.ts`, `eval/search-queries.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run search:eval` — reads `eval/search-queries.json` (`[{ query, kind: 'keyword'|'semantic', expectedSlugs: string[] }]`, 5 keyword + 5 semantic, authored in Task 9 from real production data — the committed file ships with placeholder examples marked `"draft": true` that Task 9 replaces), runs each query 3× through `resolveSearch` + `searchEvents` against `DATABASE_URL`, reports per-query: top-3 slugs, hit@3 (any expected slug in top 3), query-only latency (the `searchEvents` call) and total latency (incl. query embedding when key present); summary: hit rate, p50/p95 both ways, zero-result queries. Also runs the fixed zero-result probes `['live music tonight', 'free family events', 'things to do this weekend']` and reports any that return 0.

- [ ] **Step 1: Implement `eval.ts`** (CLI: latency via `performance.now()` around the two phases; p95 = sorted[ceil(0.95*n)-1]; output a markdown-ish table via console). Script: `"search:eval": "tsx src/search/eval.ts"`.
- [ ] **Step 2:** Draft `eval/search-queries.json` with the 10 slots (5 keyword: e.g. "pabst theater comedy", "brewers game", "jazz", "summerfest", "linnemans open mic"; 5 semantic: "something chill outdoors with the kids sunday afternoon", "date night live music", "free stuff for families this weekend", "late night dance party", "outdoor festival food") — expectedSlugs empty + `"draft": true` until Task 9 fills them from production.
- [ ] **Step 3:** `npm run test && npm run typecheck`; run `npm run search:eval` against production (FTS-only if no key) to prove the harness executes end-to-end. Commit:

```bash
git add src/search/eval.ts eval/ package.json
git commit -m "feat: search eval harness — hit@3, latency percentiles, zero-result probes"
```

---

### Task 9: Production migration, backfill, eval authoring, README (controller-assisted live task)

- [ ] **Step 1:** `npm run db:migrate` (0007–0011 to Neon: pgvector is Neon-native).
- [ ] **Step 2:** If `AI_GATEWAY_API_KEY` is present in `.env`: `npm run enrich` repeatedly until the sweep reports 0 embedded (≈1022 events / 200 per run ≈ 6 runs; tagging backfills at 50/run — run the remainder over the scheduled daily task, note the expected catch-up date). If the key is ABSENT: skip, and record that vector/tag evidence is deferred to key arrival (FTS-only eval still binding).
- [ ] **Step 3:** Author `eval/search-queries.json` expectedSlugs from REAL production data (query the DB for the true best answers; drop `"draft"` flags). Run `npm run search:eval` → capture the table. Acceptance: hit@3 ≥ 8/10 (all 5 keyword must hit; semantic requires embeddings — else mark deferred), p95 query-only < 300ms, zero-result probes all return results.
- [ ] **Step 4:** Facet-URL reproducibility: run the same `/events?...` URL twice via `curl` in fresh processes, diff the rendered event slugs — identical.
- [ ] **Step 5:** README: commands (`enrich`, `search:eval`), "Search" section (hybrid architecture, weights/RRF constant 60, facet params, preset routes, the FTS-only degradation story, enrichment vocab), env docs. Commit `docs: search operations guide (MOO-256)`.

---

## Decisions log

| Decision | Choice |
|---|---|
| Embedding stack | AI SDK v6 via Vercel AI Gateway, `openai/text-embedding-3-small` (1536d); tagging via `anthropic/claude-haiku-4-5` `generateObject`. One env key; provider-swappable strings |
| Key absent | Full degradation story: publishing unaffected, sweep no-ops, search runs FTS-only (RRF with an empty vector leg). Same credential-pending pattern as TM/EB keys |
| Re-embedding trigger | contentFingerprint (sha256 of title+description) compared at sweep time — NOT updatedAt (churns every crawl) and NOT a persist-path hook (no coupling, idempotent, transaction-free) |
| Enrichment column ownership | Enrichment-owned columns stay OUT of `eventFields`; that exclusion protects them from ingest overwrites. `isFree` adapter-owned, enrichment fills nulls only |
| FTS weight B (spec: venue/organizer) | Single-table tsvector can't reach venues; organizers is unpopulated. Venue matching lives in the keyword leg as a trigram boost; tags/category take weight B. Deviation logged for the final review |
| Query embedding in hot path | The one query-time AI call; 150ms timeout → FTS-only. "No LLM in hot path" = no generative rewriting; embeddings are retrieval infrastructure per the spec's own hybrid design |
| Neighborhood facet | Param + WHERE wired now, but venues.neighborhood has no writer yet — data lands with PostGIS neighborhoods (Phase 4/5). Documented as dormant |
| Eval methodology | p95 measured on the `searchEvents` DB call (query-only) AND end-to-end incl. query embedding, 3 runs/query from the eval script; the <300ms acceptance applies to query-only, both reported |
| PGlite vector | `@electric-sql/pglite-pgvector` dev-dep; Task 1 is a hard gate (HNSW → ivfflat fallback → escalate) |
| Deferred | Query-embedding LRU cache; pagination; PostGIS neighborhoods; search analytics (zero-result logging); RetroUI design pass (Phase 4) |
