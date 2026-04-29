// web/src/test/wisenet-coercion.test.ts
// TEST-05 — Zod boundary coercion tests (Pitfall #1/#2 mitigation).
//
// Proves the end-to-end guarantee: Wisenet returning "2" (string) for a numeric
// field propagates as 2 (number) through Zod at the boundary, and downstream
// mappers see real numbers without additional coercion.
//
// Parametric table per D-20: describe.each / it.each for the numeric coercion
// drift axis. Strict enum behavior (MeetingStatusSchema) is tested with
// explicit accept/reject cases.
//
// Integration assertion: composeDashboardSourcesFromData produces a snapshot
// where every Current Remaining Credits cell is typeof "number" — confirms the
// coerced value survives the mapper pipeline (Aggregations derive-client path).
//
// Source schemas live at web/src/lib/wisenet/types.ts (Plan 02-02).
// Source mappers live at web/src/lib/wisenet/mappers.ts (Plan 02-04).

import { describe, expect, it } from "vitest";
import {
  MeetingStatusSchema,
  WisenetSessionCreditsSchema,
  WisenetSessionsListSchema,
  WisenetStudentsListSchema,
} from "@/lib/wisenet/types";
import {
  composeDashboardSourcesFromData,
  durationMsToMinutes,
  shouldCountAsPendingDeductionWisenet,
  type WisenetMapperData,
} from "@/lib/wisenet/mappers";

// ---------- Builders ---------------------------------------------------------

function sessionsEnvelope(sessions: unknown[], count?: unknown) {
  return {
    status: 200,
    message: "ok",
    data: count === undefined ? { sessions } : { sessions, count },
  };
}

function baseSessionRaw(overrides: Record<string, unknown> = {}) {
  return {
    _id: "s1",
    classId: { _id: "c1", name: "Math", subject: "Math" },
    userId: { _id: "u1", name: "Teacher" },
    scheduledStartTime: "2026-04-21T09:00:00Z",
    meetingStatus: "ENDED",
    duration: 3_600_000,
    students: ["st1"],
    ...overrides,
  };
}

// ---------- z.coerce.number() parametric table ------------------------------

describe("TEST-05 — z.coerce.number() parametric table at WisenetSessionsListSchema boundary", () => {
  // Pitfall #1/#2 demonstration: the string "2" and the number 2 both land as 2.
  // Integer + decimal + zero + wide values all normalize identically, confirming
  // that any drift between a stringly-typed and numeric Wisenet response has
  // no downstream consequence.
  const acceptedDurationCases: Array<[string | number, number]> = [
    ["2", 2],
    [2, 2],
    ["2.5", 2.5],
    [2.5, 2.5],
    ["0", 0],
    [0, 0],
    ["3600000", 3_600_000],
    [3_600_000, 3_600_000],
  ];

  it.each(acceptedDurationCases)(
    "duration input %o → parsed as %o (string/number equivalence)",
    (raw, expected) => {
      const payload = sessionsEnvelope([baseSessionRaw({ duration: raw })]);
      const parsed = WisenetSessionsListSchema.parse(payload);
      expect(parsed.data.sessions[0].duration).toBe(expected);
      expect(typeof parsed.data.sessions[0].duration).toBe("number");
    },
  );

  // Non-numeric strings + non-coercible objects must FAIL at the Zod boundary
  // so they never reach the mapper as a silent NaN value.
  // Note: JS's Number() coerces [] → 0 and "  " → 0 (truthy falls-through), so
  // Zod's coerce accepts them too. That is NOT in this rejection list — see
  // the "documented surprising coercions" block below for the pinned record.
  const rejectedDurationCases: Array<unknown> = ["NaN", "abc", {}];

  it.each(rejectedDurationCases.map((v) => [v]))(
    "duration input %o rejected by z.coerce.number()",
    (raw) => {
      const payload = sessionsEnvelope([baseSessionRaw({ duration: raw })]);
      expect(() => WisenetSessionsListSchema.parse(payload)).toThrow();
    },
  );

  // Documented surprising coercions — we pin them so future z.coerce.number()
  // semantics drift (e.g. Zod v4 upgrade) fails loudly here rather than silently
  // corrupting durations. Wisenet is NOT expected to ever send these shapes;
  // the test just guards against library-upgrade surprises.
  it.each([
    [[], 0],
    ["  ", 0],
    [null, 0],
  ])(
    "documented surprising coercion: duration input %o → %o (JS Number() semantics)",
    (raw, expected) => {
      const payload = sessionsEnvelope([baseSessionRaw({ duration: raw })]);
      const parsed = WisenetSessionsListSchema.parse(payload);
      expect(parsed.data.sessions[0].duration).toBe(expected);
    },
  );

  it("omitted count → schema default 0 kicks in", () => {
    const payload = sessionsEnvelope([], undefined);
    const parsed = WisenetSessionsListSchema.parse(payload);
    expect(parsed.data.count).toBe(0);
  });

  it('string count "42" → coerced to number 42', () => {
    const payload = sessionsEnvelope([], "42");
    const parsed = WisenetSessionsListSchema.parse(payload);
    expect(parsed.data.count).toBe(42);
    expect(typeof parsed.data.count).toBe("number");
  });

  it("omitted duration on a session parses cleanly (optional per mapper contract)", () => {
    const payload = sessionsEnvelope([
      {
        _id: "s1",
        classId: { _id: "c1", name: "Math", subject: "Math" },
        userId: { _id: "u1", name: "T" },
        scheduledStartTime: "2026-04-21T09:00:00Z",
        meetingStatus: "CANCELLED",
        students: ["st1"],
        // no duration key
      },
    ]);
    const parsed = WisenetSessionsListSchema.parse(payload);
    expect(parsed.data.sessions[0].duration).toBeUndefined();
  });
});

