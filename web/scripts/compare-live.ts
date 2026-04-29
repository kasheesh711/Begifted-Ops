import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildDashboardPayloadUncached } from "@/lib/dashboard/build";
import type { DashboardPayload, PackageRecord, StudentQueueRow, StudentRecord, SummaryPayload } from "@/types/dashboard";

const execFileAsync = promisify(execFile);
const MAX_MISMATCHES = 200;

type QueueComparableField =
  | "studentKey"
  | "worstStatus"
  | "totalCurrentRemaining"
  | "totalAdjustedRemaining"
  | "nextSessionDate"
  | "recommendedAction";

type PackageComparableField =
  | "status"
  | "currentRemaining"
  | "adjustedRemaining"
  | "pendingDeduction"
  | "alertDate"
  | "exhaustDate"
  | "nextSessionDate";

async function main() {
  const appsScriptPayload = await loadAppsScriptPayload();
  const nextPayload = await loadNextPayload();
  const mismatches = comparePayloads(nextPayload, appsScriptPayload);

  if (mismatches.length) {
    console.error(`Shadow parity failed with ${mismatches.length} mismatch(es).`);
    mismatches.slice(0, MAX_MISMATCHES).forEach((item) => console.error(`- ${item}`));
    process.exitCode = 1;
    return;
  }

  console.log("Shadow parity passed.");
  console.log(`Queue rows: ${nextPayload.studentQueue.length}`);
  console.log(`Students: ${nextPayload.students.length}`);
}

async function loadNextPayload() {
  const baseUrl = process.env.NEXT_BASE_URL?.trim();
  if (baseUrl) {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/dashboard`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Next dashboard request failed (${response.status})`);
    }
    return (await response.json()) as DashboardPayload;
  }

  return (await buildDashboardPayloadUncached()) as DashboardPayload;
}

