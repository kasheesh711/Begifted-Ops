// web/src/test/queue.test.ts
// TEST-01 port — queue domain (batch B of Validation.gs port).
// Ports 4 of 41 Validation.gs assertions into Vitest:
//   1. testStudentQueueRollsUpPackagesIntoOneRow           (Validation.gs:1558)
//   2. testPinnedStudentsSortAheadOfOtherRisk              (Validation.gs:1613)
//   3. testDashboardModelMergesStudentActionStateIntoStudentsAndQueue
//                                                          (Validation.gs:1980)
//   4. testStudentActionStateOnlySurfacesToday — integration variant
//      (cross-references DB-05, adapted from Validation.gs:1921)
//
// Validates critical parity gates from VALIDATION.md:
//   - Queue rollup: multiple packages collapse into one StudentQueueRow per student
//   - Pinned-first ordering: pinned StudentQueueRow sorts above non-pinned via
//     compareStudentQueueRows (exported indirectly through buildStudentQueue)
//   - Action-state merge: attachActionStatesToStudents propagates ActionState
//     into StudentRecord and then into StudentQueueRow via buildStudentQueue
//   - DB-05 same-day visibility: yesterday's action state is dropped by the
//     sanitizer, so it never surfaces on the queue
//
// Fixture-builder convention: co-located inline `buildFixture*()` helpers
// mirror Validation.gs idiom. All test inputs are constructed via the public
// packages.ts pipeline (buildActiveStudentSet → buildExcludedPackageReasons →
// buildStudentAdminOwnershipMap → buildPendingDeductionContext →
// buildUpcomingSessionMap → buildDashboardStudents) so the tests exercise the
// real TS analytics chain end-to-end against snapshot inputs — matching the
// Apps Script style where Validation.gs fixtures flow through the production
// buildDashboardModel / buildStudentQueue call path.

import { describe, expect, it } from "vitest";

import type { SheetSnapshot } from "@/lib/dashboard/domain";
import {
  buildActiveStudentSet,
  buildDashboardStudents,
  buildExcludedPackageReasons,
  buildPendingDeductionContext,
  buildStudentAdminOwnershipMap,
  buildUpcomingSessionMap,
} from "@/lib/dashboard/packages";
import { buildDashboardModel } from "@/lib/dashboard/analytics";
import { attachActionStatesToStudents } from "@/lib/dashboard/actions";

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
  return { activeStudents, excluded, ownership, pending, scheduled, studentRecords };
}

// ============================================================
// Queue rollup (parity gate)
// ============================================================