// ---------- z.coerce.date() at scheduledStartTime ----------------------------

describe("TEST-05 — z.coerce.date() normalizes ISO strings to Date objects", () => {
  it("ISO string → Date instance", () => {
    const payload = sessionsEnvelope([
      baseSessionRaw({ scheduledStartTime: "2026-04-21T10:00:00Z" }),
    ]);
    const parsed = WisenetSessionsListSchema.parse(payload);
    expect(parsed.data.sessions[0].scheduledStartTime).toBeInstanceOf(Date);
    expect(parsed.data.sessions[0].scheduledStartTime.toISOString()).toBe(
      "2026-04-21T10:00:00.000Z",
    );
  });

  it("invalid date string is rejected", () => {
    const payload = sessionsEnvelope([
      baseSessionRaw({ scheduledStartTime: "not-a-date" }),
    ]);
    expect(() => WisenetSessionsListSchema.parse(payload)).toThrow();
  });
});

// ---------- MeetingStatusSchema — strict z.enum, no coercion ----------------

describe("TEST-05 — MeetingStatusSchema is strict (not case-insensitive, not coerced)", () => {
  it.each(["ENDED", "CANCELLED", "UPCOMING", "IN_PROGRESS"] as const)(
    "accepts exact enum value %s",
    (value) => {
      expect(MeetingStatusSchema.parse(value)).toBe(value);
    },
  );

  it.each(["ended", "Cancelled", "END", "UNKNOWN", "", " ENDED "])(
    "rejects non-enum value %o (enum is strict — not case-insensitive, not trimmed)",
    (value) => {
      expect(() => MeetingStatusSchema.parse(value)).toThrow();
    },
  );
});

// ---------- WisenetSessionCreditsSchema — optional numeric fields -----------

describe("TEST-05 — WisenetSessionCreditsSchema tolerates missing optional fields + coerces numerics", () => {
  it("envelope with empty data object parses (400-state fixture shape)", () => {
    const payload = { status: 400, message: "Student not found", data: {} };
    const parsed = WisenetSessionCreditsSchema.parse(payload);
    expect(parsed.status).toBe(400);
    expect(parsed.data.total).toBeUndefined();
    expect(parsed.data.remaining).toBeUndefined();
    expect(parsed.data.consumed).toBeUndefined();
  });

  it("coerces numeric string fields (total, remaining, consumed) to numbers", () => {
    const payload = {
      status: 200,
      message: "ok",
      data: { total: "10", remaining: "3.5", consumed: "6.5" },
    };
    const parsed = WisenetSessionCreditsSchema.parse(payload);
    expect(parsed.data.total).toBe(10);
    expect(parsed.data.remaining).toBe(3.5);
    expect(parsed.data.consumed).toBe(6.5);
    expect(typeof parsed.data.total).toBe("number");
    expect(typeof parsed.data.remaining).toBe("number");
    expect(typeof parsed.data.consumed).toBe("number");
  });

  it("rejects non-numeric credit strings so NaN never reaches the mapper", () => {
    const payload = {
      status: 200,
      message: "ok",
      data: { total: "abc" },
    };
    expect(() => WisenetSessionCreditsSchema.parse(payload)).toThrow();
  });
});

// ---------- z.coerce.boolean() at activated -------------------------------

describe("TEST-05 — z.coerce.boolean() on WisenetStudentSchema.activated", () => {
  // Zod v3 z.coerce.boolean() uses Boolean() truthiness semantics:
  //   - true / "true" / "false" / 1 / any non-empty string → true
  //   - false / 0 / "" → false
  // This is DOCUMENTED behavior — we pin it so any future schema drift
  // (e.g. swapping in z.preprocess for a stricter parser) trips this test.
  it("native booleans pass through unchanged", () => {
    const payload = {
      status: 200,
      message: "ok",
      data: {
        students: [
          { _id: "a", name: "A", uuid: "ua", activated: true },
          { _id: "b", name: "B", uuid: "ub", activated: false },
        ],
        count: 2,
      },
    };
    const parsed = WisenetStudentsListSchema.parse(payload);
    expect(parsed.data.students[0].activated).toBe(true);
    expect(parsed.data.students[1].activated).toBe(false);
  });

  it("numeric coercion matches Boolean() semantics (1 → true, 0 → false)", () => {
    const payload = {
      status: 200,
      message: "ok",
      data: {
        students: [
          { _id: "a", name: "A", uuid: "ua", activated: 1 },
          { _id: "b", name: "B", uuid: "ub", activated: 0 },
        ],
        count: 2,
      },
    };
    const parsed = WisenetStudentsListSchema.parse(payload);
    expect(parsed.data.students[0].activated).toBe(true);
    expect(parsed.data.students[1].activated).toBe(false);
  });
});

