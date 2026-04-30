// web/src/test/calendar.test.ts
// TEST-01 port — calendar + summary domain (batch B of Validation.gs port).
// Ports 3 of 41 Validation.gs assertions into Vitest:
//   1. testCalendarGroupsStudentSessionsByDay               (Validation.gs:1671)
//   2. testSummaryDeltasCompareAgainstPreviousSnapshot      (Validation.gs:1729)
//   3. testDashboardCacheMissBuildsAndCachesPayload         (Validation.gs:1791)
//      Adapted per D-23: NO cache in Phase 2. Test asserts the BUILD path
//      (fresh payload shape when previousSnapshot is null) rather than the
//      cache-mutation behavior, which lands in Phase 3 service.ts rewire.
//
// Validates critical parity gates from VALIDATION.md:
//   - Calendar day grouping: buildCalendarData buckets upcoming sessions by
//     YYYY-MM-DD and collapses same-day sessions under one student entry
//   - Summary deltas: buildSummaryDeltas subtracts previous from current for
//     packagesNotify, packagesWatch, pendingDeductionBacklog (decimal preserve)
//   - Cache-miss (adapted): buildDashboardModel with lastSnapshot=null emits
//     a payload with all required top-level fields + a persisted snapshotState
//     ready for Phase 3 to hand to a cache wrapper. Comment references D-23.
//
// Fixture-builder convention: co-located inline `buildFixture*()` helpers
// mirror Validation.gs idiom. Pipeline-driven tests thread snapshot inputs
// through packages.ts → analytics.ts the same way dashboard-logic.test.ts
// does; buildSummaryDeltas is exercised directly as a pure function.

import { describe, expect, it } from "vitest";

import type { SheetSnapshot } from "@/lib/dashboard/domain";
import type { SummaryPayload } from "@/types/dashboard";
import {
  buildActiveStudentSet,
  buildDashboardStudents,
  buildExcludedPackageReasons,
  buildPendingDeductionContext,
  buildStudentAdminOwnershipMap,
  buildUpcomingSessionMap,
} from "@/lib/dashboard/packages";
import { buildDashboardModel, buildSummaryDeltas } from "@/lib/dashboard/analytics";
import { attachActionStatesToStudents } from "@/lib/dashboard/action-helpers";

// ============================================================
// Fixture helpers (mirror Validation.gs buildFixture* pattern)
// ============================================================

function snapshot(
  sheetName: string,
  header: string[],
  rows: unknown[][],
  headerRowIndex = 0,
): SheetSnapshot {
  const cols = header.reduce<Record<string, number>>((map, value, index) => {
    map[value] = index;
    return map;
  }, {});

  return {
    sheetName,
    headerRowIndex,
    dataRowStartIndex: headerRowIndex + 2,
    cols,
    rows,
  };
}

const AGG_HEADERS = [
  "Student Name",
  "Parent Name",
  "Class Subject",
  "Current Remaining Credits",
  "Current Total Credits",
];
const STUDENTS_HEADERS = ["student_name", "Remaining Credits"];
const COURSES_HEADERS = ["Student Name", "Student Full Name", "Class Subject"];
const RC_HEADERS = ["Student", "Admin"];
const CC_HEADERS = [
  "Student Name",
  "Package/Program",
  "final_status",
  "teacher_feedback",
  "credits_consumed",
  "session_duration",
  "session_date",
  "Should_Credit",
];
const UPCOMING_HEADERS = [
  "Student Name",
  "Package/Program",
  "Session Status",
  "Session Duration",
  "Scheduled Date",
];

interface FixtureSnapshots {
  students: SheetSnapshot;
  studentsCourses: SheetSnapshot;
  remainingCredits: SheetSnapshot;
  aggregations: SheetSnapshot;
  creditControl: SheetSnapshot;
  upcoming: SheetSnapshot;
}

function runPipeline(fx: FixtureSnapshots, today: Date) {
  const activeStudents = buildActiveStudentSet(fx.students);
  const excluded = buildExcludedPackageReasons(fx.studentsCourses);
  const ownership = buildStudentAdminOwnershipMap(fx.remainingCredits);
  const pending = buildPendingDeductionContext(fx.creditControl, activeStudents, excluded, today);
  const scheduled = buildUpcomingSessionMap(fx.upcoming, activeStudents, excluded, today);
  const studentRecords = buildDashboardStudents(
    fx.aggregations,
    activeStudents,
    excluded,
    pending,
    scheduled,
    today,
    ownership,
  );
  return { studentRecords };
}

// ============================================================
// Calendar day grouping (parity gate)
// ============================================================

