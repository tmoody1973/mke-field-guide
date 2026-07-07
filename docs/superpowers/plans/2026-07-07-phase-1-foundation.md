# MKE Events Phase 1: Foundation + First Vertical Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js/Neon/Drizzle foundation and prove the ingestion pipeline end-to-end: Urban Milwaukee's iCal feed → raw storage → normalization → canonical events → rendered on `/events`.

**Architecture:** Next.js App Router on Vercel-ready scaffold; Neon Postgres as the single system of record via Drizzle ORM; a deterministic adapter pipeline (fetch → store raw → normalize → persist) run from a CLI script in this phase (Trigger.dev scheduling arrives in Phase 2). Persistence logic is tested against PGlite (in-memory Postgres) so tests need no cloud database.

**Tech Stack:** Next.js (App Router, TypeScript, Tailwind), Neon Postgres, Drizzle ORM + drizzle-kit, Zod, node-ical, Vitest, PGlite (tests), tsx (CLI scripts).

**Spec:** `docs/superpowers/specs/2026-07-07-mke-events-mvp-design.md`

## Global Constraints

- TypeScript `strict: true`; Node.js >= 20; npm as package manager.
- All event times stored as `timestamptz`; display timezone is always `America/Chicago`.
- Zod validation at every boundary (adapter config, adapter output, normalized events). Records failing validation are skipped and counted, never published.
- Immutability: never mutate input objects; return new objects.
- Files < 800 lines; functions < 50 lines; no deep nesting (> 4 levels).
- Secrets only via environment variables. `DATABASE_URL` lives in `.env` (gitignored) and is validated at startup — fail fast if missing.
- Working title is "MKE Events"; keep user-visible branding minimal in this phase (final name pending).
- Adapters must normalize from the **stored payload** (not live fetch state) so `raw_events` rows can be replayed for debugging.
- RetroUI is deferred to Phase 4 (public experience); this phase's `/events` page is plain Tailwind. Phase 4's plan author must fetch current retroui.dev docs before writing setup steps.

## File Structure

```
drizzle.config.ts               — drizzle-kit config (reads .env)
drizzle/                        — generated SQL migrations
src/db/schema.ts                — all Drizzle tables + relations
src/db/index.ts                 — Neon client, env validation
src/db/seed.ts                  — seed sources registry (urban-milwaukee)
src/lib/validation/normalized-event.ts — NormalizedEvent Zod contract
src/ingestion/adapters/types.ts — SourceAdapter + FetchedRecord interfaces
src/ingestion/adapters/ical.ts  — iCal adapter (parse + normalize)
src/ingestion/naming.ts         — normalizeName, slugify helpers
src/ingestion/persist.ts        — persistNormalizedEvent upsert logic
src/ingestion/run.ts            — CLI runner (npm run ingest -- <source-key>)
src/app/events/page.tsx         — server-rendered upcoming events list
tests/helpers/test-db.ts        — PGlite + migrations test database factory
tests/fixtures/urban-milwaukee.ics — recorded-style iCal fixture
tests/ingestion/*.test.ts       — unit + persistence tests
```

---

### Task 1: Scaffold Next.js app and test tooling

**Files:**
- Create: entire Next.js scaffold at repo root (via temp dir; repo root already contains `docs/`)
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts, deps)

**Interfaces:**
- Produces: a compiling Next.js App Router project with `npm run test` (Vitest) and `@/*` path alias working in both Next.js and Vitest.

- [ ] **Step 1: Scaffold via temp directory** (create-next-app refuses non-empty dirs, and `docs/` exists)

```bash
cd /Users/tarikmoody/Documents/Projects/super-events-mke
npx create-next-app@latest /tmp/mke-scaffold --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-npm --yes
rsync -a /tmp/mke-scaffold/ . --exclude .git
rm -rf /tmp/mke-scaffold
npm install
```

Expected: `package.json`, `src/app/`, `tsconfig.json`, `.gitignore` now exist at repo root; `docs/` untouched.

- [ ] **Step 2: Install runtime and dev dependencies**

```bash
npm install drizzle-orm @neondatabase/serverless zod node-ical dotenv
npm install -D drizzle-kit vitest vite-tsconfig-paths tsx @electric-sql/pglite
```

- [ ] **Step 3: Add Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Add npm scripts**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest",
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:seed": "tsx src/db/seed.ts",
"ingest": "tsx src/ingestion/run.ts"
```

- [ ] **Step 5: Verify the scaffold builds and Vitest runs**

```bash
npm run build
npm run test
```

Expected: build succeeds; Vitest reports "No test files found" and exits 0 (if it exits non-zero on empty, add `--passWithNoTests` to the `test` script).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest tooling"
```

---

