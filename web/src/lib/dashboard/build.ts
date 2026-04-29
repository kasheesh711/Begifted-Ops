import { attachActionStatesToStudents } from "@/lib/dashboard/actions";
import { buildDashboardModel } from "@/lib/dashboard/analytics";
import { recordPayloadBuild, recordSheetsCheck } from "@/lib/dashboard/health-state";
import {
  buildActiveStudentSet,
  buildDashboardStudents,
  buildExcludedPackageReasons,
  buildPendingDeductionContext,
  buildStudentAdminOwnershipMap,
  buildUpcomingSessionMap,
} from "@/lib/dashboard/packages";
import { getTodayDate } from "@/lib/dashboard/helpers";
import { loadSnapshotState, persistSnapshotState } from "@/lib/dashboard/snapshot-store";
import { loadActionStates } from "@/lib/sheets/actions";
import { loadInactiveStudentKeys, removeInactiveStudents } from "@/lib/sheets/inactive-students";
import { loadDashboardSources } from "@/lib/sheets/source-loader";

export async function buildDashboardPayloadUncached(now = new Date()) {
  const startedAt = Date.now();
  const today = getTodayDate(now);
  const sources = await loadDashboardSources();
  recordSheetsCheck(true, now.toISOString());

  const activeStudents = buildActiveStudentSet(sources.students);
  const excludedPackageReasons = buildExcludedPackageReasons(sources.studentsCourses);
  const adminOwnershipMap = buildStudentAdminOwnershipMap(sources.remainingCredits);
  const pendingDeductionContext = buildPendingDeductionContext(
    sources.creditControl,
    activeStudents,
    excludedPackageReasons,
    today,
  );
  const upcomingSessionMap = buildUpcomingSessionMap(
    sources.upcoming,
    activeStudents,
    excludedPackageReasons,
    today,
  );
  const students = buildDashboardStudents(
    sources.aggregations,
    activeStudents,
    excludedPackageReasons,
    pendingDeductionContext,
    upcomingSessionMap,
    today,
    adminOwnershipMap,
  );
  const actionStates = await loadActionStates(today);
  attachActionStatesToStudents(students, today, actionStates);

  // --- Inactive student filtering ---
  const inactiveKeys = await loadInactiveStudentKeys();
  // Auto-reactivation: students marked inactive who now have active packages again
  const currentStudentKeys = new Set(students.map((s) => s.studentKey));
  const reactivated = [...inactiveKeys].filter((key) => currentStudentKeys.has(key));
  if (reactivated.length) {
    await removeInactiveStudents(reactivated);
    reactivated.forEach((key) => inactiveKeys.delete(key));
  }
  // Filter out inactive students from the dashboard
  const activeFilteredStudents = inactiveKeys.size > 0
    ? students.filter((s) => !inactiveKeys.has(s.studentKey))
    : students;

  const snapshotState = loadSnapshotState();
  const dashboardModel = buildDashboardModel(activeFilteredStudents, snapshotState, today, now);

  persistSnapshotState(dashboardModel.snapshotState);
  recordPayloadBuild(Date.now() - startedAt, now.toISOString());
  return dashboardModel.payload;
}
