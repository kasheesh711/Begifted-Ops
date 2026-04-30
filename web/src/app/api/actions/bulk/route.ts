// SVC-04 — Phase 3 bulk-action endpoint.
//
// POST flow: auth → parse + dedupe studentKeys → validate status → lookup
// students in payload → call bulkSetAction facade (single BEGIN/COMMIT
// transaction on the WebSocket Pool driver per D-25). Cache invalidation
// lives inside the facade (D-28).
//
// External JSON shape preserved: returns { updated: string[] } where the
// array contains the (deduplicated, lookup-resolved) studentKeys that were
// actually written. Pre-cutover handler returned { updated: ActionState[] };
// the new shape returns just keys because the facade does not return the
// per-student result rows. The React client only consumes the array length
// for toast count, so this is a non-breaking compatibility change.
//
// NOTE per Plan 03-01: `export const runtime = "nodejs"` is forbidden when
// nextConfig.cacheComponents is true. Route still executes on Node.js.
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { getDashboardPayload } from "@/lib/dashboard/service";
import { bulkSetAction } from "@/lib/dashboard/actions";
import { normalizeStudentActionStatus } from "@/lib/dashboard/action-helpers";
import { log } from "@/lib/runtime/logger";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = (await request.json()) as { studentKeys?: string[]; status?: string | null };

    const uniqueKeys = Array.from(
      new Set((body.studentKeys ?? []).map((item) => String(item ?? "").trim()).filter(Boolean)),
    );

    if (!uniqueKeys.length) {
      return NextResponse.json({ error: "studentKeys is required" }, { status: 400 });
    }

    const normalizedStatus = normalizeStudentActionStatus(body.status);
    if (!normalizedStatus) {
      return NextResponse.json({ error: "valid status is required" }, { status: 400 });
    }

    // Lookup each requested key in the dashboard payload — drop unknowns,
    // thread name/parent through to the facade for the rename-on-write path.
    const payload = await getDashboardPayload();
    const updates = uniqueKeys
      .map((studentKey) => payload.students.find((item) => item.studentKey === studentKey))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({
        studentKey: s.studentKey,
        studentName: s.student,
        parentName: s.parent,
        status: normalizedStatus,
      }));

    if (!updates.length) {
      return NextResponse.json({ updated: [] });
    }

    await bulkSetAction({
      updates,
      actorEmail: sessionUser.email,
      actorName: sessionUser.name,
    });

    return NextResponse.json({ updated: updates.map((u) => u.studentKey) });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log("error", "/api/actions/bulk", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk action request failed" },
      { status: 500 },
    );
  }
}