describe("queue — StudentQueueRow rollup (parity gate)", () => {
  it("multiple packages for one student collapse into a single queue row", () => {
    // Port of testStudentQueueRollsUpPackagesIntoOneRow (Validation.gs:1558).
    // Iris Tan has 2 packages: English Pack (3 credits, session 2026-04-05) and
    // Math Pack (1 credit after pending, session 2026-04-02). Expected:
    //   - 1 queue row (collapsed across packages)
    //   - totalAdjustedRemaining = 4 (3 + 1)
    //   - totalCurrentRemaining = 4.5 (3 + 1.5)
    //   - nextSessionDate = earliest scheduled = 2026-04-02
    const today = new Date(2026, 2, 29);

    const fx: FixtureSnapshots = {
      students: snapshot("Students", STUDENTS_HEADERS, [["Iris Tan", 4.5]]),
      studentsCourses: snapshot("Students & Courses", COURSES_HEADERS, [
        ["Iris Tan", "Primary", "English Pack"],
        ["Iris Tan", "Primary", "Math Pack"],
      ]),
      remainingCredits: snapshot("RemainingCredits", RC_HEADERS, [
        ["Iris Tan", "Chiraya (Palm) Takornkulwut"],
      ]),
      aggregations: snapshot("Aggregations", AGG_HEADERS, [
        ["Iris Tan", "Pim Tan", "English Pack", 3, 10],
        ["Iris Tan", "Pim Tan", "Math Pack", 1.5, 8],
      ]),
      // Math Pack accrues 0.5 credits of pending deduction via a 30-min
      // session_duration ENDED row with empty teacher_feedback (D-08 rule).
      creditControl: snapshot("Credit_Control", CC_HEADERS, [
        ["Iris Tan", "Math Pack", "ENDED", "", 0, 30, "2026-03-28", ""],
      ]),
      upcoming: snapshot("Upcoming Sessions", UPCOMING_HEADERS, [
        ["Iris Tan", "English Pack", "UPCOMING", 90, "2026-04-05"],
        ["Iris Tan", "Math Pack", "UPCOMING", 60, "2026-04-02"],
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

    expect(dashboard.payload.studentQueue).toHaveLength(1);
    const row = dashboard.payload.studentQueue[0];
    expect(row.student).toBe("Iris Tan");
    expect(row.packageCount).toBe(2);
    // 3 (English) + 1 (Math adjustedRemaining = 1.5 - 0.5 pending) = 4
    expect(row.totalAdjustedRemaining).toBe(4);
    // Current remaining is pre-deduction: 3 + 1.5 = 4.5
    expect(row.totalCurrentRemaining).toBe(4.5);
    expect(row.nextSessionDate).toBe("2026-04-02");
  });
});

// ============================================================
// Pinned-first ordering (parity gate)
// ============================================================

describe("queue — pinned-first ordering (parity gate)", () => {
  it("low-balance no-schedule student is pinned above other-risk students", () => {
    // Port of testPinnedStudentsSortAheadOfOtherRisk (Validation.gs:1613).
    // Jade Lim: 1.5 credits, NO upcoming sessions → pinned (low balance + no
    //   future schedule).
    // Kai Tan: 2.5 credits, 1 upcoming session → "watch" but not pinned.
    // compareStudentQueueRows sorts pinned=true ahead of pinned=false, so
    // Jade must appear first in the payload studentQueue array.
    const today = new Date(2026, 2, 29);

    const fx: FixtureSnapshots = {
      students: snapshot("Students", STUDENTS_HEADERS, [
        ["Jade Lim", 1.5],
        ["Kai Tan", 2.5],
      ]),
      studentsCourses: snapshot("Students & Courses", COURSES_HEADERS, [
        ["Jade Lim", "Primary", "Science Pack"],
        ["Kai Tan", "Primary", "Reading Pack"],
      ]),
      remainingCredits: snapshot("RemainingCredits", RC_HEADERS, [
        ["Jade Lim", "Chiraya (Palm) Takornkulwut"],
        ["Kai Tan", "Chiraya (Palm) Takornkulwut"],
      ]),
      aggregations: snapshot("Aggregations", AGG_HEADERS, [
        ["Jade Lim", "May Lim", "Science Pack", 1.5, 10],
        ["Kai Tan", "Nita Tan", "Reading Pack", 2.5, 10],
      ]),
      creditControl: snapshot("Credit_Control", CC_HEADERS, []),
      // Only Kai has an upcoming session — Jade has none, triggering pinned.
      upcoming: snapshot("Upcoming Sessions", UPCOMING_HEADERS, [
        ["Kai Tan", "Reading Pack", "UPCOMING", 60, "2026-04-01"],
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

    expect(dashboard.payload.studentQueue[0].student).toBe("Jade Lim");
    expect(dashboard.payload.studentQueue[0].pinned).toBe(true);
  });
});

// ============================================================
// Action-state merge into StudentRecord + StudentQueueRow (DB-05 integration)
// ============================================================

describe("queue — action-state merge into students + queue (parity gate)", () => {
  it("attachActionStatesToStudents propagates ActionState onto both students and queue rows", () => {
    // Port of testDashboardModelMergesStudentActionStateIntoStudentsAndQueue
    // (Validation.gs:1980). Apps Script version invoked buildDashboardModel
    // with an actionProperties options bag; the TS pipeline instead attaches
    // action state before buildDashboardModel via attachActionStatesToStudents.
    // Semantic intent is identical: once set, the queue row carries the same
    // ActionState that the StudentRecord does, keyed by studentKey.
    const today = new Date(2026, 2, 31);

    const fx: FixtureSnapshots = {
      students: snapshot("Students", STUDENTS_HEADERS, [["Nina Tan", 1.5]]),
      studentsCourses: snapshot("Students & Courses", COURSES_HEADERS, [
        ["Nina Tan", "Primary", "English Pack"],
      ]),
      remainingCredits: snapshot("RemainingCredits", RC_HEADERS, [
        ["Nina Tan", "Chiraya (Palm) Takornkulwut"],
      ]),
      aggregations: snapshot("Aggregations", AGG_HEADERS, [
        ["Nina Tan", "Pim Tan", "English Pack", 1.5, 10],
      ]),
      creditControl: snapshot("Credit_Control", CC_HEADERS, []),
      upcoming: snapshot("Upcoming Sessions", UPCOMING_HEADERS, [
        ["Nina Tan", "English Pack", "UPCOMING", 60, "2026-04-02"],
      ]),
    };

    const { studentRecords } = runPipeline(fx, today);
    const studentKey = studentRecords[0].studentKey;

    attachActionStatesToStudents(studentRecords, today, {
      [studentKey]: {
        status: "contacted",
        updatedAt: "2026-03-31T13:15:00+07:00",
        updatedByName: "Palm",
        isToday: true,
      },
    });

    const dashboard = buildDashboardModel(
      studentRecords,
      { lastSnapshot: null, history: [] },
      today,
      new Date(2026, 2, 31, 13, 30, 0),
    );

    // StudentRecord carries the merged action state
    expect(dashboard.payload.students[0].actionState).not.toBeNull();
    expect(dashboard.payload.students[0].actionState?.status).toBe("contacted");

    // StudentQueueRow exposes the same stable studentKey...
    expect(dashboard.payload.studentQueue[0].studentKey).toBe(studentKey);
    // ...and carries the cloned ActionState (compareStudentQueueRows doesn't
    // strip it — buildStudentQueueRow calls cloneActionState(student.actionState)).
    expect(dashboard.payload.studentQueue[0].actionState).not.toBeNull();
    expect(dashboard.payload.studentQueue[0].actionState?.status).toBe("contacted");
  });

  it("DB-05 parity: yesterday's action state is dropped before queue rollup", () => {
    // Integration variant that cross-references DB-05 same-day visibility
    // (also exercised in pending-deduction.test.ts as a unit-level sanitize
    // call). Here we prove the full pipeline: if the action-state map contains
    // a row whose updatedAt is NOT today, sanitizeStudentActionState returns
    // null, attachActionStatesToStudents sets StudentRecord.actionState = null,
    // and buildStudentQueueRow clones null onto the queue row.
    const today = new Date(2026, 2, 31);

    const fx: FixtureSnapshots = {
      students: snapshot("Students", STUDENTS_HEADERS, [["Ollie Lim", 1.5]]),
      studentsCourses: snapshot("Students & Courses", COURSES_HEADERS, [
        ["Ollie Lim", "Primary", "English Pack"],
      ]),
      remainingCredits: snapshot("RemainingCredits", RC_HEADERS, [
        ["Ollie Lim", "Chiraya (Palm) Takornkulwut"],
      ]),
      aggregations: snapshot("Aggregations", AGG_HEADERS, [
        ["Ollie Lim", "Pim Lim", "English Pack", 1.5, 10],
      ]),
      creditControl: snapshot("Credit_Control", CC_HEADERS, []),
      upcoming: snapshot("Upcoming Sessions", UPCOMING_HEADERS, [
        ["Ollie Lim", "English Pack", "UPCOMING", 60, "2026-04-02"],
      ]),
    };

    const { studentRecords } = runPipeline(fx, today);
    const studentKey = studentRecords[0].studentKey;

    // Yesterday's action state — sanitizer must drop it.
    attachActionStatesToStudents(studentRecords, today, {
      [studentKey]: {
        status: "contacted",
        updatedAt: "2026-03-30T13:15:00+07:00", // yesterday relative to today
        updatedByName: "Palm",
        isToday: true, // sanitizer re-evaluates via date compare — lies don't help
      },
    });

    const dashboard = buildDashboardModel(
      studentRecords,
      { lastSnapshot: null, history: [] },
      today,
      today,
    );

    expect(dashboard.payload.students[0].actionState).toBeNull();
    expect(dashboard.payload.studentQueue[0].actionState).toBeNull();
  });
});
