import { describe, expect, it } from "vitest";

import { buildDashboardModel } from "@/lib/dashboard/analytics";
import { attachActionStatesToStudents, sanitizeStudentActionState } from "@/lib/dashboard/action-helpers";
import type { SheetSnapshot } from "@/lib/dashboard/domain";
import {
  buildActiveStudentSet,
  buildDashboardStudents,
  buildExcludedPackageReasons,
  buildPendingDeductionContext,
  buildStudentAdminOwnershipMap,
  buildUpcomingSessionMap,
} from "@/lib/dashboard/packages";
import {
  loadWisenetFixtureSet,
  toDashboardSources,
} from "@/test/helpers/wisenet-to-dashboard-sources";

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

describe("dashboard logic port", () => {
  it("builds the same low-balance queue shape from sheet snapshots", () => {
    const today = new Date(2026, 2, 31);
    const aggregations = snapshot(
      "Aggregations",
      [
        "Student Name",
        "Parent Name",
        "Class Subject",
        "Current Remaining Credits",
        "Current Total Credits",
      ],
      [["Gina Ho", "Mira Ho", "Math", 1.5, 10]],
    );
    const students = snapshot("Students", ["student_name", "Remaining Credits"], [["Gina Ho", 1.5]]);
    const studentsCourses = snapshot(
      "Students & Courses",
      ["Student Name", "Student Full Name", "Class Subject"],
      [["Gina Ho", "Primary", "Math"]],
    );
    const remainingCredits = snapshot("RemainingCredits", ["Student", "Admin"], [["Gina Ho", "Chiraya (Palm) Takornkulwut"]]);
    const creditControl = snapshot(
      "Credit_Control",
      [
        "Student Name",
        "Package/Program",
        "final_status",
        "teacher_feedback",
        "credits_consumed",
        "session_duration",
        "session_date",
        "Should_Credit",
      ],
      [["Gina Ho", "Math", "ENDED", "", 0, 60, "2026-03-30", ""]],
    );
    const upcoming = snapshot(
      "Upcoming Sessions",
      ["Student Name", "Package/Program", "Session Status", "Session Duration", "Scheduled Date"],
      [["Gina Ho", "Math", "UPCOMING", 60, "2026-04-02"]],
    );

    const activeStudents = buildActiveStudentSet(students);
    const excluded = buildExcludedPackageReasons(studentsCourses);
    const ownership = buildStudentAdminOwnershipMap(remainingCredits);
    const pending = buildPendingDeductionContext(creditControl, activeStudents, excluded, today);
    const scheduled = buildUpcomingSessionMap(upcoming, activeStudents, excluded, today);
    const studentRecords = buildDashboardStudents(
      aggregations,
      activeStudents,
      excluded,
      pending,
      scheduled,
      today,
      ownership,
    );
    const dashboard = buildDashboardModel(
      studentRecords,
      { lastSnapshot: null, history: [] },
      today,
      new Date(2026, 2, 31, 12, 0, 0),
    );

    expect(dashboard.payload.studentQueue).toHaveLength(1);
    expect(dashboard.payload.studentQueue[0].student).toBe("Gina Ho");
    expect(dashboard.payload.studentQueue[0].worstStatus).toBe("notify");
    expect(dashboard.payload.studentQueue[0].adminOwnerKey).toBe("palm");
    expect(dashboard.payload.students[0].packages[0].pendingDeduction).toBe(1);
  });

  it("only surfaces same-day action state", () => {
    const today = new Date(2026, 2, 31);
    expect(
      sanitizeStudentActionState(
        {
          status: "contacted",
          updatedAt: "2026-03-31T09:00:00+07:00",
          updatedByName: "Palm",
          isToday: true,
        },
        today,
      ),
    ).not.toBeNull();

    expect(
      sanitizeStudentActionState(
        {
          status: "contacted",
          updatedAt: "2026-03-30T09:00:00+07:00",
          updatedByName: "Palm",
          isToday: true,
        },
        today,
      ),
    ).toBeNull();
  });

  it("merges action state onto students before queue rollup", () => {
    const today = new Date(2026, 2, 31);
    const studentRecords = [
      {
        student: "Jade Lim",
        parent: "Ivy Lim",
        adminOwnerKey: "palm" as const,
        adminOwnerName: "Palm",
        adminOwnershipSource: "resolved",
        dataQualityFlags: [],
        studentKey: "jade lim::ivy lim",
        actionState: null,
        packages: [
          {
            key: "Jade Lim|||Math",
            student: "Jade Lim",
            parent: "Ivy Lim",
            name: "Math",
            subject: "Math",
            currentRemaining: 4,
            pendingDeduction: 0,
            pendingDeductionDetails: [],
            pendingDeductionUsesFallback: false,
            adjustedRemaining: 4,
            totalCredits: 10,
            alertDate: "2026-04-05",
            exhaustDate: null,
            daysUntilAlert: 5,
            daysUntilExhaust: null,
            status: "watch" as const,
            projection: [],
            upcomingSessions: [{ date: "2026-04-02", durationMin: 60, deduct: 1 }],
            upcomingCount: 1,
            nextSessionDate: "2026-04-02",
            totalScheduledCredits: 1,
            sessionCadencePerWeek: 1,
            averageCreditsPerWeek: 1,
            cadenceLabel: "Steady",
            duplicateCount: 1,
            priorityScore: 0,
            recommendedAction: "",
            whyNow: "",
            statusChange: "new" as const,
            balanceDelta: null,
            dataQualityFlags: [],
            ruleContext: {
              included: true,
              exclusionReason: null,
              pendingDeductionApplied: false,
              pendingDeductionUsesFallback: false,
              projectionStatus: "watch" as const,
            },
          },
        ],
      },
    ];

    attachActionStatesToStudents(studentRecords, today, {
      "jade lim::ivy lim": {
        status: "contacted",
        updatedAt: "2026-03-31T10:00:00+07:00",
        updatedByName: "Palm",
        isToday: true,
      },
    });

    const dashboard = buildDashboardModel(
      studentRecords,
      { lastSnapshot: null, history: [] },
      today,
      new Date(2026, 2, 31, 12, 0, 0),
    );

    expect(dashboard.payload.students[0].actionState?.status).toBe("contacted");
    expect(dashboard.payload.studentQueue[0].actionState?.updatedByName).toBe("Palm");
  });
});

