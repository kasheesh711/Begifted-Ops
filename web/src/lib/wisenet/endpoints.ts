// web/src/lib/wisenet/endpoints.ts
// Per D-26 — single file, 7 resource functions. Paths use Phase 1 empirically-verified forms.
// Pagination terminates when records.length < PAGE_SIZE per _pagination-fingerprint.json.
//
// Threat mitigations:
//  T-02-12 Tampering: every dynamic URL segment (centerId, studentId, classId, parentIds)
//    passes through encodeURIComponent — no raw string interpolation of user/env input.
//  T-02-13 Injection: no string-concatenation of unsanitized inputs into path/query.
//  T-02-14 DoS: pagination bounded by short-page termination. No unbounded loop possible
//    in `for await` since the generator returns on records.length < PAGE_SIZE; fetch
//    failure throws WisenetError which propagates out of the loop.
//  T-02-15 Repudiation: parent cache is scoped per `getParents(...)` call only —
//    no module-global cache, no cross-request leakage.
import { getWisenetEnv } from "@/lib/runtime/env";
import { wisenetFetch } from "./client";
import {
  WisenetStudentsListSchema,
  WisenetStudentDetailSchema,
  WisenetParentsListSchema,
  WisenetSessionsListSchema,
  WisenetClassSchema,
  WisenetSessionCreditsSchema,
  type WisenetStudent,
  type WisenetSession,
} from "./types";
import type { z } from "zod";

export const PAGE_SIZE = 50;

function encodeCenter(): string {
  return encodeURIComponent(getWisenetEnv().WISENET_CENTER_ID);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ---- Paginated iterator ----
// Terminates when records.length < PAGE_SIZE per _pagination-fingerprint.json.
// Also terminates safely when items is undefined or empty (past-end protection).
async function* paginate<TResponse, TItem>(
  pathBuilder: (pageNumber: number) => string,
  schema: z.ZodType<TResponse, z.ZodTypeDef, unknown>,
  itemsExtractor: (r: TResponse) => TItem[],
): AsyncGenerator<TItem[], void, unknown> {
  let pageNumber = 1;
  while (true) {
    const response = await wisenetFetch(pathBuilder(pageNumber), schema);
    const items = itemsExtractor(response) ?? [];
    yield items;
    if (items.length < PAGE_SIZE) return;
    pageNumber += 1;
  }
}

// ---- WCLI-03 resource functions ----

// NOTE: path uses /institutes/v3/{center}/students (NO trailing `s` on {center} —
// Postman catalogue typo fixed inline per CONTEXT.md §Path-typo fix + Phase 1 01-03 finding).
export async function getStudents(): Promise<WisenetStudent[]> {
  const all: WisenetStudent[] = [];
  const pathBuilder = (p: number) =>
    `/institutes/v3/${encodeCenter()}/students?page_number=${p}&page_size=${PAGE_SIZE}`;
  for await (const batch of paginate(
    pathBuilder,
    WisenetStudentsListSchema,
    (r) => r.data.students,
  )) {
    all.push(...batch);
  }
  return all;
}

export async function getStudent(studentId: string) {
  const center = encodeCenter();
  return wisenetFetch(
    `/institutes/${center}/participants/${encodeURIComponent(studentId)}?showRegistrationData=true`,
    WisenetStudentDetailSchema,
  );
}

// Batched — collects unique parentIds, returns id→name map per D-18.
// Scoped per call (no module-global cache — Pitfall 5 / T-02-15 mitigation).
export async function getParents(parentIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(parentIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const center = encodeCenter();
  const idsParam = unique.map(encodeURIComponent).join(",");
  const response = await wisenetFetch(
    `/institutes/${center}/parents?ids=${idsParam}`,
    WisenetParentsListSchema,
  );
  return new Map(response.data.parents.map((p) => [p._id, p.name]));
}

export async function getClass(classId: string) {
  return wisenetFetch(
    `/user/v2/classes/${encodeURIComponent(classId)}?full=true`,
    WisenetClassSchema,
  );
}

// Past sessions — status=PAST, paginateBy=DATE, startDate + endDate REQUIRED per 01-03 probe finding.
export async function getPastSessions(startDate: Date, endDate: Date): Promise<WisenetSession[]> {
  const all: WisenetSession[] = [];
  const pathBuilder = (p: number) =>
    `/institutes/${encodeCenter()}/sessions?status=PAST&paginateBy=DATE&startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}&page_number=${p}&page_size=${PAGE_SIZE}`;
  for await (const batch of paginate(
    pathBuilder,
    WisenetSessionsListSchema,
    (r) => r.data.sessions,
  )) {
    all.push(...batch);
  }
  return all;
}

// Upcoming sessions — status=FUTURE, same date-window requirement.
export async function getUpcomingSessions(startDate: Date, endDate: Date): Promise<WisenetSession[]> {
  const all: WisenetSession[] = [];
  const pathBuilder = (p: number) =>
    `/institutes/${encodeCenter()}/sessions?status=FUTURE&paginateBy=DATE&startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}&page_number=${p}&page_size=${PAGE_SIZE}`;
  for await (const batch of paginate(
    pathBuilder,
    WisenetSessionsListSchema,
    (r) => r.data.sessions,
  )) {
    all.push(...batch);
  }
  return all;
}

// NOTE: expects participant-resolved student_id, NOT session.userId._id — per Phase 1 01-03 finding.
// Returns 400 when called with arbitrary pair; mapper (Plan 02-04) must resolve via
// /user/classes/{classId}/participants endpoint first.
export async function getSessionCredits(classId: string, resolvedStudentId: string) {
  return wisenetFetch(
    `/institutes/${encodeCenter()}/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(resolvedStudentId)}/sessionCredits?fetchHistory=true`,
    WisenetSessionCreditsSchema,
  );
}

// Exported for test access — internal paginate generator.
export { paginate as __paginateForTest };
