// web/src/lib/db/schema.ts
// Source: Plan 02-05 Task 1 + 02-RESEARCH.md §DB-02 + 02-CONTEXT.md §D-06
//
// Drizzle schema for the Postgres write layer. Defines the 4 tables and 3 enums
// that back follow-up state, action log, inactive-student flags, and admin ownership.
// Plan 02-06 imports the table references + inferred types to build typed queries.
// Plan 02-09 imports the generated migration SQL (drizzle/0000_initial.sql) to run
// migrations from GH Actions.
import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// --- Enums ---

// StudentActionStatus from web/src/types/dashboard.ts::StudentActionStatus
// MUST match the 3 status values used by the existing dashboard-logic action layer.
export const studentActionStatusEnum = pgEnum("student_action_status", [
  "contacted",
  "pending-callback",
  "resolved",
]);

// ActionLogType — covers single-student writes ('set'|'clear') and the Phase 3
// bulk endpoint ('bulk-set'|'bulk-clear'). Used only in follow_up_log.action_type.
export const actionLogTypeEnum = pgEnum("action_log_type", [
  "set",
  "clear",
  "bulk-set",
  "bulk-clear",
]);

// Admin keys from web/src/lib/dashboard/config.ts::ADMIN_OWNER_REGISTRY
// + UNASSIGNED_ADMIN_KEY. MUST match the 6 named admins + 'unassigned' fallback.
export const adminKeyEnum = pgEnum("admin_key", [
  "palm",
  "kem",
  "care",
  "aya",
  "petchy",
  "muk",
  "unassigned",
]);

// --- Tables ---

// follow_up_state — current follow-up status per student (one row per studentKey).
// Primary read path from the dashboard: "what is the latest status for this student?"
// Same-day visibility is enforced by the TS layer (sanitizeStudentActionState),
// not in SQL — see DB-05 preservation note in 02-RESEARCH.md.
export const followUpState = pgTable(
  "follow_up_state",
  {
    studentKey: text("student_key").primaryKey(), // <normalized-student>::<normalized-parent>
    studentName: text("student_name").notNull(),
    parentName: text("parent_name").notNull(),
    status: studentActionStatusEnum("status").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedByEmail: text("updated_by_email").notNull(),
    updatedByName: text("updated_by_name").notNull(),
  },
  (table) => [
    // DB-05: same-day visibility query selects WHERE updated_at >= start_of_today
    index("follow_up_state_updated_at_idx").on(sql`${table.updatedAt} DESC`),
  ],
);

// follow_up_log — append-only audit log of every follow-up action (set/clear/bulk).
// Powers the 7-day history endpoint (api/actions/history) and future audit views.
// Nullable status is deliberate: 'clear'/'bulk-clear' events have no status.
export const followUpLog = pgTable(
  "follow_up_log",
  {
    eventId: uuid("event_id").primaryKey().defaultRandom(),
    studentKey: text("student_key").notNull(),
    studentName: text("student_name").notNull(),
    parentName: text("parent_name").notNull(),
    actionType: actionLogTypeEnum("action_type").notNull(),
    status: studentActionStatusEnum("status"), // NULL when action_type in ('clear','bulk-clear')
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorEmail: text("actor_email").notNull(),
    actorName: text("actor_name").notNull(),
  },
  (table) => [
    index("follow_up_log_student_key_created_at_idx").on(
      table.studentKey,
      sql`${table.createdAt} DESC`,
    ),
    index("follow_up_log_created_at_idx").on(sql`${table.createdAt} DESC`),
  ],
);

// inactive_students — operator flag to exclude a student from the triage queue.
// Auto-reactivation logic (when the student reappears with active packages) lives
// in the TS dashboard layer and may clear the row; the migration doesn't model
// auto-clear as a status column since it's a lifecycle event, not a schema value.
export const inactiveStudents = pgTable("inactive_students", {
  studentKey: text("student_key").primaryKey(),
  studentName: text("student_name").notNull(),
  parentName: text("parent_name").notNull(),
  markedAt: timestamp("marked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  markedByEmail: text("marked_by_email").notNull(),
});

// student_admin_ownership — per D-06 sidecar table. Seeded from RemainingCredits
// majority-vote at cutover (Plan 02-07 logic, wired into Plan 02-09 runbook).
// Indexed on admin_key for the per-admin queue filter path.
export const studentAdminOwnership = pgTable(
  "student_admin_ownership",
  {
    studentKey: text("student_key").primaryKey(), // matches follow_up_state.student_key pattern
    adminKey: adminKeyEnum("admin_key").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    assignedByEmail: text("assigned_by_email").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("student_admin_ownership_admin_key_idx").on(table.adminKey),
  ],
);

// --- Inferred types (drizzle-orm 0.45+ inference) ---
// Plan 02-06 queries import these to get typed row + insert shapes.

export type FollowUpStateRow = typeof followUpState.$inferSelect;
export type FollowUpStateInsert = typeof followUpState.$inferInsert;
export type FollowUpLogRow = typeof followUpLog.$inferSelect;
export type FollowUpLogInsert = typeof followUpLog.$inferInsert;
export type InactiveStudentRow = typeof inactiveStudents.$inferSelect;
export type InactiveStudentInsert = typeof inactiveStudents.$inferInsert;
export type StudentAdminOwnershipRow = typeof studentAdminOwnership.$inferSelect;
export type StudentAdminOwnershipInsert = typeof studentAdminOwnership.$inferInsert;
