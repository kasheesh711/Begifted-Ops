// web/src/lib/wisenet/types.ts
// Zod schemas + inferred TS types for all 6 Wisenet response shapes consumed
// by the dashboard. Source: Phase 1 fixtures at web/src/test/fixtures/wisenet/*.
//
// Every numeric/date/boolean field uses z.coerce.* to tolerate silently
// string-typed primitives (Pitfall #2 / WCLI-05). Enum values come from
// Phase 1 CONTEXT.md §Session-endpoint shape.
//
// Zod v3.25.x only — do NOT use v4 top-level helpers (z.email, z.ip, etc.).

import { z } from "zod";

// --- Envelope common to all Wisenet responses ---
// {status, message, data: <resource>}
export const EnvelopeSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    status: z.coerce.number(),
    message: z.coerce.string(),
    data: inner,
  });

// --- Students list ---
// Fixture: web/src/test/fixtures/wisenet/students_list_page1.json
// Field paths: data.students[*].{_id, name, email?, uuid, activated, joinedOn?, tags[], parents[], classrooms[]}
export const WisenetClassroomSummarySchema = z.object({
  _id: z.coerce.string(),
  name: z.coerce.string(),
  subject: z.coerce.string(),
  classType: z.coerce.string().optional(),
});

export const WisenetStudentSchema = z.object({
  _id: z.coerce.string(),
  name: z.coerce.string().trim(),
  email: z.coerce.string().optional(),
  uuid: z.coerce.string(),
  activated: z.coerce.boolean(),
  joinedOn: z.coerce.date().optional(),
  tags: z.array(z.coerce.string()).default([]),
  parents: z.array(z.unknown()).default([]),
  classrooms: z.array(WisenetClassroomSummarySchema).default([]),
});

export const WisenetStudentsListSchema = EnvelopeSchema(
  z.object({
    students: z.array(WisenetStudentSchema),
    count: z.coerce.number().default(0),
  }),
);

// --- Student detail (for parentIds + registrationData) ---
// Fixture: web/src/test/fixtures/wisenet/student_detail_sample.json
// Field paths: data.user.{_id, name, parentIds[]}, data.registrationData?.fields[]
export const WisenetRegistrationFieldSchema = z.object({
  questionId: z.coerce.string(),
  answer: z.coerce.string().optional(),
});

export const WisenetStudentDetailSchema = EnvelopeSchema(
  z.object({
    user: z.object({
      _id: z.coerce.string(),
      name: z.coerce.string(),
      parentIds: z.array(z.coerce.string()).default([]),
    }),
    registrationData: z
      .object({
        fields: z.array(WisenetRegistrationFieldSchema).default([]),
      })
      .optional(),
  }),
);

// --- Parents list (2-step join per D-18) ---
// Endpoint: /institutes/{center}/parents?ids=...
export const WisenetParentSchema = z.object({
  _id: z.coerce.string(),
  name: z.coerce.string().trim(),
});

export const WisenetParentsListSchema = EnvelopeSchema(
  z.object({
    parents: z.array(WisenetParentSchema),
  }),
);

// --- Sessions (past + upcoming share shape) ---
// Fixtures: past_sessions_sample.json / upcoming_sessions_sample.json
// Field paths: data.sessions[*].{_id, classId{}, userId{}, scheduledStartTime,
//   scheduledEndTime?, meetingStatus, duration, students[], teacherFeedback?}
// meetingStatus enum values locked in 02-CONTEXT.md §Session-endpoint shape.
// duration is in MILLISECONDS — mapper (Plan 02-04) converts to minutes.
export const MeetingStatusSchema = z.enum([
  "ENDED",
  "CANCELLED",
  "UPCOMING",
  "IN_PROGRESS",
]);

export const WisenetSessionClassSchema = z.object({
  _id: z.coerce.string(),
  name: z.coerce.string(),
  subject: z.coerce.string(),
});

export const WisenetSessionUserSchema = z.object({
  _id: z.coerce.string(),
  name: z.coerce.string(),
});

export const WisenetSessionSchema = z.object({
  _id: z.coerce.string(),
  classId: WisenetSessionClassSchema,
  userId: WisenetSessionUserSchema,
  scheduledStartTime: z.coerce.date(),
  scheduledEndTime: z.coerce.date().optional(),
  meetingStatus: MeetingStatusSchema,
  // duration is optional — Phase 1 fixtures show some real sessions (recurrence
  // occurrences on upcoming, cancelled past entries) omit the field entirely.
  // Mapper in Plan 02-04 must treat missing duration as "no credit consumed".
  duration: z.coerce.number().optional(),
  students: z.array(z.coerce.string()).default([]),
  teacherFeedback: z.coerce.string().optional(),
});

export const WisenetSessionsListSchema = EnvelopeSchema(
  z.object({
    sessions: z.array(WisenetSessionSchema),
    count: z.coerce.number().default(0),
  }),
);

// --- Class detail (Package/Program name + Class Subject) ---
// Fixture: enrolment_detail_sample.json (endpoint /user/v2/classes/{classId}?full=true)
export const WisenetClassSchema = EnvelopeSchema(
  z.object({
    _id: z.coerce.string(),
    name: z.coerce.string(),
    subject: z.coerce.string(),
  }),
);

// --- sessionCredits (defensive — all fields optional, 200-shape unverified) ---
// Fixture: credit_balance_sample.json (status=400 today; schema shape ready
// for when Phase 2 WCLI-04 resolves student+class pair per Opportunity 6).
export const WisenetSessionCreditsSchema = EnvelopeSchema(
  z.object({
    total: z.coerce.number().optional(),
    remaining: z.coerce.number().optional(),
    consumed: z.coerce.number().optional(),
  }),
);

// --- Inferred TypeScript types ---
export type WisenetClassroomSummary = z.infer<typeof WisenetClassroomSummarySchema>;
export type WisenetStudent = z.infer<typeof WisenetStudentSchema>;
export type WisenetStudentsListResponse = z.infer<typeof WisenetStudentsListSchema>;
export type WisenetRegistrationField = z.infer<typeof WisenetRegistrationFieldSchema>;
export type WisenetStudentDetailResponse = z.infer<typeof WisenetStudentDetailSchema>;
export type WisenetParent = z.infer<typeof WisenetParentSchema>;
export type WisenetParentsListResponse = z.infer<typeof WisenetParentsListSchema>;
export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;
export type WisenetSession = z.infer<typeof WisenetSessionSchema>;
export type WisenetSessionsListResponse = z.infer<typeof WisenetSessionsListSchema>;
export type WisenetClassResponse = z.infer<typeof WisenetClassSchema>;
export type WisenetSessionCreditsResponse = z.infer<typeof WisenetSessionCreditsSchema>;
