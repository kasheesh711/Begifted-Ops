// web/src/lib/wisenet/mappers.ts
// Per WISENET_FIELD_MAP.md — each field-map row becomes a mapper branch.
// Per RESEARCH.md §Pitfall 7 — split into network entry + pure composer so
// tests skip network (D-24 facade parity gate).
//
// Two entry points exported:
//   - buildDashboardSourcesFromWisenet(today, options) — production, calls endpoints.
//   - composeDashboardSourcesFromData(data, today, options) — pure function
//     tests use directly with pre-fetched fixture data (no network mocking).
//
// D-05 enforcement: Should_Credit column header preserved in Credit_Control
// snapshot, but every row's Should_Credit cell is "".
// D-06 enforcement: RemainingCredits Admin cells left "" — Phase 3 service.ts
// joins bulkGetAdminOwnership after composing.
// D-07 enforcement: Aggregations Current Remaining/Total Credits derived
// client-side from past ENDED session duration sums. Phase 2 uses
// session-count proxy for totalHours (derive-client decision).
// D-08 enforcement: shouldCountAsPendingDeductionWisenet composite rule
// (meetingStatus=ENDED AND teacherFeedback empty AND duration > 0).
// D-18 enforcement: 2-step parent join — getStudent(id).parentIds →
// getParents(ids) — with p-limit(TEACHER_FEEDBACK_CONCURRENCY) fan-out cap.
// D-19 enforcement: teacher-feedback N+1 fan-out bounded by p-limit(5).
//
// Threat mitigations:
//  T-02-16 Tampering: Should_Credit empty-string assertion in Credit_Control
//    snapshot preserves column header so downstream parseNumber() still works.
//  T-02-17 PII: teacherFeedback pass-through accepts operator free-text.
//  T-02-18 DoS: p-limit(5) bounds class-detail + teacher-feedback fan-out.
//  T-02-19 Tampering: Admin column empty in Phase 2 — Phase 3 joins DB.
//  T-02-20 EoP: lib/wisenet/* only imported by Phase 3 service.ts (server-only).

import pLimit from "p-limit";
import {
  getStudents,
  getStudent,
  getParents,
  getPastSessions,
  getUpcomingSessions,
} from "./endpoints";
import { wisenetFetch } from "./client";
import type {
  WisenetStudent,
  WisenetSession,
  WisenetStudentDetailResponse,
} from "./types";
import type { DashboardSources, SheetSnapshot } from "@/lib/dashboard/domain";
import {
  SHEET_AGGREGATIONS,
  SHEET_CREDIT_CONTROL,
  SHEET_UPCOMING,
  SHEET_STUDENTS,
  SHEET_STUDENTS_COURSES,
  SHEET_REMAINING_CREDITS,
} from "@/lib/dashboard/config";
import { z } from "zod";

// D-19 concurrency cap for teacher-feedback N+1 fan-out + student-detail
// fetches (same bound covers both since each student yields one detail call
// and each ENDED session yields one feedback call).
export const TEACHER_FEEDBACK_CONCURRENCY = 5;

// Phase 2 default windows. Phase 3 cache layer may narrow these.
const DEFAULT_PAST_SESSION_WINDOW_DAYS = 90;
const DEFAULT_UPCOMING_SESSION_WINDOW_DAYS = 60;

// ---------- Pre-fetched data + options shape ----------

/**
 * Pre-fetched data consumed by composeDashboardSourcesFromData. Populated by
 * buildDashboardSourcesFromWisenet in production; populated by the fixture
 * adapter (web/src/test/helpers/wisenet-to-dashboard-sources.ts) in tests.
 *
 * Per T-02-15 / Pitfall 5: these maps are per-call scoped — no module-global
 * cache persists any of them between invocations.
 */
export interface WisenetMapperData {
  students: WisenetStudent[];
  studentDetails: Map<string, WisenetStudentDetailResponse>;
  pastSessions: WisenetSession[];
  upcomingSessions: WisenetSession[];
  parentNamesById: Map<string, string>;
  teacherFeedbackBySessionId: Map<string, string>;
}

export interface MapperOptions {
  /** When true, skip teacher-feedback detail fetch. Tests default to true unless asserting D-08. */
  skipTeacherFeedback?: boolean;
  /** When provided, mapper uses prefetched maps and skips matching network calls. */
  prefetched?: Partial<WisenetMapperData>;
  /** Past-session window in days (default 90). */
  pastWindowDays?: number;
  /** Upcoming-session window in days (default 60). */
  upcomingWindowDays?: number;
}

// ---------- Field transforms (unit-testable) ----------

