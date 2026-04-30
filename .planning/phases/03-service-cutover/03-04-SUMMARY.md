---
phase: 03-service-cutover
plan: "04"
subsystem: dashboard-mutation-facade
tags: [use-server, server-actions, revalidateTag, cache-invalidation, drizzle, mutation-facade]
requires:
  - phase: 02-data-layer
    provides: Drizzle queries (upsertFollowUpState, appendFollowUpLog, markInactive, clearInactive) + bulk-queries (bulkSetStudentAction)
  - 03-03 service.ts rewrite (DASHBOARD_CACHE_TAG centralized, 3 inline route-handler revalidateTag transition)
provides:
  - "'use server' mutation facade (web/src/lib/dashboard/actions.ts) — 5 async mutations over Drizzle query layer"
  - "Single source of truth for cache invalidation: each mutation calls revalidateTag(DASHBOARD_CACHE_TAG, 'max') after Postgres write per D-28"
  - "Co-located action-helpers.ts module hosting the 4 sync helpers (build-time architectural split required by Next.js 16 SWC)"
affects:
  - 03-05 (SVC-04): route handlers will swap inline revalidateTag for facade methods (setStudentAction, clearStudentAction, bulkSetAction, markInactiveStudent, clearInactiveStudent)
  - 03-07 (TEST-03): integration test will round-trip writes through the facade methods
  - 03-08 (SVC-05): lib/sheets/actions.ts already updated to import sanitizeStudentActionState from action-helpers; deletion is now safe

tech-stack:
  added:
    - "'use server' file directive for mutation facade — Next.js 16 Server Actions"
    - "Co-located helper module pattern (action-helpers.ts) for sync utilities that cannot live in 'use server' files"
  patterns:
    - "D-28 ordering: Postgres write awaited FIRST, revalidateTag SECOND. If write throws, revalidateTag never runs"
    - "revalidateTag is the TWO-ARG form revalidateTag(tag, 'max') — works from BOTH route handlers AND server actions; updateTag would throw from route handlers per RESEARCH §Critical Finding #1"
    - "'use server' files cannot export sync functions — SWC enforces async-only at BUILD TIME (not just runtime). Re-exports of sync functions via 'export ... from' also stripped. Resolution: split helpers into co-located module"

key-files:
  created:
    - "web/src/lib/dashboard/action-helpers.ts (62 lines, co-located sync helpers)"
  modified:
    - "web/src/lib/dashboard/actions.ts (full rewrite — 'use server' facade + 5 async mutations + helper re-export comment)"
    - "web/src/lib/dashboard/service.ts (Rule 3 — import attachActionStatesToStudents from action-helpers)"
    - "web/src/lib/dashboard/build.ts (Rule 3 — same)"
    - "web/src/lib/sheets/actions.ts (Rule 3 — import sanitizeStudentActionState from action-helpers)"
    - "web/src/app/api/actions/route.ts (Rule 3 — import normalizeStudentActionStatus from action-helpers)"
    - "web/src/app/api/actions/bulk/route.ts (Rule 3 — same)"
    - "web/src/test/calendar.test.ts (Rule 3 — import attachActionStatesToStudents from action-helpers)"
    - "web/src/test/dashboard-logic.test.ts (Rule 3 — import attachActionStatesToStudents + sanitizeStudentActionState from action-helpers)"
    - "web/src/test/pending-deduction.test.ts (Rule 3 — import sanitizeStudentActionState from action-helpers)"
    - "web/src/test/queue.test.ts (Rule 3 — import attachActionStatesToStudents from action-helpers)"

key-decisions:
  - "Helpers split to co-located action-helpers.ts module rather than made async. Plan must_have #4 (preserved helpers) + Next.js 16 SWC build-time async-only enforcement created a hard conflict. Splitting preserves the sync API for all 9 caller files (no behavior change at call sites — only import path changes)"
  - "Re-export attempt failed — Next.js SWC strips non-async re-exports from 'use server' files (build error: 'The module has no exports at all'). Direct imports from action-helpers.ts is the only viable resolution"
  - "All 9 caller files updated to import from action-helpers.ts. No behavior change — only import path migration. Sync helper API unchanged. Tests pass without rewrites"
  - "Plan must_have #1 ('use server' file-level directive on line 1) preserved literally — the directive marks the 5 async mutations as Server Actions while the helpers live next door"
  - "Mutation facade composition over the Drizzle query layer matches D-28 option (b): single source of truth for cache invalidation. Each method awaits the Postgres write, then synchronously calls revalidateTag(tag, 'max'). Bulk write goes through the WebSocket Pool driver per D-25 transactionally"

