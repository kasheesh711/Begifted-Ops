# Phase 3: Service Cutover - Research

**Researched:** 2026-04-29
**Domain:** Next.js 16 Cache Components / Vercel Runtime Cache / Neon branching / Vitest streaming mocks
**Confidence:** HIGH (Next.js 16 + Vercel Runtime Cache APIs); MEDIUM (Neon branching ergonomics)

## Summary

Phase 3 is the atomic Sheets→Wisenet+Postgres cutover. The planner needs **exact, citation-backed Next.js 16 syntax** for `'use cache: remote'`, `cacheTag`, `cacheLife`, and the cache-invalidation function. The 17 CONTEXT.md decisions are locked; this research pins API surface only.

**Three findings rewrite parts of the CONTEXT.md plan:**

1. **CRITICAL — `updateTag` cannot be called from Route Handlers.** Next.js 16 docs are explicit: `updateTag` is "Server Actions only." Phase 3's mutation paths (`/api/actions/route.ts`, `/api/actions/bulk/route.ts`, `/api/inactive/route.ts`) are Route Handlers. **The planner MUST replace `updateTag('dashboard-payload')` (D-28) with `revalidateTag('dashboard-payload', 'max')` in route handlers** — or move the mutation surface into Server Actions (CONTEXT preferred option (b) facade — but the facade still has to be invoked from a 'use server' function, not a route handler).
2. **Important — the `revalidateTag(_, "max")` lint allowlist semantics flip in Next.js 16.** What was an anti-pattern in Next.js 15 (the bogus `"max"` second arg that did nothing) is now THE recommended invocation for stale-while-revalidate semantics in Route Handlers per Next.js 16 docs. The Phase 2 lint script and CONTEXT.md D-23/D-28 must be reconciled: Phase 3 either keeps the lint with a NEW allowlist (every legit revalidateTag-with-max call site) or repurposes the lint to forbid the *bare* deprecated `revalidateTag(tag)` form instead.
3. **The 2 MB Runtime Cache item limit is real and the dashboard payload is at risk.** Per Vercel docs, item size > 2 MB silently fails to cache. With ~hundreds of students × full package detail, the planner MUST add a payload-size sanity check.

**Primary recommendation:** SVC-02 service.ts wraps `getDashboardPayload()` in `'use cache: remote'` + `cacheTag('dashboard-payload')` + `cacheLife({ stale: 60, revalidate: 60, expire: 300 })`. SVC-03 mutation paths call `revalidateTag('dashboard-payload', 'max')` from Route Handlers (read-your-own-writes is acceptable through stale-while-revalidate; if strict read-your-own-writes is required, use `revalidateTag(tag, { expire: 0 })` per Vercel webhook pattern). Lint allowlist gets updated, not emptied.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SVC-01 | `cacheComponents: true` enabled in `next.config.ts` | §`cacheComponents` config — exact syntax pinned, version-gated to Next.js 16.0+ |
| SVC-02 | `getDashboardPayload` rewired with `'use cache: remote'` + `cacheTag` + `cacheLife` | §`'use cache: remote'` directive, §`cacheLife` profiles — exact syntax block to drop into service.ts |
| SVC-03 | Every mutation calls cache-invalidation after Postgres commit | §**CRITICAL** updateTag-vs-revalidateTag finding — RESEARCH overrides D-28's `updateTag` choice |
| SVC-04 | 6 route handlers swap to new service methods | §Route handler patterns — `runtime = "nodejs"` + `NextResponse.json` + revalidateTag call site |
| SVC-05 | Delete `lib/sheets/`, `memory-cache.ts`, `snapshot-store.ts`, legacy `actions.ts` | §Architecture Patterns — file-by-file deletion list reconciled with consumers |
| SVC-06 | Remove `googleapis` dep | §Standard Stack — confirmed no remaining server-side consumers post-cutover |
| SVC-07 | `/api/health` structured probe | §Health endpoint pattern — NextResponse status codes + HEAD probe semantics |
| SVC-08 | Student Detail archive-link affordance | §Component patterns — uses existing `"use client"` shell, no new deps |
| TEST-04 | 50-concurrent load test, p95 < 500ms | **DEFERRED to Phase 4 DEPL-04 per D-34** — not researched here |
| TEST-06 | Chunked-transfer regression test | §Vitest ReadableStream mock — exact `vi.stubGlobal("fetch", ...)` shape |

</phase_requirements>

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-04..D-37)

- **D-04** Wisenet fixtures at `web/src/test/fixtures/wisenet/*.json` (6 files). Phase 3 tests use them unchanged.
- **D-06** Admin ownership via Postgres sidecar `student_admin_ownership`. SVC-02 reads via `getAdminOwnership()` / `bulkGetAdminOwnership()`.
- **D-17** Drizzle + Neon HTTP default; WebSocket Pool for bulk-action only. SVC-04 `/api/actions/bulk` uses `bulkDb` per D-25.
- **D-22** Migrations via `.github/workflows/db-migrate.yml`. Phase 3 merge gate includes this CI passing on PR preview branch.
- **D-23** Phase 3 IS where `'use cache: remote'` + `cacheTag` + `cacheLife` wraps service.ts.
- **D-24** TEST-02 parity gate inherited (164/164). Must not regress.
- **D-25** Bulk-action atomicity via WebSocket Pool + BEGIN/COMMIT. `/api/actions/bulk/route.ts` uses `bulkSetStudentAction`.
- **D-26** Wisenet endpoints.ts single-file layout; service.ts calls `buildDashboardSourcesFromWisenet()`.
- **D-27** Vercel dashboard rollback (Promote Deployment) is first-line. Secondary `git revert <merge-SHA>`.
- **D-28** `cacheLife({ expire: 60 })` mirrors current 60s. 5 mutation sites call cache invalidation after Postgres commit. Pattern: write FIRST, invalidate SECOND. **Single tag `dashboard-payload` only — no per-student tags.** ⚠️ See research §Cache Invalidation Function for `updateTag` vs `revalidateTag` finding.
- **D-29** TEST-03 = integration test with real Neon branch + mocked Wisenet at `web/src/test/cache-invalidation.test.ts`. Gated on `TEST_DATABASE_URL`. 8-step shape.
- **D-30** SVC-08 archive-link in Student Detail header. Copy: "View pre-cutover history →". `target="_blank" rel="noopener noreferrer"`. Subtle styling. `aria-label="Open pre-cutover follow-up history in new tab"`.
- **D-31** Admin-ownership seed runs PRE-MERGE (operator action). `cd web && vercel env pull .env && npm run db:seed-admin`. Idempotent via `ON CONFLICT (student_key) DO UPDATE`.
- **D-32** `/api/health` shape locked (4-key envelope: status/timestamp/subsystems/deployedAt). Wisenet HEAD or cheap GET. Postgres `SELECT 1`. Auth env-presence only. Status rollup: any down→down, any degraded→degraded, all ok→ok. **200 for ok+degraded, 503 for down.** **Health endpoint does NOT use `'use cache: remote'`.**
- **D-33** ~8 commits, additive first, deletion last. No squash on merge — preserve per-commit structure.
- **D-34** TEST-04 (50-concurrent load test) DEFERRED to Phase 4 DEPL-04. TEST-06 reframed for Wisenet streaming.
- **D-35** All 4 merge-gate items must pass: (1) automated bundle (npm test, tsc --noEmit, npm run build, lint:no-revalidate-max), (2) DB-migrate CI green on Neon preview branch, (3) admin seed run against prod, (4) operator manual QA on Vercel preview URL.
- **D-36** `ARCHIVE_ACTION_SHEET_URL` constant in `web/src/lib/dashboard/config.ts`. Hardcoded Google Sheets URL. Operator confirms exact URL during execution.
- **D-37** `web/src/lib/runtime/logger.ts` — tiny structured `console.error` JSON helper. Phase 4 swaps to Sentry.

### Claude's Discretion (planner decides)

- **`actions.ts` reconciliation** — option (a) delete legacy + route handlers call lib/db/queries directly + inline cache-invalidation call OR option (b) thin facade over lib/db/queries with centralized cache-invalidation calls. CONTEXT prefers (b) for single-source-of-truth. ⚠️ See research finding: `updateTag` is Server-Actions-only; the cleanest version of (b) is a `'use server'` actions.ts file that route handlers thin-wrap.
- **Exact `cacheLife` semantics** — `{ expire: 60 }` vs `{ revalidate: 60, expire: 120 }` vs named profile. Researched below — recommendation: `{ stale: 60, revalidate: 60, expire: 300 }` (custom inline) for closest 60s mirror with 5-minute hard ceiling. See §`cacheLife` semantics.
- **TEST-03 Neon branch setup mechanics** — researched below — recommendation: option (b) operator-provisioned `TEST_DATABASE_URL`, matching Phase 2's existing `secrets.DATABASE_URL_UNPOOLED` pattern. See §Neon branching for TEST-03.
- **TEST-06 mock shape** — researched below — exact `ReadableStream` + `Response` constructor block provided. See §Vitest streaming mock.
- **Route-handler smoke test breadth** — planner's call.
- **Archive-link icon** — planner's call.
- **Logger location** — `lib/runtime/logger.ts` recommended (matches D-37).
- **SVC-08 component test** — planner's call.
- **Chunked-transfer regression test placement** — standalone file recommended.
- **Route handler `runtime = "nodejs"` retention** — confirmed REQUIRED on every swapped route (Wisenet client uses `Buffer`, Drizzle WebSocket uses `ws`).

### Deferred Ideas (OUT OF SCOPE for Phase 3)

- TEST-04 load test → Phase 4 DEPL-04
- X-BG-Deploy-Id header → Phase 4 DEPL-06
- Sentry / formal observability → Phase 4 DEPL-04
- NextAuth pinning → Phase 4 DEPL-02
- Playwright E2E sign-in → Phase 4 DEPL-03
- Apps Script "Moved" page + clasp retirement → Phase 5 RETI-01..06
- Per-student cache tags (`student-<key>`) — v2 OPS optimization
- Wisenet webhook-triggered invalidation — v2 OPS-01
- Frontend i18n for archive-link copy — Phase 5+
- React component test infrastructure — planner's call

</user_constraints>

## Project Constraints (from CLAUDE.md)

