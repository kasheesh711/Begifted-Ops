// web/src/lib/db/bulk-queries.ts
// Source: Plan 02-06 Task 2 — DB-07 bulk-atomic write path.
//
// One transactional write path: bulk upsert follow_up_state + bulk append
// follow_up_log, both inside a single BEGIN ... COMMIT on the WebSocket Pool
// driver (see D-25 + ./bulk-client.ts). Any failure rolls BOTH inserts back —
// operators can never end up with a state row whose audit log went missing
// (CONCERNS.md flagged this as a MEDIUM risk on the current Sheets pattern;
// the Postgres migration upgrades it).
//
// Consumed ONLY by api/actions/bulk/route.ts (Phase 3 wires this). Every other
// write path uses ./queries.ts on the HTTP driver for zero pool overhead.
//
// CRITICAL: this file MUST NOT import from ./client. Transactions cannot span
// HTTP — the WebSocket-only boundary is enforced at compile time by the import
// graph (and grep-checked in the plan's acceptance criteria).
import { sql } from "drizzle-orm";
import { getBulkDb } from "./bulk-client";
import {
  followUpState,
  followUpLog,
  type FollowUpLogInsert,
  type FollowUpStateInsert,
} from "./schema";
import type { StudentActionStatus } from "@/types/dashboard";

export interface BulkActionInput {
  updates: Array<{
    studentKey: string;
    studentName: string;
    parentName: string;
    status: StudentActionStatus;
  }>;
  actorEmail: string;
  actorName: string;
}

/**
 * Atomically upsert follow_up_state + append follow_up_log for up to ~50
 * students in a single BEGIN/COMMIT transaction on the WebSocket Pool driver.
 *
 * All-or-nothing: if the second insert fails (constraint, timeout, pool
 * eviction), the first insert is rolled back — no partial state.
 *
 * DB-06: actorEmail + actorName are required top-level inputs — threaded into
 * both tables. Route handler sources them from requireSessionUser().
 *
 * Empty updates array short-circuits without opening a transaction.
 */
export async function bulkSetStudentAction(
  input: BulkActionInput,
): Promise<void> {
  if (input.updates.length === 0) return;

  const bulkDb = getBulkDb();

  await bulkDb.transaction(async (tx) => {
    const stateValues: FollowUpStateInsert[] = input.updates.map((u) => ({
      studentKey: u.studentKey,
      studentName: u.studentName,
      parentName: u.parentName,
      status: u.status,
      updatedByEmail: input.actorEmail,
      updatedByName: input.actorName,
    }));

    const logValues: FollowUpLogInsert[] = input.updates.map((u) => ({
      studentKey: u.studentKey,
      studentName: u.studentName,
      parentName: u.parentName,
      actionType: "bulk-set" as const,
      status: u.status,
      actorEmail: input.actorEmail,
      actorName: input.actorName,
    }));

    // Bulk upsert: INSERT ... VALUES (...), (...), (...) ON CONFLICT DO UPDATE
    // The conflict SET clause reads from the EXCLUDED pseudo-table so every
    // row takes its own inbound values rather than the first row's. `sql` is
    // Drizzle's parametric template — `excluded.*` is a Postgres keyword, not
    // user input, so no injection surface.
    await tx.insert(followUpState).values(stateValues)
      .onConflictDoUpdate({
        target: followUpState.studentKey,
        set: {
          status: sql`excluded.status`,
          updatedAt: sql`now()`,
          updatedByEmail: sql`excluded.updated_by_email`,
          updatedByName: sql`excluded.updated_by_name`,
          studentName: sql`excluded.student_name`,
          parentName: sql`excluded.parent_name`,
        },
      });

    // Append-only audit log — no ON CONFLICT (event_id is a uuid default).
    await tx.insert(followUpLog).values(logValues);
  });
}
