# MKE Events Phase 2a: Pipeline Hardening + Feed/API Sources — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five Phase 1 carry-forwards, extract a shared ingest orchestrator both the CLI and (later) Trigger.dev call, and expand from 1 source to ~7 feed/API sources (iCal + Ticketmaster + Eventbrite).

**Architecture:** `ingestSource(db, source, adapter)` becomes the single pipeline entrypoint (raw store → normalize → persist → health), extracted from the CLI runner and fully tested on PGlite with stub adapters. Persistence gains race-safe venue upserts, source-scoped slugs, and reschedule-safe instance supersede. Two API adapters (Ticketmaster Discovery, Eventbrite organizer events) join the existing iCal adapter behind a registry that resolves per-source.

**Tech Stack:** Existing stack (Next.js, Neon, Drizzle, Zod, Vitest, PGlite, node-ical) + no new runtime deps.

**Linear:** MOO-255. **Spec:** `docs/superpowers/specs/2026-07-07-mke-events-mvp-design.md`. **Plan 2b** (HTML/JSON-LD sources) and **2c** (dedup + Trigger.dev schedules) follow this plan.

## Global Constraints

- TypeScript strict; `npm run typecheck` must stay clean; Node >= 20; npm.
- All event times `timestamptz`; display timezone `America/Chicago`.
- Zod validation at every boundary; invalid records are skipped (normalize returns null), never published; adapters normalize ONLY from `record.payload` (replayable from `raw_events`).
- Functions ≤ 20 lines (project CLAUDE.md Clean Code Standards); files < 800 lines; immutability — never mutate inputs.
- Secrets only via env. New env vars MUST be documented in `.env.example` (names only, no values) and read via `process.env` with clear missing-var errors. Never print or commit `.env`.
- Tests run on PGlite via `tests/helpers/test-db.ts` — no cloud DB in tests. Live network calls only in explicitly-marked live verification steps.
- External feed data is untrusted input: every adapter payload passes a Zod schema before normalization.

## File Structure

```
src/ingestion/canonical-json.ts     — stable key-order JSON serialization (new)
src/ingestion/ingest.ts             — ingestSource orchestrator + contentHash (new)
src/ingestion/run.ts                — thin CLI wrapper (rewrite)
src/ingestion/persist.ts            — venue race fix, scoped slugs, supersede (modify)
src/ingestion/adapters/registry.ts  — resolveAdapter(source) (new)
src/ingestion/adapters/ticketmaster.ts — Ticketmaster Discovery adapter (new)
src/ingestion/adapters/eventbrite.ts   — Eventbrite organizer-events adapter (new)
src/lib/validation/normalized-event.ts — add venueLat/venueLng/isFree (modify)
src/db/schema.ts                    — sources.lastError column (modify + migration)
src/db/seed.ts                      — wave-1 feed/API source registry (rewrite)
.env.example                        — documented env vars (new)
tests/fixtures/ticketmaster-events.json, eventbrite-events.json (new)
tests/ingestion/{canonical-json,ingest,ticketmaster-adapter,eventbrite-adapter}.test.ts (new)
tests/ingestion/persist.test.ts     — update signature + new supersede/race tests
```

---

### Task 1: Canonical JSON + ingest orchestrator with honest health

**Files:**
- Create: `src/ingestion/canonical-json.ts`, `src/ingestion/ingest.ts`
- Modify: `src/db/schema.ts` (add `lastError` to sources), `src/ingestion/run.ts` (thin wrapper)
- Test: `tests/ingestion/canonical-json.test.ts`, `tests/ingestion/ingest.test.ts`

**Interfaces:**
- Consumes: `persistNormalizedEvent(db, source, n, opts)` — NOTE: this task lands BEFORE Task 2 changes that signature; call it with the Phase 1 signature `persistNormalizedEvent(db, source.id, n)` and Task 2 updates this call site.
- Produces: `canonicalJson(value: unknown): string`; `contentHash(payload: unknown): string`; `type SourceRow = typeof schema.sources.$inferSelect`; `interface IngestResult { fetched: number; published: number; skipped: number }`; `ingestSource(db: Db, source: SourceRow, adapter: SourceAdapter): Promise<IngestResult>` from `src/ingestion/ingest.ts`. Health contract: adapter throw → 'failing' + rethrow (original error preserved); fetched>0 && published===0 → 'failing' with lastError `'all records skipped normalization'`; otherwise 'ok' + lastFetchAt.

- [ ] **Step 1: Write failing canonical-json tests**

Create `tests/ingestion/canonical-json.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { canonicalJson } from '@/ingestion/canonical-json';

describe('canonicalJson', () => {
  test('is stable across key insertion order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
  test('preserves array order', () => {
    expect(canonicalJson({ a: [2, 1] })).toBe('{"a":[2,1]}');
  });
  test('handles primitives and null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('x')).toBe('"x"');
  });
});
```

Run: `npm run test -- tests/ingestion/canonical-json.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 2: Implement canonical-json**

Create `src/ingestion/canonical-json.ts`:

```ts
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
```

Run: `npm run test -- tests/ingestion/canonical-json.test.ts` — Expected: 3 passed. Commit:

```bash
git add src/ingestion/canonical-json.ts tests/ingestion/canonical-json.test.ts
git commit -m "feat: add canonical JSON serialization for stable content hashes"
```

- [ ] **Step 3: Add sources.lastError and migrate**

In `src/db/schema.ts`, inside the `sources` table after `healthStatus`:

```ts
  lastError: text('last_error'),
```

Run: `npm run db:generate && npm run db:migrate` — Expected: new migration `drizzle/0001_*.sql` with `ALTER TABLE "sources" ADD COLUMN "last_error" text;`, applied cleanly. Commit:

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add sources.last_error for health diagnostics"
```

- [ ] **Step 4: Write failing ingest orchestrator tests**

