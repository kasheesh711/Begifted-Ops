---
phase: 03-service-cutover
plan: "01"
subsystem: build-config
tags: [cache-components, next-config, prerender, suspense, route-segment]
requires:
  - 03-00 baseline reconciliation (route handlers restored, Phase 1+2 source committed)
provides:
  - cacheComponents flag unlocking 'use cache: remote' / cacheTag / cacheLife / updateTag APIs
  - Suspense-wrapped auth pages compatible with Next.js 16 partial prerender
  - Route handlers compatible with cacheComponents (no segment-level runtime declarations)
affects:
  - All future Phase 3 plans (03-03 service.ts rewrite is now compileable)
tech_stack:
  added: [Suspense streaming for auth-dependent page bodies]
  patterns: [auth() wrapped in <Suspense fallback={null}> per Next.js 16 cacheComponents migration guide]
key_files:
  created: []
  modified:
    - web/next.config.ts
    - web/src/app/page.tsx
    - web/src/app/signin/page.tsx
    - web/src/app/(protected)/dashboard/page.tsx
    - web/src/app/api/dashboard/route.ts
    - web/src/app/api/actions/route.ts
    - web/src/app/api/actions/bulk/route.ts
    - web/src/app/api/actions/history/route.ts
    - web/src/app/api/inactive/route.ts
    - web/src/app/api/health/route.ts
decisions:
  - cacheComponents enables auth-page partial prerender; auth I/O remains per-request via Suspense streaming
  - Removing export const runtime="nodejs" is the documented Next.js 16 migration step — Node.js is now the default; explicit segment is rejected as redundant
  - Page-level Suspense wrappers chosen over redesigning service.ts cache discipline early; latter belongs to Plan 03-03
metrics:
  duration: 5min
  completed: 2026-04-29
---

# Phase 3 Plan 01: Enable cacheComponents Summary

**One-liner:** Enabled `cacheComponents: true` in `next.config.ts`, then applied two
mechanical compatibility fixes the Next.js 16 contract forces: dropped redundant
`runtime="nodejs"` segments from 6 route handlers and wrapped 3 auth-gated pages in
`<Suspense>` so partial prerender succeeds.

## What Shipped

### Primary deliverable (per plan)

- `web/next.config.ts` — added `cacheComponents: true` as a sibling to `reactStrictMode: true`
  (SVC-01). The flag unlocks the Next.js 16 cache APIs that Plan 03-03 (`service.ts` rewrite
  to `'use cache: remote'` + `cacheTag('dashboard-payload')` + `cacheLife({ expire: 60 })`)
  requires for compilation.

### Forced compatibility fixes (Rule 3 inline; see Deviations below)

- 6 route handlers: removed `export const runtime = "nodejs"` from
  `api/dashboard`, `api/actions`, `api/actions/bulk`, `api/actions/history`,
  `api/inactive`, `api/health`. Next.js 16 prints
  *"Route segment config 'runtime' is not compatible with `nextConfig.cacheComponents`"*
  when the flag is on, because Node.js is the default runtime under cacheComponents and
  the explicit segment is now redundant. Routes still execute on Node.js (verified by
  the build output classifying them as `ƒ (Dynamic)` on the Node runtime).

- 3 auth-gated pages: wrapped each `await auth()` body in `<Suspense fallback={null}>`
  with the auth-dependent code lifted into a co-located async sub-component
  (`HomeRedirect`, `SignInBody`, `DashboardBody`). Next.js 16 with cacheComponents requires
  uncached I/O (cookies/auth) to live inside a Suspense boundary so the static shell can
  prerender while auth streams in at request time. Build now classifies `/`, `/signin`,
  and `/dashboard` as `◐ (Partial Prerender)`. No behavioral change — `auth()` is still
  evaluated per-request and the same redirect targets fire.

## Verification

| Check | Result |
|-------|--------|
| `grep -n "cacheComponents: true" web/next.config.ts` | matches line 5 |
| `cd web && npm run build` | exit 0; "Cache Components enabled"; 11/11 routes generated |
| `cd web && npm test -- --run` | 164/164 passing across 15 test files |
| `git show HEAD --stat` | 10 files, 32 insertions / 15 deletions |
| Working tree (V1 root) | unchanged — 13 V1 files remain unstaged per D-43 |

