---
phase: 02-data-layer
plan: 07
subsystem: testing
tags: [vitest, validation-parity, tdd, pending-deduction, projection, should-credit-drop]

requires:
  - phase: 02-01
    provides: Baseline vitest suite + fixture directory + REQUIRED_COLUMNS baseline
provides:
  - "9 Validation.gs ports for packages domain (exclusion keywords, admin ownership, duplicate merge, data-quality flags, nodata fallback)"
  - "4 Validation.gs ports for projection domain (ALERT_THRESHOLD boundary, NOTIFY_WINDOW_DAYS boundary, priority score ordering, weekly buckets)"
  - "4 pending-deduction domain tests: 1 PORT + 2 REWRITE (per D-05 Should_Credit drop) + 1 DB-05 same-day visibility gate"
  - "Inline port of buildWeeklyBuckets from DashboardAnalytics.gs to web/src/lib/dashboard/analytics.ts (20 lines, Rule 2 deviation)"
  - "Explicit enumeration of 17 Apps Script-specific assertions NOT ported (stay in Validation.gs until Phase 5)"
  - "Explicit DROP comment for testPendingDeductionUsesShouldCreditWhenAvailable (D-05 — Should_Credit branch removed)"
affects: [02-08 (batch B: queue + calendar), 02-09 (CI DB migrate), 03-xx (service cutover — these tests must stay green against Wisenet-mapper-derived DashboardSources)]

tech-stack:
  added: []
  patterns:
    - "Inline snapshot() helper pattern from dashboard-logic.test.ts — reused verbatim in all 3 new files"
    - "Validation.gs line-citation pattern — every ported test comments its Validation.gs:<line> source for traceability"
    - "D-05 policy documentation pattern — inline // DROPPED per D-05 and // REWRITE per D-05 comments explain the original assertion intent + how the post-D-05 path expresses it"
    - "17-item NOT-PORTED enumeration block in the domain file most naturally owning the carve-out (pending-deduction.test.ts header)"

key-files:
  created:
    - web/src/test/packages.test.ts
    - web/src/test/projection.test.ts
    - web/src/test/pending-deduction.test.ts
  modified:
    - web/src/lib/dashboard/analytics.ts (added buildWeeklyBuckets + WeeklyBucket type)

key-decisions:
  - "Ported buildWeeklyBuckets inline (Rule 2 deviation) — the assertion cannot test a function that does not exist; porting the 20-line utility from DashboardAnalytics.gs was simpler than substituting a different parity gate and keeps the TS side 1:1 with Apps Script semantics"
  - "Test organization: 9 ports in packages.test.ts, 4 ports in projection.test.ts, 4 ports (1 PORT + 2 REWRITE + 1 DB-05 PORT) in pending-deduction.test.ts — matches plan truths frontmatter exactly"
  - "17 Apps Script carve-outs enumerated in pending-deduction.test.ts header (rather than a separate README) — the carve-outs are conceptually bound to the pending-deduction + action-state domain and stay co-located with the ported subset"
  - "DROP assertion testPendingDeductionUsesShouldCreditWhenAvailable documented as an inline comment block in pending-deduction.test.ts rather than as a skipped test — per D-05, the Should_Credit column is GONE from the dashboard, so there is no code path to skip-test"
  - "REWRITE assertion testPendingDeductionFallsBackToDurationWhenShouldCreditMissing keeps the original numeric expectation (1.3 from 78-min) — the post-D-05 behavior IS the same duration-based calculation that the Apps Script fallback branch did; only the framing changes (primary branch, not fallback)"
  - "REWRITE assertion testConsumedCreditsDoNotDoubleDeduct — the D-08 `credits_consumed === 0` guard in shouldCountAsPendingDeduction is preserved; the 2nd row with credits_consumed=1 is naturally filtered out, producing the 1-credit expectation without any Should_Credit involvement"

patterns-established:
  - "Per-port Validation.gs line citation comment — every ported test carries // Port of testXxx (Validation.gs:<line>) for future auditors"
  - "D-05 policy annotation — DROPPED / REWRITE / PORT labels in commit messages and file headers make the policy visible to future milestone readers"
  - "Pre-existing tsc errors in dashboard-logic.test.ts are flagged as unrelated-to-this-plan in commit messages and SUMMARY — prevents misattribution"

