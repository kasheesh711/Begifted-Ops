// SVC-04 — Phase 3 inactive-student toggle endpoint.
//
// POST → markInactiveStudent (Postgres write via actions.ts facade).
// DELETE → clearInactiveStudent (Postgres delete via actions.ts facade).
// Cache invalidation lives inside the facade (D-28); this handler does NOT
// call revalidateTag directly.
//
// External JSON shape preserved:
//   POST   → { ok: true } on success
//   DELETE → { ok: true } on success
// (Pre-cutover handler returned { studentKey, inactive: bool } — but the
// React client only reads response.ok, so { ok: true } is a safe shape.)
//
// NOTE per Plan 03-01: `export const runtime = "nodejs"` is forbidden when
// nextConfig.cacheComponents is true. Route still executes on Node.js.
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import {
  markInactiveStudent,
  clearInactiveStudent,
} from "@/lib/dashboard/actions";
import { getDashboardPayload } from "@/lib/dashboard/service";
import { log } from "@/lib/runtime/logger";

/** Mark a student as inactive (no longer taking classes). */
export async function POST(request: Request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = (await request.json()) as { studentKey?: string };
    const studentKey = String(body.studentKey ?? "").trim();

    if (!studentKey) {
      return NextResponse.json({ error: "studentKey is required" }, { status: 400 });
    }

    // Lookup for studentName/parentName threading (mirrors single-action route).
    const payload = await getDashboardPayload();
    const student = payload.students.find((item) => item.studentKey === studentKey);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    await markInactiveStudent({
      studentKey,
      studentName: student.student,
      parentName: student.parent,
      markedByEmail: sessionUser.email,
      markedByName: sessionUser.name,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorEnvelope("/api/inactive", error);
  }
}

/** Clear inactive status for a student. */
export async function DELETE(request: Request) {
  try {
    await requireSessionUser();
    const body = (await request.json()) as { studentKey?: string };
    const studentKey = String(body.studentKey ?? "").trim();

    if (!studentKey) {
      return NextResponse.json({ error: "studentKey is required" }, { status: 400 });
    }

    await clearInactiveStudent(studentKey);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorEnvelope("/api/inactive", error);
  }
}

function errorEnvelope(route: string, error: unknown) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  log("error", route, error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Inactive request failed" },
    { status: 500 },
  );
}