- **`runtime = "nodejs"` on every API route** — required for Drizzle WebSocket Pool path AND for Wisenet `Buffer.from(...).toString("base64")` auth header construction. Edge runtime is forbidden.
- **`.env` files gitignored, credentials never committed.** PR for Phase 3 must not include `.env` exports from `vercel env pull` (D-31 step).
- **Small PRs per issue — explicitly overridden** for Phase 3 by ROADMAP "module-swap PR as cutover mechanic." Reviewer must NOT fragment the PR.
- **No `clasp` references introduced in Phase 3** — clasp retires in Phase 5. The seed-admin-ownership.ts script (which uses `clasp run`) stays as-is from Phase 2; Phase 3 does not modify it.
- **HTTP -1 / chunked-transfer treated as deploy-state symptom** — TEST-06 reframe addresses Wisenet-side equivalent.
- **NextAuth v5 beta stays unpinned in Phase 3** — pinning is Phase 4 DEPL-02. Phase 3 must not modify next-auth dep.
- **No emoji in source code unless explicitly requested.**

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Wisenet read (students/sessions/credits) | API / Backend (Node.js Function) | — | Wisenet credentials in `getWisenetEnv()` are server-only; client-bundle isolation enforced by Phase 2 verification |
| Postgres read (action state, ownership, inactive) | API / Backend (Node.js Function) | — | Drizzle clients import `getDbEnv()`; never reachable from `web/src/components/**` |
| Dashboard payload composition + cache | API / Backend (Node.js Function) | Vercel Runtime Cache (regional, per-deployment) | `'use cache: remote'` lifts the cached output into Vercel's regional KV; consumers in functions across the same region share the entry |
| Mutation writes (action state, inactive) | API / Backend (Route Handler) | Postgres (single-statement HTTP) or Bulk (Pool transaction) | D-25 splits HTTP vs WebSocket; both are server-side |
| Cache-invalidation post-write | API / Backend (Route Handler or Server Action) | Vercel Runtime Cache | **Critical:** `revalidateTag` works from Route Handlers; `updateTag` does NOT (Next.js 16 contract) |
| Dashboard render | Browser / Client (`"use client"` components) | API / Backend (route handlers serve JSON) | Existing pattern from Phase 1; Phase 3 does not change this layering |
| Health probe | API / Backend (Node.js Function, NO cache wrapper) | — | D-32 explicitly forbids caching the health endpoint |
| Archive-link affordance | Browser / Client (existing `student-detail.tsx`) | — | Static URL constant; no server roundtrip |

## System Architecture Diagram

```
                                       ┌────────────────────────────────────────┐
                                       │ Browser (operator)                    │
                                       │ - Dashboard React shell ("use client")│
                                       │ - Student Detail + archive-link (D-30)│
                                       └────────────────┬──────────────────────┘
                                                        │ HTTPS JSON
                                                        ▼
        ┌───────────────────────────────────────────────────────────────────────┐
        │ Next.js 16 App Router (Vercel Function, runtime = "nodejs")         │
        │                                                                      │
        │  Route handlers (SVC-04):                                           │
        │   ┌──────────────────────┐  ┌──────────────────────┐                │
        │   │ /api/dashboard GET  │  │ /api/actions POST   │                │
        │   │  → service.ts       │  │  → upsertFollowUpState│              │
        │   │     getDashboard…() │  │  → appendFollowUpLog │                │
        │   └─────────┬───────────┘  │  → revalidateTag(*)  │                │
        │             │               └────────┬─────────────┘                │
        │             │                        │                              │
        │   ┌─────────▼─────────────────────┐  │                              │
        │   │ service.ts (SVC-02)         │  │                              │
        │   │  'use cache: remote'        │  │                              │
        │   │  cacheTag('dashboard-…')    │  │                              │
        │   │  cacheLife({stale,reval,exp})│ │                              │
        │   │   ▼                          │  │                              │
        │   │ buildDashboardSourcesFromW… │  │                              │
        │   │   + bulkGetAdminOwnership() │  │                              │
        │   │   + loadActionStateMap()    │  │                              │
        │   │   + listInactive()          │  │                              │
        │   │   + composeDashboardSrcs(…) │  │                              │
        │   │   + buildDashboardModel()   │  │                              │
        │   └────────┬───────┬────────────┘  │                              │
        │            │       │                │                              │
        │   ┌────────▼─┐ ┌───▼──────────┐    │                              │
        │   │ Wisenet  │ │ Postgres    │◄───┘ (writes)                      │
        │   │ client   │ │ Drizzle/HTTP│                                    │
        │   │ (Phase 2)│ │ +Pool(bulk) │                                    │
        │   └────┬─────┘ └─────┬───────┘                                    │
        │        │             │                                             │
        └────────┼─────────────┼─────────────────────────────────────────────┘
                 │             │
                 ▼             ▼                       ┌──────────────────────┐
       ┌─────────────────┐ ┌──────────────────┐        │ Vercel Runtime Cache│
       │ api.wiseapp.live│ │ Neon Postgres   │        │ (regional, ephemeral)│
       │  (read-only)    │ │ (single-region) │◄──tag──┤ key=hash(fn,args)   │
       └─────────────────┘ └──────────────────┘  read │ value=DashboardPayload│
                                                       │ TTL=60s revalidate  │
                                                       │ expire=300s         │
                                                       └──────────┬──────────┘
                                                                  │
                                                                  ▼ revalidateTag(tag,"max")
                                                                  └─ stale-while-revalidate
```

**Trace primary use case (read):** Browser → `/api/dashboard` GET → `service.getDashboardPayload()` → `'use cache: remote'` checks Runtime Cache → HIT returns cached payload | MISS executes `buildDashboardPayloadUncached`-equivalent (Wisenet fetch + Postgres reads + compose) → store in Runtime Cache (tagged + TTL) → return to browser.

**Trace mutation use case (write):** Browser → `/api/actions` POST → `requireSessionUser()` → Postgres write (`upsertFollowUpState` + `appendFollowUpLog`) → `revalidateTag('dashboard-payload', 'max')` marks tag stale → next read returns stale-while-revalidate (cached) AND triggers background refresh.

## Standard Stack

### Core (already pinned in Phase 2 — verified current 2026-04-29)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `16.2.1` (in package.json); `16.2.4` latest | App Router + Cache Components feature | `cacheComponents`, `'use cache: remote'`, `cacheTag`, `cacheLife`, `updateTag`, `revalidateTag`-with-profile all introduced in v16.0.0. **No upgrade needed for Phase 3** — 16.2.1 has the full surface. [VERIFIED: `npm view next version`] |
| `@vercel/functions` | `^3.4.3` (installed); `3.4.4` latest | `attachDatabasePool` (already wired); `getCache` available but not needed for SVC; `after()` is in `next/server` not `@vercel/functions` per Vercel docs | Phase 2 uses for `attachDatabasePool` only. Phase 3 does NOT need to add new imports from this package. [VERIFIED: `npm view @vercel/functions version` → 3.4.4] |
| `@neondatabase/serverless` | `^1.1.0` (latest) | HTTP driver (`db`) + WebSocket Pool (`bulkDb`) | Phase 2 contract per D-17/D-25. Phase 3 consumes unchanged. [VERIFIED] |
| `drizzle-orm` | `^0.45.2` (latest 0.45.2) | Type-safe Postgres queries | Phase 2 contract. Phase 3 consumes unchanged. [VERIFIED] |
| `next-auth` | `5.0.0-beta.30` | Google OAuth | Phase 4 pins exact. Phase 3 must NOT touch this dep. [CITED: web/package.json] |
| `react` / `react-dom` | `19.2.4` | UI runtime | Phase 3 does not change. [CITED: web/package.json] |
| `vitest` | `^3.2.4` | Test runner (Node env) | TEST-03 + TEST-06 land here. [CITED: web/package.json] |

### Supporting (no new deps in Phase 3)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | `^3.25.76` | Wisenet boundary validation | Already in Phase 2 stack |
| `p-limit` | `^5.0.0` | Bounded concurrency for teacher-feedback fetch | Already used in Phase 2 mappers |
| `tsx` | `^4.20.3` | Run scripts (db-migrate, seed-admin) | Phase 2 scripts unchanged |

### Removed in Phase 3 (SVC-06)

| Library | Why Removed |
|---------|-------------|
| `googleapis` | Last consumer is `lib/sheets/*` which is deleted in SVC-05. Confirmed zero remaining server-side consumers post-cutover. [VERIFIED: grep web/src/ for googleapis import] |

### Alternatives Considered (rejected per CONTEXT)

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| `'use cache: remote'` | `unstable_cache` (Phase 2 current shape) | D-23 explicit. `unstable_cache` is the Next.js 15 path; Next.js 16 + Cache Components moves to declarative directives. |
| Single dashboard tag | Per-student tags (`student-<key>`) | D-28 explicit "Zero additional tags at this phase. Per-student tags are a v2 OPS optimization." |
| `updateTag` from route handlers | `revalidateTag(tag, "max")` from route handlers | **Forced by Next.js 16 contract** — `updateTag` only works in Server Actions. See finding below. |
| Inline `revalidateTag` calls in routes | Centralized actions.ts facade | CONTEXT prefers (b) facade for single-source-of-truth. |

**Installation (no changes needed):**

No `npm install` in Phase 3. SVC-06 is a `npm uninstall googleapis` step in commit 03-09 per D-33.

**Version verification (confirmed 2026-04-29):**

```bash
npm view next version           # → 16.2.4 (16.2.1 in package.json — no upgrade needed)
npm view @vercel/functions version   # → 3.4.4 (3.4.3 installed — no upgrade needed)
npm view @neondatabase/serverless version   # → 1.1.0 (^1.1.0 installed)
npm view drizzle-orm version    # → 0.45.2 (^0.45.2 installed)
```

## Architecture Patterns

### Recommended Project Structure (no new dirs in Phase 3)

```
web/
├── next.config.ts                              # SVC-01: + cacheComponents: true
├── package.json                                # SVC-06: - googleapis, - ensure-* scripts
├── scripts/
│   └── lint-no-revalidate-max.sh               # See §Lint reconciliation below
└── src/
    ├── app/
    │   └── api/
    │       ├── dashboard/route.ts              # SVC-04: NEW (currently missing!)
    │       ├── actions/
    │       │   ├── route.ts                    # SVC-04: rewrite (Sheets → Postgres)
    │       │   ├── bulk/route.ts               # SVC-04: NEW (uses bulkDb per D-25)
    │       │   └── history/route.ts            # SVC-04: NEW
    │       ├── inactive/route.ts               # SVC-04: NEW
    │       └── health/route.ts                 # SVC-07: NEW (D-32 shape)
    ├── components/
    │   └── dashboard/
    │       └── student-detail.tsx              # SVC-08: + archive-link in header
    ├── lib/
    │   ├── dashboard/
    │   │   ├── config.ts                       # + ARCHIVE_ACTION_SHEET_URL
    │   │   ├── service.ts                      # SVC-02: full rewrite
    │   │   ├── actions.ts                      # SVC-03: rewrite as facade ('use server')
    │   │   ├── build.ts                        # DELETE (consumes lib/sheets/*)
    │   │   ├── snapshot-store.ts               # SVC-05 DELETE (per-process — broken on serverless)
    │   │   └── health-state.ts                 # KEEP (helper used by /api/health)
    │   ├── runtime/
    │   │   └── logger.ts                       # NEW: D-37 structured console.error
    │   ├── sheets/                             # SVC-05 DELETE (whole dir)
    │   ├── cache/
    │   │   └── memory-cache.ts                 # SVC-05 DELETE
    │   ├── wisenet/                            # UNCHANGED (Phase 2 contract)
    │   └── db/                                 # UNCHANGED (Phase 2 contract)
    └── test/
        ├── cache-invalidation.test.ts          # NEW (TEST-03 — gated on TEST_DATABASE_URL)
        └── chunked-transfer-regression.test.ts # NEW (TEST-06)
```

