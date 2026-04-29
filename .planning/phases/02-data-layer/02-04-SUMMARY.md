---
phase: 02-data-layer
plan: 04
subsystem: data-layer
tags: [wisenet, mappers, dashboard-sources, fixture-adapter, parity-gate, zod]

# Dependency graph
requires:
  - phase: 02-02
    provides: WisenetStudent / WisenetSession / WisenetStudentDetailResponse / WisenetClassResponse inferred types + Zod schemas (WisenetStudentsListSchema / WisenetSessionsListSchema / WisenetStudentDetailSchema) + wisenetFetch<T> chokepoint + MeetingStatusSchema enum
  - phase: 02-03
    provides: getStudents() / getStudent(id) / getParents(ids)→Map / getPastSessions(startDate,endDate) / getUpcomingSessions(startDate,endDate) — 7 resource functions from endpoints.ts (these are `Promise<T[]>` returning, not AsyncGenerator — consumed via Promise.all)
  - phase: 02-01
    provides: 6 PII-scrubbed Wisenet fixtures under web/src/test/fixtures/wisenet/ (real responses wrapped under .body)
  - existing
    provides: DashboardSources + SheetSnapshot contract (web/src/lib/dashboard/domain.ts); REQUIRED_COLUMNS per-tab headers; existing buildDashboardPayload / buildActiveStudentSet / buildExcludedPackageReasons / buildPendingDeductionContext / buildUpcomingSessionMap / buildDashboardStudents / buildDashboardModel pipeline
provides:
  - buildDashboardSourcesFromWisenet(today, options) — production network entry for Phase 3 service.ts
  - composeDashboardSourcesFromData(data, today, options) — pure function tests/Phase-3 fixtures use directly
  - coerceMeetingStatusToFinalStatus / durationMsToMinutes / shouldCountAsPendingDeductionWisenet / isActiveStudent — 4 unit-testable field transforms
  - resolveParentNames / fetchTeacherFeedback — production-only network helpers with p-limit(5) fan-out cap
  - 6 snapshot builders emitting exact REQUIRED_COLUMNS headers (Aggregations / Credit_Control / Upcoming Sessions / Students / Students & Courses / RemainingCredits)
  - D-05 enforcement: Should_Credit column header preserved, every row value ""
  - D-06 enforcement: RemainingCredits.Admin cell "" in Phase 2 (service.ts joins DB in Phase 3)
  - D-07 enforcement: Aggregations Current Remaining/Total Credits derived client-side from past ENDED session durations — session-count proxy for totalHours produces non-zero balance for fixtures with past data (FLAG-2 verified)
  - D-08 enforcement: shouldCountAsPendingDeductionWisenet composite rule (ENDED + empty feedback + duration > 0)
  - D-18 enforcement: 2-step parent join with p-limit(5) per-call scope
  - D-19 enforcement: teacher-feedback N+1 bounded by TEACHER_FEEDBACK_CONCURRENCY = 5
  - D-24 enforcement: fixture adapter helper delegates to composeDashboardSourcesFromData with no network mocking
  - TEST-02 parity describe block in dashboard-logic.test.ts running Wisenet-derived DashboardSources through the existing pipeline
affects: [03-service-cutover, 03-inactive-reactivation, 03-api-dashboard-route]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-entry mapper (Pitfall 7 mandatory refactor): production buildDashboardSourcesFromWisenet fans out network calls in parallel then delegates to pure composeDashboardSourcesFromData; tests call the pure function directly with hand-built or fixture data"
    - "Fixture-as-WisenetMapperData pattern: test helper unwraps probe-wrapper .body, parses through Zod, grafts detail fixture parentIds onto each list-student for parent-resolution tests"
    - "Snapshot builder shape discipline: every builder returns { sheetName, headerRowIndex:0, dataRowStartIndex:2, cols: <REQUIRED_COLUMNS index-map>, rows }"
    - "D-07 session-count proxy for totalHours: Math.max(past_ENDED_count + upcoming_count, consumedHours) so remainingHours is always >= 0 and consumed magnitude is fully represented — documented inline as the Phase 2 decision with Phase 3 upgrade path through sessionCredits"

