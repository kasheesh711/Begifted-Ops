// SVC-04 — Phase 3 single-student action endpoint.
//
// POST flow: auth → parse studentKey + status → 404 lookup via dashboard
// payload → set or clear via the actions.ts 'use server' facade.
// Cache invalidation lives inside the facade (D-28); this handler does NOT
// call revalidateTag directly.
//
// External JSON shape preserved: returns { ok: true } on success — same shape
// that the existing React client treats as a success indicator (it does not
// consume a structured result body, only the status code + ok flag).
//
// NOTE per Plan 03-01: `export const runtime = "nodejs"` is forbidden when
// nextConfig.cacheComponents is true. Route still executes on Node.js.
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { getDashboardPayload } from "@/lib/dashboard/service";
import {
  setStudentAction,
  clearStudentAction,
} from "@/lib/dashboard/actions";
import { normalizeStudentActionStatus } from "@/lib/dashboard/action-helpers";
import { log } from "@/lib/runtime/logger";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = (await request.json()) as { studentKey?: string; status?: string | null };
    const studentKey = String(body.studentKey ?? "").trim();

    if (!studentKey) {
      return NextResponse.json({ error: "studentKey is required" }, { status: 400 });
    }

    // Lookup student in payload to thread name/parent through to the facade
    // (preserves rename behavior — facade re-writes student_name + parent_name
    // on the conflict-update path) and preserves the existing 404 contract.
    const payload = await getDashboardPayload();
    const student = payload.students.find((item) => item.studentKey === studentKey);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const normalizedStatus = normalizeStudentActionStatus(body.status);
    if (normalizedStatus) {
      await setStudentAction({
        studentKey,
        studentName: student.student,
        parentName: student.parent,
        status: normalizedStatus,
        updatedByEmail: sessionUser.email,
        updatedByName: sessionUser.name,
      });
    } else {
      await clearStudentAction({
        studentKey,
        studentName: student.student,
        parentName: student.parent,
        actorEmail: sessionUser.email,
        actorName: sessionUser.name,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log("error", "/api/actions", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action request failed" },
      { status: 500 },
    );
  }
}