Create `tests/ingestion/ingest.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import * as schema from '@/db/schema';
import type { FetchedRecord, SourceAdapter } from '@/ingestion/adapters/types';
import { ingestSource } from '@/ingestion/ingest';
import { normalizedEventSchema } from '@/lib/validation/normalized-event';
import { createTestDb } from '../helpers/test-db';

function stubAdapter(records: FetchedRecord[], normalizeValid: boolean): SourceAdapter {
  return {
    adapterType: 'ical',
    fetch: async () => records,
    normalize: (record) =>
      normalizeValid
        ? normalizedEventSchema.parse({
            sourceEventId: record.sourceEventId,
            title: `Event ${record.sourceEventId}`,
            startAt: '2026-08-01T00:00:00.000Z',
          })
        : null,
  };
}

const recordsFixture: FetchedRecord[] = [
  { sourceEventId: 'a', payload: { uid: 'a' } },
  { sourceEventId: 'b', payload: { uid: 'b' } },
];

async function seedSource(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [source] = await db
    .insert(schema.sources)
    .values({ key: 'stub', name: 'Stub', url: 'https://x', adapterType: 'ical' })
    .returning();
  return source;
}

describe('ingestSource', () => {
  test('publishes valid records and marks source ok', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const result = await ingestSource(db, source, stubAdapter(recordsFixture, true));
    expect(result).toEqual({ fetched: 2, published: 2, skipped: 0 });
    const updated = await db.query.sources.findFirst();
    expect(updated?.healthStatus).toBe('ok');
    expect(updated?.lastFetchAt).not.toBeNull();
    expect(await db.query.rawEvents.findMany()).toHaveLength(2);
    expect(await db.query.events.findMany()).toHaveLength(2);
  });

  test('marks source failing when every record skips normalization', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const result = await ingestSource(db, source, stubAdapter(recordsFixture, false));
    expect(result).toEqual({ fetched: 2, published: 0, skipped: 2 });
    const updated = await db.query.sources.findFirst();
    expect(updated?.healthStatus).toBe('failing');
    expect(updated?.lastError).toBe('all records skipped normalization');
  });

  test('empty feed is ok, not failing', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const result = await ingestSource(db, source, stubAdapter([], true));
    expect(result).toEqual({ fetched: 0, published: 0, skipped: 0 });
    expect((await db.query.sources.findFirst())?.healthStatus).toBe('ok');
  });

  test('adapter throw marks failing and rethrows original error', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const boom: SourceAdapter = {
      adapterType: 'ical',
      fetch: async () => {
        throw new Error('feed exploded');
      },
      normalize: () => null,
    };
    await expect(ingestSource(db, source, boom)).rejects.toThrow('feed exploded');
    const updated = await db.query.sources.findFirst();
    expect(updated?.healthStatus).toBe('failing');
    expect(updated?.lastError).toContain('feed exploded');
  });

  test('re-ingesting identical payloads stores no duplicate raw events', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    await ingestSource(db, source, stubAdapter(recordsFixture, true));
    await ingestSource(db, source, stubAdapter(recordsFixture, true));
    expect(await db.query.rawEvents.findMany()).toHaveLength(2);
    expect(await db.query.events.findMany()).toHaveLength(2);
  });
});
```

Run: `npm run test -- tests/ingestion/ingest.test.ts` — Expected: FAIL, `@/ingestion/ingest` not found.

- [ ] **Step 5: Implement ingest.ts**

Create `src/ingestion/ingest.ts`:

```ts
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { FetchedRecord, SourceAdapter } from './adapters/types';
import { canonicalJson } from './canonical-json';
import { persistNormalizedEvent, type Db } from './persist';

export type SourceRow = typeof schema.sources.$inferSelect;

export interface IngestResult {
  fetched: number;
  published: number;
  skipped: number;
}

export function contentHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

async function storeRaw(db: Db, source: SourceRow, record: FetchedRecord): Promise<void> {
  await db
    .insert(schema.rawEvents)
    .values({
      sourceId: source.id,
      sourceEventId: record.sourceEventId,
      sourceUrl: record.sourceUrl,
      extractionMethod: source.adapterType,
      payload: record.payload,
      contentHash: contentHash(record.payload),
    })
    .onConflictDoNothing();
}

async function setHealth(
  db: Db,
  sourceId: string,
  healthStatus: 'ok' | 'failing',
  lastError: string | null,
): Promise<void> {
  await db
    .update(schema.sources)
    .set({
      healthStatus,
      lastError,
      updatedAt: new Date(),
      ...(healthStatus === 'ok' ? { lastFetchAt: new Date() } : {}),
    })
    .where(eq(schema.sources.id, sourceId));
}

async function processRecords(
  db: Db,
  source: SourceRow,
  adapter: SourceAdapter,
  records: FetchedRecord[],
): Promise<IngestResult> {
  const result = { fetched: records.length, published: 0, skipped: 0 };
  for (const record of records) {
    await storeRaw(db, source, record);
    const normalized = adapter.normalize(record);
    if (!normalized) {
      result.skipped += 1;
      continue;
    }
    await persistNormalizedEvent(db, source.id, normalized);
    result.published += 1;
  }
  return result;
}

export async function ingestSource(
  db: Db,
  source: SourceRow,
  adapter: SourceAdapter,
): Promise<IngestResult> {
  try {
    const records = await adapter.fetch(source.config);
    const result = await processRecords(db, source, adapter, records);
    const allSkipped = result.fetched > 0 && result.published === 0;
    await setHealth(db, source.id, allSkipped ? 'failing' : 'ok',
      allSkipped ? 'all records skipped normalization' : null);
    return result;
  } catch (err) {
    try {
      await setHealth(db, source.id, 'failing', String(err));
    } catch (updateErr) {
      console.error('Failed to mark source as failing:', updateErr);
    }
    throw err;
  }
}
```

Run: `npm run test -- tests/ingestion/ingest.test.ts` — Expected: 5 passed.

- [ ] **Step 6: Rewrite run.ts as a thin wrapper**

Replace the body of `src/ingestion/run.ts` with:

```ts
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { icalAdapter } from '@/ingestion/adapters/ical';
import type { SourceAdapter } from '@/ingestion/adapters/types';
import { ingestSource } from '@/ingestion/ingest';

const adapters: Record<string, SourceAdapter> = {
  ical: icalAdapter,
};

async function main() {
  const key = process.argv[2];
  if (!key) {
    console.error('Usage: npm run ingest -- <source-key>');
    process.exit(1);
  }
  const source = await db.query.sources.findFirst({ where: eq(schema.sources.key, key) });
  if (!source) {
    console.error(`Unknown source key: ${key}. Run npm run db:seed first.`);
    process.exit(1);
  }
  const adapter = adapters[source.adapterType];
  if (!adapter) {
    console.error(`No adapter registered for type: ${source.adapterType}`);
    process.exit(1);
  }
  const result = await ingestSource(db, source, adapter);
  console.log(`${key}: ${result.fetched} fetched, ${result.published} published, ${result.skipped} skipped`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

(Task 3 replaces the inline `adapters` map with the registry.)

- [ ] **Step 7: Full verification and commit**

Run: `npm run test && npm run typecheck` — Expected: all pass (25 tests: 17 existing + 3 canonical-json + 5 ingest), clean.

```bash
git add src/ingestion/ingest.ts src/ingestion/run.ts tests/ingestion/ingest.test.ts
git commit -m "feat: extract ingestSource orchestrator with honest health reporting"
```

---

### Task 2: Persistence carry-forwards — venue race, scoped slugs, supersede + contract fields

**Files:**
- Modify: `src/ingestion/persist.ts`, `src/lib/validation/normalized-event.ts`, `src/ingestion/ingest.ts` (call site), `tests/ingestion/persist.test.ts`, `tests/ingestion/ingest.test.ts` (call-site type only if needed)

**Interfaces:**
- Produces (later tasks and Plan 2b/2c rely on these):
  - `interface SourceRef { id: string; key: string }`
  - `interface PersistOptions { supersede?: boolean }`
  - `persistNormalizedEvent(db: Db, source: SourceRef, n: NormalizedEvent, opts?: PersistOptions): Promise<{ eventId: string; created: boolean }>`
  - NormalizedEvent gains optional `venueLat?: number` (−90..90), `venueLng?: number` (−180..180), `isFree?: boolean`.
  - Slugs are source-scoped: hash input is `` `${source.key}:${n.sourceEventId}` ``.
  - With `supersede: true`, after upserting the record's instance, all OTHER instances of that event are deleted (reschedule-safe). Callers must set it only when the batch contains exactly one record for that sourceEventId.

- [ ] **Step 1: Extend the NormalizedEvent contract (failing test first)**

Append to `tests/ingestion/normalized-event.test.ts`:

```ts
  test('accepts venue coordinates and isFree', () => {
    const result = normalizedEventSchema.parse({
      sourceEventId: 'x',
      title: 'Geo Event',
      startAt: '2026-07-11T00:00:00.000Z',
      venueLat: 43.0389,
      venueLng: -87.9065,
      isFree: true,
    });
    expect(result.venueLat).toBe(43.0389);
    expect(result.isFree).toBe(true);
  });

  test('rejects out-of-range latitude', () => {
    const result = normalizedEventSchema.safeParse({
      sourceEventId: 'x',
      title: 'Bad Geo',
      startAt: '2026-07-11T00:00:00.000Z',
      venueLat: 99,
    });
    expect(result.success).toBe(false);
  });
```

Run: `npm run test -- tests/ingestion/normalized-event.test.ts` — Expected: 2 new FAIL. Then add to the schema object in `src/lib/validation/normalized-event.ts` (after `venueAddress`):

```ts
    venueLat: z.number().min(-90).max(90).optional(),
    venueLng: z.number().min(-180).max(180).optional(),
    isFree: z.boolean().optional(),
```

Run again — Expected: all pass. Commit:

```bash
git add src/lib/validation/normalized-event.ts tests/ingestion/normalized-event.test.ts
git commit -m "feat: add venue coordinates and isFree to NormalizedEvent"
```

- [ ] **Step 2: Write failing persistence tests for the new behaviors**

In `tests/ingestion/persist.test.ts`: update every existing `persistNormalizedEvent(db, source.id, ...)` call to `persistNormalizedEvent(db, { id: source.id, key: 'test' }, ...)`, then add:

```ts
  test('supersede replaces a rescheduled instance instead of duplicating', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };
    await persistNormalizedEvent(db, ref, sample, { supersede: true });
    const moved = { ...sample, startAt: new Date('2026-07-12T00:00:00.000Z') };
    await persistNormalizedEvent(db, ref, moved, { supersede: true });
    const instances = await db.query.eventInstances.findMany();
    expect(instances).toHaveLength(1);
    expect(instances[0].startAt.toISOString()).toBe('2026-07-12T00:00:00.000Z');
  });

  test('without supersede, a second start time adds an instance (legacy behavior)', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };
    await persistNormalizedEvent(db, ref, sample);
    await persistNormalizedEvent(db, ref, { ...sample, startAt: new Date('2026-07-12T00:00:00.000Z') });
    expect(await db.query.eventInstances.findMany()).toHaveLength(2);
  });

  test('same sourceEventId from different sources produces different slugs', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const [source2] = await db
      .insert(schema.sources)
      .values({ key: 'other', name: 'Other', url: 'https://y', adapterType: 'ical' })
      .returning();
    await persistNormalizedEvent(db, { id: source.id, key: 'test' }, sample);
    await persistNormalizedEvent(db, { id: source2.id, key: 'other' }, sample);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(2);
    expect(events[0].slug).not.toBe(events[1].slug);
  });

  test('venue insert survives a pre-existing normalized name (race-safe path)', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    await db.insert(schema.venues).values({
      name: 'Cathedral Square Park',
      normalizedName: 'cathedral square park',
    });
    await persistNormalizedEvent(db, { id: source.id, key: 'test' }, sample);
    expect(await db.query.venues.findMany()).toHaveLength(1);
  });

  test('persists venue coordinates and isFree on create', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    await persistNormalizedEvent(db, { id: source.id, key: 'test' }, {
      ...sample,
      venueName: 'Fiserv Forum',
      venueAddress: '1111 Vel R. Phillips Ave, Milwaukee, WI',
      venueLat: 43.0451,
      venueLng: -87.9172,
      isFree: false,
    });
    const [venue] = await db.query.venues.findMany();
    expect(Number(venue.lat)).toBeCloseTo(43.0451);
    const [event] = await db.query.events.findMany();
    expect(event.isFree).toBe(false);
  });
```

Run: `npm run test -- tests/ingestion/persist.test.ts` — Expected: FAIL (signature + behaviors missing).

- [ ] **Step 3: Implement the persist changes**

In `src/ingestion/persist.ts`:

```ts
import { and, eq, ne } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { normalizeName, slugify } from './naming';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

export interface SourceRef {
  id: string;
  key: string;
}

export interface PersistOptions {
  supersede?: boolean;
}

async function findOrCreateVenue(db: Db, n: NormalizedEvent): Promise<string> {
  const name = n.venueName as string;
  const normalized = normalizeName(name);
  const inserted = await db
    .insert(schema.venues)
    .values({
      name: name.trim(),
      normalizedName: normalized,
      address: n.venueAddress,
      lat: n.venueLat?.toString(),
      lng: n.venueLng?.toString(),
    })
    .onConflictDoNothing({ target: schema.venues.normalizedName })
    .returning();
  if (inserted.length > 0) return inserted[0].id;
  const existing = await db.query.venues.findFirst({
    where: eq(schema.venues.normalizedName, normalized),
  });
  if (!existing) throw new Error(`Venue lookup failed after conflict: ${name}`);
  return existing.id;
}

function eventFields(n: NormalizedEvent, venueId: string | null) {
  return {
    title: n.title,
    normalizedTitle: normalizeName(n.title),
    description: n.description,
    canonicalUrl: n.url,
    imageUrl: n.imageUrl,
    status: n.status,
    isFree: n.isFree,
    venueId,
  };
}