key-files:
  created:
    - web/src/lib/wisenet/mappers.ts (598 lines — 2 entry points, 4 field transforms, 2 network helpers, 6 snapshot builders)
    - web/src/test/helpers/wisenet-to-dashboard-sources.ts (130 lines — loadWisenetFixtureSet + toDashboardSources, zero network)
    - web/src/test/wisenet-mappers.test.ts (355 lines — 36 tests covering transforms, D-08 parametric, isActiveStudent, snapshot shape, FLAG-2 non-zero Aggregations, D-05/D-06 enforcement, fixture integration)
  modified:
    - web/src/test/dashboard-logic.test.ts (+2 describe it blocks in new 'wisenet parity (TEST-02)' describe block appended at EOF; existing 'dashboard logic port' describe unchanged)

key-decisions:
  - "Endpoint signatures in endpoints.ts return Promise<T[]> (not AsyncGenerator) per Plan 02-03 executor's D-26 implementation — mapper's buildDashboardSourcesFromWisenet uses Promise.all directly, no collectAll helper needed"
  - "DashboardSources lowercase keys (aggregations / creditControl / upcoming / students / studentsCourses / remainingCredits) per existing domain.ts contract — snapshot builders assign to lowercase property names but emit sheetName = original uppercase (Aggregations / Credit_Control / etc.) to match SHEET_* config constants"
  - "Duration type: WisenetSessionSchema defines duration as z.coerce.number().optional() (milliseconds; NO ms→min transform in Zod) — mapper divides by 3_600_000 for hours and 60_000 for minutes. 13/50 real fixture past sessions omit duration entirely; durationMsToMinutes(undefined) returns 0"
  - "FLAG-2 non-zero Aggregations: implemented session-count proxy for totalHours per D-07 derive-client decision. test 'FLAG-2: Aggregations credit balance is non-zero for fixture with ENDED sessions' feeds 2×ENDED (1h, 0.5h) + 1×upcoming and verifies totalHours=3, remainingHours=1.5"
  - "Students snapshot Remaining Credits cell: numeric for active students (isActiveStudent=true), 'N/A' for inactive — matches buildActiveStudentSet filter which adds students when cell !== 'N/A' AND !== ''"
  - "Test helper fixture adapter: fixtures on disk wrap the real API response under .body (probe tooling artifact). Adapter uses unwrap() before Zod-parsing. Synthesizes studentDetails by grafting the single detail fixture's parentIds onto each student's _id so parent-resolution branches are exercised without 25 real detail fixtures"
  - "Parity describe block: extends existing dashboard-logic.test.ts with TWO new it() tests — full-pipeline shape check + buildActiveStudentSet contract round-trip. Existing 3 dashboard-logic-port it() blocks unchanged. If any assertion fails, D-24 rule: fix goes in mappers.ts"

patterns-established:
  - "D-24 facade pattern: test adapter imports composeDashboardSourcesFromData from mappers.ts; tests NEVER touch wisenetFetch or the endpoints module"
  - "Phase 3 rewire pattern: service.ts will call buildDashboardSourcesFromWisenet(today) → bulkGetAdminOwnership(studentKeys derived from remainingCredits.rows) → rewrite Admin column → pass to existing buildStudentAdminOwnershipMap unchanged"
  - "Sub-repo-free commit flow: per Kevin's feedback, commits use `git add <files>` + `git commit -m` directly (gsd-tools commit --files ignores filter)"

requirements-completed: [WCLI-04, WCLI-06, TEST-02]

# Metrics
duration: 10min
completed: 2026-04-22
---

# Phase 02 Plan 04: Wisenet → DashboardSources Mappers Summary