requirements-completed:
  - TEST-01
  - DB-05

duration: 12min
completed: 2026-04-21
---

# Phase 2 Plan 07: Validation.gs Port Batch A Summary

**17 Validation.gs parity tests (9 packages + 4 projection + 4 pending-deduction) ported to Vitest with full D-05 Should_Credit-drop compliance, 17 Apps Script-specific assertions enumerated as NOT ported, and 1 inline port of buildWeeklyBuckets.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-21T18:05Z
- **Completed:** 2026-04-21T18:17Z
- **Tasks:** 3
- **Files created:** 3 (packages.test.ts, projection.test.ts, pending-deduction.test.ts)
- **Files modified:** 1 (analytics.ts — added buildWeeklyBuckets + WeeklyBucket type)

## Accomplishments

- 17 plan-scope tests pass across 3 new files (9 + 4 + 4)
- Full web/ test suite: 49/49 tests passing (was 32/32 before this plan; +17 from this plan)
- tsc --noEmit: clean on all 3 new files + analytics.ts (only pre-existing dashboard-logic.test.ts errors remain, unchanged)
- 3 critical VALIDATION.md parity gates exercised: exclusion keywords, admin ownership majority vote, D-08 composite rule
- 2 projection parity gates: ALERT_THRESHOLD=2 strict-below, NOTIFY_WINDOW_DAYS=30 inclusive
- DB-05 same-day visibility preservation validated via sanitizeStudentActionState
- D-05 policy correctly applied — 1 DROP + 2 REWRITE + 14 straight PORTs across the 3 files

## Task Commits

Each task was committed atomically:

1. **Task 1: packages.test.ts — 9 ports** — `700084f` (test)
2. **Task 2: projection.test.ts — 4 ports + buildWeeklyBuckets port** — `e8ca424` (test + Rule 2 deviation)
3. **Task 3: pending-deduction.test.ts — 4 tests + 17 not-ported enumeration** — `64fff2a` (test)

_Note: TDD tasks on parity ports collapsed the RED/GREEN cycle because all ported tests exercise already-shipping business logic — the tests validate what the TS port already does. No implementation drift was found._

## Files Created/Modified

- `web/src/test/packages.test.ts` (NEW, 262 lines) — 9 tests covering `buildExcludedPackageReasons`, `buildStudentAdminOwnershipMap`, `buildDashboardStudents` (ownership fallback, duplicate merge, low-balance flag, nodata status)
- `web/src/test/projection.test.ts` (NEW, 152 lines) — 4 tests covering `computeProjection` threshold boundaries, `computePriorityScore` ordering, `buildWeeklyBuckets` grouping
- `web/src/test/pending-deduction.test.ts` (NEW, 203 lines) — 4 tests covering `buildPendingDeductionContext` D-08 rule, 2 REWRITE scenarios, `sanitizeStudentActionState` DB-05 gate, plus 17-item NOT-PORTED enumeration and 1-item DROPPED comment
- `web/src/lib/dashboard/analytics.ts` (MODIFIED) — added `WeeklyBucket` interface + `buildWeeklyBuckets` function ported 1:1 from DashboardAnalytics.gs:612

## Decisions Made

See key-decisions frontmatter. Summary:

- **Rule 2 port of `buildWeeklyBuckets`** — the function did not exist in the TS dashboard layer but the plan's 4th projection test required it. Inline port (20 lines) keeps the parity test green without substituting a different assertion and accepts the marginal cost (the WeeklyBucket UI isn't wired yet, but Phase 3 / future OPS work may consume this).
- **17 Apps Script carve-outs enumerated in pending-deduction.test.ts header** rather than a separate file — the carve-outs are conceptually about action-state persistence + chunked cache transfer, which is the closest living relative of the pending-deduction domain (action state gates surface visibility).
- **Test naming mirrors Validation.gs one-to-one** with line citations — an auditor reading one file can find the source assertion without context-switching.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Ported `buildWeeklyBuckets` inline**
- **Found during:** Task 2 (projection.test.ts)
- **Issue:** Plan acceptance required 4 tests including weekly bucket grouping via `buildWeeklyBuckets`, but the function had never been ported from `DashboardAnalytics.gs` to `web/src/lib/dashboard/analytics.ts`. Without the function, the parity test could not be expressed.
- **Fix:** Ported the 20-line utility from DashboardAnalytics.gs:612 verbatim into analytics.ts, adding a `WeeklyBucket` interface alongside. Semantics preserved: `(packageRows, dateField, today, numberOfWeeks) => WeeklyBucket[]` with W1/W2/W3 labels and `count` per window.
- **Files modified:** web/src/lib/dashboard/analytics.ts
- **Verification:** projection.test.ts "groups alertDate values into weekly buckets starting from today" passes with the expected 2/1/0 counts across 3 weeks.
- **Committed in:** e8ca424 (Task 2 commit)

