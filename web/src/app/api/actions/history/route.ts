// SVC-04 — Phase 3 follow-up history endpoint.
//
// GET ?studentKey=<key> — returns the 7-day audit log for one student from
// the Postgres follow_up_log table (DB-04). External JSON shape preserved:
// { history: Array<{ status, updatedAt, updatedByName, actionType }> } —
// matches the shape student-detail.tsx consumes via the "View history" panel.
//
// Pre-cutover Sheets-era handler returned the response under the key
// "entries"; the React client reads from "history" — so this rename ALIGNS
// with the consumer's actual expectation. (The Sheets-era key was wrong; no
// known caller relied on "entries".)
//
// NOTE per Plan 03-01: `export const runtime = "nodejs"` is forbidden when
// nextConfig.cacheComponents is true. Route still executes on Node.js.
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { readHistory } from "@/lib/db/queries";
import { log } from "@/lib/runtime/logger";

export async function GET(request: Request) {
  try {
    await requireSessionUser();
    const { searchParams } = new URL(request.url);
    const studentKey = String(searchParams.get("studentKey") ?? "").trim();

    if (!studentKey) {
      return NextResponse.json({ error: "studentKey is required" }, { status: 400 });
    }

    const rows = await readHistory(studentKey, 7);
    const history = rows.map((row) => ({
      status: row.status,
      updatedAt: row.createdAt.toISOString(),
      updatedByName: row.actorName,
      actionType: row.actionType,
    }));

    return NextResponse.json({ history });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log("error", "/api/actions/history", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load history" },
      { status: 500 },
    );
  }
}
