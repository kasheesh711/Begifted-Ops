import { requireSessionUser } from "@/lib/auth/session";
import { DASHBOARD_ACTION_LOG_SHEET } from "@/lib/dashboard/config";
import { getSheetsEnv } from "@/lib/runtime/env";
import { getSheetsClient } from "@/lib/sheets/client";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    await requireSessionUser();

    const { searchParams } = new URL(request.url);
    const studentKey = searchParams.get("studentKey")?.trim();

    if (!studentKey) {
      return NextResponse.json({ error: "studentKey is required" }, { status: 400 });
    }

    const sheets = getSheetsClient();
    const env = getSheetsEnv();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
      range: `${DASHBOARD_ACTION_LOG_SHEET}!A:I`,
    });

    const values = response.data.values ?? [];
    const dataRows = values.slice(1);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const entries = dataRows
      .filter((row) => {
        const rowStudentKey = String(row[1] ?? "").trim();
        if (rowStudentKey !== studentKey) return false;
        const updatedAt = String(row[6] ?? "").trim();
        if (!updatedAt) return false;
        const date = new Date(updatedAt);
        return date >= sevenDaysAgo;
      })
      .map((row) => ({
        status: String(row[4] ?? "").trim(),
        updatedAt: String(row[6] ?? "").trim(),
        updatedByName: String(row[8] ?? "").trim(),
        actionType: String(row[5] ?? "set").trim() as "set" | "clear",
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 20);

    return NextResponse.json({ entries });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load history" },
      { status: 500 },
    );
  }
}