### Task 2: Drizzle schema and Neon migration

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`

**Interfaces:**
- Produces: exported Drizzle tables `sources`, `rawEvents`, `venues`, `organizers`, `events`, `eventInstances`, `eventSourceLinks` plus relations; `db` (Neon-backed Drizzle client with `schema` for relational queries). Later tasks import `* as schema from '@/db/schema'` and `{ db } from '@/db'`.

- [ ] **Step 1: Create the Neon database**

Create a Neon project named `mke-events` (Neon console, CLI, or Neon MCP). Copy the **pooled** connection string. Create `.env` at repo root:

```
DATABASE_URL=postgresql://<user>:<password>@<pooled-host>/neondb?sslmode=require
```

Verify `.env` is gitignored: `git check-ignore .env` prints `.env`.

- [ ] **Step 2: Write drizzle config**

Create `drizzle.config.ts`:

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
});
```

- [ ] **Step 3: Write the schema**

Create `src/db/schema.ts`:

```ts
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  adapterType: text('adapter_type', {
    enum: ['api', 'ical', 'rss', 'html', 'firecrawl'],
  }).notNull(),
  config: jsonb('config').notNull().default({}),
  healthStatus: text('health_status', { enum: ['ok', 'failing', 'unknown'] })
    .notNull()
    .default('unknown'),
  lastFetchAt: timestamp('last_fetch_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rawEvents = pgTable(
  'raw_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceEventId: text('source_event_id').notNull(),
    sourceUrl: text('source_url'),
    extractionMethod: text('extraction_method').notNull(),
    payload: jsonb('payload').notNull(),
    contentHash: text('content_hash').notNull(),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('raw_events_source_event_hash_idx').on(
      t.sourceId,
      t.sourceEventId,
      t.contentHash,
    ),
    index('raw_events_source_event_idx').on(t.sourceId, t.sourceEventId),
  ],
);

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    address: text('address'),
    lat: numeric('lat'),
    lng: numeric('lng'),
    neighborhood: text('neighborhood'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('venues_normalized_name_idx').on(t.normalizedName)],
);

export const organizers = pgTable(
  'organizers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    url: text('url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('organizers_normalized_name_idx').on(t.normalizedName)],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    summary: text('summary'),
    description: text('description'),
    status: text('status', { enum: ['scheduled', 'cancelled', 'postponed'] })
      .notNull()
      .default('scheduled'),
    category: text('category'),
    imageUrl: text('image_url'),
    canonicalUrl: text('canonical_url'),
    venueId: uuid('venue_id').references(() => venues.id),
    organizerId: uuid('organizer_id').references(() => organizers.id),
    isFree: boolean('is_free'),
    isStationEvent: boolean('is_station_event').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_normalized_title_idx').on(t.normalizedTitle)],
);

export const eventInstances = pgTable(
  'event_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }),
    timezone: text('timezone').notNull().default('America/Chicago'),
    status: text('status', { enum: ['scheduled', 'cancelled', 'postponed'] })
      .notNull()
      .default('scheduled'),
  },
  (t) => [
    uniqueIndex('event_instances_event_start_idx').on(t.eventId, t.startAt),
    index('event_instances_start_at_idx').on(t.startAt),
  ],
);

export const eventSourceLinks = pgTable(
  'event_source_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceEventId: text('source_event_id').notNull(),
    sourceUrl: text('source_url'),
    isCanonical: boolean('is_canonical').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('event_source_links_source_event_idx').on(t.sourceId, t.sourceEventId)],
);

export const eventsRelations = relations(events, ({ one, many }) => ({
  venue: one(venues, { fields: [events.venueId], references: [venues.id] }),
  organizer: one(organizers, { fields: [events.organizerId], references: [organizers.id] }),
  instances: many(eventInstances),
  sourceLinks: many(eventSourceLinks),
}));

export const eventInstancesRelations = relations(eventInstances, ({ one }) => ({
  event: one(events, { fields: [eventInstances.eventId], references: [events.id] }),
}));

export const eventSourceLinksRelations = relations(eventSourceLinks, ({ one }) => ({
  event: one(events, { fields: [eventSourceLinks.eventId], references: [events.id] }),
  source: one(sources, { fields: [eventSourceLinks.sourceId], references: [sources.id] }),
}));

export const venuesRelations = relations(venues, ({ many }) => ({
  events: many(events),
}));
```

- [ ] **Step 4: Write the DB client**

Create `src/db/index.ts`:

```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Add it to .env before starting.');
}

export const db = drizzle(neon(databaseUrl), { schema });
```

- [ ] **Step 5: Generate and run the migration**

```bash
npm run db:generate
npm run db:migrate
```

Expected: `drizzle/0000_*.sql` created; migrate reports success.

- [ ] **Step 6: Verify tables exist in Neon**

```bash
npx tsx -e "
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);
sql\`select table_name from information_schema.tables where table_schema='public' order by 1\`.then(r => console.log(r.map(x => x.table_name)));
"
```

Expected output includes: `event_instances`, `event_source_links`, `events`, `organizers`, `raw_events`, `sources`, `venues`.

