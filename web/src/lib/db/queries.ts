// web/src/lib/db/queries.ts
// Source: Plan 02-06 Task 1 — DB-04 + DB-05 + DB-06 typed query surface.
//
// HTTP-path queries used by Phase 3 service.ts and route handlers. All writes
// require actor attribution via the Drizzle $inferInsert types (FollowUpStateInsert,
// FollowUpLogInsert, InactiveStudentInsert) whose underlying columns are .notNull()
// in schema.ts — TypeScript therefore rejects callers that omit updatedByEmail /
// updatedByName / markedByEmail (DB-06).
//
// DB-05 note: loadActionStateMap returns EVERY follow-up-state row flagged
// isToday: true. The domain-layer sanitizeStudentActionState (see
// web/src/lib/dashboard/actions.ts::sanitizeStudentActionState) re-evaluates
// same-day visibility with the real "today" date after the query resolves.
// This mirrors the current Sheets-layer semantics so Phase 3 service.ts is a
// drop-in swap.
//
// Bulk writes (transactional, WebSocket) live in bulk-queries.ts — see D-25.
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "./client";
import {
  followUpState,
  followUpLog,
  inactiveStudents,
  studentAdminOwnership,
  type FollowUpStateRow,
  type FollowUpStateInsert,
  type FollowUpLogRow,
  type FollowUpLogInsert,
  type InactiveStudentInsert,
  type InactiveStudentRow,
  type StudentAdminOwnershipRow,
} from "./schema";
import type { ActionStateMap } from "@/lib/dashboard/domain";

// ---------- Follow-up state + log (DB-04 core) ----------

/**
 * Return the full follow-up state map keyed by studentKey.
 *
 * DB-05: this query does NOT filter by today — every row comes back with
 * isToday: true. The domain-layer sanitizeStudentActionState applies the
 * today filter after merging against dashboard state. Preserves existing
 * Sheets-layer semantics so Phase 3 service.ts is a drop-in swap.
 */
export async function loadActionStateMap(): Promise<ActionStateMap> {
  const rows = await db.select().from(followUpState);
  const map: ActionStateMap = {};
  for (const row of rows) {
    map[row.studentKey] = {
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
      updatedByName: row.updatedByName,
      isToday: true, // recomputed in domain via sanitizeStudentActionState
    };
  }
  return map;
}

/**
 * Upsert the current follow-up state row for a student.
 *
 * DB-06: the FollowUpStateInsert type requires updatedByEmail + updatedByName
 * (columns are .notNull() in schema.ts). TypeScript rejects callers that omit
 * actor attribution — no runtime default fallback exists here.
 *
 * On conflict (same studentKey), updates status + actor fields + updatedAt.
 * studentName / parentName are refreshed so renames flow through.
 */
export async function upsertFollowUpState(
  input: FollowUpStateInsert,
): Promise<FollowUpStateRow[]> {
  return db
    .insert(followUpState)
    .values(input)
    .onConflictDoUpdate({
      target: followUpState.studentKey,
      set: {
        status: input.status,
        updatedAt: new Date(),
        updatedByEmail: input.updatedByEmail,
        updatedByName: input.updatedByName,
        studentName: input.studentName,
        parentName: input.parentName,
      },
    })
    .returning();
}

/**
 * Append an audit event to follow_up_log.
 *
 * DB-06: FollowUpLogInsert requires actorEmail + actorName via .notNull() column
 * definitions. status is nullable (set to null for clear/bulk-clear actionType).
 */
export async function appendFollowUpLog(
  input: FollowUpLogInsert,
): Promise<FollowUpLogRow[]> {
  return db.insert(followUpLog).values(input).returning();
}

// ---------- Inactive students (DB-04) ----------

/**
 * Return all rows in inactive_students. The schema has no "active/inactive"
 * status column — presence of a row IS the inactive flag. Clearing is a DELETE
 * (see clearInactive).
 */
export async function listInactive(): Promise<InactiveStudentRow[]> {
  return db.select().from(inactiveStudents);
}

/**
 * Mark a student inactive. Idempotent via ON CONFLICT DO UPDATE on studentKey —
 * re-marking refreshes markedAt + actor.
 *
 * DB-06: InactiveStudentInsert requires markedByEmail via .notNull().
 */
export async function markInactive(
  input: InactiveStudentInsert,
): Promise<void> {
  await db
    .insert(inactiveStudents)
    .values(input)
    .onConflictDoUpdate({
      target: inactiveStudents.studentKey,
      set: {
        markedAt: new Date(),
        markedByEmail: input.markedByEmail,
      },
    });
}

/**
 * Clear the inactive flag for a student (DELETE by studentKey). The schema
 * models inactive status as row presence, not a column — so "uninactive" is a
 * DELETE. Auto-reactivation semantics (when a student reappears with active
 * packages) live in the dashboard layer and will delegate here.
 */
export async function clearInactive(studentKey: string): Promise<void> {
  await db
    .delete(inactiveStudents)
    .where(eq(inactiveStudents.studentKey, studentKey));
}

// ---------- History readback (DB-04) ----------

/**
 * Read the N-day history of follow-up events for one student, newest-first.
 *
 * Default window is 7 days (matches the existing /api/actions/history contract
 * — see web/src/app/api/actions/history). Caller can override for audit views.
 */
export async function readHistory(
  studentKey: string,
  sinceDays = 7,
): Promise<FollowUpLogRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  return db
    .select()
    .from(followUpLog)
    .where(
      and(
        eq(followUpLog.studentKey, studentKey),
        gte(followUpLog.createdAt, since),
      ),
    )
    .orderBy(desc(followUpLog.createdAt));
}

// ---------- Admin ownership (D-06 sidecar) ----------

/**
 * Look up one student's admin owner. Returns null on miss so the caller can
 * fall back to the UNASSIGNED_ADMIN_KEY path.
 */
export async function getAdminOwnership(
  studentKey: string,
): Promise<StudentAdminOwnershipRow | null> {
  const [row] = await db
    .select()
    .from(studentAdminOwnership)
    .where(eq(studentAdminOwnership.studentKey, studentKey))
    .limit(1);
  return row ?? null;
}

/**
 * Batch lookup for many students — used by the dashboard payload build to
 * resolve admin ownership for every student in one round trip. Empty input
 * short-circuits (no network).
 */
export async function bulkGetAdminOwnership(
  studentKeys: string[],
): Promise<Map<string, StudentAdminOwnershipRow>> {
  if (studentKeys.length === 0) return new Map();
  const rows = await db
    .select()
    .from(studentAdminOwnership)
    .where(inArray(studentAdminOwnership.studentKey, studentKeys));
  return new Map(rows.map((r) => [r.studentKey, r]));
}
