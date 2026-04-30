// web/src/test/wisenet-mappers.test.ts
// WCLI-06 coverage — field transforms + D-08 pending-deduction + active-student
// predicate + snapshot shape + FLAG-2 non-zero Aggregations verification.
//
// All tests exercise the pure composeDashboardSourcesFromData path; no network,
// no mocked fetch. The fixture adapter helper uses Phase 1 JSON fixtures
// parsed through the Zod schemas.

import { describe, expect, it } from "vitest";
import {
  composeDashboardSourcesFromData,
  coerceMeetingStatusToFinalStatus,
  durationMsToMinutes,
  shouldCountAsPendingDeductionWisenet,
  isActiveStudent,
  type WisenetMapperData,
} from "@/lib/wisenet/mappers";
import type { WisenetStudent, WisenetSession } from "@/lib/wisenet/types";
import {
  loadWisenetFixtureSet,
  toDashboardSources,
} from "@/test/helpers/wisenet-to-dashboard-sources";

function emptyData(): WisenetMapperData {
  return {
    students: [],
    studentDetails: new Map(),
    pastSessions: [],
    upcomingSessions: [],
    parentNamesById: new Map(),
    teacherFeedbackBySessionId: new Map(),
  };
}

function mkStudent(overrides: Partial<WisenetStudent> & { _id: string; name: string }): WisenetStudent {
  // Defaults computed from overrides._id/.name; spread last so explicit overrides win.
  return {
    uuid: overrides.uuid ?? `${overrides._id}-uuid`,
    activated: overrides.activated ?? true,
    tags: overrides.tags ?? [],
    parents: overrides.parents ?? [],
    classrooms: overrides.classrooms ?? [],
    ...overrides,
  } as WisenetStudent;
}

function mkSession(overrides: {
  _id: string;
  classId?: { _id: string; name: string; subject: string };
  scheduledStartTime: Date;
  meetingStatus: WisenetSession["meetingStatus"];
  duration?: number;
  students: string[];
}): WisenetSession {
  return {
    _id: overrides._id,
    classId: overrides.classId ?? { _id: "class-1", name: "Math", subject: "Math" },
    userId: { _id: "teacher-1", name: "Teacher" },
    scheduledStartTime: overrides.scheduledStartTime,
    meetingStatus: overrides.meetingStatus,
    duration: overrides.duration,
    students: overrides.students,
  } as WisenetSession;
}

// ---------- Field transforms ----------

describe("coerceMeetingStatusToFinalStatus", () => {
  it("passes through ENDED", () => {
    expect(coerceMeetingStatusToFinalStatus("ENDED")).toBe("ENDED");
  });
  it("uppercases lowercase cancelled", () => {
    expect(coerceMeetingStatusToFinalStatus("cancelled")).toBe("CANCELLED");
  });
  it("returns empty for empty input", () => {
    expect(coerceMeetingStatusToFinalStatus("")).toBe("");
  });
});

describe("durationMsToMinutes", () => {
  it("converts 1 hour to 60 minutes", () => {
    expect(durationMsToMinutes(3_600_000)).toBe(60);
  });
  it("converts 30 minutes to 30", () => {
    expect(durationMsToMinutes(1_800_000)).toBe(30);
  });
  it("returns 0 for zero", () => {
    expect(durationMsToMinutes(0)).toBe(0);
  });
  it("returns 0 for negative", () => {
    expect(durationMsToMinutes(-1)).toBe(0);
  });
  it("returns 0 for NaN", () => {
    expect(durationMsToMinutes(Number.NaN)).toBe(0);
  });
  it("returns 0 for undefined (13/50 fixture sessions omit duration)", () => {
    expect(durationMsToMinutes(undefined)).toBe(0);
  });
});

// ---------- D-08 pending-deduction composite rule ----------