describe("calendar — day grouping (parity gate)", () => {
  it("groups same-day sessions across packages under one student on the same calendar day", () => {
    // Port of testCalendarGroupsStudentSessionsByDay (Validation.gs:1671).
    // Lila Wong has 2 packages (Math Pack, English Pack), each with a session
    // scheduled on 2026-04-04. Expected:
    //   - calendar.days contains an entry for date "2026-04-04"
    //   - day.totalStudents === 1 (one student, two sessions on that day)
    //   - day.students[0].sessions.length === 2 (both sessions collapsed
    //     under the same student entry)
    const today = new Date(2026, 2, 29);

    const fx: FixtureSnapshots = {
      students: snapshot("Students", STUDENTS_HEADERS, [["Lila Wong", 7]]),
      studentsCourses: snapshot("Students & Courses", COURSES_HEADERS, [
        ["Lila Wong", "Primary", "Math Pack"],
        ["Lila Wong", "Primary", "English Pack"],
      ]),
      remainingCredits: snapshot("RemainingCredits", RC_HEADERS, [
        ["Lila Wong", "Chiraya (Palm) Takornkulwut"],
      ]),
      aggregations: snapshot("Aggregations", AGG_HEADERS, [
        ["Lila Wong", "June Wong", "Math Pack", 4, 10],
        ["Lila Wong", "June Wong", "English Pack", 3, 10],
      ]),
      creditControl: snapshot("Credit_Control", CC_HEADERS, []),
      // Both sessions on 2026-04-04 — calendar must collapse them into a
      // single student entry with sessions.length === 2.
      upcoming: snapshot("Upcoming Sessions", UPCOMING_HEADERS, [
        ["Lila Wong", "Math Pack", "UPCOMING", 60, "2026-04-04"],
        ["Lila Wong", "English Pack", "UPCOMING", 90, "2026-04-04"],
      ]),
    };

    const { studentRecords } = runPipeline(fx, today);
    attachActionStatesToStudents(studentRecords, today, {});

    const dashboard = buildDashboardModel(
      studentRecords,
      { lastSnapshot: null, history: [] },
      today,
      today,
    );

    const day = dashboard.payload.calendar.days.find((item) => item.date === "2026-04-04");
    expect(day).toBeDefined();
    expect(day!.totalStudents).toBe(1);
    expect(day!.students[0].sessions).toHaveLength(2);
  });
});

// ============================================================
// Summary deltas vs previous snapshot (parity gate)
// ============================================================

describe("calendar — summary deltas against previous snapshot (parity gate)", () => {
  it("computes packagesNotify, packagesWatch, and pendingDeductionBacklog deltas preserving decimals", () => {
    // Port of testSummaryDeltasCompareAgainstPreviousSnapshot (Validation.gs:1729).
    // Current vs previous:
    //   packages.notify:              4 - 2  = +2
    //   packages.watch:               6 - 7  = -1
    //   portfolio.pendingDeductionBacklog: 9.5 - 7 = +2.5 (decimals preserved)
    const current: SummaryPayload = {
      students: { notify: 3, watch: 5, ok: 10, nodata: 1, total: 19 },
      packages: { notify: 4, watch: 6, ok: 12, nodata: 1, total: 23 },
      portfolio: {
        exhaustedNow: 2,
        risk7: 5,
        risk14: 8,
        risk30: 11,
        noSchedule: 3,
        pendingDeductionBacklog: 9.5,
        pendingDeductionPackages: 0,
        lowBalanceNoSchedule: 2,
        multiRiskStudents: 1,
      },
      queue: { students: 8, pinnedStudents: 3 },
      deltas: {
        packagesNotify: null,
        packagesWatch: null,
        risk7: null,
        risk30: null,
        pendingDeductionBacklog: null,
        noSchedule: null,
        queueStudents: null,
        pinnedStudents: null,
      },
    };

    const previous: SummaryPayload = {
      students: { notify: 2, watch: 5, ok: 10, nodata: 1, total: 18 },
      packages: { notify: 2, watch: 7, ok: 11, nodata: 1, total: 21 },
      portfolio: {
        exhaustedNow: 1,
        risk7: 3,
        risk14: 7,
        risk30: 10,
        noSchedule: 4,
        pendingDeductionBacklog: 7,
        pendingDeductionPackages: 0,
        lowBalanceNoSchedule: 1,
        multiRiskStudents: 1,
      },
      queue: { students: 6, pinnedStudents: 2 },
      deltas: {
        packagesNotify: null,
        packagesWatch: null,
        risk7: null,
        risk30: null,
        pendingDeductionBacklog: null,
        noSchedule: null,
        queueStudents: null,
        pinnedStudents: null,
      },
    };

    const deltas = buildSummaryDeltas(current, previous);

    expect(deltas.packagesNotify).toBe(2);
    expect(deltas.packagesWatch).toBe(-1);
    expect(deltas.pendingDeductionBacklog).toBe(2.5);
  });

  it("T-02-35 mitigation: null previous snapshot yields all-null deltas without throwing (first-run case)", () => {
    // buildSummaryDeltas(current, null) must handle the cold-start / first-run
    // case where there is no prior snapshot to subtract against. Per the TS
    // implementation, every delta field returns null rather than throwing.
    // This covers Phase 3 cold-start behavior before any snapshot lands.
    const current: SummaryPayload = {
      students: { notify: 1, watch: 2, ok: 3, nodata: 0, total: 6 },
      packages: { notify: 1, watch: 2, ok: 3, nodata: 0, total: 6 },
      portfolio: {
        exhaustedNow: 0,
        risk7: 0,
        risk14: 0,
        risk30: 0,
        noSchedule: 0,
        pendingDeductionBacklog: 0,
        pendingDeductionPackages: 0,
        lowBalanceNoSchedule: 0,
        multiRiskStudents: 0,
      },
      queue: { students: 3, pinnedStudents: 0 },
      deltas: {
        packagesNotify: null,
        packagesWatch: null,
        risk7: null,
        risk30: null,
        pendingDeductionBacklog: null,
        noSchedule: null,
        queueStudents: null,
        pinnedStudents: null,
      },
    };

    const deltas = buildSummaryDeltas(current, null);
    expect(deltas.packagesNotify).toBeNull();
    expect(deltas.packagesWatch).toBeNull();
    expect(deltas.pendingDeductionBacklog).toBeNull();
    expect(deltas.queueStudents).toBeNull();
    expect(deltas.pinnedStudents).toBeNull();
  });
});

