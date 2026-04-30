import { requireSessionUser } from "@/lib/auth/session";
import { normalizeStudentActionStatus } from "@/lib/dashboard/actions";
import { DASHBOARD_CACHE_TAG } from "@/lib/dashboard/config";
import { recordCacheInvalidation } from "@/lib/dashboard/health-state";
import { getDashboardPayload } from "@/lib/dashboard/service";
import { clearStudentActionInSheets, setStudentActionInSheets } from "@/lib/sheets/actions";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

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
    const payload = await getDashboardPayload();

    const updated = [];
    for (const studentKey of uniqueKeys) {
      const student = payload.students.find((item) => item.studentKey === studentKey);
      if (!student) {
        continue;
      }

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

      updated.push(result);
    }

    revalidateTag(DASHBOARD_CACHE_TAG, "max");
    recordCacheInvalidation(new Date().toISOString());
    return NextResponse.json({ updated });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk action request failed" },
      { status: 500 },
    );
  }
}