describe("D-08 shouldCountAsPendingDeductionWisenet", () => {
  it.each<[string, string, number | undefined, boolean]>([
    ["ENDED", "", 3_600_000, true],
    ["ENDED", "good progress", 3_600_000, false],
    ["CANCELLED", "", 3_600_000, false],
    ["UPCOMING", "", 3_600_000, false],
    ["IN_PROGRESS", "", 3_600_000, false],
    ["ENDED", "", 0, false],
    ["ENDED", "", undefined, false],
    ["ENDED", "   ", 3_600_000, true],
    ["ENDED", "\t\n ", 3_600_000, true],
  ])(
    "meetingStatus=%s feedback=%j duration=%s → %s",
    (status, fb, dur, expected) => {
      expect(shouldCountAsPendingDeductionWisenet(status, fb, dur)).toBe(expected);
    },
  );
});

// ---------- isActiveStudent (RED RemainingCredits predicate) ----------

describe("isActiveStudent", () => {
  const today = new Date(2026, 3, 21); // 2026-04-21

  it("returns false when activated=false regardless of sessions", () => {
    const s = mkStudent({ _id: "s1", name: "Alice", activated: false });
    const past = new Map<string, WisenetSession[]>([
      [
        "s1",
        [
          mkSession({
            _id: "se1",
            scheduledStartTime: new Date(2026, 3, 11),
            meetingStatus: "ENDED",
            duration: 3_600_000,
            students: ["s1"],
          }),
        ],
      ],
    ]);
    expect(isActiveStudent(s, today, past, new Map())).toBe(false);
  });

  it("returns true when activated + past session within 90 days", () => {
    const s = mkStudent({ _id: "s1", name: "Alice", activated: true });
    const past = new Map<string, WisenetSession[]>([
      [
        "s1",
        [
          mkSession({
            _id: "se1",
            scheduledStartTime: new Date(2026, 2, 7), // ~45d ago
            meetingStatus: "ENDED",
            duration: 3_600_000,
            students: ["s1"],
          }),
        ],
      ],
    ]);
    expect(isActiveStudent(s, today, past, new Map())).toBe(true);
  });

  it("returns true when activated + upcoming session exists", () => {
    const s = mkStudent({ _id: "s1", name: "Alice", activated: true });
    const upcoming = new Map<string, WisenetSession[]>([
      [
        "s1",
        [
          mkSession({
            _id: "se-up",
            scheduledStartTime: new Date(2026, 3, 26),
            meetingStatus: "UPCOMING",
            students: ["s1"],
          }),
        ],
      ],
    ]);
    expect(isActiveStudent(s, today, new Map(), upcoming)).toBe(true);
  });

  it("returns false when activated but past session > 90 days ago and no upcoming", () => {
    const s = mkStudent({ _id: "s1", name: "Alice", activated: true });
    const past = new Map<string, WisenetSession[]>([
      [
        "s1",
        [
          mkSession({
            _id: "se-old",
            scheduledStartTime: new Date(2025, 11, 1), // ~140 days ago
            meetingStatus: "ENDED",
            duration: 3_600_000,
            students: ["s1"],
          }),
        ],
      ],
    ]);
    expect(isActiveStudent(s, today, past, new Map())).toBe(false);
  });
});

// ---------- Snapshot shape + D-05 / D-06 enforcement ----------