// TEST-02 parity gate — Wisenet fixtures fed through mappers into the SAME
// pipeline that the "dashboard logic port" block runs. If any assertion here
// fails, the fix goes in web/src/lib/wisenet/mappers.ts, not in this file
// (per D-24 facade parity rationale).
describe("wisenet parity (TEST-02)", () => {
  it("builds a valid dashboard payload when DashboardSources come from Wisenet mappers", async () => {
    const today = new Date(2026, 3, 21);
    const now = new Date(2026, 3, 21, 12, 0, 0);
    const fixtures = loadWisenetFixtureSet();
    const sources = await toDashboardSources(fixtures, today);

    // Run the SAME pipeline that the first block runs — with Wisenet-sourced snapshots.
    const activeStudents = buildActiveStudentSet(sources.students);
    const excluded = buildExcludedPackageReasons(sources.studentsCourses);
    const ownership = buildStudentAdminOwnershipMap(sources.remainingCredits);
    const pending = buildPendingDeductionContext(
      sources.creditControl,
      activeStudents,
      excluded,
      today,
    );
    const scheduled = buildUpcomingSessionMap(
      sources.upcoming,
      activeStudents,
      excluded,
      today,
    );
    const studentRecords = buildDashboardStudents(
      sources.aggregations,
      activeStudents,
      excluded,
      pending,
      scheduled,
      today,
      ownership,
    );
    const dashboard = buildDashboardModel(
      studentRecords,
      { lastSnapshot: null, history: [] },
      today,
      now,
    );

    // Parity gate shape assertions (same structure existing pipeline produces):
    expect(Array.isArray(dashboard.payload.studentQueue)).toBe(true);
    expect(typeof dashboard.payload.summary).toBe("object");
    expect(Array.isArray(dashboard.payload.students)).toBe(true);
    expect(Array.isArray(dashboard.payload.calendar?.days)).toBe(true);

    // Wisenet-derived sources produce at LEAST the same column contract Sheets does.
    expect(sources.aggregations.cols).toMatchObject({
      "Student Name": expect.any(Number),
      "Parent Name": expect.any(Number),
      "Class Subject": expect.any(Number),
      "Current Remaining Credits": expect.any(Number),
      "Current Total Credits": expect.any(Number),
    });
    expect(sources.creditControl.cols).toMatchObject({
      "Student Name": expect.any(Number),
      "Package/Program": expect.any(Number),
      final_status: expect.any(Number),
      teacher_feedback: expect.any(Number),
      credits_consumed: expect.any(Number),
      session_duration: expect.any(Number),
      session_date: expect.any(Number),
      Should_Credit: expect.any(Number),
    });
    expect(sources.upcoming.cols).toMatchObject({
      "Student Name": expect.any(Number),
      "Package/Program": expect.any(Number),
      "Session Status": expect.any(Number),
      "Session Duration": expect.any(Number),
      "Scheduled Date": expect.any(Number),
    });
    expect(sources.students.cols).toMatchObject({
      student_name: expect.any(Number),
      "Remaining Credits": expect.any(Number),
    });
    expect(sources.studentsCourses.cols).toMatchObject({
      "Student Name": expect.any(Number),
      "Student Full Name": expect.any(Number),
      "Class Subject": expect.any(Number),
    });
    expect(sources.remainingCredits.cols).toMatchObject({
      Student: expect.any(Number),
      Admin: expect.any(Number),
    });
  });

  it("passes buildActiveStudentSet without throwing on Wisenet-sourced Students snapshot", async () => {
    const today = new Date(2026, 3, 21);
    const fixtures = loadWisenetFixtureSet();
    const sources = await toDashboardSources(fixtures, today);
    // buildActiveStudentSet reads student_name + Remaining Credits columns;
    // mapper emits "N/A" for inactive students so the filter correctly excludes them.
    const activeStudents = buildActiveStudentSet(sources.students);
    expect(activeStudents).toBeInstanceOf(Set);
    // Fixture has a mix of activated=true/false students with no real sessions;
    // so the active set may be empty — what matters is that the call succeeds
    // and the set type round-trips through the contract.
    expect(() => activeStudents.forEach((s) => s.trim())).not.toThrow();
  });
});