- [ ] **Step 7: Commit**

```bash
git add drizzle.config.ts drizzle/ src/db/
git commit -m "feat: add canonical event schema and Neon connection"
```

---

### Task 3: NormalizedEvent contract

**Files:**
- Create: `src/lib/validation/normalized-event.ts`
- Test: `tests/ingestion/normalized-event.test.ts`

**Interfaces:**
- Produces: `normalizedEventSchema` (Zod) and `type NormalizedEvent = z.infer<typeof normalizedEventSchema>` with fields: `sourceEventId: string`, `title: string`, `description?: string`, `url?: string`, `imageUrl?: string`, `venueName?: string`, `venueAddress?: string`, `startAt: Date`, `endAt?: Date`, `timezone: string` (default `'America/Chicago'`), `status: 'scheduled' | 'cancelled' | 'postponed'` (default `'scheduled'`). Every adapter's `normalize()` returns this type; `persistNormalizedEvent` consumes it.

- [ ] **Step 1: Write the failing test**

Create `tests/ingestion/normalized-event.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { normalizedEventSchema } from '@/lib/validation/normalized-event';

describe('normalizedEventSchema', () => {
  test('parses a minimal valid event and applies defaults', () => {
    const result = normalizedEventSchema.parse({
      sourceEventId: '12345@urbanmilwaukee.com',
      title: 'Jazz in the Park',
      startAt: '2026-07-11T00:00:00.000Z',
    });
    expect(result.startAt).toBeInstanceOf(Date);
    expect(result.timezone).toBe('America/Chicago');
    expect(result.status).toBe('scheduled');
  });

  test('rejects empty title', () => {
    const result = normalizedEventSchema.safeParse({
      sourceEventId: 'x',
      title: '',
      startAt: '2026-07-11T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  test('rejects endAt before startAt', () => {
    const result = normalizedEventSchema.safeParse({
      sourceEventId: 'x',
      title: 'Backwards Event',
      startAt: '2026-07-11T00:00:00.000Z',
      endAt: '2026-07-10T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid url', () => {
    const result = normalizedEventSchema.safeParse({
      sourceEventId: 'x',
      title: 'Event',
      url: 'not-a-url',
      startAt: '2026-07-11T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/ingestion/normalized-event.test.ts`
Expected: FAIL — cannot resolve `@/lib/validation/normalized-event`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/validation/normalized-event.ts`:

```ts
import { z } from 'zod';

export const normalizedEventSchema = z
  .object({
    sourceEventId: z.string().min(1),
    title: z.string().trim().min(1).max(500),
    description: z.string().optional(),
    url: z.string().url().optional(),
    imageUrl: z.string().url().optional(),
    venueName: z.string().trim().min(1).optional(),
    venueAddress: z.string().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date().optional(),
    timezone: z.string().default('America/Chicago'),
    status: z.enum(['scheduled', 'cancelled', 'postponed']).default('scheduled'),
  })
  .refine((e) => !e.endAt || e.endAt.getTime() >= e.startAt.getTime(), {
    message: 'endAt must not be before startAt',
    path: ['endAt'],
  });

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/ingestion/normalized-event.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/normalized-event.ts tests/ingestion/normalized-event.test.ts
git commit -m "feat: add NormalizedEvent validation contract"
```

---

### Task 4: iCal adapter

**Files:**
- Create: `src/ingestion/adapters/types.ts`
- Create: `src/ingestion/adapters/ical.ts`
- Create: `tests/fixtures/urban-milwaukee.ics`
- Test: `tests/ingestion/ical-adapter.test.ts`

**Interfaces:**
- Consumes: `normalizedEventSchema`, `NormalizedEvent` from Task 3.
- Produces:
  - `interface FetchedRecord { sourceEventId: string; sourceUrl?: string; payload: unknown }`
  - `interface SourceAdapter { adapterType: string; fetch(config: unknown): Promise<FetchedRecord[]>; normalize(record: FetchedRecord): NormalizedEvent | null }`
  - `icalAdapter: SourceAdapter` and pure helper `parseIcsText(text: string): FetchedRecord[]` (exported for tests and replay).
  - Payloads are plain-JSON (`{ uid, summary, description?, location?, url?, startAt, endAt?, status? }` with ISO-string dates) so `raw_events.payload` is replayable.

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/urban-milwaukee.ics`:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Urban Milwaukee//Events//EN
X-WR-TIMEZONE:America/Chicago
BEGIN:VTIMEZONE
TZID:America/Chicago
BEGIN:DAYLIGHT
TZOFFSETFROM:-0600
TZOFFSETTO:-0500
TZNAME:CDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0500
TZOFFSETTO:-0600
TZNAME:CST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:12345@urbanmilwaukee.com
DTSTAMP:20260701T120000Z
DTSTART;TZID=America/Chicago:20260710T190000
DTEND;TZID=America/Chicago:20260710T220000
SUMMARY:Jazz in the Park
DESCRIPTION:Free weekly jazz concert in Cathedral Square Park.
LOCATION:Cathedral Square Park\, 520 E Wells St\, Milwaukee\, WI 53202
URL:https://urbanmilwaukee.com/event/jazz-in-the-park/
END:VEVENT
BEGIN:VEVENT
UID:67890@urbanmilwaukee.com
DTSTAMP:20260701T120000Z
DTSTART;TZID=America/Chicago:20260711T100000
SUMMARY:South Shore Farmers Market
LOCATION:South Shore Park\, Milwaukee\, WI
URL:https://urbanmilwaukee.com/event/south-shore-farmers-market/
END:VEVENT
END:VCALENDAR
```

- [ ] **Step 2: Write the failing test**

Create `tests/ingestion/ical-adapter.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { icalAdapter, parseIcsText } from '@/ingestion/adapters/ical';

