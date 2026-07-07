# MKE Events Phase 2b: HTML/JSON-LD Sources — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboard the six markup-based wave-1 sources (Visit Milwaukee, Milwaukee World Festival, Pabst Theater Group, County Parks, Radio Milwaukee calendar, Downtown BID) plus Brewers via the MLB Stats API, on top of a reusable HTML/JSON-LD adapter framework with fixture-capture workflow and Firecrawl fallback — and land the 2a cleanup carry-overs.

**Architecture:** A single `html` adapter driven by per-source config. Strategy `jsonld` extracts schema.org Event objects from `<script type="application/ld+json">` (works on any CMS emitting structured data); strategy `selectors` delegates to a per-source cheerio parser module; strategy `firecrawl-jsonld` fetches JS-rendered HTML through Firecrawl then reuses the JSON-LD extractor. All strategies emit the SAME flat payload contract, so one shared normalize path serves every HTML source. Fixtures are captured from live pages into `tests/fixtures/html/` and parsers are tested against them.

**Tech Stack:** Existing stack + `cheerio` (battle-tested HTML parsing). No other new runtime deps.

**Linear:** MOO-255 (continues). **Spec:** `docs/superpowers/specs/2026-07-07-mke-events-mvp-design.md`. **Follows:** Plan 2a (merged). **Precedes:** Plan 2c (dedup + Trigger.dev).

## Global Constraints

- TypeScript strict; `npm run typecheck` clean; functions ≤ 20 lines; files < 800 lines; immutability.
- Zod at every boundary; invalid records skip (normalize → null), never publish; adapters normalize ONLY from `record.payload` (replayable).
- Explicit `null` from external data is coerced to `undefined` at extraction (2a lesson); numbers guarded with finite checks.
- Secrets env-only; new env vars documented in `.env.example` (names only). Never print/commit `.env`.
- Tests on PGlite/fixtures — live network only in capture and live-verification steps. Scrape politely: `MKEEventsBot/0.1` user-agent, no parallel hammering of one host.
- **Source seeding rule (from 2a):** a source is seeded only after its live ingest publishes > 0 accurate events (3-event spot-check vs the website recorded in the report). Anything unverifiable is excluded and documented — never seed guesses.
- Sequential base for this plan is the merged main after 2a (`e012c8a` or later). Branch: `phase-2b`.

## File Structure

```
src/ingestion/adapters/helpers.ts        — requireEnv, fetchJson, fetchText, toFiniteNumber, normalizeWith (new)
src/ingestion/adapters/html/jsonld.ts    — schema.org Event extraction from HTML (new)
src/ingestion/adapters/html/payload.ts   — shared flat payload schema + normalize mapping (new)
src/ingestion/adapters/html/index.ts     — htmlAdapter (strategy dispatch) (new)
src/ingestion/adapters/html/firecrawl.ts — rendered-HTML fetch via Firecrawl API (new)
src/ingestion/adapters/html/sources/index.ts — selector-parser registry (new)
src/ingestion/adapters/html/sources/<key>.ts — per-source cheerio parsers (created as needed)
src/ingestion/adapters/mlb.ts            — MLB Stats API adapter (Brewers) (new)
src/ingestion/adapters/{ical,ticketmaster,eventbrite}.ts — refactor onto helpers (modify)
src/ingestion/adapters/registry.ts       — add 'html' + 'mlb' routing (modify)
src/lib/validation/normalized-event.ts   — description cap (modify)
src/db/seed.ts                           — onConflictDoUpdate + new sources (modify)
scripts/capture-fixture.ts               — fixture capture CLI (new)
tests/fixtures/html/<key>.html           — captured listing fixtures (created per source)
tests/ingestion/{helpers,jsonld,html-adapter,mlb-adapter}.test.ts (new)
```

---

### Task 1: Shared adapter helpers + contract/seed carry-overs

**Files:**
- Create: `src/ingestion/adapters/helpers.ts`; Test: `tests/ingestion/helpers.test.ts`
- Modify: `src/ingestion/adapters/ical.ts`, `ticketmaster.ts`, `eventbrite.ts` (refactor onto helpers), `src/lib/validation/normalized-event.ts` (description cap), `src/db/seed.ts` (upsert), `tests/ingestion/persist.test.ts` (isFree-preservation test)

**Interfaces:**
- Produces (every later task uses these):
  - `requireEnv(name: string, hint: string): string` — throws `` `${name} is not set — ${hint}` `` when missing.
  - `fetchJson(url: URL | string, init: RequestInit, label: string): Promise<unknown>` and `fetchText(url: URL | string, label: string): Promise<string>` — bot user-agent merged in, non-OK → throw `` `${label} fetch failed (${status})` ``.
  - `toFiniteNumber(value: unknown): number | undefined` — null/undefined/NaN/garbage → undefined.
  - `normalizeWith<T>(payloadSchema: z.ZodType<T>, map: (p: T) => unknown): (record: FetchedRecord) => NormalizedEvent | null` — the shared safeParse→map→safeParse ceremony.
  - `MAX_DESCRIPTION_LENGTH = 10_000`; NormalizedEvent descriptions longer than that are truncated (not rejected).
  - Seed upserts: re-running `db:seed` after a config/url/name change UPDATES the existing source row.