**Dual-entry mapper (production network path + pure test composer) with 6 snapshot builders matching the existing DashboardSources contract, a fixture adapter that feeds Wisenet probe fixtures through composeDashboardSourcesFromData without network mocking, and a TEST-02 parity describe block proving Wisenet-derived snapshots round-trip cleanly through the existing dashboard-logic pipeline — 36 mapper tests + 2 parity tests green, 124 tests in the full suite, tsc clean.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-22T04:23:15Z
- **Completed:** 2026-04-22T04:34:13Z
- **Tasks:** 3 (mappers.ts, tests + helpers, parity describe block)
- **Files modified:** 4 (3 created + 1 appended)
- **Commits:** 3
  - fbf5adc feat(02-04): add Wisenet → DashboardSources mapper module
  - 536baf7 test(02-04): add mapper unit tests + fixture adapter
  - b601f54 test(02-04): add TEST-02 parity describe block to dashboard-logic.test.ts

## Accomplishments

### Task 1 — mappers.ts (fbf5adc)

- Shipped `web/src/lib/wisenet/mappers.ts` (598 lines) with the mandatory Pitfall-7 refactor: `buildDashboardSourcesFromWisenet(today, options)` is the production network entry, `composeDashboardSourcesFromData(data, today, options)` is the pure composer.
- 4 exported unit-testable field transforms: `coerceMeetingStatusToFinalStatus`, `durationMsToMinutes` (handles undefined/negative/NaN → 0), `shouldCountAsPendingDeductionWisenet` (D-08 composite rule), `isActiveStudent` (RED RemainingCredits predicate).
- 2 production-only network helpers: `resolveParentNames` (D-18 2-step join with `pLimit(TEACHER_FEEDBACK_CONCURRENCY)`) and `fetchTeacherFeedback` (D-19 ENDED-session pre-filter with same p-limit cap). Both have `options.prefetched` short-circuits so tests can bypass entirely.
- 6 snapshot builders emitting exact REQUIRED_COLUMNS headers: `toAggregationsSnapshot`, `toCreditControlSnapshot`, `toUpcomingSnapshot`, `toStudentsSnapshot`, `toStudentsCoursesSnapshot`, `toRemainingCreditsSnapshot`.
- D-05 enforcement inline in `toCreditControlSnapshot`: Should_Credit header preserved, value is `""` for every row.
- D-06 enforcement inline in `toRemainingCreditsSnapshot`: Admin cell is `""` — Phase 3 service.ts joins DB ownership after composing.
- D-07 enforcement in `toAggregationsSnapshot` + `toStudentsSnapshot`: Current Remaining/Total Credits derived from sum-of-ENDED-duration/3_600_000 for consumedHours, session-count proxy (past ENDED count + upcoming count, lifted to at least consumedHours) for totalHours. **FLAG-2 non-zero balance verified** — a fixture with 2 ENDED (1h, 0.5h) + 1 upcoming produces totalHours=3, remainingHours=1.5.
- D-08 enforcement in `shouldCountAsPendingDeductionWisenet`: `meetingStatus === "ENDED" && trimmed(teacherFeedback) === "" && duration > 0`.
- `tsc --noEmit` exits 0.

### Task 2 — test helpers + mapper tests (536baf7)

- `web/src/test/helpers/wisenet-to-dashboard-sources.ts` — D-24 facade adapter. `loadWisenetFixtureSet()` unwraps the probe-wrapper `.body`, parses each of 4 fixtures through its Zod schema, grafts the single detail fixture's parentIds onto every list-student's detail entry, synthesizes `parentNamesById` + empty `teacherFeedbackBySessionId`. `toDashboardSources(fixtures, today)` calls `composeDashboardSourcesFromData` directly — zero network, zero fetch mocking.
- `web/src/test/wisenet-mappers.test.ts` — **36 tests** in 6 describe blocks:
  - `coerceMeetingStatusToFinalStatus` × 3
  - `durationMsToMinutes` × 6 (including undefined — 13/50 fixtures omit duration)
  - `D-08 shouldCountAsPendingDeductionWisenet` × 9 parametric (ENDED, CANCELLED, UPCOMING, IN_PROGRESS variants + whitespace-only feedback)
  - `isActiveStudent` × 4 (activated=false block, past-90d, upcoming-only, outside-90d)
  - `composeDashboardSourcesFromData` × 12 (6 snapshot shapes + D-05 × 2 + D-06 + D-07 FLAG-2 + upcoming status coercion + inactive student 'N/A' + no-session inactive fallback + parent fallback)
  - `toDashboardSources test helper` × 2 (fixture integration + D-05 fixture-level enforcement)