**2. [Git workflow note, not a rule] analytics.ts committed as a newly-tracked file**
- **Found during:** Task 2 commit
- **Issue:** `web/src/lib/dashboard/analytics.ts` was untracked in the repo baseline (the whole `web/src/lib/dashboard/` directory was untracked per `git status`). Staging the file made git interpret it as a brand-new file, so the Task 2 commit shows +685 lines rather than +34 lines.
- **Impact:** None on correctness — the pre-existing 651 lines of analytics.ts were already on disk; the commit simply brings them into version control alongside the buildWeeklyBuckets addition. Future commits will show focused diffs.
- **No action needed** — noted for auditor clarity.

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical functionality)
**Impact on plan:** The Rule 2 port was essential to satisfy the plan's 4th projection test; the 20-line addition is a direct Apps Script-to-TS mirror and carries zero architectural change. No scope creep.

## Issues Encountered

- **`testWatchWindowBoundaryAtThirtyDays` boundary math verified** — the TS projection code `daysUntilAlert <= NOTIFY_WINDOW_DAYS` inclusive check matches Apps Script; balance=2.5 + 60-min session 30 days out produces status="watch" and daysUntilAlert=30.
- **`computePriorityScore` signature differs from plan sketch** — plan assumed `PackageRecord` input but TS takes `PackageRow` + riskyCount + prevStatus + balanceDelta. Adapted test fixture builder inline (`buildPackageRow(overrides)`) rather than calling the (Apps Script-only) `createPackageRecord + finalizePackageRecord` chain. Preserves intent.
- **`compareStudentQueueRows` is not exported** from analytics.ts — the plan sketch called for using it, but the direct computePriorityScore test exercises the same ordering invariant. No coverage loss.

## 17 Apps Script Not-Ported Assertions

Listed in pending-deduction.test.ts header (`/web/src/test/pending-deduction.test.ts` lines 16-32). Copied here for reference:

1. testDashboardCacheHitReusesPayloadWithoutRebuild
2. testSetStudentActionPersistsAndClearsCache
3. testClearStudentActionKeepsHistoryButRemovesVisibleState
4. testBulkSetStudentActionUpdatesMultipleStudents
5. testStudentActionActorFallsBackToNullForAllView
6. testStudentActionHistoryTrimsToLimit
7. testChunkedCacheRoundTripPreservesLargePayload
8. testDashboardTransferChunkedCacheHitSkipsPayloadLoad
9. testDashboardTransferManifestUsesChunkedMode
10. testDashboardTransferCacheMissReturnsChunkedAfterCaching
11. testDashboardTransferCacheMissFallsBackInlineWhenManifestMissing
12. testDashboardTransferChunkBatchReadsOrderedSlices
13. testDashboardTransferChunkBatchHandlesFinalPartialBatch
14. testDashboardTransferChunkBatchRecoversWhenManifestMissing
15. testDashboardTransferChunkBatchRecoversWhenPartMissing
16. testDashboardTransferChunkBatchRejectsInvalidRange
17. testDashboardTransferChunkReadsStoredChunk

These exercise Apps Script-specific primitives (CacheService chunked manifests under `BG_DASHBOARD_PAYLOAD_V2::`, PropertiesService prefix-scoped reads under `BG_ACTION_V1::`, chunked transfer protocol via `beginDashboardDataTransfer` / `fetchDashboardDataChunkBatch`) with no Next.js analogue. They stay in `Validation.gs` until Phase 5 archives the Apps Script sources.

## Dropped + Rewritten Tests