/**
 * meetingStatus → legacy final_status enum.
 * Per WISENET_FIELD_MAP.md YELLOW Credit_Control/final_status: 1:1 pass-through
 * with uppercase normalization.
 */
export function coerceMeetingStatusToFinalStatus(meetingStatus: string): string {
  return String(meetingStatus || "").toUpperCase();
}

/**
 * duration (milliseconds) → minutes. Undefined / negative / NaN → 0
 * (13/50 real fixture sessions omit the duration field entirely).
 */
export function durationMsToMinutes(durationMs: number | undefined): number {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.round(durationMs / 60_000);
}

/**
 * D-08 pending-deduction composite rule.
 * Fires when meetingStatus === "ENDED" AND teacherFeedback is empty/whitespace
 * AND duration > 0. Should_Credit branch removed per D-05.
 */
export function shouldCountAsPendingDeductionWisenet(
  meetingStatus: string,
  teacherFeedback: string,
  durationMs: number | undefined,
): boolean {
  if (meetingStatus !== "ENDED") return false;
  if ((teacherFeedback ?? "").trim() !== "") return false;
  const ms = Number(durationMs) || 0;
  if (!Number.isFinite(ms) || ms <= 0) return false;
  return ms / 3_600_000 > 0;
}

/**
 * RED RemainingCredits active-set predicate.
 * activated === true AND (has past session in last 90 days OR has upcoming session).
 */
export function isActiveStudent(
  student: WisenetStudent,
  today: Date,
  pastSessionsByStudent: Map<string, WisenetSession[]>,
  upcomingSessionsByStudent: Map<string, WisenetSession[]>,
): boolean {
  if (!student.activated) return false;
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(today.getDate() - 90);
  const past = pastSessionsByStudent.get(student._id) ?? [];
  const hasRecent = past.some((s) => {
    const d =
      s.scheduledStartTime instanceof Date
        ? s.scheduledStartTime
        : new Date(s.scheduledStartTime as unknown as string);
    return d.getTime() >= ninetyDaysAgo.getTime() && d.getTime() <= today.getTime();
  });
  if (hasRecent) return true;
  const upcoming = upcomingSessionsByStudent.get(student._id) ?? [];
  return upcoming.length > 0;
}

// ---------- Network helpers (production path only) ----------

/**
 * 2-step parent resolution per D-18.
 * Fetches getStudent(id) for every student (bounded by p-limit), collects
 * unique parentIds from the detail responses, then calls getParents(ids) in
 * a single batched request. Returns a per-call map (no module-global cache).
 */
export async function resolveParentNames(
  students: WisenetStudent[],
  options: MapperOptions = {},
): Promise<{
  parentNamesById: Map<string, string>;
  studentDetails: Map<string, WisenetStudentDetailResponse>;
}> {
  if (options.prefetched?.parentNamesById && options.prefetched?.studentDetails) {
    return {
      parentNamesById: options.prefetched.parentNamesById,
      studentDetails: options.prefetched.studentDetails,
    };
  }

  const limit = pLimit(TEACHER_FEEDBACK_CONCURRENCY);
  const details = new Map<string, WisenetStudentDetailResponse>();
  await Promise.all(
    students.map((s) =>
      limit(async () => {
        try {
          const d = await getStudent(s._id);
          details.set(s._id, d);
        } catch {
          // Detail fetch failure → skip; parent name falls back to ""
          // which feeds "missing-parent" downstream in buildDashboardStudentKey.
        }
      }),
    ),
  );

  const allParentIds = new Set<string>();
  details.forEach((d) => {
    (d.data.user.parentIds ?? []).forEach((id) => allParentIds.add(id));
  });

  const parentNamesById =
    allParentIds.size === 0 ? new Map<string, string>() : await getParents([...allParentIds]);

  return { parentNamesById, studentDetails: details };
}

/**
 * Fetches teacher_feedback per ENDED past session.
 *
 * Pre-filters on meetingStatus === "ENDED" so only eligible sessions incur the
 * N+1 detail cost. p-limit(TEACHER_FEEDBACK_CONCURRENCY) bounds parallel
 * fetches. Failures fall back to "" so the D-08 composite rule then treats
 * feedback as empty and fires pending-deduction accordingly.
 */