// ============================================================
// Cache-miss build path (D-23 adaptation)
// ============================================================

describe("calendar — cache-miss build path (adapted per D-23)", () => {
  it("buildDashboardModel produces a fresh payload + snapshotState when no previous snapshot exists", () => {
    // Adapted port of testDashboardCacheMissBuildsAndCachesPayload
    // (Validation.gs:1791). Per .planning/phases/02-data-layer/02-CONTEXT.md
    // §D-23, NO cache layer exists in Phase 2. The Apps Script version
    // exercised getCachedDashboardPayload + createFakeCache to assert that a
    // cache miss (1) invoked the builder exactly once and (2) wrote cache
    // metadata. In Phase 2 we test only the BUILD path — the cache wrapper
    // lands in Phase 3 service.ts (where `use cache: remote` + `cacheTag`
    // decorators gate buildDashboardPayloadUncached).
    //
    // Equivalent contract: buildDashboardModel with snapshotState.lastSnapshot
    // === null returns a payload with every required top-level field, plus a
    // snapshotState.lastSnapshot that Phase 3 can persist into the chosen
    // cache surface.
    const today = new Date(2026, 2, 29);

    const fx: FixtureSnapshots = {
      students: snapshot("Students", STUDENTS_HEADERS, [["Mira Ho", 5]]),
      studentsCourses: snapshot("Students & Courses", COURSES_HEADERS, [
        ["Mira Ho", "Primary", "Math Pack"],
      ]),
      remainingCredits: snapshot("RemainingCredits", RC_HEADERS, [
        ["Mira Ho", "Chiraya (Palm) Takornkulwut"],
      ]),
      aggregations: snapshot("Aggregations", AGG_HEADERS, [
        ["Mira Ho", "Lee Ho", "Math Pack", 5, 10],
      ]),
      creditControl: snapshot("Credit_Control", CC_HEADERS, []),
      upcoming: snapshot("Upcoming Sessions", UPCOMING_HEADERS, [
        ["Mira Ho", "Math Pack", "UPCOMING", 60, "2026-04-02"],
      ]),
    };

    const { studentRecords } = runPipeline(fx, today);
    attachActionStatesToStudents(studentRecords, today, {});

    const now = new Date(2026, 2, 29, 12, 0, 0);
    const result = buildDashboardModel(
      studentRecords,
      { lastSnapshot: null, history: [] },
      today,
      now,
    );

    // Build path emits every required top-level payload field.
    expect(result.payload.adminViews).toBeDefined();
    expect(result.payload.lastUpdatedAt).toBeDefined();
    expect(result.payload.previousUpdatedAt).toBeNull();
    expect(result.payload.summary).toBeDefined();
    expect(Array.isArray(result.payload.studentQueue)).toBe(true);
    expect(result.payload.calendar).toBeDefined();
    expect(Array.isArray(result.payload.students)).toBe(true);

    // snapshotState.lastSnapshot is emitted so Phase 3 can persist it via the
    // new cache surface (Neon + `use cache: remote` + cacheTag).
    expect(result.snapshotState.lastSnapshot).not.toBeNull();
    expect(result.snapshotState.lastSnapshot?.generatedAt).toBeDefined();
    expect(result.snapshotState.history).toHaveLength(1);
  });
});
