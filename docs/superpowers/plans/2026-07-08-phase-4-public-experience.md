# Phase 4: Public Experience — RetroUI, SEO, Station Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close MOO-257: the public product — a distinctive neobrutalist site in the Radio Milwaukee design language (Tarik's mockup at `/Users/tarikmoody/Documents/Projects/mke-events` is the design contract), full public route map with event detail + add-to-calendar, station integration (mini-player, staff picks, newsletter + digest, station-event prominence), SEO layer (JSON-LD, split sitemaps, canonicals, internal links), and Playwright E2E for the five MOO-257 flows.

**Architecture:** RetroUI (retroui.dev, shadcn-registry vendored components, Tailwind v4 CSS-variable theming — repo is already Tailwind v4) themed to the Radio Milwaukee tokens; custom components (EventCard, MiniPlayer, Marquee, chips) transcribed from the mockup, which is more specific than any library block. Search/browse pipeline stays untouched except four surgical upgrades (slug tiebreak, tonight dead-zone, free-word mapping, custom date range); pages get card data via a **hydration loader** (`loadCardMeta` by event IDs) so the eval-baselined search SQL is never widened. New data: `staff_picks`, `newsletter_subscribers`, `venues.slug`, curated venue→neighborhood assignment, decision-gated `is_station_event` heuristic writer. Mini-player is a client component mounted in the **root layout above `{children}`** so App Router navigation never unmounts it.

**Tech Stack:** Next.js 16.2.10 App Router / React 19.2.4 / Tailwind v4 (`@import "tailwindcss"`, `@theme inline`) / RetroUI via shadcn CLI / Drizzle 0.45.2 / Neon HTTP (no transactions) / next/font local (Sidewalk Block, Aktiv Grotesk) + Google (Caveat) / Zod 4 / Vitest 4 + PGlite / Playwright (new).

## Global Constraints

Every task's requirements implicitly include all of these:

- Logic functions ≤ 20 lines; JSX render components may run longer but extract logic helpers. Files focused (≤ ~300 lines; split rather than grow).
- All timestamps timestamptz. **ANY date logic — including display formatting — goes through `src/lib/chicago-time.ts` helpers or an `Intl.DateTimeFormat` with explicit `timeZone: 'America/Chicago'`.** Never `toLocaleString()` without a timezone, never server-local time. This has shipped 3+ UTC-vs-Chicago bugs; zero tolerance.
- Hydration safety: no client component renders time-dependent or random values differently between server and client. Time labels are computed server-side and passed as props, or rendered inside client components only after mount.
- Zod at every boundary: searchParams, server-action inputs (newsletter email), route-handler params, seed-CLI args.
- Secrets env-only. New public env: `NEXT_PUBLIC_SITE_URL` (canonical origin; defaults to `http://localhost:3000` when absent — never hardcode a domain).
- Tests on PGlite only, replaying `drizzle/*.sql` name-sorted; register any new extension in `tests/helpers/test-db.ts` (none expected this phase). AI calls (none expected in these tasks) always mocked.
- **Frozen invariants:** jsonld fallback-id format (`name|startDate|venueName`) — that is ingestion-side parsing, unrelated to our JSON-LD *output*; the day-instance pattern (Summerfest = 1 event / 9 instances); `maintainLink` isCanonical guard; trigger-maintained `search_tsv` (NEVER convert to a generated column — `array_to_string` is STABLE, it is impossible on any Postgres).
- **Enrichment-owned columns (`category`, `vibeTags`, `audienceTags`, `priceMin`, `priceMax`, `embedding`, `embeddedAt`, `contentFingerprint`) and the sweep-owned `isStationEvent` must NEVER enter `eventFields` in `src/ingestion/persist.ts`** — that exclusion protects them from re-ingest overwrites. Verify, don't assume.
- Search SQL in `src/search/hybrid.ts` changes ONLY where this plan says (ORDER BY tiebreaks). The RRF pipeline is eval-baselined (8/10 hit@3, p95 91.8ms) — any other change invalidates the baseline.
- Neon HTTP driver: no transactions; multi-row writes ordered recoverably; scripts idempotent.
- Migrations: `npm run db:generate` for schema tables/columns; `npx drizzle-kit generate --custom` for backfills/indexes needing raw SQL. Data backfills that need app logic (venue slugs, neighborhoods) are **scripts**, not migrations — migrations stay pure DDL so PGlite replays clean.
- RetroUI components are CLI-vendored into `src/components/ui/` — once vendored they are OURS to edit (theming, size trims). Never re-run `shadcn add` over an edited component.
- Site name appears ONLY via the `SITE_NAME` constant (`src/lib/site.ts`) — "MKE Events" is a working title; final name is Tarik's pre-launch call, and the rename must be a one-line change.
- **`git add` with scoped paths only. `git add -A` is forbidden.**
- Live verification against production Neon is authorized and the norm (read paths). Writes to prod happen only in the tasks that say so (migrate, seeds, backfill scripts).
- Next.js 16 conventions: `searchParams`/`params` arrive as **Promises** — always await; route-handler `context.params` too. Verify any uncertain API against `node_modules/next/dist/docs/` before writing (repo AGENTS.md mandate).

**Commands:** `npm run test` / `npm run typecheck` / `npm run build` / `npm run db:generate` / `npm run db:migrate` (production only where stated) / `npx playwright test` (Task 12+).

## Decisions (made in planning; flagged ones await Tarik)

