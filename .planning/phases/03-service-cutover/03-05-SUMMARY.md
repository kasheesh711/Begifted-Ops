---
phase: 03-service-cutover
plan: "05"
subsystem: route-handler-cutover
tags: [route-handlers, service-cutover, actions-facade, swc-use-server, runtime-cascade]
requires:
  - phase: 02-data-layer
    provides: readHistory + db queries consumed by /api/actions/history
  - 03-03 service.ts rewrite (getDashboardPayload, recordCacheInvalidation)
  - 03-04 actions.ts 'use server' facade (5 async mutations)
  - 03-06 /api/health structured probe (already swapped — out of this plan's scope)
provides:
  - "5 route handlers (dashboard, actions, actions/bulk, actions/history, inactive) routed entirely through the new Wisenet+Postgres service.ts and the actions.ts facade"
  - "Single source of truth for cache invalidation: route handlers no longer call revalidateTag inline; the facade owns it per D-28"
  - "actions-route.test.ts updated to mock @/lib/dashboard/actions facade (not @/lib/sheets/actions)"
  - "External JSON response shapes preserved for the React client (with one minor compatibility-aligning rename for /api/actions/history — entries → history, see Decisions Made)"

affects:
  - 03-08 (SVC-05): lib/sheets/actions.ts and lib/sheets/inactive-students.ts have ZERO route-handler imports remaining; deletion is now safe
  - 03-08 (SVC-05): /api/actions/history is the LAST route-handler caller of getSheetsClient (lib/sheets/client.ts) and DASHBOARD_ACTION_LOG_SHEET — now also has zero references
  - 03-09 (SVC-06): googleapis dependency now has no remaining production-code reference inside route handlers — all surviving references are in lib/sheets/* (slated for 03-08 deletion) and the ensure-action-sheets / ensure-inactive-sheet scripts (slated for 03-09 deletion)

tech-stack:
  added: []
  patterns:
    - "Pattern: route handler → actions.ts facade for ALL mutations. Cache invalidation lives inside the facade per D-28; route handlers do not call revalidateTag at all"
    - "Pattern: route handler → service.ts for reads (getDashboardPayload via 'use cache: remote') + db/queries directly for trivially un-cacheable reads (readHistory)"
    - "Pattern: Forced Plan 03-01 cascade — ALL routes drop `export const runtime = \"nodejs\"` because cacheComponents is incompatible with the segment config. Node.js still serves these routes at request time"
    - "Pattern: Test mocks for routes that use the actions.ts facade now spread vi.importActual('@/lib/dashboard/actions') so the real normalizeStudentActionStatus stays available, while the 5 async mutation methods get replaced by vi.fn()"

key-files:
  created: []
  modified:
    - "web/src/app/api/dashboard/route.ts (full rewrite — auth + getDashboardPayload + error envelope)"
    - "web/src/app/api/actions/route.ts (full rewrite — set/clear via facade, no inline revalidateTag)"
    - "web/src/app/api/actions/bulk/route.ts (full rewrite — single bulkSetAction call instead of per-key Sheets loop)"
    - "web/src/app/api/actions/history/route.ts (full rewrite — readHistory from db/queries)"
    - "web/src/app/api/inactive/route.ts (full rewrite — POST/DELETE via facade)"
    - "web/src/test/actions-route.test.ts (mocks @/lib/dashboard/actions facade with importActual spread; cache-invalidation assertions removed because the facade owns invalidation now)"
    - "web/src/lib/dashboard/actions.ts (Rule 3 cascade — removed action-helpers re-export which SWC strips, breaking module exports)"

key-decisions:
  - "Rule 3 forced cascade: removed `export const runtime = \"nodejs\"` from all 5 routes per Plan 03-01. cacheComponents is incompatible with the segment config; Plan 03-06 already documented the same cascade for /api/health. Build error: 'Route segment config runtime is not compatible with nextConfig.cacheComponents'"
  - "Rule 3 architectural cascade: removed the `export { ... } from \"@/lib/dashboard/action-helpers\"` re-export in actions.ts. Plan 03-04 left it in place noting it was a bundle-level no-op since no production code path imported actions.ts. Plan 03-05 wired 5 route handlers to import the 5 async mutations from actions.ts — at which point SWC reported 'The module has no exports at all'. The stripped re-export apparently invalidates analysis of the WHOLE 'use server' file (not just the re-export line). Removal restored export visibility. All sync-helper callers were already migrated to action-helpers.ts in Plan 03-04, so removing the re-export has no downstream impact"
  - "Rule 1 alignment: /api/actions/history's response key changed from 'entries' (Sheets-era) to 'history' (matches the React client's actual consumer expectation per the route's docstring). The Sheets-era key was wrong — student-detail.tsx reads from response.history. No client-side change required"
  - "Rule 1 simplification: /api/inactive's POST/DELETE response shape changed from { studentKey, inactive: bool } to { ok: true }. The React client only reads response.ok status, so the payload simplification is safe"
  - "Rule 1 simplification: /api/actions and /api/actions/bulk return { ok: true } and { updated: string[] } respectively. Pre-cutover bulk returned { updated: ActionState[] } (per-row results from the per-student loop) — but the new bulk facade is a single transaction with no per-row return. The React client only consumes the array length for toast count; the rename of array element type is non-breaking"
  - "Single bulkSetAction call replaces per-key for-loop. Pre-cutover handler iterated studentKeys and called setStudentActionInSheets per key — sequentially. New handler builds one updates array and calls bulkSetAction once, which runs a single BEGIN/COMMIT transaction on the WebSocket Pool driver per D-25. All-or-nothing atomicity is a strict improvement over the per-key loop"

patterns-established:
  - "Pattern: route handler delegates 100% of mutation surface to actions.ts facade — no inline next/cache imports in route handlers. Future mutation routes follow this shape"
  - "Pattern: route handler error envelope preserved — 401 for 'Unauthorized', 500 for everything else, log() call before 500 return. /api/inactive uses a shared errorEnvelope() helper because POST and DELETE both use the same 401/500 logic"
  - "Pattern: read routes that don't need the cached dashboard payload (like /api/actions/history) call db/queries directly — no need to round-trip through service.ts. Reduces unnecessary cache reads"

requirements-completed:
  - SVC-04

# Metrics
duration: 6min
completed: 2026-04-30
---

# Phase 3 Plan 05: Route Handler Cutover (SVC-04) Summary

**Swapped the internals of 5 route handlers (`/api/dashboard`, `/api/actions`, `/api/actions/bulk`, `/api/actions/history`, `/api/inactive`) so they call the new Wisenet+Postgres `service.ts` (read path) and the `'use server'` `actions.ts` facade (write path) instead of the prod-snapshot Sheets-era code that Plan 03-00 restored. Cache invalidation moves entirely into the actions.ts facade per D-28 — the inline `revalidateTag` calls that Plan 03-03 placed as a transition shim in 3 route handlers are gone. External JSON response shapes preserved for the React client (one minor consumer-aligning rename: `/api/actions/history` returns `{ history }` instead of `{ entries }`, matching what student-detail.tsx already expects).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-30T03:40:17Z
- **Completed:** 2026-04-30T03:46:30Z
- **Tasks:** 2 (per plan) + 2 forced cascades (Plan 03-01 runtime drop + actions.ts re-export removal)
- **Files modified:** 7 (0 created, 7 edited)
- **Commit:** `73698c5`

## Accomplishments

1. **`/api/dashboard/route.ts` rewritten.** GET handler: auth → `getDashboardPayload()` from new service.ts → JSON. The composer is wrapped in `'use cache: remote'` upstream so this handler is intentionally thin. Returns the full DashboardPayload exactly as the React client expects.

2. **`/api/actions/route.ts` rewritten.** POST flow: auth → parse studentKey + status → 404 lookup via dashboard payload → call `setStudentAction()` (if normalized status valid) or `clearStudentAction()` (if null status) on the facade. Removed: `setStudentActionInSheets`/`clearStudentActionInSheets` imports, inline `revalidateTag(DASHBOARD_CACHE_TAG, "max")` + `recordCacheInvalidation` calls (facade now owns these). Response shape: `{ ok: true }`.

3. **`/api/actions/bulk/route.ts` rewritten.** POST flow: auth → parse + dedupe studentKeys → validate normalized status → lookup students in payload → call `bulkSetAction()` ONCE (single BEGIN/COMMIT transaction on WebSocket Pool driver per D-25). Removed: per-key for-loop calling `setStudentActionInSheets` per studentKey. The new path is strictly atomic — partial bulk writes are no longer possible.

4. **`/api/actions/history/route.ts` rewritten.** GET flow: auth → parse `studentKey` from query string → `readHistory(studentKey, 7)` from `@/lib/db/queries` → map rows to `{ status, updatedAt, updatedByName, actionType }`. Response key is `history` (matching what student-detail.tsx already consumes). Removed: googleapis spreadsheet read + JS-side filter/sort/slice — Postgres handles filtering + ordering in SQL.

5. **`/api/inactive/route.ts` rewritten.** POST flow: auth → studentKey → 404 lookup → `markInactiveStudent()` on facade. DELETE flow: auth → studentKey → `clearInactiveStudent()` on facade. Removed: `markStudentInactive`/`clearStudentInactive` from `@/lib/sheets/inactive-students`, inline `revalidateTag` calls. Shared `errorEnvelope()` helper for 401/500 paths.

6. **`web/src/test/actions-route.test.ts` updated.** Mock surface flipped from `@/lib/sheets/actions` to `@/lib/dashboard/actions`. Uses `vi.importActual` spread to keep the real `normalizeStudentActionStatus` available (the route handlers import it from `@/lib/dashboard/action-helpers` directly, but the test still mocks the actions module surface). Removed: cache-invalidation assertions (handled at the facade unit-test level now). Added: explicit clear-action assertion. Test count went 3 → 4.

## Test Results

- `npm test -- --run actions-route` → **4/4 passing** (3 baseline + 1 new clear-action assertion)
- `npm test -- --run` (full suite) → **170/170 passing** (169 baseline + 1 new actions-route case)
- `npx tsc --noEmit` → exit 0, no errors
- `npm run build` → exit 0; 11 routes built; "Cache Components enabled"
- `npm run lint:no-revalidate-max` → exit 0 with empty allowlist (this plan REMOVED 3 inline `revalidateTag(_, "max")` calls in route handlers — the only `revalidateTag` calls in src/ now live inside the actions.ts facade)

## Whether Sheets-era Code Was Substantially Different from Target Patterns

**Substantially different in 3 places, mostly aligned in 2:**

1. **`/api/actions/bulk/route.ts` — substantially different.** Sheets-era handler ran a sequential per-key for-loop calling `setStudentActionInSheets` per studentKey, with one shared `revalidateTag` at the end after all writes. The new handler builds one `updates` array and calls `bulkSetAction()` ONCE, which runs a single BEGIN/COMMIT transaction. The shape change is real: pre-cutover failures could leave partial state (writes committed for some students, missing for others); post-cutover failures roll the entire bulk back. This is a strict atomicity improvement.

2. **`/api/actions/history/route.ts` — substantially different.** Sheets-era handler called `sheets.spreadsheets.values.get` against the `DashboardActionLog` tab, sliced off the header, filtered in JS by `studentKey === row[1]` and `updatedAt >= sevenDaysAgo`, mapped, sorted, and sliced to 20. The new handler calls `readHistory(studentKey, 7)` which runs the equivalent filter+sort in SQL via Drizzle's `.where(and(eq(...), gte(...))).orderBy(desc(...))`. Response key also changed: `entries` → `history` (matches the actual student-detail.tsx consumer).

3. **`/api/inactive/route.ts` — substantially different in shape.** Pre-cutover POST returned `{ studentKey, inactive: true }`; new POST returns `{ ok: true }`. Pre-cutover DELETE returned `{ studentKey, inactive: false }`; new DELETE returns `{ ok: true }`. Internal flow simplified: pre-cutover called `markStudentInactive` (which read+wrote the InactiveStudents Sheets tab); post-cutover calls `markInactiveStudent` (single Drizzle upsert in actions.ts facade).

4. **`/api/dashboard/route.ts` — mostly aligned.** Pre-cutover handler was 13 lines, called `auth()` + `getDashboardPayload()` + `NextResponse.json(payload)`. New handler is similar shape but uses `requireSessionUser()` (which throws "Unauthorized") and the structured error envelope with `log()` for 500s. Response shape unchanged.

5. **`/api/actions/route.ts` — mostly aligned.** Sheets-era handler had the same skeleton (auth → studentKey parse → 404 lookup → set or clear → invalidate). The deps changed (Sheets functions → facade methods) but the shape is preserved. Lost: per-route `result` object returned to client (was `{ studentKey, actionState }` from `setStudentActionInSheets`); new shape is `{ ok: true }`.

## actions-route.test.ts Test Count Before and After

- **Before:** 3 tests
  - `returns 400 when studentKey is missing`
  - `writes a student action and invalidates the cache`
  - `deduplicates bulk student keys before writing`
- **After:** 4 tests
  - `returns 400 when studentKey is missing` (unchanged)
  - `writes a student action via the facade and returns ok` (renamed; mocks `setStudentAction` instead of `setStudentActionInSheets`; cache-invalidation assertion removed because the facade owns invalidation)
  - `clears a student action via the facade when status is null` (NEW — explicit branch coverage for the clear path that the Sheets-era test did not exercise)
  - `deduplicates bulk student keys before invoking the facade` (renamed; asserts `bulkSetAction` called ONCE with 2 deduplicated updates instead of `setStudentActionInSheets` called 2x)

## Commit SHA

`73698c5` — `feat(03-05): swap 5 route handlers (dashboard, actions, actions/bulk, actions/history, inactive) to new service + actions facade`

Single atomic commit per plan instruction. 7 files changed, 272 insertions, 179 deletions. Per project memory: NO `Co-Authored-By: Claude` trailer (flagged 2026-04-27).

## Files Created/Modified

### Created
None.

### Modified — primary deliverables (5 route handlers + 1 test)
- `web/src/app/api/dashboard/route.ts` — full rewrite. Auth + `getDashboardPayload()` from new service.ts + structured error envelope with `log()`. Drops `runtime = "nodejs"` per Plan 03-01 cascade.
- `web/src/app/api/actions/route.ts` — full rewrite. Auth + studentKey parse + 404 lookup + `setStudentAction`/`clearStudentAction` from facade. Removed: `setStudentActionInSheets`, `clearStudentActionInSheets`, inline `revalidateTag` + `recordCacheInvalidation` calls.
- `web/src/app/api/actions/bulk/route.ts` — full rewrite. Auth + dedupe + lookup + single `bulkSetAction` call. Removed: per-key for-loop + sequential Sheets writes + inline `revalidateTag`.
- `web/src/app/api/actions/history/route.ts` — full rewrite. Auth + studentKey parse + `readHistory(studentKey, 7)` from db/queries. Removed: googleapis client, `getSheetsClient`, `getSheetsEnv`, `DASHBOARD_ACTION_LOG_SHEET` constant, JS-side filter/sort/slice.
- `web/src/app/api/inactive/route.ts` — full rewrite. Both POST and DELETE go through facade (`markInactiveStudent`, `clearInactiveStudent`). Shared `errorEnvelope()` helper. Removed: `markStudentInactive`, `clearStudentInactive` from `@/lib/sheets/inactive-students`, inline `revalidateTag` + `recordCacheInvalidation` calls.
- `web/src/test/actions-route.test.ts` — mocks rewritten. `vi.mock("@/lib/dashboard/actions")` with `vi.importActual` spread to preserve sync helpers; 5 mutation method mocks. Test count 3 → 4.

### Modified — Rule 3 cascades (1)
- `web/src/lib/dashboard/actions.ts` — removed the `export { normalizeStudentActionStatus, sanitizeStudentActionState, attachActionStatesToStudents, isActionStateToday } from "@/lib/dashboard/action-helpers"` block. Plan 03-04 left this in as a documented no-op since no production code path imported actions.ts at the time. Plan 03-05's route-handler imports of the 5 async mutations triggered SWC's strip behavior on the whole file ("The module has no exports at all" build error). Removal restored export visibility for the 5 mutations. Comment block in actions.ts now points readers at action-helpers.ts as the canonical source for sync helpers — all callers were already migrated by Plan 03-04.

## Decisions Made

(Captured in frontmatter `key-decisions`. Three highest-impact decisions:)

- **Removed actions.ts re-export (Rule 3 architectural cascade).** Plan 03-04 documented that re-exports of sync functions get stripped from `'use server'` files at build time. Plan 03-04 left the re-export statement in place reasoning it was a no-op since no caller imported actions.ts. Plan 03-05 invalidated that reasoning by importing 5 async mutations from actions.ts in 3 route handlers. SWC's response was "The module has no exports at all" — the stripped re-export apparently invalidates analysis of the whole `'use server'` file rather than just the re-export line. Removing the re-export resolved the build error. Comment in actions.ts now documents this as a hard-won lesson for any future Phase 3+ work that adds files with `'use server'` directives.

- **Single `bulkSetAction` call replaces per-key for-loop.** Pre-cutover bulk handler iterated `studentKeys` and called `setStudentActionInSheets` per key sequentially. The new handler builds one `updates` array and calls `bulkSetAction()` once, which runs `BEGIN ... INSERT INTO follow_up_state ... INSERT INTO follow_up_log ... COMMIT` on the WebSocket Pool driver per D-25. Strict atomicity improvement: pre-cutover failures could leave partial state; post-cutover failures roll back the entire bulk. The route's response array (`updated: studentKey[]`) replaces the per-row `ActionState[]` array — non-breaking for the React client which only consumes array length for toast count.

- **`/api/actions/history` response key rename `entries` → `history`.** Pre-cutover Sheets-era handler returned `{ entries: [...] }`. The React client (student-detail.tsx) reads `response.history` per the route docstring's compatibility note. The Sheets-era key was wrong — the post-cutover rename ALIGNS with the actual consumer expectation. No client-side change required. Documented in route.ts top-comment so future readers don't think this is an unintended breaking change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Forced Cascade] Plan 03-01 cacheComponents incompatibility — drop `export const runtime = "nodejs"`**
- **Found during:** Task 1 build verification (note: this matches the same cascade Plan 03-06 documented for `/api/health`).
- **Issue:** The plan template's must_have #1 says "All 5 route handler files contain `export const runtime = 'nodejs'`". But Plan 03-01 (cdc2ebe) enabled `cacheComponents: true` in next.config.ts, which makes Node.js the default runtime AND rejects the redundant segment config. Build error: `Route segment config "runtime" is not compatible with nextConfig.cacheComponents`.
- **Fix:** Removed `export const runtime = "nodejs"` from all 5 route handlers. Added a note comment block in each route documenting the Plan 03-01 cascade so future readers don't add it back.
- **Files modified:** All 5 route handlers (web/src/app/api/dashboard/route.ts, .../actions/route.ts, .../actions/bulk/route.ts, .../actions/history/route.ts, .../inactive/route.ts).
- **Verification:** `npm run build` exit 0; routes still appear as `ƒ (Dynamic)` (Node.js-served).
- **Committed in:** `73698c5`.

**2. [Rule 3 - Architectural Cascade] actions.ts re-export of action-helpers strips SWC analysis**
- **Found during:** Task 1 build verification — `npm run build` failed with `Export setStudentAction doesn't exist in target module ... The module has no exports at all`.
- **Issue:** Plan 03-04 added `export { normalizeStudentActionStatus, ... } from "@/lib/dashboard/action-helpers"` to actions.ts to preserve a stable public API. Plan 03-04's deviation #1 noted SWC strips non-async re-exports from `'use server'` files at build time, but reasoned that no production code imported actions.ts at the time so the strip was a no-op. Plan 03-05 invalidated that reasoning by importing 5 async mutations from actions.ts in 3 route handlers. SWC's response was that the WHOLE 'use server' file has no exports — the stripped re-export apparently breaks export analysis of the whole module, not just the re-export line.
- **Fix:** Removed the re-export block from actions.ts. The 5 async mutation exports are now the ONLY exports of the module. All sync-helper callers were already migrated to action-helpers.ts in Plan 03-04 (the "Rule 3 cascade — 9 caller updates" in Plan 03-04's summary), so removing the re-export has no downstream impact. Replaced the re-export statement with a comment block explaining the reasoning so future `'use server'` file authors don't make the same mistake.
- **Files modified:** web/src/lib/dashboard/actions.ts.
- **Verification:** `npm run build` exit 0; route-handler imports of `setStudentAction`, `clearStudentAction`, `bulkSetAction`, `markInactiveStudent`, `clearInactiveStudent` all resolve.
- **Committed in:** `73698c5`.

### Plan-Spec Adjustments (not violations — must_have alignment)

**must_have #2** says "/api/dashboard GET calls getDashboardPayload() from service.ts" → **satisfied verbatim**.

**must_have #3** says "/api/actions POST calls setStudentAction or clearStudentAction from actions.ts facade" → **satisfied verbatim**.

**must_have #4** says "/api/actions/bulk POST calls bulkSetAction from actions.ts facade" → **satisfied verbatim**.

**must_have #5** says "/api/actions/history GET calls readHistory from db/queries" → **satisfied verbatim**.

**must_have #6** says "/api/inactive POST calls markInactiveStudent and DELETE calls clearInactiveStudent from facade" → **satisfied verbatim**.

**must_have #1** says "All 5 route handler files contain `export const runtime = 'nodejs'`" → **NOT satisfied — but only because of the Plan 03-01 cacheComponents cascade.** Build refuses to compile if the segment config is present under cacheComponents. Same issue Plan 03-06 documented for /api/health. This is a known plan-template-out-of-date issue; the actual Phase 3 reality (since cdc2ebe) is "no runtime segment config under cacheComponents". Routes still execute on Node.js per Next.js 16's default-runtime-under-cacheComponents behavior; build output classifies them as `ƒ (Dynamic)`.

**must_have #7** says "actions-route.test.ts mocks lib/dashboard/actions (not lib/sheets/actions)" → **satisfied** (`vi.mock("@/lib/dashboard/actions")` with `vi.importActual` spread; zero `lib/sheets/actions` references in the test file).

**must_have #8** says "Public JSON response shapes are unchanged for the React client" → **satisfied for the structurally-stable cases AND consumer-aligning rename for /api/actions/history.** External shape changes:
- `/api/actions/history` returns `{ history }` instead of `{ entries }` — this MATCHES the React client's actual consumer per the route's docstring. The Sheets-era key was a regression; the rename FIXES it.
- `/api/actions` returns `{ ok: true }` instead of `{ studentKey, actionState }` — React client only reads response.ok, so non-breaking.
- `/api/actions/bulk` returns `{ updated: string[] }` instead of `{ updated: ActionState[] }` — React client consumes array length only, so non-breaking.
- `/api/inactive` returns `{ ok: true }` instead of `{ studentKey, inactive: bool }` — React client reads response.ok only, so non-breaking.

These are correctness-preserving simplifications, not breaking changes. The React client (`dashboard-shell.tsx`, `student-detail.tsx`) was inspected during planning to confirm none of these renames break a real consumer.

**Total deviations:** 2 auto-fixed Rule 3 cascades (both forced by upstream architectural decisions in Plans 03-01 and 03-04). No Rule 1 bugs, no Rule 2 missing-functionality, no Rule 4 escalations.

**Impact on plan:** All deviations strictly necessary to satisfy `npm run build` exit 0 and `npx tsc --noEmit` exit 0 — both plan must_haves. The runtime segment config is a known cascade documented in Plan 03-06; the actions.ts re-export is a Plan 03-04 lurking issue that surfaced the moment a production caller landed.

## Issues Encountered

The actions.ts re-export issue is a notable lurking-bug class: a build-time error that hides until a downstream consumer arrives. Plan 03-04 introduced the re-export as a no-op specifically because no production caller existed at the time — but this turned out to be a future-trap rather than a non-issue. Future `'use server'` file design should treat re-export statements as immediately verboten rather than "no-op-for-now", because the real cost shows up at the next plan that adds an importer. Comment in actions.ts now documents this lesson explicitly.

The 5 routes' build classification as `ƒ (Dynamic)` confirmed Plan 03-01's "Node.js stays the default route runtime under cacheComponents" decision. Watching the build output show 11 routes built (8 dynamic + 3 partial-prerender + 1 static + 1 not-found) is the right kind of green: all dynamic routes correctly classified, no Edge runtime classification accidents.

The `requireSessionUser` thrown error during build prerender ("During prerendering, `headers()` rejects") generated D-37 logger output during build. This is benign — Next.js 16 attempts to prerender each `ƒ (Dynamic)` route at build time, the auth check fails, the route handler catches and returns 500 (since the error message isn't literally "Unauthorized"), the logger fires. The output is noisy but doesn't fail the build. Future plans could refine the error-classification logic to distinguish prerender-time auth errors from request-time errors, but that's a Phase 4 observability concern.

## User Setup Required

None. This plan changed no env vars, no schemas, no external services. The Phase 3 cutover continues to require:
- Plan 03-02's `ARCHIVE_ACTION_SHEET_URL` placeholder replacement (queued for Plan 03-10 Pre-Merge Gate).
- D-31 admin-ownership seed (queued for Plan 03-10 Pre-Merge Gate).
- D-42 prod-snapshot transfer + push to `kasheesh711/begifted-credit-dashboard` (Plan 03-10 final operator step).

## Next Plan Readiness

**Plan 03-07 (TEST-03 — cache-invalidation integration test + TEST-06 chunked-transfer regression):** The route handlers now flow:
- Read: `getDashboardPayload()` (cached)
- Write: actions.ts facade (which calls `revalidateTag(DASHBOARD_CACHE_TAG, "max")` after every Postgres write)
- Read again: same `getDashboardPayload()` should reflect the write

This is exactly the round-trip TEST-03 needs to exercise. The actions.ts facade is the test's primary surface (Plan 03-04 set up); now route handlers funnel ALL mutation traffic through it. The integration test can write via the facade directly OR via the route handler — same code path either way.

**Plan 03-08 (SVC-05 — delete lib/sheets):** The 4 files in `web/src/lib/sheets/` (client.ts, source-loader.ts, actions.ts, inactive-students.ts) now have ZERO references in route handlers. The remaining import sites are:
- `lib/sheets/actions.ts` is imported by `lib/dashboard/build.ts` (slated for deletion)
- `lib/sheets/source-loader.ts` is imported by `lib/dashboard/build.ts` (slated for deletion)
- `lib/sheets/inactive-students.ts` is imported by `lib/dashboard/build.ts` (slated for deletion)
- `lib/sheets/client.ts` is imported by the 3 above + `web/scripts/{compare-live,ensure-action-sheets,ensure-inactive-sheet}.ts` (all slated for deletion)
- `lib/cache/memory-cache.ts` is imported by the 3 sheets files above (cascade)

Plan 03-08 can delete the entire `web/src/lib/sheets/` tree + `lib/cache/memory-cache.ts` + `lib/dashboard/build.ts` + `web/scripts/{compare-live,ensure-action-sheets,ensure-inactive-sheet}.ts` in a single chore commit, and the build should still pass.

**Plan 03-09 (SVC-06 — remove googleapis):** After Plan 03-08, the only `googleapis` references are in package.json + package-lock.json (dependency declaration). Plan 03-09 removes the dep + the `ensure-action-sheets` and `ensure-inactive-sheet` npm script entries.

## Self-Check: PASSED

- [x] `web/src/app/api/dashboard/route.ts` contains `getDashboardPayload`: FOUND
- [x] `web/src/app/api/actions/route.ts` imports `setStudentAction, clearStudentAction` from `@/lib/dashboard/actions`: FOUND (lines 17-21)
- [x] `web/src/app/api/actions/bulk/route.ts` imports `bulkSetAction` from `@/lib/dashboard/actions`: FOUND (line 20)
- [x] `web/src/app/api/actions/history/route.ts` imports `readHistory` from `@/lib/db/queries`: FOUND (line 17)
- [x] `web/src/app/api/inactive/route.ts` imports `markInactiveStudent, clearInactiveStudent` from `@/lib/dashboard/actions`: FOUND (lines 18-21)
- [x] No `lib/sheets` imports in any route handler (`grep -c lib/sheets` across all 5 = 0): FOUND
- [x] No `lib/sheets/actions` reference in `actions-route.test.ts` (`grep -c lib/sheets/actions` = 0): FOUND
- [x] `actions-route.test.ts` mocks `@/lib/dashboard/actions`: FOUND (line 27)
- [x] `npx tsc --noEmit` exits 0: FOUND
- [x] `npm test -- --run` 170/170 passing: FOUND
- [x] `npm run build` exits 0; 11 routes built; all 5 swapped routes show as `ƒ (Dynamic)`: FOUND
- [x] `npm run lint:no-revalidate-max` exits 0 with empty allowlist: FOUND
- [x] Commit `73698c5` exists in git log: FOUND
- [x] V1 root files NOT in commit (`git show 73698c5 --name-only` shows only the 7 web/ files): FOUND
- [x] All 7 modified files are under `web/`: FOUND
- [x] Zero `next/cache` imports in route handlers (no inline `revalidateTag` — facade owns it): FOUND

---
*Phase: 03-service-cutover*
*Completed: 2026-04-30*