async function updateExistingEvent(
  db: Db,
  linkId: string,
  eventId: string,
  n: NormalizedEvent,
  venueId: string | null,
): Promise<void> {
  await db
    .update(schema.events)
    .set({ ...eventFields(n, venueId), updatedAt: new Date() })
    .where(eq(schema.events.id, eventId));
  await db
    .update(schema.eventSourceLinks)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.eventSourceLinks.id, linkId));
}

async function createEventWithLink(
  db: Db,
  source: SourceRef,
  n: NormalizedEvent,
  venueId: string | null,
): Promise<string> {
  const [event] = await db
    .insert(schema.events)
    .values({ slug: slugify(n.title, `${source.key}:${n.sourceEventId}`), ...eventFields(n, venueId) })
    .returning();
  try {
    await db.insert(schema.eventSourceLinks).values({
      eventId: event.id,
      sourceId: source.id,
      sourceEventId: n.sourceEventId,
      sourceUrl: n.url,
    });
  } catch (linkErr) {
    // No transactions on the Neon HTTP driver: compensate so retry recreates cleanly.
    await db.delete(schema.events).where(eq(schema.events.id, event.id));
    throw linkErr;
  }
  return event.id;
}

async function upsertInstance(db: Db, eventId: string, n: NormalizedEvent): Promise<void> {
  await db
    .insert(schema.eventInstances)
    .values({ eventId, startAt: n.startAt, endAt: n.endAt, timezone: n.timezone, status: n.status })
    .onConflictDoUpdate({
      target: [schema.eventInstances.eventId, schema.eventInstances.startAt],
      set: { endAt: n.endAt, status: n.status },
    });
}

async function supersedeOtherInstances(db: Db, eventId: string, keepStartAt: Date): Promise<void> {
  await db
    .delete(schema.eventInstances)
    .where(and(eq(schema.eventInstances.eventId, eventId), ne(schema.eventInstances.startAt, keepStartAt)));
}

export async function persistNormalizedEvent(
  db: Db,
  source: SourceRef,
  n: NormalizedEvent,
  opts: PersistOptions = {},
): Promise<{ eventId: string; created: boolean }> {
  const venueId = n.venueName ? await findOrCreateVenue(db, n) : null;
  const existingLink = await db.query.eventSourceLinks.findFirst({
    where: and(
      eq(schema.eventSourceLinks.sourceId, source.id),
      eq(schema.eventSourceLinks.sourceEventId, n.sourceEventId),
    ),
  });
  let eventId: string;
  if (existingLink) {
    eventId = existingLink.eventId;
    await updateExistingEvent(db, existingLink.id, eventId, n, venueId);
  } else {
    eventId = await createEventWithLink(db, source, n, venueId);
  }
  await upsertInstance(db, eventId, n);
  if (opts.supersede) await supersedeOtherInstances(db, eventId, n.startAt);
  return { eventId, created: !existingLink };
}
```

(Adjust the existing failure-injection Proxy test's call site to the new signature too.)

- [ ] **Step 4: Update the ingest.ts call site and wire supersede**

In `src/ingestion/ingest.ts` `processRecords`, count sourceEventId occurrences first and pass supersede only for singletons:

```ts
async function processRecords(
  db: Db,
  source: SourceRow,
  adapter: SourceAdapter,
  records: FetchedRecord[],
): Promise<IngestResult> {
  const result = { fetched: records.length, published: 0, skipped: 0 };
  const idCounts = new Map<string, number>();
  for (const r of records) idCounts.set(r.sourceEventId, (idCounts.get(r.sourceEventId) ?? 0) + 1);
  for (const record of records) {
    await storeRaw(db, source, record);
    const normalized = adapter.normalize(record);
    if (!normalized) {
      result.skipped += 1;
      continue;
    }
    const supersede = idCounts.get(record.sourceEventId) === 1;
    await persistNormalizedEvent(db, { id: source.id, key: source.key }, normalized, { supersede });
    result.published += 1;
  }
  return result;
}
```

Add an ingest test for the reschedule flow end-to-end in `tests/ingestion/ingest.test.ts`:

```ts
  test('rescheduled event ends with a single updated instance', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const at = (iso: string): SourceAdapter => ({
      adapterType: 'ical',
      fetch: async () => [{ sourceEventId: 'a', payload: {} }],
      normalize: () =>
        normalizedEventSchema.parse({ sourceEventId: 'a', title: 'Movable Feast', startAt: iso }),
    });
    await ingestSource(db, source, at('2026-08-01T00:00:00.000Z'));
    await ingestSource(db, source, at('2026-08-02T00:00:00.000Z'));
    const instances = await db.query.eventInstances.findMany();
    expect(instances).toHaveLength(1);
    expect(instances[0].startAt.toISOString()).toBe('2026-08-02T00:00:00.000Z');
  });
```

- [ ] **Step 5: Run everything, commit**

Run: `npm run test && npm run typecheck` — Expected: all pass, clean.

```bash
git add src/ingestion/persist.ts src/ingestion/ingest.ts src/lib/validation/normalized-event.ts tests/
git commit -m "feat: race-safe venues, source-scoped slugs, reschedule supersede"
```

---

### Task 3: Adapter registry + Ticketmaster Discovery adapter

**Files:**
- Create: `src/ingestion/adapters/registry.ts`, `src/ingestion/adapters/ticketmaster.ts`, `tests/fixtures/ticketmaster-events.json`
- Modify: `src/ingestion/run.ts` (use registry), `.env.example` (create)
- Test: `tests/ingestion/ticketmaster-adapter.test.ts`

**Interfaces:**
- Consumes: `SourceAdapter`, `FetchedRecord`, `normalizedEventSchema` (+ venueLat/venueLng from Task 2), `SourceRow`.
- Produces:
  - `resolveAdapter(source: Pick<SourceRow, 'adapterType' | 'config'>): SourceAdapter` from registry.ts — `'ical'` → icalAdapter; `'api'` → keyed by Zod-parsed `config.adapter` (`'ticketmaster' | 'eventbrite'`); throws with a clear message otherwise.
  - `ticketmasterAdapter: SourceAdapter` with pure helper `mapTicketmasterEvent(payload: unknown): NormalizedEvent | null`. Fetch pages Discovery API (`size=199`, sequential pages, 250ms delay, max 5 pages), requires env `TICKETMASTER_API_KEY` (clear error if missing). Payload stored per event: `{ id, name, url, startDateTime, statusCode, venueName, venueAddress, venueCity, venueLat, venueLng, imageUrl }` (plain JSON, replayable).
  - Status mapping: `cancelled`→cancelled, `postponed`/`rescheduled`→postponed, else scheduled. Events without `dates.start.dateTime` normalize to null (skip).

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/ticketmaster-events.json` (trimmed real response shape):

