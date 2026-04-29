import {
  INACTIVE_STUDENTS_SHEET,
  INACTIVE_STUDENTS_HEADERS,
  SHEETS_IN_MEMORY_TTL_MS,
} from "@/lib/dashboard/config";
import { formatDateTime } from "@/lib/dashboard/helpers";
import { clearMemoryCache, getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { getSheetsEnv } from "@/lib/runtime/env";
import { getSheetsClient } from "@/lib/sheets/client";

export interface InactiveStudentRow {
  student_key: string;
  student_name: string;
  parent_name: string;
  marked_at: string;
  marked_by_email: string;
  marked_by_name: string;
}

interface InactiveSheetState {
  rows: InactiveStudentRow[];
  /** Maps student_key → 0-based data-row index (sheet row = index + 2) */
  rowIndexByStudentKey: Record<string, number>;
}

export async function loadInactiveStudents(): Promise<InactiveSheetState> {
  return getOrSetMemoryCache("sheets:inactive-students", SHEETS_IN_MEMORY_TTL_MS, async () => {
    const sheets = getSheetsClient();
    const env = getSheetsEnv();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
      range: `${INACTIVE_STUDENTS_SHEET}!A:F`,
    });
    const values = response.data.values ?? [];
    const dataRows = values.slice(1);
    const rows: InactiveStudentRow[] = dataRows.map((row) => ({
      student_key: String(row[0] ?? "").trim(),
      student_name: String(row[1] ?? "").trim(),
      parent_name: String(row[2] ?? "").trim(),
      marked_at: String(row[3] ?? "").trim(),
      marked_by_email: String(row[4] ?? "").trim(),
      marked_by_name: String(row[5] ?? "").trim(),
    }));

    const rowIndexByStudentKey = rows.reduce<Record<string, number>>((map, row, index) => {
      if (row.student_key) {
        map[row.student_key] = index;
      }
      return map;
    }, {});

    return { rows, rowIndexByStudentKey };
  });
}

export async function loadInactiveStudentKeys(): Promise<Set<string>> {
  const state = await loadInactiveStudents();
  return new Set(state.rows.map((r) => r.student_key).filter(Boolean));
}

export async function markStudentInactive(input: {
  studentKey: string;
  studentName: string;
  parentName: string;
  actor: { email: string; name: string };
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const sheets = getSheetsClient();
  const env = getSheetsEnv();
  const state = await loadInactiveStudents();

  // Already inactive — no-op
  if (state.rowIndexByStudentKey[input.studentKey] !== undefined) {
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
    range: `${INACTIVE_STUDENTS_SHEET}!A:F`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          input.studentKey,
          input.studentName,
          input.parentName,
          formatDateTime(now),
          input.actor.email,
          input.actor.name,
        ],
      ],
    },
  });

  clearMemoryCache("sheets:inactive-students");
}

export async function clearStudentInactive(studentKey: string) {
  const state = await loadInactiveStudents();
  const rowIndex = state.rowIndexByStudentKey[studentKey];
  if (rowIndex === undefined) return;

  await deleteInactiveSheetRows([rowIndex]);
}

/**
 * Remove multiple inactive rows in one batch. Used for auto-reactivation.
 * Accepts student keys (not row indices).
 */
export async function removeInactiveStudents(studentKeys: string[]) {
  if (!studentKeys.length) return;
  const state = await loadInactiveStudents();
  const indices = studentKeys
    .map((key) => state.rowIndexByStudentKey[key])
    .filter((i): i is number => i !== undefined);
  if (!indices.length) return;
  await deleteInactiveSheetRows(indices);
}

async function deleteInactiveSheetRows(dataRowIndices: number[]) {
  const sheets = getSheetsClient();
  const env = getSheetsEnv();

  // Get sheet ID for batchUpdate deletions
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
  });
  const sheetMeta = (spreadsheet.data.sheets ?? []).find(
    (s) => s.properties?.title === INACTIVE_STUDENTS_SHEET,
  );
  if (!sheetMeta?.properties?.sheetId) return;
  const sheetId = sheetMeta.properties.sheetId;

  // Delete rows from bottom to top so indices stay valid
  const sorted = [...dataRowIndices].sort((a, b) => b - a);
  const requests = sorted.map((dataIndex) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: dataIndex + 1, // +1 for header row
        endIndex: dataIndex + 2,
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
    requestBody: { requests },
  });

  clearMemoryCache("sheets:inactive-students");
}

export async function ensureInactiveStudentsSheetExists() {
  const sheets = getSheetsClient();
  const env = getSheetsEnv();
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
  });
  const existingSheets = new Set(
    (spreadsheet.data.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean),
  );

  if (!existingSheets.has(INACTIVE_STUDENTS_SHEET)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
      requestBody: {
        requests: [{ addSheet: { properties: { title: INACTIVE_STUDENTS_SHEET } } }],
      },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
    range: `${INACTIVE_STUDENTS_SHEET}!A1:F1`,
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(INACTIVE_STUDENTS_HEADERS)] },
  });
}