1. **Neighborhoods: curated mapping, NOT PostGIS** (recommended to Tarik). Registry in `src/lib/neighborhoods.ts` (slug ↔ display name ↔ accent) + curated venue→neighborhood config + assignment script writing `venues.neighborhood` (display name — the search facet already matches on it). PostGIS polygons need boundary data nobody has sourced; defer past MVP. `/neighborhoods/[slug]` resolves slug→name→existing facet.
2. **`is_station_event` writer (AWAITING TARIK):** Task 3 includes a heuristic sweep (venue at 220 E Pittsburgh / venue name matches Radio Milwaukee / title matches `414 Live|HYFIN|88Nine|Backyard`) marking `isStationEvent = true`, one-way, with a dry-run report. Options presented: (a) heuristic sweep (recommended), (b) source-level flag on radio-milwaukee source (too broad — their community calendar lists non-station events), (c) admin-only in Phase 5 (module renders empty until then). Task 3's sweep step executes only on ruling (a).
3. **Multi-instance display semantics:** browse day-groups render one card per *instance* (Summerfest appears once per day-group — coherent); search results render one card per *event* at `nextStartAt` (current behavior); detail page lists ALL upcoming instances. This makes the "once in search vs 9× in browse" split intentional and documented rather than accidental.
4. **RetroUI Pro: credential-pending** (Tarik's login/subscription; pattern = Ticketmaster/AI-Gateway keys). `components.json` registers both registries; the build uses free components + mockup-derived custom components, which fully cover MOO-257's UI. Pro blocks are an enhancement pass if/when Tarik provisions a license.
5. **Stream URLs:** config constants in `src/lib/site.ts`, candidates `https://wyms.streamguys1.com/live` (88Nine) and `https://wyms.streamguys1.com/hyfin` (HYFIN) — Task 6 live-verifies with curl and against the radiomilwaukee.org player source; if wrong, ask Tarik (he works there).
6. **No now-playing metadata** in the mini-player for MVP (station metadata API is out of scope) — shows station name + "Listen live". Mockup's track line dropped deliberately.
7. **`maxPrice` facet:** stays functional against `priceMin` but stays undocumented in the README (no price writer exists; enrichment doesn't fill prices). Card price label: `isFree → "Free"`, `priceMin → "From $X"`, else `"See tickets"`. Price writer deferred.
8. **E2E data strategy:** Playwright runs against a local `next dev` server on production Neon (read-only flows; the newsletter spec writes one tagged row and deletes it). Assertions are resilient (counts ≥ 1, structural selectors) — prod data shifts daily.
9. **Dark mode: skipped.** The brand is cream/charcoal, light-only. RetroUI's `.dark` block is omitted; `prefers-color-scheme` flip in the old globals.css is removed.
10. **Category registry:** enrichment's tagging vocabulary (music, arts, sports, family, festival, community, comedy, food-drink, other) becomes `CATEGORIES` in `src/lib/design.ts`; `/categories/[slug]` validates against it. Implementers verify the exact list against `src/enrichment/` tagging schema before transcribing.
11. **`/live-music` route** maps to `cat=music` (617 events, robust) rather than a vibe tag (vocabulary uncontrolled).
12. **Event images:** `next/image` with `remotePatterns: [{ protocol: 'https', hostname: '**' }]` (source images come from arbitrary event-site domains). Cards do NOT render images in this phase (mockup cards are image-free by design); the detail page carries `imageUrl` via OpenGraph metadata only — an on-page hero image is Phase 5 polish.

---

### Task 1: Design foundation — fonts, Radio Milwaukee theme, RetroUI install, design helpers

The whole UI stands on this: brand fonts via next/font, the Radio Milwaukee token sheet as RetroUI-compatible CSS variables, RetroUI primitives vendored, and the pure design helpers every card and page consumes.

**Files:**
- Create: `src/fonts/` (5 .otf files copied from mockup), `src/lib/site.ts`, `src/lib/design.ts`, `tests/lib/design.test.ts`, `components.json`, `src/components/ui/*` (CLI-vendored), `public/brand/` (logo + crescendo PNGs)
- Modify: `src/app/globals.css` (full replacement), `src/app/layout.tsx` (fonts only in this task — shell comes in Task 6), `next.config.ts` (remotePatterns), `package.json` (if CLI adds deps)

**Interfaces:**
- Produces: `SITE_NAME`, `SITE_URL`, `STREAMS` (from `src/lib/site.ts`); `ACCENTS`, `CATEGORIES`, `accentForCategory(category, isStationEvent)`, `onAccent(accent)`, `priceLabel({isFree, priceMin, priceMax})` (from `src/lib/design.ts`); font CSS vars `--font-head` (Sidewalk Block), `--font-sans` (Aktiv Grotesk), `--font-accent` (Caveat); themed CSS vars per the globals.css below; RetroUI `Button`, `Card`, `Badge`, `Input`, `Select`, `Dialog` in `src/components/ui/`.

- [ ] **Step 1: Copy brand assets from the mockup**

```bash
mkdir -p src/fonts public/brand
cp "/Users/tarikmoody/Documents/Projects/mke-events/_ds/radio-milwaukee-design-system-aee2e2ce-e21d-46ac-addc-4061e1b69775/fonts/SidewalkBlock.otf" src/fonts/
cp "/Users/tarikmoody/Documents/Projects/mke-events/_ds/radio-milwaukee-design-system-aee2e2ce-e21d-46ac-addc-4061e1b69775/fonts/AktivGrotesk-Regular.otf" src/fonts/
cp "/Users/tarikmoody/Documents/Projects/mke-events/_ds/radio-milwaukee-design-system-aee2e2ce-e21d-46ac-addc-4061e1b69775/fonts/AktivGrotesk-Medium.otf" src/fonts/
cp "/Users/tarikmoody/Documents/Projects/mke-events/_ds/radio-milwaukee-design-system-aee2e2ce-e21d-46ac-addc-4061e1b69775/fonts/AktivGrotesk-Bold.otf" src/fonts/
cp "/Users/tarikmoody/Documents/Projects/mke-events/_ds/radio-milwaukee-design-system-aee2e2ce-e21d-46ac-addc-4061e1b69775/fonts/AktivGrotesk-XBold.otf" src/fonts/
cp "/Users/tarikmoody/Documents/Projects/mke-events/assets/logo-horizontal-charcoal.png" public/brand/
cp "/Users/tarikmoody/Documents/Projects/mke-events/assets/logo-stamp-charcoal.png" public/brand/
cp "/Users/tarikmoody/Documents/Projects/mke-events/assets/logo-stamp-cream.png" public/brand/
cp "/Users/tarikmoody/Documents/Projects/mke-events/assets/crescendo-charcoal.png" public/brand/
```

Note: brand fonts are licensed to Radio Milwaukee; this repo is private/local — acceptable. Flag in README if the repo ever gets a public remote.

- [ ] **Step 2: Failing test for the design helpers**

```typescript
// tests/lib/design.test.ts
import { describe, expect, it } from 'vitest';
import { accentForCategory, onAccent, priceLabel } from '@/lib/design';

describe('accentForCategory', () => {
  it('maps known categories to brand accents', () => {
    expect(accentForCategory('music', false)).toBe('#F8971D');
    expect(accentForCategory('comedy', false)).toBe('#C9366B');
  });
  it('forces orange for station events regardless of category', () => {
    expect(accentForCategory('comedy', true)).toBe('#F8971D');
  });
  it('falls back to blue for unknown or null categories', () => {
    expect(accentForCategory('zydeco-polka', false)).toBe('#32588E');
    expect(accentForCategory(null, false)).toBe('#32588E');
  });
});

describe('onAccent', () => {
  it('returns cream text on dark accents', () => {
    expect(onAccent('#32588E')).toBe('#F7F1DB');
    expect(onAccent('#C9366B')).toBe('#F7F1DB');
    expect(onAccent('#E8342A')).toBe('#F7F1DB');
    expect(onAccent('#1F2528')).toBe('#F7F1DB');
  });
  it('returns charcoal text on light accents', () => {
    expect(onAccent('#F8971D')).toBe('#1F2528');
    expect(onAccent('#F2C230')).toBe('#1F2528');
  });
});

describe('priceLabel', () => {
  it('prefers Free when isFree', () => {
    expect(priceLabel({ isFree: true, priceMin: null, priceMax: null })).toBe('Free');
  });
  it('shows From $X when priceMin is set', () => {
    expect(priceLabel({ isFree: false, priceMin: '15', priceMax: null })).toBe('From $15');
  });
  it('drops trailing zeros from numeric strings', () => {
    expect(priceLabel({ isFree: null, priceMin: '12.50', priceMax: null })).toBe('From $12.50');
    expect(priceLabel({ isFree: null, priceMin: '40.00', priceMax: null })).toBe('From $40');
  });
  it('falls back to See tickets when nothing is known', () => {
    expect(priceLabel({ isFree: null, priceMin: null, priceMax: null })).toBe('See tickets');
  });
});
```

Run: `npx vitest run tests/lib/design.test.ts` → FAILS (module not found).

- [ ] **Step 3: Implement `src/lib/site.ts` and `src/lib/design.ts`**

```typescript
// src/lib/site.ts
/** Working title — final brand name is Tarik's pre-launch decision. Rename HERE only. */
export const SITE_NAME = 'MKE Events';
export const SITE_TAGLINE = 'Milwaukee event discovery, powered by Radio Milwaukee';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Live-verified in Task 6 (curl + radiomilwaukee.org player source). */
export const STREAMS = {
  '88Nine': 'https://wyms.streamguys1.com/live',
  HYFIN: 'https://wyms.streamguys1.com/hyfin',
} as const;

export type StationKey = keyof typeof STREAMS;
```

```typescript
// src/lib/design.ts
export const INK = '#1F2528';
export const CREAM = '#F7F1DB';
export const ORANGE = '#F8971D';
export const BLUE = '#32588E';
export const GOLD = '#F2C230';
export const PINK = '#C9366B';
export const RED = '#E8342A';

/** Accents whose luminance demands cream text (mockup EventCard + detail logic, exact set). */
const DARK_ACCENTS = new Set([BLUE, PINK, RED, INK]);

/**
 * Enrichment tagging vocabulary. IMPLEMENTER: verify against the tagging schema in
 * src/enrichment/ before transcribing; adjust members if the enum differs.
 */
export const CATEGORIES = [
  { slug: 'music', label: 'Music', accent: ORANGE },
  { slug: 'arts', label: 'Arts', accent: BLUE },
  { slug: 'sports', label: 'Sports', accent: BLUE },
  { slug: 'family', label: 'Family', accent: GOLD },
  { slug: 'festival', label: 'Festival', accent: PINK },
  { slug: 'community', label: 'Community', accent: GOLD },
  { slug: 'comedy', label: 'Comedy', accent: PINK },
  { slug: 'food-drink', label: 'Food & Drink', accent: GOLD },
  { slug: 'other', label: 'More', accent: BLUE },
] as const;

export function accentForCategory(category: string | null, isStationEvent: boolean): string {
  if (isStationEvent) return ORANGE;
  const entry = CATEGORIES.find((candidate) => candidate.slug === category);
  return entry?.accent ?? BLUE;
}

export function onAccent(accent: string): string {
  return DARK_ACCENTS.has(accent) ? CREAM : INK;
}

function formatDollars(numeric: string): string {
  const amount = Number(numeric);
  return Number.isInteger(amount) ? `$${amount}` : `$${amount}`.replace(/0+$/, '');
}

export function priceLabel(price: {
  isFree: boolean | null;
  priceMin: string | null;
  priceMax: string | null;
}): string {
  if (price.isFree) return 'Free';
  if (price.priceMin !== null) return `From ${formatDollars(price.priceMin)}`;
  return 'See tickets';
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run tests/lib/design.test.ts` → PASS (fix `formatDollars` until the `40.00 → $40`, `12.50 → $12.50` cases hold: `Number('40.00')` is `40` → `$40`; `Number('12.50')` is `12.5` → the template gives `$12.5` — correct implementation is `const amount = Number(numeric); const text = amount.toFixed(2).replace(/\.?0+$/, ''); return '$' + text;` — use that and keep the test green).

- [ ] **Step 5: Replace `src/app/globals.css` with the Radio Milwaukee theme**

Full file replacement (RetroUI's variable contract from retroui.dev/docs/installation, fetched 2026-07-08, themed to the RM token sheet; marquee/EQ keyframes from the mockup):

```css
@import "tailwindcss";

@theme inline {
  --font-head: var(--font-head);
  --font-sans: var(--font-sans);
  --font-accent: var(--font-accent);
  --radius: var(--radius);

  --shadow-xs: 1px 1px 0 0 var(--border);
  --shadow-sm: 2px 2px 0 0 var(--border);
  --shadow: 3px 3px 0 0 var(--border);
  --shadow-md: 4px 4px 0 0 var(--border);
  --shadow-lg: 6px 6px 0 0 var(--border);
  --shadow-xl: 8px 8px 0 0 var(--border);
  --shadow-2xl: 16px 16px 0 1px var(--border);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary-hover: var(--primary-hover);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  /* Radio Milwaukee brand accents, addressable as Tailwind colors */
  --color-ink: #1F2528;
  --color-cream: #F7F1DB;
  --color-cream-raised: #FBF6E4;
  --color-rm-orange: #F8971D;
  --color-rm-blue: #32588E;
  --color-rm-gold: #F2C230;
  --color-rm-pink: #C9366B;
  --color-rm-red: #E8342A;
  --color-ink-muted: #5C6369;
  --color-ink-subtle: #8A9096;
}

:root {
  --radius: 0;
  --background: #F7F1DB;   /* rm-cream */
  --foreground: #1F2528;   /* rm-charcoal */
  --card: #FBF6E4;         /* rm-cream-60, the mockup card body */
  --card-foreground: #1F2528;
  --primary: #F8971D;      /* rm-orange */
  --primary-hover: #D97A04;
  --primary-foreground: #1F2528;
  --secondary: #1F2528;
  --secondary-foreground: #F7F1DB;
  --muted: #FDFBF3;
  --muted-foreground: #5C6369;
  --accent: #FDE6C6;       /* orange tint */
  --accent-foreground: #1F2528;
  --destructive: #E8342A;
  --destructive-foreground: #FFFFFF;
  --border: #1F2528;       /* 3px charcoal borders + hard offset shadows */
  --input: #F7F1DB;
  --ring: #1F2528;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans), system-ui, sans-serif;
}

::selection {
  background: #F8971D;
  color: #1F2528;
}

input::placeholder {
  color: #8A9096;
}

@keyframes mke-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

@keyframes mke-eq {
  0%, 100% { height: 5px; }
  50% { height: 18px; }
}
```

Notes: the old `--font-geist-*` vars, the `prefers-color-scheme` dark flip, and the `Arial, Helvetica` body font (a pre-existing bug that overrode Geist) are all deliberately gone. No `.dark` block (Decision 9).

- [ ] **Step 6: Wire brand fonts in `src/app/layout.tsx`**

Replace the Geist imports/usage (keep the rest of the file intact — the shell lands in Task 6):

```tsx
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Caveat } from "next/font/google";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import "./globals.css";

const sidewalkBlock = localFont({
  src: "../fonts/SidewalkBlock.otf",
  variable: "--font-head",
  display: "swap",
});

const aktivGrotesk = localFont({
  src: [
    { path: "../fonts/AktivGrotesk-Regular.otf", weight: "400", style: "normal" },
    { path: "../fonts/AktivGrotesk-Medium.otf", weight: "500", style: "normal" },
    { path: "../fonts/AktivGrotesk-Bold.otf", weight: "700", style: "normal" },
    { path: "../fonts/AktivGrotesk-XBold.otf", weight: "800", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-accent",
  display: "swap",
});

export const metadata: Metadata = {
  title: SITE_NAME,
  description: SITE_TAGLINE,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sidewalkBlock.variable} ${aktivGrotesk.variable} ${caveat.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Configure remote images in `next.config.ts`**

Add to the config object (verify the current file shape first; merge, don't clobber):

```typescript
images: {
  remotePatterns: [{ protocol: 'https', hostname: '**' }],
},
```

- [ ] **Step 8: Register RetroUI registries and vendor the primitives**

Create `components.json` (repo root). The shadcn CLI normally scaffolds this via `init`; RetroUI's docs (fetched 2026-07-08) require the registries block:

```bash
npx shadcn@latest init
```

Answer prompts: TypeScript yes, base color neutral (irrelevant — our theme overrides), CSS variables yes, `src/` dir yes. Then add to the generated `components.json`:

```json
"registries": {
  "@retroui": "https://retroui.dev/r/radix/{name}.json",
  "@retroui-base": "https://retroui.dev/r/base/{name}.json"
}
```

We use the **Radix** family (`@retroui`) exclusively — never mix with `@retroui-base` (different primitive APIs).

```bash
npx shadcn@latest add @retroui/button @retroui/card @retroui/badge @retroui/input @retroui/select @retroui/dialog
```

Expected: components land in `src/components/ui/`. If `init` fights the existing globals.css, let it write, then re-apply Step 5's file verbatim (our theme is the source of truth). Inspect the vendored components: they consume `--color-*`/`--shadow-*` vars, so they pick up the RM theme automatically. If any vendored component hardcodes a font class, point it at `font-sans`/`font-head`.

- [ ] **Step 9: Verify the whole task**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all green; build output lists the existing routes. Then `npm run dev`, load `/events`, and confirm: cream background, charcoal text, Aktiv Grotesk body font (inspect computed styles). The page is still unstyled-ugly — that's Task 7's job; this task only proves the foundation loads.

- [ ] **Step 10: Commit**

```bash
git add src/fonts public/brand src/lib/site.ts src/lib/design.ts tests/lib/design.test.ts src/app/globals.css src/app/layout.tsx next.config.ts components.json src/components/ui package.json package-lock.json
git commit -m "feat: design foundation — RM theme, brand fonts, RetroUI primitives, design helpers"
```

---
### Task 2: Search-layer upgrades — slug tiebreak, tonight dead-zone, free-word facet, custom date range

Four surgical, TDD-able changes to the search layer, all carried on the backlog. NOTHING else in `src/search/hybrid.ts` changes (eval-baselined).

**Files:**
- Modify: `src/search/hybrid.ts` (3 ORDER BY lines only), `src/search/query-understanding.ts`, `src/app/events/search-params.ts`
- Test: `tests/search/hybrid.test.ts`, `tests/search/query-understanding.test.ts`, `tests/search/search-params.test.ts` (add cases; update existing `ParsedQuery` expectations for the new `free` field)

**Interfaces:**
- Consumes: `chicagoParts`, `chicagoWallTimeToIso` from `@/lib/chicago-time`.
- Produces: `ParsedQuery` gains `free: boolean`; `searchParamsSchema` gains `from`/`to` (`YYYY-MM-DD`); deterministic result order (`slug ASC` final tiebreak everywhere).

- [ ] **Step 1: Failing tests**

Add to `tests/search/query-understanding.test.ts` (match the file's existing describe style):

```typescript
describe('tonight dead zone', () => {
  it('covers the in-progress night between midnight and 3am Chicago', () => {
    const now = new Date('2026-07-08T06:30:00Z'); // 01:30 CDT
    const window = presetWindow('tonight', now);
    expect(window.start).toEqual(now);
    expect(window.end.toISOString()).toBe('2026-07-08T08:00:00.000Z'); // 03:00 CDT
  });
  it('still targets the coming evening after 3am', () => {
    const now = new Date('2026-07-08T14:00:00Z'); // 09:00 CDT
    const window = presetWindow('tonight', now);
    expect(window.start.toISOString()).toBe('2026-07-08T22:00:00.000Z'); // 17:00 CDT
  });
});

describe('free-word extraction', () => {
  it('maps the word free to the free flag and strips it from text', () => {
    const parsed = parseSearchInput('free live music tonight', new Date('2026-07-08T22:00:00Z'));
    expect(parsed.free).toBe(true);
    expect(parsed.text).toBe('live music');
    expect(parsed.window).not.toBeNull();
  });
  it('leaves free=false when the word is absent', () => {
    expect(parseSearchInput('jazz', new Date()).free).toBe(false);
  });
});
```

Add to `tests/search/search-params.test.ts`:

```typescript
describe('custom date range', () => {
  it('resolves from/to into a Chicago whole-day window', () => {
    const { filters } = resolveSearch(
      parseSearchParams({ from: '2026-07-10', to: '2026-07-12' }),
      new Date('2026-07-08T12:00:00Z'),
    );
    expect(filters.window?.start.toISOString()).toBe('2026-07-10T05:00:00.000Z'); // Jul 10 00:00 CDT
    expect(filters.window?.end.toISOString()).toBe('2026-07-13T05:00:00.000Z'); // Jul 13 00:00 CDT (exclusive)
  });
  it('drops malformed and inverted ranges', () => {
    expect(parseSearchParams({ from: 'nonsense', to: '2026-07-12' }).from).toBeUndefined();
    const { filters } = resolveSearch(
      parseSearchParams({ from: '2026-07-12', to: '2026-07-10' }),
      new Date('2026-07-08T12:00:00Z'),
    );
    expect(filters.window).toBeUndefined();
  });
  it('counts a complete range as an active search input', () => {
    expect(hasActiveSearchInputs(parseSearchParams({ from: '2026-07-10', to: '2026-07-12' }))).toBe(true);
  });
});

describe('free-word facet mapping', () => {
  it('carries the parsed free flag into filters', () => {
    const { filters } = resolveSearch(parseSearchParams({ q: 'free family fun' }), new Date());
    expect(filters.free).toBe(true);
  });
});
```

Add to `tests/search/hybrid.test.ts` (uses the file's existing PGlite seeding helpers):

```typescript
it('breaks next_start_at ties deterministically by slug', async () => {
  // Seed two events with instances at the IDENTICAL startAt, slugs 'bbb-…' and 'aaa-…'
  // (reuse the file's existing insert helpers; startAt = same future timestamp for both).
  const hits = await searchEvents(db, { filters: {} });
  const tied = hits.filter((hit) => hit.nextStartAt.getTime() === sharedStart.getTime());
  expect(tied.map((hit) => hit.slug)).toEqual([...tied.map((hit) => hit.slug)].sort());
});
```

Run: `npx vitest run tests/search` → new cases FAIL.

- [ ] **Step 2: Slug tiebreak — three ORDER BY edits in `src/search/hybrid.ts`**

Line 131 (`bothLegsSelect`): `ORDER BY score DESC, next_start_at ASC` → `ORDER BY score DESC, next_start_at ASC, slug ASC`
Line 143 (`singleLegSelect`): same change.
Line 153 (`browseSelect`): `ORDER BY next_start_at ASC` → `ORDER BY next_start_at ASC, slug ASC`

No other edits to this file.

- [ ] **Step 3: Tonight dead-zone in `src/search/query-understanding.ts`**

First read `src/lib/chicago-time.ts` and confirm `chicagoParts` exposes an `hour` part in 24-hour form (`hourCycle: 'h23'` or `hour12: false`). If it does not, extend its formatter to include `hour: '2-digit'` with `hourCycle: 'h23'` (additive — existing callers read only year/month/day). Then replace `tonightWindow`:

```typescript
function tonightWindow(civil: CivilDate, now: Date): { start: Date; end: Date } {
  const hour = Number(chicagoParts(now.getTime()).hour);
  if (hour < 3) return { start: now, end: wallTime(civil, 3, 0) };
  const start = wallTime(civil, 17, 0);
  const end = wallTime(addCivilDays(civil, 1), 3, 0);
  return { start: clampToNow(start, now), end };
}
```

- [ ] **Step 4: Free-word extraction in `src/search/query-understanding.ts`**

`ParsedQuery` gains `free: boolean`. Extract the flag BEFORE phrase matching so "free live music tonight" resolves both:

```typescript
export interface ParsedQuery {
  text: string;
  window: { start: Date; end: Date } | null;
  timeOfDay: TimeOfDay | null;
  free: boolean;
}

/** "free" is a facet, not a search term ("free jazz" fans lose — accepted product call). */
function extractFreeFlag(raw: string): { text: string; free: boolean } {
  const match = raw.match(/\bfree\b/i);
  if (!match || match.index === undefined) return { text: raw, free: false };
  return { text: raw.slice(0, match.index) + raw.slice(match.index + match[0].length), free: true };
}

export function parseSearchInput(raw: string, now: Date): ParsedQuery {
  const { text: base, free } = extractFreeFlag(raw);
  for (const { pattern, resolve } of PHRASES) {
    const match = base.match(pattern);
    if (!match || match.index === undefined) continue;
    const stripped = base.slice(0, match.index) + base.slice(match.index + match[0].length);
    const resolved = resolve(now, match);
    return { text: collapseWhitespace(stripped), window: resolved.window ?? null, timeOfDay: resolved.timeOfDay ?? null, free };
  }
  return { text: collapseWhitespace(base), window: null, timeOfDay: null, free };
}
```

Update every existing test expectation that `toEqual`s a `ParsedQuery` to include `free: false` (mechanical; do not change any other expectation values).

- [ ] **Step 5: Custom range + free plumb-through in `src/app/events/search-params.ts`**

Schema additions (inside `searchParamsSchema`):

```typescript
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
```

`hasActiveSearchInputs` adds `params.from || params.to ||` to the Boolean chain.

New helpers + `resolveWindow`/`buildFilters`/`resolveSearch` updates:

```typescript
import { chicagoWallTimeToIso } from '@/lib/chicago-time';

interface CivilDay {
  year: number;
  month: number;
  day: number;
}

function parseCivilDay(value: string): CivilDay {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

/** UTC absorbs month/year rollover; DST-safe because the wall-time conversion happens after. */
function nextCivilDay(civil: CivilDay): CivilDay {
  const shifted = new Date(Date.UTC(civil.year, civil.month - 1, civil.day) + 86_400_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function wallStart(civil: CivilDay): Date {
  return new Date(chicagoWallTimeToIso(civil.year, civil.month, civil.day, 0, 0));
}

/** Whole Chicago days, end-exclusive. Inverted ranges resolve to no window. */
function customRangeWindow(params: SearchParams): { start: Date; end: Date } | undefined {
  if (!params.from || !params.to) return undefined;
  const start = wallStart(parseCivilDay(params.from));
  const endStart = wallStart(parseCivilDay(params.to));
  if (start.getTime() > endStart.getTime()) return undefined;
  return { start, end: wallStart(nextCivilDay(parseCivilDay(params.to))) };
}

function resolveWindow(
  params: SearchParams,
  parsedWindow: { start: Date; end: Date } | null,
  now: Date,
): { start: Date; end: Date } | undefined {
  if (parsedWindow) return parsedWindow;
  if (params.date) return presetWindow(params.date, now);
  return customRangeWindow(params);
}
```

In `buildFilters`, the `free` line becomes a parameter fed from `resolveSearch`:

```typescript
function buildFilters(
  params: SearchParams,
  window: { start: Date; end: Date } | undefined,
  timeOfDay: TimeOfDay | undefined,
  freeFromQuery: boolean,
): SearchFilters {
  return {
    window,
    category: params.cat,
    venue: params.venue,
    neighborhood: params.neighborhood,
    free: params.free === '1' || freeFromQuery ? true : undefined,
    vibe: params.vibe,
    audience: params.audience,
    timeOfDay,
    maxPrice: params.maxPrice,
  };
}

export function resolveSearch(params: SearchParams, now: Date): ResolvedSearch {
  const parsedQuery = params.q ? parseSearchInput(params.q, now) : null;
  const window = resolveWindow(params, parsedQuery?.window ?? null, now);
  const timeOfDay = resolveTimeOfDay(params, parsedQuery?.timeOfDay ?? null);
  const text = parsedQuery?.text ? parsedQuery.text : undefined;
  return { text, filters: buildFilters(params, window, timeOfDay, parsedQuery?.free ?? false) };
}
```

- [ ] **Step 6: Run the full search suite + eval sanity**

Run: `npx vitest run tests/search` → PASS (all cases, including updated expectations).
Run: `npm run test && npm run typecheck` → PASS.
Run: `npm run search:eval` against production → expect hit@3 unchanged from 8/10 baseline (the tiebreak only reorders exact ties; free-word/dead-zone don't touch eval queries — if any eval query contains "free", inspect before judging a delta).

- [ ] **Step 7: Commit**

```bash
git add src/search/hybrid.ts src/search/query-understanding.ts src/app/events/search-params.ts src/lib/chicago-time.ts tests/search
git commit -m "feat: search upgrades — slug tiebreak, tonight dead-zone, free-word facet, custom date range"
```

---

### Task 3: Data layer — staff_picks, newsletter_subscribers, venue slugs, neighborhoods, station-event flagger

All new persistence this phase needs, plus the writers/scripts that populate it. Migrations are pure DDL (PGlite replays them); data population is scripts.

**Files:**
- Modify: `src/db/schema.ts`, `package.json` (scripts), `src/ingestion/persist.ts` (findOrCreateVenue slug only — read it first)
- Create: generated `drizzle/0012_*.sql`, custom `drizzle/0013_venue-slug-unique.sql`, `src/lib/venue-slug.ts`, `src/lib/neighborhoods.ts`, `src/maintenance/backfill-venue-slugs.ts`, `src/maintenance/assign-neighborhoods.ts`, `src/maintenance/venue-neighborhood-map.ts`, `src/maintenance/flag-station-events.ts`, `src/maintenance/add-staff-pick.ts`
- Test: `tests/db/phase4-tables.test.ts`, `tests/lib/venue-slug.test.ts`, `tests/maintenance/flag-station-events.test.ts`, `tests/maintenance/assign-neighborhoods.test.ts`

**Interfaces:**
- Consumes: existing `events`, `venues` tables; existing maintenance-CLI idiom (read one existing `src/maintenance/*` CLI first and mirror its arg/run pattern).
- Produces: `staffPicks`, `newsletterSubscribers` tables; `venues.slug` column (+ partial unique index); `venueSlug(normalizedName)`; `NEIGHBORHOODS` registry + `neighborhoodBySlug(slug)`; scripts `npm run venues:backfill-slugs`, `npm run venues:assign-neighborhoods`, `npm run station:flag [-- --dry-run]`, `npm run picks:add`.

- [ ] **Step 1: Failing schema test**

```typescript
// tests/db/phase4-tables.test.ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

async function columnNames(db: Awaited<ReturnType<typeof createTestDb>>, table: string): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = ${table}
  `);
  return (result.rows as { column_name: string }[]).map((row) => row.column_name);
}

describe('phase 4 tables', () => {
  it('replays staff_picks with its expected columns', async () => {
    const db = await createTestDb();
    const cols = await columnNames(db, 'staff_picks');
    expect(cols).toEqual(expect.arrayContaining(['id', 'event_id', 'curator_name', 'blurb', 'week_of', 'sort_order']));
  });
  it('replays newsletter_subscribers with a unique email', async () => {
    const db = await createTestDb();
    await db.execute(sql`INSERT INTO newsletter_subscribers (email) VALUES ('a@b.com')`);
    await expect(db.execute(sql`INSERT INTO newsletter_subscribers (email) VALUES ('a@b.com')`)).rejects.toThrow();
  });
  it('replays venues.slug with a partial unique index', async () => {
    const db = await createTestDb();
    expect(await columnNames(db, 'venues')).toContain('slug');
    const idx = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE indexname = 'venues_slug_unique_idx'`);
    expect(idx.rows).toHaveLength(1);
  });
});
```

Run: `npx vitest run tests/db/phase4-tables.test.ts` → FAILS.

- [ ] **Step 2: Schema additions in `src/db/schema.ts`**

First read the existing file to mirror its exact idiom (column-builder imports, index declaration style, and the ACTUAL type of `events.id` — the `eventId` reference below must match it; the code assumes uuid, adjust if it's text). Add:

```typescript
export const staffPicks = pgTable(
  'staff_picks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    curatorName: text('curator_name').notNull(),
    curatorRole: text('curator_role'),
    showUrl: text('show_url'),
    blurb: text('blurb').notNull(),
    weekOf: date('week_of').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('staff_picks_week_idx').on(table.weekOf, table.sortOrder)],
);

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const staffPicksRelations = relations(staffPicks, ({ one }) => ({
  event: one(events, { fields: [staffPicks.eventId], references: [events.id] }),
}));
```

And on `venues` (after `neighborhood`): `slug: text('slug'),` (nullable — backfilled by script; NOT unique at the column level).

Run: `npm run db:generate` → inspect `drizzle/0012_*.sql` (two CREATE TABLE + one ADD COLUMN; no data). Then the partial unique index as a custom migration:

Run: `npx drizzle-kit generate --custom --name=venue-slug-unique` → fill `drizzle/0013_venue-slug-unique.sql`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS venues_slug_unique_idx ON "venues" ("slug") WHERE slug IS NOT NULL;
```

Run: `npx vitest run tests/db/phase4-tables.test.ts` → PASS.

- [ ] **Step 3: Venue slug helper (TDD)**

```typescript
// tests/lib/venue-slug.test.ts
import { describe, expect, it } from 'vitest';
import { venueSlug } from '@/lib/venue-slug';

describe('venueSlug', () => {
  it('slugifies a normalized name', () => {
    expect(venueSlug('pabst theater')).toBe('pabst-theater');
  });
  it('strips punctuation runs and edge dashes', () => {
    expect(venueSlug("linneman's riverwest inn")).toBe('linneman-s-riverwest-inn');
  });
  it('caps length at 48 chars without a trailing dash', () => {
    const slug = venueSlug('a'.repeat(60) + ' venue');
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });
  it('never returns empty', () => {
    expect(venueSlug('!!!')).toMatch(/^venue-[0-9a-f]{8}$/);
  });
});
```

```typescript
// src/lib/venue-slug.ts
import { createHash } from 'node:crypto';

/** venues.normalized_name is already lowercased/deaccented — this only reshapes it for URLs. */
export function venueSlug(normalizedName: string): string {
  const base = normalizedName
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (base) return base;
  return 'venue-' + createHash('sha256').update(normalizedName).digest('hex').slice(0, 8);
}
```

Run: `npx vitest run tests/lib/venue-slug.test.ts` → PASS.

- [ ] **Step 4: Backfill script + insert-time writer**

`src/maintenance/backfill-venue-slugs.ts` (mirror the run/report pattern of an existing maintenance CLI; idempotent; Neon-safe per-row):

```typescript
import { isNull } from 'drizzle-orm';
import { db } from '@/db';
import { venues } from '@/db/schema';
import { venueSlug } from '@/lib/venue-slug';

/** On slug collision (distinct venues, same slugified name) appends an 8-hex hash of normalizedName. */
function disambiguate(slug: string, normalizedName: string, taken: Set<string>): string {
  if (!taken.has(slug)) return slug;
  const suffixed = `${slug.slice(0, 39)}-${normalizedNameHash(normalizedName)}`;
  return suffixed;
}

function normalizedNameHash(normalizedName: string): string {
  return createHash('sha256').update(normalizedName).digest('hex').slice(0, 8);
}

async function backfillVenueSlugs(): Promise<void> {
  const rows = await db.select().from(venues).where(isNull(venues.slug));
  const existing = await db.select({ slug: venues.slug }).from(venues);
  const taken = new Set(existing.map((row) => row.slug).filter((slug): slug is string => slug !== null));
  let updated = 0;
  for (const venue of rows) {
    const slug = disambiguate(venueSlug(venue.normalizedName), venue.normalizedName, taken);
    await db.update(venues).set({ slug }).where(eq(venues.id, venue.id));
    taken.add(slug);
    updated += 1;
  }
  console.log(`venue slugs backfilled: ${updated}`);
}
```

(Complete the imports — `createHash` from `node:crypto`, `eq` from drizzle — and the CLI entry `backfillVenueSlugs().then(...)` matching the existing CLI idiom.) Add `"venues:backfill-slugs"` to package.json scripts using the same runner the existing maintenance scripts use (check how `npm run enrich` / retention CLIs are wired and mirror exactly).

Then in `src/ingestion/persist.ts`: READ the file, find `findOrCreateVenue`'s INSERT path, and add `slug: venueSlug(normalizedName)` to the inserted values ONLY (never on the update/match path; on unique-violation the existing race-recovery re-select path already applies — verify by reading the 2c race handling; if the insert can now fail on slug conflict for a NEW venue name, catch code 23505 and retry once with the hash-suffixed slug). Add a PGlite regression test in the existing persist test file: inserting two venues whose names slugify identically yields two distinct slugs.

- [ ] **Step 5: Neighborhoods registry + assignment (TDD)**

```typescript
// src/lib/neighborhoods.ts
import { BLUE, GOLD, INK, ORANGE, PINK } from '@/lib/design';

export interface Neighborhood {
  slug: string;
  name: string;
  accent: string;
}

/** Curated MVP set (mockup palette). venues.neighborhood stores the display NAME (search facet matches it). */
export const NEIGHBORHOODS: readonly Neighborhood[] = [
  { slug: 'bay-view', name: 'Bay View', accent: PINK },
  { slug: 'riverwest', name: 'Riverwest', accent: ORANGE },
  { slug: 'third-ward', name: 'Third Ward', accent: BLUE },
  { slug: 'walkers-point', name: "Walker's Point", accent: GOLD },
  { slug: 'east-town', name: 'East Town', accent: INK },
  { slug: 'downtown', name: 'Downtown', accent: GOLD },
  { slug: 'lakefront', name: 'Lakefront', accent: ORANGE },
  { slug: 'west-side', name: 'West Side', accent: BLUE },
] as const;

export function neighborhoodBySlug(slug: string): Neighborhood | undefined {
  return NEIGHBORHOODS.find((candidate) => candidate.slug === slug);
}

export function neighborhoodByName(name: string): Neighborhood | undefined {
  return NEIGHBORHOODS.find((candidate) => candidate.name === name);
}
```

`src/maintenance/venue-neighborhood-map.ts` — a curated `Record<string, string>` from `venues.normalized_name` → neighborhood NAME. Start it with the venues we know; **the executing controller completes it against the live venue list** (`SELECT normalized_name, address FROM venues ORDER BY normalized_name` on production) and commits the completed map:

```typescript
/**
 * Curated venue → neighborhood assignments (normalized_name → NEIGHBORHOODS name).
 * Completed at execution against the live venue list; unmapped venues stay NULL and
 * are reported by assign-neighborhoods for the next curation pass.
 */
export const VENUE_NEIGHBORHOODS: Record<string, string> = {
  'pabst theater': 'Downtown',
  'turner hall ballroom': 'Downtown',
  'riverside theater': 'Downtown',
  'cactus club': 'Bay View',
  'the laughing tap': 'Walker's Point',
  'linneman's riverwest inn': 'Riverwest',
  'company brewing': 'Riverwest',
  'lakefront brewery': 'Riverwest',
  'radio milwaukee': "Walker's Point",
  'henry maier festival park': 'Lakefront',
  'american family field': 'West Side',
  'fiserv forum': 'Downtown',
  'cathedral square park': 'East Town',
  // …completed at execution from the live venue list
};
```

(NOTE the two apostrophe-in-single-quote strings above MUST be escaped or double-quoted in real TS — `"linneman's riverwest inn"` — transcribe accordingly.)

`src/maintenance/assign-neighborhoods.ts`: for each mapped entry, `UPDATE venues SET neighborhood = $name WHERE normalized_name = $key AND (neighborhood IS DISTINCT FROM $name)`; then report: updated count, venues left unmapped (name + address), and any map keys that matched no venue (rot detection). PGlite test: seed two venues, map one, run, assert one updated + one reported unmapped. Add `"venues:assign-neighborhoods"` script.

- [ ] **Step 6: Station-event flagger (decision-gated; build it, RUN it only on Tarik's ruling)**

```typescript
// src/maintenance/flag-station-events.ts — heuristic, one-way (never unsets), --dry-run default OFF
const VENUE_PATTERN = /radio milwaukee/;
const ADDRESS_PATTERN = /220 e\.? pittsburgh/i;
const TITLE_PATTERN = /\b(414 live|hyfin|88nine|backyard)\b/i;

export function isStationEventHeuristic(input: {
  title: string;
  venueNormalizedName: string | null;
  venueAddress: string | null;
}): boolean {
  if (input.venueNormalizedName && VENUE_PATTERN.test(input.venueNormalizedName)) return true;
  if (input.venueAddress && ADDRESS_PATTERN.test(input.venueAddress)) return true;
  return TITLE_PATTERN.test(input.title);
}
```

CLI body: select events (id, title, isStationEvent) LEFT JOIN venues (normalized_name, address) where `is_station_event = false`; evaluate the heuristic; with `--dry-run` print the would-flag list (title + venue) and exit; otherwise update flagged rows per-row and print the same list as a receipt. PGlite tests: one venue-match, one title-match, one non-match; dry-run mutates nothing. **Before writing: grep `src/ingestion/persist.ts` for `isStationEvent` — it must NOT be in `eventFields`** (re-ingest would reset flags; if it somehow is, removing it is in-scope for this task and needs its own test). Add `"station:flag"` script.

- [ ] **Step 7: Staff-pick CLI**

`src/maintenance/add-staff-pick.ts`: args `--slug <event-slug> --curator <name> --blurb <text> [--role <text>] [--show-url <url>] [--week-of YYYY-MM-DD] [--sort <n>]`. Zod-validate (`week-of` regex as Task 2's; `show-url` `z.string().url()`). Resolve event by slug (error clearly if missing), insert the pick. `--week-of` defaults to the CURRENT Chicago week's Monday — compute via `chicagoParts` (year/month/day + weekday math, ≤20-line helper here; Task 4's display helper does NOT exist yet). PGlite test: inserts against a seeded event; rejects an unknown slug. Add `"picks:add"` script.

- [ ] **Step 8: Full suite + commit**

Run: `npm run test && npm run typecheck` → PASS (all existing + new).

```bash
git add src/db/schema.ts drizzle/0012_* drizzle/0013_* src/lib/venue-slug.ts src/lib/neighborhoods.ts src/maintenance src/ingestion/persist.ts tests/db tests/lib/venue-slug.test.ts tests/maintenance tests/ingestion package.json
git commit -m "feat: phase-4 data layer — staff picks, newsletter, venue slugs, neighborhoods, station flagger"
```

(Production execution of the scripts happens in Task 13, not here.)

---
### Task 4: Display, card-data, and calendar modules (pure logic, all TDD)

The three modules every page consumes: Chicago display formatting, the event→card hydration loader, and add-to-calendar link generation.

**Files:**
- Create: `src/lib/display.ts`, `src/lib/card-data.ts`, `src/lib/calendar-links.ts`
- Test: `tests/lib/display.test.ts`, `tests/lib/card-data.test.ts`, `tests/lib/calendar-links.test.ts`

**Interfaces:**
- Consumes: `chicagoParts` from `@/lib/chicago-time`; `db` schema relations (events ↔ venues).
- Produces:
  - `chicagoDayHeading(date): string` ("Tuesday, July 7"), `chicagoDayShort(date): string` ("TUE"), `chicagoTimeLabel(date): string` ("8:00 PM"), `chicagoDateLabel(date): string` ("Tue, Jul 7"), `chicagoDayKey(date): string` ("2026-07-07"), `chicagoWeekMonday(now): string` ("2026-07-06")
  - `EventCardMeta` type + `loadCardMeta(db, eventIds): Promise<Map<string, EventCardMeta>>`
  - `CalendarEventInput` type + `googleCalendarUrl(input): string` + `buildIcs(input): string`

- [ ] **Step 1: Failing display tests**

```typescript
// tests/lib/display.test.ts
import { describe, expect, it } from 'vitest';
import {
  chicagoDateLabel, chicagoDayHeading, chicagoDayKey, chicagoDayShort, chicagoTimeLabel, chicagoWeekMonday,
} from '@/lib/display';

// 2026-07-09T02:00:00Z is Jul 8, 9:00 PM in Chicago (CDT) — the UTC/Chicago split day.
const splitDay = new Date('2026-07-09T02:00:00Z');

describe('chicago display helpers', () => {
  it('formats headings in Chicago time, not UTC', () => {
    expect(chicagoDayHeading(splitDay)).toBe('Wednesday, July 8');
    expect(chicagoDayShort(splitDay)).toBe('WED');
    expect(chicagoTimeLabel(splitDay)).toBe('9:00 PM');
    expect(chicagoDateLabel(splitDay)).toBe('Wed, Jul 8');
    expect(chicagoDayKey(splitDay)).toBe('2026-07-08');
  });
  it('finds the Chicago Monday of the current week', () => {
    expect(chicagoWeekMonday(new Date('2026-07-08T12:00:00Z'))).toBe('2026-07-06'); // Wed → Mon
    expect(chicagoWeekMonday(new Date('2026-07-12T20:00:00Z'))).toBe('2026-07-06'); // Sun → same week's Mon
    expect(chicagoWeekMonday(new Date('2026-07-13T12:00:00Z'))).toBe('2026-07-13'); // Mon → itself
  });
});
```

- [ ] **Step 2: Implement `src/lib/display.ts`**

```typescript
import { chicagoParts } from '@/lib/chicago-time';

const CHICAGO = 'America/Chicago';

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', { timeZone: CHICAGO, ...options });
}

const headingFormat = formatter({ weekday: 'long', month: 'long', day: 'numeric' });
const dayShortFormat = formatter({ weekday: 'short' });
const timeFormat = formatter({ hour: 'numeric', minute: '2-digit' });
const dateLabelFormat = formatter({ weekday: 'short', month: 'short', day: 'numeric' });

export function chicagoDayHeading(date: Date): string {
  return headingFormat.format(date);
}

export function chicagoDayShort(date: Date): string {
  return dayShortFormat.format(date).toUpperCase();
}

export function chicagoTimeLabel(date: Date): string {
  return timeFormat.format(date);
}

export function chicagoDateLabel(date: Date): string {
  return dateLabelFormat.format(date);
}

export function chicagoDayKey(date: Date): string {
  const parts = chicagoParts(date.getTime());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Monday (Chicago) of the week containing `now`, as YYYY-MM-DD. */
export function chicagoWeekMonday(now: Date): string {
  const parts = chicagoParts(now.getTime());
  const utcNoon = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12);
  const weekday = new Date(utcNoon).getUTCDay();
  const monday = new Date(utcNoon - ((weekday + 6) % 7) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}
```

Check `chicagoParts` output: if month/day parts are not zero-padded 2-digit, pad in `chicagoDayKey` (the migration-era formatter uses `2-digit` — verify by reading chicago-time.ts). Run display tests → PASS.

- [ ] **Step 3: Card-data loader (PGlite TDD)**

```typescript
// src/lib/card-data.ts
import { inArray } from 'drizzle-orm';
import { events } from '@/db/schema';
import type { db as appDb } from '@/db';

export type Db = typeof appDb;

export interface EventCardMeta {
  eventId: string;
  slug: string;
  title: string;
  venueName: string | null;
  neighborhood: string | null;
  category: string | null;
  status: string;
  isFree: boolean | null;
  priceMin: string | null;
  priceMax: string | null;
  audienceTags: string[];
  isStationEvent: boolean;
}

/** One round trip: hydrates card fields for a set of event IDs (search hits or instance rows). */
export async function loadCardMeta(db: Db, eventIds: string[]): Promise<Map<string, EventCardMeta>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db.query.events.findMany({
    where: inArray(events.id, eventIds),
    with: { venue: true },
  });
  return new Map(rows.map((row) => [row.id, toMeta(row)]));
}

function toMeta(row: {
  id: string; slug: string; title: string; status: string; category: string | null;
  isFree: boolean | null; priceMin: string | null; priceMax: string | null;
  audienceTags: string[] | null; isStationEvent: boolean;
  venue: { name: string; neighborhood: string | null } | null;
}): EventCardMeta {
  return {
    eventId: row.id,
    slug: row.slug,
    title: row.title,
    venueName: row.venue?.name ?? null,
    neighborhood: row.venue?.neighborhood ?? null,
    category: row.category,
    status: row.status,
    isFree: row.isFree,
    priceMin: row.priceMin,
    priceMax: row.priceMax,
    audienceTags: row.audienceTags ?? [],
    isStationEvent: row.isStationEvent,
  };
}
```

Adjust `toMeta`'s param type to the ACTUAL inferred row type (use `typeof rows[number]` and delete the literal annotation if drizzle's inference is clean — do not fight it with casts). Test (PGlite): seed one event + venue via the existing test seed helpers, call `loadCardMeta`, assert every field; assert `loadCardMeta(db, [])` returns an empty Map without querying.

- [ ] **Step 4: Calendar links (TDD)**

```typescript
// tests/lib/calendar-links.test.ts
import { describe, expect, it } from 'vitest';
import { buildIcs, googleCalendarUrl } from '@/lib/calendar-links';

const input = {
  slug: 'jazz-in-the-park-abc12345',
  title: 'Jazz in the Park',
  description: 'Golden hour, cold drink; live horns.',
  venueName: 'Cathedral Square Park',
  venueAddress: '520 E Wells St, Milwaukee, WI',
  startAt: new Date('2026-07-09T23:00:00Z'), // 6:00 PM CDT
  endAt: new Date('2026-07-10T02:00:00Z'),
  url: 'https://example.com/events/jazz-in-the-park-abc12345',
};

describe('googleCalendarUrl', () => {
  it('builds a render URL with UTC stamps and Chicago ctz', () => {
    const url = new URL(googleCalendarUrl(input));
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Jazz in the Park');
    expect(url.searchParams.get('dates')).toBe('20260709T230000Z/20260710T020000Z');
    expect(url.searchParams.get('ctz')).toBe('America/Chicago');
    expect(url.searchParams.get('location')).toBe('Cathedral Square Park, 520 E Wells St, Milwaukee, WI');
  });
  it('defaults a missing end to start + 2h', () => {
    const url = new URL(googleCalendarUrl({ ...input, endAt: null }));
    expect(url.searchParams.get('dates')).toBe('20260709T230000Z/20260710T010000Z');
  });
});

describe('buildIcs', () => {
  it('emits UTC times, a stable UID, and escaped text', () => {
    const ics = buildIcs({ ...input, description: 'Line one\nsemi; comma, done' });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('UID:jazz-in-the-park-abc12345@');
    expect(ics).toContain('DTSTART:20260709T230000Z');
    expect(ics).toContain('DTEND:20260710T020000Z');
    expect(ics).toContain('DESCRIPTION:Line one\\nsemi\\; comma\\, done');
    expect(ics).toContain('URL:https://example.com/events/jazz-in-the-park-abc12345');
    expect(ics.split('\r\n')).toContain('END:VEVENT');
  });
});
```

```typescript
// src/lib/calendar-links.ts
import { SITE_URL } from '@/lib/site';

export interface CalendarEventInput {
  slug: string;
  title: string;
  description: string | null;
  venueName: string | null;
  venueAddress: string | null;
  startAt: Date;
  endAt: Date | null;
  url: string;
}

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function resolveEnd(input: CalendarEventInput): Date {
  return input.endAt ?? new Date(input.startAt.getTime() + DEFAULT_DURATION_MS);
}

function location(input: CalendarEventInput): string {
  return [input.venueName, input.venueAddress ?? 'Milwaukee, WI'].filter(Boolean).join(', ');
}

export function googleCalendarUrl(input: CalendarEventInput): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${utcStamp(input.startAt)}/${utcStamp(resolveEnd(input))}`,
    details: `${input.description ?? ''}\n\n${input.url}`.trim(),
    location: location(input),
    ctz: 'America/Chicago',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function buildIcs(input: CalendarEventInput): string {
  const host = new URL(SITE_URL).host;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Radio Milwaukee//Events//EN',
    'BEGIN:VEVENT',
    `UID:${input.slug}@${host}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(input.startAt)}`,
    `DTEND:${utcStamp(resolveEnd(input))}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `LOCATION:${escapeIcsText(location(input))}`,
    `DESCRIPTION:${escapeIcsText(input.description ?? '')}`,
    `URL:${input.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
```

(UTC `Z` times deliberately — no VTIMEZONE block needed, imports cleanly into Apple/Google/Outlook. `DTSTAMP` uses now — tests must not assert it.) Run: `npx vitest run tests/lib` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/display.ts src/lib/card-data.ts src/lib/calendar-links.ts tests/lib
git commit -m "feat: display formatting, card-data loader, add-to-calendar link builders"
```

---

### Task 5: Shared components — EventCard, badges, chips, section headers, marquee

The mockup's EventCard transcribed as a server component, plus the small shared pieces. Pure logic (badges, audience) is TDD; JSX is verified by build + Task 7's live render.

**Files:**
- Create: `src/components/event-card.tsx`, `src/components/card-badges.ts`, `src/components/chip-link.tsx`, `src/components/section-header.tsx`, `src/components/marquee.tsx`
- Test: `tests/components/card-badges.test.ts`

**Interfaces:**
- Consumes: `EventCardMeta` (Task 4), design helpers (Task 1), display helpers (Task 4).
- Produces: `EventCard({ meta, startAt })` (server component; links to `/events/[slug]`); `cardBadges(meta): Array<{ label, bg, fg, strike? }>`; `audienceLabel(audienceTags): string`; `ChipLink({ href, active, children })`; `SectionHeader({ eyebrow?, title, accent?, seeAllHref? })`; `Marquee({ text })`.

- [ ] **Step 1: Badge + audience logic (TDD)**

BEFORE writing: read the enrichment tagging schema (`src/enrichment/` — the Zod schema the tagger emits) and pin the ACTUAL audience vocabulary. The code below assumes tags like `'21+'` and `'family-friendly'` — adjust BOTH test and constants to the real vocabulary, keeping the mapping shape.

```typescript
// tests/components/card-badges.test.ts
import { describe, expect, it } from 'vitest';
import { audienceLabel, cardBadges } from '@/components/card-badges';

const base = {
  eventId: 'e1', slug: 's', title: 'T', venueName: null, neighborhood: null, category: 'music',
  status: 'scheduled', isFree: null, priceMin: null, priceMax: null, audienceTags: [] as string[],
  isStationEvent: false,
};

describe('cardBadges', () => {
  it('orders cancelled > free > station > audience', () => {
    const badges = cardBadges({
      ...base, status: 'cancelled', isFree: true, isStationEvent: true, audienceTags: ['21+'],
    });
    expect(badges.map((badge) => badge.label)).toEqual(['Cancelled', 'Free', 'Radio Milwaukee', '21+']);
    expect(badges[0].strike).toBe(true);
  });
  it('emits nothing for a plain paid event', () => {
    expect(cardBadges(base)).toEqual([]);
  });
});

describe('audienceLabel', () => {
  it('surfaces 21+ and family, defaults to All ages', () => {
    expect(audienceLabel(['21+'])).toBe('21+');
    expect(audienceLabel(['family-friendly'])).toBe('Family');
    expect(audienceLabel([])).toBe('All ages');
  });
});
```

```typescript
// src/components/card-badges.ts
import { CREAM, GOLD, INK, ORANGE, RED } from '@/lib/design';
import type { EventCardMeta } from '@/lib/card-data';

export interface CardBadge {
  label: string;
  bg: string;
  fg: string;
  strike?: boolean;
}

/** VERIFY against src/enrichment tagging schema and adjust these two constants. */
const AGE_RESTRICTED_TAG = '21+';
const FAMILY_TAG = 'family-friendly';

export function audienceLabel(audienceTags: string[]): string {
  if (audienceTags.includes(AGE_RESTRICTED_TAG)) return '21+';
  if (audienceTags.includes(FAMILY_TAG)) return 'Family';
  return 'All ages';
}

export function cardBadges(meta: EventCardMeta): CardBadge[] {
  const badges: CardBadge[] = [];
  if (meta.status === 'cancelled') badges.push({ label: 'Cancelled', bg: INK, fg: CREAM, strike: true });
  if (meta.isFree) badges.push({ label: 'Free', bg: RED, fg: '#FFFFFF' });
  if (meta.isStationEvent) badges.push({ label: 'Radio Milwaukee', bg: ORANGE, fg: INK });
  const audience = audienceLabel(meta.audienceTags);
  if (audience === '21+') badges.push({ label: '21+', bg: INK, fg: CREAM });
  if (audience === 'Family') badges.push({ label: 'Family', bg: GOLD, fg: INK });
  return badges;
}
```

Run: `npx vitest run tests/components/card-badges.test.ts` → PASS.

- [ ] **Step 2: EventCard (mockup EventCard.dc.html, transcribed)**

```tsx
// src/components/event-card.tsx
import Link from 'next/link';
import { accentForCategory, onAccent, priceLabel } from '@/lib/design';
import { chicagoDayShort, chicagoTimeLabel } from '@/lib/display';
import type { EventCardMeta } from '@/lib/card-data';
import { audienceLabel, cardBadges } from '@/components/card-badges';

interface EventCardProps {
  meta: EventCardMeta;
  startAt: Date;
}

export function EventCard({ meta, startAt }: EventCardProps) {
  const accent = accentForCategory(meta.category, meta.isStationEvent);
  const textOnAccent = onAccent(accent);
  return (
    <Link
      href={`/events/${meta.slug}`}
      aria-label={`${meta.title}${meta.venueName ? ` at ${meta.venueName}` : ''}`}
      className="flex h-full flex-col overflow-hidden border-[3px] border-ink bg-cream-raised shadow-[6px_6px_0_#1F2528] transition-[transform,box-shadow] duration-100 hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_#1F2528] active:translate-x-[6px] active:translate-y-[6px] active:shadow-none"
    >
      <div
        className="flex min-h-24 flex-col justify-between border-b-[3px] border-ink px-4 pb-3 pt-3.5"
        style={{ background: accent, color: textOnAccent }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em]">{meta.category ?? 'Event'}</span>
          {meta.isStationEvent && (
            /* eslint-disable-next-line @next/next/no-img-element -- tiny local brand mark, no optimization needed */
            <img
              src="/brand/crescendo-charcoal.png"
              alt=""
              className="h-auto w-11 opacity-90"
              style={textOnAccent === '#F7F1DB' ? { filter: 'brightness(0) invert(1) opacity(0.85)' } : undefined}
            />
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-head text-[26px] uppercase leading-[0.9]">{chicagoDayShort(startAt)}</span>
          <span className="text-[13px] font-bold">{chicagoTimeLabel(startAt)}</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 px-4 pb-4 pt-3.5">
        <div className="flex flex-wrap gap-1.5">
          {cardBadges(meta).map((badge) => (
            <span
              key={badge.label}
              className="inline-block border-2 border-ink px-[7px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.1em]"
              style={{ background: badge.bg, color: badge.fg, textDecoration: badge.strike ? 'line-through' : undefined }}
            >
              {badge.label}
            </span>
          ))}
        </div>
        <h3 className="text-balance text-[19px] font-extrabold leading-[1.08] tracking-[-0.01em] text-ink">
          {meta.title}
        </h3>
        <div className="mt-auto flex flex-col gap-0.5">
          <span className="text-sm font-bold text-ink">{meta.venueName ?? 'Venue TBA'}</span>
          {meta.neighborhood && <span className="text-[12.5px] font-semibold text-ink-muted">{meta.neighborhood}</span>}
        </div>
        <div className="flex items-center gap-2 border-t-2 border-ink/10 pt-2">
          <span className="text-[13px] font-extrabold text-ink">{priceLabel(meta)}</span>
          <span className="text-ink/30">•</span>
          <span className="text-[12.5px] font-semibold text-ink-muted">{audienceLabel(meta.audienceTags)}</span>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: ChipLink, SectionHeader, Marquee**

```tsx
// src/components/chip-link.tsx
import Link from 'next/link';

interface ChipLinkProps {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}

/** Server-rendered facet chip: state lives in the URL, active chips link to their removal. */
export function ChipLink({ href, active = false, children }: ChipLinkProps) {
  const activeClasses = 'bg-rm-orange text-ink shadow-[2px_2px_0_#1F2528]';
  const idleClasses = 'bg-cream text-ink shadow-[2px_2px_0_rgba(31,37,40,0.25)]';
  return (
    <Link
      href={href}
      className={`inline-block border-[3px] border-ink px-[13px] py-[7px] text-[13px] font-extrabold transition-transform duration-100 hover:translate-x-[1px] hover:translate-y-[1px] ${active ? activeClasses : idleClasses}`}
    >
      {children}
    </Link>
  );
}
```

```tsx
// src/components/section-header.tsx
import Link from 'next/link';

interface SectionHeaderProps {
  eyebrow?: string;
  eyebrowColor?: string;
  title: string;
  seeAllHref?: string;
}

export function SectionHeader({ eyebrow, eyebrowColor = '#C9366B', title, seeAllHref }: SectionHeaderProps) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: eyebrowColor }}>
            {eyebrow}
          </span>
        )}
        <h2 className="font-head text-[clamp(26px,3.6vw,44px)] uppercase leading-[0.9]">{title}</h2>
      </div>
      {seeAllHref && (
        <Link href={seeAllHref} className="border-b-[3px] border-rm-orange text-[13px] font-extrabold uppercase tracking-[0.04em] text-ink no-underline hover:text-rm-orange">
          See all →
        </Link>
      )}
    </div>
  );
}
```

```tsx
// src/components/marquee.tsx
interface MarqueeProps {
  text: string;
}

/** Duplicated span + translateX(-50%) loop = seamless ticker (mockup pattern). */
export function Marquee({ text }: MarqueeProps) {
  const strip = `${text}  ///  `;
  return (
    <div className="overflow-hidden whitespace-nowrap border-b-[3px] border-ink bg-ink">
      <div className="inline-block animate-[mke-marquee_26s_linear_infinite] py-[7px]">
        <span className="font-head text-[13px] tracking-[0.06em] text-rm-orange">{strip.repeat(4)}</span>
        <span className="font-head text-[13px] tracking-[0.06em] text-rm-orange">{strip.repeat(4)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npm run test && npm run build` → PASS (components compile; nothing renders them yet).

```bash
git add src/components tests/components
git commit -m "feat: EventCard, badges, chips, section header, marquee components"
```

---

### Task 6: Layout shell — marquee, header, footer, mini-player; site metadata

The persistent frame. The mini-player is a client component mounted in the ROOT LAYOUT above `{children}` — App Router preserves layout state across navigation, which is the entire trick for "keeps playing while you browse."

**Files:**
- Create: `src/components/site-header.tsx`, `src/components/site-footer.tsx`, `src/components/mini-player.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `SITE_NAME`, `SITE_URL`, `SITE_TAGLINE`, `STREAMS`, `StationKey` (Task 1); `Marquee` (Task 5).
- Produces: the sticky shell every page inherits; `metadataBase` + title template.

- [ ] **Step 1: Live-verify the stream URLs (BEFORE building the player)**

```bash
curl -sI "https://wyms.streamguys1.com/live" | head -5
curl -sI "https://wyms.streamguys1.com/hyfin" | head -5
curl -s "https://radiomilwaukee.org" | grep -oiE 'https?://[^"'"'"' ]*stream[^"'"'"' ]*' | sort -u | head
```

Expected: `200` (or a redirect to an audio mount) with an `audio/*` content type. If either URL is wrong, take the real one from the radiomilwaukee.org player source; if still unresolved, STOP and ask Tarik (he works at the station) — do not guess. Update `STREAMS` in `src/lib/site.ts` with verified URLs and note the verification result in the task report.

- [ ] **Step 2: Header and footer (server components)**

```tsx
// src/components/site-header.tsx
import Link from 'next/link';

function LogoLockup() {
  return (
    <span className="flex items-center">
      <span className="border-[3px] border-ink bg-ink px-[11px] pb-1.5 pt-[9px] font-head text-2xl leading-none text-rm-orange">MKE</span>
      <span className="border-[3px] border-l-0 border-ink bg-rm-orange px-[11px] pb-1.5 pt-[9px] font-head text-2xl leading-none text-ink">EVENTS</span>
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-ink bg-cream">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-3">
        <Link href="/" aria-label="Home" className="no-underline">
          <LogoLockup />
        </Link>
        <nav className="flex items-center gap-2.5">
          <Link href="/picks" className="border-[3px] border-transparent px-2.5 py-2 text-sm font-extrabold uppercase tracking-[0.04em] text-ink no-underline hover:border-ink hover:bg-cream-raised">
            Staff picks
          </Link>
          <Link href="/events" className="flex items-center gap-2 border-[3px] border-ink bg-ink px-4 py-2.5 text-sm font-extrabold uppercase tracking-[0.04em] text-cream no-underline shadow-[4px_4px_0_#F8971D] transition-[transform,box-shadow] duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#F8971D]">
            Browse events ⌕
          </Link>
        </nav>
      </div>
    </header>
  );
}
```

NOTE: the logo lockup hardcodes "MKE"/"EVENTS" glyph blocks — this is the ONE sanctioned exception to the SITE_NAME rule, and it must carry a comment pointing at the rename decision: `{/* Rename with SITE_NAME decision — see src/lib/site.ts */}`.

```tsx
// src/components/site-footer.tsx
import Image from 'next/image';
import Link from 'next/link';
import { SITE_TAGLINE } from '@/lib/site';

const DISCOVER_LINKS = [
  { href: '/events/tonight', label: 'Tonight' },
  { href: '/events/this-weekend', label: 'This weekend' },
  { href: '/free-events', label: 'Free events' },
  { href: '/live-music', label: 'Live music' },
  { href: '/events', label: 'Browse all events' },
] as const;

const LISTEN_LINKS = [
  { href: 'https://radiomilwaukee.org', label: '88Nine Radio Milwaukee' },
  { href: 'https://hyfin.org', label: 'HYFIN' },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t-[3px] border-ink bg-ink text-[#C4C8CC]">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-start justify-between gap-7 px-5 py-10">
        <div className="max-w-[340px]">
          <p className="mb-4 text-sm font-medium leading-normal">{SITE_TAGLINE}</p>
          <span className="inline-flex items-center gap-2.5 border-2 border-cream bg-cream px-3 py-2">
            <Image src="/brand/crescendo-charcoal.png" alt="" width={40} height={20} className="h-5 w-auto" />
            <span className="text-xs font-extrabold uppercase tracking-[0.06em] text-ink">Powered by Radio Milwaukee</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-11">
          <FooterColumn title="Discover" links={DISCOVER_LINKS} />
          <FooterColumn title="Listen" links={LISTEN_LINKS} />
        </div>
      </div>
      <div className="border-t border-cream/20 px-5 py-3.5 text-center text-xs font-semibold text-ink-subtle">
        © 2026 · A Radio Milwaukee project · Milwaukee, WI
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: readonly { href: string; label: string }[] }) {
  return (
    <div>
      <div className="mb-2.5 font-head text-base text-cream">{title}</div>
      <div className="flex flex-col gap-[7px] text-sm font-semibold">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="text-[#C4C8CC] no-underline hover:text-rm-orange">
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mini-player (client component)**

```tsx
// src/components/mini-player.tsx
'use client';

import { useRef, useState } from 'react';
import { STREAMS, type StationKey } from '@/lib/site';

const EQ_DELAYS = [0, 0.15, 0.3, 0.45] as const;
const IDLE_HEIGHTS = [16, 9, 13, 6] as const;

export function MiniPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [station, setStation] = useState<StationKey>('88Nine');
  const [playing, setPlaying] = useState(false);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  function switchStation(next: StationKey) {
    const audio = audioRef.current;
    setStation(next);
    if (!audio) return;
    audio.src = STREAMS[next];
    audio.load();
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t-[3px] border-rm-orange bg-ink">
      {/* Live radio stream, no captions to render */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={STREAMS[station]} preload="none" />
      <div className="mx-auto flex max-w-[1240px] items-center gap-3.5 px-3.5 py-[9px]">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause stream' : 'Play stream'}
          className="flex size-[46px] flex-none items-center justify-center border-[3px] border-rm-orange bg-rm-orange text-lg text-ink shadow-[3px_3px_0_rgba(0,0,0,0.4)] transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px]"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="flex h-[22px] w-[26px] flex-none items-end gap-[3px]" aria-hidden>
          {EQ_DELAYS.map((delay, index) => (
            <span
              key={delay}
              className="flex-1 bg-rm-orange"
              style={
                playing
                  ? { animation: `mke-eq 0.7s ease-in-out ${delay}s infinite` }
                  : { height: `${IDLE_HEIGHTS[index]}px` }
              }
            />
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-rm-orange">
            {playing ? 'Now playing' : 'Tap play'}
          </div>
          <div className="truncate text-sm font-bold text-cream">{station} · Listen live</div>
        </div>
        <div className="flex flex-none border-[3px] border-cream">
          {(Object.keys(STREAMS) as StationKey[]).map((key, index) => (
            <button
              key={key}
              type="button"
              onClick={() => switchStation(key)}
              className={`px-3 py-2 text-xs font-extrabold uppercase tracking-[0.04em] ${index > 0 ? 'border-l-[3px] border-cream' : ''} ${station === key ? 'bg-rm-orange text-ink' : 'bg-ink text-cream'}`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Assemble the root layout**

`src/app/layout.tsx` — keep Task 1's font setup and add imports for `Marquee`, `SiteHeader`, `SiteFooter`, `MiniPlayer` (all `@/components/...`) plus `SITE_NAME`/`SITE_TAGLINE`/`SITE_URL`; the metadata and body become:

```tsx
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — ${SITE_TAGLINE}`, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
  openGraph: { siteName: SITE_NAME, type: 'website' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sidewalkBlock.variable} ${aktivGrotesk.variable} ${caveat.variable} flex min-h-screen flex-col bg-cream pb-[76px] antialiased`}>
        <Marquee text="MILWAUKEE'S EVENT RADAR /// POWERED BY RADIO MILWAUKEE /// 88NINE + HYFIN /// FIND YOUR NIGHT" />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <MiniPlayer />
      </body>
    </html>
  );
}
```

(Marquee renders its text via the strip-repeat; pass the plain phrase, the component owns the `///` separators — adjust `Marquee` if the doubled-`///` seam shows.) Add `NEXT_PUBLIC_SITE_URL` to `.env` docs (README env table) but NOT to `.env` itself yet (no deploy exists; default localhost is correct).

- [ ] **Step 5: Live verification**

Run: `npm run typecheck && npm run test && npm run build` → PASS.
`npm run dev` then in a browser: marquee scrolls; header sticks; press play → 88Nine audio starts (real stream); navigate `/events` → `/events/tonight` → `/free-events` — **audio keeps playing across all three navigations** (this is MOO-257 verification-checklist evidence — screenshot/screen-recording note it); switch to HYFIN → stream switches and keeps playing. If autoplay policy blocks the first play, that's expected — it requires the user gesture, which the button provides.

- [ ] **Step 6: Commit**

```bash
git add src/components/site-header.tsx src/components/site-footer.tsx src/components/mini-player.tsx src/app/layout.tsx src/lib/site.ts
git commit -m "feat: layout shell — marquee, header, footer, persistent 88Nine/HYFIN mini-player"
```

---
### Task 7: `/events` restyle — facet chip UI, card grid, day groups, custom range

The browse/search surface rebuilt to the mockup: chip rows for every facet (server-rendered links — state lives in the URL, which keeps everything shareable and crawlable per spec §5), day-grouped EventCard grids, active-filter chips, the "Crickets." zero state.

**Files:**
- Create: `src/app/events/facet-href.ts`, `src/app/events/facet-chips.tsx`, `src/app/events/day-list.tsx`
- Modify: `src/app/events/page.tsx` (rewrite), `src/app/events/{tonight,today,this-weekend}/page.tsx`, `src/app/free-events/page.tsx` (metadata only)
- Create: `src/app/live-music/page.tsx`
- Test: `tests/search/facet-href.test.ts`

**Interfaces:**
- Consumes: Task 2 params (`from`/`to`), Task 4 loader + display, Task 5 components, `CATEGORIES`, `NEIGHBORHOODS`.
- Produces: `buildFacetHref(params, patch): string`; `CardItem { meta: EventCardMeta; startAt: Date }` — the shape `DayList` renders (homepage reuses it).

- [ ] **Step 1: Facet href builder (TDD)**

```typescript
// tests/search/facet-href.test.ts
import { describe, expect, it } from 'vitest';
import { buildFacetHref } from '@/app/events/facet-href';

describe('buildFacetHref', () => {
  it('adds a facet to current params', () => {
    expect(buildFacetHref({ q: 'jazz' }, { cat: 'music' })).toBe('/events?q=jazz&cat=music');
  });
  it('replaces an existing value', () => {
    expect(buildFacetHref({ cat: 'music' }, { cat: 'comedy' })).toBe('/events?cat=comedy');
  });
  it('removes a facet when patched undefined', () => {
    expect(buildFacetHref({ cat: 'music', free: '1' }, { cat: undefined })).toBe('/events?free=1');
  });
  it('yields bare /events when nothing survives', () => {
    expect(buildFacetHref({ cat: 'music' }, { cat: undefined })).toBe('/events');
  });
});
```

```typescript
// src/app/events/facet-href.ts
import type { SearchParams } from './search-params';

export type FacetPatch = Partial<Record<keyof SearchParams, string | undefined>>;

/** URL-state facet navigation: merge current params with a patch; undefined deletes. */
export function buildFacetHref(current: Partial<Record<string, string | number>>, patch: FacetPatch): string {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    if (value !== undefined && value !== '') merged[key] = String(value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  const query = new URLSearchParams(merged).toString();
  return query ? `/events?${query}` : '/events';
}
```

Run: `npx vitest run tests/search/facet-href.test.ts` → PASS.

- [ ] **Step 2: Facet chip rows**

BEFORE writing: check the enrichment tagging schema for the **vibe** vocabulary. If it is a FIXED enum, add `export const VIBES = [...] as const;` to `src/lib/design.ts` from it and render the Vibe row below; if it is open vocabulary, OMIT the Vibe row entirely (param still works via URL) and note that in the task report.

```tsx
// src/app/events/facet-chips.tsx
import { ChipLink } from '@/components/chip-link';
import { CATEGORIES } from '@/lib/design';
import { NEIGHBORHOODS } from '@/lib/neighborhoods';
import { buildFacetHref } from './facet-href';
import type { SearchParams } from './search-params';

const DATE_CHIPS = [
  { label: 'Tonight', value: 'tonight' },
  { label: 'Today', value: 'today' },
  { label: 'This weekend', value: 'this-weekend' },
  { label: 'This week', value: 'this-week' },
] as const;

const AUDIENCE_CHIPS = [
  { label: 'Family', value: 'family-friendly' }, // VERIFY value against enrichment vocabulary (Task 5 Step 1)
  { label: '21+', value: '21+' },
] as const;

const TIME_CHIPS = [
  { label: 'Morning', value: 'morning' },
  { label: 'Afternoon', value: 'afternoon' },
  { label: 'Evening', value: 'evening' },
  { label: 'Late', value: 'night' },
] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-[78px] text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-muted">{label}</span>
      {children}
    </div>
  );
}

export function FacetChips({ params }: { params: SearchParams }) {
  return (
    <div className="flex flex-col gap-3">
      <Row label="When">
        {DATE_CHIPS.map((chip) => (
          <ChipLink
            key={chip.value}
            active={params.date === chip.value}
            href={buildFacetHref(params, { date: params.date === chip.value ? undefined : chip.value, from: undefined, to: undefined })}
          >
            {chip.label}
          </ChipLink>
        ))}
        <ChipLink active={params.free === '1'} href={buildFacetHref(params, { free: params.free === '1' ? undefined : '1' })}>
          Free only
        </ChipLink>
      </Row>
      <Row label="Category">
        {CATEGORIES.filter((category) => category.slug !== 'other').map((category) => (
          <ChipLink
            key={category.slug}
            active={params.cat === category.slug}
            href={buildFacetHref(params, { cat: params.cat === category.slug ? undefined : category.slug })}
          >
            {category.label}
          </ChipLink>
        ))}
      </Row>
      <Row label="Hood">
        {NEIGHBORHOODS.map((hood) => (
          <ChipLink
            key={hood.slug}
            active={params.neighborhood === hood.name}
            href={buildFacetHref(params, { neighborhood: params.neighborhood === hood.name ? undefined : hood.name })}
          >
            {hood.name}
          </ChipLink>
        ))}
      </Row>
      <Row label="Who / When">
        {AUDIENCE_CHIPS.map((chip) => (
          <ChipLink
            key={chip.value}
            active={params.audience === chip.value}
            href={buildFacetHref(params, { audience: params.audience === chip.value ? undefined : chip.value })}
          >
            {chip.label}
          </ChipLink>
        ))}
        {TIME_CHIPS.map((chip) => (
          <ChipLink
            key={chip.value}
            active={params.tod === chip.value}
            href={buildFacetHref(params, { tod: params.tod === chip.value ? undefined : chip.value })}
          >
            {chip.label}
          </ChipLink>
        ))}
      </Row>
      <CustomRange params={params} />
    </div>
  );
}

/** GET form → /events?from=…&to=…; hidden inputs preserve every other active param. */
function CustomRange({ params }: { params: SearchParams }) {
  const preserved = Object.entries(params).filter(
    ([key, value]) => value !== undefined && !['from', 'to', 'date'].includes(key),
  );
  return (
    <form method="get" action="/events" className="flex flex-wrap items-center gap-2">
      <span className="w-[78px] text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-muted">Dates</span>
      {preserved.map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={String(value)} />
      ))}
      <input type="date" name="from" defaultValue={params.from} required aria-label="From date" className="border-[3px] border-ink bg-cream px-2 py-1.5 text-[13px] font-bold" />
      <span className="text-[13px] font-extrabold">→</span>
      <input type="date" name="to" defaultValue={params.to} required aria-label="To date" className="border-[3px] border-ink bg-cream px-2 py-1.5 text-[13px] font-bold" />
      <button type="submit" className="border-[3px] border-ink bg-cream px-[13px] py-[7px] text-[13px] font-extrabold shadow-[2px_2px_0_rgba(31,37,40,0.25)] hover:bg-rm-orange">
        Apply
      </button>
    </form>
  );
}
```

- [ ] **Step 3: DayList with cards + station boost**

```tsx
// src/app/events/day-list.tsx
import { EventCard } from '@/components/event-card';
import { chicagoDayHeading, chicagoDayKey } from '@/lib/display';
import type { EventCardMeta } from '@/lib/card-data';

export interface CardItem {
  meta: EventCardMeta;
  startAt: Date;
}

/** Station events float to the top of their day; slug keeps ties deterministic. */
function byBoostThenTime(a: CardItem, b: CardItem): number {
  if (a.meta.isStationEvent !== b.meta.isStationEvent) return a.meta.isStationEvent ? -1 : 1;
  return a.startAt.getTime() - b.startAt.getTime() || a.meta.slug.localeCompare(b.meta.slug);
}

function groupByDay(items: CardItem[]): Map<string, CardItem[]> {
  const byDay = new Map<string, CardItem[]>();
  for (const item of items) {
    const key = chicagoDayKey(item.startAt);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  return byDay;
}

export function DayList({ items }: { items: CardItem[] }) {
  const groups = [...groupByDay(items).entries()];
  return (
    <div className="flex flex-col gap-9">
      {groups.map(([key, dayItems]) => (
        <section key={key}>
          <div className="mb-4 flex items-center gap-3">
            <h2 className="bg-ink px-3 pb-[5px] pt-2 font-head text-xl uppercase leading-none text-cream">
              {chicagoDayHeading(dayItems[0].startAt)}
            </h2>
            <span className="h-[3px] flex-1 bg-ink" />
            <span className="text-[13px] font-extrabold text-ink-muted">
              {dayItems.length} {dayItems.length === 1 ? 'event' : 'events'}
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(258px,1fr))] gap-5 [grid-auto-rows:1fr]">
            {[...dayItems].sort(byBoostThenTime).map((item) => (
              <EventCard key={`${item.meta.eventId}-${item.startAt.getTime()}`} meta={item.meta} startAt={item.startAt} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `src/app/events/page.tsx`**

Keep the existing data-flow skeleton (`force-dynamic`, awaited `searchParams`, `hasActiveSearchInputs` branch, `fetchSearchResults`, `fetchDefaultListing`) and replace the presentation. The two fetch functions now return `CardItem[]`:

```tsx
import type { Metadata } from 'next';
import { asc, gte } from 'drizzle-orm';
import { db } from '@/db';
import { eventInstances } from '@/db/schema';
import { searchEvents } from '@/search/hybrid';
import { loadCardMeta, type EventCardMeta } from '@/lib/card-data';
import { embedQueryWithTimeout } from './embed-query';
import { FacetChips } from './facet-chips';
import { DayList, type CardItem } from './day-list';
import { buildFacetHref } from './facet-href';
import { hasActiveSearchInputs, parseSearchParams, resolveSearch, type RawSearchParams, type SearchParams } from './search-params';

export const dynamic = 'force-dynamic';

const DEFAULT_LISTING_LIMIT = 100;

export async function generateMetadata({ searchParams }: { searchParams: Promise<RawSearchParams> }): Promise<Metadata> {
  const isFiltered = hasActiveSearchInputs(parseSearchParams(await searchParams));
  return {
    title: 'Browse events',
    description: 'Search and filter every upcoming Milwaukee event.',
    alternates: { canonical: '/events' },
    robots: isFiltered ? { index: false, follow: true } : undefined,
  };
}

/** Browse: one card per INSTANCE (Summerfest shows once per day-group — Decision 3). */
async function fetchDefaultListing(): Promise<CardItem[]> {
  const instances = await db.query.eventInstances.findMany({
    where: gte(eventInstances.startAt, new Date()),
    orderBy: [asc(eventInstances.startAt)],
    limit: DEFAULT_LISTING_LIMIT,
    with: { event: { with: { venue: true } } },
  });
  const metaById = await loadCardMeta(db, [...new Set(instances.map((instance) => instance.eventId))]);
  return instances.flatMap((instance) => {
    const meta = metaById.get(instance.eventId);
    return meta ? [{ meta, startAt: instance.startAt }] : [];
  });
}

/** Search: one card per EVENT at its next start (Decision 3). */
async function fetchSearchResults(rawParams: RawSearchParams, now: Date): Promise<CardItem[]> {
  const parsed = parseSearchParams(rawParams);
  const { text, filters } = resolveSearch(parsed, now);
  const queryEmbedding = await embedQueryWithTimeout(text ?? '');
  const hits = await searchEvents(db, { text, queryEmbedding, filters });
  const metaById = await loadCardMeta(db, hits.map((hit) => hit.eventId));
  return hits.flatMap((hit) => {
    const meta = metaById.get(hit.eventId);
    return meta ? [{ meta, startAt: hit.nextStartAt }] : [];
  });
}

function SearchForm({ query }: { query?: string }) {
  return (
    <form method="get" action="/events" className="flex border-[3px] border-ink bg-cream shadow-[5px_5px_0_#1F2528]">
      <input
        type="text"
        name="q"
        defaultValue={query}
        placeholder="Search or ask — 'free live music tonight in Riverwest'"
        aria-label="Search Milwaukee events"
        className="min-w-0 flex-1 bg-transparent px-4 py-[15px] text-base font-semibold outline-none"
      />
      <button type="submit" className="flex items-center border-l-[3px] border-ink bg-ink px-5 font-head text-lg text-rm-orange hover:bg-black">
        GO ⌕
      </button>
    </form>
  );
}

const ACTIVE_CHIP_DEFS: Array<{ key: keyof SearchParams; label: (value: string) => string }> = [
  { key: 'date', label: (value) => value.replace(/-/g, ' ') },
  { key: 'cat', label: (value) => value },
  { key: 'neighborhood', label: (value) => value },
  { key: 'audience', label: (value) => (value === '21+' ? '21+' : 'Family') },
  { key: 'tod', label: (value) => value },
  { key: 'free', label: () => 'Free' },
  { key: 'from', label: (value) => `from ${value}` },
  { key: 'to', label: (value) => `to ${value}` },
];

function ActiveChips({ params }: { params: SearchParams }) {
  const active = ACTIVE_CHIP_DEFS.filter(({ key }) => params[key] !== undefined);
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {active.map(({ key, label }) => (
        <a key={key} href={buildFacetHref(params, { [key]: undefined })} className="inline-flex items-center gap-1.5 border-2 border-ink bg-rm-orange px-2.5 py-[5px] text-xs font-extrabold no-underline hover:bg-ink hover:text-rm-orange">
          {label(String(params[key]))} ✕
        </a>
      ))}
      <a href="/events" className="border-b-2 border-rm-pink text-xs font-extrabold uppercase tracking-[0.06em] text-rm-pink no-underline">
        Clear all
      </a>
    </div>
  );
}

function ZeroState() {
  return (
    <div className="mx-auto my-5 max-w-[560px] border-[3px] border-dashed border-ink bg-cream-raised px-7 py-14 text-center">
      <div className="mb-3 font-head text-[40px] uppercase leading-[0.9]">Crickets.</div>
      <p className="mb-5 font-semibold text-ink-muted">Nothing on the calendar matches that yet. Loosen a filter, or let the city pick for you.</p>
      <a href="/events" className="inline-block border-[3px] border-ink bg-rm-orange px-5 py-3 text-sm font-extrabold uppercase tracking-[0.04em] text-ink no-underline shadow-[4px_4px_0_#1F2528] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#1F2528]">
        Reset filters
      </a>
    </div>
  );
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const rawParams = await searchParams;
  const params = parseSearchParams(rawParams);
  const isSearchActive = hasActiveSearchInputs(params);
  const items = isSearchActive ? await fetchSearchResults(rawParams, new Date()) : await fetchDefaultListing();

  return (
    <div>
      <div className="border-b-[3px] border-ink bg-cream-raised">
        <div className="mx-auto max-w-[1240px] px-5 pb-5 pt-6">
          <div className="mb-[18px]">
            <SearchForm query={params.q} />
          </div>
          <FacetChips params={params} />
        </div>
      </div>
      <div className="mx-auto max-w-[1240px] px-5 pb-10 pt-[22px]">
        <div className="mb-[22px] flex flex-wrap items-center gap-3.5">
          <span className="font-head text-2xl leading-none">
            {items.length} {items.length === 1 ? 'event' : 'events'}
          </span>
          <ActiveChips params={params} />
        </div>
        {items.length === 0 ? <ZeroState /> : <DayList items={items} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Preset routes get metadata + the new `/live-music`**

Each preset page keeps its delegation pattern and gains its own metadata (canonical = its own path, indexable — these are the SEO landing pages). Example, `src/app/events/tonight/page.tsx`:

```tsx
import type { Metadata } from 'next';
import EventsPage from '../page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tonight in Milwaukee',
  description: 'Everything happening in Milwaukee tonight — live music, comedy, markets, and more.',
  alternates: { canonical: '/events/tonight' },
};

export default function TonightPage() {
  return EventsPage({ searchParams: Promise.resolve({ date: 'tonight' }) });
}
```

Repeat for today ("Today in Milwaukee", canonical `/events/today`), this-weekend ("This weekend in Milwaukee", `/events/this-weekend`), free-events ("Free events in Milwaukee", `/free-events`). New `src/app/live-music/page.tsx` delegates `{ cat: 'music' }` with title "Live music in Milwaukee", canonical `/live-music` (Decision 11).

- [ ] **Step 6: Verify live + commit**

Run: `npm run typecheck && npm run test && npm run build` → PASS.
`npm run dev` live probes: `/events` renders chips + day-grouped cards against production data; click Category→Music chip → URL becomes `/events?cat=music`, count changes; Free only chip toggles; custom range applies (`from`/`to` in URL, groups restricted); `/events?q=free+jazz+this+weekend` resolves free facet + window; `/live-music` renders; zero-state via `/events?q=zzzznope`; every card links to `/events/[slug]` (404s until Task 8 — expected).

```bash
git add src/app/events src/app/free-events src/app/live-music tests/search/facet-href.test.ts
git commit -m "feat: /events restyle — facet chips, card grid day groups, custom range, live-music route"
```

---

### Task 8: Event detail page — `/events/[slug]`, add-to-calendar, JSON-LD

The page MOO-257's verification checklist lives on: accent hero, all upcoming dates, venue sidebar, Google Calendar deep link + downloadable .ics, related events, Event JSON-LD.

**Files:**
- Create: `src/queries/event-detail.ts`, `src/lib/event-jsonld.ts`, `src/app/events/[slug]/page.tsx`, `src/app/events/[slug]/ics/route.ts`
- Test: `tests/lib/event-jsonld.test.ts`, `tests/queries/event-detail.test.ts`

**Interfaces:**
- Consumes: Tasks 4–5 modules; `venues.slug` (Task 3).
- Produces: `getEventBySlug(db, slug)` → `{ event, venue, instances, sourceName } | null`; `relatedEvents(db, args)` → `CardItem[]`; `buildEventJsonLd(args)` → serializable object array.
- **Route precedence note:** `/events/tonight|today|this-weekend` are STATIC segments and win over `[slug]` — no collision (Next.js static-over-dynamic precedence), but event slugs always carry an 8-hex hash suffix so a real collision is impossible anyway.

- [ ] **Step 1: Detail query (PGlite TDD)**

```typescript
// src/queries/event-detail.ts
import { and, asc, eq, gte } from 'drizzle-orm';
import { eventInstances, events } from '@/db/schema';
import type { Db } from '@/lib/card-data';

export async function getEventBySlug(db: Db, slug: string) {
  const event = await db.query.events.findFirst({
    where: eq(events.slug, slug),
    with: {
      venue: true,
      instances: { where: gte(eventInstances.startAt, new Date()), orderBy: [asc(eventInstances.startAt)] },
      sourceLinks: { with: { source: true } },
    },
  });
  if (!event) return null;
  const canonical = event.sourceLinks.find((link) => link.isCanonical);
  return { event, venue: event.venue, instances: event.instances, sourceName: canonical?.source?.name ?? null };
}
```

VERIFY the relation names (`instances`, `sourceLinks`, `source`) against `src/db/schema.ts` relations and adjust; if `eventSourceLinks` lacks a `source` relation, add it to the schema relations (additive). Test: seed event + venue + two instances (one past, one future) + canonical link; assert only the future instance returns, sourceName resolves; unknown slug → null.

For related events, reuse the search layer (browse mode, no new SQL):

```typescript
import { searchEvents } from '@/search/hybrid';
import { loadCardMeta } from '@/lib/card-data';
import type { CardItem } from '@/app/events/day-list';

const RELATED_LIMIT = 3;

/** Same category first; falls back to same neighborhood; excludes the event itself. */
export async function relatedEvents(
  db: Db,
  args: { eventId: string; category: string | null; neighborhood: string | null },
): Promise<CardItem[]> {
  const filters = args.category ? { category: args.category } : args.neighborhood ? { neighborhood: args.neighborhood } : {};
  const hits = await searchEvents(db, { filters, limit: RELATED_LIMIT + 1 });
  const kept = hits.filter((hit) => hit.eventId !== args.eventId).slice(0, RELATED_LIMIT);
  const metaById = await loadCardMeta(db, kept.map((hit) => hit.eventId));
  return kept.flatMap((hit) => {
    const meta = metaById.get(hit.eventId);
    return meta ? [{ meta, startAt: hit.nextStartAt }] : [];
  });
}
```

- [ ] **Step 2: JSON-LD builder (TDD)**

```typescript
// tests/lib/event-jsonld.test.ts
import { describe, expect, it } from 'vitest';
import { buildEventJsonLd } from '@/lib/event-jsonld';

const args = {
  title: 'Jazz in the Park',
  description: 'Golden hour horns.',
  status: 'scheduled',
  imageUrl: 'https://cdn.example.com/jazz.jpg',
  isFree: true,
  priceMin: null as string | null,
  canonicalUrl: 'https://easttown.com/jazz',
  isStationEvent: false,
  venueName: 'Cathedral Square Park',
  venueAddress: '520 E Wells St, Milwaukee, WI',
  url: 'https://example.com/events/jazz-in-the-park-abc12345',
  instances: [
    { startAt: new Date('2026-07-09T23:00:00Z'), endAt: new Date('2026-07-10T02:00:00Z') },
    { startAt: new Date('2026-07-16T23:00:00Z'), endAt: null },
  ],
};

describe('buildEventJsonLd', () => {
  it('emits one Event per instance (Google-recommended for recurring)', () => {
    const jsonLd = buildEventJsonLd(args);
    expect(jsonLd).toHaveLength(2);
    expect(jsonLd[0]['@type']).toBe('Event');
    expect(jsonLd[0].startDate).toBe('2026-07-09T23:00:00.000Z');
    expect(jsonLd[0].endDate).toBe('2026-07-10T02:00:00.000Z');
    expect(jsonLd[1].endDate).toBeUndefined();
    expect(jsonLd[0].location).toEqual({
      '@type': 'Place',
      name: 'Cathedral Square Park',
      address: '520 E Wells St, Milwaukee, WI',
    });
    expect(jsonLd[0].offers).toEqual({
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      url: 'https://easttown.com/jazz',
      availability: 'https://schema.org/InStock',
    });
  });
  it('maps cancelled status and caps at 10 instances', () => {
    const many = { ...args, status: 'cancelled', instances: Array.from({ length: 12 }, (_, index) => ({ startAt: new Date(Date.UTC(2026, 6, 9 + index)), endAt: null })) };
    const jsonLd = buildEventJsonLd(many);
    expect(jsonLd).toHaveLength(10);
    expect(jsonLd[0].eventStatus).toBe('https://schema.org/EventCancelled');
  });
  it('adds Radio Milwaukee as organizer for station events', () => {
    expect(buildEventJsonLd({ ...args, isStationEvent: true })[0].organizer).toEqual({
      '@type': 'Organization',
      name: 'Radio Milwaukee',
      url: 'https://radiomilwaukee.org',
    });
  });
});
```

```typescript
// src/lib/event-jsonld.ts
const STATUS_MAP: Record<string, string> = {
  scheduled: 'https://schema.org/EventScheduled',
  cancelled: 'https://schema.org/EventCancelled',
  postponed: 'https://schema.org/EventPostponed',
};

const MAX_INSTANCES = 10;

export interface EventJsonLdArgs {
  title: string;
  description: string | null;
  status: string;
  imageUrl: string | null;
  isFree: boolean | null;
  priceMin: string | null;
  canonicalUrl: string | null;
  isStationEvent: boolean;
  venueName: string | null;
  venueAddress: string | null;
  url: string;
  instances: Array<{ startAt: Date; endAt: Date | null }>;
}

function offers(args: EventJsonLdArgs): Record<string, unknown> | undefined {
  const price = args.isFree ? '0' : args.priceMin ?? undefined;
  if (price === undefined) return undefined;
  return {
    '@type': 'Offer',
    price,
    priceCurrency: 'USD',
    url: args.canonicalUrl ?? args.url,
    availability: 'https://schema.org/InStock',
  };
}

function baseEvent(args: EventJsonLdArgs): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: args.title,
    description: args.description ?? undefined,
    image: args.imageUrl ?? undefined,
    eventStatus: STATUS_MAP[args.status] ?? STATUS_MAP.scheduled,
    location: { '@type': 'Place', name: args.venueName ?? 'Milwaukee', address: args.venueAddress ?? 'Milwaukee, WI' },
    url: args.url,
    offers: offers(args),
    organizer: args.isStationEvent
      ? { '@type': 'Organization', name: 'Radio Milwaukee', url: 'https://radiomilwaukee.org' }
      : undefined,
  };
}

/** One Event object per upcoming instance — Google's recommended shape for recurring events. */
export function buildEventJsonLd(args: EventJsonLdArgs): Array<Record<string, unknown>> {
  return args.instances.slice(0, MAX_INSTANCES).map((instance) => ({
    ...baseEvent(args),
    startDate: instance.startAt.toISOString(),
    endDate: instance.endAt?.toISOString(),
  }));
}
```

Run: `npx vitest run tests/lib/event-jsonld.test.ts` → PASS.

- [ ] **Step 3: The detail page**

```tsx
// src/app/events/[slug]/page.tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { getEventBySlug, relatedEvents } from '@/queries/event-detail';
import { buildEventJsonLd } from '@/lib/event-jsonld';
import { googleCalendarUrl, type CalendarEventInput } from '@/lib/calendar-links';
import { accentForCategory, onAccent, priceLabel } from '@/lib/design';
import { neighborhoodByName } from '@/lib/neighborhoods';
import { chicagoDateLabel, chicagoTimeLabel } from '@/lib/display';
import { SITE_URL } from '@/lib/site';
import { EventCard } from '@/components/event-card';
import { audienceLabel, cardBadges } from '@/components/card-badges';
import { loadCardMeta } from '@/lib/card-data';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getEventBySlug(db, slug);
  if (!detail) return { title: 'Event not found' };
  return {
    title: detail.event.title,
    description: detail.event.summary ?? detail.event.description?.slice(0, 160) ?? undefined,
    alternates: { canonical: `/events/${slug}` },
    openGraph: detail.event.imageUrl ? { images: [detail.event.imageUrl] } : undefined,
  };
}

function calendarInput(detail: NonNullable<Awaited<ReturnType<typeof getEventBySlug>>>, startAt: Date, endAt: Date | null): CalendarEventInput {
  return {
    slug: detail.event.slug,
    title: detail.event.title,
    description: detail.event.summary ?? detail.event.description,
    venueName: detail.venue?.name ?? null,
    venueAddress: detail.venue?.address ?? null,
    startAt,
    endAt,
    url: `${SITE_URL}/events/${detail.event.slug}`,
  };
}

export default async function EventDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getEventBySlug(db, slug);
  if (!detail || detail.instances.length === 0) notFound();

  const { event, venue, instances, sourceName } = detail;
  const metaById = await loadCardMeta(db, [event.id]);
  const meta = metaById.get(event.id);
  if (!meta) notFound();

  const accent = accentForCategory(event.category, event.isStationEvent);
  const textOnAccent = onAccent(accent);
  const next = instances[0];
  const related = await relatedEvents(db, {
    eventId: event.id,
    category: event.category,
    neighborhood: venue?.neighborhood ?? null,
  });
  const hood = venue?.neighborhood ? neighborhoodByName(venue.neighborhood) : undefined;
  const jsonLd = buildEventJsonLd({
    title: event.title,
    description: event.summary ?? event.description,
    status: event.status,
    imageUrl: event.imageUrl,
    isFree: event.isFree,
    priceMin: event.priceMin,
    canonicalUrl: event.canonicalUrl,
    isStationEvent: event.isStationEvent,
    venueName: venue?.name ?? null,
    venueAddress: venue?.address ?? null,
    url: `${SITE_URL}/events/${event.slug}`,
    instances: instances.map((instance) => ({ startAt: instance.startAt, endAt: instance.endAt })),
  });

  return (
    <div className="mx-auto max-w-[1080px] px-5 pb-12 pt-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Link href="/events" className="mb-5 inline-block border-[3px] border-ink bg-cream px-3 py-2 text-[13px] font-extrabold uppercase tracking-[0.04em] no-underline shadow-[3px_3px_0_#1F2528] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0_#1F2528]">
        ← All events
      </Link>

      <div className="mb-[26px] border-[3px] border-ink p-7 shadow-[8px_8px_0_#1F2528]" style={{ background: accent, color: textOnAccent }}>
        <div className="mb-4 flex flex-wrap gap-2">
          {cardBadges(meta).map((badge) => (
            <span key={badge.label} className="inline-block border-2 border-ink px-2.5 py-[5px] text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ background: badge.bg, color: badge.fg, textDecoration: badge.strike ? 'line-through' : undefined }}>
              {badge.label}
            </span>
          ))}
        </div>
        <h1 className="mb-3.5 text-balance font-head text-[clamp(34px,6vw,68px)] uppercase leading-[0.9] tracking-[-0.01em]">
          {event.title}
        </h1>
        <div className="flex flex-wrap items-baseline gap-5">
          <span className="text-lg font-extrabold">
            {chicagoDateLabel(next.startAt)} · {chicagoTimeLabel(next.startAt)}
          </span>
          <span className="text-[15px] font-bold opacity-70">Central Time (Chicago)</span>
        </div>
      </div>

      <div className="grid items-start gap-[26px] md:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-6">
          {(event.description ?? event.summary) && (
            <div>
              <h3 className="mb-2.5 font-head text-xl uppercase">The rundown</h3>
              <p className="whitespace-pre-line text-base font-medium leading-relaxed text-[#3A4146]">
                {event.description ?? event.summary}
              </p>
            </div>
          )}
          {instances.length > 1 && (
            <div>
              <h3 className="mb-3 font-head text-xl uppercase">All dates</h3>
              <ul className="flex flex-col gap-2">
                {instances.map((instance) => (
                  <li key={instance.id} className="flex flex-wrap items-center gap-3 border-2 border-ink bg-cream-raised px-3 py-2">
                    <span className="text-sm font-extrabold">{chicagoDateLabel(instance.startAt)}</span>
                    <span className="text-sm font-semibold text-ink-muted">{chicagoTimeLabel(instance.startAt)}</span>
                    <a href={googleCalendarUrl(calendarInput(detail, instance.startAt, instance.endAt))} target="_blank" rel="noopener" className="ml-auto text-xs font-extrabold uppercase text-rm-blue underline">
                      + Google Cal
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {related.length > 0 && (
            <div>
              <h3 className="mb-3 font-head text-xl uppercase">More like this</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[18px] [grid-auto-rows:1fr]">
                {related.map((item) => (
                  <EventCard key={item.meta.eventId} meta={item.meta} startAt={item.startAt} />
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4 md:sticky md:top-[92px]">
          <div className="border-[3px] border-ink bg-cream p-[18px] shadow-[5px_5px_0_#1F2528]">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-rm-pink">Venue</span>
            <div className="mb-1 mt-1.5 font-head text-2xl uppercase leading-[0.95]">
              {venue?.slug ? (
                <Link href={`/venues/${venue.slug}`} className="no-underline hover:text-rm-orange">{venue.name}</Link>
              ) : (
                venue?.name ?? 'Venue TBA'
              )}
            </div>
            {hood && (
              <Link href={`/neighborhoods/${hood.slug}`} className="mt-1.5 inline-flex items-center gap-1.5 border-2 border-ink bg-rm-blue px-2 py-1 text-xs font-extrabold text-cream no-underline">
                ◈ {hood.name}
              </Link>
            )}
            {venue?.address && <div className="mt-3 text-sm font-semibold text-ink-muted">{venue.address}</div>}
            <div className="mt-3.5 flex flex-wrap gap-3.5">
              <div>
                <span className="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-subtle">Price</span>
                <span className="text-base font-extrabold">{priceLabel(meta)}</span>
              </div>
              <div>
                <span className="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-subtle">Ages</span>
                <span className="text-base font-extrabold">{audienceLabel(meta.audienceTags)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 border-[3px] border-ink bg-cream p-[18px] shadow-[5px_5px_0_#1F2528]">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-rm-pink">Add to calendar</span>
            <a href={googleCalendarUrl(calendarInput(detail, next.startAt, next.endAt))} target="_blank" rel="noopener" className="border-[3px] border-ink bg-rm-orange px-3.5 py-3 text-center text-sm font-extrabold uppercase tracking-[0.03em] text-ink no-underline shadow-[3px_3px_0_#1F2528] transition-[transform,box-shadow] duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0_#1F2528]">
              Google Calendar
            </a>
            <a href={`/events/${event.slug}/ics`} className="border-[3px] border-ink bg-ink px-3.5 py-3 text-center text-sm font-extrabold uppercase tracking-[0.03em] text-cream no-underline shadow-[3px_3px_0_#F8971D] transition-[transform,box-shadow] duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0_#F8971D]">
              Download .ics
            </a>
          </div>

          <div className="flex flex-col gap-1 px-1 text-xs font-semibold text-ink-subtle">
            {sourceName && <span>Source: {sourceName}</span>}
            {event.canonicalUrl && (
              <a href={event.canonicalUrl} target="_blank" rel="noopener" className="text-ink-subtle underline">
                Official event page ↗
              </a>
            )}
            {event.category && (
              <Link href={`/categories/${event.category}`} className="text-ink-subtle underline">
                More {event.category} events
              </Link>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
```

Also create the app-level 404 (`src/app/not-found.tsx`) — the "Crickets." block from Task 7 with copy "That page wandered off." and links to `/` and `/events` (repeat the JSX, don't import across route groups).

- [ ] **Step 4: The .ics route handler**

```typescript
// src/app/events/[slug]/ics/route.ts
import { z } from 'zod';
import { db } from '@/db';
import { getEventBySlug } from '@/queries/event-detail';
import { buildIcs } from '@/lib/calendar-links';
import { SITE_URL } from '@/lib/site';

const startParam = z.iso.datetime({ offset: true }).optional().catch(undefined);

/** GET /events/[slug]/ics[?start=ISO] — downloads the next (or selected) instance as .ics. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const detail = await getEventBySlug(db, slug);
  if (!detail || detail.instances.length === 0) return new Response('Not found', { status: 404 });

  const requestedStart = startParam.parse(new URL(request.url).searchParams.get('start') ?? undefined);
  const instance =
    (requestedStart && detail.instances.find((candidate) => candidate.startAt.toISOString() === requestedStart)) ??
    detail.instances[0];

  const ics = buildIcs({
    slug: detail.event.slug,
    title: detail.event.title,
    description: detail.event.summary ?? detail.event.description,
    venueName: detail.venue?.name ?? null,
    venueAddress: detail.venue?.address ?? null,
    startAt: instance.startAt,
    endAt: instance.endAt,
    url: `${SITE_URL}/events/${detail.event.slug}`,
  });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${detail.event.slug}.ics"`,
    },
  });
}
```

(Zod 4: `z.iso.datetime` — verify the exact namespace in the installed zod; fall back to `z.string().datetime({ offset: true })` if the alias differs.)

- [ ] **Step 5: Verify live + commit**

Run: `npm run typecheck && npm run test && npm run build` → PASS.
Live probes (`npm run dev`, real slugs from production): detail renders (single- AND multi-instance events — find a Summerfest-style one); `curl -s localhost:3000/events/<slug>/ics | head -20` → valid VCALENDAR; Google link opens pre-filled (spot-check title/time/location in the URL); JSON-LD present in page source (`curl -s localhost:3000/events/<slug> | grep -o 'application/ld+json'`); bogus slug → styled 404.

```bash
git add src/queries src/lib/event-jsonld.ts src/app/events/\[slug\] src/app/not-found.tsx src/db/schema.ts tests/lib/event-jsonld.test.ts tests/queries
git commit -m "feat: event detail page — add-to-calendar (Google + .ics), JSON-LD, related events"
```

---
### Task 9: Entity routes — `/venues/[slug]`, `/categories/[slug]`, `/neighborhoods/[slug]`, `/picks`

The internal-linking mesh: every entity page filters the same listing engine and links back across entities.

**Files:**
- Create: `src/app/venues/[slug]/page.tsx`, `src/app/categories/[slug]/page.tsx`, `src/app/neighborhoods/[slug]/page.tsx`, `src/app/picks/page.tsx`, `src/queries/picks.ts`
- Test: `tests/queries/picks.test.ts`

**Interfaces:**
- Consumes: `EventsPage` delegation pattern (preset precedent), `venues.slug`, `NEIGHBORHOODS`, `CATEGORIES`, `staffPicks` (Task 3), `chicagoWeekMonday` (Task 4).
- Produces: `picksForWeek(db, weekOf)` → array of `{ pick, meta, nextStartAt }`.

- [ ] **Step 1: Category and neighborhood pages (registry-validated delegation)**

```tsx
// src/app/categories/[slug]/page.tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CATEGORIES } from '@/lib/design';
import EventsPage from '../../events/page';

export const dynamic = 'force-dynamic';

function categoryBySlug(slug: string) {
  return CATEGORIES.find((candidate) => candidate.slug === slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const category = categoryBySlug((await params).slug);
  if (!category) return { title: 'Category not found' };
  return {
    title: `${category.label} events in Milwaukee`,
    description: `Every upcoming ${category.label.toLowerCase()} event in Milwaukee, updated daily.`,
    alternates: { canonical: `/categories/${category.slug}` },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!categoryBySlug(slug)) notFound();
  return EventsPage({ searchParams: Promise.resolve({ cat: slug }) });
}
```

`src/app/neighborhoods/[slug]/page.tsx` — identical shape: `neighborhoodBySlug(slug)` from the registry, 404 when unknown, delegates `{ neighborhood: hood.name }`, metadata title `` `${hood.name} events` ``, canonical `/neighborhoods/${slug}` (transcribe fully — same structure with the neighborhood lookups).

- [ ] **Step 2: Venue page**

```tsx
// src/app/venues/[slug]/page.tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import { eventInstances, venues } from '@/db/schema';
import { loadCardMeta } from '@/lib/card-data';
import { neighborhoodByName } from '@/lib/neighborhoods';
import { DayList, type CardItem } from '../../events/day-list';

export const dynamic = 'force-dynamic';

async function getVenue(slug: string) {
  return db.query.venues.findFirst({ where: eq(venues.slug, slug) });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const venue = await getVenue((await params).slug);
  if (!venue) return { title: 'Venue not found' };
  return {
    title: `Events at ${venue.name}`,
    description: `Upcoming events at ${venue.name}${venue.neighborhood ? ` in ${venue.neighborhood}` : ''}, Milwaukee.`,
    alternates: { canonical: `/venues/${venue.slug}` },
  };
}

async function upcomingAtVenue(venueId: string): Promise<CardItem[]> {
  const instances = await db.query.eventInstances.findMany({
    where: gte(eventInstances.startAt, new Date()),
    orderBy: [asc(eventInstances.startAt)],
    limit: 60,
    with: { event: true },
  });
  const atVenue = instances.filter((instance) => instance.event.venueId === venueId);
  const metaById = await loadCardMeta(db, [...new Set(atVenue.map((instance) => instance.eventId))]);
  return atVenue.flatMap((instance) => {
    const meta = metaById.get(instance.eventId);
    return meta ? [{ meta, startAt: instance.startAt }] : [];
  });
}

export default async function VenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const venue = await getVenue((await params).slug);
  if (!venue) notFound();
  const items = await upcomingAtVenue(venue.id);
  const hood = venue.neighborhood ? neighborhoodByName(venue.neighborhood) : undefined;

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-10 pt-8">
      <div className="mb-8 border-[3px] border-ink bg-cream-raised p-7 shadow-[6px_6px_0_#1F2528]">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-rm-pink">Venue</span>
        <h1 className="mt-1.5 font-head text-[clamp(30px,5vw,56px)] uppercase leading-[0.9]">{venue.name}</h1>
        {venue.address && <p className="mt-2 text-sm font-semibold text-ink-muted">{venue.address}</p>}
        {hood && (
          <Link href={`/neighborhoods/${hood.slug}`} className="mt-3 inline-flex items-center gap-1.5 border-2 border-ink bg-rm-blue px-2 py-1 text-xs font-extrabold text-cream no-underline">
            ◈ {hood.name}
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="font-semibold text-ink-muted">Nothing upcoming here right now — check <Link href="/events">all events</Link>.</p>
      ) : (
        <DayList items={items} />
      )}
    </div>
  );
}
```

(The instance query filters by venue in TS after a bounded fetch — if it proves wasteful at higher volume, a where-on-relation is the Phase 5 refinement; do NOT hand-roll new SQL here.)

- [ ] **Step 3: Picks query (PGlite TDD) + `/picks` page**

```typescript
// src/queries/picks.ts
import { asc, eq } from 'drizzle-orm';
import { staffPicks } from '@/db/schema';
import { loadCardMeta, type Db, type EventCardMeta } from '@/lib/card-data';

export interface PickWithEvent {
  id: string;
  curatorName: string;
  curatorRole: string | null;
  showUrl: string | null;
  blurb: string;
  meta: EventCardMeta;
  nextStartAt: Date | null;
}

export async function picksForWeek(db: Db, weekOf: string): Promise<PickWithEvent[]> {
  const picks = await db.query.staffPicks.findMany({
    where: eq(staffPicks.weekOf, weekOf),
    orderBy: [asc(staffPicks.sortOrder)],
    with: { event: { with: { instances: true } } },
  });
  const metaById = await loadCardMeta(db, picks.map((pick) => pick.eventId));
  return picks.flatMap((pick) => {
    const meta = metaById.get(pick.eventId);
    if (!meta) return [];
    const upcoming = pick.event.instances
      .filter((instance) => instance.startAt.getTime() >= Date.now())
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    return [{
      id: pick.id,
      curatorName: pick.curatorName,
      curatorRole: pick.curatorRole,
      showUrl: pick.showUrl,
      blurb: pick.blurb,
      meta,
      nextStartAt: upcoming[0]?.startAt ?? null,
    }];
  });
}
```

Test: seed event + instance + two picks in different weeks; assert only the requested week returns, ordered by sortOrder. VERIFY the `staffPicks` relation to events (add `instances` to the events relation include path per schema relations).

`src/app/picks/page.tsx` — mockup's staff-pick card at full-page scale:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db';
import { picksForWeek } from '@/queries/picks';
import { chicagoDateLabel, chicagoWeekMonday } from '@/lib/display';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Staff picks',
  description: 'What Radio Milwaukee DJs and hosts are actually going to this week.',
  alternates: { canonical: '/picks' },
};

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();
}

export default async function PicksPage() {
  const picks = await picksForWeek(db, chicagoWeekMonday(new Date()));
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-12 pt-10">
      <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.16em] text-rm-pink">Curated by our DJs</span>
      <h1 className="mb-8 font-head text-[clamp(32px,5vw,56px)] uppercase leading-[0.9]">Staff picks this week</h1>
      {picks.length === 0 ? (
        <p className="font-semibold text-ink-muted">This week's picks are still brewing — check back Thursday.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-[22px]">
          {picks.map((pick) => (
            <Link key={pick.id} href={`/events/${pick.meta.slug}`} className="flex flex-col overflow-hidden border-[3px] border-ink bg-cream no-underline shadow-[6px_6px_0_#1F2528] transition-[transform,box-shadow] duration-100 hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_#1F2528]">
              <div className="flex items-center gap-3.5 border-b-[3px] border-ink bg-rm-orange p-4">
                <span className="flex size-[52px] flex-none items-center justify-center border-[3px] border-ink bg-cream font-head text-xl">
                  {initials(pick.curatorName)}
                </span>
                <div className="min-w-0">
                  <div className="text-base font-extrabold text-ink">{pick.curatorName}</div>
                  {pick.curatorRole && <div className="text-xs font-bold uppercase tracking-[0.08em] text-ink">{pick.curatorRole}</div>}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-3.5 p-[18px]">
                <p className="font-accent text-[23px] leading-[1.15] text-ink">{pick.blurb}</p>
                <div className="mt-auto border-t-2 border-ink/15 pt-3">
                  <div className="text-base font-extrabold leading-tight text-ink">{pick.meta.title}</div>
                  <div className="mt-1 text-[13px] font-semibold text-ink-muted">
                    {pick.meta.venueName}
                    {pick.nextStartAt && ` · ${chicagoDateLabel(pick.nextStartAt)}`}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

(`showUrl` — the curator's show link — renders on the homepage module in Task 10 where the mockup places it; keep the field flowing through `PickWithEvent` here.)

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npm run test && npm run build` → PASS.
Live probes: `/categories/music` renders filtered listing; `/categories/nope` → 404; `/neighborhoods/bay-view` renders (empty until Task 13's assignment run — zero-state is correct for now); `/venues/<slug>` 404s until Task 13's backfill (also correct — note it); `/picks` renders empty-state.

```bash
git add src/app/venues src/app/categories src/app/neighborhoods src/app/picks src/queries/picks.ts src/db/schema.ts tests/queries/picks.test.ts
git commit -m "feat: venue, category, neighborhood, and staff-picks routes"
```

---

### Task 10: Homepage, newsletter capture, weekly digest

The front door (mockup home layout: hero search + five modules) plus the two newsletter surfaces.

**Files:**
- Create: `src/queries/home.ts`, `src/app/actions/newsletter.ts`, `src/components/newsletter-form.tsx`, `src/app/digest/page.tsx`
- Modify: `src/app/page.tsx` (full replacement — it is still create-next-app boilerplate)
- Test: `tests/queries/home.test.ts`, `tests/actions/newsletter.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `homeData(db, now)` → `{ tonight, weekend, station, picks, neighborhoodCounts }`; `subscribeAction(prevState, formData)` server action returning `{ ok: boolean; message: string }`.

- [ ] **Step 1: Home queries (PGlite TDD)**

```typescript
// src/queries/home.ts
import { and, asc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { eventInstances, events, venues } from '@/db/schema';
import { presetWindow } from '@/search/query-understanding';
import { loadCardMeta, type Db } from '@/lib/card-data';
import { chicagoWeekMonday } from '@/lib/display';
import { picksForWeek, type PickWithEvent } from '@/queries/picks';
import type { CardItem } from '@/app/events/day-list';

const MODULE_LIMIT = 6;

async function windowItems(db: Db, window: { start: Date; end: Date }, limit: number): Promise<CardItem[]> {
  const instances = await db.query.eventInstances.findMany({
    where: and(gte(eventInstances.startAt, window.start), lt(eventInstances.startAt, window.end)),
    orderBy: [asc(eventInstances.startAt)],
    limit,
    with: { event: true },
  });
  const metaById = await loadCardMeta(db, [...new Set(instances.map((instance) => instance.eventId))]);
  return instances.flatMap((instance) => {
    const meta = metaById.get(instance.eventId);
    return meta ? [{ meta, startAt: instance.startAt }] : [];
  });
}

async function stationItems(db: Db, now: Date, limit: number): Promise<CardItem[]> {
  const rows = await db
    .select({ eventId: eventInstances.eventId, startAt: sql<Date>`min(${eventInstances.startAt})`.as('next_start') })
    .from(eventInstances)
    .innerJoin(events, eq(eventInstances.eventId, events.id))
    .where(and(gte(eventInstances.startAt, now), eq(events.isStationEvent, true)))
    .groupBy(eventInstances.eventId)
    .orderBy(sql`next_start ASC`)
    .limit(limit);
  const metaById = await loadCardMeta(db, rows.map((row) => row.eventId));
  return rows.flatMap((row) => {
    const meta = metaById.get(row.eventId);
    return meta ? [{ meta, startAt: new Date(row.startAt) }] : [];
  });
}

export interface NeighborhoodCount {
  name: string;
  count: number;
}

async function neighborhoodCounts(db: Db, now: Date): Promise<NeighborhoodCount[]> {
  const rows = await db
    .select({ name: venues.neighborhood, count: sql<number>`count(distinct ${eventInstances.eventId})` })
    .from(eventInstances)
    .innerJoin(events, eq(eventInstances.eventId, events.id))
    .innerJoin(venues, eq(events.venueId, venues.id))
    .where(and(gte(eventInstances.startAt, now), isNotNull(venues.neighborhood)))
    .groupBy(venues.neighborhood);
  return rows.flatMap((row) => (row.name ? [{ name: row.name, count: Number(row.count) }] : []));
}

export interface HomeData {
  tonight: CardItem[];
  weekend: CardItem[];
  station: CardItem[];
  picks: PickWithEvent[];
  hoods: NeighborhoodCount[];
}

export async function homeData(db: Db, now: Date): Promise<HomeData> {
  const [tonight, weekend, station, picks, hoods] = await Promise.all([
    windowItems(db, presetWindow('tonight', now), MODULE_LIMIT),
    windowItems(db, presetWindow('this-weekend', now), MODULE_LIMIT + 2),
    stationItems(db, now, MODULE_LIMIT),
    picksForWeek(db, chicagoWeekMonday(now)),
    neighborhoodCounts(db, now),
  ]);
  return { tonight, weekend, station, picks, hoods };
}
```

Test (PGlite): seed a tonight instance, a weekend instance, a station event, a pick, and a venue with neighborhood; assert each module surfaces the right rows (use a fixed `now` and instances placed relative to it).

- [ ] **Step 2: Newsletter server action (TDD) + form**

```typescript
// src/app/actions/newsletter.ts
'use server';

import { z } from 'zod';
import { db } from '@/db';
import { newsletterSubscribers } from '@/db/schema';

const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  source: z.string().max(40).optional(),
});

export interface SubscribeState {
  ok: boolean;
  message: string;
}

export async function subscribeAction(_prev: SubscribeState, formData: FormData): Promise<SubscribeState> {
  const parsed = subscribeSchema.safeParse({
    email: formData.get('email'),
    source: formData.get('source') ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: 'Enter a valid email to join.' };
  try {
    await db.insert(newsletterSubscribers).values(parsed.data).onConflictDoNothing();
    return { ok: true, message: "You're in — first issue lands Thursday." };
  } catch {
    return { ok: false, message: 'Something hiccuped — try again in a minute.' };
  }
}
```

(Zod 4 email: `z.email()` — verify the installed API; `z.string().email()` if the top-level alias is absent.) Extract the validation+insert into a testable helper if mocking `db` fights the `'use server'` module — the PGlite test targets the helper: valid email inserts; duplicate is idempotent-ok; garbage rejects with the friendly message.

```tsx
// src/components/newsletter-form.tsx
'use client';

import { useActionState } from 'react';
import { subscribeAction, type SubscribeState } from '@/app/actions/newsletter';

const initialState: SubscribeState = { ok: false, message: '' };

export function NewsletterForm({ source }: { source: string }) {
  const [state, formAction, pending] = useActionState(subscribeAction, initialState);
  return (
    <form action={formAction} className="flex min-w-[280px] max-w-[360px] flex-1 flex-col gap-2.5">
      <input type="hidden" name="source" value={source} />
      <div className="flex border-[3px] border-ink bg-cream shadow-[4px_4px_0_#1F2528]">
        <input
          type="email"
          name="email"
          required
          placeholder="you@milwaukee.com"
          aria-label="Email address"
          className="min-w-0 flex-1 bg-transparent px-3.5 py-[13px] text-[15px] font-semibold text-ink outline-none"
        />
        <button type="submit" disabled={pending} className="flex items-center border-l-[3px] border-ink bg-rm-orange px-[18px] font-head text-base text-ink hover:bg-ink hover:text-rm-orange disabled:opacity-60">
          {pending ? '…' : 'JOIN'}
        </button>
      </div>
      <span aria-live="polite" className="min-h-4 text-xs font-bold text-cream">{state.message}</span>
    </form>
  );
}
```

- [ ] **Step 3: Homepage (`src/app/page.tsx`, full replacement)**

Structure (transcribe the mockup home sections with the components already built — hero, then modules; skip any module whose data is empty):

```tsx
import { db } from '@/db';
import { homeData } from '@/queries/home';
import { EventCard } from '@/components/event-card';
import { SectionHeader } from '@/components/section-header';
import { NewsletterForm } from '@/components/newsletter-form';
import { NEIGHBORHOODS, neighborhoodByName } from '@/lib/neighborhoods';
import { onAccent } from '@/lib/design';
import { chicagoDateLabel } from '@/lib/display';
import Link from 'next/link';
import Image from 'next/image';

export const dynamic = 'force-dynamic';

const HERO_CHIPS = [
  { label: 'Tonight', href: '/events/tonight' },
  { label: 'This weekend', href: '/events/this-weekend' },
  { label: 'Free events', href: '/free-events' },
  { label: 'Family friendly', href: '/events?audience=family-friendly' },
  { label: 'Live music', href: '/live-music' },
] as const;

export default async function HomePage() {
  const data = await homeData(db, new Date());
  return (
    <div>
      <Hero />
      {data.picks.length > 0 && <PicksModule picks={data.picks} />}
      {data.tonight.length > 0 && <CardModule title="Tonight" seeAllHref="/events/tonight" items={data.tonight} live />}
      {data.weekend.length > 0 && <CardModule title="This weekend" seeAllHref="/events/this-weekend" items={data.weekend} />}
      {data.station.length > 0 && <StationModule items={data.station} />}
      <HoodsModule hoods={data.hoods} />
      <NewsletterModule />
    </div>
  );
}
```

Then transcribe each module from the mockup (all in this file until it nears 300 lines — then split `src/app/home-modules.tsx`). **Controller: attach the mockup's home-section markup (`MKE Events.dc.html` lines 63–190) to this task's dispatch brief — the implementer transcribes from it, not from imagination:**

- `Hero`: orange band (`bg-rm-orange`, `border-b-[3px] border-ink`), date badge (`chicagoDateLabel(new Date())` — server-rendered, Chicago), `h1` "What's happening in Milwaukee?" in `font-head clamp(40px,7vw,86px)`, subline, the GET `/events` search form (reuse Task 7's `SearchForm` — export it from a shared spot or inline the same markup), `HERO_CHIPS` as shadowed chip links.
- `CardModule`: `SectionHeader` (the `live` variant renders the red pulse dot from the mockup next to "Tonight") + card grid `repeat(auto-fill,minmax(258px,1fr))`.
- `PicksModule`: `SectionHeader` eyebrow "Curated by our DJs" + the `/picks` card markup (Task 9) capped at 3 + see-all → `/picks`; curator `showUrl` renders as a small "Their show ↗" external link when present.
- `StationModule`: full-bleed `bg-ink` band, crescendo mark inverted (`brightness(0) invert(1)`), "Radio Milwaukee events" head in cream, "Station presents" orange badge, intro line, card grid.
- `HoodsModule`: registry tiles (accent bg via `neighborhoodByName`, `onAccent` text, count from `hoods` by name — tiles with 0 events still render, count hidden) linking `/neighborhoods/[slug]`.
- `NewsletterModule`: pink (`bg-rm-pink`) box, `border-[3px] border-ink shadow-[8px_8px_0_#1F2528]`, "Every Thursday" ink badge, "This weekend in MKE" head, blurb, `<NewsletterForm source="homepage" />`.

Metadata: the root layout default carries the homepage title; add `alternates: { canonical: '/' }` via a metadata export.

- [ ] **Step 4: Digest page**

```tsx
// src/app/digest/page.tsx
import type { Metadata } from 'next';
import { db } from '@/db';
import { picksForWeek } from '@/queries/picks';
import { homeData } from '@/queries/home';
import { chicagoDateLabel, chicagoTimeLabel, chicagoWeekMonday } from '@/lib/display';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'This Weekend in MKE — weekly digest',
  robots: { index: false, follow: false },
};

/** Copy-paste source for the station's ESP: picks + weekend highlights, plain structure, no chrome. */
export default async function DigestPage() {
  const now = new Date();
  const [picks, data] = await Promise.all([picksForWeek(db, chicagoWeekMonday(now)), homeData(db, now)]);
  const highlights = [...data.weekend].sort((a, b) => Number(b.meta.isStationEvent) - Number(a.meta.isStationEvent)).slice(0, 5);
  return (
    <div className="mx-auto max-w-[720px] px-5 pb-16 pt-10">
      <h1 className="font-head text-4xl uppercase leading-[0.9]">This Weekend in MKE</h1>
      <p className="mt-2 text-sm font-semibold text-ink-muted">Auto-assembled {chicagoDateLabel(now)} — paste into the newsletter and edit freely.</p>
      <h2 className="mt-8 font-head text-2xl uppercase">Staff picks</h2>
      {picks.map((pick) => (
        <div key={pick.id} className="mt-4 border-l-4 border-rm-orange pl-4">
          <p className="font-accent text-xl">“{pick.blurb}” — {pick.curatorName}</p>
          <p className="text-sm font-bold">
            {pick.meta.title} · {pick.meta.venueName}
            {pick.nextStartAt && ` · ${chicagoDateLabel(pick.nextStartAt)} ${chicagoTimeLabel(pick.nextStartAt)}`}
          </p>
        </div>
      ))}
      <h2 className="mt-8 font-head text-2xl uppercase">Weekend highlights</h2>
      <ul className="mt-4 flex flex-col gap-3">
        {highlights.map((item) => (
          <li key={`${item.meta.eventId}-${item.startAt.getTime()}`} className="text-sm">
            <span className="font-extrabold">{item.meta.title}</span>
            {' — '}{item.meta.venueName} · {chicagoDateLabel(item.startAt)} {chicagoTimeLabel(item.startAt)}
            {item.meta.isFree ? ' · Free' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Verify live + commit**

Run: `npm run typecheck && npm run test && npm run build` → PASS.
Live: `/` renders hero + populated modules against production (station + picks modules hidden — data lands in Task 13; correct); newsletter form with a test email → success message → row visible in Neon (`SELECT * FROM newsletter_subscribers`) → delete the test row; duplicate submit stays friendly; `/digest` renders.

```bash
git add src/app/page.tsx src/app/digest src/app/actions src/components/newsletter-form.tsx src/queries/home.ts tests/queries/home.test.ts tests/actions
git commit -m "feat: homepage modules, newsletter capture, weekly digest page"
```

---
### Task 11: SEO layer — split sitemaps, robots, canonical audit

JSON-LD and canonicals shipped with their pages; this task adds the crawl surface and audits the whole mesh.

**Files:**
- Create: `src/app/sitemap.ts`, `src/app/robots.ts`
- Test: `tests/lib/sitemap-data.test.ts` (if data helpers are extracted), otherwise build-time + curl verification

**Interfaces:**
- Consumes: `SITE_URL`, `CATEGORIES`, `NEIGHBORHOODS`, events/venues tables.
- Produces: `/sitemap/[id].xml` (split: core, events, venues, taxonomy), `/robots.txt`.

- [ ] **Step 1: Read the Next 16 sitemap doc, then implement**

Read `node_modules/next/dist/docs/.../01-metadata/sitemap.md` FIRST — v16 changed `generateSitemaps` (the `id` param is a Promise in the sitemap function; confirm the exact signature and URL shape `/sitemap/[id].xml` from the doc, not from memory).

```typescript
// src/app/sitemap.ts
import type { MetadataRoute } from 'next';
import { gte, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { eventInstances, venues } from '@/db/schema';
import { CATEGORIES } from '@/lib/design';
import { NEIGHBORHOODS } from '@/lib/neighborhoods';
import { SITE_URL } from '@/lib/site';

const SECTION_IDS = ['core', 'events', 'venues', 'taxonomy'] as const;

export async function generateSitemaps() {
  return SECTION_IDS.map((id) => ({ id }));
}

const CORE_PATHS = ['/', '/events', '/events/tonight', '/events/today', '/events/this-weekend', '/free-events', '/live-music', '/picks'];

function entry(path: string, lastModified?: Date): MetadataRoute.Sitemap[number] {
  return { url: `${SITE_URL}${path}`, lastModified };
}

async function eventEntries(): Promise<MetadataRoute.Sitemap> {
  const instances = await db.query.eventInstances.findMany({
    where: gte(eventInstances.startAt, new Date()),
    with: { event: { columns: { slug: true, updatedAt: true } } },
    limit: 5000,
  });
  const bySlug = new Map(instances.map((instance) => [instance.event.slug, instance.event.updatedAt]));
  return [...bySlug.entries()].map(([slug, updatedAt]) => entry(`/events/${slug}`, updatedAt));
}

async function venueEntries(): Promise<MetadataRoute.Sitemap> {
  const rows = await db.query.venues.findMany({ columns: { slug: true }, where: isNotNull(venues.slug) });
  return rows.flatMap((row) => (row.slug ? [entry(`/venues/${row.slug}`)] : []));
}

function taxonomyEntries(): MetadataRoute.Sitemap {
  return [
    ...CATEGORIES.map((category) => entry(`/categories/${category.slug}`)),
    ...NEIGHBORHOODS.map((hood) => entry(`/neighborhoods/${hood.slug}`)),
  ];
}

export default async function sitemap({ id }: { id: Promise<(typeof SECTION_IDS)[number]> }): Promise<MetadataRoute.Sitemap> {
  const section = await id;
  if (section === 'events') return eventEntries();
  if (section === 'venues') return venueEntries();
  if (section === 'taxonomy') return taxonomyEntries();
  return CORE_PATHS.map((path) => entry(path));
}
```

(If the doc shows a different `id` signature than `Promise<…>`, the DOC WINS — transcribe its exact pattern.)

```typescript
// src/app/robots.ts
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/digest'] }],
    sitemap: ['core', 'events', 'venues', 'taxonomy'].map((id) => `${SITE_URL}/sitemap/${id}.xml`),
  };
}
```

- [ ] **Step 2: Canonical + internal-link audit (checklist, fix inline)**

Verify each renders the right canonical (curl the dev server, grep `rel="canonical"`): `/` → `/`; `/events` → `/events` (filtered variants too, plus `noindex` when filtered); presets → own path; detail/venue/category/neighborhood/picks → own path; `/digest` → noindex. Internal-link mesh: card→event; event→venue, →neighborhood, →category, →source; venue→neighborhood + its events; footer→presets + live-music. Any missing link = fix in this task.

- [ ] **Step 3: Verify + commit**

Run: `npm run build` → PASS. Dev-server curls: `/robots.txt` lists 4 sitemaps; `/sitemap/core.xml`, `/sitemap/events.xml`, `/sitemap/venues.xml`, `/sitemap/taxonomy.xml` each return valid XML (venues empty until Task 13 backfill — structurally valid is the bar).

```bash
git add src/app/sitemap.ts src/app/robots.ts
git commit -m "feat: split sitemaps, robots, canonical + internal-link audit"
```

---

### Task 12: Playwright E2E — the five MOO-257 flows

**Files:**
- Create: `playwright.config.ts`, `e2e/search.spec.ts`, `e2e/filter.spec.ts`, `e2e/detail.spec.ts`, `e2e/presets.spec.ts`, `e2e/newsletter.spec.ts`
- Modify: `package.json` (devDep + `"e2e": "playwright test"` script), `.gitignore` (`playwright-report/`, `test-results/`)

**Interfaces:**
- Consumes: the live dev server against production Neon (Decision 8) — assertions must be resilient to shifting data (counts ≥ 1, structural selectors, no hardcoded event titles).

- [ ] **Step 1: Install + config**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: 1,
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/events',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

(Vitest is untouched: its include is `tests/**/*.test.ts`; Playwright owns `e2e/*.spec.ts`.)

- [ ] **Step 2: The five specs**

```typescript
// e2e/search.spec.ts
import { expect, test } from '@playwright/test';

test('search returns day-grouped results', async ({ page }) => {
  await page.goto('/events');
  await page.getByLabel('Search Milwaukee events').fill('music this weekend');
  await page.getByRole('button', { name: /GO/ }).click();
  await expect(page).toHaveURL(/q=music\+this\+weekend/);
  await expect(page.locator('a[href^="/events/"]').first()).toBeVisible();
  await expect(page.getByText(/\d+ events?/).first()).toBeVisible();
});
```

```typescript
// e2e/filter.spec.ts
import { expect, test } from '@playwright/test';

test('facet chips filter via the URL', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('link', { name: 'Free only' }).click();
  await expect(page).toHaveURL(/free=1/);
  await page.getByRole('link', { name: 'Music', exact: true }).click();
  await expect(page).toHaveURL(/cat=music/);
  await expect(page).toHaveURL(/free=1/); // chips preserve each other
  await page.getByRole('link', { name: 'Clear all' }).click();
  await expect(page).toHaveURL(/\/events$/);
});
```

```typescript
// e2e/detail.spec.ts
import { expect, test } from '@playwright/test';

test('event detail carries calendar links and JSON-LD', async ({ page }) => {
  await page.goto('/events');
  await page.locator('main a[href^="/events/"]:not([href*="tonight"]):not([href*="today"]):not([href*="this-weekend"])').first().click();
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Google Calendar' })).toHaveAttribute('href', /calendar\.google\.com/);
  await expect(page.getByRole('link', { name: /Download \.ics/i })).toHaveAttribute('href', /\/ics$/);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
});

test('the ics endpoint serves a calendar file', async ({ page, request }) => {
  await page.goto('/events');
  const href = await page.locator('main a[href^="/events/"]:not([href*="tonight"]):not([href*="today"]):not([href*="this-weekend"])').first().getAttribute('href');
  const response = await request.get(`${href}/ics`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/calendar');
  expect(await response.text()).toContain('BEGIN:VEVENT');
});
```

```typescript
// e2e/presets.spec.ts
import { expect, test } from '@playwright/test';

for (const path of ['/events/tonight', '/events/this-weekend']) {
  test(`${path} renders the preset landing`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText(/\d+ events?/).first()).toBeVisible(); // zero is a valid count — page must render, not error
    await expect(page.locator('h2, [class*="font-head"]').first()).toBeVisible();
  });
}
```

```typescript
// e2e/newsletter.spec.ts
import { neon } from '@neondatabase/serverless';
import { expect, test } from '@playwright/test';

test('newsletter capture stores and thanks', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto('/');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'JOIN' }).click();
  await expect(page.getByText(/You're in/)).toBeVisible();

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`SELECT id FROM newsletter_subscribers WHERE email = ${email}`;
  expect(rows).toHaveLength(1);
  await sql`DELETE FROM newsletter_subscribers WHERE email = ${email}`; // leave prod clean
});
```

(Playwright doesn't auto-load `.env` — if `process.env.DATABASE_URL` is empty in specs, load it in the config via `import 'dotenv/config'` or read `.env` with the same mechanism the repo's other CLIs use; check how `npm run ingest` gets it and mirror.)

- [ ] **Step 3: Run + commit**

Run: `npx playwright test` → 6 passing (5 files). Flaky-once is acceptable (retry configured); consistently failing = fix the app or the selector, never loosen an assertion to vacuous.

```bash
git add playwright.config.ts e2e package.json package-lock.json .gitignore
git commit -m "test: Playwright E2E — search, filter, detail+ics, presets, newsletter"
```

---

### Task 13: Production data ship — migrate, backfills, seeds, README

Everything the pages need in production, in dependency order. **Controller-run steps** (live prod writes; the norm for this project's ship tasks).

- [ ] **Step 1:** `npm run db:migrate` against production → 0012, 0013 applied. Verify: `staff_picks`, `newsletter_subscribers`, `venues.slug` exist in Neon.
- [ ] **Step 2:** `npm run venues:backfill-slugs` → every venue slugged; spot-check `/venues/pabst-theater` (or whatever the report prints) on the dev server.
- [ ] **Step 3:** Complete `VENUE_NEIGHBORHOODS` against the live venue list (`SELECT normalized_name, address FROM venues ORDER BY 1`), commit the curated map, run `npm run venues:assign-neighborhoods`. Report: mapped/unmapped counts (unmapped venues are fine — they just miss hood pages). Verify `/neighborhoods/bay-view` now lists events.
- [ ] **Step 4:** `npm run station:flag -- --dry-run` → review the would-flag list with Tarik's ruling in hand → run live if ruling (a). Verify the homepage station module renders.
- [ ] **Step 5:** Seed this week's picks with Tarik's input (or 3 sensible placeholders flagged for his edit): `npm run picks:add -- --slug <slug> --curator "…" --role "…" --blurb "…"` ×3. Verify `/picks` + homepage module.
- [ ] **Step 6:** README: routes table, new env (`NEXT_PUBLIC_SITE_URL`), newsletter/digest workflow (capture → digest page → paste into ESP), SEO notes (per-instance JSON-LD strategy, split sitemaps, `maxPrice` undocumented-facet note), staff-picks CLI usage, station-flag policy as ruled.
- [ ] **Step 7:** `npm run test && npm run typecheck && npm run build && npx playwright test` → all green. Commit README + map: `git add README.md src/maintenance/venue-neighborhood-map.ts && git commit -m "docs: phase-4 ship — README, curated neighborhood map"`.

---

### Task 14: Close-out — MOO-257 verification checklist evidence

Collect the proof the Linear issue demands. Controller-run.

- [ ] **Google Rich Results test** on 3 real event URLs (needs a public URL: use the test's code-snippet mode with page source pasted, since no deploy exists yet — paste each page's rendered HTML) → screenshots, zero errors on the Event entities.
- [ ] **Add-to-calendar:** download a real `.ics` → import into Apple Calendar (correct title/time/venue in Central Time); open the Google link → prefilled correctly → screenshots.
- [ ] **Mini-player:** play 88Nine → navigate 3 pages → still playing; switch HYFIN → screenshot/recording note.
- [ ] **Lighthouse:** `npx lighthouse http://localhost:3000 --preset=desktop --only-categories=performance,seo` (against `npm run build && npm start`, NOT dev) + same for one event page → record LCP + SEO scores in the report. SEO ≥ 90 expected; LCP judged against the production build locally.
- [ ] **E2E:** `npx playwright test` output captured.
- [ ] Ledger close-out entry; evidence comment on MOO-257 (numbers + screenshots + what's deferred). **Done only if every acceptance criterion is genuinely evidenced** — RetroUI Pro (credential-pending) and the Vercel deploy (Tarik's call, out of scope here) are named explicitly in the comment if still open, and the issue stays In Progress in that case (MOO-256 precedent).

---

## Execution notes for the controller

- Task order is dependency order: 1→2→3→4→5→6→7→8→9→10→11→12→13→14. Tasks 2 and 3 can run in parallel after 1; 5 needs 4; 7 needs 5+6; everything UI-facing needs 1.
- Implementer model per task: haiku for verbatim transcription tasks (5, 6, 9), sonnet for anything investigative (2, 3, 7, 8, 10, 11, 12). Dispatch prompts MUST carry the Interfaces blocks of consumed tasks (fresh agents have no context).
- Tarik-gated: Decision 2 (station flag) before Task 13 Step 4; picks content before 13 Step 5; brand name blocks nothing (SITE_NAME constant).
- `.env` warning stands: NEVER hand-edit without re-checking the alias keys (TICKETMASTER_API_KEY, EVENTBRITE_PRIVATE_TOKEN survived one loss already).