describe("composeDashboardSourcesFromData", () => {
  const today = new Date(2026, 3, 21);

  it("produces all 6 snapshots with correct sheetNames + REQUIRED_COLUMNS headers", () => {
    const sources = composeDashboardSourcesFromData(emptyData(), today);

    expect(sources.aggregations.sheetName).toBe("Aggregations");
    expect(Object.keys(sources.aggregations.cols)).toEqual([
      "Student Name",
      "Parent Name",
      "Class Subject",
      "Current Remaining Credits",
      "Current Total Credits",
    ]);

    expect(sources.creditControl.sheetName).toBe("Credit_Control");
    expect(Object.keys(sources.creditControl.cols)).toEqual([
      "Student Name",
      "Package/Program",
      "final_status",
      "teacher_feedback",
      "credits_consumed",
      "session_duration",
      "session_date",
      "Should_Credit",
    ]);

    expect(sources.upcoming.sheetName).toBe("Upcoming Sessions");
    expect(Object.keys(sources.upcoming.cols)).toEqual([
      "Student Name",
      "Package/Program",
      "Session Status",
      "Session Duration",
      "Scheduled Date",
    ]);

    expect(sources.students.sheetName).toBe("Students");
    expect(Object.keys(sources.students.cols)).toEqual([
      "student_name",
      "Remaining Credits",
    ]);

    expect(sources.studentsCourses.sheetName).toBe("Students & Courses");
    expect(Object.keys(sources.studentsCourses.cols)).toEqual([
      "Student Name",
      "Student Full Name",
      "Class Subject",
    ]);

    expect(sources.remainingCredits.sheetName).toBe("RemainingCredits");
    expect(Object.keys(sources.remainingCredits.cols)).toEqual(["Student", "Admin"]);
  });

  it("empty inputs produce valid empty snapshots (never throws)", () => {
    const sources = composeDashboardSourcesFromData(emptyData(), today);
    expect(sources.aggregations.rows).toEqual([]);
    expect(sources.creditControl.rows).toEqual([]);
    expect(sources.upcoming.rows).toEqual([]);
    expect(sources.students.rows).toEqual([]);
    expect(sources.studentsCourses.rows).toEqual([]);
    expect(sources.remainingCredits.rows).toEqual([]);
  });

  it("D-05: Credit_Control Should_Credit cell is empty string for every row", () => {
    const student = mkStudent({
      _id: "s1",
      name: "Alice",
      classrooms: [{ _id: "c1", name: "Math", subject: "Math" }],
    });
    const session = mkSession({
      _id: "se1",
      scheduledStartTime: new Date(2026, 3, 1),
      meetingStatus: "ENDED",
      duration: 3_600_000,
      students: ["s1"],
    });
    const data: WisenetMapperData = {
      ...emptyData(),
      students: [student],
      pastSessions: [session],
      teacherFeedbackBySessionId: new Map([["se1", ""]]),
    };
    const sources = composeDashboardSourcesFromData(data, today);
    const shouldCreditIdx = sources.creditControl.cols["Should_Credit"];
    expect(sources.creditControl.rows.length).toBeGreaterThan(0);
    sources.creditControl.rows.forEach((row) => {
      expect(row[shouldCreditIdx]).toBe("");
    });
  });

  it("D-05: credit_control final_status uppercases meetingStatus 1:1", () => {
    const student = mkStudent({ _id: "s1", name: "Alice" });
    const session = mkSession({
      _id: "se1",
      scheduledStartTime: new Date(2026, 3, 1),
      meetingStatus: "ENDED",
      duration: 3_600_000,
      students: ["s1"],
    });
    const data: WisenetMapperData = {
      ...emptyData(),
      students: [student],
      pastSessions: [session],
    };
    const sources = composeDashboardSourcesFromData(data, today);
    const finalStatusIdx = sources.creditControl.cols["final_status"];
    expect(sources.creditControl.rows[0][finalStatusIdx]).toBe("ENDED");
  });

  it("credit_control credits_consumed derived from duration / 3_600_000 for ENDED", () => {
    const student = mkStudent({ _id: "s1", name: "Alice" });
    const session = mkSession({
      _id: "se1",
      scheduledStartTime: new Date(2026, 3, 1),
      meetingStatus: "ENDED",
      duration: 1_800_000, // 0.5 hours
      students: ["s1"],
    });
    const data: WisenetMapperData = {
      ...emptyData(),
      students: [student],
      pastSessions: [session],
    };
    const sources = composeDashboardSourcesFromData(data, today);
    const consumedIdx = sources.creditControl.cols["credits_consumed"];
    expect(sources.creditControl.rows[0][consumedIdx]).toBe(0.5);
  });

  it("credit_control handles missing duration as 0 consumed", () => {
    const student = mkStudent({ _id: "s1", name: "Alice" });
    const session = mkSession({
      _id: "se1",
      scheduledStartTime: new Date(2026, 3, 1),
      meetingStatus: "ENDED",
      duration: undefined, // 13/50 fixtures omit this
      students: ["s1"],
    });
    const data: WisenetMapperData = {
      ...emptyData(),
      students: [student],
      pastSessions: [session],
    };
    const sources = composeDashboardSourcesFromData(data, today);
    const consumedIdx = sources.creditControl.cols["credits_consumed"];
    const durationIdx = sources.creditControl.cols["session_duration"];
    expect(sources.creditControl.rows[0][consumedIdx]).toBe(0);
    expect(sources.creditControl.rows[0][durationIdx]).toBe(0);
  });

  it("D-06: RemainingCredits Admin column is empty string in Phase 2", () => {
    const student = mkStudent({ _id: "s1", name: "Alice" });
    const data: WisenetMapperData = {
      ...emptyData(),
      students: [student],
    };
    const sources = composeDashboardSourcesFromData(data, today);
    const adminIdx = sources.remainingCredits.cols["Admin"];
    expect(sources.remainingCredits.rows).toHaveLength(1);
    expect(sources.remainingCredits.rows[0][adminIdx]).toBe("");
    expect(sources.remainingCredits.rows[0][sources.remainingCredits.cols["Student"]]).toBe(
      "Alice",
    );
  });

  it("Upcoming snapshot drops non-upcoming rows via meetingStatus coercion downstream", () => {
    // The mapper emits all upcoming sessions as rows; the downstream
    // buildUpcomingSessionMap filters on Session Status === "UPCOMING".
    // Here we verify the mapper correctly coerces UPCOMING → UPCOMING and
    // IN_PROGRESS → IN_PROGRESS so the downstream filter behaves as expected.
    const student = mkStudent({ _id: "s1", name: "Alice" });
    const sessionUpcoming = mkSession({
      _id: "up1",
      scheduledStartTime: new Date(2026, 3, 26),
      meetingStatus: "UPCOMING",
      duration: 3_600_000,
      students: ["s1"],
    });
    const sessionInProgress = mkSession({
      _id: "ip1",
      scheduledStartTime: new Date(2026, 3, 22),
      meetingStatus: "IN_PROGRESS",
      duration: 3_600_000,
      students: ["s1"],
    });
    const data: WisenetMapperData = {
      ...emptyData(),
      students: [student],
      upcomingSessions: [sessionUpcoming, sessionInProgress],
    };
    const sources = composeDashboardSourcesFromData(data, today);
    const statusIdx = sources.upcoming.cols["Session Status"];
    const statuses = sources.upcoming.rows.map((r) => r[statusIdx]);
    expect(statuses).toEqual(["UPCOMING", "IN_PROGRESS"]);
  });

  it("Students snapshot emits 'N/A' for inactive students so buildActiveStudentSet filters them out", () => {
    const active = mkStudent({ _id: "s1", name: "Alice", activated: true });
    const inactive = mkStudent({ _id: "s2", name: "Bob", activated: false });
    const data: WisenetMapperData = {
      ...emptyData(),
      students: [active, inactive],
      upcomingSessions: [
        mkSession({
          _id: "up1",
          scheduledStartTime: new Date(2026, 3, 26),
          meetingStatus: "UPCOMING",
          students: ["s1"],
        }),
      ],
    };
    const sources = composeDashboardSourcesFromData(data, today);
    const nameIdx = sources.students.cols["student_name"];
    const remIdx = sources.students.cols["Remaining Credits"];
    const byName = Object.fromEntries(
      sources.students.rows.map((r) => [r[nameIdx], r[remIdx]]),
    );
    expect(byName.Alice).not.toBe("N/A");
    expect(byName.Bob).toBe("N/A");
  });

  it("Students snapshot emits 'N/A' for active students with NO sessions", () => {
    // activated=true but no past/upcoming → isActiveStudent returns false
    // → Remaining = "N/A"
    const student = mkStudent({ _id: "s1", name: "Alice", activated: true });
    const data: WisenetMapperData = {
      ...emptyData(),
      students: [student],
    };
    const sources = composeDashboardSourcesFromData(data, today);
    const remIdx = sources.students.cols["Remaining Credits"];
    expect(sources.students.rows[0][remIdx]).toBe("N/A");
  });

  it("FLAG-2: Aggregations credit balance is non-zero for fixture with ENDED sessions (D-07)", () => {
    // Mapper must produce a non-zero Current Total Credits for at least one
    // fixture case — otherwise Aggregations rows would all show zero balance
    // and the downstream notify/watch status would never fire.
    const student = mkStudent({ _id: "s1", name: "Alice" });
    const endedA = mkSession({
      _id: "se-a",
      scheduledStartTime: new Date(2026, 3, 1),
      meetingStatus: "ENDED",
      duration: 3_600_000, // 1h
      students: ["s1"],
    });
    const endedB = mkSession({
      _id: "se-b",
      scheduledStartTime: new Date(2026, 3, 5),
      meetingStatus: "ENDED",
      duration: 1_800_000, // 0.5h
      students: ["s1"],
    });
    const upcoming = mkSession({
      _id: "up-a",
      scheduledStartTime: new Date(2026, 3, 26),
      meetingStatus: "UPCOMING",
      students: ["s1"],
    });
    const data: WisenetMapperData = {
      ...emptyData(),
      students: [student],
      pastSessions: [endedA, endedB],
      upcomingSessions: [upcoming],
    };
    const sources = composeDashboardSourcesFromData(data, today);
    const nameIdx = sources.aggregations.cols["Student Name"];
    const remainingIdx = sources.aggregations.cols["Current Remaining Credits"];
    const totalIdx = sources.aggregations.cols["Current Total Credits"];
    const row = sources.aggregations.rows.find((r) => r[nameIdx] === "Alice");
    expect(row).toBeDefined();
    expect(Number(row![totalIdx])).toBeGreaterThan(0);
    // Phase 2 session-count proxy: totalHours = max(2 ENDED + 1 upcoming, 1.5)
    // = 3. consumedHours = 1.5 (1h + 0.5h). remaining = 1.5.
    expect(Number(row![totalIdx])).toBe(3);
    expect(Number(row![remainingIdx])).toBe(1.5);
  });

  it("Parent-name fallback: empty parentIds → empty parent cell (missing-parent downstream)", () => {
    const student = mkStudent({ _id: "s1", name: "Alice" });
    const data: WisenetMapperData = {
      ...emptyData(),
      students: [student],
      // No studentDetails entry → parentNameFor returns ""
    };
    const sources = composeDashboardSourcesFromData(data, today);
    const parentIdx = sources.aggregations.cols["Parent Name"];
    expect(sources.aggregations.rows[0][parentIdx]).toBe("");
  });
});