async function loadAppsScriptPayload() {
  try {
    const { stdout, stderr } = await execFileAsync(
      "clasp",
      ["run", "fetchDashboardData"],
      {
        cwd: process.cwd(),
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return parseJsonPayload(output);
  } catch (error) {
    if (isExecError(error)) {
      const details = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
      throw new Error(details || error.message);
    }

    throw error;
  }
}

function parseJsonPayload(output: string) {
  const normalized = output.trim();
  if (/^Exception:/m.test(normalized) || /^Error:/m.test(normalized)) {
    throw new Error(normalized);
  }
  const candidates = [
    normalized,
    sliceJsonCandidate(normalized, "{", "}"),
    sliceJsonCandidate(normalized, "[", "]"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as DashboardPayload;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Unable to parse Apps Script payload as JSON.\n${normalized.slice(0, 2000)}`);
}

function sliceJsonCandidate(value: string, open: "{" | "[", close: "}" | "]") {
  const start = value.indexOf(open);
  const end = value.lastIndexOf(close);
  if (start === -1 || end === -1 || end <= start) return "";
  return value.slice(start, end + 1);
}

function comparePayloads(nextPayload: DashboardPayload, appsPayload: DashboardPayload) {
  const mismatches: string[] = [];

  compareValue("summary", nextPayload.summary, appsPayload.summary, mismatches);

  if (nextPayload.studentQueue.length !== appsPayload.studentQueue.length) {
    mismatches.push(
      `studentQueue.length expected ${appsPayload.studentQueue.length} but received ${nextPayload.studentQueue.length}`,
    );
  }

  compareQueue(nextPayload.studentQueue, appsPayload.studentQueue, mismatches);
  compareStudents(nextPayload.students, appsPayload.students, mismatches);

  return mismatches;
}

function compareQueue(nextQueue: StudentQueueRow[], appsQueue: StudentQueueRow[], mismatches: string[]) {
  const fields: QueueComparableField[] = [
    "studentKey",
    "worstStatus",
    "totalCurrentRemaining",
    "totalAdjustedRemaining",
    "nextSessionDate",
    "recommendedAction",
  ];
  const maxLength = Math.max(nextQueue.length, appsQueue.length);

  for (let index = 0; index < maxLength && mismatches.length < MAX_MISMATCHES; index += 1) {
    const nextRow = nextQueue[index];
    const appsRow = appsQueue[index];

    if (!nextRow || !appsRow) {
      mismatches.push(`queue index ${index} missing on ${nextRow ? "Apps Script" : "Next.js"} side`);
      continue;
    }

    fields.forEach((field) => {
      compareValue(`studentQueue[${index}].${field}`, nextRow[field], appsRow[field], mismatches);
    });
  }
}

function compareStudents(nextStudents: StudentRecord[], appsStudents: StudentRecord[], mismatches: string[]) {
  const nextMap = new Map(nextStudents.map((student) => [student.studentKey, student]));
  const appsMap = new Map(appsStudents.map((student) => [student.studentKey, student]));

  compareValue("students.length", nextStudents.length, appsStudents.length, mismatches);

  for (const [studentKey, nextStudent] of nextMap.entries()) {
    const appsStudent = appsMap.get(studentKey);
    if (!appsStudent) {
      mismatches.push(`students missing Apps Script record for ${studentKey}`);
      continue;
    }

    compareStudentPackages(studentKey, nextStudent.packages, appsStudent.packages, mismatches);
  }

  for (const studentKey of appsMap.keys()) {
    if (!nextMap.has(studentKey)) {
      mismatches.push(`students missing Next.js record for ${studentKey}`);
    }
  }
}

function compareStudentPackages(
  studentKey: string,
  nextPackages: PackageRecord[],
  appsPackages: PackageRecord[],
  mismatches: string[],
) {
  const fields: PackageComparableField[] = [
    "status",
    "currentRemaining",
    "adjustedRemaining",
    "pendingDeduction",
    "alertDate",
    "exhaustDate",
    "nextSessionDate",
  ];
  const nextMap = new Map(nextPackages.map((pkg) => [pkg.key, pkg]));
  const appsMap = new Map(appsPackages.map((pkg) => [pkg.key, pkg]));

  compareValue(`students[${studentKey}].packages.length`, nextPackages.length, appsPackages.length, mismatches);

  for (const [packageKey, nextPkg] of nextMap.entries()) {
    const appsPkg = appsMap.get(packageKey);
    if (!appsPkg) {
      mismatches.push(`students[${studentKey}] missing Apps Script package ${packageKey}`);
      continue;
    }

    fields.forEach((field) => {
      compareValue(`students[${studentKey}].packages[${packageKey}].${field}`, nextPkg[field], appsPkg[field], mismatches);
    });

    compareValue(
      `students[${studentKey}].packages[${packageKey}].upcomingSessions`,
      normalizeUpcomingSessions(nextPkg),
      normalizeUpcomingSessions(appsPkg),
      mismatches,
    );
  }

  for (const packageKey of appsMap.keys()) {
    if (!nextMap.has(packageKey)) {
      mismatches.push(`students[${studentKey}] missing Next.js package ${packageKey}`);
    }
  }
}

function normalizeUpcomingSessions(pkg: PackageRecord) {
  return (pkg.upcomingSessions || []).map((session) => ({
    date: session.date,
    durationMin: session.durationMin,
    deduct: session.deduct,
  }));
}

function compareValue(path: string, nextValue: unknown, appsValue: unknown, mismatches: string[]) {
  if (mismatches.length >= MAX_MISMATCHES) return;

  const nextSerialized = stableSerialize(nextValue);
  const appsSerialized = stableSerialize(appsValue);

  if (nextSerialized !== appsSerialized) {
    mismatches.push(`${path} expected ${appsSerialized} but received ${nextSerialized}`);
  }
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortObject((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }

  return value;
}

function isExecError(error: unknown): error is Error & { stdout?: string; stderr?: string } {
  return !!error && typeof error === "object" && "message" in error;
}

void main();