patterns-established:
  - "Pattern: 'use server' mutation facade — file-level directive + 5 async mutations, each writing-then-invalidating in strict D-28 order"
  - "Pattern: co-located helper module split for 'use server' files — sync utilities live in `*-helpers.ts` next to the Server Actions file; re-exports do NOT work, callers import from the helpers file directly"
  - "Pattern: Postgres write FIRST, cache invalidation SECOND. Never invert the order (cache would invalidate without DB change, OR cache might re-cache pre-write payload before write commits — D-28 staleness window)"

requirements-completed:
  - SVC-03

# Metrics
duration: 8min
completed: 2026-04-30
---

# Phase 3 Plan 04: actions.ts 'use server' Mutation Facade Summary

**Rewrote `web/src/lib/dashboard/actions.ts` as a `'use server'` mutation facade over the Drizzle query layer — 5 async mutations (setStudentAction, clearStudentAction, bulkSetAction, markInactiveStudent, clearInactiveStudent), each writing to Postgres first and calling `revalidateTag(DASHBOARD_CACHE_TAG, "max")` second per D-28. Co-located the 4 sync helpers in a new `action-helpers.ts` module (Next.js 16 SWC enforces async-only exports for 'use server' files at build time) and updated 9 caller files to import from the new module.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-30T03:10:08Z
- **Completed:** 2026-04-30T03:18:18Z
- **Tasks:** 1 (per plan) + 1 architectural cascade (helper split + 9 caller updates)
- **Files modified:** 11 (1 created, 10 edited)
- **Commit:** `ff33a11`

## Accomplishments