```json
{
  "_embedded": {
    "events": [
      {
        "id": "tm-001",
        "name": "Milwaukee Bucks vs. Chicago Bulls",
        "url": "https://www.ticketmaster.com/event/tm-001",
        "images": [{ "url": "https://images.tm.com/bucks.jpg" }],
        "dates": {
          "start": { "dateTime": "2026-08-15T00:00:00Z" },
          "status": { "code": "onsale" }
        },
        "_embedded": {
          "venues": [
            {
              "name": "Fiserv Forum",
              "address": { "line1": "1111 Vel R. Phillips Ave" },
              "city": { "name": "Milwaukee" },
              "location": { "latitude": "43.0451", "longitude": "-87.9172" }
            }
          ]
        }
      },
      {
        "id": "tm-002",
        "name": "TBA Concert",
        "url": "https://www.ticketmaster.com/event/tm-002",
        "images": [],
        "dates": { "start": {}, "status": { "code": "onsale" } }
      },
      {
        "id": "tm-003",
        "name": "Postponed Show",
        "url": "https://www.ticketmaster.com/event/tm-003",
        "images": [],
        "dates": {
          "start": { "dateTime": "2026-09-01T01:00:00Z" },
          "status": { "code": "postponed" }
        }
      }
    ]
  },
  "page": { "size": 199, "totalElements": 3, "totalPages": 1, "number": 0 }
}
```

- [ ] **Step 2: Write failing adapter tests**

Create `tests/ingestion/ticketmaster-adapter.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { extractTicketmasterRecords, ticketmasterAdapter } from '@/ingestion/adapters/ticketmaster';

const page = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/ticketmaster-events.json'), 'utf8'),
);

describe('extractTicketmasterRecords', () => {
  test('extracts one record per event with flat replayable payload', () => {
    const records = extractTicketmasterRecords(page);
    expect(records).toHaveLength(3);
    expect(records[0].sourceEventId).toBe('tm-001');
    expect(records[0].payload).toEqual({
      id: 'tm-001',
      name: 'Milwaukee Bucks vs. Chicago Bulls',
      url: 'https://www.ticketmaster.com/event/tm-001',
      startDateTime: '2026-08-15T00:00:00Z',
      statusCode: 'onsale',
      venueName: 'Fiserv Forum',
      venueAddress: '1111 Vel R. Phillips Ave, Milwaukee',
      venueLat: 43.0451,
      venueLng: -87.9172,
      imageUrl: 'https://images.tm.com/bucks.jpg',
    });
  });
});

describe('ticketmasterAdapter.normalize', () => {
  test('maps a full record to NormalizedEvent with geo', () => {
    const [record] = extractTicketmasterRecords(page);
    const n = ticketmasterAdapter.normalize(record);
    expect(n?.title).toBe('Milwaukee Bucks vs. Chicago Bulls');
    expect(n?.venueLat).toBeCloseTo(43.0451);
    expect(n?.status).toBe('scheduled');
  });

  test('skips events without a start dateTime', () => {
    const records = extractTicketmasterRecords(page);
    expect(ticketmasterAdapter.normalize(records[1])).toBeNull();
  });

  test('maps postponed status', () => {
    const records = extractTicketmasterRecords(page);
    expect(ticketmasterAdapter.normalize(records[2])?.status).toBe('postponed');
  });
});
```

Run: `npm run test -- tests/ingestion/ticketmaster-adapter.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement the Ticketmaster adapter**

Create `src/ingestion/adapters/ticketmaster.ts`:

```ts
import { z } from 'zod';
import { normalizedEventSchema, type NormalizedEvent } from '@/lib/validation/normalized-event';
import type { FetchedRecord, SourceAdapter } from './types';

const configSchema = z.object({
  adapter: z.literal('ticketmaster'),
  city: z.string().default('Milwaukee'),
  stateCode: z.string().default('WI'),
});

const payloadSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  url: z.string().optional(),
  startDateTime: z.string().optional(),
  statusCode: z.string().optional(),
  venueName: z.string().optional(),
  venueAddress: z.string().optional(),
  venueLat: z.number().optional(),
  venueLng: z.number().optional(),
  imageUrl: z.string().optional(),
});