- All 36 tests pass; `tsc --noEmit` exits 0.

### Task 3 — TEST-02 parity describe (b601f54)

- Appended `describe("wisenet parity (TEST-02)", ...)` at the end of `web/src/test/dashboard-logic.test.ts`; the existing `describe("dashboard logic port", ...)` block is untouched.
- New block's 2 it() cases:
  1. `"builds a valid dashboard payload when DashboardSources come from Wisenet mappers"` — loads fixtures, runs them through `toDashboardSources`, then through the full pipeline (`buildActiveStudentSet → buildExcludedPackageReasons → buildStudentAdminOwnershipMap → buildPendingDeductionContext → buildUpcomingSessionMap → buildDashboardStudents → buildDashboardModel`). Asserts payload shape (studentQueue / summary / students / calendar.days) plus the full REQUIRED_COLUMNS contract on all 6 snapshots.
  2. `"passes buildActiveStudentSet without throwing on Wisenet-sourced Students snapshot"` — contract smoke test.
- Full suite `cd web && npm test -- --run` → **124 tests pass** across 13 files (up from 122 with Plans 02-01/02-02/02-03/02-05/02-06/02-07/02-08 baseline — 2 new parity tests added).
- `cd web && npx tsc --noEmit` exits 0.

## Deviations from Plan

### Auto-fixed adaptations (applied without asking per Rule 3)

**1. [Rule 3 - Scope Alignment] endpoints.ts returns Promise<T[]>, not AsyncGenerator**
- **Found during:** Task 1 planning (reading 02-03-SUMMARY.md + endpoints.ts)
- **Issue:** The user-provided executor prompt describes `getStudents` / `getPastSessions` / `getUpcomingSessions` as AsyncGenerator that needs a `collectAll` helper. The actual Plan 02-03 shipped endpoints return `Promise<T[]>` directly (see web/src/lib/wisenet/endpoints.ts:60, :104, :119) because the executor used a different pagination pattern (internal `paginate()` generator hidden inside each resource function, output collected before return).
- **Fix:** Used Promise.all directly on the 3 network calls; removed the `collectAll` helper from the sketch since it's not needed.
- **Files modified:** web/src/lib/wisenet/mappers.ts
- **Commit:** fbf5adc

**2. [Rule 3 - Contract Alignment] DashboardSources keys are lowercase**
- **Found during:** Task 1 (reading domain.ts)
- **Issue:** The prompt's sketch used property keys like `Aggregations` / `Credit_Control` / `"Upcoming Sessions"` / `RemainingCredits` on the DashboardSources return. The existing domain.ts contract uses `aggregations` / `creditControl` / `upcoming` / `students` / `studentsCourses` / `remainingCredits` (camelCase-lowercase).
- **Fix:** Snapshot builders assign to the lowercase DashboardSources property names; each builder's `sheetName` field still uses the original uppercase sheet names from the SHEET_* config constants (so downstream code that reads sheetName for diagnostics still sees "Aggregations" / "Credit_Control").
- **Files modified:** web/src/lib/wisenet/mappers.ts
- **Commit:** fbf5adc

**3. [Rule 3 - Contract Alignment] buildDashboardStudents + buildDashboardModel signatures**
- **Found during:** Task 3 (reading packages.ts + analytics.ts)
- **Issue:** The prompt sketch used an options-object-style call for `buildDashboardStudents({ activeStudents, excluded, pending, scheduled, ownership })` and a `{ today, adminOwnership, previousSnapshot }` options object for `buildDashboardModel`. The actual exported signatures are positional: `buildDashboardStudents(aggregations, activeStudents, excluded, pending, scheduled, today, ownership)` and `buildDashboardModel(students, snapshotState, today, now)`.
- **Fix:** Parity block calls match the real positional signatures. Did NOT modify the underlying functions.
- **Files modified:** web/src/test/dashboard-logic.test.ts (parity block only)
- **Commit:** b601f54

