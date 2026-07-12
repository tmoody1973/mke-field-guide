# Homepage LCP — Stream the Shell + woff2 Fonts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut homepage LCP from 4.5s (Lighthouse mobile, measured 2026-07-12; perf 83, LCP score 0.37 — the only red metric: FCP 1.0s, TBT 50ms, CLS 0) to ≤2.5s by fixing the two measured causes: (1) the page awaits ALL of `homeData`'s DB queries before emitting any HTML, so the static hero `<h1>` — the LCP element, per `lcp-breakdown-insight`: TTFB 255ms + element render delay 2,126ms — waits on the database on every request; (2) ~970KB of raw OTF font payload (four Aktiv Grotesk weights at ~270KB each, all preloaded) competes for mobile bandwidth during the render window.

**Architecture:** Two independent fixes. **Streaming:** `HomePage` stops awaiting; it renders `<Hero />` (and everything static) immediately and moves the whole data-driven module block behind ONE `<Suspense>` boundary whose async child does the `await homeData(...)`. The shell (marquee/header/hero) streams at TTFB; modules pop in when queries land. `force-dynamic` stays — streaming makes the caching question moot for LCP, and the Chicago-day freshness semantics stay byte-identical. **Fonts:** convert the five self-hosted OTFs to woff2 (lossless repack, ~65% smaller), point `next/font/local` at them. No visual change — same glyphs, same `display: swap`.

**Tech stack note (repo rule):** This repo's Next.js may differ from training data — the implementer MUST read the relevant guides in `node_modules/next/dist/docs/` (streaming/Suspense + `next/font`) before writing code, and verify `dynamic = 'force-dynamic'` still streams with Suspense in this version.

## Global Constraints

- **NO PRODUCTION WRITES during implementation.** Ship-only: `vercel deploy --prod`. NO db changes, NO trigger:deploy (nothing task-reachable changes — but verify by diff at ship: if anything under `src/{maintenance,ingestion,enrichment,dedup,trigger}/` changed, the dual-deploy rule fires).
- **Zero data-shape changes:** `homeData`, `src/queries/home.ts`, and all module components' props are FROZEN. This slice moves WHERE the await happens, nothing else. Module render ORDER and conditional rendering (`data.picks.length > 0 && …`) stay byte-identical inside the async child.
- **SEO invariants:** metadata export, canonical alternate, JSON-LD (none on homepage today), and the h1 text stay byte-identical. The hero must stream in the initial shell — a reviewer finding the h1 inside the Suspense fallback path = Critical.
- **CLS budget:** currently 0. The Suspense fallback must not shift the hero (fallback = min-height-reserved skeleton or empty block below the hero — implementer picks per existing skeleton idioms, reviewer checks CLS stays 0 in the ship Lighthouse run).
- **Fonts:** conversion must be lossless repack (fonttools/woff2 class tooling), same family names, same weights/styles, `display: swap` unchanged; delete nothing — keep the OTFs in `src/fonts/` (git history is not a backup for licensed font binaries). Aktiv Grotesk is a licensed font already self-hosted; format conversion for the same self-hosting use is within that posture — flag to Tarik at ship, don't block.
- `git add` scoped; `-A` forbidden. `.env*` untouched. Frozen: everything outside `src/app/page.tsx`, `src/app/layout.tsx`, `src/fonts/` (additions only), and the new async-modules component + tests.
- Gates: `npm run test`, `npm run typecheck`, `npm run build`, `npm run e2e` — plus ship-step Lighthouse evidence (before/after JSON already captured: perf 0.83 / LCP 4.5s baseline in the session scratchpad; re-run same command post-deploy).

## Decisions

1. **One Suspense boundary around all data modules** (not per-module): preserves module order deterministically, one fallback, no waterfall of pop-ins. The async child component (`HomeModules`, server component in `src/app/page.tsx` or a sibling file) owns the single `await homeData(db, new Date())`.
2. **`force-dynamic` unchanged.** Caching/ISR is a separate product ruling; streaming alone delivers the LCP win. (Recorded as a future option: `revalidate` on the modules once Cache Components semantics are ruled on.)
3. **woff2 for all five font files** (4× Aktiv + Sidewalk Block; Caveat is Google-hosted via `next/font/google`, untouched). Expected: ~970KB → ~300KB.
4. **No hero redesign, no priority hints, no preload tweaks beyond the format swap.** If LCP is still >2.5s after these two fixes, that's a NEW measurement conversation, not scope creep here.

### Task 1: Stream the shell — Suspense boundary around the data modules

**Files:**
- Modify: `src/app/page.tsx`
- Test: `tests/app/home-page.test.tsx` (create — a render-shape test asserting Hero renders outside Suspense and modules render from awaited data; mirror the repo's existing component-test idioms if any exist, else a lightweight RTL server-component test; if the repo has no RTL setup, a build-time assertion via e2e is the fallback — implementer reports which)

**Steps:**
- [ ] Read `node_modules/next/dist/docs/` streaming + Suspense guide; confirm `force-dynamic` + Suspense streams in this Next version (report the doc section in your report).
- [ ] Extract the awaited block: `async function HomeModules()` does `const data = await homeData(db, new Date());` and returns the exact current module JSX (conditionals byte-identical). `HomePage` becomes sync: `<Hero />` + `<Suspense fallback={…}><HomeModules /></Suspense>`.
- [ ] Fallback: reserve-nothing-visible skeleton below the hero (CLS 0 rule).
- [ ] Test → typecheck → `npm run build` → commit `feat: stream homepage shell — hero paints before data queries`.

### Task 2: woff2 fonts

**Files:**
- Create: `src/fonts/*.woff2` (5 files)
- Modify: `src/app/layout.tsx` (paths only)

**Steps:**
- [ ] Convert with fonttools (`pip3 install --user fonttools brotli` if absent; `fonttools ttLib.woff2 compress -o out.woff2 in.otf` per file — CFF-flavored OTF is supported). Record before/after byte sizes per file in your report.
- [ ] Update `localFont` src paths to `.woff2`. Nothing else in layout.tsx changes.
- [ ] `npm run build` + visual sanity via e2e run (fonts load, no 404s in build output) → commit `perf: repack self-hosted fonts as woff2 (~970KB → ~300KB)`.

### Task 3: Gates + ship

- [ ] Full gates quiet machine: test / typecheck / build / e2e.
- [ ] Ship (finishing pass, controller): merge FF → push → `vercel deploy --prod` → Lighthouse mobile re-run (same command as baseline) → record perf/LCP/CLS before-after in evidence → close the slice issue (create at execution start).
- [ ] If any task-reachable path changed (should be NONE): `npm run trigger:deploy` per standing rule.

## Verification summary

- LCP element (hero h1) paints at shell time, independent of DB latency (Task 1); font payload no longer saturates the mobile render window (Task 2).
- Honest before/after: baseline perf 0.83 / LCP 4.5s / CLS 0 (2026-07-12, local Lighthouse mobile, simulated throttle). Target LCP ≤2.5s; report whatever the number actually is.
- Zero behavior change: same data, same order, same conditionals, same fonts (repacked), same freshness semantics.
