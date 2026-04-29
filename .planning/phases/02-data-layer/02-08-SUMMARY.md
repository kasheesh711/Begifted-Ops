---
phase: 02-data-layer
plan: 02-08
subsystem: testing

# Dependency graph
requires:
  - phase: 02-data-layer
    provides: "Plan 02-07 TEST-01 batch A (packages/projection/pending-deduction, 17 tests) + prior Phase 2 plans (02-01/02/03/05/06) shipped buildWeeklyBuckets, packages.ts pipeline, analytics.ts buildSummaryDeltas"
provides:
  - "queue.test.ts — 4 TEST-01 ports for StudentQueueRow rollup, pinned-first ordering, action-state merge, DB-05 same-day visibility integration"
  - "calendar.test.ts — 3 TEST-01 ports (day grouping, summary deltas, D-23 cache-miss build path) + 1 T-02-35 null-prior guard"
  - "TEST-01 port surface complete: 24 assertions ported across 5 files (packages 9 + projection 4 + pending-deduction 4 + queue 4 + calendar 3) matching Validation.gs parity count minus D-05 drop/rewrite carve-outs"
  - "Phase 5 unblock: Validation.gs is now fully mirrored in Vitest where business rules map 1:1; remaining 17 assertions are Apps Script-specific infrastructure that retires with the .gs layer"
affects:
  - phase-03-service-cutover (service.ts rewire has Vitest parity coverage — no Apps Script dependency for testing business rules)
  - phase-05-apps-script-retirement (Validation.gs can be archived once Phase 3 ships; TS tests are the parity spec)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-20 parametric describe.each + inline buildFixture*() helpers mirroring Validation.gs idiom"
    - "Pipeline-driven end-to-end tests threading SheetSnapshot fixtures through packages.ts → analytics.ts (buildActiveStudentSet → buildExcludedPackageReasons → buildStudentAdminOwnershipMap → buildPendingDeductionContext → buildUpcomingSessionMap → buildDashboardStudents → attachActionStatesToStudents → buildDashboardModel)"
    - "D-23 cache-miss carve-out: test adapted to BUILD-path assertion only (fresh payload shape + snapshotState emission) because no cache exists in Phase 2"

key-files:
  created:
    - web/src/test/queue.test.ts
    - web/src/test/calendar.test.ts
  modified: []

key-decisions:
  - "Cache-miss test adapted per D-23 — no cache in Phase 2; assertion scope restricted to buildDashboardModel BUILD path (all top-level payload fields + emitted snapshotState.lastSnapshot). Phase 3 service.ts rewire lands the cache-mutation assertions against the new use-cache-remote surface."
  - "Queue tests drive the real packages.ts → analytics.ts pipeline via a co-located runPipeline(fixtures, today) helper instead of hand-constructing StudentRecord objects — matches dashboard-logic.test.ts idiom and catches any drift in the pipeline contract"
  - "T-02-35 null-prior guard added as a 4th calendar assertion beyond the 3 required ports — covers the cold-start/first-run case where buildSummaryDeltas(current, null) must return all-null without throwing"
  - "DB-05 parity integration variant added to queue.test.ts — the unit-level sanitize assertion lives in pending-deduction.test.ts (Plan 02-07), this file proves the same contract end-to-end through the attach → buildStudentQueueRow → cloneActionState chain"

patterns-established:
  - "Snapshot fixture header constants (AGG_HEADERS, CC_HEADERS, UPCOMING_HEADERS, etc.) declared once per test file, reused across test cases — reduces copy-paste drift vs Validation.gs's inline array literals"
  - "runPipeline(fixtures, today) helper centralizes the 7-step data-loader chain so each test body stays focused on the assertion and semantic intent rather than pipeline plumbing"

requirements-completed:
  - TEST-01

# Metrics
duration: 3m 39s
completed: 2026-04-22
---

# Phase 2 Plan 02-08: Validation.gs port batch B (queue + calendar) Summary

**Closed TEST-01 by porting the final 7 Validation.gs assertions — 4 queue tests (rollup, pinned-first ordering, action-state merge, DB-05 same-day visibility) and 3 calendar tests (day grouping, summary deltas, D-23-adapted cache-miss build path) — producing 86/86 green Vitest suite and a 24-assertion TS parity spec that unblocks Phase 5 Validation.gs archival.**

## Performance

- **Duration:** 3m 39s
- **Started:** 2026-04-22T03:55:54Z
- **Completed:** 2026-04-22T03:59:33Z
- **Tasks:** 2 (both TDD-structured: write failing fixture → run against real pipeline → green on first attempt)
- **Files created:** 2
- **Files modified:** 0

