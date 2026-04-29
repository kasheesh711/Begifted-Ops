import { requireSessionUser } from "@/lib/auth/session";
import { getDashboardPayload, invalidateDashboardPayloadCache } from "@/lib/dashboard/service";
import { normalizeStudentActionStatus } from "@/lib/dashboard/actions";
import { clearStudentActionInSheets, setStudentActionInSheets } from "@/lib/sheets/actions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = (await request.json()) as { studentKey?: string; status?: string | null };
    const studentKey = String(body.studentKey ?? "").trim();

    if (!studentKey) {
      return NextResponse.json({ error: "studentKey is required" }, { status: 400 });
    }

    const payload = await getDashboardPayload();
    const student = payload.students.find((item) => item.studentKey === studentKey);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const normalizedStatus = normalizeStudentActionStatus(body.status);
    const result = normalizedStatus
      ? await setStudentActionInSheets({
          studentKey,
          studentName: student.student,
          parentName: student.parent,
          status: normalizedStatus,
          actor: sessionUser,
        })
      : await clearStudentActionInSheets({
          studentKey,
          studentName: student.student,
          parentName: student.parent,
          actor: sessionUser,
        });

    invalidateDashboardPayloadCache();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action request failed" },
      { status: 500 },
    );
  }
}
