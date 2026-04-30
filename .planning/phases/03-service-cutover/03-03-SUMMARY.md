---
phase: 03-service-cutover
plan: "03"
subsystem: dashboard-data-layer
tags: [use-cache-remote, cacheTag, cacheLife, wisenet, postgres, drizzle, runtime-cache, lint, p-limit, turbopack]
requires:
  - phase: 02-data-layer
    provides: Wisenet client + mappers + Drizzle queries used by the new service.ts composer
  - 03-00 baseline reconciliation (route handlers in tree)
  - 03-01 cacheComponents enabled (so 'use cache: remote' compiles)
provides:
  - Cache-tagged dashboard payload composer (SVC-02) — Wisenet + Postgres under 'use cache: remote' with explicit cacheLife({ stale: 60, revalidate: 60, expire: 300 })
  - Structured console.error JSON logger at web/src/lib/runtime/logger.ts (D-37) — Phase 4 DEPL-04 swap point
  - Lint guard flipped to forbid the deprecated single-arg revalidateTag() form; allowlist emptied
  - Lazy-init Drizzle HTTP client via Proxy (build-time page-data collection no longer crashes on missing DATABASE_URL)
  - Phase 1+2 baseline tsc errors cleared per D-35
affects:
  - 03-04 (SVC-03): actions.ts facade will absorb the inline revalidateTag(...,"max") calls now sitting in 3 route handlers
  - 03-05 (SVC-04): route handlers will move from inline revalidateTag to the actions.ts facade
  - 03-06 (SVC-07): /api/health restructure (D-32) — independent of this plan but builds on the same lazy-db Proxy
  - 03-07 (TEST-03): integration test exercising getDashboardPayload + revalidateTag round trip
  - 03-08 (SVC-05): deletion of build.ts / lib/sheets/* / snapshot-store.ts becomes safe — service.ts no longer imports them

tech-stack:
  added:
    - "Vercel Runtime Cache via 'use cache: remote' (replaces unstable_cache)"
    - "next/cache cacheTag + cacheLife (explicit 3-arg profile)"
    - "p-limit listed in serverExternalPackages (Turbopack #async_hooks resolution)"
  patterns:
    - "'use cache: remote' as first stmt of async function; cacheTag + cacheLife immediately after, BEFORE any await — RESEARCH §Pattern 1"
    - "Explicit cacheLife({ stale, revalidate, expire }) — never the { expire: N } shorthand — RESEARCH §Pattern 3 / §Pitfall 4"
    - "Proxy-wrapped lazy client init for env-driven services that route modules transitively import (Next.js 16 page-data collection no longer crashes the build)"
    - "Postgres sidecar override pattern (D-06): Sheets-derived ownership map applied inside builders, then DB sidecar wins by mutating student records post-build"
    - "Inline revalidateTag(tag, \"max\") + recordCacheInvalidation in route handlers as a transitional shim until 03-04 actions.ts facade lands"

key-files:
  created:
    - "web/src/lib/runtime/logger.ts (24 lines, D-37 structured logger)"
  modified:
    - "web/src/lib/dashboard/service.ts (full rewrite — Wisenet + Postgres composer with cache directive)"
    - "web/scripts/lint-no-revalidate-max.sh (regex flip, ALLOWLIST=(), set -u guard)"
    - "web/src/test/lint-no-revalidate-max.test.ts (violation literal flipped to single-arg)"
    - "web/src/app/api/actions/route.ts (Rule 3 cascade — inline revalidateTag(tag, \"max\"))"
    - "web/src/app/api/actions/bulk/route.ts (Rule 3 cascade — same)"
    - "web/src/app/api/inactive/route.ts (Rule 3 cascade — same, both POST + DELETE)"
    - "web/src/test/actions-route.test.ts (Rule 3 cascade — mocks updated for next/cache + health-state)"
    - "web/src/test/dashboard-logic.test.ts (Rule 1 — adminOwnerKey: \"palm\" as const, D-35 baseline fix)"
    - "web/src/test/wisenet-mappers.test.ts (Rule 1 — removed redundant _id/name spread, D-35 baseline fix)"
    - "web/src/lib/db/client.ts (Rule 1 — Proxy-wrapped lazy init defers neon() to first request)"
    - "web/next.config.ts (Rule 3 — serverExternalPackages: ['p-limit'])"
    - "web/.gitignore (Rule 2 — *.tsbuildinfo)"

key-decisions:
  - "cacheLife({ stale: 60, revalidate: 60, expire: 300 }) — explicit 3-arg form per RESEARCH §Pitfall 4; the { expire: 60 } shorthand silently inherits a 15-minute revalidate from Next.js' default profile"
  - "Inline revalidateTag(DASHBOARD_CACHE_TAG, \"max\") + recordCacheInvalidation injected into 3 route handlers as a transitional shim — Plan 03-04 will move this to the actions.ts facade per CONTEXT D-28 / Claude's Discretion option (b). The flipped lint allows the two-arg form so this is clean against the new regex"
  - "Postgres sidecar override applied AFTER buildDashboardStudents — the Sheets-derived adminOwnershipMap is the fallback, the DB row wins when present. Mutates StudentRecord.adminOwnerKey/Name/Source in place rather than re-running buildDashboardStudents"
  - "snapshotState passed as { lastSnapshot: null, history: [] } per D-23 — cold-start delta-reset is the explicitly-accepted tradeoff. snapshot-store.ts deletion is Wave 5"
  - "db/client.ts lazy-init via Proxy chosen over module-level await/init or alternative bundler workarounds. Preserves the `import { db } from \"./client\"` ergonomics callers depend on; defers env-throw to first use rather than module load. Phase 2 didn't surface this because no production route imported db/client.ts; Phase 3 service.ts's new code path does"
  - "p-limit added to serverExternalPackages in next.config.ts. p-limit 5.0.0 uses Node's `imports` field (`#async_hooks` mapped to `node:async_hooks` for Node, fallback stub otherwise). Turbopack doesn't resolve the imports field when bundling for the route. Marking server-external delegates resolution to Node at runtime where it works correctly"
  - "Cleared 4 D-35 baseline tsc errors as part of this plan rather than punting to 03-04: dashboard-logic.test.ts:141 needed `as const` to narrow `\"palm\"` to AdminViewKey; wisenet-mappers.test.ts:35-46 had redundant explicit `_id`/`name` properties duplicated by the trailing spread"
  - "Kept compare-live.ts and ensure-action-sheets.ts and the Sheets-era invalidation helpers untouched. They get deleted in Wave 5 (SVC-05/SVC-06) per D-33 commit ordering"

patterns-established:
  - "Pattern: 'use cache: remote' first, then cacheTag, then cacheLife — all 3 must appear before any await inside the function body"
  - "Pattern: Postgres sidecar overrides (D-06) applied as a post-build pass that mutates StudentRecord fields, not by re-running buildDashboardStudents"
  - "Pattern: Proxy-based lazy client for any env-driven service that route modules transitively load — preserves caller ergonomics while deferring env reads to request time"
  - "Pattern: serverExternalPackages for Node-imports-field libraries — p-limit, and any future package using the same `imports` field idiom"
  - "Pattern: anti-pattern lint flip — empty ALLOWLIST=() needs `${ALLOWLIST[@]+...}` guard against bash set -u; the runtime-string-assembly trick used to avoid self-match is preserved (FN = \"revalidate\" + \"Tag\")"

requirements-completed:
  - SVC-02

# Metrics
duration: 11min
completed: 2026-04-30
---

# Phase 3 Plan 03: Service.ts Wisenet+Postgres Cache Cutover Summary

**Rewrote `web/src/lib/dashboard/service.ts` as a Wisenet + Postgres composer wrapped in `'use cache: remote'` with explicit `cacheLife({ stale: 60, revalidate: 60, expire: 300 })`, added the D-37 structured logger, flipped `lint-no-revalidate-max.sh` to forbid the deprecated single-arg `revalidateTag()` form, and absorbed the resulting build/test cascades (3 route handlers, lazy db client Proxy, p-limit serverExternalPackages, Plan 03-02 baseline tsc cleanup).**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-04-30T02:49:50Z
- **Completed:** 2026-04-30T03:00:30Z
- **Tasks:** 3 (per plan) + 6 deviation cascades
- **Files modified:** 13 (1 created, 12 edited)
- **Commit:** `0ef5f73`

## Accomplishments

1. **service.ts rewrite (SVC-02 primary).** New `getDashboardPayload(now: Date = new Date())`:
   - Directive `"use cache: remote"` is the first statement inside the function body (RESEARCH §Pattern 1 placement rule).
   - `cacheTag(DASHBOARD_CACHE_TAG)` and `cacheLife({ stale: 60, revalidate: 60, expire: 300 })` immediately after, both before any `await`.
   - Wisenet read via `buildDashboardSourcesFromWisenet(today)` (Phase 2 mapper, unchanged).
   - Pure dashboard composition (Phase 2 helpers — `buildActiveStudentSet`, `buildExcludedPackageReasons`, `buildStudentAdminOwnershipMap`, `buildPendingDeductionContext`, `buildUpcomingSessionMap`, `buildDashboardStudents`).
   - Postgres reads via `Promise.all([loadActionStateMap(), listInactive(), bulkGetAdminOwnership(studentKeys)])` per D-06.
   - **Postgres sidecar override** for admin ownership: when `student_admin_ownership` has a row for a `studentKey`, that admin wins over the Sheets-derived RemainingCredits majority vote. Sets `adminOwnershipSource = "postgres-sidecar"` so traceability survives.
   - `attachActionStatesToStudents` for same-day action visibility.
   - **Auto-reactivation**: students appearing in both `inactive_students` AND the current Wisenet active set get a `clearInactive()` call and stay in the queue (mirrors the Sheets-era `removeInactiveStudents` semantics).
   - `buildDashboardModel(filteredStudents, { lastSnapshot: null, history: [] }, today, now)` — empty snapshot per D-23 cold-start tradeoff.
   - **Payload-size sanity check**: if `JSON.stringify(payload).length > 1_800_000`, log a `warn` via `log()`. Vercel Runtime Cache hard limit is 2MB — sanity threshold gives operators a heads-up before silent eviction.
   - Wrapping `try/catch` calls `log("error", "service.ts/getDashboardPayload", error)` and rethrows.

2. **logger.ts created (D-37).** Pure function, no class, no deps. Emits JSON-line `console.error(JSON.stringify({ ts, level, route, error: { name, message, stack } | String, ...extra }))`. Phase 4 DEPL-04 swaps the body to Sentry; call sites stay.

3. **Lint flipped (RESEARCH §Pitfall 5).** `ALLOWLIST=()` (empty); regex changed from `revalidateTag\([^)]*,[[:space:]]*["']max["']\)` to `revalidateTag\([^,)]+\)` so it now matches the deprecated single-arg form, not the recommended two-arg one. Added `${ALLOWLIST[@]+"${ALLOWLIST[@]}"}` guard so `set -u` doesn't choke on an empty array. Failure message rewritten to point at the new advice. The matching test (`lint-no-revalidate-max.test.ts`) flips its `VIOLATION_BODY` to assemble `"foo"`-only single-arg shape via `FN = "revalidate" + "Tag"`; comments rewritten to avoid containing the literal deprecated shape.

## Task Commits

- **All four plan-targeted files committed atomically per Task 3 instruction**, alongside the deviation cascades — `0ef5f73`. Per-file breakdown is in the commit message body.

## Files Created/Modified

### Created (1)
- `web/src/lib/runtime/logger.ts` — D-37 structured console.error logger.

### Modified — primary deliverables (3)
- `web/src/lib/dashboard/service.ts` — full rewrite. Drops `unstable_cache`, `invalidateDashboardPayloadCache`, `revalidateTag`, all imports from `lib/sheets/*` and `lib/dashboard/build`/`snapshot-store`. Adds `cacheLife`/`cacheTag` from `next/cache`, `buildDashboardSourcesFromWisenet` from `wisenet/mappers`, and the 4 db queries. Inlines the Phase 2 build.ts orchestration with Wisenet+Postgres swaps.
- `web/scripts/lint-no-revalidate-max.sh` — regex + allowlist flipped; set-u guard added; messaging updated.
- `web/src/test/lint-no-revalidate-max.test.ts` — violation literal flipped to single-arg, describe-block name updated, comments rewritten so the test file doesn't self-match the new regex.

### Modified — Rule 3 cascades (4)
- `web/src/app/api/actions/route.ts` — dropped `invalidateDashboardPayloadCache` import; added `revalidateTag` from `next/cache`, `DASHBOARD_CACHE_TAG`, `recordCacheInvalidation`. Replaced the invalidate call with `revalidateTag(DASHBOARD_CACHE_TAG, "max"); recordCacheInvalidation(new Date().toISOString());`.
- `web/src/app/api/actions/bulk/route.ts` — same pattern.
- `web/src/app/api/inactive/route.ts` — same pattern, both POST and DELETE handlers (replace_all on the invalidate call).
- `web/src/test/actions-route.test.ts` — mocks now stub `next/cache::revalidateTag` and `@/lib/dashboard/health-state::recordCacheInvalidation`; assertion updated from `expect(invalidateDashboardPayloadCache).toHaveBeenCalledTimes(1)` to `expect(revalidateTag).toHaveBeenCalledWith("dashboard-payload", "max")`.

### Modified — Rule 1 baseline tsc fixes per D-35 (2)
- `web/src/test/dashboard-logic.test.ts` — `adminOwnerKey: "palm"` → `adminOwnerKey: "palm" as const` so TypeScript narrows the literal to `AdminViewKey` instead of widening to `string`.
- `web/src/test/wisenet-mappers.test.ts` — removed the redundant explicit `_id: overrides._id` and `name: overrides.name` lines from the `mkStudent` factory; the trailing `...overrides` already sets them, so the explicit lines triggered TS2783 duplicate-key warnings.

### Modified — Rule 1 lazy-init bug (1)
- `web/src/lib/db/client.ts` — wrapped the `db` export in a `Proxy` that defers `neon()` + `drizzle()` initialization to the first property access. Next.js 16 collects page data at build time by importing every route module; that cascaded into `db/client.ts` and called `getDbEnv()` with no `DATABASE_URL` in the build runner. The Proxy preserves the `import { db } from "./client"` ergonomics every caller relies on while gating the env read until request time. Phase 2 didn't surface this because no production code path imported `db/client.ts`; Phase 3 service.ts now does (transitively via `db/queries.ts`).

### Modified — Rule 3 build-system blocker (1)
- `web/next.config.ts` — added `serverExternalPackages: ["p-limit"]`. `p-limit@5.0.0` uses Node's `imports` field (`#async_hooks` → `node:async_hooks` for Node, fallback stub otherwise). Turbopack doesn't resolve the `imports` field when bundling, so the build failed with `Module not found: Can't resolve '#async_hooks'`. `serverExternalPackages` delegates module resolution for that package to Node at runtime where the conditional resolution works.

### Modified — Rule 2 hygiene (1)
- `web/.gitignore` — added `*.tsbuildinfo` (cache artifact from `incremental: true` in `tsconfig.json`).

## Exact import list in new service.ts

```ts
import { cacheLife, cacheTag } from "next/cache";

import { buildDashboardSourcesFromWisenet } from "@/lib/wisenet/mappers";
import {
  bulkGetAdminOwnership,
  loadActionStateMap,
  listInactive,
  clearInactive,
} from "@/lib/db/queries";
import { attachActionStatesToStudents } from "@/lib/dashboard/actions";
import { buildDashboardModel } from "@/lib/dashboard/analytics";
import { recordPayloadBuild, recordSheetsCheck } from "@/lib/dashboard/health-state";
import {
  buildActiveStudentSet,
  buildDashboardStudents,
  buildExcludedPackageReasons,
  buildPendingDeductionContext,
  buildStudentAdminOwnershipMap,
  buildUpcomingSessionMap,
} from "@/lib/dashboard/packages";
import { getTodayDate } from "@/lib/dashboard/helpers";
import {
  ADMIN_OWNER_REGISTRY,
  DASHBOARD_CACHE_TAG,
  UNASSIGNED_ADMIN_KEY,
  UNASSIGNED_ADMIN_NAME,
} from "@/lib/dashboard/config";
import { log } from "@/lib/runtime/logger";
import type { AdminViewKey } from "@/types/dashboard";
```

## Function signature mismatches discovered during Task 2 reading

- **`buildDashboardModel` requires `DashboardSnapshotState`, not `null`.** Plan said "snapshotState → null"; actual signature is `buildDashboardModel(students, snapshotState: DashboardSnapshotState, today, now)` where `DashboardSnapshotState = { lastSnapshot: PersistedSnapshotState | null; history: HistoryPoint[] }`. Passed `{ lastSnapshot: null, history: [] }` — semantically equivalent to the plan's intent. Plan template was an approximation; the actual API requires the full shape.
- **`bulkGetAdminOwnership` returns `Map<string, StudentAdminOwnershipRow>`, not `Map<string, { adminKey }>`.** Each row contains `adminKey`, `assignedAt`, `assignedByEmail`, `updatedAt`. Code reads only `ownership.adminKey` and translates via the `ADMIN_OWNER_REGISTRY` lookup, so additional fields are unused but available for future audit views.
- **`StudentRecord.adminOwnerKey` is `AdminViewKey` (union type), not `string`.** The Postgres `adminKey` enum has 7 values matching `AdminViewKey` exactly, so `as AdminViewKey` is a safe narrowing assertion. Required cast on line 121 of service.ts.
- **`listInactive()` returns `InactiveStudentRow[]`, not `Set<string>`.** Phase 2's API exposes the full row (studentKey + studentName + parentName + markedAt + markedByEmail). Code maps to `studentKey` and builds the Set inline, so the 4 unused fields are available for future "show me who marked this" UI.

## Whether payload size check triggered during local test runs

No. The 1.8MB threshold was not exercised during `npm test` (vitest tests don't drive `getDashboardPayload` end-to-end against real Wisenet — they unit-test the composer pieces). The threshold sits as a runtime sanity warning that will only fire in production traffic against the actual Wisenet payload. TEST-03 (Plan 03-07) will be the first to round-trip the directive at integration test level; whether it surfaces a real warning depends on the fixture set used.

## Lint result before and after the flip

**Before** (Phase 2 baseline at HEAD~1):
- `npm run lint:no-revalidate-max` → exits 0 because `service.ts:20` is allowlisted.
- One allowlisted occurrence: `web/src/lib/dashboard/service.ts:20` (`revalidateTag(DASHBOARD_CACHE_TAG, "max")`).

**After** (this plan's HEAD):
- `npm run lint:no-revalidate-max` → exits 0 with empty allowlist.
- Zero non-allowlisted occurrences. The 3 new `revalidateTag(DASHBOARD_CACHE_TAG, "max")` calls in route handlers (cascade fix) are the recommended two-arg form and the flipped regex deliberately doesn't match them.
- The single-arg deprecated form does not appear anywhere in `src/`.

## Decisions Made

(Captured in frontmatter `key-decisions`. Three highest-impact decisions:)

- **Inline revalidateTag transition vs facade-now**: kept the cache invalidation inline in route handlers as a Plan 03-04 transition path, rather than rewriting actions.ts pre-emptively. Plan 03-04 will move it to the actions.ts facade per CONTEXT D-28. Two reasons: (1) keeps this plan focused on service.ts + lint per its scope; (2) matches the plan's commit-ordering guidance that 03-03 ships service.ts and 03-04 ships the facade.
- **D-35 baseline tsc cleared in this plan**: the parent objective explicitly asked for it ("Plan 03-02 noted 4 pre-existing tsc errors in dashboard-logic.test.ts and wisenet-mappers.test.ts that should be cleared as part of this plan per D-35"). Both fixes are pure type-narrowing with no behavioral change.
- **db/client.ts lazy via Proxy** rather than via getter function or build-time env stub: Proxy preserves caller ergonomics (`import { db }` everywhere; `db.select(...)` etc.). Switching to `getDb()` would have been a 19-call-site refactor across `db/queries.ts` + `bulk-queries.ts`. The Proxy is the minimal-disruption fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed `invalidateDashboardPayloadCache` export → 3 route handlers broken**
- **Found during:** Task 2 verification — `npx tsc --noEmit` reported 3 missing-export errors in `api/actions/route.ts`, `api/actions/bulk/route.ts`, `api/inactive/route.ts`.
- **Issue:** The plan instructed `service.ts` to drop `invalidateDashboardPayloadCache`. The 3 route handlers still imported it; their imports broke at compile time.
- **Fix:** Replaced each `invalidateDashboardPayloadCache()` call with the inline two-arg form `revalidateTag(DASHBOARD_CACHE_TAG, "max"); recordCacheInvalidation(new Date().toISOString());`. Added `revalidateTag` from `next/cache`, `DASHBOARD_CACHE_TAG`, and `recordCacheInvalidation` to each route handler's imports.
- **Files modified:** `web/src/app/api/actions/route.ts`, `web/src/app/api/actions/bulk/route.ts`, `web/src/app/api/inactive/route.ts`.
- **Verification:** tsc green; the new lint regex doesn't match the two-arg form.
- **Committed in:** `0ef5f73`.

**2. [Rule 3 - Blocking] actions-route.test.ts mocks broken by route-handler swap**
- **Found during:** Task 3 verification — `npm test -- --run` reported 2 actions-route.test.ts tests failing with 500 status (route's `revalidateTag` call threw at runtime because `next/cache` wasn't mocked).
- **Issue:** Test mocked the now-removed `invalidateDashboardPayloadCache` export; route handlers no longer use it.
- **Fix:** Added `vi.mock("next/cache", () => ({ revalidateTag }))` and `vi.mock("@/lib/dashboard/health-state", () => ({ recordCacheInvalidation }))`. Removed the `invalidateDashboardPayloadCache` mock. Updated the cache-invalidation assertion to `expect(revalidateTag).toHaveBeenCalledWith("dashboard-payload", "max")` plus `expect(recordCacheInvalidation).toHaveBeenCalledTimes(1)`.
- **Files modified:** `web/src/test/actions-route.test.ts`.
- **Verification:** 164/164 tests pass.
- **Committed in:** `0ef5f73`.

**3. [Rule 1 - Bug] db/client.ts top-level getDbEnv() throws at build time**
- **Found during:** Task 2 verification — `npm run build` failed at "Collecting page data" with `Missing required environment variable: DATABASE_URL`.
- **Issue:** `db/client.ts` called `neon(getDbEnv().DATABASE_URL)` at module load. Phase 2 didn't trigger this in production builds because no route handler imported `db/client.ts`; Phase 3's new `service.ts` imports `db/queries.ts` which imports `db/client.ts`. Next.js 16's page-data-collection step imports every route module synchronously, which now cascades into the env throw.
- **Fix:** Replaced eager init with a Proxy. The `db` export is now a Proxy whose `get` trap calls `getRealDb()`, which lazily memoizes `neon() + drizzle()` on first access. tsbuildinfo + tsc still type-check correctly because the Proxy declares a `Database` cast.
- **Files modified:** `web/src/lib/db/client.ts`.
- **Verification:** `npm run build` exits 0; `db.select(...)` calls in tests still work; type signatures unchanged for callers.
- **Committed in:** `0ef5f73`.

**4. [Rule 3 - Blocking] Turbopack can't resolve p-limit's #async_hooks imports field**
- **Found during:** Task 2 verification — `npm run build` failed compilation with `Module not found: Can't resolve '#async_hooks'` at `node_modules/p-limit/index.js:2`.
- **Issue:** `p-limit@5.0.0` uses the Node `imports` field to map `#async_hooks` to `node:async_hooks` (Node) or a stub (fallback). Turbopack ignores the `imports` field when bundling; the conditional fails, the module disappears.
- **Fix:** Added `serverExternalPackages: ["p-limit"]` to `next.config.ts`. Tells Next.js to leave `p-limit` to Node's runtime resolver, which honors the `imports` field correctly.
- **Files modified:** `web/next.config.ts`.
- **Verification:** `npm run build` exits 0.
- **Committed in:** `0ef5f73`.

**5. [Rule 1 - Bug] D-35 baseline tsc errors cleared (4 errors → 0)**
- **Found during:** Task 2 (parent objective explicitly directed to clear them).
- **Issue:** `dashboard-logic.test.ts:192,202` had a `string` vs `AdminViewKey` mismatch on `adminOwnerKey`. `wisenet-mappers.test.ts:37,38` had duplicate-key warnings because explicit `_id`/`name` properties were duplicated by a trailing spread of the same shape.
- **Fix:** dashboard-logic — `adminOwnerKey: "palm"` → `adminOwnerKey: "palm" as const` (narrows the literal to fit `AdminViewKey`). wisenet-mappers — removed the explicit `_id: overrides._id` and `name: overrides.name` lines; the `...overrides` later in the object literal already sets them.
- **Files modified:** `web/src/test/dashboard-logic.test.ts`, `web/src/test/wisenet-mappers.test.ts`.
- **Verification:** `npx tsc --noEmit` exits 0; tests still pass.
- **Committed in:** `0ef5f73`.

**6. [Rule 2 - Hygiene] *.tsbuildinfo not gitignored**
- **Found during:** Pre-commit `git status --short` review.
- **Issue:** `web/tsconfig.tsbuildinfo` (incremental tsc cache) appeared as untracked. Phase 1+2 didn't trip this because Phase 2 ran tsc less aggressively against the full tree; this plan ran tsc multiple times during execution.
- **Fix:** Added `*.tsbuildinfo` to `web/.gitignore` with a comment explaining the source.
- **Files modified:** `web/.gitignore`.
- **Verification:** `git check-ignore -v tsconfig.tsbuildinfo` confirms ignored; not in commit.
- **Committed in:** `0ef5f73`.

**7. [Rule 1 - Bug] Empty ALLOWLIST=() trips bash set -u in lint script**
- **Found during:** Task 3 verification — first `npm run lint:no-revalidate-max` invocation aborted with `ALLOWLIST[@]: unbound variable`.
- **Issue:** `set -euo pipefail` in the lint script makes any unbound variable fatal. With `ALLOWLIST=()`, the `for a in "${ALLOWLIST[@]}"; do` expansion fails the `set -u` check.
- **Fix:** Changed expansion to `${ALLOWLIST[@]+"${ALLOWLIST[@]}"}` (POSIX "alternate value" pattern — expands to nothing if the array is empty/unset). Documented the why with a comment.
- **Files modified:** `web/scripts/lint-no-revalidate-max.sh`.
- **Verification:** `npm run lint:no-revalidate-max` exits 0 cleanly.
- **Committed in:** `0ef5f73`.

**8. [Rule 1 - Bug] Lint test file's own comments triggered the new regex**
- **Found during:** Task 3 — second lint invocation after the regex flip reported `src/test/lint-no-revalidate-max.test.ts:6` as a violation. The old comments described "revalidateTag(tag) and treats..." — `revalidateTag(tag)` is exactly the deprecated single-arg shape the regex now matches.
- **Issue:** The Phase 2 test file was carefully crafted to avoid matching the old regex; flipping the regex required re-evaluating every literal.
- **Fix:** Rewrote the comment paragraph to describe the deprecated and recommended forms without using the literal `revalidateTag(tag)` shape.
- **Files modified:** `web/src/test/lint-no-revalidate-max.test.ts`.
- **Verification:** `npm run lint:no-revalidate-max` exits 0; the test itself still uses the runtime-string-assembly trick to avoid self-matching (`FN = "revalidate" + "Tag"`).
- **Committed in:** `0ef5f73`.

---

**Total deviations:** 8 auto-fixed (3 Rule 3 blocking, 4 Rule 1 bugs, 1 Rule 2 hygiene). No Rule 4 architectural escalations.

**Impact on plan:** All 8 fixes were strictly necessary to satisfy the plan's own success criteria (`npm run build` exits 0, `tsc --noEmit` exits 0, `npm test` passes, `npm run lint:no-revalidate-max` exits 0). No scope creep; all fixes confined to files this plan was already touching or ones that became broken as a direct side-effect. The 4 baseline tsc fixes were explicitly requested in the parent objective per D-35.

## Issues Encountered

The build-time `getDbEnv()` throw and Turbopack `#async_hooks` failure both surfaced sequentially during the same `npm run build` after the route-handler tsc cascade was fixed. They presented as different failure modes (compile-time module resolution vs page-data collection runtime) and required different fixes (`serverExternalPackages` for the first, Proxy lazy-init for the second). The resolution order matters: `serverExternalPackages` had to land first so the build proceeded to page-data collection, where the env-throw became visible. If `db/client.ts` had been fixed first, the build would have failed earlier on the p-limit module-not-found and the env issue would have stayed hidden.

## User Setup Required

None — this plan changed no env vars, no schemas, no external services. The TODO operator action from Plan 03-02 (`ARCHIVE_ACTION_SHEET_URL`) and the D-31 admin-ownership seed remain queued for Plan 03-10's Pre-Merge Gate.

## Next Plan Readiness

**Plan 03-04 (SVC-03 — actions.ts mutation facade):**
- service.ts no longer exports `invalidateDashboardPayloadCache` (clean removal — done).
- The 3 inline `revalidateTag(DASHBOARD_CACHE_TAG, "max")` call sites in route handlers are the explicit migration targets. Plan 03-04 will lift these into a `'use server'` actions.ts that wraps `db/queries.ts` writes + `revalidateTag` + `recordCacheInvalidation` per CONTEXT D-28.
- The flipped lint guards against any new code path introducing the deprecated single-arg form. New code MUST use the two-arg form.
- Plan 03-04 builds on the same lazy-db Proxy and the `serverExternalPackages: ["p-limit"]` config; both are foundation work this plan landed.

**Plan 03-05 (SVC-04 — route handler swap):** continues from Plan 03-04. The 3 route handlers will swap their inline `revalidateTag(...)` for the actions.ts facade methods (`setStudentAction`, `clearStudentAction`, `bulkSetAction`, `markInactiveStudent`, `clearInactiveStudent`).

**Plan 03-07 (TEST-03 — cache invalidation integration test):** will be the first to round-trip the directive end-to-end and verify that a write → revalidateTag → read cycle actually mutates the cached payload. This plan's setup (working build, lazy db, mocked next/cache in unit tests) provides the substrate.

## Self-Check: PASSED

- [x] `web/src/lib/runtime/logger.ts` exists with `export function log(`: FOUND
- [x] `web/src/lib/dashboard/service.ts` contains `"use cache: remote"` (line 65), `cacheTag(DASHBOARD_CACHE_TAG)` (line 66), `cacheLife({ stale: 60, revalidate: 60, expire: 300 })` (line 67): FOUND
- [x] `revalidateTag` count in service.ts: 0 (`grep -cE "revalidateTag" src/lib/dashboard/service.ts` returns 0): FOUND
- [x] No `lib/sheets` imports in service.ts (`grep -cE "from \"@/lib/sheets" src/lib/dashboard/service.ts` returns 0): FOUND
- [x] No `lib/dashboard/build` import in service.ts: FOUND
- [x] No `unstable_cache` reference in service.ts: FOUND
- [x] `web/scripts/lint-no-revalidate-max.sh` has `ALLOWLIST=()` (line 23) and PATTERN `revalidateTag\([^,)]+\)` (line 28): FOUND
- [x] `npm run lint:no-revalidate-max` exits 0 with empty allowlist: FOUND
- [x] `npx tsc --noEmit` exits 0 (4 D-35 baseline errors cleared too): FOUND
- [x] `npm test -- --run` 164/164 passing: FOUND
- [x] `npm run build` exits 0; 11/11 routes; "Cache Components enabled": FOUND
- [x] Commit `0ef5f73` exists in git log: FOUND
- [x] V1 root files NOT in commit (no V1 paths in `git show 0ef5f73 --name-only`): FOUND
- [x] All 13 modified files are under `web/`: FOUND

---
*Phase: 03-service-cutover*
*Completed: 2026-04-30*