export async function fetchTeacherFeedback(
  pastSessions: WisenetSession[],
  options: MapperOptions = {},
): Promise<Map<string, string>> {
  if (options.skipTeacherFeedback) return new Map();
  if (options.prefetched?.teacherFeedbackBySessionId)
    return options.prefetched.teacherFeedbackBySessionId;

  const endedSessions = pastSessions.filter((s) => s.meetingStatus === "ENDED");
  if (endedSessions.length === 0) return new Map();

  const limit = pLimit(TEACHER_FEEDBACK_CONCURRENCY);

  // Tiny local schema — we only want teacherFeedback, not the whole session shape.
  const DetailSchema = z.object({
    status: z.coerce.number(),
    message: z.coerce.string(),
    data: z.object({
      teacherFeedback: z.coerce.string().optional(),
    }),
  });

  const results = await Promise.all(
    endedSessions.map((s) =>
      limit(async () => {
        try {
          const detail = await wisenetFetch(
            `/user/classes/${encodeURIComponent(s.classId._id)}/sessions/${encodeURIComponent(s._id)}?showFeedbackConfig=true&showFeedbackSubmission=true`,
            DetailSchema,
          );
          return [s._id, detail.data.teacherFeedback ?? ""] as const;
        } catch {
          // On detail-fetch failure, treat feedback as empty (D-08 fires).
          return [s._id, ""] as const;
        }
      }),
    ),
  );
  return new Map(results);
}

// ---------- Production + test entry points ----------

/**
 * Production entry — fetches all data in parallel from Wisenet then composes
 * the DashboardSources. Called by Phase 3's service.ts rewire.
 */
export async function buildDashboardSourcesFromWisenet(
  today: Date,
  options: MapperOptions = {},
): Promise<DashboardSources> {
  const pastWindow = options.pastWindowDays ?? DEFAULT_PAST_SESSION_WINDOW_DAYS;
  const upcomingWindow = options.upcomingWindowDays ?? DEFAULT_UPCOMING_SESSION_WINDOW_DAYS;
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - pastWindow);
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + upcomingWindow);

  const [students, pastSessions, upcomingSessions] = await Promise.all([
    options.prefetched?.students
      ? Promise.resolve(options.prefetched.students)
      : getStudents(),
    options.prefetched?.pastSessions
      ? Promise.resolve(options.prefetched.pastSessions)
      : getPastSessions(startDate, today),
    options.prefetched?.upcomingSessions
      ? Promise.resolve(options.prefetched.upcomingSessions)
      : getUpcomingSessions(today, endDate),
  ]);

  const { parentNamesById, studentDetails } = await resolveParentNames(students, options);
  const teacherFeedbackBySessionId = await fetchTeacherFeedback(pastSessions, options);

  return composeDashboardSourcesFromData(
    {
      students,
      studentDetails,
      pastSessions,
      upcomingSessions,
      parentNamesById,
      teacherFeedbackBySessionId,
    },
    today,
    options,
  );
}

/**
 * Pure composition — no network, no I/O. Deterministic given (data, today).
 * Tests call this directly with pre-fetched fixture data.
 */
export function composeDashboardSourcesFromData(
  data: WisenetMapperData,
  today: Date,
  _options: MapperOptions = {},
): DashboardSources {
  // Index sessions by student id (one session → many students via session.students[]).
  const pastByStudent = new Map<string, WisenetSession[]>();
  for (const s of data.pastSessions) {
    for (const id of s.students ?? []) {
      const list = pastByStudent.get(id);
      if (list) list.push(s);
      else pastByStudent.set(id, [s]);
    }
  }
  const upcomingByStudent = new Map<string, WisenetSession[]>();
  for (const s of data.upcomingSessions) {
    for (const id of s.students ?? []) {
      const list = upcomingByStudent.get(id);
      if (list) list.push(s);
      else upcomingByStudent.set(id, [s]);
    }
  }

  return {
    aggregations: toAggregationsSnapshot(data, pastByStudent, upcomingByStudent),
    creditControl: toCreditControlSnapshot(data),
    upcoming: toUpcomingSnapshot(data),
    students: toStudentsSnapshot(data, pastByStudent, upcomingByStudent, today),
    studentsCourses: toStudentsCoursesSnapshot(data),
    remainingCredits: toRemainingCreditsSnapshot(data),
  };
}

// ---------- Snapshot builders ----------

function buildSnapshot(sheetName: string, header: string[], rows: unknown[][]): SheetSnapshot {
  const cols: Record<string, number> = {};
  header.forEach((h, i) => {
    cols[h] = i;
  });
  return { sheetName, headerRowIndex: 0, dataRowStartIndex: 2, cols, rows };
}

function parentNameFor(
  detail: WisenetStudentDetailResponse | undefined,
  parentNamesById: Map<string, string>,
): string {
  const ids = detail?.data.user.parentIds ?? [];
  const first = ids[0];
  if (!first) return "";
  return parentNamesById.get(first) ?? "";
}

function firstClassroom(student: WisenetStudent) {
  return student.classrooms[0];
}