**4. [Rule 1 - Bug Fix] Fixture wrapper handling**
- **Found during:** Task 2 (inspecting fixtures via node -e)
- **Issue:** The 6 Wisenet fixtures on disk are probe-tool outputs that wrap the real API response under a `.body` property (along with probe metadata: `_note`, `_redaction`, `probed_at`, `response_status`, `response_headers`). The sketch adapter called `Schema.parse(fixture)` directly, which would fail.
- **Fix:** Added `unwrap()` helper in `wisenet-to-dashboard-sources.ts` that extracts `.body` before parsing. Documented in the helper's header comment.
- **Files modified:** web/src/test/helpers/wisenet-to-dashboard-sources.ts
- **Commit:** 536baf7

**5. [Rule 2 - Missing Critical Functionality] Graceful detail-fetch failure fallback**
- **Found during:** Task 1 (writing resolveParentNames)
- **Issue:** The production network path for parent resolution fetches `getStudent(id)` in a p-limit loop. A single failing detail fetch would reject the entire Promise.all and crash the payload build.
- **Fix:** Wrapped each per-student `getStudent` call in try/catch inside the p-limit worker; on failure, the student's detail entry is simply absent from the map and `parentNameFor` returns "" — which feeds the existing `"missing-parent"` fallback in `buildDashboardStudentKey`. No data loss, no crash.
- **Files modified:** web/src/lib/wisenet/mappers.ts
- **Commit:** fbf5adc

**6. [Rule 2 - Missing Critical Functionality] `toStudentsSnapshot` inactive-student handling**
- **Found during:** Task 1 (cross-referencing buildActiveStudentSet)
- **Issue:** The sketch emitted every student to the Students snapshot with a numeric "Remaining Credits" value. `buildActiveStudentSet` filters on `remainingCredits !== "N/A" AND !== ""` — so the original sketch would have incorrectly marked *every* Wisenet student as active regardless of their `activated` flag or session history.
- **Fix:** `toStudentsSnapshot` emits `"N/A"` for students where `isActiveStudent` returns false (matching the RED RemainingCredits predicate), numeric value for active students. This aligns with the D-07 derive-client decision and the existing Sheets-layer semantics.
- **Files modified:** web/src/lib/wisenet/mappers.ts
- **Commit:** fbf5adc

### Auth gates

None — this plan is pure TypeScript / library work. No CLI logins, no environment variable introduction, no credential provisioning.

### Deferred items

None. All FLAG-2 / D-05 / D-06 / D-07 / D-08 / D-18 / D-19 / D-24 requirements met within Phase 2 scope. The D-07 totalHours derivation uses the session-count proxy documented inline with a Phase-3 upgrade hook through sessionCredits if the Opportunity 6 probe succeeds.

## Threat Flags

No new trust-boundary surface introduced. All mapper outputs feed through the pre-existing DashboardSources → dashboard-payload pipeline which already has an established threat model.

## Exported Symbol List

```typescript
// web/src/lib/wisenet/mappers.ts public surface
export const TEACHER_FEEDBACK_CONCURRENCY = 5;
export interface WisenetMapperData { /* 6 fields */ }
export interface MapperOptions { skipTeacherFeedback?, prefetched?, pastWindowDays?, upcomingWindowDays? }

// Field transforms (pure, testable)
export function coerceMeetingStatusToFinalStatus(meetingStatus: string): string;
export function durationMsToMinutes(durationMs: number | undefined): number;
export function shouldCountAsPendingDeductionWisenet(meetingStatus: string, teacherFeedback: string, durationMs: number | undefined): boolean;
export function isActiveStudent(student: WisenetStudent, today: Date, pastSessionsByStudent: Map<string, WisenetSession[]>, upcomingSessionsByStudent: Map<string, WisenetSession[]>): boolean;

// Network helpers (production path)
export async function resolveParentNames(students: WisenetStudent[], options?: MapperOptions): Promise<{ parentNamesById: Map<string, string>; studentDetails: Map<string, WisenetStudentDetailResponse> }>;
export async function fetchTeacherFeedback(pastSessions: WisenetSession[], options?: MapperOptions): Promise<Map<string, string>>;

// Entry points
export async function buildDashboardSourcesFromWisenet(today: Date, options?: MapperOptions): Promise<DashboardSources>;
export function composeDashboardSourcesFromData(data: WisenetMapperData, today: Date, _options?: MapperOptions): DashboardSources;
```