## Accomplishments

- **TEST-01 port surface complete** — 24 assertions ported across 5 Vitest files (packages 9 + projection 4 + pending-deduction 4 + queue 4 + calendar 3) matching the `Validation.gs` parity count minus D-05's 1 drop + 2 rewrites
- **Queue tests prove pipeline integrity end-to-end** — all 4 queue tests thread `SheetSnapshot` fixtures through the real `packages.ts` data-loader chain (`buildActiveStudentSet` → ... → `buildDashboardStudents`) and then `buildDashboardModel`, catching any drift between the fixture loader and the analytics layer
- **DB-05 same-day visibility covered at two layers** — unit-level `sanitizeStudentActionState` assertion lives in `pending-deduction.test.ts` (Plan 02-07); integration variant in `queue.test.ts` proves yesterday's action state never reaches `StudentQueueRow.actionState` through the attach → clone chain
- **D-23 cache-miss carve-out documented in-test** — the cache-miss adaptation is called out with an inline 9-line comment block referencing `.planning/phases/02-data-layer/02-CONTEXT.md §D-23`; Phase 3 service.ts rewire can port the cache-mutation assertion against `use cache: remote` + `cacheTag` once the cache surface exists
- **T-02-35 null-prior guard** — added beyond the 3 required calendar ports to cover `buildSummaryDeltas(current, null)` cold-start behavior; proves every delta field returns `null` without throwing when no previous snapshot exists

## Task Commits

Each task was committed atomically:

1. **Task 1: queue.test.ts** — `7b12053` (test) — 4 ports (rollup, pinned-first, action-state merge, DB-05 integration)
2. **Task 2: calendar.test.ts** — `8aaa895` (test) — 3 ports + T-02-35 guard (day grouping, deltas, D-23 cache-miss build path)

**Plan metadata:** TBD (appended as final commit after SUMMARY + STATE + ROADMAP updates)

## Files Created/Modified

- `web/src/test/queue.test.ts` — 4 TEST-01 ports for queue domain; includes co-located `runPipeline()` helper that threads 6 snapshot fixtures (students / students & courses / remaining credits / aggregations / credit_control / upcoming) through the real packages.ts → analytics.ts call path; uses inline header constants to reduce drift
- `web/src/test/calendar.test.ts` — 3 TEST-01 ports for calendar/summary domain + 1 T-02-35 null-prior guard; `buildSummaryDeltas` exercised as a pure function (no pipeline needed), while calendar day grouping + D-23 cache-miss use the same pipeline helper as queue.test.ts for shape consistency

## Decisions Made

1. **Pipeline-driven fixtures over hand-constructed StudentRecord objects** — The Apps Script `Validation.gs` tests hand-construct `students` arrays via `finalizePackageRecord(createPackageRecord(...))`. Since neither `finalizePackageRecord` nor `createPackageRecord` is exported from the TS `packages.ts`, the tests use the real `buildDashboardStudents(aggregations, activeStudents, excluded, pending, scheduled, today, ownership)` pipeline driven by `SheetSnapshot` fixtures — matching `dashboard-logic.test.ts` idiom. This catches pipeline drift that hand-constructed records would mask.

2. **T-02-35 null-prior guard added beyond 3 required calendar ports** — Plan acceptance criteria says "≥ 3 it()" for `calendar.test.ts`; we shipped 4. The 4th is the first-run cold-start case `buildSummaryDeltas(current, null)` which isn't in `Validation.gs` (Apps Script always passes a previous summary from its in-process fixture, never null). Added here to cover Phase 3 cold-start behavior before any snapshot lands.

3. **DB-05 integration variant in queue.test.ts (not duplicated from pending-deduction.test.ts)** — Plan 02-07's `pending-deduction.test.ts` already covers the unit-level `sanitizeStudentActionState` call. This file's 4th queue test covers the same contract at the integration layer: `attachActionStatesToStudents` → `StudentRecord.actionState=null` (because sanitizer drops yesterday) → `buildStudentQueueRow` → `cloneActionState(null)=null`. Different layer, same invariant.

## Deviations from Plan

### Plan-vs-actual signature adaptations

The plan template illustrated a fictional API (`buildDashboardModel(dashboardStudents, { today, adminOwnership, previousSnapshot })` with options bag; `buildDashboardStudents(aggregations, { activeStudents, excluded, pending, scheduled, ownership })` also options-bag; `buildStudentPackageKey`-derived `studentKey` normalization). The TS implementation uses positional arguments:

- `buildDashboardModel(students, snapshotState, today, now)` — where `snapshotState` is `{ lastSnapshot, history }`, not an options bag
- `buildDashboardStudents(aggregationsSnapshot, activeStudents, excluded, pending, scheduled, today, adminOwnershipMap)` — 7 positional args
- `buildSummaryDeltas(currentSummary, previousSummary | null)` — takes `SummaryPayload`, not `PersistedSnapshotState`
- `attachActionStatesToStudents(students, today, actionStateMap)` — mutates in place, no return

Test bodies adapted to the real signatures verbatim from `web/src/lib/dashboard/analytics.ts` and `web/src/lib/dashboard/packages.ts`. Semantic intent of all 7 Validation.gs ports preserved — queue rollup, pinned ordering, action-state merge, day grouping, summary deltas with decimals, null-prior first-run safety, fresh-payload build path with snapshotState emission.

**Classification:** Not a deviation per the rule dictionary — the plan file explicitly says "Executor note: buildDashboardStudents signature and option shape may differ slightly; adapt by reading the current module. The test bodies' semantic intent ... must be preserved." This is planned-for adaptation, not scope change.

### Stub tracking

No stubs introduced. Both test files are complete — every assertion drives real TS functions, no placeholders, no mock data flowing to UI rendering (these are unit/integration tests, not UI code).

### Threat flags

No new threat surface. Both test files are pure fixture-driven assertions with zero network, database, or filesystem I/O. No auth paths, schema changes, or trust boundary shifts.

---

**Total deviations:** 0 auto-fixed. Plan template's fictional signatures were pre-acknowledged by the plan itself as requiring adaptation.
**Impact on plan:** Plan executed exactly as scoped. Expanded from 7 ports to 8 it() calls (4 queue + 4 calendar including T-02-35 guard) — strictly additive.

## Issues Encountered

- **Heredoc commit-message escape with apostrophe** — First commit attempt used `git commit -m "$(cat << 'EOF' ... EOF)"` inside a single-quoted parameter; the outer single quotes + internal `'` broke eval parsing. Switched to `git commit -F /tmp/commit_msg_...txt` via a Write-created file. Consistent with Kevin's tooling quirk already documented in user memory: `gsd-tools.cjs commit --files X` ignores `--files`; use plain git add/commit for focused commits (applied here).

## Self-Check: PASSED

Verified both artifacts exist and both task commits are reachable:

- `web/src/test/queue.test.ts` — FOUND (347 lines, 4 `it()` blocks, commit `7b12053`)
- `web/src/test/calendar.test.ts` — FOUND (350 lines, 4 `it()` blocks, commit `8aaa895`)
- Task 1 commit `7b12053` — FOUND via `git log --oneline`
- Task 2 commit `8aaa895` — FOUND via `git log --oneline`
- D-23 comment reference — FOUND via `grep "D-23" web/src/test/calendar.test.ts`
- Full suite: **86/86 tests pass** (Phase 2 baseline 78 + 4 queue + 4 calendar)
- `npx tsc --noEmit` — exits 0 (no errors; no pre-existing dashboard-logic.test.ts errors remain either)

## Next Phase Readiness

- **TEST-01 closed in full.** 24 Validation.gs assertions ported to TS across 5 files, matching the Validation.gs parity count minus D-05's 1 drop + 2 rewrites. 17 Apps Script-specific assertions documented as NOT-ported (stay in Validation.gs until Phase 5 archives the .gs layer).
- **Phase 3 TEST-03 replaces the cache-miss mutation assertion.** This plan's `calendar.test.ts` covers the build path only; Phase 3 service.ts rewire will port `testDashboardCacheMissBuildsAndCachesPayload`'s full semantic (build-exactly-once + cache-metadata-write) against the new `use cache: remote` + `cacheTag('dashboard-payload', 'wisenet:students')` surface — which does not exist yet in Phase 2 per D-23.
- **Phase 2 remaining plans:** 02-04 (Wave 1 tail — WCLI-04 mappers), 02-09 (Wave 4 — TEST-05 Zod coercion + TEST-03 lint carve-out), 02-10 (Wave 4 — DB-08 migration runner + D-21 seed script).
- **No blockers.** Phase 2 tests green; Phase 3 can begin once 02-04 closes the mapper gap.

---
*Phase: 02-data-layer*
*Completed: 2026-04-22*