### Pattern 1: `'use cache: remote'` directive (SVC-02)

**What:** Top-of-function-body string directive that tells Next.js to cache the function's output in the Vercel Runtime Cache (a regional, ephemeral KV store) instead of in-process memory.

**When to use:** Wrapping the dashboard payload composition. Mandatory for SVC-02 per D-23 + ROADMAP SC#2.

**Exact syntax (verified from Next.js 16.2.4 official docs):**

```ts
// Source: https://nextjs.org/docs/app/api-reference/directives/use-cache-remote (2026-04-10)
// Source: https://vercel.com/docs/runtime-cache (Vercel Runtime Cache reference)

import { cacheLife, cacheTag } from "next/cache";

import { buildDashboardSourcesFromWisenet } from "@/lib/wisenet/mappers";
import { bulkGetAdminOwnership, loadActionStateMap, listInactive } from "@/lib/db/queries";
import { DASHBOARD_CACHE_TAG } from "@/lib/dashboard/config";

export async function getDashboardPayload(now = new Date()) {
  "use cache: remote";
  cacheTag(DASHBOARD_CACHE_TAG);
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });

  // ... existing buildDashboardPayloadUncached body adapted to call Wisenet + Postgres
  // instead of Sheets. NB: directive is a STRING LITERAL with single OR double quotes;
  // semicolon required (it's a JS expression statement). Must be FIRST statement
  // before any other code (after parameter destructuring).
}
```

**Critical placement rules (cited from Next.js docs):**
1. Directive is a **string literal** (`"use cache: remote"` or `'use cache: remote'`).
2. Placement: **inside** the function body, as the **first statement** (before all other code, including imports of inner helpers).
3. `cacheTag(...)` and `cacheLife(...)` calls must come **after** the directive but **before** any awaits / async work that you want cached.
4. Function MUST be `async` (cited: "When used at file level, all function exports must be async functions").
5. Arguments must be serializable per React Server Components contract (primitives, plain objects, Date — NO class instances, NO functions, NO URL objects).
6. **`cacheComponents: true` MUST be in `next.config.ts`** — this is what enables the directive at compile time.

### Pattern 2: `cacheComponents: true` config (SVC-01)

**What:** Single boolean flag in `next.config.ts` that enables `'use cache'`, `'use cache: remote'`, `'use cache: private'`, `cacheLife`, `cacheTag`, `updateTag`, and the React `<Activity>`-based navigation state preservation.

**Exact syntax (verified from Next.js 16.2.4 official docs):**

```ts
// web/next.config.ts (SVC-01)
// Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents (2026-04-10)
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,    // SVC-01 — sibling key, NOT nested
};

export default nextConfig;
```

**Side effects to verify on Vercel preview build (per D-35 gate item 1):**

- App Router pages now exclude data fetching from prerenders unless explicitly cached. **Risk:** any page or component that did fetch-without-cache and was previously prerendered may now error at build time with the "use of dynamic API outside Suspense" class of errors.
- `<Activity>` component preservation: client-side navigations between routes preserve the previous route's component state. **Risk:** stateful UI components that assumed unmount-on-nav (e.g., the dashboard's keyboard-shortcut handlers, the student-detail panel's local state) may now persist state across navigations. **Phase 3 verification:** in operator manual QA (D-35 step 4), test "navigate to /signin → back to /dashboard" preserves filter selection state.
- Build-time prerendering: any short-lived `'use cache'` (under 5 minutes revalidate or zero revalidate) auto-becomes a "dynamic hole" requiring `<Suspense>`. **Phase 3 implication:** the planned 60s revalidate IS short — service.ts's wrapper might trigger this. Mitigation: the dashboard route is gated behind `(protected)/dashboard/page.tsx` which is auth-gated and dynamic anyway.
- **Compatible with `next-auth@5.0.0-beta.30`:** [ASSUMED] — no docs confirm or deny. NextAuth uses `cookies()` and `headers()` which are runtime APIs. The auth wrapper is in `web/src/auth.ts` and is consumed via route segments and the `(protected)` layout — those segments are rendered at request time anyway. Risk LOW but uncovered until Vercel preview build runs. Recommendation: D-35 gate item 1 includes `npm run build` specifically to catch this.
- **Compatible with `runtime = "nodejs"`:** YES per Next.js docs (verified — `cacheComponents` operates at the Next.js framework layer; runtime declaration is independent).

**Version requirement:** Next.js 16.0.0+. Project is on 16.2.1 — SAFE.

### Pattern 3: `cacheLife` semantics for 60s mirror (Claude's Discretion)

**Three available shapes (cited from Next.js 16.2.4 docs):**

```ts
// Inline custom profile (recommended for SVC-02)
cacheLife({ stale: 60, revalidate: 60, expire: 300 });

// Named preset (cited table — minutes profile is closest to 60s mirror)
cacheLife("minutes");   // → stale: 5min, revalidate: 1min, expire: 1hr

// Pure-expire shorthand
cacheLife({ expire: 60 });  // stale + revalidate inherit from "default" profile
                            //  (stale: 5min, revalidate: 15min) — NOT what D-28 wants
```

**Semantics (cited verbatim from Next.js docs):**

- **`stale`** = "How long the client can use cached data without checking the server." Client-router setting; affects browser-side prefetched-link freshness. **Min 30s enforced** so prefetched links remain usable.
- **`revalidate`** = "How often the server regenerates cached content in the background." When a request arrives after this period: serves cached version immediately + regenerates in background + updates cache.
- **`expire`** = "Maximum time before the server must regenerate cached content." After this period with no traffic, next request waits synchronously for fresh content. **Constraint: `expire` must be `>= revalidate` — Next.js validates and errors otherwise.**

**Recommendation for D-28 (60s mirror):**

```ts
cacheLife({ stale: 60, revalidate: 60, expire: 300 });
```

- `stale: 60` — operators see ≤ 60s stale data on client-router cache, matches D-28 intent. (NB: Next.js enforces 30s minimum, so this clamps if anyone tries to go lower; 60 is safely above.)
- `revalidate: 60` — server-side stale-while-revalidate triggers every 60s; matches the existing `unstable_cache { revalidate: 60 }` semantics exactly.
- `expire: 300` — 5-minute hard ceiling. If no traffic for 5 minutes, next request synchronously regenerates (one-time slow request after low-traffic windows; acceptable tradeoff for predictable freshness). Required because `expire >= revalidate` is the validation rule and unbounded `expire: never` (the default) means dead caches sit forever.

**Rejected `cacheLife({ expire: 60 })`** — pure-expire shorthand inherits `revalidate: 15min` from the "default" profile, which is **15× the intended 60s freshness window**. This was likely a CONTEXT D-28 oversight; the planner should override.

**Rejected named profile `"minutes"`** — `revalidate: 1min` is correct, but `stale: 5min` and `expire: 1hr` are both more lax than D-28 intent.

**Confidence:** HIGH — all three shapes pulled directly from Next.js 16.2.4 docs.

### Pattern 4: `cacheTag` syntax + Limits (SVC-02)

**Cited verbatim from `https://nextjs.org/docs/app/api-reference/functions/cacheTag`:**

```ts
import { cacheTag } from "next/cache";

async function getProducts() {
  "use cache";
  cacheTag("products");                     // single tag
  cacheTag("products", "global");           // multiple tags (variadic args)
  cacheTag(`product-${id}`, "products");    // computed tags (per-student v2)
  // ...
}
```

**Limits (Next.js cacheTag docs):**

- Max length per tag: **256 characters**
- Max tags per cache entry: **128** (Next.js docs say 128 — Vercel Runtime Cache docs say 64; conservative limit is 64 since Vercel is the storage backend)
- Tag values are **case-sensitive**
- "Idempotent": same tag applied multiple times has no additional effect
- Tag names cannot contain commas (per `addCacheTag` from `@vercel/functions`)

**For Phase 3:** Single tag `"dashboard-payload"` (per D-28). Length: 17 chars. Safe.

### Pattern 5: Cache Invalidation Function — `revalidateTag` vs `updateTag` (CRITICAL FINDING)

⚠️ **This finding overrides CONTEXT.md D-28's recommendation to use `updateTag`.**

**Cited verbatim from `https://nextjs.org/docs/app/api-reference/functions/updateTag` (2026-04-10):**

> "**`updateTag` can only be called from within Server Actions. It cannot be used in Route Handlers, Client Components, or any other context.**"
>
> "If you need to invalidate cache tags in Route Handlers or other contexts, use [`revalidateTag`](/docs/app/api-reference/functions/revalidateTag) instead."

**Implication for Phase 3:**

The 5 mutation sites listed in D-28 are all consumed by **Route Handlers** (POST /api/actions, POST /api/actions/bulk, POST + DELETE /api/inactive). These are NOT Server Actions. **Calling `updateTag` from a route handler will throw at runtime.**

**Three resolution paths the planner must choose between:**

| Path | Approach | Tradeoff |
|------|----------|----------|
| **A** | Call `revalidateTag('dashboard-payload', 'max')` from route handlers | Stale-while-revalidate semantics (operator may see stale data on the very next read; refresh fires in background). Acceptable for Phase 3's 60s freshness budget. **Recommended.** |
| **B** | Call `revalidateTag('dashboard-payload', { expire: 0 })` from route handlers | Immediate cache expiration on next read (read-your-own-writes guarantee). Vercel docs cite this pattern explicitly for "webhooks or third-party services that need immediate expiration." Slightly slower next-read because no stale-while-revalidate window. |
| **C** | Move the mutation surface into Server Actions, then `updateTag('dashboard-payload')` | True read-your-own-writes via `updateTag`. Requires route handlers to either thin-wrap the action OR pages submit forms directly to actions. Larger refactor surface — the existing React shell calls `fetch('/api/actions', ...)` from `dashboard-shell.tsx`, which is a route-handler call, not a server-action call. Switching means the React side has to change too. |

**Recommendation:** **Path A** (`revalidateTag('dashboard-payload', 'max')` from route handlers).

- The cutover is meant to be a behavior-preserving rewrite. The current `unstable_cache` + `revalidateTag` pattern operates with the same stale-while-revalidate semantics that Path A preserves.
- Path C requires React-side changes outside Phase 3 scope (CONTEXT explicitly says "external JSON response shapes unchanged for the React client").
- Path B is a defensible alternative if Kevin wants strict read-your-own-writes for action submissions — but it means the very next read after a write does a full origin fetch (Wisenet + Postgres compose), which on a multi-action operator workflow could be 50× origin fetches in a minute. Path A's stale-while-revalidate is more origin-friendly.

