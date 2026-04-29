import { formatDate, parseDate } from "@/lib/dashboard/helpers";
import type { ActionState, StudentActionStatus, StudentRecord } from "@/types/dashboard";

const VALID_STATUSES: StudentActionStatus[] = ["contacted", "pending-callback", "resolved"];

export function normalizeStudentActionStatus(status: unknown): StudentActionStatus | null {
  const normalized = String(status ?? "").trim().toLowerCase();
  return VALID_STATUSES.includes(normalized as StudentActionStatus)
    ? (normalized as StudentActionStatus)
    : null;
}

export function sanitizeStudentActionState(
  actionState: ActionState | null | undefined,
  today: Date,
): ActionState | null {
  if (!actionState || !actionState.status || !normalizeStudentActionStatus(actionState.status)) {
    return null;
  }

  if (!isActionStateToday(actionState.updatedAt, today)) {
    return null;
  }

  return {
    status: actionState.status,
    updatedAt: actionState.updatedAt,
    updatedByName: actionState.updatedByName || "",
    isToday: true,
  };
}

export function attachActionStatesToStudents(
  students: StudentRecord[],
  today: Date,
  actionStatesByKey: Record<string, ActionState | null>,
) {
  students.forEach((student) => {
    student.actionState = sanitizeStudentActionState(actionStatesByKey[student.studentKey], today);
  });
}

export function isActionStateToday(updatedAt: string, today: Date) {
  const parsed = parseDate(updatedAt);
  return !!parsed && formatDate(parsed) === formatDate(today);
}