// ---------- Whitespace trimming on name ------------------------------------

describe("TEST-05 — z.coerce.string().trim() on student name", () => {
  it("leading/trailing whitespace on student.name is trimmed", () => {
    const payload = {
      status: 200,
      message: "ok",
      data: {
        students: [{ _id: "a", name: "  Alice  ", uuid: "ua", activated: true }],
        count: 1,
      },
    };
    const parsed = WisenetStudentsListSchema.parse(payload);
    expect(parsed.data.students[0].name).toBe("Alice");
  });
});

// ---------- End-to-end: coerced numbers flow through the mapper pipeline ----

describe("TEST-05 — mapper propagates coerced numbers end-to-end (Aggregations snapshot)", () => {
  it("durationMsToMinutes accepts a coerced-from-string duration as a real number", () => {
    // Zod will have converted "3600000" → 3_600_000 at the boundary before the
    // mapper ever sees it. This assertion pins the contract: if that coercion
    // silently regressed and a string leaked through, durationMsToMinutes
    // returns 0 (NaN guard), which would cascade into a zero Aggregations row.
    expect(durationMsToMinutes(3_600_000)).toBe(60);
    expect(durationMsToMinutes(Number("3600000"))).toBe(60);
    expect(durationMsToMinutes(Number("not-a-number"))).toBe(0);
  });

  it("D-08 pending-deduction rule evaluates a coerced numeric duration as truthy", () => {
    expect(shouldCountAsPendingDeductionWisenet("ENDED", "", 3_600_000)).toBe(true);
    // 0 ms (CANCELLED / no-show semantics) → false even with empty feedback
    expect(shouldCountAsPendingDeductionWisenet("ENDED", "", 0)).toBe(false);
  });

  it("composeDashboardSourcesFromData produces numeric Remaining Credits cells when duration is number-typed", () => {
    const today = new Date(Date.UTC(2026, 3, 21));
    const data: WisenetMapperData = {
      students: [
        {
          _id: "st1",
          name: "Alice",
          uuid: "alice-uuid",
          activated: true,
          tags: [],
          parents: [],
          classrooms: [
            { _id: "c1", name: "Math 101", subject: "Math" },
          ],
        },
      ],
      studentDetails: new Map(),
      pastSessions: [
        {
          _id: "se1",
          classId: { _id: "c1", name: "Math 101", subject: "Math" },
          userId: { _id: "u1", name: "T" },
          scheduledStartTime: new Date(Date.UTC(2026, 3, 1)),
          meetingStatus: "ENDED",
          duration: 3_600_000, // coerced-from-string in a real call path
          students: ["st1"],
        },
      ],
      upcomingSessions: [],
      parentNamesById: new Map(),
      teacherFeedbackBySessionId: new Map([["se1", ""]]),
    };

    const sources = composeDashboardSourcesFromData(data, today);
    const remainingCol = sources.aggregations.cols["Current Remaining Credits"];
    const totalCol = sources.aggregations.cols["Current Total Credits"];
    expect(sources.aggregations.rows.length).toBeGreaterThan(0);
    for (const row of sources.aggregations.rows) {
      expect(typeof row[remainingCol]).toBe("number");
      expect(typeof row[totalCol]).toBe("number");
    }
  });

  it("end-to-end: raw Wisenet payload with string duration → Aggregations row has numeric credits", () => {
    const payload = sessionsEnvelope([
      baseSessionRaw({ duration: "3600000", students: ["st1"] }),
    ]);
    const parsed = WisenetSessionsListSchema.parse(payload);
    const session = parsed.data.sessions[0];
    // Post-Zod, duration is a real number — proving string "3600000" traveled
    // through the boundary cleanly and is now mapper-ready.
    expect(typeof session.duration).toBe("number");
    expect(session.duration).toBe(3_600_000);

    const today = new Date(Date.UTC(2026, 3, 21));
    const data: WisenetMapperData = {
      students: [
        {
          _id: "st1",
          name: "Alice",
          uuid: "alice-uuid",
          activated: true,
          tags: [],
          parents: [],
          classrooms: [{ _id: "c1", name: "Math", subject: "Math" }],
        },
      ],
      studentDetails: new Map(),
      pastSessions: [session],
      upcomingSessions: [],
      parentNamesById: new Map(),
      teacherFeedbackBySessionId: new Map([[session._id, ""]]),
    };

    const sources = composeDashboardSourcesFromData(data, today);
    const remCol = sources.aggregations.cols["Current Remaining Credits"];
    expect(typeof sources.aggregations.rows[0][remCol]).toBe("number");
  });
});