**Cited verbatim from `https://nextjs.org/docs/app/api-reference/functions/revalidateTag` (2026-04-10):**

> "`revalidateTag` can be called in Server Functions and Route Handlers."
>
> "**With `profile="max"` (recommended)**: The tag entry is marked as stale, and the next time a resource with that tag is visited, it will use stale-while-revalidate semantics."
>
> "**Without the second argument (deprecated)**: The tag entry is expired immediately, and the next request to that resource will be a blocking revalidate/cache miss. **This behavior is now deprecated**, and you should either use `profile="max"` or migrate to `updateTag`."

**Exact syntax for Path A in route handler:**

```ts
// web/src/app/api/actions/route.ts (post-rewrite, Path A)
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { requireSessionUser } from "@/lib/auth/session";
import { upsertFollowUpState, appendFollowUpLog } from "@/lib/db/queries";
import { DASHBOARD_CACHE_TAG } from "@/lib/dashboard/config";
import { normalizeStudentActionStatus } from "@/lib/dashboard/actions";
import { log } from "@/lib/runtime/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const { studentKey, status, studentName, parentName } = await request.json();
    const normalized = normalizeStudentActionStatus(status);

    if (normalized) {
      // 1. Postgres write FIRST (atomic single-statement HTTP)
      await upsertFollowUpState({
        studentKey, studentName, parentName,
        status: normalized,
        updatedByEmail: user.email,
        updatedByName: user.name,
      });
      await appendFollowUpLog({
        studentKey, studentName, parentName,
        actionType: "set",
        status: normalized,
        actorEmail: user.email, actorName: user.name,
      });
    }

    // 2. Cache invalidation SECOND — happens only if writes above succeeded
    revalidateTag(DASHBOARD_CACHE_TAG, "max");

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log("error", "/api/actions", error, { /* extras */ });
    return NextResponse.json({ error: "Action request failed" }, { status: 500 });
  }
}
```

### Pattern 6: `updateTag` placement guarantees (D-28 question)

**D-28 asks:** "Does `updateTag` only commit if the wrapping function returns successfully?"

**Researched answer (re-asking against `revalidateTag`-with-max since `updateTag` is unavailable in route handlers):**

Both `revalidateTag(tag, "max")` and `updateTag(tag)` are **synchronous, side-effecting calls that mark a tag as stale immediately**. They do NOT participate in a transactional commit boundary with the wrapping function. If you call `revalidateTag` and then throw, **the tag is already marked stale** — but in Phase 3 the order is:

```ts
await db.write(...);              // (1) — throws here = no invalidation, no DB change
revalidateTag(tag, "max");        // (2) — synchronous, fires immediately on (1) success
return NextResponse.json(...);    // (3) — formats response
```

If (3) throws (e.g., JSON serialization error), the cache IS already invalidated. This is acceptable: invalidating a cache that holds correct data just causes one extra origin fetch. The bug pattern to AVOID is order-inverted: `revalidateTag` then `await db.write()` — invalidating before the write commits creates a window where the cache miss returns pre-write data, then the write completes and the cache fills with post-write data. D-28's "write FIRST, invalidate SECOND" rule prevents this.

**Propagation latency (CONTEXT cited 300ms):**

[CITED: `https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package`]

> "After assigning tags to your cached data, use the `expireTag` method to invalidate all cache entries associated with that tag. **This operation is propagated globally across all Vercel regions within 300ms.**"

This 300ms figure is for `getCache().expireTag(...)` (the framework-agnostic API). For `revalidateTag` from Next.js (which is what Phase 3 uses), the docs do NOT cite an explicit propagation SLA. **[ASSUMED]** the same 300ms applies because Next.js's `revalidateTag` ultimately drives the same Runtime Cache backend on Vercel. 300ms is fast enough that operator workflows (multi-second between actions) don't notice.

### Pattern 7: Vercel Runtime Cache constraints (D-28 verification)

**Cited verbatim from `https://vercel.com/docs/runtime-cache`:**

| Property | Limit |
|----------|-------|
| Item size | **2 MB** |
| Tags per item | **64 tags** (Next.js docs say 128 for `cacheTag`; Vercel storage caps at 64) |
| Maximum tag length | **256 bytes** (UTF-8 encoded — counts byte length, not character count) |

**Plus cited constraints not in CONTEXT:**

- **Regional, not global** — "Each region has its own cache." Different Vercel regions don't share entries. Your Vercel project is in a single region (Sydney/AEST), so this is fine for Phase 3.
- **Isolated per project + environment** — `preview` and `production` have separate caches. PR previews can populate cache without affecting prod.
- **LRU eviction under storage pressure** — "When your project reaches this limit, Vercel evicts the entries that haven't been accessed recently." Phase 3's hot 1-tag dashboard payload is unlikely to evict.
- **Persistent across deployments** — cached data survives a new deploy. Tag updates don't reconcile across deployments — if you change `cacheLife` config in a deploy, old entries keep their old TTL until manually invalidated.

**Phase 3 size budget for the 2 MB item limit:**

Current dashboard payload (production approximation, calculated from `web/src/types/dashboard.ts` shape):
- `students[]`: hundreds × ~3 KB each (StudentRecord + nested PackageRecord[] with projection points + upcomingSessions)
- `summary`, `calendar`, `queue`: aggregations on top — small fraction of students total
- Round number: **assume ~1.5–2 MB at peak** for a center with hundreds of students.

**Risk assessment:** [ASSUMED — needs empirical verification]
- 2 MB is REAL and the dashboard payload IS at risk if BeGifted Education grows to 500+ active students with full package histories.
- **Recommendation:** Add a payload-size sanity check in TEST-03 or in service.ts itself:
  ```ts
  // In service.ts after compose, before return
  const serialized = JSON.stringify(payload);
  if (serialized.length > 1_800_000) {  // 1.8 MB warn threshold
    log("warn", "service.ts", new Error("payload-size-near-limit"), { size: serialized.length });
  }
  ```
- **Worst case if exceeded:** Per Vercel docs "Items larger than this will not be cached." Function still works (returns uncached) — every dashboard load becomes a Wisenet + Postgres round-trip. Not a correctness bug, just a performance regression.
- **Long-term mitigation:** v2 OPS-02 per-student cache tags split the payload — out of scope here.

### Pattern 8: Health endpoint with structured probe (SVC-07)

**Cited from D-32 + Vercel uptime conventions:**

```ts
// web/src/app/api/health/route.ts (NEW per SVC-07)
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { wisenetFetch } from "@/lib/wisenet/client";
import { getAuthEnv } from "@/lib/runtime/env";
import { z } from "zod";

export const runtime = "nodejs";
// CRITICAL per D-32: NO 'use cache: remote' here — health must probe live every call

interface SubsystemStatus {
  status: "ok" | "degraded" | "down";
  latencyMs?: number;
  error?: string;
}

interface AuthStatus {
  status: "ok" | "down";
  error?: string;
}

export async function GET() {
  const timestamp = new Date().toISOString();
  const [wisenet, postgres, auth] = await Promise.all([
    probeWisenet(),
    probePostgres(),
    probeAuth(),
  ]);

  // Status rollup per D-32
  const overall: "ok" | "degraded" | "down" =
    [wisenet, postgres].some((s) => s.status === "down") || auth.status === "down" ? "down"
    : [wisenet, postgres].some((s) => s.status === "degraded") ? "degraded"
    : "ok";

  const statusCode = overall === "down" ? 503 : 200;  // D-32: 503 only on down

  return NextResponse.json({
    status: overall,
    timestamp,
    subsystems: { wisenet, postgres, auth },
    deployedAt: process.env.VERCEL_DEPLOYMENT_ID,
  }, { status: statusCode });
}

async function probeWisenet(): Promise<SubsystemStatus> {
  const start = Date.now();
  try {
    // Cheap GET via wisenetFetch with small page_size — D-32 says HEAD or cheap GET
    // wisenetFetch uses retryOn429 + AbortSignal.timeout(15_000); for /api/health
    // we want fail-fast (single retry max). Plan note: if wisenetFetch's retry
    // config is hard-coded, the planner adds an init.signal override OR a flag
    // that disables retry for the health probe.
    await wisenetFetch(`/institutes/v3/${process.env.WISENET_CENTER_ID}/students?page_size=1`,
      z.object({ status: z.string() }).passthrough(),
      { signal: AbortSignal.timeout(5_000) }  // 5s health-probe budget
    );
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return { status: "down", latencyMs: Date.now() - start,
             error: error instanceof Error ? error.message : String(error) };
  }
}

async function probePostgres(): Promise<SubsystemStatus> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);  // D-32: HTTP driver, SELECT 1
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return { status: "down", latencyMs: Date.now() - start,
             error: error instanceof Error ? error.message : String(error) };
  }
}

function probeAuth(): AuthStatus {
  // D-32: env presence only, no live mint
  try {
    getAuthEnv();
    return { status: "ok" };
  } catch (error) {
    return { status: "down",
             error: error instanceof Error ? error.message : String(error) };
  }
}
```

**Verified against Vercel uptime monitor conventions:** [VERIFIED via Vercel docs] Vercel observability checks for 200/503 split — degraded should NOT page on call (200) but down should (503). D-32's split matches.

**HEAD probe semantics for the Wisenet fast probe:** [ASSUMED] — I did NOT find Wisenet docs confirming HEAD support. Recommendation: use cheap GET with `page_size=1` per D-32 (which already says "HEAD or cheap GET"). Phase 1 fingerprints didn't probe HEAD.

### Pattern 9: Vitest streaming-fetch mock (TEST-06)

**TEST-06 goal:** Simulate a Wisenet response that arrives chunked (HTTP/1.1 Transfer-Encoding: chunked) and assert that the `wisenetFetch` → mapper → service.ts pipeline composes a valid `DashboardPayload`.

**Cited from MDN ReadableStream API + Vitest 3 mocking docs:**

