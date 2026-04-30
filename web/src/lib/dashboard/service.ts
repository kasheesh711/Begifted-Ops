// web/src/lib/dashboard/service.ts
// SVC-02 — Phase 3 Wisenet + Postgres composer cached in Vercel Runtime Cache.
//
// Replaces the Phase 2 unstable-cache wrapper.
// Composes Wisenet (read path) + Postgres (action state, inactive flags, admin
// ownership sidecar) under the 'use cache: remote' directive, tagged with
// DASHBOARD_CACHE_TAG so actions.ts can invalidate via the two-arg cache API
// post-mutation in Wave 3 (03-04).
//
// Cache profile per 03-RESEARCH.md §Pattern 3 + §Pitfall 4:
//   - stale: 60s     (clients can serve stale up to 60s)
//   - revalidate: 60s (Vercel triggers a fresh build every 60s)
//   - expire: 300s   (hard TTL — eviction beyond this point)
// NOT { expire: 60 } — that shorthand silently inherits the 15-minute "default"
// revalidate from Next.js' default cacheLife profile.
//
// D-37 — structured console.error logger swapped in. Phase 4 DEPL-04 will
// flip the body of log() to Sentry.captureException; call sites stay.
//
// Anti-patterns DELIBERATELY ABSENT:
//   - cache invalidation API NOT imported — invalidation moves to actions.ts (Wave 3)
//   - unstable-cache NOT used — replaced by 'use cache: remote' directive
//   - lib/sheets/* NOT imported — Wisenet + Postgres only
//   - lib/dashboard/build NOT imported — body inlined here
//   - lib/dashboard/snapshot-store NOT imported — passing { lastSnapshot: null,
//     history: [] } accepts the cold-start delta-reset tradeoff (D-23/CONTEXT)
import { cacheLife, cacheTag } from "next/cache";

import { buildDashboardSourcesFromWisenet } from "@/lib/wisenet/mappers";
import {
  bulkGetAdminOwnership,
  loadActionStateMap,
  listInactive,
  clearInactive,
} from "@/lib/db/queries";
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
import {
  ADMIN_OWNER_REGISTRY,
  DASHBOARD_CACHE_TAG,
  UNASSIGNED_ADMIN_KEY,
  UNASSIGNED_ADMIN_NAME,
} from "@/lib/dashboard/config";
import { log } from "@/lib/runtime/logger";
import type { AdminViewKey } from "@/types/dashboard";

// Lookup map for admin label/fullName from the registry, keyed by adminKey enum.
// Used to translate Postgres student_admin_ownership.admin_key → the
// adminOwnerKey/adminOwnerName fields the client expects.
const ADMIN_REGISTRY_BY_KEY = new Map<string, { label: string; fullName: string }>(
  ADMIN_OWNER_REGISTRY.map((entry) => [entry.key, { label: entry.label, fullName: entry.fullName }]),
);

export async function getDashboardPayload(now: Date = new Date()) {
  "use cache: remote";
  cacheTag(DASHBOARD_CACHE_TAG);
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });

  const startedAt = Date.now();
  const today = getTodayDate(now);
  try {
    // 1. Wisenet read — students, sessions, parent join, teacher feedback fan-out.
    const sources = await buildDashboardSourcesFromWisenet(today);
    recordSheetsCheck(true, now.toISOString());

    // 2. Pure dashboard composition (Phase 2 ports, unchanged).
    const activeStudents = buildActiveStudentSet(sources.students);
    const excludedPackageReasons = buildExcludedPackageReasons(sources.studentsCourses);
    // Sheets-era admin ownership map (RemainingCredits majority vote) becomes the
    // fallback layer; Postgres sidecar overrides per D-06 below.
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

    // 3. Postgres sidecar reads in parallel (D-06 admin ownership, action state,
    //    inactive flags). Empty studentKeys array short-circuits bulkGetAdminOwnership.
    const studentKeys = students.map((s) => s.studentKey);
    const [actionStateMap, inactiveRows, dbAdminOwnership] = await Promise.all([
      loadActionStateMap(),
      listInactive(),
      bulkGetAdminOwnership(studentKeys),
    ]);

    // 4. Apply Postgres admin-ownership override (D-06). The Sheets-derived map
    //    in adminOwnershipMap was already applied inside buildDashboardStudents;
    //    the sidecar wins over it for students that have an explicit Postgres row.
    for (const student of students) {
      const ownership = dbAdminOwnership.get(student.studentKey);
      if (!ownership) continue;
      const registryEntry = ADMIN_REGISTRY_BY_KEY.get(ownership.adminKey);
      if (registryEntry) {
        student.adminOwnerKey = ownership.adminKey as AdminViewKey;
        student.adminOwnerName = registryEntry.label;
        student.adminOwnershipSource = "postgres-sidecar";
      } else if (ownership.adminKey === UNASSIGNED_ADMIN_KEY) {
        student.adminOwnerKey = UNASSIGNED_ADMIN_KEY;
        student.adminOwnerName = UNASSIGNED_ADMIN_NAME;
        student.adminOwnershipSource = "postgres-sidecar";
      }
    }

    // 5. Attach same-day action state via the existing sanitizer.
    attachActionStatesToStudents(students, today, actionStateMap);

    // 6. Auto-reactivation + inactive filtering (Postgres-backed equivalent of
    //    the Sheets-era removeInactiveStudents path). If a student is in
    //    inactive_students AND now appears with active packages, DELETE the
    //    inactive row and keep the student in the queue.
    const inactiveSet = new Set(inactiveRows.map((row) => row.studentKey));
    const currentStudentKeys = new Set(students.map((s) => s.studentKey));
    const reactivated: string[] = [];
    for (const key of inactiveSet) {
      if (currentStudentKeys.has(key)) reactivated.push(key);
    }
    if (reactivated.length > 0) {
      await Promise.all(reactivated.map((key) => clearInactive(key)));
      reactivated.forEach((key) => inactiveSet.delete(key));
    }
    const filteredStudents = inactiveSet.size > 0
      ? students.filter((s) => !inactiveSet.has(s.studentKey))
      : students;

    // 7. Build view-model. Pass an empty snapshot state — snapshot-store is
    //    deleted in Wave 5 (D-33), and the cold-start delta-reset tradeoff is
    //    explicitly accepted (CONTEXT D-23).
    const dashboardModel = buildDashboardModel(
      filteredStudents,
      { lastSnapshot: null, history: [] },
      today,
      now,
    );

    recordPayloadBuild(Date.now() - startedAt, now.toISOString());

    // 8. Payload size sanity (Vercel Runtime Cache item limit is 2MB; warn at 1.8MB).
    const serialized = JSON.stringify(dashboardModel.payload);
    if (serialized.length > 1_800_000) {
      log(
        "warn",
        "service.ts/getDashboardPayload",
        new Error("payload-size-near-limit"),
        { sizeBytes: serialized.length },
      );
    }

    return dashboardModel.payload;
  } catch (error) {
    log("error", "service.ts/getDashboardPayload", error);
    throw error;
  }
}