- [ ] **Step 1: Write failing helper tests**

Create `tests/ingestion/helpers.test.ts`:

```ts
import { describe, expect, test, vi, afterEach } from 'vitest';
import { z } from 'zod';
import {
  fetchJson,
  normalizeWith,
  requireEnv,
  toFiniteNumber,
} from '@/ingestion/adapters/helpers';

afterEach(() => vi.unstubAllGlobals());

describe('requireEnv', () => {
  test('returns value when set, throws with hint when missing', () => {
    vi.stubEnv('HELPER_TEST_VAR', 'abc');
    expect(requireEnv('HELPER_TEST_VAR', 'get one at example.com')).toBe('abc');
    vi.unstubAllEnvs();
    expect(() => requireEnv('HELPER_TEST_VAR_MISSING', 'get one at example.com')).toThrow(
      'HELPER_TEST_VAR_MISSING is not set — get one at example.com',
    );
  });
});

describe('toFiniteNumber', () => {
  test('coerces finite values, rejects null/garbage/NaN', () => {
    expect(toFiniteNumber('43.05')).toBeCloseTo(43.05);
    expect(toFiniteNumber(7)).toBe(7);
    expect(toFiniteNumber(null)).toBeUndefined();
    expect(toFiniteNumber(undefined)).toBeUndefined();
    expect(toFiniteNumber('not-a-number')).toBeUndefined();
    expect(toFiniteNumber('')).toBeUndefined();
  });
});

describe('fetchJson', () => {
  test('throws labeled error on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchJson('https://x.test/api', {}, 'TestSource')).rejects.toThrow(
      'TestSource fetch failed (503)',
    );
  });
});

describe('normalizeWith', () => {
  const payload = z.object({ id: z.string(), title: z.string(), start: z.string() });
  const normalize = normalizeWith(payload, (p) => ({
    sourceEventId: p.id,
    title: p.title,
    startAt: p.start,
  }));
  test('maps valid payloads and rejects invalid ones as null', () => {
    const good = normalize({
      sourceEventId: 'a',
      payload: { id: 'a', title: 'Show', start: '2026-08-01T00:00:00.000Z' },
    });
    expect(good?.title).toBe('Show');
    expect(normalize({ sourceEventId: 'b', payload: { junk: true } })).toBeNull();
  });
});
```

Run: `npm run test -- tests/ingestion/helpers.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 2: Implement helpers**

Create `src/ingestion/adapters/helpers.ts`:

```ts
import { z } from 'zod';
import { normalizedEventSchema, type NormalizedEvent } from '@/lib/validation/normalized-event';
import type { FetchedRecord } from './types';

const BOT_UA = 'MKEEventsBot/0.1 (event aggregation; Milwaukee, WI)';

export function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — ${hint}`);
  return value;
}

export function toFiniteNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function fetchOk(url: URL | string, init: RequestInit, label: string): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': BOT_UA, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${label} fetch failed (${res.status})`);
  return res;
}

export async function fetchJson(
  url: URL | string,
  init: RequestInit,
  label: string,
): Promise<unknown> {
  return (await fetchOk(url, init, label)).json();
}

export async function fetchText(url: URL | string, label: string): Promise<string> {
  return (await fetchOk(url, {}, label)).text();
}