```typescript
// web/src/test/helpers/wisenet-to-dashboard-sources.ts public surface
export interface WisenetFixtureSet { /* 6 fields matching WisenetMapperData */ }
export function loadWisenetFixtureSet(): WisenetFixtureSet;
export async function toDashboardSources(fixtures: WisenetFixtureSet, today: Date): Promise<DashboardSources>;
```

## Field-Map-Row Drift Notes (WISENET_FIELD_MAP.md vs Implementation)

| Row | Classification (planner) | Implementation Reality | Notes |
|-----|--------------------------|------------------------|-------|
| Aggregations / Current Remaining Credits | RED derive-client | Implemented via past ENDED duration sum / 3_600_000 subtracted from session-count proxy total | Proxy documented inline with Phase 3 sessionCredits upgrade hook |
| Aggregations / Current Total Credits | RED derive-client | Session-count proxy: max(past_ENDED_count + upcoming_count, consumedHours) | FLAG-2 non-zero verification passes with 2 ENDED + 1 upcoming fixture |
| Credit_Control / Should_Credit | D-05 drop | Column header preserved; value `""` always | Enforced by 3 tests (unit + snapshot-level + fixture-level) |
| Credit_Control / credits_consumed | RED derive-client | duration/3_600_000 when ENDED, else 0 | 2-decimal rounded |
| Credit_Control / final_status | YELLOW 1:1 coerce | meetingStatus → uppercase | Single-line pass-through |
| Upcoming / Session Status | YELLOW 1:1 coerce | meetingStatus → uppercase | UPCOMING + IN_PROGRESS both emitted; downstream buildUpcomingSessionMap filters on UPCOMING only |
| Students / Remaining Credits | RED RemainingCredits predicate | Numeric when isActiveStudent=true, "N/A" otherwise | Matches existing buildActiveStudentSet filter |
| Students & Courses / Class Name + Class Subject | GREEN 1:1 | student.classrooms[].name + .subject | Direct pass-through |
| RemainingCredits / Admin | D-06 sidecar | Phase 2 empty string; Phase 3 service.ts joins via bulkGetAdminOwnership | Phase 2 scope boundary — documented inline |

No drift outside the planner's classification — every RED/YELLOW/GREEN prediction held.

## Self-Check: PASSED

### Files exist
- `[FOUND]` /Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops/web/src/lib/wisenet/mappers.ts
- `[FOUND]` /Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops/web/src/test/helpers/wisenet-to-dashboard-sources.ts
- `[FOUND]` /Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops/web/src/test/wisenet-mappers.test.ts
- `[FOUND]` /Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops/web/src/test/dashboard-logic.test.ts (extended)

### Commits exist
- `[FOUND]` fbf5adc feat(02-04): add Wisenet → DashboardSources mapper module
- `[FOUND]` 536baf7 test(02-04): add mapper unit tests + fixture adapter
- `[FOUND]` b601f54 test(02-04): add TEST-02 parity describe block to dashboard-logic.test.ts

### Tests
- `[PASS]` cd web && npm test -- --run src/test/wisenet-mappers.test.ts → 36 tests pass
- `[PASS]` cd web && npm test -- --run src/test/dashboard-logic.test.ts → 5 tests pass (3 existing + 2 new parity)
- `[PASS]` cd web && npm test -- --run → 124 tests pass across 13 files
- `[PASS]` cd web && npx tsc --noEmit → exit 0