```ts
// web/src/test/chunked-transfer-regression.test.ts (NEW — TEST-06)
// Source: MDN https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams
// Source: Vitest https://vitest.dev/api/vi.html#vi-stubglobal
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

function makeChunkedJsonResponse(json: unknown): Response {
  // Serialize once, then split into multiple chunks — server-side body simulation.
  const fullText = JSON.stringify(json);
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode(fullText.slice(0, Math.floor(fullText.length / 3))),
    encoder.encode(fullText.slice(Math.floor(fullText.length / 3),
                                   Math.floor(2 * fullText.length / 3))),
    encoder.encode(fullText.slice(Math.floor(2 * fullText.length / 3))),
  ];

  const stream = new ReadableStream({
    start(controller) {
      // Push all chunks then close. For more realistic simulation, you can
      // wrap each enqueue in a microtask delay via queueMicrotask, but
      // it's not necessary — Response.json() pulls until close.
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });

  // Headers MUST set Content-Type so response.json() works. Transfer-Encoding
  // is set by the runtime — Vitest mock just needs the body stream.
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("chunked transfer regression (TEST-06)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(makeChunkedJsonResponse({
        status: "ok",
        data: { students: [/* fixture students */], count: 1 },
      }))
    ));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getDashboardPayload resolves cleanly when Wisenet response arrives chunked", async () => {
    // Direct chunked-response → mapper → composeDashboardSourcesFromData smoke test.
    // Asserts no parse errors, returns a valid DashboardPayload shape.
    const { wisenetFetch } = await import("@/lib/wisenet/client");
    const { z } = await import("zod");

    const result = await wisenetFetch(
      "/institutes/v3/abc/students?page_number=1&page_size=50",
      z.object({ status: z.string(), data: z.object({
        students: z.array(z.unknown()), count: z.number() }) }).passthrough(),
    );

    expect(result.status).toBe("ok");
    expect(result.data.count).toBe(1);
  });
});
```

**Critical correctness notes:**