export function normalizeWith<T>(
  payloadSchema: z.ZodType<T>,
  map: (p: T) => unknown,
): (record: FetchedRecord) => NormalizedEvent | null {
  return (record) => {
    const parsed = payloadSchema.safeParse(record.payload);
    if (!parsed.success) return null;
    const result = normalizedEventSchema.safeParse(map(parsed.data));
    return result.success ? result.data : null;
  };
}
```

Run: `npm run test -- tests/ingestion/helpers.test.ts` — Expected: all pass. Commit:

```bash
git add src/ingestion/adapters/helpers.ts tests/ingestion/helpers.test.ts
git commit -m "feat: add shared adapter helpers"
```

- [ ] **Step 3: Refactor the three existing adapters onto the helpers**

Mechanical, behavior-preserving; the existing suites are the safety net:
- `ical.ts`: replace the inline fetch/error block with `fetchText(icalUrl, 'iCal')` (keep parse logic unchanged).
- `ticketmaster.ts`: `requireApiKey()` → `requireEnv('TICKETMASTER_API_KEY', 'register at developer.ticketmaster.com')`; `fetchPage`'s fetch/!ok/json → `fetchJson(url, {}, \`Ticketmaster page ${pageNumber}\`)`; lat/lng ternaries → `toFiniteNumber(...)`; `normalize` → `normalizeWith(payloadSchema, (p) => ({ ...same mapping object... }))` (keep `mapStatus` local — status vocabularies are source-specific).
- `eventbrite.ts`: same treatment (`requireEnv('EVENTBRITE_PRIVATE_TOKEN', 'create one at eventbrite.com/platform')`, `fetchJson`, `toFiniteNumber`, `normalizeWith`).

Behavior deltas allowed: error message text may change to the helper format — update any test asserting the old text. Nothing else changes.

Run: `npm run test && npm run typecheck` — Expected: all pass (error-text assertions updated if needed). Commit:

```bash
git add src/ingestion/adapters/ tests/
git commit -m "refactor: adapters share requireEnv/fetchJson/toFiniteNumber/normalizeWith"
```

- [ ] **Step 4: Description cap + isFree-preservation test (TDD)**

Add failing tests first. In `tests/ingestion/normalized-event.test.ts`:

```ts
  test('truncates description beyond 10k chars instead of rejecting', () => {
    const result = normalizedEventSchema.parse({
      sourceEventId: 'x',
      title: 'Long Desc',
      startAt: '2026-07-11T00:00:00.000Z',
      description: 'a'.repeat(20_000),
    });
    expect(result.description).toHaveLength(10_000);
  });
```

In `tests/ingestion/persist.test.ts`:

```ts
  test('re-ingest without isFree preserves the previously stored value', async () => {
    const db = await createTestDb();
    const source = await seedSource(db);
    const ref = { id: source.id, key: 'test' };
    await persistNormalizedEvent(db, ref, { ...sample, isFree: true });
    await persistNormalizedEvent(db, ref, sample); // sample has no isFree
    const [event] = await db.query.events.findMany();
    expect(event.isFree).toBe(true);
  });
```

Run both — Expected: description test FAILS (currently passes through untruncated). Then in `src/lib/validation/normalized-event.ts`:

```ts
export const MAX_DESCRIPTION_LENGTH = 10_000;
```

and change the description field to:

```ts
    description: z
      .string()
      .transform((s) => s.slice(0, MAX_DESCRIPTION_LENGTH))
      .optional(),
```

Run: `npm run test` — Expected: all pass (isFree test should pass immediately, pinning Drizzle's skip-undefined behavior; if it fails, that's a real bug — investigate, don't delete the test). Commit:

```bash
git add src/lib/validation/normalized-event.ts tests/
git commit -m "feat: cap description length; pin isFree preservation on partial update"
```

- [ ] **Step 5: Seed upsert-on-conflict**

In `src/db/seed.ts`, replace the insert with:

```ts
import { sql } from 'drizzle-orm';
```

```ts
    await db
      .insert(schema.sources)
      .values(source)
      .onConflictDoUpdate({
        target: schema.sources.key,
        set: {
          name: sql`excluded.name`,
          url: sql`excluded.url`,
          adapterType: sql`excluded.adapter_type`,
          config: sql`excluded.config`,
          updatedAt: new Date(),
        },
      });
```

Verify against PGlite by adding to `tests/ingestion/ingest.test.ts` a short test that inserts a source row twice via the same upsert shape with a changed config and asserts the config updated (import the statement shape inline — the seed script itself stays a script). Run `npm run test && npm run typecheck`. Commit:

```bash
git add src/db/seed.ts tests/ingestion/ingest.test.ts
git commit -m "feat: seed updates existing source configs on conflict"
```

---

### Task 2: HTML adapter framework (JSON-LD + selector strategies)

**Files:**
- Create: `src/ingestion/adapters/html/jsonld.ts`, `src/ingestion/adapters/html/payload.ts`, `src/ingestion/adapters/html/sources/index.ts`, `src/ingestion/adapters/html/index.ts`, `scripts/capture-fixture.ts`, `tests/fixtures/html/jsonld-sample.html`
- Modify: `src/ingestion/adapters/registry.ts` (route 'html'), `package.json` (cheerio dep + capture script)
- Test: `tests/ingestion/jsonld.test.ts`, `tests/ingestion/html-adapter.test.ts`

**Interfaces:**
- Consumes: helpers from Task 1.
- Produces:
  - `htmlPayloadSchema` + `type HtmlEventPayload` in `payload.ts` — the flat contract EVERY html-class strategy emits: `{ id: string, name: string, description?, url?, startDate: string, endDate?, status?, venueName?, venueAddress?, venueLat?: number, venueLng?: number, imageUrl?, isFree?: boolean }`; plus `normalizeHtmlRecord = normalizeWith(htmlPayloadSchema, ...)` mapping `status` values `cancelled`/`postponed`/anything-else → NormalizedEvent status.
  - `extractJsonLdEvents(html: string, baseUrl: string): FetchedRecord[]` in `jsonld.ts` — schema.org Event nodes (incl. `@graph`, arrays, Event subtypes like MusicEvent/TheaterEvent/Festival), null-coerced, finite-guarded, deduped by sourceEventId.
  - `selectorParsers: Record<string, (html: string, baseUrl: string) => FetchedRecord[]>` in `sources/index.ts` (starts empty).
  - `htmlAdapter: SourceAdapter` in `html/index.ts` — config `{ strategy: 'jsonld' | 'selectors', listingUrls: string[] (min 1), sourceKey: string }`; fetches each listing URL sequentially with `fetchText`, dispatches by strategy, concatenates + dedupes.
  - Registry: `adapterType: 'html'` → `htmlAdapter`.
  - `npm run capture:fixture -- <key> <url>` writes `tests/fixtures/html/<key>.html`.

- [ ] **Step 1: Install cheerio, add capture script**

```bash
npm install cheerio
```

Create `scripts/capture-fixture.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const [key, url] = process.argv.slice(2);
  if (!key || !url) {
    console.error('Usage: npm run capture:fixture -- <source-key> <listing-url>');
    process.exit(1);
  }
  const res = await fetch(url, {
    headers: { 'user-agent': 'MKEEventsBot/0.1 (event aggregation; Milwaukee, WI)' },
  });
  if (!res.ok) throw new Error(`capture failed (${res.status}) for ${url}`);
  const dir = join(process.cwd(), 'tests/fixtures/html');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${key}.html`);
  writeFileSync(file, await res.text());
  console.log(`wrote ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Add to package.json scripts: `"capture:fixture": "tsx scripts/capture-fixture.ts"`.

- [ ] **Step 2: Create the synthetic JSON-LD fixture**

Create `tests/fixtures/html/jsonld-sample.html`:

```html
<!DOCTYPE html>
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "MusicEvent",
      "name": "Jazz at the Vine",
      "description": "Outdoor jazz series.",
      "url": "https://example.com/events/jazz-at-the-vine",
      "startDate": "2026-08-06T18:00:00-05:00",
      "endDate": "2026-08-06T21:00:00-05:00",
      "eventStatus": "https://schema.org/EventScheduled",
      "image": ["https://example.com/jazz.jpg"],
      "location": {
        "@type": "Place",
        "name": "Villa Terrace",
        "address": { "@type": "PostalAddress", "streetAddress": "2220 N Terrace Ave", "addressLocality": "Milwaukee", "addressRegion": "WI" },
        "geo": { "@type": "GeoCoordinates", "latitude": "43.0521", "longitude": "-87.8845" }
      },
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
    },
    {
      "@type": "Event",
      "name": "Cancelled Gala",
      "url": "https://example.com/events/cancelled-gala",
      "startDate": "2026-09-01T19:00:00-05:00",
      "eventStatus": "https://schema.org/EventCancelled",
      "location": "Grain Exchange",
      "description": null
    },
    { "@type": "WebPage", "name": "Not an event" }
  ]
}
</script>
<script type="application/ld+json">{ "malformed": </script>
</head><body>
<script type="application/ld+json">
[{ "@type": "TheaterEvent", "name": "No Date Show", "url": "https://example.com/events/no-date" }]
</script>
</body></html>
```

- [ ] **Step 3: Write failing JSON-LD extractor tests**

Create `tests/ingestion/jsonld.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { extractJsonLdEvents } from '@/ingestion/adapters/html/jsonld';
import { normalizeHtmlRecord } from '@/ingestion/adapters/html/payload';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/html/jsonld-sample.html'), 'utf8');
const records = extractJsonLdEvents(html, 'https://example.com/events/');

describe('extractJsonLdEvents', () => {
  test('extracts Event subtypes from @graph and arrays, ignores non-events and malformed blocks', () => {
    expect(records.map((r) => r.sourceEventId)).toEqual([
      'https://example.com/events/jazz-at-the-vine',
      'https://example.com/events/cancelled-gala',
      'https://example.com/events/no-date',
    ]);
  });

  test('maps place, geo, offers, and image into the flat payload', () => {
    const p = records[0].payload as Record<string, unknown>;
    expect(p.name).toBe('Jazz at the Vine');
    expect(p.venueName).toBe('Villa Terrace');
    expect(p.venueAddress).toBe('2220 N Terrace Ave, Milwaukee, WI');
    expect(p.venueLat).toBeCloseTo(43.0521);
    expect(p.imageUrl).toBe('https://example.com/jazz.jpg');
    expect(p.isFree).toBe(true);
    expect(p.startDate).toBe('2026-08-06T18:00:00-05:00');
  });

  test('coerces explicit null to undefined and handles string locations', () => {
    const p = records[1].payload as Record<string, unknown>;
    expect(p.description).toBeUndefined();
    expect(p.venueName).toBe('Grain Exchange');
    expect(p.status).toBe('cancelled');
  });
});

describe('normalizeHtmlRecord', () => {
  test('normalizes a complete record with Chicago-offset time', () => {
    const n = normalizeHtmlRecord(records[0]);
    expect(n?.title).toBe('Jazz at the Vine');
    expect(n?.startAt.toISOString()).toBe('2026-08-06T23:00:00.000Z');
    expect(n?.isFree).toBe(true);
    expect(n?.status).toBe('scheduled');
  });

  test('skips records without a start date', () => {
    expect(normalizeHtmlRecord(records[2])).toBeNull();
  });

  test('maps cancelled status', () => {
    expect(normalizeHtmlRecord(records[1])?.status).toBe('cancelled');
  });
});
```

Run: `npm run test -- tests/ingestion/jsonld.test.ts` — Expected: FAIL, modules not found.

- [ ] **Step 4: Implement payload contract and JSON-LD extractor**

Create `src/ingestion/adapters/html/payload.ts`:

```ts
import { z } from 'zod';
import { normalizeWith } from '../helpers';

export const htmlPayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().optional(),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  status: z.string().optional(),
  venueName: z.string().optional(),
  venueAddress: z.string().optional(),
  venueLat: z.number().optional(),
  venueLng: z.number().optional(),
  imageUrl: z.string().optional(),
  isFree: z.boolean().optional(),
});