const API_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';
const PAGE_SIZE = 199;
const MAX_PAGES = 5;
const PAGE_DELAY_MS = 250;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function extractTicketmasterRecords(page: any): FetchedRecord[] {
  const events: any[] = page?._embedded?.events ?? [];
  return events.map((event) => {
    const venue = event?._embedded?.venues?.[0];
    const addressParts = [venue?.address?.line1, venue?.city?.name].filter(Boolean);
    return {
      sourceEventId: String(event.id),
      sourceUrl: event.url,
      payload: {
        id: String(event.id),
        name: event.name,
        url: event.url,
        startDateTime: event?.dates?.start?.dateTime,
        statusCode: event?.dates?.status?.code,
        venueName: venue?.name,
        venueAddress: addressParts.length > 0 ? addressParts.join(', ') : undefined,
        venueLat: venue?.location?.latitude ? Number(venue.location.latitude) : undefined,
        venueLng: venue?.location?.longitude ? Number(venue.location.longitude) : undefined,
        imageUrl: event?.images?.[0]?.url,
      },
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mapStatus(code: string | undefined): NormalizedEvent['status'] {
  if (code === 'cancelled' || code === 'canceled') return 'cancelled';
  if (code === 'postponed' || code === 'rescheduled') return 'postponed';
  return 'scheduled';
}

function requireApiKey(): string {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) {
    throw new Error('TICKETMASTER_API_KEY is not set — register at developer.ticketmaster.com');
  }
  return key;
}

async function fetchPage(apiKey: string, config: z.infer<typeof configSchema>, pageNumber: number) {
  const url = new URL(API_URL);
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('city', config.city);
  url.searchParams.set('stateCode', config.stateCode);
  url.searchParams.set('size', String(PAGE_SIZE));
  url.searchParams.set('page', String(pageNumber));
  const res = await fetch(url, { headers: { 'user-agent': 'MKEEventsBot/0.1' } });
  if (!res.ok) throw new Error(`Ticketmaster fetch failed (${res.status}) page ${pageNumber}`);
  return res.json();
}

export const ticketmasterAdapter: SourceAdapter = {
  adapterType: 'api',

  async fetch(rawConfig: unknown): Promise<FetchedRecord[]> {
    const config = configSchema.parse(rawConfig);
    const apiKey = requireApiKey();
    const records: FetchedRecord[] = [];
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const page = await fetchPage(apiKey, config, pageNumber);
      records.push(...extractTicketmasterRecords(page));
      if (pageNumber >= (page?.page?.totalPages ?? 1) - 1) break;
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
    return records;
  },

  normalize(record: FetchedRecord): NormalizedEvent | null {
    const parsed = payloadSchema.safeParse(record.payload);
    if (!parsed.success || !parsed.data.startDateTime) return null;
    const p = parsed.data;
    const result = normalizedEventSchema.safeParse({
      sourceEventId: p.id,
      title: p.name,
      url: p.url,
      imageUrl: p.imageUrl,
      venueName: p.venueName,
      venueAddress: p.venueAddress,
      venueLat: p.venueLat,
      venueLng: p.venueLng,
      startAt: p.startDateTime,
      status: mapStatus(p.statusCode),
    });
    return result.success ? result.data : null;
  },
};
```

Run: `npm run test -- tests/ingestion/ticketmaster-adapter.test.ts` — Expected: 4 passed.

- [ ] **Step 4: Create the registry and switch run.ts to it**

Create `src/ingestion/adapters/registry.ts`:

```ts
import { z } from 'zod';
import { eventbriteAdapter } from './eventbrite';
import { icalAdapter } from './ical';
import { ticketmasterAdapter } from './ticketmaster';
import type { SourceAdapter } from './types';

const apiConfigSchema = z.object({ adapter: z.enum(['ticketmaster', 'eventbrite']) });

const apiAdapters: Record<string, SourceAdapter> = {
  ticketmaster: ticketmasterAdapter,
  eventbrite: eventbriteAdapter,
};

export function resolveAdapter(source: {
  adapterType: string;
  config: unknown;
}): SourceAdapter {
  if (source.adapterType === 'ical') return icalAdapter;
  if (source.adapterType === 'api') {
    const { adapter } = apiConfigSchema.parse(source.config);
    return apiAdapters[adapter];
  }
  throw new Error(`No adapter registered for type: ${source.adapterType}`);
}
```

NOTE: registry.ts imports `eventbriteAdapter`, which Task 4 creates. To keep this task independently green, create a minimal `src/ingestion/adapters/eventbrite.ts` stub in THIS task that Task 4 fully implements:

```ts
import type { FetchedRecord, SourceAdapter } from './types';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';

export const eventbriteAdapter: SourceAdapter = {
  adapterType: 'api',
  async fetch(): Promise<FetchedRecord[]> {
    throw new Error('Eventbrite adapter not implemented yet');
  },
  normalize(): NormalizedEvent | null {
    return null;
  },
};
```

In `src/ingestion/run.ts`, replace the `adapters` map and lookup with:

```ts
import { resolveAdapter } from '@/ingestion/adapters/registry';
```

```ts
  let adapter;
  try {
    adapter = resolveAdapter(source);
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
```

Add a registry test in `tests/ingestion/ticketmaster-adapter.test.ts`:

```ts
import { resolveAdapter } from '@/ingestion/adapters/registry';

describe('resolveAdapter', () => {
  test('resolves ical and api adapters, rejects unknown', () => {
    expect(resolveAdapter({ adapterType: 'ical', config: {} }).adapterType).toBe('ical');
    expect(
      resolveAdapter({ adapterType: 'api', config: { adapter: 'ticketmaster' } }).adapterType,
    ).toBe('api');
    expect(() => resolveAdapter({ adapterType: 'html', config: {} })).toThrow(
      'No adapter registered',
    );
  });
});
```

- [ ] **Step 5: Create .env.example, verify, commit**

Create `.env.example`:

```
# Neon Postgres pooled connection string
DATABASE_URL=
# Ticketmaster Discovery API key (developer.ticketmaster.com) — free tier
TICKETMASTER_API_KEY=
# Eventbrite private token (eventbrite.com/platform) — for organizer-events sync
EVENTBRITE_PRIVATE_TOKEN=
```

Run: `npm run test && npm run typecheck` — Expected: all pass, clean.

```bash
git add src/ingestion/adapters/ tests/ src/ingestion/run.ts .env.example
git commit -m "feat: add Ticketmaster Discovery adapter and adapter registry"
```

---

### Task 4: Eventbrite organizer-events adapter

**Files:**
- Modify: `src/ingestion/adapters/eventbrite.ts` (replace Task 3 stub)
- Create: `tests/fixtures/eventbrite-events.json`
- Test: `tests/ingestion/eventbrite-adapter.test.ts`

**Interfaces:**
- Consumes: `SourceAdapter`, `FetchedRecord`, `normalizedEventSchema`.
- Produces: full `eventbriteAdapter: SourceAdapter` + pure `extractEventbriteRecords(page: unknown): FetchedRecord[]`. Config: `{ adapter: 'eventbrite', organizerIds: string[] }`. Env: `EVENTBRITE_PRIVATE_TOKEN` (clear error if missing). Fetches `https://www.eventbriteapi.com/v3/organizers/{id}/events/?status=live&order_by=start_asc&expand=venue` per organizer, following `pagination.has_more_items` with `continuation` (max 5 pages per organizer). IMPORTANT context: Eventbrite retired its public event SEARCH API — organizer/venue-scoped endpoints are the supported path, which is why config carries explicit organizer IDs.
- Payload per event: `{ id, name, description, url, startUtc, endUtc, status, isFree, venueName, venueAddress, venueLat, venueLng, imageUrl }`. Status: `live`→scheduled, `canceled`/`cancelled`→cancelled, `postponed`→postponed, others→scheduled.

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/eventbrite-events.json`:

```json
{
  "events": [
    {
      "id": "eb-100",
      "name": { "text": "Waterfront Concert Series" },
      "summary": "Live music on the harbor.",
      "url": "https://www.eventbrite.com/e/eb-100",
      "status": "live",
      "start": { "utc": "2026-08-20T23:00:00Z" },
      "end": { "utc": "2026-08-21T02:00:00Z" },
      "is_free": false,
      "logo": { "url": "https://img.evbuc.com/eb-100.jpg" },
      "venue": {
        "name": "The Cooperage",
        "address": { "localized_address_display": "822 S Water St, Milwaukee, WI 53204" },
        "latitude": "43.0243",
        "longitude": "-87.9079"
      }
    },
    {
      "id": "eb-101",
      "name": { "text": "Canceled Trivia Night" },
      "url": "https://www.eventbrite.com/e/eb-101",
      "status": "canceled",
      "start": { "utc": "2026-08-25T00:00:00Z" },
      "is_free": true,
      "venue": null
    }
  ],
  "pagination": { "has_more_items": false }
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/ingestion/eventbrite-adapter.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { eventbriteAdapter, extractEventbriteRecords } from '@/ingestion/adapters/eventbrite';

const page = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/eventbrite-events.json'), 'utf8'),
);

describe('extractEventbriteRecords', () => {
  test('extracts flat replayable payloads', () => {
    const records = extractEventbriteRecords(page);
    expect(records).toHaveLength(2);
    expect(records[0].payload).toEqual({
      id: 'eb-100',
      name: 'Waterfront Concert Series',
      description: 'Live music on the harbor.',
      url: 'https://www.eventbrite.com/e/eb-100',
      startUtc: '2026-08-20T23:00:00Z',
      endUtc: '2026-08-21T02:00:00Z',
      status: 'live',
      isFree: false,
      venueName: 'The Cooperage',
      venueAddress: '822 S Water St, Milwaukee, WI 53204',
      venueLat: 43.0243,
      venueLng: -87.9079,
      imageUrl: 'https://img.evbuc.com/eb-100.jpg',
    });
  });
});

describe('eventbriteAdapter.normalize', () => {
  test('maps live event with venue, geo, isFree', () => {
    const [record] = extractEventbriteRecords(page);
    const n = eventbriteAdapter.normalize(record);
    expect(n?.title).toBe('Waterfront Concert Series');
    expect(n?.isFree).toBe(false);
    expect(n?.venueLng).toBeCloseTo(-87.9079);
    expect(n?.endAt?.toISOString()).toBe('2026-08-21T02:00:00.000Z');
  });

  test('maps canceled status and handles null venue', () => {
    const [, canceled] = extractEventbriteRecords(page);
    const n = eventbriteAdapter.normalize(canceled);
    expect(n?.status).toBe('cancelled');
    expect(n?.venueName).toBeUndefined();
  });
});
```

Run: `npm run test -- tests/ingestion/eventbrite-adapter.test.ts` — Expected: FAIL (stub returns null / extract missing).

- [ ] **Step 3: Implement the adapter**

Replace `src/ingestion/adapters/eventbrite.ts`:

```ts
import { z } from 'zod';
import { normalizedEventSchema, type NormalizedEvent } from '@/lib/validation/normalized-event';
import type { FetchedRecord, SourceAdapter } from './types';

const configSchema = z.object({
  adapter: z.literal('eventbrite'),
  organizerIds: z.array(z.string().min(1)).min(1),
});

const payloadSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().optional(),
  startUtc: z.string(),
  endUtc: z.string().optional(),
  status: z.string().optional(),
  isFree: z.boolean().optional(),
  venueName: z.string().optional(),
  venueAddress: z.string().optional(),
  venueLat: z.number().optional(),
  venueLng: z.number().optional(),
  imageUrl: z.string().optional(),
});

const API_BASE = 'https://www.eventbriteapi.com/v3';
const MAX_PAGES = 5;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function extractEventbriteRecords(page: any): FetchedRecord[] {
  const events: any[] = page?.events ?? [];
  return events.map((event) => ({
    sourceEventId: String(event.id),
    sourceUrl: event.url,
    payload: {
      id: String(event.id),
      name: event?.name?.text,
      description: event?.summary,
      url: event.url,
      startUtc: event?.start?.utc,
      endUtc: event?.end?.utc,
      status: event?.status,
      isFree: event?.is_free,
      venueName: event?.venue?.name,
      venueAddress: event?.venue?.address?.localized_address_display,
      venueLat: event?.venue?.latitude ? Number(event.venue.latitude) : undefined,
      venueLng: event?.venue?.longitude ? Number(event.venue.longitude) : undefined,
      imageUrl: event?.logo?.url,
    },
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mapStatus(status: string | undefined): NormalizedEvent['status'] {
  if (status === 'canceled' || status === 'cancelled') return 'cancelled';
  if (status === 'postponed') return 'postponed';
  return 'scheduled';
}

function requireToken(): string {
  const token = process.env.EVENTBRITE_PRIVATE_TOKEN;
  if (!token) {
    throw new Error('EVENTBRITE_PRIVATE_TOKEN is not set — create one at eventbrite.com/platform');
  }
  return token;
}

async function fetchOrganizerPage(token: string, organizerId: string, continuation?: string) {
  const url = new URL(`${API_BASE}/organizers/${organizerId}/events/`);
  url.searchParams.set('status', 'live');
  url.searchParams.set('order_by', 'start_asc');
  url.searchParams.set('expand', 'venue');
  if (continuation) url.searchParams.set('continuation', continuation);
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Eventbrite fetch failed (${res.status}) organizer ${organizerId}`);
  return res.json();
}

async function fetchOrganizer(token: string, organizerId: string): Promise<FetchedRecord[]> {
  const records: FetchedRecord[] = [];
  let continuation: string | undefined;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const page = await fetchOrganizerPage(token, organizerId, continuation);
    records.push(...extractEventbriteRecords(page));
    if (!page?.pagination?.has_more_items) break;
    continuation = page.pagination.continuation;
  }
  return records;
}

export const eventbriteAdapter: SourceAdapter = {
  adapterType: 'api',

  async fetch(rawConfig: unknown): Promise<FetchedRecord[]> {
    const config = configSchema.parse(rawConfig);
    const token = requireToken();
    const all: FetchedRecord[] = [];
    for (const organizerId of config.organizerIds) {
      all.push(...(await fetchOrganizer(token, organizerId)));
    }
    return all;
  },

  normalize(record: FetchedRecord): NormalizedEvent | null {
    const parsed = payloadSchema.safeParse(record.payload);
    if (!parsed.success) return null;
    const p = parsed.data;
    const result = normalizedEventSchema.safeParse({
      sourceEventId: p.id,
      title: p.name,
      description: p.description,
      url: p.url,
      imageUrl: p.imageUrl,
      venueName: p.venueName,
      venueAddress: p.venueAddress,
      venueLat: p.venueLat,
      venueLng: p.venueLng,
      startAt: p.startUtc,
      endAt: p.endUtc,
      isFree: p.isFree,
      status: mapStatus(p.status),
    });
    return result.success ? result.data : null;
  },
};
```

Run: `npm run test -- tests/ingestion/eventbrite-adapter.test.ts` — Expected: 3 passed.

- [ ] **Step 4: Full verification and commit**

Run: `npm run test && npm run typecheck` — Expected: all pass, clean.

```bash
git add src/ingestion/adapters/eventbrite.ts tests/fixtures/eventbrite-events.json tests/ingestion/eventbrite-adapter.test.ts
git commit -m "feat: add Eventbrite organizer-events adapter"
```

---

### Task 5: Wave-1 feed/API source registration + live verification

**Files:**
- Modify: `src/db/seed.ts` (source registry array), `README.md` (source table + env setup)

**Interfaces:**
- Consumes: everything above.
- Produces: `npm run db:seed` registers all verified wave-1 feed/API sources idempotently. This task is the LIVE verification gate for Plan 2a (MOO-255 evidence).

- [ ] **Step 1: Verify candidate feed URLs live (no code yet)**

For each candidate, `curl -sI '<url>'` and confirm HTTP 200 with calendar/text content type; for iCal also `curl -s '<url>' | head -5` must start with `BEGIN:VCALENDAR`:

- Linneman's: `https://linnemans.com/events/?ical=1`
- WMSE: `https://wmse.org/event/?ical=1` (The Events Calendar convention; if 404 try `https://wmse.org/events/?ical=1`)
- MKE Shows: open `https://mkeshows.com/export` (curl the HTML) and locate the actual iCal export URL in the page; verify it returns `BEGIN:VCALENDAR`
- Brewers: `https://www.mlb.com/brewers/schedule/ical` — if not direct, curl the schedule page and locate the .ics link

**Rule: only sources with a verified-live URL get seeded.** Any candidate that can't be verified in ~10 minutes of investigation is EXCLUDED from seed.ts and listed in your task report under "not verified — needs follow-up" with what you observed. Do not seed guesses.

- [ ] **Step 2: Rewrite seed.ts as a registry array**

Replace `src/db/seed.ts` (substitute verified URLs from Step 1; drop unverified entries):

```ts
import 'dotenv/config';
import { db } from '@/db';
import * as schema from '@/db/schema';

type SeedSource = typeof schema.sources.$inferInsert;

const SOURCES: SeedSource[] = [
  {
    key: 'urban-milwaukee',
    name: 'Urban Milwaukee Events',
    url: 'https://urbanmilwaukee.com/events/',
    adapterType: 'ical',
    config: { icalUrl: 'https://urbanmilwaukee.com/events/?ical=1' },
  },
  {
    key: 'linnemans',
    name: "Linneman's Riverwest Inn",
    url: 'https://linnemans.com/events/',
    adapterType: 'ical',
    config: { icalUrl: 'https://linnemans.com/events/?ical=1' },
  },
  {
    key: 'wmse',
    name: 'WMSE 91.7FM Events',
    url: 'https://wmse.org/event/',
    adapterType: 'ical',
    config: { icalUrl: 'https://wmse.org/event/?ical=1' },
  },
  {
    key: 'mke-shows',
    name: 'MKE Shows',
    url: 'https://mkeshows.com/',
    adapterType: 'ical',
    config: { icalUrl: 'VERIFIED_URL_FROM_STEP_1' },
  },
  {
    key: 'brewers',
    name: 'Milwaukee Brewers Schedule',
    url: 'https://www.mlb.com/brewers/schedule',
    adapterType: 'ical',
    config: { icalUrl: 'VERIFIED_URL_FROM_STEP_1' },
  },
  {
    key: 'ticketmaster-milwaukee',
    name: 'Ticketmaster Milwaukee',
    url: 'https://www.ticketmaster.com/discover/milwaukee',
    adapterType: 'api',
    config: { adapter: 'ticketmaster', city: 'Milwaukee', stateCode: 'WI' },
  },
  {
    key: 'eventbrite-cooperage',
    name: 'Eventbrite — The Cooperage',
    url: 'https://www.eventbrite.com/o/the-cooperage-17113476605',
    adapterType: 'api',
    config: { adapter: 'eventbrite', organizerIds: ['17113476605'] },
  },
];

async function main() {
  for (const source of SOURCES) {
    await db.insert(schema.sources).values(source).onConflictDoNothing({ target: schema.sources.key });
  }
  console.log(`Seeded ${SOURCES.length} sources: ${SOURCES.map((s) => s.key).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

The two `VERIFIED_URL_FROM_STEP_1` values MUST be replaced with the actual verified URLs — leaving that literal string in committed code is a task failure. If a source was excluded in Step 1, delete its entry entirely.

- [ ] **Step 3: Seed and run live ingest across every seeded source**

```bash
npm run db:seed
for key in urban-milwaukee linnemans wmse mke-shows brewers; do npm run ingest -- "$key"; done
```

For API sources: run `npm run ingest -- ticketmaster-milwaukee` and `npm run ingest -- eventbrite-cooperage` ONLY if the matching env var is set in `.env`. If not set, record "skipped — credential not provisioned" in your report (this is expected; the human provisions keys separately).

Expected: each run prints `<key>: N fetched, M published, K skipped` with N > 0 for feed sources. Record every line in your report.

- [ ] **Step 4: Verify totals and idempotency**

```bash
npx tsx -e "
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);
Promise.all([
  sql\`select s.key, count(esl.id)::int as events from sources s left join event_source_links esl on esl.source_id = s.id group by s.key order by s.key\`,
  sql\`select count(*)::int as c from events\`,
  sql\`select count(*)::int as c from event_instances\`,
]).then(([bySource, e, i]) => console.log({ bySource, events: e[0].c, instances: i[0].c }));
"
```

Re-run one feed source (`npm run ingest -- urban-milwaukee`) and re-run the counts — totals must be unchanged. Record both count snapshots in your report.

- [ ] **Step 5: Update README and commit**

In `README.md`, replace the setup section's step 2 with a pointer to `.env.example`, and add under Architecture:

```markdown
## Sources (wave 1, feed/API)

| Key | Type | Notes |
|---|---|---|
| urban-milwaukee | iCal | Broad community calendar |
| linnemans | iCal | Riverwest music venue |
| wmse | iCal | Station event calendar |
| mke-shows | iCal | Local/indie music aggregator |
| brewers | iCal | MLB schedule feed |
| ticketmaster-milwaukee | API | Needs TICKETMASTER_API_KEY |
| eventbrite-cooperage | API | Needs EVENTBRITE_PRIVATE_TOKEN |

HTML/JSON-LD sources (Visit Milwaukee, festivals, Pabst Theater Group, County Parks, Radio Milwaukee, Downtown BID) land in Plan 2b; dedup + scheduling in Plan 2c.
```

(Adjust the table to match what was actually seeded.)

Run: `npm run test && npm run typecheck && npm run build` — Expected: all pass.

```bash
git add src/db/seed.ts README.md
git commit -m "feat: register wave-1 feed and API sources (MOO-255)"
```

---

## Deferred to Plans 2b / 2c (not in this plan)

- **2b:** HTML/JSON-LD adapter framework, fixture-capture workflow, parsers for Visit Milwaukee, Milwaukee World Festival, Pabst Theater Group, County Parks, Radio Milwaukee calendar, Downtown BID; Firecrawl fallback adapter; Shepherd Express (City Spark RSS is nonstandard — treated as an HTML-class source there).
- **2c:** Dedup (clusters, trigram scoring, canonical selection, review queue tables), Trigger.dev scheduled ingestion with near-term/distant cadence and backoff, and the MOO-255 dedup/schedule verification checklist items.
