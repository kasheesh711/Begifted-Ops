// web/src/test/helpers/wisenet-to-dashboard-sources.ts
// TEST-02 fixture adapter per D-24.
// Calls composeDashboardSourcesFromData directly — no network, no mocked fetch.
//
// The 6 Phase 1 fixtures under web/src/test/fixtures/wisenet/*.json wrap the
// real Wisenet response inside a `body` property (the fixture also stores
// probe metadata like headers, timestamps). This adapter pulls `.body` out,
// parses it through the Zod schemas so drift is caught at helper load time,
// then hands the parsed data to the pure composer.

import {
  composeDashboardSourcesFromData,
  type WisenetMapperData,
} from "@/lib/wisenet/mappers";
import {
  WisenetStudentsListSchema,
  WisenetSessionsListSchema,
  WisenetStudentDetailSchema,
  type WisenetStudent,
  type WisenetSession,
  type WisenetStudentDetailResponse,
} from "@/lib/wisenet/types";
import type { DashboardSources } from "@/lib/dashboard/domain";
import studentsListFixture from "@/test/fixtures/wisenet/students_list_page1.json";
import pastSessionsFixture from "@/test/fixtures/wisenet/past_sessions_sample.json";
import upcomingSessionsFixture from "@/test/fixtures/wisenet/upcoming_sessions_sample.json";
import studentDetailFixture from "@/test/fixtures/wisenet/student_detail_sample.json";

export interface WisenetFixtureSet {
  students: WisenetStudent[];
  studentDetails: Map<string, WisenetStudentDetailResponse>;
  pastSessions: WisenetSession[];
  upcomingSessions: WisenetSession[];
  parentNamesById: Map<string, string>;
  teacherFeedbackBySessionId: Map<string, string>;
}

/**
 * Extract the real-API payload from a probe-wrapper fixture. The fixtures on
 * disk look like:
 *   { _note, _redaction, probed_at, endpoint, response_status, body: { status, message, data: { ... } } }
 * — the real Wisenet response lives under `.body`.
 */
function unwrap(fixture: unknown): unknown {
  if (fixture && typeof fixture === "object" && "body" in fixture) {
    return (fixture as { body: unknown }).body;
  }
  return fixture;
}

/**
 * Load the 4 usable Phase 1 resource fixtures into a WisenetFixtureSet.
 *
 * Notes on the 6 fixture set: students + past + upcoming + detail are parsed.
 * enrolment_detail and credit_balance fixtures are not needed for mapper
 * composition (the mapper derives class subject from students[].classrooms
 * and credit balance from past session duration sums).
 *
 * Synthetic studentDetails map: for every student in the list, graft the
 * single detail fixture's parentIds onto an _id-keyed entry. This is a
 * test-only simplification that lets us exercise the parent-name fallback
 * without 25 individual detail fixtures.
 *
 * Synthetic parentNamesById: each unique parentId → "Parent <id>".
 * Synthetic teacherFeedbackBySessionId: every past session → "" so the D-08
 * composite rule can fire on ENDED sessions.
 */
export function loadWisenetFixtureSet(): WisenetFixtureSet {
  const studentsBody = unwrap(studentsListFixture);
  const pastBody = unwrap(pastSessionsFixture);
  const upcomingBody = unwrap(upcomingSessionsFixture);
  const detailBody = unwrap(studentDetailFixture);

  const studentsResp = WisenetStudentsListSchema.parse(studentsBody);
  const pastResp = WisenetSessionsListSchema.parse(pastBody);
  const upcomingResp = WisenetSessionsListSchema.parse(upcomingBody);
  const detailResp = WisenetStudentDetailSchema.parse(detailBody);

  const students = studentsResp.data.students;
  const pastSessions = pastResp.data.sessions;
  const upcomingSessions = upcomingResp.data.sessions;

  // Graft detail fixture's parentIds onto each student (test-only shortcut —
  // 25 real detail calls would be prohibitive for fixtures).
  const studentDetails = new Map<string, WisenetStudentDetailResponse>();
  for (const s of students) {
    studentDetails.set(s._id, {
      ...detailResp,
      data: {
        ...detailResp.data,
        user: {
          _id: s._id,
          name: s.name,
          parentIds: detailResp.data.user.parentIds,
        },
      },
    });
  }

  // Synthetic parent name lookup: each unique parentId → "Parent <shortId>".
  const parentNamesById = new Map<string, string>();
  studentDetails.forEach((d) => {
    for (const pid of d.data.user.parentIds ?? []) {
      if (!parentNamesById.has(pid)) {
        parentNamesById.set(pid, `Parent ${pid.slice(-6)}`);
      }
    }
  });

  // Synthetic teacher feedback — all empty so D-08 pending-deduction fires on ENDED.
  const teacherFeedbackBySessionId = new Map<string, string>();
  for (const s of pastSessions) {
    teacherFeedbackBySessionId.set(s._id, "");
  }

  return {
    students,
    studentDetails,
    pastSessions,
    upcomingSessions,
    parentNamesById,
    teacherFeedbackBySessionId,
  };
}

/**
 * Produce DashboardSources from a WisenetFixtureSet, without network I/O.
 * Drives the TEST-02 parity describe block in dashboard-logic.test.ts.
 */
export async function toDashboardSources(
  fixtures: WisenetFixtureSet,
  today: Date,
): Promise<DashboardSources> {
  const data: WisenetMapperData = {
    students: fixtures.students,
    studentDetails: fixtures.studentDetails,
    pastSessions: fixtures.pastSessions,
    upcomingSessions: fixtures.upcomingSessions,
    parentNamesById: fixtures.parentNamesById,
    teacherFeedbackBySessionId: fixtures.teacherFeedbackBySessionId,
  };
  return composeDashboardSourcesFromData(data, today);
}