const fixture = readFileSync(
  join(process.cwd(), 'tests/fixtures/urban-milwaukee.ics'),
  'utf8',
);

describe('parseIcsText', () => {
  test('extracts both VEVENTs with JSON-safe payloads', () => {
    const records = parseIcsText(fixture);
    expect(records).toHaveLength(2);
    const [first] = records;
    expect(first.sourceEventId).toBe('12345@urbanmilwaukee.com');
    expect(first.sourceUrl).toBe('https://urbanmilwaukee.com/event/jazz-in-the-park/');
    // 19:00 America/Chicago in July (CDT, UTC-5) = 00:00Z next day
    expect((first.payload as { startAt: string }).startAt).toBe('2026-07-11T00:00:00.000Z');
    expect(JSON.parse(JSON.stringify(first.payload))).toEqual(first.payload);
  });
});

describe('icalAdapter.normalize', () => {
  test('maps a full record to a NormalizedEvent', () => {
    const [record] = parseIcsText(fixture);
    const n = icalAdapter.normalize(record);
    expect(n).not.toBeNull();
    expect(n?.title).toBe('Jazz in the Park');
    expect(n?.venueName).toBe('Cathedral Square Park');
    expect(n?.venueAddress).toBe('Cathedral Square Park, 520 E Wells St, Milwaukee, WI 53202');
    expect(n?.startAt.toISOString()).toBe('2026-07-11T00:00:00.000Z');
    expect(n?.endAt?.toISOString()).toBe('2026-07-11T03:00:00.000Z');
    expect(n?.status).toBe('scheduled');
  });

  test('handles a record with no end time and no description', () => {
    const [, second] = parseIcsText(fixture);
    const n = icalAdapter.normalize(second);
    expect(n).not.toBeNull();
    expect(n?.title).toBe('South Shore Farmers Market');
    expect(n?.endAt).toBeUndefined();
  });

  test('returns null for an unparseable payload', () => {
    const n = icalAdapter.normalize({ sourceEventId: 'bad', payload: { junk: true } });
    expect(n).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- tests/ingestion/ical-adapter.test.ts`
Expected: FAIL — cannot resolve `@/ingestion/adapters/ical`.

- [ ] **Step 4: Write the adapter**

Create `src/ingestion/adapters/types.ts`:

```ts
import type { NormalizedEvent } from '@/lib/validation/normalized-event';

export interface FetchedRecord {
  sourceEventId: string;
  sourceUrl?: string;
  /** Plain-JSON payload; stored verbatim in raw_events and replayable. */
  payload: unknown;
}

export interface SourceAdapter {
  adapterType: string;
  fetch(config: unknown): Promise<FetchedRecord[]>;
  /** Must derive everything from record.payload. Returns null to skip invalid records. */
  normalize(record: FetchedRecord): NormalizedEvent | null;
}
```

Create `src/ingestion/adapters/ical.ts`:

```ts
import ical from 'node-ical';
import { z } from 'zod';
import {
  normalizedEventSchema,
  type NormalizedEvent,
} from '@/lib/validation/normalized-event';
import type { FetchedRecord, SourceAdapter } from './types';

const icalConfigSchema = z.object({ icalUrl: z.string().url() });

const icalPayloadSchema = z.object({
  uid: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  url: z.string().optional(),
  startAt: z.string(),
  endAt: z.string().optional(),
  status: z.string().optional(),
});

export function parseIcsText(text: string): FetchedRecord[] {
  const parsed = ical.sync.parseICS(text);
  const records: FetchedRecord[] = [];
  for (const component of Object.values(parsed)) {
    if (component.type !== 'VEVENT') continue;
    const vevent = component;
    if (!vevent.uid || !vevent.summary || !vevent.start) continue;
    const url = typeof vevent.url === 'string' ? vevent.url : undefined;
    records.push({
      sourceEventId: vevent.uid,
      sourceUrl: url,
      payload: {
        uid: vevent.uid,
        summary: String(vevent.summary),
        description: vevent.description ? String(vevent.description) : undefined,
        location: vevent.location ? String(vevent.location) : undefined,
        url,
        startAt: vevent.start.toISOString(),
        endAt: vevent.end ? vevent.end.toISOString() : undefined,
        status: vevent.status ? String(vevent.status) : undefined,
      },
    });
  }
  return records;
}

function mapStatus(raw: string | undefined): NormalizedEvent['status'] {
  if (raw?.toUpperCase() === 'CANCELLED') return 'cancelled';
  return 'scheduled';
}

export const icalAdapter: SourceAdapter = {
  adapterType: 'ical',

  async fetch(config: unknown): Promise<FetchedRecord[]> {
    const { icalUrl } = icalConfigSchema.parse(config);
    const res = await fetch(icalUrl, {
      headers: { 'user-agent': 'MKEEventsBot/0.1 (event aggregation; Milwaukee, WI)' },
    });
    if (!res.ok) throw new Error(`iCal fetch failed (${res.status}) for ${icalUrl}`);
    return parseIcsText(await res.text());
  },

  normalize(record: FetchedRecord): NormalizedEvent | null {
    const payload = icalPayloadSchema.safeParse(record.payload);
    if (!payload.success) return null;
    const p = payload.data;
    const venueName = p.location?.split(',')[0]?.trim();
    const result = normalizedEventSchema.safeParse({
      sourceEventId: p.uid,
      title: p.summary,
      description: p.description,
      url: p.url,
      venueName: venueName || undefined,
      venueAddress: p.location,
      startAt: p.startAt,
      endAt: p.endAt,
      status: mapStatus(p.status),
    });
    return result.success ? result.data : null;
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- tests/ingestion/ical-adapter.test.ts`
Expected: 4 passed. If the timezone assertion fails, node-ical's VTIMEZONE handling is the culprit — inspect `records[0].payload.startAt` and fix parsing (do not loosen the assertion; correct America/Chicago conversion is a requirement).

- [ ] **Step 6: Commit**

```bash
git add src/ingestion/adapters/ tests/fixtures/ tests/ingestion/ical-adapter.test.ts
git commit -m "feat: add iCal source adapter with replayable payloads"
```

---

### Task 5: Persistence — naming helpers and canonical upsert

**Files:**
- Create: `src/ingestion/naming.ts`
- Create: `src/ingestion/persist.ts`
- Create: `tests/helpers/test-db.ts`
- Test: `tests/ingestion/naming.test.ts`, `tests/ingestion/persist.test.ts`

**Interfaces:**
- Consumes: schema tables from Task 2; `NormalizedEvent` from Task 3.
- Produces:
  - `normalizeName(name: string): string` — lowercase, accent-stripped, punctuation collapsed.
  - `slugify(title: string, sourceEventId: string): string` — URL slug with 8-char stable hash suffix.
  - `type Db = PgDatabase<any, typeof schema>` (works for both Neon and PGlite drizzle instances).
  - `persistNormalizedEvent(db: Db, sourceId: string, n: NormalizedEvent): Promise<{ eventId: string; created: boolean }>` — idempotent upsert keyed on `(sourceId, sourceEventId)`.
  - `createTestDb(): Promise<Db>` — PGlite database with all migrations applied (test helper).

- [ ] **Step 1: Write failing naming tests**

Create `tests/ingestion/naming.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { normalizeName, slugify } from '@/ingestion/naming';

describe('normalizeName', () => {
  test('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeName("  Linneman's  Riverwest Inn! ")).toBe('linneman s riverwest inn');
  });
  test('strips accents', () => {
    expect(normalizeName('Café Benelux')).toBe('cafe benelux');
  });
});

describe('slugify', () => {
  test('produces url-safe slug with stable hash suffix', () => {
    const a = slugify('Jazz in the Park', '12345@urbanmilwaukee.com');
    const b = slugify('Jazz in the Park', '12345@urbanmilwaukee.com');
    expect(a).toBe(b);
    expect(a).toMatch(/^jazz-in-the-park-[0-9a-f]{8}$/);
  });
  test('different source ids produce different slugs', () => {
    expect(slugify('Trivia Night', 'a')).not.toBe(slugify('Trivia Night', 'b'));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- tests/ingestion/naming.test.ts`
Expected: FAIL — cannot resolve `@/ingestion/naming`.

- [ ] **Step 3: Implement naming helpers**

Create `src/ingestion/naming.ts`:

```ts
import { createHash } from 'node:crypto';

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(title: string, sourceEventId: string): string {
  const base = normalizeName(title)
    .replace(/\s/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
  const hash = createHash('sha256').update(sourceEventId).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}
```

Run: `npm run test -- tests/ingestion/naming.test.ts` — Expected: 4 passed. Commit:

```bash
git add src/ingestion/naming.ts tests/ingestion/naming.test.ts
git commit -m "feat: add name normalization and slug helpers"
```

- [ ] **Step 4: Write the PGlite test helper**

Create `tests/helpers/test-db.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/db/schema';

export async function createTestDb() {
  const client = new PGlite();
  const migrationsDir = join(process.cwd(), 'drizzle');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  return drizzle(client, { schema });
}
```

- [ ] **Step 5: Write failing persistence tests**

Create `tests/ingestion/persist.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import * as schema from '@/db/schema';
import { persistNormalizedEvent } from '@/ingestion/persist';
import { normalizedEventSchema } from '@/lib/validation/normalized-event';
import { createTestDb } from '../helpers/test-db';

async function seedSource(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [source] = await db
    .insert(schema.sources)
    .values({ key: 'test', name: 'Test Source', url: 'https://example.com', adapterType: 'ical' })
    .returning();
  return source;
}

const sample = normalizedEventSchema.parse({
  sourceEventId: '12345@urbanmilwaukee.com',
  title: 'Jazz in the Park',
  venueName: 'Cathedral Square Park',
  venueAddress: 'Cathedral Square Park, 520 E Wells St, Milwaukee, WI 53202',
  url: 'https://urbanmilwaukee.com/event/jazz-in-the-park/',
  startAt: '2026-07-11T00:00:00.000Z',
  endAt: '2026-07-11T03:00:00.000Z',
});

describe('persistNormalizedEvent', () => {
  test('first ingest creates event, venue, instance, and source link', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);

    const result = await persistNormalizedEvent(db, source.id, sample);

    expect(result.created).toBe(true);
    expect(await db.query.events.findMany()).toHaveLength(1);
    expect(await db.query.venues.findMany()).toHaveLength(1);
    expect(await db.query.eventInstances.findMany()).toHaveLength(1);
    expect(await db.query.eventSourceLinks.findMany()).toHaveLength(1);
  });

  test('re-ingesting the same record is idempotent and updates fields', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);

    await persistNormalizedEvent(db, source.id, sample);
    const updated = { ...sample, title: 'Jazz in the Park (Rescheduled)' };
    const result = await persistNormalizedEvent(db, source.id, updated);

    expect(result.created).toBe(false);
    const events = await db.query.events.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Jazz in the Park (Rescheduled)');
    expect(await db.query.eventInstances.findMany()).toHaveLength(1);
  });

  test('two events at the same venue share one venue row', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);

    await persistNormalizedEvent(db, source.id, sample);
    await persistNormalizedEvent(db, source.id, {
      ...sample,
      sourceEventId: 'other@urbanmilwaukee.com',
      title: 'Another Concert',
      venueName: 'Cathedral  Square Park', // extra whitespace, same normalized name
    });

    expect(await db.query.venues.findMany()).toHaveLength(1);
    expect(await db.query.events.findMany()).toHaveLength(2);
  });

  test('event without venue persists with null venueId', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);

    await persistNormalizedEvent(db, source.id, {
      ...sample,
      venueName: undefined,
      venueAddress: undefined,
    });

    const [event] = await db.query.events.findMany();
    expect(event.venueId).toBeNull();
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npm run test -- tests/ingestion/persist.test.ts`
Expected: FAIL — cannot resolve `@/ingestion/persist`.

- [ ] **Step 7: Implement persistence**

Create `src/ingestion/persist.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { normalizeName, slugify } from './naming';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

async function findOrCreateVenue(
  db: Db,
  venueName: string,
  venueAddress: string | undefined,
): Promise<string> {
  const normalized = normalizeName(venueName);
  const existing = await db.query.venues.findFirst({
    where: eq(schema.venues.normalizedName, normalized),
  });
  if (existing) return existing.id;
  const [created] = await db
    .insert(schema.venues)
    .values({ name: venueName.trim(), normalizedName: normalized, address: venueAddress })
    .returning();
  return created.id;
}

export async function persistNormalizedEvent(
  db: Db,
  sourceId: string,
  n: NormalizedEvent,
): Promise<{ eventId: string; created: boolean }> {
  const venueId = n.venueName
    ? await findOrCreateVenue(db, n.venueName, n.venueAddress)
    : null;

  const existingLink = await db.query.eventSourceLinks.findFirst({
    where: and(
      eq(schema.eventSourceLinks.sourceId, sourceId),
      eq(schema.eventSourceLinks.sourceEventId, n.sourceEventId),
    ),
  });

  let eventId: string;
  let created = false;

  if (existingLink) {
    eventId = existingLink.eventId;
    await db
      .update(schema.events)
      .set({
        title: n.title,
        normalizedTitle: normalizeName(n.title),
        description: n.description,
        canonicalUrl: n.url,
        imageUrl: n.imageUrl,
        status: n.status,
        venueId,
        updatedAt: new Date(),
      })
      .where(eq(schema.events.id, eventId));
    await db
      .update(schema.eventSourceLinks)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.eventSourceLinks.id, existingLink.id));
  } else {
    const [event] = await db
      .insert(schema.events)
      .values({
        slug: slugify(n.title, n.sourceEventId),
        title: n.title,
        normalizedTitle: normalizeName(n.title),
        description: n.description,
        canonicalUrl: n.url,
        imageUrl: n.imageUrl,
        status: n.status,
        venueId,
      })
      .returning();
    eventId = event.id;
    created = true;
    await db.insert(schema.eventSourceLinks).values({
      eventId,
      sourceId,
      sourceEventId: n.sourceEventId,
      sourceUrl: n.url,
    });
  }

  await db
    .insert(schema.eventInstances)
    .values({
      eventId,
      startAt: n.startAt,
      endAt: n.endAt,
      timezone: n.timezone,
      status: n.status,
    })
    .onConflictDoUpdate({
      target: [schema.eventInstances.eventId, schema.eventInstances.startAt],
      set: { endAt: n.endAt, status: n.status },
    });

  return { eventId, created };
}
```

- [ ] **Step 8: Run to verify all tests pass**

Run: `npm run test`
Expected: all tests pass (naming, contract, adapter, persistence).

- [ ] **Step 9: Commit**

```bash
git add src/ingestion/persist.ts tests/helpers/ tests/ingestion/persist.test.ts
git commit -m "feat: add canonical event persistence with idempotent upserts"
```

---

### Task 6: Source seed and CLI ingest runner

**Files:**
- Create: `src/db/seed.ts`
- Create: `src/ingestion/run.ts`

**Interfaces:**
- Consumes: `db` (Task 2), `icalAdapter`/`SourceAdapter` (Task 4), `persistNormalizedEvent` (Task 5).
- Produces: `npm run db:seed` (registers `urban-milwaukee` source) and `npm run ingest -- urban-milwaukee` (full pipeline run against the live feed). Adapter registry pattern later phases extend: `const adapters: Record<string, SourceAdapter>`.

- [ ] **Step 1: Write the seed script**

Create `src/db/seed.ts`:

```ts
import 'dotenv/config';
import { db } from '@/db';
import * as schema from '@/db/schema';

async function main() {
  await db
    .insert(schema.sources)
    .values({
      key: 'urban-milwaukee',
      name: 'Urban Milwaukee Events',
      url: 'https://urbanmilwaukee.com/events/',
      adapterType: 'ical',
      config: { icalUrl: 'https://urbanmilwaukee.com/events/?ical=1' },
    })
    .onConflictDoNothing({ target: schema.sources.key });
  console.log('Seeded sources: urban-milwaukee');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npm run db:seed` — Expected: `Seeded sources: urban-milwaukee`. Running twice must not error (idempotent).

- [ ] **Step 2: Write the ingest runner**

Create `src/ingestion/run.ts`:

```ts
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { icalAdapter } from '@/ingestion/adapters/ical';
import type { SourceAdapter } from '@/ingestion/adapters/types';
import { persistNormalizedEvent } from '@/ingestion/persist';

const adapters: Record<string, SourceAdapter> = {
  ical: icalAdapter,
};

function contentHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function main() {
  const key = process.argv[2];
  if (!key) {
    console.error('Usage: npm run ingest -- <source-key>');
    process.exit(1);
  }

  const source = await db.query.sources.findFirst({
    where: eq(schema.sources.key, key),
  });
  if (!source) {
    console.error(`Unknown source key: ${key}. Run npm run db:seed first.`);
    process.exit(1);
  }

  const adapter = adapters[source.adapterType];
  if (!adapter) {
    console.error(`No adapter registered for type: ${source.adapterType}`);
    process.exit(1);
  }

  try {
    const records = await adapter.fetch(source.config);
    let published = 0;
    let skipped = 0;

    for (const record of records) {
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

      const normalized = adapter.normalize(record);
      if (!normalized) {
        skipped += 1;
        continue;
      }
      await persistNormalizedEvent(db, source.id, normalized);
      published += 1;
    }

    await db
      .update(schema.sources)
      .set({ healthStatus: 'ok', lastFetchAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.sources.id, source.id));

    console.log(`${key}: ${records.length} fetched, ${published} published, ${skipped} skipped`);
  } catch (err) {
    await db
      .update(schema.sources)
      .set({ healthStatus: 'failing', updatedAt: new Date() })
      .where(eq(schema.sources.id, source.id));
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run the live ingest**

```bash
npm run ingest -- urban-milwaukee
```

Expected: a line like `urban-milwaukee: N fetched, M published, K skipped` with N > 0 and M > 0. If the feed is unreachable, verify `curl -sI 'https://urbanmilwaukee.com/events/?ical=1'` returns 200 before debugging code.

- [ ] **Step 4: Verify database state**

```bash
npx tsx -e "
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);
Promise.all([
  sql\`select count(*)::int as c from raw_events\`,
  sql\`select count(*)::int as c from events\`,
  sql\`select count(*)::int as c from event_instances\`,
  sql\`select count(*)::int as c from venues\`,
]).then(([r, e, i, v]) =>
  console.log({ raw: r[0].c, events: e[0].c, instances: i[0].c, venues: v[0].c }));
"
```

Expected: all counts > 0; `events` count equals the published count from Step 3 (first run).

- [ ] **Step 5: Verify idempotency — run ingest again**

```bash
npm run ingest -- urban-milwaukee
```

Then re-run the Step 4 count check. Expected: `events` count unchanged (no duplicates from re-ingesting).

- [ ] **Step 6: Commit**

```bash
git add src/db/seed.ts src/ingestion/run.ts
git commit -m "feat: add source seed and CLI ingest runner"
```

---

### Task 7: `/events` page and phase verification

**Files:**
- Create: `src/app/events/page.tsx`
- Create: `README.md` (overwrite scaffold README)

**Interfaces:**
- Consumes: `db` with relational queries (`eventInstances` → `event` → `venue`) from Tasks 2 and 5.
- Produces: server-rendered `/events` route listing upcoming instances grouped by day — the phase's user-visible proof.

- [ ] **Step 1: Write the page**

Create `src/app/events/page.tsx`:

```tsx
import { asc, gte } from 'drizzle-orm';
import { db } from '@/db';
import { eventInstances } from '@/db/schema';

export const dynamic = 'force-dynamic';

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: '2-digit',
});

export default async function EventsPage() {
  const instances = await db.query.eventInstances.findMany({
    where: gte(eventInstances.startAt, new Date()),
    orderBy: [asc(eventInstances.startAt)],
    limit: 100,
    with: { event: { with: { venue: true } } },
  });

  const byDay = new Map<string, typeof instances>();
  for (const instance of instances) {
    const day = dayFormatter.format(instance.startAt);
    byDay.set(day, [...(byDay.get(day) ?? []), instance]);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">MKE Events</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Upcoming Milwaukee events · powered by Radio Milwaukee
      </p>
      {instances.length === 0 && (
        <p className="mt-8 text-neutral-500">
          No upcoming events yet. Run <code>npm run ingest -- urban-milwaukee</code>.
        </p>
      )}
      {[...byDay.entries()].map(([day, dayInstances]) => (
        <section key={day} className="mt-8">
          <h2 className="border-b pb-1 text-lg font-semibold">{day}</h2>
          <ul className="mt-3 space-y-3">
            {dayInstances.map((instance) => (
              <li key={instance.id} className="flex gap-3">
                <span className="w-20 shrink-0 text-sm text-neutral-500">
                  {timeFormatter.format(instance.startAt)}
                </span>
                <span>
                  <span className="font-medium">{instance.event.title}</span>
                  {instance.event.venue && (
                    <span className="text-sm text-neutral-500">
                      {' '}
                      · {instance.event.venue.name}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 2: Verify the page renders real data**

```bash
npm run dev &
sleep 5
curl -s http://localhost:3000/events | grep -o '<h2[^>]*>[^<]*</h2>' | head -5
kill %1
```

Expected: at least one day heading (e.g., `<h2 ...>Friday, July 10</h2>`) and no error output. Also open http://localhost:3000/events in a browser and confirm events show with Chicago-local times.

- [ ] **Step 3: Write the README**

Overwrite `README.md`:

```markdown
# MKE Events (working title)

Milwaukee event discovery platform with deep Radio Milwaukee integration.

- Spec: `docs/superpowers/specs/2026-07-07-mke-events-mvp-design.md`
- Plans: `docs/superpowers/plans/`

## Setup

1. `npm install`
2. Create a Neon Postgres project; put the pooled connection string in `.env` as `DATABASE_URL`.
3. `npm run db:migrate` — apply schema
4. `npm run db:seed` — register wave-1 sources
5. `npm run ingest -- urban-milwaukee` — pull real events
6. `npm run dev` — visit http://localhost:3000/events

## Commands

| Command | Purpose |
|---|---|
| `npm run test` | Vitest unit + persistence tests (PGlite, no cloud DB needed) |
| `npm run db:generate` | Generate SQL migration from schema changes |
| `npm run db:migrate` | Apply migrations to Neon |
| `npm run ingest -- <source-key>` | Run ingestion for one source |

## Architecture (Phase 1)

Adapter fetch → `raw_events` (replayable payloads) → Zod-validated normalize → idempotent canonical upsert (`events`, `event_instances`, `venues`, `event_source_links`) → server-rendered `/events`.
```

- [ ] **Step 4: Full verification suite**

```bash
npm run test && npm run build
```

Expected: all tests pass, production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/events/page.tsx README.md
git commit -m "feat: add server-rendered upcoming events page"
```
