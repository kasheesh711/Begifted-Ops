"use server";

// web/src/lib/dashboard/actions.ts
// SVC-03 — Phase 3 'use server' mutation facade over the Drizzle query layer.
//
// CONTEXT D-28 option (b): single source of truth for cache invalidation.
// All 5 follow-up state mutations (set / clear / bulk-set / mark-inactive /
// clear-inactive) live here. Each writes to Postgres FIRST, then calls
// revalidateTag(tag, "max") SECOND. Ordering is critical —
// if the write throws, revalidateTag never runs (cache keeps the pre-write
// payload until the next 60s revalidate); if revalidateTag ran first, a
// subsequent fetch could re-cache the pre-write payload before the write
// committed (D-28 staleness window).
//
// CRITICAL: revalidateTag is the two-arg form revalidateTag(tag, "max").
// updateTag() does NOT work from route handlers (RESEARCH §Critical Finding
// #1) — and these facade methods are imported by route handlers in Plan
// 03-05, so we use the route-handler-compatible form throughout.
//
// 'use server' makes every export a Server Action invokable as a POST
// endpoint. T-03-04-3: Next.js 16 same-origin + content-type checks provide
// implicit CSRF protection; route-handler callers also gate on
// requireSessionUser() before invoking these methods.
//
// Sync helper functions (normalizeStudentActionStatus, sanitizeStudentActionState,
// attachActionStatesToStudents, isActionStateToday) are co-located in
// action-helpers.ts and re-exported below so the public API surface
// (`import { ... } from "@/lib/dashboard/actions"`) stays stable for all
// existing server-side callers (service.ts, route handlers, tests,
// lib/sheets/actions.ts during cutover transition). The split is required:
// 'use server' files cannot export non-async functions (Next.js 16 SWC
// enforces this at build time, not just runtime).
import { revalidateTag } from "next/cache";

import {
  upsertFollowUpState,
  appendFollowUpLog,
  markInactive as dbMarkInactive,
  clearInactive as dbClearInactive,
} from "@/lib/db/queries";
import { bulkSetStudentAction as dbBulkSetStudentAction } from "@/lib/db/bulk-queries";
import { DASHBOARD_CACHE_TAG } from "@/lib/dashboard/config";
import { recordCacheInvalidation } from "@/lib/dashboard/health-state";
import type { StudentActionStatus } from "@/types/dashboard";

// NOTE — sync helpers (normalizeStudentActionStatus, sanitizeStudentActionState,
// attachActionStatesToStudents, isActionStateToday) live in
// @/lib/dashboard/action-helpers and MUST be imported from there, not
// re-exported here. A `export { ... } from "@/lib/dashboard/action-helpers"`
// statement was attempted in Plan 03-04 to keep a stable public API, but
// Next.js 16's SWC compiler strips non-async re-exports from 'use server'
// files. With nothing else importing actions.ts at the time, that strip
// looked harmless. As soon as Plan 03-05 wired route handlers to import the
// 5 async mutations from this file, SWC began emitting "The module has no
// exports at all" — apparently the stripped re-export invalidates analysis
// of the whole file. Removing the re-export entirely resolved the build:
// the 5 async mutations defined below are the ONLY exports of this module.
// All callers of the sync helpers were already migrated to action-helpers
// by Plan 03-04 (see that summary's "Rule 3 cascade — 9 caller updates").
//
// ---------- Mutation facade (5 sites per D-28) ----------

/**
 * Upsert one student's follow-up state and append a "set" event to the
 * audit log, then invalidate the dashboard cache so the next fetch picks
 * up the new state.
 *
 * D-28 ordering: Postgres write awaited FIRST, revalidateTag SECOND.
 * If upsert/append throw, revalidateTag never runs — cache stays consistent
 * with the pre-write database state.
 *
 * DB-06: updatedByEmail + updatedByName are required (FollowUpStateInsert
 * + FollowUpLogInsert use .notNull() at the schema level — TS rejects
 * callers that omit actor attribution).
 */
