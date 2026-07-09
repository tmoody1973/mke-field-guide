# Phase 5 Slice 1: Clerk Admin + Staff-Picks Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first slice of MOO-258 ("Phase 5: Admin & quality tools") per Tarik's explicit sequencing ruling — Clerk auth gating a new `/admin` area with a staff-picks manager that replaces the `picks:add` CLI: search/browse events, click-to-pick, blurb + curator fields, week selector, edit/delete. The dedup review queue (with per-pair survivor picker + M2/M3/M4 fixes), source health dashboard, and event editor are Slices 2–3 and get their own plans.

**Architecture:** Clerk lives ENTIRELY inside the `/admin` segment — `ClerkProvider` in `src/app/admin/layout.tsx` (not the root layout: keeps Clerk JS off the public site, whose homepage LCP is already a 4.8s polish item, and keeps the public build independent of Clerk env). `src/proxy.ts` (Next 16 renamed middleware → proxy; Clerk docs 2026-07-09 confirm `clerkMiddleware()` in `proxy.ts` on Next 16+) runs ONLY on `/admin(.*)`. Authorization is resource-level per Clerk's current guidance (their middleware reference now deprecates `createRouteMatcher` route-gating): every admin page calls `requireStaff()`, every mutation action re-checks `currentStaffRole()`. Access control = app-side email allowlist envs (Clerk's native Allowlist is paid-in-production; app-side is free, unit-testable, and defense-in-depth), with two tiers: `admin` (everything) and `picks` (picks manager only — the DJ tier Tarik leaned yes on; if he declines, the picks env list just stays empty, zero code change). The picks manager reuses the existing read path (`picksForWeek`, `searchEvents` text-only/FTS, `loadCardMeta`) and mirrors the repo's proven server-action pattern (pure DB-injected function + thin `'use server'` wrapper + `useActionState` envelope). **No new tables, no migrations — this slice writes zero DDL.**

**Tech Stack:** Next.js 16.2.10 App Router / React 19.2.4 / `@clerk/nextjs` ^7.5.15 (peer range includes ^16.0.10 — verified against npm 2026-07-09) / Drizzle 0.45.2 on Neon HTTP / Zod 4 / Tailwind v4 + vendored RetroUI (`src/components/ui/`) + design tokens (`src/lib/design.ts`, globals.css) / Vitest 4 + PGlite / Playwright.

## Global Constraints

Every task's requirements implicitly include all of these:

- **NO PRODUCTION WRITES of any kind.** This slice has no migrations and no backfills. Production picks rows get created only by humans through the deployed UI after ship. Live prod **reads** (dev server against prod Neon) remain the norm.
- **`git add` with scoped paths only. `git add -A` is forbidden.**
- **`.env` edits are append-only.** The Ticketmaster/Eventbrite alias-loss precedent stands. Same for `.env.example`.
- ANY date logic goes through `src/lib/chicago-time.ts` / `src/lib/display.ts` helpers or `Intl.DateTimeFormat` with explicit `timeZone: 'America/Chicago'`. The UTC-vs-Chicago family has shipped bugs in three consecutive phases; zero tolerance. **`chicagoWeekMonday` lives in `src/lib/display.ts`** (NOT chicago-time.ts) — import from `@/lib/display`; do not write another copy (`add-staff-pick.ts` already has a private duplicate; don't add a third).
- **`'use server'` files may export ONLY async functions.** Types/interfaces live in plain modules (the `subscribe.ts` / `newsletter.ts` two-file split is the repo pattern — copy it). An `export type` re-export typechecks fine and then throws ReferenceError at runtime under Next 16/Turbopack.
- Next.js 16: `params`/`searchParams` arrive as **Promises** — always `await`. Verify any uncertain API against `node_modules/next/dist/docs/` (repo AGENTS.md mandate), not training data.
- All Clerk API usage in this plan was verified against clerk.com docs fetched 2026-07-09 (`@clerk/nextjs` 7.5.15). If anything disagrees at execution time, re-fetch the doc and follow the live doc; note the deviation in your report.
- Zod at every boundary: searchParams, form/server-action inputs, env parsing. Zod 4 idioms (`z.email()`, `z.uuid()`, `z.url()`, `z.iso.date()`).
- Secrets env-only. New env (all appended to `.env.example` in Task 1): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `ADMIN_ALLOWLIST_EMAILS`, `PICKS_ALLOWLIST_EMAILS`.
- Tests on PGlite only (`tests/helpers/test-db.ts` `createTestDb()` replays `drizzle/*.sql` name-sorted). vitest config is `maxWorkers: 2`, `hookTimeout: 45_000` — PGlite boots ~12s each; do NOT "fix" slow boots by loosening config, and verify full-suite runs on a quiet machine (per-file runs are always trustworthy).
- **Frozen invariants:** `src/search/hybrid.ts` is eval-baselined (9/10 hit@3, p95 76.1ms) and is consumed READ-ONLY here — zero edits; trigger-maintained `search_tsv`; enrichment-owned columns + `isStationEvent` stay out of `eventFields` in persist.ts; `maintainLink` isCanonical guard; jsonld fallback-id format; day-instance pattern.
- Neon HTTP driver: no transactions; multi-row writes ordered recoverably.
- Logic functions ≤ 20 lines; files focused (≤ ~300 lines). Match existing naming/idiom; comments only for constraints code can't show.
- Site name only via `SITE_NAME` (`src/lib/site.ts`).
- Admin pages must never be indexable: layout metadata `robots: noindex` + robots.txt disallow (Task 1).
- Implementers: **scrutinize this plan's code, don't transcribe blindly** — 14 plan-authored defects were caught by reviewers in Phase 4. Where a step says "verify against X first," that verification is part of the step.

**Commands:** `npm run test` / `npm run typecheck` / `npm run build` / `npx vitest run <file>` / `npm run e2e` (Task 7).

## Prerequisites (Tarik-owned — surface, don't block coding)

1. **Clerk application + keys.** Code and unit tests need no keys; local dev can use Clerk **keyless mode** (auto-generated dev keys on first run). Before merge/deploy Tarik must create the Clerk app (free plan OK) and provide `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` → append to `.env`, add to Vercel prod+preview (CLI 54.21.1).
2. **Allowlist emails.** `ADMIN_ALLOWLIST_EMAILS` (Tarik at minimum), optional `PICKS_ALLOWLIST_EMAILS` (DJ tier) — needed in Vercel env before staff can actually get in.
3. **Role-split ruling** (leaned yes): the two-tier design ships either way; an empty picks list = single-tier in practice.
4. Recommended dashboard hardening (post-keys): Clerk **Restricted sign-up mode** (invite/manual user creation) — the native Allowlist feature is paid-in-production, which is why the enforced gate is app-side.

## Decisions (made in planning; flagged ones await Tarik)

1. **Clerk scoped to `/admin` segment.** `ClerkProvider` in `src/app/admin/layout.tsx`; `src/proxy.ts` matcher `['/admin(.*)']`. Public pages load zero Clerk JS; public build never touches Clerk env. Sign-in lives INSIDE the segment at `/admin/sign-in/[[...sign-in]]` so this holds.
2. **Resource-level auth, thin proxy.** Clerk's current middleware reference deprecates `createRouteMatcher` gating in favor of checks "as close to the resource as possible." `proxy.ts` = bare `clerkMiddleware()` (session context only). Gates: `requireStaff()` at the top of every admin **page**, `currentStaffRole()` inside every mutation **action** (envelope denial, not redirect). Layout does NOT gate (sign-in/denied pages live under it; layouts don't re-run on client nav).
3. **App-side email allowlist as the enforced gate.** Clerk's native Allowlist is paid-in-production; Restricted mode is dashboard-config. App-side env lists are free-plan-proof, unit-testable, and survive Clerk plan changes. Dashboard Restricted mode is recommended hardening on top (Prerequisite 4).
4. **Two-tier roles by env list (AWAITING TARIK's formal ruling):** `staffRoleForEmail` maps email → `'admin' | 'picks' | null` from `ADMIN_ALLOWLIST_EMAILS` / `PICKS_ALLOWLIST_EMAILS` (admin wins if listed in both). Picks manager requires `'picks'` (admins pass); future slices require `'admin'`. Declining the tier = leave the picks env empty. No Clerk metadata/session-claim config needed — one less dashboard dependency.
5. **Admin event finder = text-only `searchEvents`** (FTS leg of the hybrid; no query embedding → no AI Gateway dependency, deterministic, fast). `hybrid.ts` untouched.
6. **Picks list reuses public `picksForWeek`** (it already returns every pick for a week, with `nextStartAt: null` for past-only events). New admin-only reads are just `getPickById` + `pickWeeks`. Max reuse, no relation-name guessing.
7. **`weekOf` must be a Chicago Monday** — mutation Zod refines `getUTCDay() === 1` on the date string; the public read path matches on exact `weekOf` equality, so a non-Monday pick would silently never render. Week selector only ever offers Mondays (`chicagoWeekMonday` from `@/lib/display`).
8. **Cascade tolerance, not re-pointing:** `staff_picks.event_id` is `ON DELETE cascade` — a dedup merge silently deletes a picked event's pick row. Admin list simply reflects reality on re-query (documented in the UI's empty state). Re-point-on-merge tooling belongs to Slice 2 (survivor picker) — noted there, not built here.
9. **E2E scope:** one Playwright spec (unauthenticated `/admin/picks` → redirected to sign-in), **skip-guarded when Clerk keys are absent** so dev boxes/CI without keys stay green. Signed-in/denied flows are MOO-258's explicit *screenshot* evidence (human, post-keys). `@clerk/testing` is deliberately NOT added in this slice — no test-user fixture exists yet; revisit in Slice 2 when the review queue needs authed e2e.
10. **Deferred from the pre-launch backlog** (recorded, not built here): newsletter per-IP throttle/honeypot/Turnstile (pre-marketing-push hardening — candidate Slice 2 companion task); homepage LCP 4.8s polish; ActiveChips friendly labels; day-group calendar-ordering for text searches; digest double-fetch; dark-accent station-card exploration; neighborhood editorial long-tail (admin candidate, Slice 3 with the event editor).
11. **Slice 2 (next plan):** dedup review queue UI (26 pending), per-pair survivor picker (Tarik's explicit want; `mergeEvents(db, canonicalId, duplicateId, scored, decidedBy)` already takes explicit canonical), fixes for ledger M2 (applyReview status row cascades away before update), M3 (chain-merge receipt cascade), M4 (findCandidates no ORDER BY), `VENUE_OWNED_SOURCE_KEYS` exposure. **Slice 3:** source health dashboard (per-run stats columns already on `sources`) + event editor with provenance.

---

### Task 1: Clerk foundation — install, proxy, admin layout, sign-in, denied, robots

Everything Clerk touches, scoped to `/admin`. No auth *decisions* here (that's Task 2) — this task makes Clerk session context exist inside the segment and nowhere else.

**Files:**
- Create: `src/proxy.ts`, `src/app/admin/layout.tsx`, `src/app/admin/sign-in/[[...sign-in]]/page.tsx`, `src/app/admin/denied/page.tsx`
- Modify: `package.json` (+ lockfile, via npm install), `.env.example` (APPEND ONLY), `src/app/robots.ts` (add `/admin` disallow)

**Interfaces:**
- Consumes: `SITE_NAME` from `src/lib/site.ts`; `Button` from `src/components/ui/button`; design tokens (`border-ink`, `bg-cream`, `bg-cream-raised`, `font-head`, `text-ink-muted`, `shadow-[6px_6px_0_#1F2528]`).
- Produces: Clerk session context on all `/admin(.*)` requests (Tasks 2–6 rely on `auth()`/`currentUser()` working there); routes `/admin/sign-in` and `/admin/denied` (Task 2's `requireStaff` redirects to both); admin chrome layout wrapping every admin page.

- [ ] **Step 1: Install `@clerk/nextjs`**

```bash
npm install @clerk/nextjs@^7.5.15
```

Verify: `package.json` gains `"@clerk/nextjs": "^7.5.15"`. (Peer range confirmed against the npm registry 2026-07-09: `next ^16.0.10` is included; repo is on 16.2.10.)

- [ ] **Step 2: Append the Clerk + staff env block to `.env.example`**

APPEND to the end of `.env.example` (do not touch existing lines — append-only precedent):

```bash
# --- Phase 5: admin auth (Clerk) ---
# Absent: /admin is unusable (local dev falls back to Clerk keyless mode); public site unaffected.
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/admin/sign-in
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/admin
# Staff access: comma-separated emails, case-insensitive. admin = all tools;
# picks = staff-picks manager only. An email on both lists is admin.
ADMIN_ALLOWLIST_EMAILS=
PICKS_ALLOWLIST_EMAILS=
```

Before writing, verify the two `NEXT_PUBLIC_CLERK_*` redirect var names against the live quickstart (https://clerk.com/docs/nextjs/getting-started/quickstart) — the key names `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY` are confirmed; the sign-in URL var names came from Clerk convention and MUST be re-checked (recon could not extract that block verbatim).

- [ ] **Step 3: Create `src/proxy.ts`**

Next 16 renamed middleware → proxy; Clerk docs: "Name the middleware file by the `next` version in `package.json`: `proxy.ts` on Next.js 16+." The matcher scopes Clerk to the admin segment only — the public site must never execute Clerk code.

```typescript
// src/proxy.ts
import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: ['/admin(.*)', '/__clerk(.*)'],
};
```

No route protection here — Clerk's current guidance is resource-level checks (`requireStaff()` per page, Task 2), and their middleware reference deprecates `createRouteMatcher` gating.

- [ ] **Step 4: Create `src/app/admin/layout.tsx`**

`ClerkProvider` lives HERE, not in the root layout (public-site perf + env isolation — Decision 1). Layout does NOT gate access (sign-in/denied render under it).

```tsx
// src/app/admin/layout.tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { ClerkProvider, Show, UserButton } from '@clerk/nextjs';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: `${SITE_NAME} — Admin`,
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <div className="min-h-screen bg-cream">
        <header className="flex items-center justify-between border-b-[3px] border-ink px-4 py-3">
          <Link href="/admin" className="font-head text-xl text-ink">
            {SITE_NAME} — Admin
          </Link>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </div>
    </ClerkProvider>
  );
}
```

`<Show>` is the current `@clerk/nextjs` v7 conditional (replaces `<SignedIn>`); verify it exists in the installed version's exports if typecheck complains, and fall back to `<SignedIn>` only if v7 still ships it.

- [ ] **Step 5: Create the sign-in catch-all page**

Optional catch-all is Clerk's documented convention (multi-step flows: verification, MFA). `force-dynamic` keeps the build from trying to prerender a Clerk component before keys exist.

```tsx
// src/app/admin/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from '@clerk/nextjs';

export const dynamic = 'force-dynamic';

export default function AdminSignInPage() {
  return (
    <div className="flex justify-center py-10">
      <SignIn />
    </div>
  );
}
```

- [ ] **Step 6: Create the denied page**

Signed-in but not on a staff list lands here (Task 2's guard redirects to it). It must NOT require staff status itself — only authentication.

```tsx
// src/app/admin/denied/page.tsx
import { SignOutButton } from '@clerk/nextjs';
import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function AdminDeniedPage() {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) redirect('/admin/sign-in');
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? 'This account';
  return (
    <div className="max-w-md border-[3px] border-ink bg-cream-raised p-6 shadow-[6px_6px_0_#1F2528]">
      <h1 className="font-head text-2xl text-ink">Not authorized</h1>
      <p className="mt-2 text-ink-muted">
        {email} is signed in but isn&apos;t on the staff list. Ask Tarik to add it to
        ADMIN_ALLOWLIST_EMAILS or PICKS_ALLOWLIST_EMAILS, or sign out.
      </p>
      <div className="mt-4">
        <SignOutButton redirectUrl="/admin/sign-in">
          <Button variant="outline">Sign out</Button>
        </SignOutButton>
      </div>
    </div>
  );
}
```

Verify `SignOutButton`'s `redirectUrl` prop against the installed types; if the prop name differs in v7, follow the types.

- [ ] **Step 7: Disallow `/admin` in robots**

Open `src/app/robots.ts`, read its existing shape, and add `disallow: '/admin'` to the rule set without disturbing the sitemap entries. (If the rules entry is a single object, add `disallow: ['/admin']`; match the file's existing structure.)

- [ ] **Step 8: Typecheck and build**

Run: `npm run typecheck` → clean. Run: `npm run build` → succeeds. If the build fails on a missing publishable key despite `force-dynamic`, STOP and report — do not work around it by weakening Decision 1.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .env.example src/proxy.ts src/app/admin src/app/robots.ts
git commit -m "feat: Clerk auth foundation scoped to /admin segment (proxy.ts, layout provider, sign-in, denied)"
```

### Task 2: Staff allowlist + role guard, and the admin landing page

The authorization brain: pure, unit-tested email→role mapping; a server guard that every admin surface calls; and the `/admin` landing page as its first consumer.

**Files:**
- Create: `src/lib/staff-auth.ts`, `src/lib/staff-guard.ts`, `src/app/admin/page.tsx`
- Test: `tests/lib/staff-auth.test.ts`

**Interfaces:**
- Consumes: Clerk session context from Task 1 (`auth()`, `currentUser()` from `@clerk/nextjs/server`); routes `/admin/sign-in`, `/admin/denied`.
- Produces (Tasks 3–6 rely on these exact signatures):
  - `type StaffRole = 'admin' | 'picks'`
  - `staffRoleForEmail(email: string | null | undefined, lists: { adminEmails?: string; picksEmails?: string }): StaffRole | null`
  - `requireStaff(minimum?: StaffRole): Promise<{ role: StaffRole; email: string }>` — page gate; redirects unauthenticated → `/admin/sign-in`, non-staff/insufficient → `/admin/denied`. Default minimum `'picks'` (admins always pass).
  - `currentStaffRole(): Promise<{ role: StaffRole; email: string } | null>` — envelope-friendly check for server actions (no redirect).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/staff-auth.test.ts
import { describe, expect, it } from 'vitest';
import { parseEmailList, staffRoleForEmail } from '@/lib/staff-auth';

describe('parseEmailList', () => {
  it('splits on commas, trims, lowercases, drops empties', () => {
    expect(parseEmailList(' A@x.com, b@Y.org ,,')).toEqual(['a@x.com', 'b@y.org']);
  });
  it('returns empty for undefined, null, or empty string', () => {
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList(null)).toEqual([]);
    expect(parseEmailList('')).toEqual([]);
  });
});

describe('staffRoleForEmail', () => {
  const lists = { adminEmails: 'tarik@radiomilwaukee.org', picksEmails: 'dj@radiomilwaukee.org' };
  it('maps admin-list emails to admin', () => {
    expect(staffRoleForEmail('tarik@radiomilwaukee.org', lists)).toBe('admin');
  });
  it('is case-insensitive on both sides', () => {
    expect(staffRoleForEmail('Tarik@RadioMilwaukee.org', lists)).toBe('admin');
    expect(staffRoleForEmail('dj@radiomilwaukee.org', { picksEmails: 'DJ@RadioMilwaukee.org' })).toBe('picks');
  });
  it('maps picks-list emails to picks', () => {
    expect(staffRoleForEmail('dj@radiomilwaukee.org', lists)).toBe('picks');
  });
  it('admin wins when an email is on both lists', () => {
    expect(
      staffRoleForEmail('tarik@radiomilwaukee.org', {
        adminEmails: 'tarik@radiomilwaukee.org',
        picksEmails: 'tarik@radiomilwaukee.org',
      }),
    ).toBe('admin');
  });
  it('returns null for unknown, missing, or empty-env cases', () => {
    expect(staffRoleForEmail('rando@example.com', lists)).toBeNull();
    expect(staffRoleForEmail(null, lists)).toBeNull();
    expect(staffRoleForEmail(undefined, {})).toBeNull();
    expect(staffRoleForEmail('tarik@radiomilwaukee.org', {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run tests/lib/staff-auth.test.ts` → FAIL ("Cannot find module '@/lib/staff-auth'").

- [ ] **Step 3: Implement `src/lib/staff-auth.ts` (pure — zero Clerk imports)**

```typescript
// src/lib/staff-auth.ts
export type StaffRole = 'admin' | 'picks';

export interface StaffEnvLists {
  adminEmails?: string;
  picksEmails?: string;
}

export function parseEmailList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function staffRoleForEmail(
  email: string | null | undefined,
  lists: StaffEnvLists,
): StaffRole | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (parseEmailList(lists.adminEmails).includes(normalized)) return 'admin';
  if (parseEmailList(lists.picksEmails).includes(normalized)) return 'picks';
  return null;
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run tests/lib/staff-auth.test.ts` → PASS (7 tests).

- [ ] **Step 5: Implement `src/lib/staff-guard.ts` (server glue — deliberately thin, no unit test)**

```typescript
// src/lib/staff-guard.ts
import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { staffRoleForEmail, type StaffRole } from '@/lib/staff-auth';

export interface StaffIdentity {
  role: StaffRole;
  email: string;
}

async function signedInEmail(): Promise<string | null> {
  const user = await currentUser();
  return (
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null
  );
}

/** Envelope-friendly check for server actions: returns null instead of redirecting. */
export async function currentStaffRole(): Promise<StaffIdentity | null> {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) return null;
  const email = await signedInEmail();
  const role = staffRoleForEmail(email, {
    adminEmails: process.env.ADMIN_ALLOWLIST_EMAILS,
    picksEmails: process.env.PICKS_ALLOWLIST_EMAILS,
  });
  return role && email ? { role, email } : null;
}

/** Page gate. Unauthenticated → sign-in; not staff or insufficient tier → denied. */
export async function requireStaff(minimum: StaffRole = 'picks'): Promise<StaffIdentity> {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) redirect('/admin/sign-in');
  const staff = await currentStaffRole();
  if (!staff) redirect('/admin/denied');
  if (minimum === 'admin' && staff.role !== 'admin') redirect('/admin/denied');
  return staff;
}
```

`isAuthenticated` on `await auth()` is the current v7 API (replaces `!!userId`) — verified against the clerk-nextjs-patterns reference 2026-07-09.

- [ ] **Step 6: Create the admin landing page (first guard consumer)**

```tsx
// src/app/admin/page.tsx
import Link from 'next/link';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireStaff } from '@/lib/staff-guard';

export default async function AdminHomePage() {
  const staff = await requireStaff('picks');
  return (
    <div>
      <h1 className="font-head text-3xl text-ink">Admin</h1>
      <p className="mt-1 text-ink-muted">
        Signed in as {staff.email} ({staff.role})
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link href="/admin/picks" className="block">
          <Card>
            <CardHeader>
              <CardTitle>Staff picks</CardTitle>
              <CardDescription>
                Weekly picks: search events, add blurbs, edit and reorder.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        {staff.role === 'admin' ? (
          <Card>
            <CardHeader>
              <CardTitle>Review queue &amp; sources</CardTitle>
              <CardDescription>Duplicate review with survivor picker — coming in Slice 2.</CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck, full-file test run**

Run: `npm run typecheck` → clean. Run: `npx vitest run tests/lib/staff-auth.test.ts` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/staff-auth.ts src/lib/staff-guard.ts src/app/admin/page.tsx tests/lib/staff-auth.test.ts
git commit -m "feat: staff email-allowlist roles (admin/picks) with requireStaff page guard + admin landing"
```

### Task 3: Admin picks read queries — `getPickById`, `pickWeeks`

The admin list itself reuses the public `picksForWeek` (Decision 6). This task adds only what the public path doesn't expose: a single-pick fetch for the edit form and the distinct-weeks list for the selector.

**Files:**
- Create: `src/queries/admin-picks.ts`
- Test: `tests/queries/admin-picks.test.ts`

**Interfaces:**
- Consumes: `staffPicks`, `events` from `@/db/schema`; `type Db` from `@/lib/card-data` (the same `Db` alias `src/queries/picks.ts` uses).
- Produces (Task 5's edit page and week selector rely on these):
  - `interface AdminPickRow { id: string; eventId: string; curatorName: string; curatorRole: string | null; showUrl: string | null; blurb: string; weekOf: string; sortOrder: number; eventTitle: string; eventSlug: string }`
  - `getPickById(db: Db, id: string): Promise<AdminPickRow | null>`
  - `pickWeeks(db: Db): Promise<string[]>` — distinct `weekOf` values, newest first.

- [ ] **Step 1: Write the failing test**

Before writing: open `tests/queries/picks.test.ts` and copy its seed approach verbatim — the `events` table has NOT NULL columns beyond title/slug/venue (source linkage etc.) and that file already seeds them correctly. The test below marks the seed section; fill it from that file, do not invent columns.

```typescript
// tests/queries/admin-picks.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import * as schema from '@/db/schema';
import { getPickById, pickWeeks } from '@/queries/admin-picks';

let db: Awaited<ReturnType<typeof createTestDb>>;
let eventId: string;

beforeAll(async () => {
  db = await createTestDb();
  // SEED: copy the venue+event seeding from tests/queries/picks.test.ts verbatim
  // (same required columns, same helper shape). Set title 'Admin Test Event',
  // slug 'admin-test-event'. Assign the created event's id to eventId.
});

describe('getPickById', () => {
  it('returns the full editable row joined with event title and slug', async () => {
    const [inserted] = await db
      .insert(schema.staffPicks)
      .values({
        eventId,
        curatorName: 'Test DJ',
        blurb: 'A great one',
        weekOf: '2026-07-06',
        sortOrder: 2,
      })
      .returning();
    const row = await getPickById(db, inserted.id);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      id: inserted.id,
      eventId,
      curatorName: 'Test DJ',
      curatorRole: null,
      showUrl: null,
      blurb: 'A great one',
      weekOf: '2026-07-06',
      sortOrder: 2,
      eventTitle: 'Admin Test Event',
      eventSlug: 'admin-test-event',
    });
  });

  it('returns null for an unknown id', async () => {
    expect(await getPickById(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('pickWeeks', () => {
  it('returns distinct weeks, newest first', async () => {
    await db.insert(schema.staffPicks).values([
      { eventId, curatorName: 'A', blurb: 'x', weekOf: '2026-07-13' },
      { eventId, curatorName: 'B', blurb: 'y', weekOf: '2026-07-13' },
      { eventId, curatorName: 'C', blurb: 'z', weekOf: '2026-06-29' },
    ]);
    const weeks = await pickWeeks(db);
    expect(weeks[0]).toBe('2026-07-13');
    expect(weeks).toContain('2026-07-06');
    expect(weeks).toContain('2026-06-29');
    expect(new Set(weeks).size).toBe(weeks.length);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run tests/queries/admin-picks.test.ts` → FAIL ("Cannot find module '@/queries/admin-picks'"). (PGlite boot ~12s is normal.)

- [ ] **Step 3: Implement `src/queries/admin-picks.ts`**

Verify the `events` column names (`title`, `slug`) against `src/db/schema.ts` before transcribing.

```typescript
// src/queries/admin-picks.ts
import { desc, eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import type { Db } from '@/lib/card-data';

export interface AdminPickRow {
  id: string;
  eventId: string;
  curatorName: string;
  curatorRole: string | null;
  showUrl: string | null;
  blurb: string;
  weekOf: string;
  sortOrder: number;
  eventTitle: string;
  eventSlug: string;
}

export async function getPickById(db: Db, id: string): Promise<AdminPickRow | null> {
  const rows = await db
    .select({
      id: schema.staffPicks.id,
      eventId: schema.staffPicks.eventId,
      curatorName: schema.staffPicks.curatorName,
      curatorRole: schema.staffPicks.curatorRole,
      showUrl: schema.staffPicks.showUrl,
      blurb: schema.staffPicks.blurb,
      weekOf: schema.staffPicks.weekOf,
      sortOrder: schema.staffPicks.sortOrder,
      eventTitle: schema.events.title,
      eventSlug: schema.events.slug,
    })
    .from(schema.staffPicks)
    .innerJoin(schema.events, eq(schema.staffPicks.eventId, schema.events.id))
    .where(eq(schema.staffPicks.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function pickWeeks(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ weekOf: schema.staffPicks.weekOf })
    .from(schema.staffPicks)
    .orderBy(desc(schema.staffPicks.weekOf));
  return rows.map((row) => row.weekOf);
}
```

Note: `events.slug` is nullable-safe only if the schema declares it NOT NULL — Phase 4 slugged 181/181 venues and events carry slugs from ingestion; if `schema.events.slug` is nullable in the type, coalesce in the select (`sql<string>\`coalesce(${schema.events.slug}, '')\``) rather than widening `AdminPickRow`.

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run tests/queries/admin-picks.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/queries/admin-picks.ts tests/queries/admin-picks.test.ts
git commit -m "feat: admin picks read queries (getPickById, pickWeeks)"
```

### Task 4: Pick mutations — pure functions + `'use server'` wrappers

Create/update/delete following the repo's `subscribe.ts`/`newsletter.ts` two-file split: Zod-validated pure functions the PGlite tests exercise, and thin authorized wrappers the forms call.

**Files:**
- Create: `src/app/actions/admin-picks.ts` (pure, DB-injected — NO `'use server'`), `src/app/actions/admin-picks-actions.ts` (`'use server'` wrappers)
- Test: `tests/actions/admin-picks.test.ts`

**Interfaces:**
- Consumes: `staffPicks` schema; `type Db` from `@/lib/card-data`; `currentStaffRole()` from Task 2; `db` from `@/db`.
- Produces (Task 5's forms rely on these exact signatures):
  - `interface AdminPickState { ok: boolean; message: string }`
  - `createPickWithDb(db: Db, input: Record<string, FormDataEntryValue | null>): Promise<AdminPickState>`
  - `updatePickWithDb(db: Db, id: string, input: Record<string, FormDataEntryValue | null>): Promise<AdminPickState>`
  - `deletePickWithDb(db: Db, id: string): Promise<AdminPickState>`
  - `'use server'`: `createPickAction(prev: AdminPickState, formData: FormData)`, `updatePickAction(id: string, prev: AdminPickState, formData: FormData)`, `deletePickAction(id: string, prev: AdminPickState, formData: FormData)` — create/update **redirect to `/admin/picks?week=<weekOf>` on success** (so `useActionState` only ever renders errors); delete redirects to `/admin/picks`.

- [ ] **Step 1: Write the failing test**

Same seed note as Task 3: copy the venue+event seeding from `tests/queries/picks.test.ts`.

```typescript
// tests/actions/admin-picks.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import * as schema from '@/db/schema';
import { createPickWithDb, deletePickWithDb, updatePickWithDb } from '@/app/actions/admin-picks';

let db: Awaited<ReturnType<typeof createTestDb>>;
let eventId: string;

const validInput = (overrides: Record<string, string> = {}) => ({
  eventId,
  curatorName: 'Tarik',
  curatorRole: 'HYFIN',
  showUrl: 'https://radiomilwaukee.org/show',
  blurb: 'Do not miss this.',
  weekOf: '2026-07-13',
  sortOrder: '1',
  ...overrides,
});

beforeAll(async () => {
  db = await createTestDb();
  // SEED: copy from tests/queries/picks.test.ts verbatim; assign eventId.
});

describe('createPickWithDb', () => {
  it('inserts a valid pick', async () => {
    const result = await createPickWithDb(db, validInput());
    expect(result.ok).toBe(true);
    const rows = await db.select().from(schema.staffPicks).where(eq(schema.staffPicks.weekOf, '2026-07-13'));
    expect(rows).toHaveLength(1);
    expect(rows[0].curatorName).toBe('Tarik');
    expect(rows[0].sortOrder).toBe(1);
  });

  it('rejects a non-Monday weekOf (public read path matches exact Mondays)', async () => {
    const result = await createPickWithDb(db, validInput({ weekOf: '2026-07-15' }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Monday/);
  });

  it('rejects an empty blurb', async () => {
    const result = await createPickWithDb(db, validInput({ blurb: '  ' }));
    expect(result.ok).toBe(false);
  });

  it('returns an error envelope (not a throw) for an unknown eventId', async () => {
    const result = await createPickWithDb(
      db,
      validInput({ eventId: '00000000-0000-0000-0000-000000000000' }),
    );
    expect(result.ok).toBe(false);
  });

  it('treats empty showUrl and curatorRole as null', async () => {
    const result = await createPickWithDb(db, validInput({ showUrl: '', curatorRole: '', weekOf: '2026-07-20' }));
    expect(result.ok).toBe(true);
    const rows = await db.select().from(schema.staffPicks).where(eq(schema.staffPicks.weekOf, '2026-07-20'));
    expect(rows[0].showUrl).toBeNull();
    expect(rows[0].curatorRole).toBeNull();
  });
});

describe('updatePickWithDb', () => {
  it('updates fields on an existing pick', async () => {
    const [pick] = await db
      .insert(schema.staffPicks)
      .values({ eventId, curatorName: 'Old', blurb: 'old', weekOf: '2026-07-27' })
      .returning();
    const result = await updatePickWithDb(db, pick.id, validInput({ curatorName: 'New', weekOf: '2026-07-27' }));
    expect(result.ok).toBe(true);
    const [row] = await db.select().from(schema.staffPicks).where(eq(schema.staffPicks.id, pick.id));
    expect(row.curatorName).toBe('New');
  });

  it('returns a not-found envelope for a vanished pick (merge-cascade tolerance)', async () => {
    const result = await updatePickWithDb(
      db,
      '00000000-0000-0000-0000-000000000000',
      validInput(),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not found|removed/i);
  });
});

describe('deletePickWithDb', () => {
  it('deletes and is not-found on the second call', async () => {
    const [pick] = await db
      .insert(schema.staffPicks)
      .values({ eventId, curatorName: 'Del', blurb: 'bye', weekOf: '2026-08-03' })
      .returning();
    expect((await deletePickWithDb(db, pick.id)).ok).toBe(true);
    expect((await deletePickWithDb(db, pick.id)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run tests/actions/admin-picks.test.ts` → FAIL ("Cannot find module '@/app/actions/admin-picks'").

- [ ] **Step 3: Implement the pure module `src/app/actions/admin-picks.ts`**

```typescript
// src/app/actions/admin-picks.ts
// Pure, DB-injected pick mutations (no 'use server' — the repo's subscribe.ts pattern).
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import type { Db } from '@/lib/card-data';

export interface AdminPickState {
  ok: boolean;
  message: string;
}

const SERVER_ERROR_MESSAGE = 'Something went wrong saving the pick. Try again.';
const NOT_FOUND_MESSAGE = 'Pick not found — it may have been removed by a dedup merge.';

/** Public reads match weekOf exactly; a non-Monday pick would silently never render. */
const mondayDate = z.iso
  .date()
  .refine((value) => new Date(`${value}T12:00:00Z`).getUTCDay() === 1, {
    message: 'weekOf must be a Monday (YYYY-MM-DD)',
  });

/** FormData.get() returns null for missing fields — treat null/undefined/'' all as "not provided". */
const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (value ?? '').trim())
    .pipe(z.string().max(max))
    .transform((value) => (value === '' ? null : value));

const pickFieldsSchema = z.object({
  curatorName: z.string().trim().min(1, 'curator is required').max(120),
  curatorRole: optionalText(120),
  showUrl: optionalText(300).refine(
    (value) => value === null || z.url().safeParse(value).success,
    { message: 'show URL must be a valid URL' },
  ),
  blurb: z.string().trim().min(1, 'blurb is required').max(600),
  weekOf: mondayDate,
  sortOrder: z.coerce.number().int().min(0).max(99).default(0),
});

const createPickSchema = pickFieldsSchema.extend({ eventId: z.uuid() });

type PickInput = Record<string, FormDataEntryValue | null>;

function invalidMessage(error: z.ZodError): string {
  return `Check the form: ${error.issues[0]?.message ?? 'invalid input'}`;
}

export async function createPickWithDb(db: Db, input: PickInput): Promise<AdminPickState> {
  const parsed = createPickSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidMessage(parsed.error) };
  try {
    await db.insert(schema.staffPicks).values(parsed.data);
    return { ok: true, message: 'Pick added.' };
  } catch {
    return { ok: false, message: SERVER_ERROR_MESSAGE };
  }
}

export async function updatePickWithDb(db: Db, id: string, input: PickInput): Promise<AdminPickState> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: NOT_FOUND_MESSAGE };
  const parsed = pickFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidMessage(parsed.error) };
  try {
    const rows = await db
      .update(schema.staffPicks)
      .set(parsed.data)
      .where(eq(schema.staffPicks.id, id))
      .returning({ id: schema.staffPicks.id });
    if (rows.length === 0) return { ok: false, message: NOT_FOUND_MESSAGE };
    return { ok: true, message: 'Pick updated.' };
  } catch {
    return { ok: false, message: SERVER_ERROR_MESSAGE };
  }
}

export async function deletePickWithDb(db: Db, id: string): Promise<AdminPickState> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: NOT_FOUND_MESSAGE };
  try {
    const rows = await db
      .delete(schema.staffPicks)
      .where(eq(schema.staffPicks.id, id))
      .returning({ id: schema.staffPicks.id });
    if (rows.length === 0) return { ok: false, message: NOT_FOUND_MESSAGE };
    return { ok: true, message: 'Pick deleted.' };
  } catch {
    return { ok: false, message: SERVER_ERROR_MESSAGE };
  }
}
```

Zod 4 notes for the implementer: `z.iso.date()`, `z.uuid()`, `z.url()` are top-level in Zod 4 (repo is on `zod ^4.4.3`); `z.coerce.number()` turns the FormData string into a number and `File` values fail `z.string()` — both intended.

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run tests/actions/admin-picks.test.ts` → PASS.

- [ ] **Step 5: Implement the `'use server'` wrappers `src/app/actions/admin-picks-actions.ts`**

ONLY async function exports (Global Constraints). Auth denial is an envelope, not a redirect (form UX). Success redirects — `redirect()` must stay OUTSIDE any try/catch (it throws `NEXT_REDIRECT` internally).

```typescript
// src/app/actions/admin-picks-actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { currentStaffRole } from '@/lib/staff-guard';
import {
  createPickWithDb,
  deletePickWithDb,
  updatePickWithDb,
  type AdminPickState,
} from '@/app/actions/admin-picks';

const NOT_AUTHORIZED: AdminPickState = { ok: false, message: 'Not authorized.' };

function pickInputFromForm(formData: FormData): Record<string, FormDataEntryValue | null> {
  return {
    eventId: formData.get('eventId'),
    curatorName: formData.get('curatorName'),
    curatorRole: formData.get('curatorRole'),
    showUrl: formData.get('showUrl'),
    blurb: formData.get('blurb'),
    weekOf: formData.get('weekOf'),
    sortOrder: formData.get('sortOrder'),
  };
}

function revalidatePickSurfaces(): void {
  for (const path of ['/admin/picks', '/', '/picks', '/digest']) revalidatePath(path);
}

export async function createPickAction(
  _prev: AdminPickState,
  formData: FormData,
): Promise<AdminPickState> {
  if (!(await currentStaffRole())) return NOT_AUTHORIZED;
  const input = pickInputFromForm(formData);
  const result = await createPickWithDb(db, input);
  if (!result.ok) return result;
  revalidatePickSurfaces();
  redirect(`/admin/picks?week=${input.weekOf}`);
}

export async function updatePickAction(
  id: string,
  _prev: AdminPickState,
  formData: FormData,
): Promise<AdminPickState> {
  if (!(await currentStaffRole())) return NOT_AUTHORIZED;
  const input = pickInputFromForm(formData);
  const result = await updatePickWithDb(db, id, input);
  if (!result.ok) return result;
  revalidatePickSurfaces();
  redirect(`/admin/picks?week=${input.weekOf}`);
}

export async function deletePickAction(
  id: string,
  _prev: AdminPickState,
  _formData: FormData,
): Promise<AdminPickState> {
  if (!(await currentStaffRole())) return NOT_AUTHORIZED;
  const result = await deletePickWithDb(db, id);
  if (!result.ok) return result;
  revalidatePickSurfaces();
  redirect('/admin/picks');
}
```

Non-exported helpers/consts in a `'use server'` file are fine — the async-only rule applies to EXPORTS. TypeScript note: the redirect branch never returns; if `tsc` complains about return paths, the `redirect()` call's `never` type satisfies it.

- [ ] **Step 6: Typecheck and re-run both action/query test files**

Run: `npm run typecheck` → clean. Run: `npx vitest run tests/actions/admin-picks.test.ts tests/queries/admin-picks.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/admin-picks.ts src/app/actions/admin-picks-actions.ts tests/actions/admin-picks.test.ts
git commit -m "feat: staff-pick mutations — validated pure functions + authorized server actions"
```

### Task 5: Picks manager UI — week selector, pick list, event finder, create/edit/delete forms

Server-first pages (GET-form search, link-based week selector — no client JS beyond the two small form components), styled with the vendored RetroUI components and design tokens.

**Files:**
- Create: `src/components/admin/pick-form.tsx`, `src/components/admin/delete-pick-form.tsx`, `src/app/admin/picks/page.tsx`, `src/app/admin/picks/new/page.tsx`, `src/app/admin/picks/[id]/edit/page.tsx`

**Interfaces:**
- Consumes (exact signatures from earlier tasks + recon):
  - `requireStaff` (Task 2), `getPickById`, `pickWeeks` (Task 3)
  - `createPickAction`, `updatePickAction`, `deletePickAction`, `AdminPickState` (Task 4)
  - `picksForWeek(db: Db, weekOf: string): Promise<PickWithEvent[]>` from `@/queries/picks` — `PickWithEvent = { id, curatorName, curatorRole, showUrl, blurb, meta: EventCardMeta, nextStartAt: Date | null }`
  - `searchEvents(db: Db, args: SearchArgs): Promise<SearchHit[]>` from `@/search/hybrid` (READ-ONLY consumer; text-only call, no embedding) — `SearchHit = { eventId, slug, title, venueName, nextStartAt, isFree, score }`
  - `loadCardMeta(db: Db, eventIds: string[]): Promise<Map<string, EventCardMeta>>` from `@/lib/card-data`
  - `chicagoWeekMonday(now: Date): string` and `chicagoDateLabel` from `@/lib/display` (verify `chicagoDateLabel`'s exact signature in that file before use)
  - `Button`, `Card`*, `Input`, `Badge` from `src/components/ui/`
- Produces: routes `/admin/picks`, `/admin/picks/new`, `/admin/picks/[id]/edit` (Task 6's e2e + README document these).

- [ ] **Step 1: Create the shared pick form (client component)**

```tsx
// src/components/admin/pick-form.tsx
'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AdminPickState } from '@/app/actions/admin-picks';

const initialState: AdminPickState = { ok: false, message: '' };

interface PickFormProps {
  action: (prev: AdminPickState, formData: FormData) => Promise<AdminPickState>;
  defaults: {
    curatorName?: string;
    curatorRole?: string | null;
    showUrl?: string | null;
    blurb?: string;
    weekOf: string;
    sortOrder?: number;
  };
  eventId?: string;
  submitLabel: string;
}

export function PickForm({ action, defaults, eventId, submitLabel }: PickFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="grid max-w-xl gap-3">
      {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}
      <label className="grid gap-1 text-sm font-medium text-ink">
        Curator
        <Input name="curatorName" defaultValue={defaults.curatorName ?? ''} required maxLength={120} />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink">
        Curator role (optional — e.g. “HYFIN, middays”)
        <Input name="curatorRole" defaultValue={defaults.curatorRole ?? ''} maxLength={120} />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink">
        Show URL (optional)
        <Input name="showUrl" type="url" defaultValue={defaults.showUrl ?? ''} maxLength={300} />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink">
        Blurb
        <textarea
          name="blurb"
          defaultValue={defaults.blurb ?? ''}
          required
          maxLength={600}
          rows={4}
          className="border-[3px] border-ink bg-cream-raised px-3 py-2 font-sans text-ink"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm font-medium text-ink">
          Week of (a Monday)
          <Input name="weekOf" defaultValue={defaults.weekOf} required pattern="\d{4}-\d{2}-\d{2}" />
        </label>
        <label className="grid gap-1 text-sm font-medium text-ink">
          Sort order
          <Input name="sortOrder" type="number" min={0} max={99} defaultValue={defaults.sortOrder ?? 0} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        {state.message && !state.ok ? (
          <p role="status" className="text-sm text-rm-red">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
```

(Success never renders a message — Task 4's actions redirect on success.) Verify the `text-rm-red` utility exists in globals.css tokens; if the alias differs (e.g. `--color-rm-red`), use the matching utility.

- [ ] **Step 2: Create the delete form (client component)**

```tsx
// src/components/admin/delete-pick-form.tsx
'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { AdminPickState } from '@/app/actions/admin-picks';

const initialState: AdminPickState = { ok: false, message: '' };

export function DeletePickForm({
  action,
}: {
  action: (prev: AdminPickState, formData: FormData) => Promise<AdminPickState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm('Delete this pick?')) event.preventDefault();
      }}
      className="flex items-center gap-3"
    >
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? 'Deleting…' : 'Delete pick'}
      </Button>
      {state.message && !state.ok ? (
        <p role="status" className="text-sm text-rm-red">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 3: Create `/admin/picks` — week selector + pick list + event finder**

```tsx
// src/app/admin/picks/page.tsx
import Link from 'next/link';
import { z } from 'zod';
import { db } from '@/db';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { chicagoDateLabel, chicagoWeekMonday } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';
import { pickWeeks } from '@/queries/admin-picks';
import { picksForWeek } from '@/queries/picks';
import { searchEvents } from '@/search/hybrid';

const paramsSchema = z.object({
  week: z.iso.date().catch(''),
  q: z.string().trim().max(200).catch(''),
});

function addDaysToIsoDate(isoDate: string, days: number): string {
  return new Date(new Date(`${isoDate}T12:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export default async function AdminPicksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff('picks');
  const raw = await searchParams;
  const parsed = paramsSchema.parse({ week: raw.week ?? '', q: raw.q ?? '' });
  const currentMonday = chicagoWeekMonday(new Date());
  const week = parsed.week || currentMonday;
  const weeks = Array.from(
    new Set([currentMonday, addDaysToIsoDate(currentMonday, 7), ...(await pickWeeks(db))]),
  ).sort();
  const picks = await picksForWeek(db, week);
  const results = parsed.q ? await searchEvents(db, { text: parsed.q, limit: 20 }) : [];

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-head text-3xl text-ink">Staff picks</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          {weeks.map((candidate) => (
            <Link key={candidate} href={`/admin/picks?week=${candidate}`}>
              <Badge variant={candidate === week ? 'default' : 'outline'}>
                Week of {candidate}
              </Badge>
            </Link>
          ))}
        </div>
      </div>

      <section>
        <h2 className="font-head text-xl text-ink">Picks for week of {week}</h2>
        {picks.length === 0 ? (
          <p className="mt-2 text-ink-muted">
            No picks yet for this week. (If a pick vanished, its event was merged away in dedup —
            re-add it against the surviving event.)
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {picks.map((pick) => (
              <li key={pick.id}>
                <Card>
                  <CardHeader>
                    <CardTitle>{pick.meta.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    <p className="text-sm text-ink-muted">
                      {pick.curatorName}
                      {pick.curatorRole ? ` — ${pick.curatorRole}` : ''} ·{' '}
                      {pick.meta.venueName ?? 'Venue TBA'} ·{' '}
                      {pick.nextStartAt ? chicagoDateLabel(pick.nextStartAt) : 'no upcoming date'}
                    </p>
                    <p className="font-accent text-lg text-ink">“{pick.blurb}”</p>
                    <div>
                      <Link href={`/admin/picks/${pick.id}/edit`}>
                        <Button size="sm" variant="outline">
                          Edit
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-head text-xl text-ink">Add a pick — search events</h2>
        <form method="GET" action="/admin/picks" className="mt-3 flex gap-2">
          <input type="hidden" name="week" value={week} />
          <Input name="q" defaultValue={parsed.q} placeholder="Search events…" className="max-w-md" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        {parsed.q ? (
          results.length === 0 ? (
            <p className="mt-3 text-ink-muted">No events match “{parsed.q}”.</p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {results.map((hit) => (
                <li
                  key={hit.eventId}
                  className="flex items-center justify-between border-[3px] border-ink bg-cream-raised px-3 py-2"
                >
                  <span className="text-ink">
                    {hit.title}
                    <span className="text-ink-muted">
                      {' '}
                      · {hit.venueName ?? 'Venue TBA'} · {chicagoDateLabel(hit.nextStartAt)}
                    </span>
                  </span>
                  <Link href={`/admin/picks/new?eventId=${hit.eventId}&week=${week}`}>
                    <Button size="sm">Pick this</Button>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}
```

Verify `chicagoDateLabel(date: Date)` — if its signature differs (e.g. takes ms), adapt the two call sites; do NOT hand-roll a formatter.

- [ ] **Step 4: Create `/admin/picks/new`**

```tsx
// src/app/admin/picks/new/page.tsx
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { createPickAction } from '@/app/actions/admin-picks-actions';
import { PickForm } from '@/components/admin/pick-form';
import { loadCardMeta } from '@/lib/card-data';
import { chicagoWeekMonday } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';

const paramsSchema = z.object({
  eventId: z.uuid().catch(''),
  week: z.iso.date().catch(''),
});

export default async function NewPickPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff('picks');
  const raw = await searchParams;
  const parsed = paramsSchema.parse({ eventId: raw.eventId ?? '', week: raw.week ?? '' });
  if (!parsed.eventId) notFound();
  const meta = (await loadCardMeta(db, [parsed.eventId])).get(parsed.eventId);
  if (!meta) notFound();
  const weekOf = parsed.week || chicagoWeekMonday(new Date());

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="font-head text-3xl text-ink">New pick</h1>
        <p className="mt-1 text-ink-muted">
          {meta.title} · {meta.venueName ?? 'Venue TBA'}
        </p>
      </div>
      <PickForm
        action={createPickAction}
        eventId={parsed.eventId}
        defaults={{ weekOf }}
        submitLabel="Add pick"
      />
    </div>
  );
}
```

- [ ] **Step 5: Create `/admin/picks/[id]/edit`**

```tsx
// src/app/admin/picks/[id]/edit/page.tsx
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { deletePickAction, updatePickAction } from '@/app/actions/admin-picks-actions';
import { DeletePickForm } from '@/components/admin/delete-pick-form';
import { PickForm } from '@/components/admin/pick-form';
import { requireStaff } from '@/lib/staff-guard';
import { getPickById } from '@/queries/admin-picks';

export default async function EditPickPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff('picks');
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const pick = await getPickById(db, id);
  if (!pick) notFound();

  const updateWithId = updatePickAction.bind(null, pick.id);
  const deleteWithId = deletePickAction.bind(null, pick.id);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">Edit pick</h1>
        <p className="mt-1 text-ink-muted">
          {pick.eventTitle} · week of {pick.weekOf}
        </p>
      </div>
      <PickForm
        action={updateWithId}
        defaults={{
          curatorName: pick.curatorName,
          curatorRole: pick.curatorRole,
          showUrl: pick.showUrl,
          blurb: pick.blurb,
          weekOf: pick.weekOf,
          sortOrder: pick.sortOrder,
        }}
        submitLabel="Save changes"
      />
      <div className="border-t-[3px] border-ink pt-4">
        <DeletePickForm action={deleteWithId} />
      </div>
    </div>
  );
}
```

`.bind(null, id)` on a server action is the documented Next.js pattern for passing bound args from server to client components (the bound action stays a server reference).

- [ ] **Step 6: Typecheck, build, manual dev walk (read-only against prod Neon)**

Run: `npm run typecheck` → clean. Run: `npm run build` → succeeds.
Then `npm run dev` and walk (keyless mode or dev keys; NO writes against prod — form submissions in this walk go to whatever DATABASE_URL is in `.env`, so either point at a branch DB or stop before submitting forms): `/admin` → sign-in redirect; after sign-in with an allowlisted email (set `ADMIN_ALLOWLIST_EMAILS` in `.env` locally — append-only) → landing → Picks → week selector renders current + next Mondays → search "jazz" returns results with "Pick this" buttons → new-pick form renders prefilled weekOf. Report what you saw, including anything off.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin src/app/admin/picks
git commit -m "feat: picks manager UI — week selector, pick list, event finder, create/edit/delete"
```

### Task 6: E2E, docs, full gates, ship checklist

**Files:**
- Create: `e2e/admin.spec.ts`
- Modify: `README.md` (admin section — read the file first, match its structure)

**Interfaces:**
- Consumes: routes from Tasks 1–5.
- Produces: the evidence trail MOO-258 needs.

- [ ] **Step 1: Write the e2e spec (skip-guarded — dev boxes without Clerk keys stay green)**

```typescript
// e2e/admin.spec.ts
import { expect, test } from '@playwright/test';

const hasClerkKeys =
  !!process.env.CLERK_SECRET_KEY && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

test.describe('admin auth gate', () => {
  test.skip(!hasClerkKeys, 'Clerk keys not configured in this environment');

  test('unauthenticated /admin/picks redirects to the admin sign-in', async ({ page }) => {
    await page.goto('/admin/picks');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });

  test('unauthenticated /admin redirects to the admin sign-in', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });
});
```

Note: Playwright's `webServer` runs `npm run dev` with the repo `.env` — the spec skips when keys are absent rather than failing. Signed-in and denied flows are deliberately human-evidenced (screenshots are MOO-258's verification currency); `@clerk/testing` + a fixture user is a Slice 2 decision.

- [ ] **Step 2: Run the e2e suite**

Run: `npm run e2e` → `admin.spec.ts` passes (or skips cleanly without keys); the existing 8 spec files stay green.

- [ ] **Step 3: README admin section**

Read `README.md`, then add an "Admin" section matching its tone/structure covering: `/admin` (Clerk, keyless in dev), the five new env vars, the two roles (admin/picks) and that an empty `PICKS_ALLOWLIST_EMAILS` means single-tier, the picks manager replacing the day-to-day use of `npm run picks:add` (CLI retained for scripting), and the merge-cascade caveat (a dedup merge deletes the pick row for the merged-away event).

- [ ] **Step 4: Full gates on a quiet machine**

Run: `npm run test` → all green (expect 350+ tests; PGlite contention warning stands — quiet box).
Run: `npm run typecheck` → clean. Run: `npm run build` → clean. Run: `npm run e2e` → green/skipped as above.

- [ ] **Step 5: Commit**

```bash
git add e2e/admin.spec.ts README.md
git commit -m "feat: admin e2e auth-gate spec (key-guarded) + README admin docs"
```

- [ ] **Step 6: Ship checklist (for the finishing-a-development-branch pass — do NOT execute inside this task)**

1. Merge `phase-5` → `main` locally (standing choice).
2. Tarik: Clerk app + keys → append to `.env`; `vercel env add` × (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `ADMIN_ALLOWLIST_EMAILS`, `PICKS_ALLOWLIST_EMAILS`) in prod+preview.
3. `vercel deploy --prod`. (No `trigger:deploy` — no task-reachable code changes in this slice.)
4. Evidence for MOO-258: screenshot allowlisted sign-in reaching `/admin/picks`; screenshot non-allowlisted account on `/admin/denied`; create one real pick via the UI and screenshot it live on `/` + `/digest` — this can double as the start of replacing the three "Field Guide Staff" placeholder picks (real DJ picks are an open Tarik item); note the e2e pass.
5. Clerk dashboard: enable Restricted sign-up mode (Prerequisite 4).

## Verification summary (what "done" means for this slice)

- MOO-258 AC "Clerk auth with station-staff email allowlist gating all `/admin` routes" — satisfied by Tasks 1–2 (allowlist enforced app-side per Decision 3).
- MOO-258 AC "Staff-picks manager: create weekly picks with curator, blurb, ordering — drives homepage + digest page" — satisfied by Tasks 3–5 (same `staff_picks` table the homepage/digest already read; `revalidatePath` on all four surfaces).
- MOO-258 ACs for source health / review queue / event editor — Slices 2–3 (Decision 11).
- Auth screenshots + live-pick evidence — human, post-keys (ship checklist).