export type HtmlEventPayload = z.infer<typeof htmlPayloadSchema>;

function mapStatus(status: string | undefined): 'scheduled' | 'cancelled' | 'postponed' {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'postponed') return 'postponed';
  return 'scheduled';
}

export const normalizeHtmlRecord = normalizeWith(htmlPayloadSchema, (p) => ({
  sourceEventId: p.id,
  title: p.name,
  description: p.description,
  url: p.url,
  imageUrl: p.imageUrl,
  venueName: p.venueName,
  venueAddress: p.venueAddress,
  venueLat: p.venueLat,
  venueLng: p.venueLng,
  startAt: p.startDate,
  endAt: p.endDate,
  isFree: p.isFree,
  status: mapStatus(p.status),
}));
```

Create `src/ingestion/adapters/html/jsonld.ts`:

```ts
import * as cheerio from 'cheerio';
import { toFiniteNumber } from '../helpers';
import type { FetchedRecord } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */

function flattenNodes(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed.flatMap(flattenNodes);
  if (parsed && typeof parsed === 'object') {
    const graph = parsed['@graph'];
    return Array.isArray(graph) ? [parsed, ...graph.flatMap(flattenNodes)] : [parsed];
  }
  return [];
}

function isEventNode(node: any): boolean {
  const raw = node?.['@type'];
  const types: unknown[] = Array.isArray(raw) ? raw : [raw];
  return types.some(
    (t) => typeof t === 'string' && (t === 'Event' || t === 'Festival' || t.endsWith('Event')),
  );
}