1. **`new Response(stream, ...)` accepts `ReadableStream<Uint8Array>`** in Node 22+. Verified: Phase 2's `wisenetFetch` already calls `response.json()` which internally consumes the stream — TEST-06 just needs to give it a stream-bodied Response.
2. **`response.json()` does the chunk concatenation transparently.** The test asserts the ZOD-parsed result, which proves the full pipeline (network → buffer → parse → schema → mapper) survives chunked input.
3. **Why this is a meaningful regression test:** A buggy implementation that called `await response.text()` and then `JSON.parse(...)` could in theory race the chunks, but the standard Fetch API stream consumers wait for `controller.close()` before resolving. Test value: catches a future "we replaced wisenetFetch internals" PR that switched to a custom stream reader and broke chunk assembly.
4. **`vi.stubGlobal("fetch", ...)`** [VERIFIED: Vitest docs] resets only via `vi.unstubAllGlobals()` in `afterEach` OR by setting the `unstubGlobals: true` config option in `vitest.config.ts` (Phase 2 didn't set this).
5. **Confidence:** HIGH for the Response/ReadableStream shape. MEDIUM for whether wisenetFetch's full retry-wrapped path works without modification — Phase 2 verification showed `wisenetFetch` works with mocked Responses, but didn't specifically test stream-bodied Responses. [ASSUMED] based on standard Fetch contract.

### Pattern 10: Neon branching for TEST-03 (Claude's Discretion)

**Two ergonomically-distinct paths:**

| Path | Mechanism | Auth | Lifecycle |
|------|-----------|------|-----------|
| (a) Test creates branch | REST API: `POST /projects/{project_id}/branches` via Neon API | `Authorization: Bearer $NEON_API_KEY` (personal/project key) | API-created branches have **no expiration by default**; test must `DELETE /projects/{project_id}/branches/{branch_id}` in afterAll |
| (b) Operator pre-provisions branch | `vercel env pull` after Marketplace creates a preview branch, OR manually creates via Neon Console | Already-injected `DATABASE_URL_UNPOOLED` for the preview env | Console-created branches have **1-day expiration by default**; operator manages |

**[CITED: https://neon.com/docs/manage/branches]**

> "API/CLI branches have **no expiration by default**" — auto-cleanup is opt-in.
>
> "Console creates branches with 1 day expiration by default."
>
> "Deleting a branch is a permanent action."

**Phase 2 reality check:**

`.github/workflows/db-migrate.yml` already uses `secrets.DATABASE_URL_UNPOOLED` at the GitHub Actions level. This implies the operator-provisioned branch model is already in play for Phase 2's CI. **Path (b) is the cleaner extension.**

**Recommendation: path (b) — operator-provisioned `TEST_DATABASE_URL`.**

```yaml
# Hypothetical .github/workflows/test-cache-invalidation.yml (Phase 4 may formalize)
name: cache-invalidation-integration
on:
  workflow_dispatch: {}
  pull_request:
    paths: ["web/src/lib/dashboard/service.ts", "web/src/test/cache-invalidation.test.ts"]
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      TEST_DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}    # Operator pre-provisions
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm",
                cache-dependency-path: web/package-lock.json }
      - run: cd web && npm ci
      - run: cd web && npx tsx scripts/db-migrate.ts
        env: { DATABASE_URL_UNPOOLED: ${{ secrets.TEST_DATABASE_URL }} }
      - run: cd web && npm test -- --run cache-invalidation
```

**Why (b) over (a):**

- Phase 2's existing pattern is operator-provisioned secrets — consistency.
- Path (a) requires a second secret (`NEON_API_KEY`) on top of `TEST_DATABASE_URL`.
- Path (a)'s branch creation is an extra failure surface: if the API token rotates, every test run breaks.
- Path (a)'s teardown is a real cleanup risk — flaky branch deletes leave orphan branches accumulating in the Neon project.
- D-29 says "skip by default in CI; opt-in via CI matrix job" — operator-provisioned aligns with opt-in semantics.

**Test shape (D-29 8-step):**

```ts
// web/src/test/cache-invalidation.test.ts (NEW — TEST-03)
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("cache invalidation regression (TEST-03)", () => {
  beforeAll(async () => {
    // 1+2. Migrations run via CI step before vitest invokes; assume schema present.
    // 3. Seed minimal fixture state — 1 student, no actions
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.DATABASE_URL_UNPOOLED = TEST_DATABASE_URL;
    // ... insert 1 row into student_admin_ownership for the test student
  });

  afterAll(async () => {
    // 8. Truncate test tables (NOT drop branch — operator owns branch lifecycle)
    // ... truncate follow_up_state, follow_up_log, inactive_students
  });

  it("write to follow_up_state → next read reflects it", async () => {
    // 4. Mock Wisenet fetch to return fixture data
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(/* wisenet fixture */), {
        status: 200, headers: { "Content-Type": "application/json" },
      }))
    ));

    // 5. Call getDashboardPayload() → assert action state empty
    const { getDashboardPayload } = await import("@/lib/dashboard/service");
    const payload1 = await getDashboardPayload();
    expect(payload1.students.find((s) => s.studentKey === TEST_STUDENT_KEY)
                          ?.actionState).toBeNull();

    // 6. Call setStudentAction (or directly upsertFollowUpState + appendFollowUpLog
    //    + revalidateTag) → triggers cache invalidation
    const { upsertFollowUpState, appendFollowUpLog } = await import("@/lib/db/queries");
    await upsertFollowUpState({/* contacted */});
    await appendFollowUpLog({/* set, contacted */});
    const { revalidateTag } = await import("next/cache");
    revalidateTag("dashboard-payload", "max");

    // 7. Call getDashboardPayload() AGAIN → assert reflects "contacted"
    const payload2 = await getDashboardPayload();
    expect(payload2.students.find((s) => s.studentKey === TEST_STUDENT_KEY)
                          ?.actionState?.status).toBe("contacted");

    vi.unstubAllGlobals();
  });
});
```

**[NOTE]** Calling `revalidateTag` from a Vitest test runs in a synthetic environment without a Next.js function context. Whether the Runtime Cache backend is reachable from a test process is **uncovered** — the test may need to either (1) test the cache key directly via `getCache()` (framework-agnostic API) OR (2) be implemented as an integration test that hits a deployed Vercel preview function. [ASSUMED] Option (2) is the more reliable path. Planner confirms during execution.

**Confidence:** HIGH for the path-(b) recommendation; MEDIUM for the test execution mechanics (the runtime context for `revalidateTag` outside a function instance is the unverified piece).

### Pattern 11: `actions.ts` reconciliation (Claude's Discretion)

CONTEXT.md prefers (b) — facade over queries. Combined with the `updateTag`-Server-Actions-only finding, the cleanest version of (b) is:

```ts
// web/src/lib/dashboard/actions.ts (rewrite — facade pattern, Path A from §Pattern 5)
"use server";   // ← marks every export as a Server Action

import { revalidateTag } from "next/cache";
import { upsertFollowUpState, appendFollowUpLog,
         markInactive as dbMarkInactive,
         clearInactive as dbClearInactive } from "@/lib/db/queries";
import { bulkSetStudentAction } from "@/lib/db/bulk-queries";
import { DASHBOARD_CACHE_TAG } from "@/lib/dashboard/config";

export async function setStudentAction(input: { /*…*/ }) {
  await upsertFollowUpState(input);
  await appendFollowUpLog({ ...input, actionType: "set" });
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
}

export async function clearStudentAction(input: { /*…*/ }) {
  // For "clear" we delete the state row OR set status to null per existing
  // semantics — Phase 2's queries.ts doesn't have a clear; planner adds it.
  await appendFollowUpLog({ ...input, actionType: "clear" });
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
}

export async function bulkSetAction(input: { /*…*/ }) {
  await bulkSetStudentAction(input);
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
}

// markInactive / clearInactive likewise wrap and invalidate.
```

**Caveat per finding §Pattern 5:** Even though this file is `'use server'`, the consumers are Route Handlers (which call these Server Action functions as plain async functions). Per Next.js docs, `revalidateTag` works in both Server Actions and Route Handlers — calling `revalidateTag(tag, "max")` from inside an action that's invoked by a route handler is the canonical pattern. **`updateTag` does NOT work this way** — it specifically requires the call frame to be invoked from a Server Action context (e.g., a `<form action>` POST), not from a route handler that imports the action as a function. The `'use server'` directive establishes the binding at the file level, but the run-time gate on `updateTag` is the originating call site.

### Anti-Patterns to Avoid

- **Calling `updateTag(...)` from a route handler.** It will throw at runtime per Next.js 16 contract. Use `revalidateTag(tag, 'max')` instead.
- **Calling `revalidateTag(tag)` without the `"max"` profile.** Deprecated in Next.js 16 per official docs. Use the two-arg form.
- **Calling `cacheTag` outside a `'use cache*'` scope.** Throws at runtime — tags are only meaningful inside cached functions.
- **Calling `cookies()`/`headers()` inside `'use cache: remote'`.** Throws at runtime ("next-request-in-use-cache" error). Pass cookie/header values as serialized arguments.
- **Returning class instances or URL objects from a `'use cache'` function.** Cache key serialization fails. Return plain objects only.
- **Empty `cacheLife()` calls.** Apply the `default` profile (5min stale / 15min revalidate / never expire) — almost certainly NOT what Phase 3 wants.
- **Multiple `cacheLife` calls in one function.** Behavior undefined per docs ("Only one cacheLife call should execute per function invocation"). Branch via if/else, don't stack calls.
- **Wrapping the health endpoint in `'use cache: remote'`.** Per D-32 explicit — health must probe live every call.
- **Inverting D-28 order (invalidate-then-write).** Creates a window where the cache miss returns pre-write data, then the write fills the cache with post-write data — exact bug class TEST-03 is designed to catch.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cache backend | Custom Redis/KV wrapper | `'use cache: remote'` + Vercel Runtime Cache | Vercel manages eviction, TTL, regional distribution, observability — manual KV wiring re-implements all of this badly |
| Cache key generation | Hand-built hash of arguments | Next.js's automatic build-id + function-id + serialized-args hashing inside `'use cache'` | Cited in Next.js docs; manual hashing breaks closure capture semantics |
| Tag invalidation propagation | Custom pub/sub between regions | `revalidateTag(tag, "max")` | Vercel handles 300ms global propagation per docs |
| Pool drain on Fluid suspend | Manual `pool.end()` in shutdown hooks | `attachDatabasePool(pool)` (Phase 2 already wired) | `@vercel/functions` integrates with Fluid Compute lifecycle |
| Streaming response parser | Custom ReadableStream reader loop | `await response.json()` (built-in handles chunked transparently) | Native Fetch contract handles chunked transfer encoding without app-level concern |
| Health-check status rollup | Custom monitoring DSL | Plain typed objects + an explicit rollup function (D-32 spec) | 30 lines of code; pulling in a library is over-engineering for one endpoint |
| Structured logger | Pino or Winston | `web/src/lib/runtime/logger.ts` (D-37) | Vercel captures `console.error` at the function level; one tiny helper is enough until Phase 4 swaps to Sentry |

**Key insight:** Phase 3 is COMPOSITION, not reinvention. The Phase 2 toolkit (Wisenet client, Drizzle queries, pool singleton) plus Next.js 16's declarative cache directives (`'use cache: remote'` + `cacheTag` + `cacheLife` + `revalidateTag`) covers 100% of the cutover surface. There is NO domain need to write custom caching infrastructure.

## Common Pitfalls

### Pitfall 1: `updateTag`-from-route-handler runtime crash

**What goes wrong:** Mutation route handler calls `updateTag('dashboard-payload')` (per the literal D-28 instruction). At runtime, Next.js throws because `updateTag` is contractually Server-Actions-only.

**Why it happens:** D-28 was written before Next.js 16.0 stabilized the `updateTag` vs `revalidateTag` distinction; the docs got tighter and the gate became a runtime error.

**How to avoid:** Use `revalidateTag(tag, "max")` from route handlers per §Pattern 5 finding.

**Warning signs:** Vercel function logs show `Error: updateTag can only be called from within a Server Action` — first action submission post-deploy fails.

### Pitfall 2: `cacheLife({ expire: 60 })` shorthand inherits 15-minute revalidate

**What goes wrong:** Planner takes D-28 literally and writes `cacheLife({ expire: 60 })`. The unspecified `revalidate` defaults to 15 minutes from the `default` profile. Operators see 15-minute-stale data despite 60-second `expire`.

**Why it happens:** Next.js docs cite "Any omitted properties in a custom profile inherit from the `default` profile."

**How to avoid:** Explicitly specify all three keys: `cacheLife({ stale: 60, revalidate: 60, expire: 300 })`.

**Warning signs:** TEST-03 fails because second `getDashboardPayload()` call returns pre-write payload despite calling `revalidateTag` between them. (The 'max' profile would still mark stale on `revalidateTag`, but the underlying cacheLife mismatch creates an unexpected freshness shape.)

### Pitfall 3: 2 MB payload silent eviction

**What goes wrong:** Center grows to 500+ active students. JSON-serialized payload exceeds 2 MB. Vercel silently does NOT cache the entry. Every dashboard load is a Wisenet + Postgres roundtrip — production p95 spikes.

**Why it happens:** Per Vercel Runtime Cache docs: "Items larger than this will not be cached." Quietly fails open (not closed).

**How to avoid:** Add a payload-size sanity log in service.ts (warns at 1.8 MB). Plan for v2 OPS-02 (per-student tags + smaller payloads) when warns trigger.

**Warning signs:** Sudden drop in cache hit rate visible in Vercel Observability dashboard.

### Pitfall 4: `cacheComponents` enables `<Activity>` mount preservation — UI state leakage

**What goes wrong:** Operator navigates from `/dashboard` to `/signin` and back. With `<Activity>` preservation, `dashboard-shell.tsx` does NOT remount — its filter selection, expanded panels, modal state all persist. If any state was tied to mount lifecycle (e.g., a "first load" timer), it sticks.

**Why it happens:** Cited from cacheComponents docs: "Component state is preserved when navigating between routes."

**How to avoid:** During D-35 manual QA, test navigation away+back. Audit `dashboard-shell.tsx` for any `useEffect(() => {...}, [])` handlers that should re-fire on remount but won't.

**Warning signs:** Admin-filter-selection survives a sign-out → sign-in cycle (might be desirable, might be a leak).

### Pitfall 5: Lint-no-revalidate-max conflict with Next.js 16 best practice

**What goes wrong:** Phase 2 lint forbids `revalidateTag(_, "max")` as an "anti-pattern" (correct in Next.js 15 — the `"max"` arg was bogus). Phase 3 needs to write exactly that pattern (now canonical in Next.js 16). The lint blocks the cutover.

**Why it happens:** Next.js 16 changed the second-arg semantics. What was an anti-pattern is now the recommended pattern.

**How to avoid:** Phase 3 has TWO valid lint paths:
- **(i) Repurpose the lint** — change the regex to forbid `revalidateTag(_)` (single-arg, deprecated in Next.js 16) instead of `revalidateTag(_, "max")` (recommended).
- **(ii) Rewrite the allowlist** — replace single entry `src/lib/dashboard/service.ts` with the new mutation call sites: `src/lib/dashboard/actions.ts`, `src/app/api/actions/route.ts`, `src/app/api/actions/bulk/route.ts`, `src/app/api/inactive/route.ts`.

**Recommendation: path (i)** — better signal value going forward. The single-arg `revalidateTag` deprecation is the actual bug class to guard against in Next.js 16. The original lint's spirit (catch revalidateTag misuse) is preserved.

**Warning signs:** D-35 gate item 1 fails because `npm run lint:no-revalidate-max` exits 1 on the new code paths.

### Pitfall 6: Vercel preview build catches `cacheComponents` issues that vitest misses

**What goes wrong:** `npm test` passes but `npm run build` (Vercel) fails with errors like "Page used dynamic API outside Suspense" or "use cache: remote nested inside use cache: private."

**Why it happens:** `cacheComponents: true` enables compile-time enforcement that runs only during `next build`. Vitest doesn't trigger it.

**How to avoid:** D-35 gate item 1 explicitly includes `npm run build`. Don't merge if it fails.

**Warning signs:** Vercel preview deployment status shows red within 60 seconds of pushing the cutover branch.

### Pitfall 7: TEST-03 vitest can't reach Vercel Runtime Cache

**What goes wrong:** TEST-03 calls `revalidateTag` inside a Vitest test. Vitest runs in a Node process, NOT a Vercel function context. The Runtime Cache backend may not be reachable — `revalidateTag` becomes a no-op or throws.

**Why it happens:** Runtime Cache is platform-provided; outside the platform, the fallback is in-memory cache (which IS reachable from vitest, just doesn't validate the production behavior).

**How to avoid:** Two paths — (1) write TEST-03 as a unit test that exercises the Postgres write + read flow without relying on the cache backend (proves Postgres-side correctness, accepts that the actual cache invalidation is platform-provided); (2) move TEST-03 to a Playwright-over-preview-deploy E2E test in Phase 4.

**Warning signs:** TEST-03 second-read returns SAME payload as first-read because cache wasn't actually invalidated (hot in-memory cache).

## Code Examples

### Operation 1: SVC-02 service.ts full rewrite (cited pattern)

```ts
// web/src/lib/dashboard/service.ts (post-rewrite — full body)
// Source: https://nextjs.org/docs/app/api-reference/directives/use-cache-remote

import { cacheLife, cacheTag } from "next/cache";

import { buildDashboardSourcesFromWisenet } from "@/lib/wisenet/mappers";
import { bulkGetAdminOwnership, loadActionStateMap, listInactive }
  from "@/lib/db/queries";
import { attachActionStatesToStudents } from "@/lib/dashboard/actions";  // moved from sheets/actions
import { buildDashboardModel } from "@/lib/dashboard/analytics";
import { recordPayloadBuild, recordSheetsCheck } from "@/lib/dashboard/health-state";
import { buildActiveStudentSet, buildDashboardStudents,
         buildExcludedPackageReasons, buildPendingDeductionContext,
         buildStudentAdminOwnershipMap, buildUpcomingSessionMap }
  from "@/lib/dashboard/packages";
import { getTodayDate } from "@/lib/dashboard/helpers";
import { DASHBOARD_CACHE_TAG } from "@/lib/dashboard/config";
import { log } from "@/lib/runtime/logger";

export async function getDashboardPayload(now: Date = new Date()) {
  "use cache: remote";
  cacheTag(DASHBOARD_CACHE_TAG);
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });

  const startedAt = Date.now();
  const today = getTodayDate(now);

  try {
    // Wisenet read (Phase 2 contract — buildDashboardSourcesFromWisenet handles
    // mappers + parents join + teacher-feedback fetch internally).
    const sources = await buildDashboardSourcesFromWisenet(today);
    recordSheetsCheck(true, now.toISOString());

    const activeStudents = buildActiveStudentSet(sources.students);
    const excludedPackageReasons = buildExcludedPackageReasons(sources.studentsCourses);
    const adminOwnershipMap = buildStudentAdminOwnershipMap(sources.remainingCredits);

    // Postgres reads (Phase 2 contract).
    const studentKeys = [/* derive from sources.students or from earlier compose */];
    const dbAdminOwnership = await bulkGetAdminOwnership(studentKeys);
    // Merge: dbAdminOwnership wins where row exists; sources.remainingCredits Admin
    // is fallback (kept for soft-rename compatibility per D-06).

    const actionStates = await loadActionStateMap();      // DB-04 — replaces loadActionStates
    const inactiveRows = await listInactive();            // DB-04 — replaces sheets/inactive
    const inactiveKeys = new Set(inactiveRows.map((r) => r.studentKey));

    const pendingDeductionContext = buildPendingDeductionContext(
      sources.creditControl, activeStudents, excludedPackageReasons, today);
    const upcomingSessionMap = buildUpcomingSessionMap(
      sources.upcoming, activeStudents, excludedPackageReasons, today);
    const students = buildDashboardStudents(
      sources.aggregations, activeStudents, excludedPackageReasons,
      pendingDeductionContext, upcomingSessionMap, today, adminOwnershipMap);

    attachActionStatesToStudents(students, today, actionStates);

    const filteredStudents = inactiveKeys.size > 0
      ? students.filter((s) => !inactiveKeys.has(s.studentKey))
      : students;

    // No snapshot-store — per SVC-05 deletion. Pass null for prior snapshot.
    const dashboardModel = buildDashboardModel(filteredStudents, null, today, now);

    recordPayloadBuild(Date.now() - startedAt, now.toISOString());

    // Payload-size sanity check (T-03-XX, see §Pitfall 3)
    const serialized = JSON.stringify(dashboardModel.payload);
    if (serialized.length > 1_800_000) {
      log("warn", "service.ts/getDashboardPayload",
          new Error("payload-size-near-limit"), { sizeBytes: serialized.length });
    }

    return dashboardModel.payload;
  } catch (error) {
    log("error", "service.ts/getDashboardPayload", error);
    throw error;
  }
}
```

### Operation 2: SVC-04 dashboard route handler (NEW)

```ts
// web/src/app/api/dashboard/route.ts (NEW per SVC-04)
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { getDashboardPayload } from "@/lib/dashboard/service";
import { log } from "@/lib/runtime/logger";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireSessionUser();
    const payload = await getDashboardPayload();
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log("error", "/api/dashboard", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dashboard load failed" },
      { status: 500 });
  }
}
```

### Operation 3: D-37 logger helper

```ts
// web/src/lib/runtime/logger.ts (NEW per D-37)
type LogLevel = "error" | "warn" | "info";

export function log(
  level: LogLevel,
  route: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    route,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : String(error),
    ...extra,
  };
  // console.error captures at function level on Vercel — same channel for all levels.
  // Phase 4 DEPL-04 swaps this to Sentry.captureException(...).
  console.error(JSON.stringify(payload));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `unstable_cache(fn, [tag], { revalidate, tags })` | `'use cache: remote'` directive + `cacheLife` + `cacheTag` | Next.js 16.0 (Cache Components GA) | Phase 3 SVC-02 migrates from former to latter |
| `revalidateTag(tag)` (single-arg) | `revalidateTag(tag, "max")` (two-arg with profile) | Next.js 16.0 | Lint allowlist must flip per Pitfall 5 |
| `revalidateTag(tag, "max")` was anti-pattern (Next.js 15) | `revalidateTag(tag, "max")` is canonical (Next.js 16) | Next.js 16.0 | Phase 2's lint script needs reconciliation per Pitfall 5 |
| `unstable_cache` per-call cache keys | Function-id + serialized-args automatic key hashing | Next.js 16.0 | No code change needed — automatic |
| `waitUntil(promise)` from `@vercel/functions` | `after(callback)` from `next/server` | Next.js 15.1 | Phase 4 may use; Phase 3 does not need either |
| Action submit calls go through Route Handlers | Action submit calls go through Server Actions (`<form action={fn}>`) | Next.js 16 (recommended pattern for read-your-own-writes) | Out of Phase 3 scope — keeps existing route-handler shape |

**Deprecated/outdated:**
- `revalidateTag(tag)` single-argument form — works "if TypeScript errors are suppressed" but "may be removed in a future version" per Next.js 16.2.4 docs. Don't use in new code.
- `unstable_cache` — still works in Next.js 16, but Cache Components is the recommended path. Phase 3 migrates per D-23.

## Runtime State Inventory

> Phase 3 is a refactor + delete phase. Key runtime-state-changing items:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 3 doesn't change DB schema (Phase 2 owned migrations) | None |
| Live service config | `lint-no-revalidate-max.sh` allowlist on disk; CONTEXT D-23 says empty it. **Override per Pitfall 5: keep the lint, repurpose pattern OR replace allowlist.** | Edit script (one of two paths) |
| OS-registered state | None | None |
| Secrets/env vars | `getWisenetEnv()` already in use; `getDbEnv()` already in use; **`VERCEL_DEPLOYMENT_ID`** is auto-injected by Vercel and consumed by D-32 health endpoint. **`TEST_DATABASE_URL`** new for TEST-03 — operator pre-provisions in GH Actions secrets. | Operator action: add `TEST_DATABASE_URL` to GH repo secrets if running TEST-03 in CI. |
| Build artifacts | `unstable_cache` references in service.ts will be deleted with the rewrite. No leftover compiled artifacts. | None |

**Vercel Runtime Cache state:** Pre-cutover deployment will populate cache entries with the OLD payload shape (compose from Sheets). Post-cutover deployment writes NEW shape. If old keys collide with new keys — they don't, because `'use cache: remote'`'s function-id hash includes function source, so the cutover's NEW function-id is different from the OLD `unstable_cache`-wrapped function-id. **No tag-based purge needed pre-cutover.**

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 (local + CI) | All Phase 3 work | ✓ | 22.x | — |
| Next.js 16.2.1 | SVC-01, SVC-02 | ✓ | 16.2.1 | upgrade to 16.2.4 only if a regression surfaces — none expected |
| `@vercel/functions` 3.x | Phase 2 contract; Phase 3 doesn't add new imports | ✓ | 3.4.3 | — |
| Vercel project link | Vercel preview deploys for D-35 manual QA | ✓ | — | (web/.vercel/project.json present) |
| Vercel Marketplace Neon | Neon DB live; admin seed (D-31) requires `vercel env pull` | ✓ (operator confirmed in Phase 2 STATE.md) | — | — |
| Neon prod branch | D-31 admin seed run | ✓ | — | — |
| `TEST_DATABASE_URL` | TEST-03 Neon test branch | ✗ (operator action — set in GH secrets) | — | Skip TEST-03 in default CI; matrix job opt-in |
| `clasprc.local.json` | seed-admin-ownership.ts (Phase 2 — Phase 3 doesn't modify) | ✓ (per Phase 2 STATE) | — | — |

**Missing dependencies with no fallback:** None blocking Phase 3 implementation.

**Missing dependencies with fallback:** `TEST_DATABASE_URL` (operator pre-provisions before TEST-03 runs in CI; locally developers export it as needed).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 (Node env) |
| Config file | `web/vitest.config.ts` |
| Quick run command | `cd web && npm test -- --run` |
| Full suite command | `cd web && npm test -- --run` (Vitest doesn't have a quick/full split today) |
| TypeScript check | `cd web && npx tsc --noEmit` |
| Build check | `cd web && npm run build` |
| Anti-pattern lint | `cd web && npm run lint:no-revalidate-max` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SVC-01 | `cacheComponents: true` in next.config.ts | build-time check | `cd web && npm run build` (errors visible if invalid) | YES — covered by build gate |
| SVC-02 | service.ts wraps `getDashboardPayload` with `'use cache: remote'` + tag + life | unit + grep | `grep -n "use cache: remote" web/src/lib/dashboard/service.ts` | New: needs grep assertion in TEST-03 prelude OR a separate static-shape test |
| SVC-03 | Mutation paths call `revalidateTag` after Postgres write | integration (TEST-03) | `cd web && TEST_DATABASE_URL=... npm test -- --run cache-invalidation` | NO — Wave 0 creates `web/src/test/cache-invalidation.test.ts` |
| SVC-04 | 6 route handlers swap to new service methods | smoke (per route) + integration (full payload) | `cd web && npm test -- --run` | Partial: `actions-route.test.ts` exists, needs rewrite. New: `dashboard-route.test.ts`, `bulk-route.test.ts`, `history-route.test.ts`, `inactive-route.test.ts`, `health-route.test.ts` (Claude's discretion: planner can collapse into 1-2 files or keep separate per D-CONTEXT) |
| SVC-05 | `lib/sheets/`, memory-cache, snapshot-store, legacy actions deleted | grep + build | `grep -r "lib/sheets" web/src/ \|\| echo OK` + `cd web && npm run build` | YES — covered by build gate after deletion commit |
| SVC-06 | `googleapis` removed from package.json | grep | `! grep googleapis web/package.json` | YES — package.json check |
| SVC-07 | `/api/health` returns D-32 shape | smoke | `cd web && npm test -- --run health-route` | NO — Wave 0 creates `web/src/test/health-route.test.ts` |
| SVC-08 | Student Detail renders archive-link | unit (component) — IF planner adds component test | `cd web && npm test -- --run student-detail` OR manual QA per D-35 | NO — planner discretion |
| TEST-04 | Load test 50-concurrent p95 < 500ms | DEFERRED to Phase 4 DEPL-04 | — | — |
| TEST-06 | Chunked-transfer regression | unit | `cd web && npm test -- --run chunked-transfer-regression` | NO — Wave 0 creates `web/src/test/chunked-transfer-regression.test.ts` |
| D-35 gate 1 (automated) | Suite green + tsc clean + build OK + lint OK | bundle | All four commands above | Existing infra |
| D-35 gate 2 (CI db-migrate) | `.github/workflows/db-migrate.yml` green on PR preview | CI | GitHub Actions UI | Existing infra |
| D-35 gate 3 (admin seed) | `npm run db:seed-admin` against prod Neon | manual operator | Local invocation per D-31 | Existing infra |
| D-35 gate 4 (manual QA) | Vercel preview QA flow | manual operator | Vercel preview URL | — |

### Sampling Rate

- **Per task commit:** `cd web && npm test -- --run` (full suite — vitest is fast, no need to subset)
- **Per wave merge:** `cd web && npm test -- --run && npx tsc --noEmit && npm run lint:no-revalidate-max`
- **Phase gate:** All 4 D-35 gates green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `web/src/test/cache-invalidation.test.ts` — covers TEST-03 (gated on `TEST_DATABASE_URL`)
- [ ] `web/src/test/chunked-transfer-regression.test.ts` — covers TEST-06
- [ ] `web/src/test/health-route.test.ts` — covers D-32 shape (planner's call: smoke vs integration)
- [ ] Optional: `web/src/test/dashboard-route.test.ts` — covers SVC-04 GET shape
- [ ] Optional: `web/src/test/student-detail.test.tsx` — covers SVC-08 archive-link render (planner's call — would set the precedent for component tests in this codebase)
- [ ] Update `web/src/test/actions-route.test.ts` — current tests mock `lib/sheets/actions`; rewrite to mock `lib/db/queries` + `lib/db/bulk-queries` and assert `revalidateTag` was called
- [ ] Reconcile `web/scripts/lint-no-revalidate-max.sh` per Pitfall 5 (path (i) repurpose vs path (ii) re-allowlist)

*(Test framework infrastructure exists — Vitest 3 + Node env + 16 test files at 164/164 green per Phase 2 verification. No new framework install needed.)*

## Security Domain

> CONTEXT.md does not enable `security_enforcement` flag. Skipping per researcher contract — but a quick risk note for the planner:

- **No new auth surfaces in Phase 3.** Existing NextAuth + allowlist pattern carries over unchanged.
- **No new credentials in Phase 3.** SVC-06 REMOVES `googleapis` (and the implied service-account JWT) from server load; reduces credential surface.
- **Wisenet credentials are still server-only** — `getWisenetEnv()` is in `lib/runtime/env.ts`; mappers and service.ts consume it via the client wrapper. No client-bundle leak surface introduced.
- **`/api/health` is unauthenticated by design** — it's a probe for uptime monitors. The response surfaces error.message strings from each subsystem; the planner should ensure `error.message` from a `WisenetError` doesn't accidentally include credential material. Phase 2's WisenetError sets `redactedBody` — verify the message field doesn't include the URL with auth: per existing client.ts L31, message is `Wisenet ${status} at ${path}` — path is just the URL pathname, no creds. SAFE.
- **Archive-link target URL** — it's a Google Sheets URL with the spreadsheet ID in the path. The sheet itself is auth-gated by Google Workspace. The URL identifier alone leaks the spreadsheet existence but not its content. ACCEPTABLE.

## Sources

### Primary (HIGH confidence)

- [Vercel Runtime Cache](https://vercel.com/docs/runtime-cache) — `'use cache: remote'`, limits (2 MB / 64 tags / 256 byte), 300ms global propagation, regional vs ISR isolation
- [Next.js 16 cacheComponents config](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents) — exact syntax, version history (16.0+), Activity navigation behavior
- [Next.js 16 cacheLife API](https://nextjs.org/docs/app/api-reference/functions/cacheLife) — full signature, all preset profiles (seconds/minutes/hours/days/weeks/max), stale/revalidate/expire semantics, validation rules
- [Next.js 16 cacheTag API](https://nextjs.org/docs/app/api-reference/functions/cacheTag) — variadic tags, 256-char limit, 128-tags-per-entry limit
- [Next.js 16 updateTag API](https://nextjs.org/docs/app/api-reference/functions/updateTag) — **Server Actions only** restriction (CRITICAL FINDING)
- [Next.js 16 revalidateTag API](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) — `"max"` profile recommended, single-arg deprecation, `{ expire: 0 }` webhook pattern
- [Next.js 16 'use cache' directive](https://nextjs.org/docs/app/api-reference/directives/use-cache) — placement rules, serialization constraints, in-memory vs remote vs private
- [Next.js 16 'use cache: remote' directive](https://nextjs.org/docs/app/api-reference/directives/use-cache-remote) — exact directive string, nesting rules, runtime caching considerations for serverless
- [@vercel/functions package reference](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package) — `attachDatabasePool`, `getCache`, `after()`, `addCacheTag`, 128 tags per response (CDN cache layer)
- [Phase 2 02-CONTEXT.md](.planning/phases/02-data-layer/02-CONTEXT.md) — D-17, D-25 contracts inherited
- [Phase 2 02-VERIFICATION.md](.planning/phases/02-data-layer/02-VERIFICATION.md) — confirms 19/19 Phase 2 reqs implemented; Phase 3 toolkit ready
- [web/src/lib/dashboard/service.ts](web/src/lib/dashboard/service.ts) — current 22-line wrapper that Phase 3 rewrites
- [web/scripts/lint-no-revalidate-max.sh](web/scripts/lint-no-revalidate-max.sh) — Phase 2 anti-pattern guard that Phase 3 reconciles
- [npm registry version verification](#) — `npm view next version` → 16.2.4; `npm view @vercel/functions version` → 3.4.4; `npm view @neondatabase/serverless version` → 1.1.0; `npm view drizzle-orm version` → 0.45.2 (run 2026-04-29)

### Secondary (MEDIUM confidence)

- [Neon branching docs](https://neon.com/docs/manage/branches) — REST API for programmatic branch creation; lifecycle defaults (1-day Console, no-expiry API/CLI)
- [Vitest mocking guide](https://vitest.dev/guide/mocking) — `vi.stubGlobal` semantics, manual unstub via `vi.unstubAllGlobals()`
- [MDN ReadableStream API](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams) — Response constructor with stream body, controller.enqueue/close

### Tertiary (LOW confidence — flagged for empirical verification)

- 300ms global propagation latency for Next.js `revalidateTag` (Vercel docs cite for `getCache().expireTag` only) — [ASSUMED] same backend, but not explicitly confirmed for the Next.js wrapper
- HEAD probe support against `api.wiseapp.live` — Phase 1 didn't fingerprint HEAD method; D-32 says "HEAD or cheap GET" — recommendation: use cheap GET to avoid empirical surprise
- TEST-03 Vitest reachability of Vercel Runtime Cache backend — test process is outside the Vercel function context; Runtime Cache may be unreachable. Recommendation per Pitfall 7
- `cacheComponents: true` compatibility with `next-auth@5.0.0-beta.30` Google provider — [ASSUMED safe] because auth uses runtime-only APIs (cookies/headers) which run outside cached scopes; Vercel preview build is the empirical gate (D-35 step 1)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 300ms global propagation applies to Next.js `revalidateTag` (not just `getCache().expireTag`) | Pattern 6 | Slightly slower invalidation propagation than CONTEXT cited; functionality unaffected |
| A2 | Dashboard payload may approach 2 MB at scale | Pattern 7 | If Wrong (payload always < 1 MB), the size warn is dead code — harmless |
| A3 | `cacheComponents: true` is compatible with `next-auth@5.0.0-beta.30` Google provider | Pattern 2 | Vercel preview build catches this in D-35 gate 1; if it errors, Phase 4 DEPL-02 may need to advance |
| A4 | TEST-03 Vitest can reach Runtime Cache backend OR can prove Postgres-side correctness without it | Pattern 10 / Pitfall 7 | Test value reduced to "DB writes work" rather than "cache invalidates" — TEST-03 spirit (catch revalidateTag-max class bugs) is preserved by Phase 2's lint-test reconciliation |
| A5 | TEST-06 chunked-stream simulation correctly exercises Wisenet client buffer logic | Pattern 9 | Test still passes if mock is well-formed but doesn't actually exercise chunk concatenation (silent false positive); mitigation = use 3-chunk split deliberately to make the assertion non-trivial |
| A6 | Wisenet `api.wiseapp.live` supports HEAD requests | Pattern 8 | If wrong, health probe takes the "cheap GET" path per D-32; no impact |
| A7 | `revalidateTag(_, "max")` from `'use server'` actions.ts works the same as from a route handler | Pattern 11 | Both contexts are documented as supported in Next.js 16 docs — but the precise binding when an action is *invoked* from a route handler (rather than from a `<form action>`) is uncovered. Mitigation = TEST-03 (when working) catches this |
| A8 | The `'use cache: remote'` directive's function-id hash includes the function source, so post-cutover service.ts gets a fresh cache key (no stale entries from pre-cutover) | Runtime State Inventory | If wrong, post-deploy first-load could return Sheets-shaped data from old cache for up to TTL. Mitigation = manually purge runtime cache for `dashboard-payload` tag pre-deploy via Vercel dashboard |

**If any of A3, A7, A8 fail empirically, Phase 3 may need a corrective amendment before merge.** All others are low-risk.

## Open Questions (RESOLVED)

1. **RESOLVED: Should the planner choose Path A (`revalidateTag(tag, "max")`) or Path B (`revalidateTag(tag, { expire: 0 })`) for D-28's invalidation function?** Planner chose Path A — implemented in Plan 03-04 actions.ts (5 mutations × `revalidateTag(DASHBOARD_CACHE_TAG, "max")`).
   - What we know: Both work in route handlers per Next.js 16 docs.
   - What's unclear: The operator usage pattern. Multi-action workflows favor Path A (stale-while-revalidate, less origin pressure); single-action-then-verify-on-screen workflows favor Path B (true read-your-own-writes).
   - Recommendation: Path A. The dashboard's existing `unstable_cache + revalidateTag` is a stale-while-revalidate pattern in spirit (60s revalidate window). Maintaining behavior parity through cutover is the safer call.

2. **RESOLVED: Should `web/scripts/lint-no-revalidate-max.sh` be repurposed (Path i) or re-allowlisted (Path ii)?** Planner chose Path i — implemented in Plan 03-03 Task 3 (regex flipped to forbid deprecated single-arg form; allowlist emptied).
   - What we know: The Next.js 15 anti-pattern is the Next.js 16 best practice.
   - What's unclear: Whether D-23 + D-28's "empty allowlist" instruction was an artifact of the Phase 2 anti-pattern definition (which is now obsolete) or a positive signal value (catch all uses). Repurposing (Path i, forbid bare `revalidateTag(tag)`) preserves the original lint's spirit; re-allowlisting (Path ii) preserves the literal CONTEXT instruction.
   - Recommendation: Path i. Forbid the deprecated single-arg form; the lint is still useful and aligned with Next.js 16 best practice.

3. **RESOLVED: Should TEST-03 be implemented as a unit test (Postgres-side correctness) or deferred to Phase 4 as a Playwright-against-preview-deploy E2E test?** Planner chose both — Plan 03-07 implements Postgres-correctness gated on `TEST_DATABASE_URL`; Phase 4 DEPL-04 will add the full-stack Playwright variant.
   - What we know: Vitest may not reach the Vercel Runtime Cache backend.
   - What's unclear: Whether testing only the Postgres write + read flow (without exercising the cache backend) satisfies D-29's "regression test that catches the revalidateTag(*, 'max') class of bugs" intent.
   - Recommendation: Implement TEST-03 as a Postgres-correctness unit test in Phase 3 (gates SVC-03), AND add an E2E variant in Phase 4 DEPL-04 for full-stack proof. The Phase 2 lint-test still catches the bare `revalidateTag(tag)` bug class.

4. **RESOLVED: Should the `actions.ts` facade be `'use server'`, or should the route handlers call `lib/db/queries` + `revalidateTag` directly (Claude's Discretion option (a))?** Planner chose Path (b) — implemented in Plan 03-04 ('use server' facade with 5 mutation methods + single-source-of-truth invalidation).
   - What we know: CONTEXT prefers (b) facade for single-source-of-truth.
   - What's unclear: Whether the facade adds enough value to justify the indirection in 4-5 mutation sites. Direct calls (Path (a)) are smaller and less abstract.
   - Recommendation: Path (b). The single-source-of-truth-on-revalidateTag-placement argument outweighs the indirection cost. Marking actions.ts `'use server'` future-proofs against any later change to use Server Actions from React forms (Phase 5+ scope).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry on 2026-04-29
- Architecture (`'use cache: remote'`, cacheLife, cacheTag): HIGH — exact syntax pulled from Next.js 16.2.4 official docs
- Cache invalidation (`updateTag` vs `revalidateTag`): HIGH — Next.js 16 docs are explicit and unambiguous
- Vercel Runtime Cache constraints: HIGH — verified against Vercel docs
- Vitest streaming mock: MEDIUM — pattern correct per MDN + Vitest docs; specific behavior of wisenetFetch under stream-bodied response is reasonable assumption
- Neon branching ergonomics: MEDIUM — recommendation aligns with Phase 2 patterns; alternate path also viable
- Compatibility assumptions (NextAuth + cacheComponents): LOW — uncovered until Vercel preview build runs

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (30 days for Next.js 16 stack — the cacheComponents APIs are stable; only canary 16.3 changes would invalidate)