function toIsoDate(value: Date | string | unknown): string {
  const d =
    value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregations snapshot — per-student rollup (first classroom = representative).
 *
 * RED Current Remaining/Total Credits (D-07 derive-client):
 * - consumedHours = sum(session.duration ?? 0) / 3_600_000 for ENDED sessions
 * - Phase 2 totalHours proxy = past ENDED count + upcoming count (session-count
 *   proxy, since Wisenet doesn't expose a numeric "total credits purchased"
 *   field on list endpoints). Phase 3 may upgrade via sessionCredits if
 *   Opportunity 6 probe succeeds.
 * - remainingHours = max(0, totalHours - consumedHours)
 *
 * This produces non-zero Aggregations rows for fixtures with past ENDED data
 * — FLAG-2 verification target.
 */
function toAggregationsSnapshot(
  data: WisenetMapperData,
  pastByStudent: Map<string, WisenetSession[]>,
  upcomingByStudent: Map<string, WisenetSession[]>,
): SheetSnapshot {
  const header = [
    "Student Name",
    "Parent Name",
    "Class Subject",
    "Current Remaining Credits",
    "Current Total Credits",
  ];
  const rows: unknown[][] = [];

  for (const student of data.students) {
    const classroom = firstClassroom(student);
    const subject = classroom?.subject ?? "";
    const parent = parentNameFor(
      data.studentDetails.get(student._id),
      data.parentNamesById,
    );

    const pastSessions = pastByStudent.get(student._id) ?? [];
    const ended = pastSessions.filter((s) => s.meetingStatus === "ENDED");
    const consumedHours = ended.reduce(
      (sum, s) => sum + (Number(s.duration) || 0) / 3_600_000,
      0,
    );

    // Phase 2 Aggregations totalHours: session-count proxy per D-07 derive-client
    // decision. Phase 3 may upgrade via sessionCredits if Opportunity 6 probe
    // succeeds. Uses (past_ENDED_count + upcoming_count) so fixtures with real
    // past data produce non-zero rows (FLAG-2 verification target).
    const upcomingCount = (upcomingByStudent.get(student._id) ?? []).length;
    const sessionCountProxyTotal = ended.length + upcomingCount;
    // Ensure consumedHours doesn't exceed totalHours in the proxy; if it does,
    // lift totalHours so remainingHours is at least 0 and the consumed value
    // is fully represented.
    const totalHours = Math.max(sessionCountProxyTotal, consumedHours);
    const remainingHours = Math.max(0, totalHours - consumedHours);

    rows.push([
      student.name,
      parent,
      subject,
      Math.round(remainingHours * 100) / 100,
      Math.round(totalHours * 100) / 100,
    ]);
  }
  return buildSnapshot(SHEET_AGGREGATIONS, header, rows);
}

/**
 * Credit_Control snapshot — one row per past session × student.
 *
 * Column contract (REQUIRED_COLUMNS.creditControl):
 *   Student Name | Package/Program | final_status | teacher_feedback |
 *   credits_consumed | session_duration | session_date | Should_Credit
 *
 * D-05: Should_Credit cell is always "" — header preserved so downstream
 * parseNumber() on the column still works, but value drops out.
 * credits_consumed (RED / derive-client): duration / 3_600_000 when ENDED, else 0.
 * session_duration: minutes integer.
 * teacher_feedback: passed through from data.teacherFeedbackBySessionId map.
 * final_status: meetingStatus → uppercase pass-through (YELLOW).
 */
function toCreditControlSnapshot(data: WisenetMapperData): SheetSnapshot {
  const header = [
    "Student Name",
    "Package/Program",
    "final_status",
    "teacher_feedback",
    "credits_consumed",
    "session_duration",
    "session_date",
    "Should_Credit",
  ];
  const rows: unknown[][] = [];
  const studentById = new Map(data.students.map((s) => [s._id, s]));

  for (const session of data.pastSessions) {
    for (const studentId of session.students ?? []) {
      const student = studentById.get(studentId);
      if (!student) continue;
      const packageName = session.classId?.name ?? "";
      const finalStatus = coerceMeetingStatusToFinalStatus(session.meetingStatus);
      const teacherFeedback = data.teacherFeedbackBySessionId.get(session._id) ?? "";
      const durationMs = Number(session.duration) || 0;
      const durationMin = durationMsToMinutes(durationMs);
      const creditsConsumed =
        finalStatus === "ENDED" ? Math.round((durationMs / 3_600_000) * 100) / 100 : 0;
      const sessionDate = toIsoDate(session.scheduledStartTime);

      rows.push([
        student.name,
        packageName,
        finalStatus,
        teacherFeedback,
        creditsConsumed,
        durationMin,
        sessionDate,
        "", // D-05: Should_Credit always empty string
      ]);
    }
  }
  return buildSnapshot(SHEET_CREDIT_CONTROL, header, rows);
}

/**
 * Upcoming Sessions snapshot — one row per upcoming session × student.
 *
 * Column contract: Student Name | Package/Program | Session Status |
 * Session Duration | Scheduled Date.
 * Session Status is passed through as the meetingStatus value (UPCOMING /
 * IN_PROGRESS / etc.) — downstream buildUpcomingSessionMap filters on
 * Session Status === "UPCOMING".
 */
function toUpcomingSnapshot(data: WisenetMapperData): SheetSnapshot {
  const header = [
    "Student Name",
    "Package/Program",
    "Session Status",
    "Session Duration",
    "Scheduled Date",
  ];
  const rows: unknown[][] = [];
  const studentById = new Map(data.students.map((s) => [s._id, s]));

  for (const session of data.upcomingSessions) {
    for (const studentId of session.students ?? []) {
      const student = studentById.get(studentId);
      if (!student) continue;
      const packageName = session.classId?.name ?? "";
      const sessionStatus = coerceMeetingStatusToFinalStatus(session.meetingStatus);
      const durationMin = durationMsToMinutes(Number(session.duration) || 0);
      const scheduledDate = toIsoDate(session.scheduledStartTime);
      rows.push([student.name, packageName, sessionStatus, durationMin, scheduledDate]);
    }
  }
  return buildSnapshot(SHEET_UPCOMING, header, rows);
}

/**
 * Students snapshot — one row per student with a Remaining Credits cell
 * that drives buildActiveStudentSet's filter:
 *   activeStudents.add(name) WHEN remaining !== "N/A" AND remaining !== ""
 *
 * So: active student → numeric value (derived same way as Aggregations).
 *     inactive student → "N/A" (gets filtered out).
 */
function toStudentsSnapshot(
  data: WisenetMapperData,
  pastByStudent: Map<string, WisenetSession[]>,
  upcomingByStudent: Map<string, WisenetSession[]>,
  today: Date,
): SheetSnapshot {
  const header = ["student_name", "Remaining Credits"];
  const rows: unknown[][] = [];

  for (const student of data.students) {
    const active = isActiveStudent(student, today, pastByStudent, upcomingByStudent);
    if (!active) {
      rows.push([student.name, "N/A"]);
      continue;
    }
    // Same derivation as Aggregations so the two snapshots agree on magnitude.
    const ended = (pastByStudent.get(student._id) ?? []).filter(
      (s) => s.meetingStatus === "ENDED",
    );
    const consumedHours = ended.reduce(
      (sum, s) => sum + (Number(s.duration) || 0) / 3_600_000,
      0,
    );
    const upcomingCount = (upcomingByStudent.get(student._id) ?? []).length;
    const totalHours = Math.max(ended.length + upcomingCount, consumedHours);
    const remaining = Math.max(0, totalHours - consumedHours);
    rows.push([student.name, Math.round(remaining * 100) / 100]);
  }
  return buildSnapshot(SHEET_STUDENTS, header, rows);
}

/**
 * Students & Courses snapshot — one row per (student × classroom).
 * Column contract: Student Name | Student Full Name | Class Subject.
 * Drives buildExcludedPackageReasons (pretest/trial keyword match).
 */
function toStudentsCoursesSnapshot(data: WisenetMapperData): SheetSnapshot {
  const header = ["Student Name", "Student Full Name", "Class Subject"];
  const rows: unknown[][] = [];
  for (const student of data.students) {
    for (const classroom of student.classrooms ?? []) {
      rows.push([student.name, classroom.name ?? "", classroom.subject ?? ""]);
    }
  }
  return buildSnapshot(SHEET_STUDENTS_COURSES, header, rows);
}

/**
 * RemainingCredits snapshot — one row per student.
 * Column contract: Student | Admin.
 *
 * D-06 split: mapper emits student name + EMPTY Admin cell in Phase 2. Phase 3
 * service.ts calls bulkGetAdminOwnership(studentKeys) then rewrites the Admin
 * column before passing the snapshot to buildStudentAdminOwnershipMap. This
 * keeps the mapper network-free for tests.
 */
function toRemainingCreditsSnapshot(data: WisenetMapperData): SheetSnapshot {
  const header = ["Student", "Admin"];
  const rows: unknown[][] = [];
  for (const student of data.students) {
    rows.push([student.name, ""]);
  }
  return buildSnapshot(SHEET_REMAINING_CREDITS, header, rows);
}