function mapEventStatus(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.includes('EventCancelled')) return 'cancelled';
  if (value.includes('EventPostponed') || value.includes('EventRescheduled')) return 'postponed';
  return undefined;
}

function placeFields(location: any) {
  if (typeof location === 'string') return { venueName: location };
  if (!location || typeof location !== 'object') return {};
  const a = location.address;
  const addressParts =
    typeof a === 'string'
      ? [a]
      : [a?.streetAddress, a?.addressLocality, a?.addressRegion].filter(Boolean);
  return {
    venueName: typeof location.name === 'string' ? location.name : undefined,
    venueAddress: addressParts.length > 0 ? addressParts.join(', ') : undefined,
    venueLat: toFiniteNumber(location.geo?.latitude),
    venueLng: toFiniteNumber(location.geo?.longitude),
  };
}

function imageUrl(image: any): string | undefined {
  const first = Array.isArray(image) ? image[0] : image;
  if (typeof first === 'string') return first;
  return typeof first?.url === 'string' ? first.url : undefined;
}

function offerIsFree(offers: any): boolean | undefined {
  const first = Array.isArray(offers) ? offers[0] : offers;
  const price = toFiniteNumber(first?.price ?? first?.lowPrice);
  return price === undefined ? undefined : price === 0;
}

function nodeToRecord(node: any, baseUrl: string): FetchedRecord | null {
  const name = typeof node.name === 'string' ? node.name : undefined;
  if (!name) return null;
  const url = typeof node.url === 'string' ? new URL(node.url, baseUrl).toString() : undefined;
  const id = url ?? (typeof node['@id'] === 'string' ? node['@id'] : `${name}|${node.startDate ?? ''}`);
  return {
    sourceEventId: id,
    sourceUrl: url,
    payload: {
      id,
      name,
      description: typeof node.description === 'string' ? node.description : undefined,
      url,
      startDate: typeof node.startDate === 'string' ? node.startDate : undefined,
      endDate: typeof node.endDate === 'string' ? node.endDate : undefined,
      status: mapEventStatus(node.eventStatus),
      ...placeFields(node.location),
      imageUrl: imageUrl(node.image),
      isFree: offerIsFree(node.offers),
    },
  };
}

export function extractJsonLdEvents(html: string, baseUrl: string): FetchedRecord[] {
  const $ = cheerio.load(html);
  const records: FetchedRecord[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    for (const node of flattenNodes(parsed)) {
      if (!isEventNode(node)) continue;
      const record = nodeToRecord(node, baseUrl);
      if (record) records.push(record);
    }
  });
  const seen = new Set<string>();
  return records.filter((r) => (seen.has(r.sourceEventId) ? false : seen.add(r.sourceEventId)));
}
```

NOTE: `payload.startDate` may be `undefined` here (the "No Date Show" case) — that is intentional: the payload schema requires it, so `normalizeHtmlRecord` returns null and the record counts as skipped, matching the pipeline's skip semantics.

Run: `npm run test -- tests/ingestion/jsonld.test.ts` — Expected: all pass.

- [ ] **Step 5: Implement the html adapter + registry routing (failing test first)**

Create `tests/ingestion/html-adapter.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { htmlAdapter } from '@/ingestion/adapters/html';
import { resolveAdapter } from '@/ingestion/adapters/registry';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/html/jsonld-sample.html'), 'utf8');

afterEach(() => vi.unstubAllGlobals());

