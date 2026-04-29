import { randomUUID } from "node:crypto";

import {
  DASHBOARD_ACTION_LOG_HEADERS,
  DASHBOARD_ACTION_LOG_SHEET,
  DASHBOARD_ACTION_STATE_HEADERS,
  DASHBOARD_ACTION_STATE_SHEET,
  SHEETS_IN_MEMORY_TTL_MS,
} from "@/lib/dashboard/config";
import { sanitizeStudentActionState } from "@/lib/dashboard/actions";
import { formatDateTime } from "@/lib/dashboard/helpers";
import type { ActionState, ActionLogRow, ActionStateRow, StudentActionStatus } from "@/types/dashboard";
import { clearMemoryCache, getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { getSheetsEnv } from "@/lib/runtime/env";
import { getSheetsClient } from "@/lib/sheets/client";

export interface ActionActor {
  email: string;
  name: string;
}

interface ActionSheetState {
  rows: ActionStateRow[];
  rowIndexByStudentKey: Record<string, number>;
}

export async function loadActionStates(today: Date) {
  const state = await getActionSheetState();
  return state.rows.reduce<Record<string, ActionState | null>>((map, row) => {
    map[row.student_key] = sanitizeStudentActionState(
      {
        status: row.status as StudentActionStatus,
        updatedAt: row.updated_at,
        updatedByName: row.updated_by_name,
        isToday: true,
      },
      today,
    );
    return map;
  }, {});
}

export async function setStudentActionInSheets(input: {
  studentKey: string;
  studentName: string;
  parentName: string;
  status: StudentActionStatus;
  actor: ActionActor;
  now?: Date;
}) {
  return writeStudentActionState({ ...input, actionType: "set" });
}

export async function clearStudentActionInSheets(input: {
  studentKey: string;
  studentName: string;
  parentName: string;
  actor: ActionActor;
  now?: Date;
}) {
  return writeStudentActionState({ ...input, status: "", actionType: "clear" as const });
}

async function writeStudentActionState(input: {
  studentKey: string;
  studentName: string;
  parentName: string;
  status: string;
  actor: ActionActor;
  actionType: "set" | "clear";
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const state = await getActionSheetState();
  const sheets = getSheetsClient();
  const env = getSheetsEnv();
  const updatedAt = formatDateTime(now);
  const stateRow: ActionStateRow = {
    student_key: input.studentKey,
    student_name: input.studentName,
    parent_name: input.parentName,
    status: input.status,
    updated_at: updatedAt,
    updated_by_email: input.actor.email,
    updated_by_name: input.actor.name,
  };
  const logRow: ActionLogRow = {
    event_id: randomUUID(),
    action_type: input.actionType,
    ...stateRow,
  };
  const stateValues = [
    [
      stateRow.student_key,
      stateRow.student_name,
      stateRow.parent_name,
      stateRow.status,
      stateRow.updated_at,
      stateRow.updated_by_email,
      stateRow.updated_by_name,
    ],
  ];
  const existingRowIndex = state.rowIndexByStudentKey[input.studentKey];

  if (existingRowIndex !== undefined) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
      range: `${DASHBOARD_ACTION_STATE_SHEET}!A${existingRowIndex + 2}:G${existingRowIndex + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: stateValues },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
      range: `${DASHBOARD_ACTION_STATE_SHEET}!A:G`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: stateValues },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
    range: `${DASHBOARD_ACTION_LOG_SHEET}!A:I`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          logRow.event_id,
          logRow.student_key,
          logRow.student_name,
          logRow.parent_name,
          logRow.status,
          logRow.action_type,
          logRow.updated_at,
          logRow.updated_by_email,
          logRow.updated_by_name,
        ],
      ],
    },
  });

  clearMemoryCache("sheets:action-state");

  return {
    studentKey: input.studentKey,
    actionState:
      input.actionType === "clear"
        ? null
        : ({
            status: input.status as StudentActionStatus,
            updatedAt,
            updatedByName: input.actor.name,
            isToday: true,
          } satisfies ActionState),
  };
}

async function getActionSheetState(): Promise<ActionSheetState> {
  return getOrSetMemoryCache("sheets:action-state", SHEETS_IN_MEMORY_TTL_MS, async () => {
    const sheets = getSheetsClient();
    const env = getSheetsEnv();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
      range: `${DASHBOARD_ACTION_STATE_SHEET}!A:G`,
    });
    const values = response.data.values ?? [];
    const dataRows = values.slice(1);
    const rows: ActionStateRow[] = dataRows.map((row) => ({
      student_key: String(row[0] ?? "").trim(),
      student_name: String(row[1] ?? "").trim(),
      parent_name: String(row[2] ?? "").trim(),
      status: String(row[3] ?? "").trim(),
      updated_at: String(row[4] ?? "").trim(),
      updated_by_email: String(row[5] ?? "").trim(),
      updated_by_name: String(row[6] ?? "").trim(),
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

export async function ensureActionSheetsExist() {
  const sheets = getSheetsClient();
  const env = getSheetsEnv();
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
  });
  const existingSheets = new Set(
    (spreadsheet.data.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean),
  );
  const requests: Array<Record<string, unknown>> = [];

  if (!existingSheets.has(DASHBOARD_ACTION_STATE_SHEET)) {
    requests.push({ addSheet: { properties: { title: DASHBOARD_ACTION_STATE_SHEET } } });
  }
  if (!existingSheets.has(DASHBOARD_ACTION_LOG_SHEET)) {
    requests.push({ addSheet: { properties: { title: DASHBOARD_ACTION_LOG_SHEET } } });
  }

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
      requestBody: { requests },
    });
  }

  await Promise.all([
    sheets.spreadsheets.values.update({
      spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
      range: `${DASHBOARD_ACTION_STATE_SHEET}!A1:G1`,
      valueInputOption: "RAW",
      requestBody: { values: [Array.from(DASHBOARD_ACTION_STATE_HEADERS)] },
    }),
    sheets.spreadsheets.values.update({
      spreadsheetId: env.SHEETS_SPREADSHEET_ID_ANALYTICS,
      range: `${DASHBOARD_ACTION_LOG_SHEET}!A1:I1`,
      valueInputOption: "RAW",
      requestBody: { values: [Array.from(DASHBOARD_ACTION_LOG_HEADERS)] },
    }),
  ]);
}
