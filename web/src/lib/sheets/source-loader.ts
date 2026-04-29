import {
  REQUIRED_COLUMNS,
  SHEET_AGGREGATIONS,
  SHEET_CREDIT_CONTROL,
  SHEET_REMAINING_CREDITS,
  SHEET_STUDENTS,
  SHEET_STUDENTS_COURSES,
  SHEET_UPCOMING,
  SHEETS_IN_MEMORY_TTL_MS,
} from "@/lib/dashboard/config";
import type { DashboardSources, SheetSnapshot } from "@/lib/dashboard/domain";
import { getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { getSheetsEnv } from "@/lib/runtime/env";
import { getSheetsClient } from "@/lib/sheets/client";

type SheetsValueRange = NonNullable<
  {
    range?: string | null;
    values?: unknown[][] | null;
  }[]
>[number];

export async function loadDashboardSources(): Promise<DashboardSources> {
  return getOrSetMemoryCache("sheets:dashboard-sources", SHEETS_IN_MEMORY_TTL_MS, async () => {
    const env = getSheetsEnv();
    const sheets = getSheetsClient();
    const [creditsResponse, analyticsResponse] = await Promise.all([
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: env.SHEETS_SPREADSHEET_ID_CREDITS,
        ranges: [`${SHEET_AGGREGATIONS}!A:ZZ`],
      }),
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
        ranges: [
          `${SHEET_CREDIT_CONTROL}!A:ZZ`,
          `${SHEET_UPCOMING}!A:ZZ`,
          `${SHEET_STUDENTS}!A:ZZ`,
          `${SHEET_STUDENTS_COURSES}!A:ZZ`,
          `${SHEET_REMAINING_CREDITS}!A:ZZ`,
        ],
      }),
    ]);

    const creditsRanges = creditsResponse.data.valueRanges ?? [];
    const analyticsRanges = analyticsResponse.data.valueRanges ?? [];

    return {
      aggregations: getSheetSnapshot(creditsRanges[0], SHEET_AGGREGATIONS, REQUIRED_COLUMNS.aggregations),
      creditControl: getSheetSnapshot(analyticsRanges[0], SHEET_CREDIT_CONTROL, REQUIRED_COLUMNS.creditControl),
      upcoming: getSheetSnapshot(analyticsRanges[1], SHEET_UPCOMING, REQUIRED_COLUMNS.upcoming),
      students: getSheetSnapshot(analyticsRanges[2], SHEET_STUDENTS, REQUIRED_COLUMNS.students, {
        headerColumnName: "student_name",
      }),
      studentsCourses: getSheetSnapshot(
        analyticsRanges[3],
        SHEET_STUDENTS_COURSES,
        REQUIRED_COLUMNS.studentsCourses,
      ),
      remainingCredits: getSheetSnapshot(
        analyticsRanges[4],
        SHEET_REMAINING_CREDITS,
        REQUIRED_COLUMNS.remainingCredits,
      ),
    };
  });
}

function getSheetSnapshot(
  range: SheetsValueRange | undefined,
  sheetName: string,
  requiredColumns: readonly string[],
  options?: { headerColumnName?: string },
): SheetSnapshot {
  const rows = (range?.values ?? []).filter((row) => row.some((cell) => cell !== "" && cell !== null));
  const headerRowIndex = options?.headerColumnName ? findHeaderRowIndex(rows, options.headerColumnName) : 0;

  if (headerRowIndex === -1) {
    throw new Error(
      `Sheet "${sheetName}" is missing a header row containing "${options?.headerColumnName}".`,
    );
  }

  const headerRow = rows[headerRowIndex] ?? [];
  const cols = getColMap(headerRow);
  validateRequiredColumns(sheetName, cols, requiredColumns);

  return {
    sheetName,
    headerRowIndex,
    dataRowStartIndex: headerRowIndex + 2,
    cols,
    rows: rows.slice(headerRowIndex + 1),
  };
}

function getColMap(headerRow: unknown[]) {
  const map: Record<string, number> = {};
  headerRow.forEach((header, index) => {
    if (header !== "" && header !== null && header !== undefined) {
      map[String(header).trim()] = index;
    }
  });
  return map;
}

function findHeaderRowIndex(rows: unknown[][], headerColumnName: string) {
  const target = String(headerColumnName).trim().toLowerCase();
  return rows.findIndex((row) =>
    row.some((cell) => String(cell).trim().toLowerCase() === target),
  );
}

function validateRequiredColumns(
  sheetName: string,
  cols: Record<string, number>,
  requiredColumns: readonly string[],
) {
  const missing = requiredColumns.filter((columnName) => !Object.prototype.hasOwnProperty.call(cols, columnName));
  if (missing.length) {
    throw new Error(`Sheet "${sheetName}" is missing required columns: ${missing.join(", ")}`);
  }
}