The plan's `<verification>` block specified `cd web && npx tsc --noEmit` exits 0. It does
not — there are 4 pre-existing tsc errors in `dashboard-logic.test.ts` and
`wisenet-mappers.test.ts` that exist independent of this plan (verified by stashing
`web/next.config.ts` and re-running tsc against the baseline; the 4 errors persisted).
These are documented in CONTEXT D-35 as "Phase 2's 2 pre-existing dashboard-logic.test.ts
errors must be resolved as part of cutover" and are out of this plan's SCOPE BOUNDARY.
The `npm run build` gate passes, which is the binding "must not regress" check the plan
captures via the threat register.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Remove `export const runtime = "nodejs"` from 6 route handlers**

- **Found during:** Task 1 verification — `npm run build` after the next.config.ts edit
  failed with 6 "Route segment config 'runtime' is not compatible with
  `nextConfig.cacheComponents`. Please remove it." errors.
- **Issue:** Next.js 16's cacheComponents contract makes Node.js the default route
  runtime. The legacy explicit `runtime = "nodejs"` segment is now incompatible with
  `cacheComponents: true` — it errors at compile time even though it semantically agrees
  with the new default.
- **Fix:** Deleted the 6 redundant `export const runtime = "nodejs"` lines. Routes still
  run on Node.js (Drizzle HTTP + WebSocket Pool, Wisenet client all keep working). This is
  the migration step Next.js' own docs prescribe in
  `docs/01-app/02-guides/migrating-to-cache-components.mdx`.
- **Files modified:** 6 route handler files under `web/src/app/api/`.
- **Commit:** `cdc2ebe`.

**2. [Rule 3 - Blocking] Wrap auth() page bodies in `<Suspense>`**

- **Found during:** Task 1 verification — after fixing the runtime segments, build
  proceeded to prerender and failed with *"Route '/dashboard': Uncached data was accessed
  outside of `<Suspense>`. This delays the entire page from rendering"* against `/`,
  `/signin`, and `/dashboard`. The plan's threat register T-03-01-1 anticipated build-time
  prerender errors but assumed "Auth-gated `(protected)/dashboard/page.tsx` is dynamic
  anyway" — which is true in legacy Next.js but not under cacheComponents (every page is
  attempted as a static shell first; uncached I/O must declare its dynamic boundary).
- **Issue:** Each of the 3 pages calls `await auth()` at the page-component top, then
  redirects or renders. With cacheComponents, this fails prerender because there's no
  Suspense boundary around the uncached I/O.
- **Fix:** Lifted the auth-dependent body into a co-located async sub-component
  (`HomeRedirect` / `SignInBody` / `DashboardBody`) and wrapped it in
  `<Suspense fallback={null}>`. Standard Next.js 16 migration pattern from
  `migrating-to-cache-components.mdx`. `HomeRedirect` got an explicit `return null;`
  after `redirect()` so TypeScript accepts it as a valid JSX component (the `redirect()`
  call throws but tsc can't prove control-flow termination here).
- **Behavioral impact:** None. `auth()` always evaluated at request time;
  redirect targets unchanged; Suspense fallback is `null` so there's no visible loading
  state on first paint.
- **Files modified:** `web/src/app/page.tsx`, `web/src/app/signin/page.tsx`,
  `web/src/app/(protected)/dashboard/page.tsx`.
- **Commit:** `cdc2ebe`.

### Scope Expansion Note

The plan documented "Files modified: web/next.config.ts (1 file, 1 task)" but the
forced cascade above expanded scope to 10 files. Both fixes are mechanical applications
of Next.js' own migration guide; neither changes runtime behavior; both are required to
satisfy the plan's own success criterion (`npm run build` exits 0). They were committed
atomically with the config flip rather than split across plans because they are the
direct compatibility tax of enabling the flag — splitting them would leave intermediate
commits with broken builds, violating the per-commit buildable-state requirement set in
D-33 ("Each commit must leave the repo in a buildable state").

## Threat Flags

None. The 6 route handlers and 3 pages now use Next.js 16's documented patterns; no new
trust-boundary surface introduced beyond what existed before (auth still gates the same
routes, the 6 API endpoints are unchanged externally, no new env vars or schema changes).

## Self-Check: PASSED

- [x] `web/next.config.ts` exists with `cacheComponents: true`: FOUND (line 5)
- [x] Commit `cdc2ebe` exists in git log: FOUND
- [x] All 10 modified files in commit: FOUND (verified via `git show HEAD --stat`)
- [x] V1 root files NOT in commit: confirmed (no V1 paths in `git show HEAD --name-only`)
- [x] `npm run build` passes: confirmed
- [x] `npm test` 164/164: confirmed