// ---------- Fixture adapter integration ----------

describe("toDashboardSources test helper", () => {
  const today = new Date(2026, 3, 21);

  it("builds DashboardSources from fixture set without network", async () => {
    const fixtures = loadWisenetFixtureSet();
    const sources = await toDashboardSources(fixtures, today);

    // All 6 snapshots present and named correctly.
    expect(sources.aggregations.sheetName).toBe("Aggregations");
    expect(sources.creditControl.sheetName).toBe("Credit_Control");
    expect(sources.upcoming.sheetName).toBe("Upcoming Sessions");
    expect(sources.students.sheetName).toBe("Students");
    expect(sources.studentsCourses.sheetName).toBe("Students & Courses");
    expect(sources.remainingCredits.sheetName).toBe("RemainingCredits");

    // Students fixture has 25 entries; Aggregations + RemainingCredits should
    // have one row per student.
    expect(sources.aggregations.rows.length).toBe(fixtures.students.length);
    expect(sources.remainingCredits.rows.length).toBe(fixtures.students.length);
  });

  it("fixture-derived Credit_Control preserves D-05 Should_Credit empty-string rule", async () => {
    const fixtures = loadWisenetFixtureSet();
    const sources = await toDashboardSources(fixtures, today);
    const shouldCreditIdx = sources.creditControl.cols["Should_Credit"];
    sources.creditControl.rows.forEach((row) => {
      expect(row[shouldCreditIdx]).toBe("");
    });
  });
});