describe('htmlAdapter', () => {
  test('jsonld strategy fetches each listing url and extracts events', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html });
    vi.stubGlobal('fetch', mockFetch);
    const records = await htmlAdapter.fetch({
      strategy: 'jsonld',
      listingUrls: ['https://example.com/events/'],
      sourceKey: 'sample',
    });
    expect(records).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('unknown selector parser throws a clear error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => html }));
    await expect(
      htmlAdapter.fetch({
        strategy: 'selectors',
        listingUrls: ['https://example.com/'],
        sourceKey: 'nonexistent',
      }),
    ).rejects.toThrow('No selector parser registered for source: nonexistent');
  });

  test('registry routes html adapterType', () => {
    expect(resolveAdapter({ adapterType: 'html', config: {} }).adapterType).toBe('html');
  });
});
```

Run — Expected: FAIL. Then create `src/ingestion/adapters/html/sources/index.ts`:

```ts
import type { FetchedRecord } from '../../types';

export type SelectorParser = (html: string, baseUrl: string) => FetchedRecord[];

export const selectorParsers: Record<string, SelectorParser> = {};
```

Create `src/ingestion/adapters/html/index.ts`:

```ts
import { z } from 'zod';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { fetchText } from '../helpers';
import type { FetchedRecord, SourceAdapter } from '../types';
import { extractJsonLdEvents } from './jsonld';
import { normalizeHtmlRecord } from './payload';
import { selectorParsers } from './sources';

const configSchema = z.object({
  strategy: z.enum(['jsonld', 'selectors']),
  listingUrls: z.array(z.string().url()).min(1),
  sourceKey: z.string().min(1),
});

function parseListing(
  config: z.infer<typeof configSchema>,
  html: string,
  url: string,
): FetchedRecord[] {
  if (config.strategy === 'jsonld') return extractJsonLdEvents(html, url);
  const parser = selectorParsers[config.sourceKey];
  if (!parser) throw new Error(`No selector parser registered for source: ${config.sourceKey}`);
  return parser(html, url);
}

function dedupe(records: FetchedRecord[]): FetchedRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => (seen.has(r.sourceEventId) ? false : seen.add(r.sourceEventId)));
}

export const htmlAdapter: SourceAdapter = {
  adapterType: 'html',

  async fetch(rawConfig: unknown): Promise<FetchedRecord[]> {
    const config = configSchema.parse(rawConfig);
    const all: FetchedRecord[] = [];
    for (const url of config.listingUrls) {
      const html = await fetchText(url, `HTML listing ${url}`);
      all.push(...parseListing(config, html, url));
    }
    return dedupe(all);
  },

  normalize(record: FetchedRecord): NormalizedEvent | null {
    return normalizeHtmlRecord(record);
  },
};
```

In `src/ingestion/adapters/registry.ts`, import `htmlAdapter` and add before the throw:

```ts
  if (source.adapterType === 'html') return htmlAdapter;
```

Run: `npm run test && npm run typecheck` — Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ingestion/adapters/html/ src/ingestion/adapters/registry.ts scripts/ tests/ package.json package-lock.json
git commit -m "feat: add HTML adapter framework with JSON-LD and selector strategies"
```

---

### Task 3: Firecrawl fallback strategy

**Files:**
- Create: `src/ingestion/adapters/html/firecrawl.ts`
- Modify: `src/ingestion/adapters/html/index.ts` (add strategy), `.env.example` (FIRECRAWL_API_KEY)
- Test: extend `tests/ingestion/html-adapter.test.ts`

**Interfaces:**
- Produces: html adapter strategy `'firecrawl-jsonld'` — fetches rendered HTML through Firecrawl's scrape API, then reuses `extractJsonLdEvents`. `fetchRenderedHtml(url: string): Promise<string>` exported from `firecrawl.ts`; requires `FIRECRAWL_API_KEY` via `requireEnv`.

- [ ] **Step 1: Failing test**

Append to `tests/ingestion/html-adapter.test.ts`:

```ts
  test('firecrawl-jsonld strategy posts to Firecrawl and parses rendered html', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc-test');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { html } }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const records = await htmlAdapter.fetch({
      strategy: 'firecrawl-jsonld',
      listingUrls: ['https://example.com/events/'],
      sourceKey: 'sample',
    });
    expect(records).toHaveLength(3);
    const [calledUrl, init] = mockFetch.mock.calls[0];
    expect(String(calledUrl)).toContain('api.firecrawl.dev');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer fc-test');
    vi.unstubAllEnvs();
  });
```

Run — Expected: FAIL (unknown strategy).

- [ ] **Step 2: Implement**

Create `src/ingestion/adapters/html/firecrawl.ts`:

```ts
import { z } from 'zod';
import { fetchJson, requireEnv } from '../helpers';

const responseSchema = z.object({
  success: z.boolean(),
  data: z.object({ html: z.string() }),
});

export async function fetchRenderedHtml(url: string): Promise<string> {
  const apiKey = requireEnv('FIRECRAWL_API_KEY', 'get one at firecrawl.dev');
  const raw = await fetchJson(
    'https://api.firecrawl.dev/v1/scrape',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url, formats: ['html'] }),
    },
    `Firecrawl scrape ${url}`,
  );
  const parsed = responseSchema.parse(raw);
  if (!parsed.success) throw new Error(`Firecrawl scrape unsuccessful for ${url}`);
  return parsed.data.html;
}
```

