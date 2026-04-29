import { requireSessionUser } from "@/lib/auth/session";
import { getDashboardPayload, invalidateDashboardPayloadCache } from "@/lib/dashboard/service";
import { markStudentInactive, clearStudentInactive } from "@/lib/sheets/inactive-students";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Mark a student as inactive (no longer taking classes). */
export async function POST(request: Request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = (await request.json()) as { studentKey?: string };
    const studentKey = String(body.studentKey ?? "").trim();

    if (!studentKey) {
      return NextResponse.json({ error: "studentKey is required" }, { status: 400 });
    }

    const payload = await getDashboardPayload();
    const student = payload.students.find((item) => item.studentKey === studentKey);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    await markStudentInactive({
      studentKey,
      studentName: student.student,
      parentName: student.parent,
      actor: sessionUser,
    });

    invalidateDashboardPayloadCache();
    return NextResponse.json({ studentKey, inactive: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to mark inactive" },
      { status: 500 },
    );
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

    await clearStudentInactive(studentKey);

    invalidateDashboardPayloadCache();
    return NextResponse.json({ studentKey, inactive: false });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear inactive" },
      { status: 500 },
    );
  }
}