1. **'use server' mutation facade in actions.ts.** Five async functions, each:
   - **setStudentAction** — `upsertFollowUpState(input)` + `appendFollowUpLog({...input, actionType: "set"})` + `revalidateTag(DASHBOARD_CACHE_TAG, "max")` + `recordCacheInvalidation(...)`. Required actor fields: `updatedByEmail`, `updatedByName` (DB-06 enforced via `.notNull()` schema columns).
   - **clearStudentAction** — `appendFollowUpLog({...input, actionType: "clear", status: null})` + cache invalidation. Note: does NOT delete the follow_up_state row — DB-05 same-day visibility is enforced by the domain layer (sanitizeStudentActionState filters by today's date), not by row deletion. Required actor fields: `actorEmail`, `actorName`.
   - **bulkSetAction** — `dbBulkSetStudentAction({updates, actorEmail, actorName})` (single transaction on WebSocket Pool driver per D-25, all-or-nothing) + cache invalidation.
   - **markInactiveStudent** — `dbMarkInactive({studentKey, studentName, parentName, markedByEmail})` + cache invalidation. Note: signature deviation from plan template — `markInactive` schema only has `markedByEmail` (no `markedByName` column); `markedByName` accepted as input parameter for API symmetry but not threaded into the DB call.
   - **clearInactiveStudent** — `dbClearInactive(studentKey)` (DELETE by studentKey since the schema models inactive status as row presence) + cache invalidation.

2. **action-helpers.ts (new) hosts the 4 sync helpers.** `normalizeStudentActionStatus`, `sanitizeStudentActionState`, `attachActionStatesToStudents`, `isActionStateToday`. Sync API unchanged — preserves the original behavior contract for all 9 server-side callers. The file imports `formatDate`, `parseDate` from `@/lib/dashboard/helpers` and shares the `VALID_STATUSES` constant.

3. **Lint result:** `npm run lint:no-revalidate-max` exits 0 with empty allowlist. The 5 new `revalidateTag(DASHBOARD_CACHE_TAG, "max")` calls in actions.ts are the recommended two-arg form (the lint regex matches only the deprecated single-arg form, so these don't trip it).

## Function Signature Mismatches Discovered During Reading

- **`upsertFollowUpState` signature matched the pattern.** It takes a `FollowUpStateInsert` shape: `{ studentKey, studentName, parentName, status, updatedByEmail, updatedByName }`. The plan template was accurate.
- **`appendFollowUpLog` for clearStudentAction accepted `status: null` correctly.** The schema has `status: studentActionStatusEnum("status")` (NULLable for clear/bulk-clear events per the inline schema comment). TypeScript accepted the `status: null` literal.
- **`bulkSetStudentAction` input type shape:** `BulkActionInput = { updates: Array<{studentKey, studentName, parentName, status}>, actorEmail, actorName }`. Matches the plan template exactly. Internally the function maps to `FollowUpStateInsert[]` and `FollowUpLogInsert[]` (with `actionType: "bulk-set"`) and runs both inserts inside a single `BEGIN/COMMIT` transaction on the WebSocket Pool driver.
- **`markInactive` schema deviation:** the schema's `inactive_students` table only has `markedByEmail` (no `markedByName` column). The facade `markInactiveStudent` accepts both `markedByEmail` and `markedByName` for symmetry with the other mutations, but only threads `markedByEmail` into the DB call. The plan template's `{ markedByEmail, markedByName }` interface is preserved at the facade boundary; the DB call receives only `markedByEmail`.

## Task Commit

- **Single atomic commit:** `ff33a11` — facade rewrite + helper split + 9 caller updates. Per the plan's task: "Commit: git add web/src/lib/dashboard/actions.ts; git commit -m 'feat(03-04): add revalidateTag cache-invalidation to 5 mutation paths via use-server actions facade'". The actual commit also includes the action-helpers.ts split file and the 8 caller-import updates that were forced by the SWC build-time async constraint (Rule 3 cascade).

## Files Created/Modified

### Created (1)
- `web/src/lib/dashboard/action-helpers.ts` — 62-line co-located sync-helpers module. Hosts `normalizeStudentActionStatus`, `sanitizeStudentActionState`, `attachActionStatesToStudents`, `isActionStateToday`, plus the private `VALID_STATUSES` constant. Sync API identical to the pre-rewrite versions in actions.ts.

### Modified — primary deliverable (1)
- `web/src/lib/dashboard/actions.ts` — full rewrite. Adds `'use server'` directive on line 1. New imports for `revalidateTag` (from `next/cache`), `upsertFollowUpState`, `appendFollowUpLog`, `markInactive as dbMarkInactive`, `clearInactive as dbClearInactive` (from `@/lib/db/queries`), `bulkSetStudentAction as dbBulkSetStudentAction` (from `@/lib/db/bulk-queries`), `DASHBOARD_CACHE_TAG` (from `@/lib/dashboard/config`), `recordCacheInvalidation` (from `@/lib/dashboard/health-state`), and `StudentActionStatus` (type-only). Re-exports the 4 helpers from `@/lib/dashboard/action-helpers` (these re-exports DO NOT survive the SWC transform — see Deviations below — but are kept for documentation/intent and don't break the build). Defines the 5 async mutation methods with full JSDoc comments documenting D-28 ordering and the DB schema's actor-attribution requirement.

### Modified — Rule 3 cascades (9)
SWC enforces async-only exports for 'use server' files at build time. Since the helpers must remain sync (preserving API for ~10 caller sites), they live in `action-helpers.ts` instead. All 9 callers updated to import from the new module:

- `web/src/lib/dashboard/service.ts` — `import { attachActionStatesToStudents } from "@/lib/dashboard/action-helpers";`
- `web/src/lib/dashboard/build.ts` — same.
- `web/src/lib/sheets/actions.ts` — `import { sanitizeStudentActionState } from "@/lib/dashboard/action-helpers";`. Note: this file is slated for deletion in Plan 03-08 SVC-05; the import update keeps the build green during the cutover transition.
- `web/src/app/api/actions/route.ts` — `import { normalizeStudentActionStatus } from "@/lib/dashboard/action-helpers";`
- `web/src/app/api/actions/bulk/route.ts` — same.
- `web/src/test/calendar.test.ts` — `import { attachActionStatesToStudents } from "@/lib/dashboard/action-helpers";`
- `web/src/test/dashboard-logic.test.ts` — `import { attachActionStatesToStudents, sanitizeStudentActionState } from "@/lib/dashboard/action-helpers";`
- `web/src/test/pending-deduction.test.ts` — `import { sanitizeStudentActionState } from "@/lib/dashboard/action-helpers";`
- `web/src/test/queue.test.ts` — `import { attachActionStatesToStudents } from "@/lib/dashboard/action-helpers";`

## Lint Result Before and After

**Before** (Phase 3 Plan 03-03 baseline at `9c81510`):
- `npm run lint:no-revalidate-max` → exits 0 (empty allowlist; 3 inline `revalidateTag(DASHBOARD_CACHE_TAG, "max")` calls in route handlers are the recommended two-arg form and don't match the deprecated-form regex).

**After** (this plan's HEAD `ff33a11`):
- `npm run lint:no-revalidate-max` → still exits 0 (empty allowlist).
- Adds 5 new `revalidateTag(DASHBOARD_CACHE_TAG, "max")` calls in actions.ts (one per mutation). All are the two-arg form; lint regex unchanged.
- The 3 inline route-handler calls from Plan 03-03 remain in place — they will be removed in Plan 03-05 (SVC-04) when route handlers swap to the facade methods.

## Decisions Made

(Captured in frontmatter `key-decisions`. Three highest-impact decisions:)

- **Helper split into action-helpers.ts** rather than making them async or removing the 'use server' directive. Both alternatives had worse tradeoffs: making helpers async would break ~9 caller sites with API changes (callers would need `await` everywhere); removing 'use server' would violate the plan's must_have #1. The split preserves both must_haves with minimal caller-side disruption (only import paths change).
- **9 caller-import updates as Rule 3 cascade.** The SWC build-time check made the helper split mandatory. Updating all callers to import from action-helpers.ts is purely mechanical — no behavior change. All 164 tests pass without rewrites.
- **Schema deviation accepted for markInactiveStudent.** The plan template's `markedByName` parameter has no corresponding DB column. Accepted at the facade level for API symmetry with the other 4 mutations (every facade method takes `*Email + *Name` actor fields) but discarded at the DB call site. Future schema migration could add a `marked_by_name` column if needed; out of scope for this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] SWC enforces async-only exports for 'use server' files at BUILD TIME, not just runtime**
- **Found during:** Task verification — `npm run build` failed with `./src/lib/dashboard/actions.ts:202:17 Server Actions must be async functions.` for each of the 4 sync helper exports.
- **Issue:** The plan instructed adding `'use server'` to actions.ts AND preserving the 4 sync helper exports (`normalizeStudentActionStatus`, `sanitizeStudentActionState`, `attachActionStatesToStudents`, `isActionStateToday`). These are mutually exclusive: the Next.js 16 SWC compiler enforces that all exports of a 'use server' file must be async functions. The runtime check at `node_modules/next/dist/build/webpack/loaders/next-flight-loader/action-validate.js` is permissive (only `typeof === 'function'`), but the build-time SWC transform is strict.
- **First attempt:** Re-export the helpers via `export { ... } from "@/lib/dashboard/action-helpers"` after creating a co-located helpers module. Build failed with `The export normalizeStudentActionStatus was not found in module ... actions.ts` and `The module has no exports at all` — SWC strips non-async re-exports from 'use server' file output entirely.
- **Resolution:** Update all callers to import directly from `@/lib/dashboard/action-helpers` rather than going through actions.ts. The actions.ts file keeps a re-export statement (which is a no-op at the bundle level but documents intent) but production code paths import from the helpers module.
- **Files modified:** Created `web/src/lib/dashboard/action-helpers.ts` (62 lines). Updated 9 caller files (3 lib/, 2 route handlers, 4 tests).
- **Verification:** `npm run build` exits 0; tsc clean; 164/164 tests pass.
- **Committed in:** `ff33a11`.

**2. [Rule 1 - Schema mismatch] markInactiveStudent's markedByName parameter has no DB column**
- **Found during:** Task 1 reading — `web/src/lib/db/schema.ts` line 113 shows `inactive_students` table has `markedByEmail` but NO `markedByName` column.
- **Issue:** The plan template specified `markInactiveStudent({ studentKey, studentName, parentName, markedByEmail, markedByName })` and `dbMarkInactive(input)`. But `markInactive` (db/queries.ts:118) takes `InactiveStudentInsert` which has no `markedByName` field.
- **Resolution:** Kept the facade signature accepting `markedByName` for API symmetry with the other 4 mutations (each takes `*Email + *Name` actor pair) but only thread `markedByEmail` into the DB call. The unused parameter is a no-op at the facade layer.
- **Files modified:** None beyond actions.ts itself.
- **Verification:** tsc clean (no missing-parameter errors); test fixtures unchanged.
- **Committed in:** `ff33a11`.

**Total deviations:** 2 auto-fixed (1 Rule 3 architectural-cascade; 1 Rule 1 schema-mismatch handled by API-shape decision). No Rule 4 architectural escalations to user.

**Impact on plan:** All deviations strictly necessary to satisfy the plan's verification commands (`head -1 actions.ts | grep "use server"` exits 0; `grep -c 'revalidateTag(DASHBOARD_CACHE_TAG, "max")' returns 5`; tsc clean; build passes; tests pass; lint clean). The Rule 3 cascade expanded the file scope from 1 to 11 files — but all 9 caller updates are pure import-path changes with zero behavior modification.

## Issues Encountered

The interaction between Next.js 16's `'use server'` directive and SWC's build-time validation was not anticipated by the plan. Documentation and the runtime validate function suggest 'use server' files only enforce "exports are functions" at runtime, but production builds enforce "exports are async functions" via SWC transform passes. Re-exports of sync functions are also stripped — so the obvious workaround (re-export from a helper file) doesn't work. The viable path is helper module + caller-side import migration. Future Phase 3 plans that introduce more `'use server'` files should anticipate this pattern.

## User Setup Required

None — this plan changed no env vars, no schemas, no external services. The Phase 3 cutover continues to require:
- Plan 03-02's `ARCHIVE_ACTION_SHEET_URL` placeholder replacement (queued for Plan 03-10 Pre-Merge Gate).
- D-31 admin-ownership seed (queued for Plan 03-10 Pre-Merge Gate).
- D-42 prod-snapshot transfer + push to `kasheesh711/begifted-credit-dashboard` (Plan 03-10 final operator step).

## Next Plan Readiness

**Plan 03-05 (SVC-04 — route handler swap):**
- The 3 inline `revalidateTag(DASHBOARD_CACHE_TAG, "max")` call sites in route handlers (placed by Plan 03-03 as a transition shim) are the explicit migration targets. Plan 03-05 will:
  1. `api/actions/route.ts` POST: replace `setStudentActionInSheets`/`clearStudentActionInSheets` + inline `revalidateTag` with `setStudentAction()`/`clearStudentAction()` from the new facade.
  2. `api/actions/bulk/route.ts` POST: replace the per-key Sheets calls + inline `revalidateTag` with `bulkSetAction()` (single transaction).
  3. `api/inactive/route.ts` POST/DELETE: replace `markStudentInactive`/`clearStudentInactive` + inline `revalidateTag` with `markInactiveStudent()`/`clearInactiveStudent()`.
- The facade methods are now stable; their 5 signatures are documented in actions.ts JSDoc + this summary's section "Function Signature Mismatches".
- After Plan 03-05 lands, the lib/sheets/actions.ts and lib/sheets/inactive-students.ts callers will have ZERO references in route handlers — Plan 03-08 SVC-05 can delete them safely.

**Plan 03-07 (TEST-03 — cache invalidation integration test):** Will round-trip writes through the facade methods. The test shape in CONTEXT D-29 maps directly: seed minimal fixture → `setStudentAction()` → re-fetch via `getDashboardPayload()` → assert state changed. The facade is the test's primary surface.

**Plan 03-08 (SVC-05 — deletion of lib/sheets):** lib/sheets/actions.ts already updated to import from action-helpers (via this plan's Rule 3 cascade). After Plan 03-05 removes the route-handler imports, deletion is safe.

## Self-Check: PASSED

- [x] `web/src/lib/dashboard/actions.ts` line 1 contains `"use server";`: FOUND
- [x] `web/src/lib/dashboard/actions.ts` exports `setStudentAction`, `clearStudentAction`, `bulkSetAction`, `markInactiveStudent`, `clearInactiveStudent` (5 async functions): FOUND (lines 71, 109, 139, 165, 189)
- [x] `revalidateTag(DASHBOARD_CACHE_TAG, "max")` count in actions.ts: 5 (`grep -c` returns 5): FOUND
- [x] `web/src/lib/dashboard/action-helpers.ts` exists with 4 helper exports + private VALID_STATUSES: FOUND
- [x] `npx tsc --noEmit` exits 0: FOUND
- [x] `npm test -- --run` 164/164 passing: FOUND
- [x] `npm run build` exits 0; 11 routes built; "Cache Components enabled": FOUND
- [x] `npm run lint:no-revalidate-max` exits 0 (empty allowlist): FOUND
- [x] Commit `ff33a11` exists in git log: FOUND
- [x] V1 root files NOT in commit (`.clasp.json`, `Code.gs`, `Validation.gs`, etc. remain unstaged): FOUND
- [x] All 11 modified/created files are under `web/`: FOUND
- [x] No `from "@/lib/dashboard/actions"` imports remaining for the helper functions in production paths (only intentional comment references): FOUND

---
*Phase: 03-service-cutover*
*Completed: 2026-04-30*