In `html/index.ts`: extend the enum to `z.enum(['jsonld', 'selectors', 'firecrawl-jsonld'])`; in `fetch`, choose the HTML getter per strategy:

```ts
      const html =
        config.strategy === 'firecrawl-jsonld'
          ? await fetchRenderedHtml(url)
          : await fetchText(url, `HTML listing ${url}`);
```

and in `parseListing`, treat `'firecrawl-jsonld'` the same as `'jsonld'` (both call `extractJsonLdEvents`).

NOTE: if Firecrawl's current API shape differs (endpoint version or response envelope), verify against docs.firecrawl.dev and adapt `firecrawl.ts` + the test mock together; record the actual shape in your report.

- [ ] **Step 3: Verify, document env var, commit**

Append to `.env.example`:

```
# Firecrawl API key (firecrawl.dev) — only needed for JS-rendered sources
FIRECRAWL_API_KEY=
```

Run: `npm run test && npm run typecheck` — Expected: all pass.

```bash
git add src/ingestion/adapters/html/ tests/ .env.example
git commit -m "feat: add firecrawl-jsonld fallback strategy"
```

---

## Source Onboarding Protocol (applies to Tasks 4–9)

Each source task follows this exact protocol. "The website" means the task's listing URL(s).

1. **Capture:** `npm run capture:fixture -- <key> <listing-url>` (repeat per listing URL, suffixing the key if multiple). If capture fails (403/blocked), note it and try the Firecrawl path (step 4).
2. **WordPress shortcut check:** if the page is WordPress/The Events Calendar (look for `tribe-events` markers or `wp-content` + events plugin), FIRST try `curl -s '<events-url>?ical=1' | head -3` — if it returns `BEGIN:VCALENDAR`, register the source with the existing `ical` adapter instead (config `{ icalUrl }`), skip parser work entirely, and note the shortcut in your report.
3. **JSON-LD check:** `grep -c 'application/ld+json' tests/fixtures/html/<key>.html` and inspect whether Event nodes with startDate exist (a 5-line node script or grep for `"@type"\s*:\s*"[A-Za-z]*Event"` is fine). If yes → strategy `jsonld`. Write a fixture test in `tests/ingestion/sources-<key>.test.ts` asserting `extractJsonLdEvents(fixtureHtml, '<listing-url>')` yields ≥ the expected count with sane first-record fields (name, startDate present).
4. **JS-rendered check:** if the captured HTML contains no event data at all (client-rendered app shell), the strategy is `firecrawl-jsonld` — but ONLY if `FIRECRAWL_API_KEY` is set in `.env`. Without the key, DO NOT seed the source; record it as "deferred — needs FIRECRAWL_API_KEY" in your report and move on.
5. **Selector parser (last resort):** if HTML has event data but no JSON-LD, create `src/ingestion/adapters/html/sources/<key>.ts` exporting a `SelectorParser` that emits `htmlPayloadSchema`-shaped payloads (id = absolute detail URL; dates must include enough info to build an ISO string — if the listing only shows partial dates, parse what's there and document assumptions). Register it in `sources/index.ts`. Fixture test proving ≥ expected count and correct first-record field mapping. Functions ≤ 20 lines — split helpers as needed.
6. **Seed + live verify:** add the source to `src/db/seed.ts` (the Task 1 upsert makes re-seeding safe), `npm run db:seed`, `npm run ingest -- <key>`. Must publish > 0. Spot-check 3 published events against the website (title/time/venue) and record the comparison in your report. Re-run ingest; counts must not grow (idempotency).
7. **Full verification:** `npm run test && npm run typecheck` clean. Commit: `feat: onboard <key> source (<strategy>)`.

A source that cannot pass step 6 accurately gets unseeded (remove from seed.ts before commit), documented as excluded-with-reason. Honest exclusion beats bad data.

---

### Task 4: Onboard `radio-milwaukee` (station's own calendar — do this one first)

- Listing: `https://radiomilwaukee.org/community-calendar` (WordPress — step 2 shortcut is LIKELY to hit: try `https://radiomilwaukee.org/community-calendar/?ical=1` and `https://radiomilwaukee.org/events/?ical=1`).
- [ ] Follow the protocol. Expected outcome: ical shortcut or jsonld. Station events matter for the `is_station_event` flag later — note in your report (do NOT implement flagging; that's a later plan).

### Task 5: Onboard `pabst-theater-group`

- Listing: `https://www.pabsttheatergroup.com/events` (covers Pabst Theater, Riverside, Turner Hall, Miller High Life Theatre, Vivarium, The Fitzgerald).
- [ ] Follow the protocol. Venue sites of this class usually emit Event JSON-LD; expect strategy `jsonld`. Expected volume: dozens of events.

### Task 6: Onboard `visit-milwaukee`

- Listing: `https://www.visitmilwaukee.org/events/` (SimpleView CMS).
- [ ] Follow the protocol. SimpleView listings are often JS-rendered (step 4 → firecrawl-jsonld) BUT frequently expose an internal JSON endpoint — before falling back to Firecrawl, grep the captured HTML for `/includes/rest` or `plugins/core/get_simple_view` style URLs; if a public JSON listing endpoint exists, note it in your report and ask the controller whether to build it as an `api`-class custom adapter instead (NEEDS_CONTEXT with your findings). Highest-volume source in wave 1.

### Task 7: Onboard `milwaukee-world-festival`

- Listing: `https://www.milwaukeeworldfestival.com/find-events/calendar` (Summerfest grounds + ethnic festivals).
- [ ] Follow the protocol.

### Task 8: Onboard `county-parks`

- Listing: `https://county.milwaukee.gov/EN/Parks/Experience/Events-Calendar` (200+ free summer concerts).
- [ ] Follow the protocol. Government CMS — selector parser is the likely outcome; event data may live on a sub-calendar system (inspect links in the fixture before assuming).

### Task 9: Onboard `milwaukee-downtown`

- Listing: `https://www.milwaukeedowntown.com/signature-events/` (BID #21).
- [ ] Follow the protocol. Small event count is expected (signature events only); > 0 published still required.

---

### Task 10: Brewers via MLB Stats API

**Files:**
- Create: `src/ingestion/adapters/mlb.ts`, `tests/fixtures/mlb-schedule.json`
- Modify: `src/ingestion/adapters/registry.ts` (api adapter 'mlb'), `src/db/seed.ts`
- Test: `tests/ingestion/mlb-adapter.test.ts`

**Interfaces:**
- Produces: `mlbAdapter: SourceAdapter` (adapterType 'api', registry key 'mlb'). Config: `{ adapter: 'mlb', teamId: number (158 = Brewers), daysAhead: number (default 120), homeOnly: boolean (default true) }`. No API key (MLB Stats API is public). Fetch: `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=<teamId>&startDate=<today>&endDate=<today+daysAhead>` using `fetchJson`. Flat payload per game: `{ gamePk: string, title: string ("Brewers vs <away>" for home games), gameDateUtc: string, venueName?: string, detailedState?: string, homeGame: boolean }`; when `homeOnly`, away games are filtered at extraction. Status: detailedState containing 'Postponed' → postponed, 'Cancelled' → cancelled, else scheduled. sourceEventId = String(gamePk).

- [ ] **Step 1: Fixture.** Capture a real slice: `curl -s 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=158&startDate=2026-07-08&endDate=2026-07-21' > tests/fixtures/mlb-schedule.json` — then trim to ≤ 4 games (keep at least one home and one away game; hand-edit one game's `status.detailedState` to `"Postponed"`). Record the actual JSON shape you observed in your report if it differs from the interface above — adapt the payload schema to reality, keeping the produced flat-payload contract.
- [ ] **Step 2: Failing tests** in `tests/ingestion/mlb-adapter.test.ts`: extraction (home-only filter works, away game excluded; gamePk as sourceEventId; title format), normalize (scheduled + postponed mapping, venueName mapped). Model on the ticketmaster test structure with the fixture.
- [ ] **Step 3: Implement** `src/ingestion/adapters/mlb.ts` with `extractMlbRecords(page, homeOnly)` pure helper + `normalizeWith`-based normalize; register in `registry.ts` `apiAdapters` map as `mlb`; extend the registry's api config enum to `['ticketmaster', 'eventbrite', 'mlb']`.
- [ ] **Step 4: Seed + live verify** per protocol step 6 (key `brewers`, name `Milwaukee Brewers (home games)`, url `https://www.mlb.com/brewers/schedule`). Run ingest live — MLB Stats API needs no key, so this MUST run and publish > 0 (in-season). Spot-check 3 games vs mlb.com schedule.
- [ ] **Step 5: Full verification + commit:** `feat: add MLB Stats API adapter for Brewers home games`.

---

### Task 11: Wave-1 closeout — full sweep, README, evidence

- [ ] **Step 1: Full live sweep.** Run `npm run ingest -- <key>` for EVERY seeded source (feed + html + mlb; API sources only if credentials now exist). Record every count line.
- [ ] **Step 2: Totals + idempotency.** Run the per-source/totals count script (same as 2a Task 5 Step 4), then re-run two sources and re-count — totals unchanged. Record both snapshots.
- [ ] **Step 3: README.** Update the source table to the full seeded set with strategies; move excluded/deferred sources into a short "Deferred sources" note with reasons.
- [ ] **Step 4: Full verification:** `npm run test && npm run typecheck && npm run build` all pass.
- [ ] **Step 5: Commit:** `docs: update source registry for wave-1 HTML/API coverage (MOO-255)`.

---

## Deferred sources

- **Shepherd Express** (City Spark platform): its RSS is a nonstandard article feed, not structured event data. Deferred to the post-2c source backlog; revisit as an html-class source once City Spark's markup is captured and inspected. Recorded here so it isn't silently dropped from wave 1.

## Deferred to Plan 2c (unchanged)

Dedup (clusters, trigram scoring, canonical selection, review queue), Trigger.dev scheduling (near-term/distant cadence, backoff, **per-source concurrency decision re: the same-source link race**), source-aware supersede if dedup consolidates instances, partial-skip observability, raw_events retention policy.