export async function setStudentAction(input: {
  studentKey: string;
  studentName: string;
  parentName: string;
  status: StudentActionStatus;
  updatedByEmail: string;
  updatedByName: string;
}): Promise<void> {
  await upsertFollowUpState({
    studentKey: input.studentKey,
    studentName: input.studentName,
    parentName: input.parentName,
    status: input.status,
    updatedByEmail: input.updatedByEmail,
    updatedByName: input.updatedByName,
  });
  await appendFollowUpLog({
    studentKey: input.studentKey,
    studentName: input.studentName,
    parentName: input.parentName,
    actionType: "set",
    status: input.status,
    actorEmail: input.updatedByEmail,
    actorName: input.updatedByName,
  });
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
  recordCacheInvalidation(new Date().toISOString());
}

/**
 * Append a "clear" event to the audit log (status: null since the action is
 * being cleared) and invalidate the dashboard cache. Note: this DOES NOT
 * delete the follow_up_state row — DB-05 same-day visibility is enforced
 * by the domain layer (sanitizeStudentActionState filters by today's date),
 * not by row deletion.
 *
 * D-28 ordering: Postgres write FIRST, revalidateTag SECOND.
 */
export async function clearStudentAction(input: {
  studentKey: string;
  studentName: string;
  parentName: string;
  actorEmail: string;
  actorName: string;
}): Promise<void> {
  await appendFollowUpLog({
    studentKey: input.studentKey,
    studentName: input.studentName,
    parentName: input.parentName,
    actionType: "clear",
    status: null,
    actorEmail: input.actorEmail,
    actorName: input.actorName,
  });
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
  recordCacheInvalidation(new Date().toISOString());
}

/**
 * Atomically upsert follow_up_state + append follow_up_log for many students
 * in a single BEGIN/COMMIT transaction (WebSocket Pool driver per D-25),
 * then invalidate the dashboard cache.
 *
 * The bulk write is all-or-nothing: if the second insert fails, the first
 * is rolled back, so cache invalidation only runs after a successful commit.
 *
 * D-28 ordering: Postgres transaction commits FIRST, revalidateTag SECOND.
 */
export async function bulkSetAction(input: {
  updates: Array<{
    studentKey: string;
    studentName: string;
    parentName: string;
    status: StudentActionStatus;
  }>;
  actorEmail: string;
  actorName: string;
}): Promise<void> {
  await dbBulkSetStudentAction({
    updates: input.updates,
    actorEmail: input.actorEmail,
    actorName: input.actorName,
  });
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
  recordCacheInvalidation(new Date().toISOString());
}

/**
 * Mark a student as inactive (operator triage flag). Idempotent via ON
 * CONFLICT DO UPDATE on studentKey. Then invalidate the dashboard cache so
 * the next fetch filters this student out of the queue.
 *
 * D-28 ordering: Postgres write FIRST, revalidateTag SECOND.
 */
export async function markInactiveStudent(input: {
  studentKey: string;
  studentName: string;
  parentName: string;
  markedByEmail: string;
  markedByName: string;
}): Promise<void> {
  await dbMarkInactive({
    studentKey: input.studentKey,
    studentName: input.studentName,
    parentName: input.parentName,
    markedByEmail: input.markedByEmail,
  });
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
  recordCacheInvalidation(new Date().toISOString());
}

/**
 * Clear the inactive flag for a student (DELETE by studentKey). The schema
 * models inactive status as row presence, so "uninactive" is a DELETE.
 * Then invalidate the dashboard cache so the student rejoins the queue.
 *
 * D-28 ordering: Postgres write FIRST, revalidateTag SECOND.
 */
export async function clearInactiveStudent(studentKey: string): Promise<void> {
  await dbClearInactive(studentKey);
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
  recordCacheInvalidation(new Date().toISOString());
}