**1 DROP + 2 REWRITE per D-05 policy.**

### DROPPED: testPendingDeductionUsesShouldCreditWhenAvailable (Validation.gs:1113)
- Documented as inline comment block in pending-deduction.test.ts header
- Rationale: D-05 drops the `Should_Credit` column entirely from the dashboard. The assertion's entire purpose was to validate that `Should_Credit` priority-overrides session_duration — a code path that no longer exists. Cannot be skipped; must be dropped.

### REWRITE: testPendingDeductionFallsBackToDurationWhenShouldCreditMissing (Validation.gs:1163)
- Original: exercised the fallback branch when `Should_Credit` was empty
- Rewrite: removes `Should_Credit=1.5` from inputs; asserts session_duration as the NOW-PRIMARY branch with the same 1.3-credit expectation (78-min / 60 rounded to 0.1)
- The numeric expectation is byte-identical; only the framing changes ("primary branch" vs "fallback branch")

### REWRITE: testConsumedCreditsDoNotDoubleDeduct (Validation.gs:1213)
- Original: included `Should_Credit=1` on both rows, expected no double-deduct
- Rewrite: removes `Should_Credit` input; relies solely on the D-08 `credits_consumed === 0` guard in `shouldCountAsPendingDeduction`. Row 1 (credits_consumed=0) counts (1 credit); row 2 (credits_consumed=1) does not. Total = 1, same expectation as Apps Script.

## Remaining Validation.gs Ports (Plan 02-08)

Batch B (3 of 41 remaining Validation.gs ports belong to 02-08):
- `queue.test.ts` — testStudentQueueRollsUpPackagesIntoOneRow, testPinnedStudentsSortAheadOfOtherRisk, testDashboardModelMergesStudentActionStateIntoStudentsAndQueue, testSummaryDeltasCompareAgainstPreviousSnapshot (4 tests)
- `calendar.test.ts` — testCalendarGroupsStudentSessionsByDay (1 test, plus possibly weekly-related helpers)

Plus 1 cache-miss test (`testDashboardCacheMissBuildsAndCachesPayload`) — that's a Next.js `unstable_cache` port, likely deferred to Phase 3 service cutover per D-23.

**Net Validation.gs port progress:**
- Completed this plan (02-07): 17 tests (14 PORT + 2 REWRITE + 1 DROP documentation). This closes the packages + projection + pending-deduction domains.
- Plan 02-08 remaining: ~5 tests (queue + calendar domains)
- 17 never ported (Apps Script carve-outs): enumerated in pending-deduction.test.ts
- Total in Validation.gs after this plan: 17 stayed (never-ported) + 1 dropped + 5 remaining for 02-08 = 23 of the original 41 "still live" in Apps Script, with 17 ported into Vitest.

## Next Phase Readiness

- **Plan 02-08 unblocked:** batch B (queue.test.ts + calendar.test.ts) can proceed against the same snapshot() helper pattern and inline fixture-builder convention established here.
- **Phase 3 service-cutover prerequisite partially met:** TEST-01 parity coverage for the packages + projection + pending-deduction domains now fails if Phase 3 mapper refactor drifts the business rules. Queue + calendar coverage lands in 02-08.
- **No blockers** — full suite green, tsc clean on new files, all commits atomic per plan task.

## Self-Check: PASSED

- `web/src/test/packages.test.ts` — FOUND
- `web/src/test/projection.test.ts` — FOUND
- `web/src/test/pending-deduction.test.ts` — FOUND
- `web/src/lib/dashboard/analytics.ts` buildWeeklyBuckets — FOUND (verified via grep)
- Commit `700084f` (packages) — FOUND
- Commit `e8ca424` (projection + buildWeeklyBuckets) — FOUND
- Commit `64fff2a` (pending-deduction) — FOUND
- 17 tests pass: `cd web && npm test -- --run src/test/packages.test.ts src/test/projection.test.ts src/test/pending-deduction.test.ts` — PASS (9 + 4 + 4)
- Full suite: `cd web && npm test -- --run` — PASS (49/49)
- tsc clean on new files — PASS (only 2 pre-existing dashboard-logic.test.ts errors remain)

---
*Phase: 02-data-layer*
*Completed: 2026-04-21*
