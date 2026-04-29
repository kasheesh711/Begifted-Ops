#!/usr/bin/env tsx
// web/scripts/wisenet-probe-field-shape.ts
// Phase 1 Wisenet Discovery — capture one representative response per resource for the field map.
// Run: tsx web/scripts/wisenet-probe-field-shape.ts
// Consumes up to ~6 requests. All responses PII-scrubbed before write; IDs preserved for cross-joins.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// -----------------------------------------------------------------------------
// Inline helpers
// -----------------------------------------------------------------------------

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = headers instanceof Headers
    ? Array.from(headers.entries())
    : Object.entries(headers);
  for (const [k, v] of entries) {
    const lower = k.toLowerCase();
    if (
      lower === "authorization" || lower === "x-api-key" ||
      lower === "cookie" || lower === "set-cookie" ||
      lower === "x-user-id" || lower === "x-wisenet-session" || lower === "x-wise-session"
    ) {
      out[k] = "<REDACTED>";
    } else {
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}

type WisenetEnv = {
  baseUrl: string;
  apiKey: string;
  userId: string;
  centerId: string;
  namespace: string;
};

function redactEnvValues(input: string, env: WisenetEnv): string {
  let out = input;
  const pairs: Array<[string, string]> = [
    [env.apiKey, "{{WISENET_API_KEY}}"],
    [env.centerId, "{{WISENET_CENTER_ID}}"],
    [env.userId, "{{WISENET_USER_ID}}"],
    [env.namespace, "{{WISENET_NAMESPACE}}"],
  ];
  pairs.sort((a, b) => b[0].length - a[0].length);
  for (const [value, placeholder] of pairs) {
    if (value && value.length >= 6) {
      out = out.split(value).join(placeholder);
    }
  }
  return out;
}

/**
 * Value-based scrubber: if a string value ITSELF looks like an email or phone,
 * replace it regardless of key name. This catches fields like "displayIdentifier"
 * or "answer" (security-question answer) that Wisenet uses to echo PII unexpectedly.
 */
const EMAIL_VALUE_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE_VALUE_REGEX = /^\+?[0-9 ()-]{9,20}$/;

function scrubValueIfPiiShape(stringValue: string, indexPath: string[]): string {
  if (EMAIL_VALUE_REGEX.test(stringValue)) {
    return `student${indexPath.join("_") || "0"}@example.test`;
  }
  // Only scrub phone-like values if they contain at least 9 digits after stripping formatting
  const digits = stringValue.replace(/\D/g, "");
  if (digits.length >= 9 && digits.length <= 15 && PHONE_VALUE_REGEX.test(stringValue)) {
    return "0000000000";
  }
  return stringValue;
}

/**
 * Recursive PII scrubber — REPLACES names/emails/phones/DOBs/addresses with synthetic placeholders.
 * PRESERVES IDs (so cross-fixture joins work), status enums, non-DOB dates, numeric balances.
 * Also runs a value-based pass to catch email/phone values stored under unexpected keys.
 */
function redactStudentPII(value: unknown, indexPath: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((item, i) => redactStudentPII(item, [...indexPath, String(i)]));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (["firstname", "first_name", "givenname"].includes(lk)) {
        out[k] = `Student_FN_${indexPath.join("_") || "0"}`;
      } else if (["lastname", "last_name", "familyname", "surname"].includes(lk)) {
        out[k] = `Student_LN_${indexPath.join("_") || "0"}`;
      } else if (["fullname", "full_name", "studentname", "student_name", "name"].includes(lk)) {
        // "name" is ambiguous — we scrub it conservatively.
        out[k] = `Student_${indexPath.join("_") || "0"}`;
      } else if (["parentname", "parent_name", "guardianname"].includes(lk)) {
        out[k] = `Parent_${indexPath.join("_") || "0"}`;
      } else if (["email", "emailaddress", "parentemail", "contactemail"].includes(lk)) {
        out[k] = `student${indexPath.join("_") || "0"}@example.test`;
      } else if (["mobile", "phone", "phonenumber", "contactnumber"].includes(lk)) {
        out[k] = "0000000000";
      } else if (["dateofbirth", "dob", "birthdate"].includes(lk)) {
        out[k] = "2010-01-01";
      } else if (["address", "streetaddress", "homeaddress", "postaladdress"].includes(lk)) {
        out[k] = "Redacted";
      } else if (["suburb", "city", "state", "postcode", "zipcode", "country"].includes(lk)) {
        out[k] = "Redacted";
      } else if (["loginpin", "pin", "password", "token"].includes(lk)) {
        out[k] = "<REDACTED>";
      } else if (["profilepicture"].includes(lk)) {
        // URLs can embed identifiers
        out[k] = "";
      } else if (["displayidentifier", "identifier", "username", "login", "answer", "question", "securityanswer"].includes(lk)) {
        // These fields can echo the user's email or personal info as an "identifier".
        // Defensively scrub any string that has PII shape; preserve non-string values.
        if (typeof v === "string") {
          out[k] = scrubValueIfPiiShape(v, [...indexPath, k]);
          if (out[k] === v && v.length > 0) out[k] = `<REDACTED_${lk.toUpperCase()}>`;
        } else {
          out[k] = redactStudentPII(v, [...indexPath, k]);
        }
      } else if (typeof v === "string") {
        // Value-based PII sweep: catches emails/phones stored under unexpected keys.
        out[k] = scrubValueIfPiiShape(v, [...indexPath, k]);
      } else {
        out[k] = redactStudentPII(v, [...indexPath, k]);
      }
    }
    return out;
  }
  return value;
}

// -----------------------------------------------------------------------------
// Fixture dir
// -----------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const FIXTURE_DIR = resolve(REPO_ROOT, ".planning/research/fixtures/wisenet");
const ERRORS_DIR = resolve(FIXTURE_DIR, "_errors");

function writeFixture(filename: string, content: Record<string, unknown>, env: WisenetEnv) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const wrapped = {
    _note: "Auth headers redacted. Student PII synthetic-replaced per RESEARCH.md Pitfall 2. IDs preserved for cross-fixture joins.",
    _redaction: "names=synthetic, contact=synthetic, dates=dob-only, ids=preserved",
    ...content,
  };
  // Final scrubbing pass for any env values that leaked through individual field handling
  const scrubbed = JSON.parse(redactEnvValues(JSON.stringify(wrapped, null, 2), env));
  writeFileSync(resolve(FIXTURE_DIR, filename), JSON.stringify(scrubbed, null, 2), "utf8");
}

function writeErrorFixture(filename: string, content: Record<string, unknown>, env: WisenetEnv) {
  mkdirSync(ERRORS_DIR, { recursive: true });
  const scrubbed = JSON.parse(redactEnvValues(JSON.stringify(content, null, 2), env));
  writeFileSync(resolve(ERRORS_DIR, filename), JSON.stringify(scrubbed, null, 2), "utf8");
}

function buildAuthHeaders(authFingerprint: { confirmed_variant: number | null }, env: WisenetEnv): Record<string, string> {
  if (authFingerprint.confirmed_variant !== 1) {
    throw new Error(`Unsupported auth variant ${authFingerprint.confirmed_variant}`);
  }
  return {
    Authorization: `Basic ${Buffer.from(`${env.userId}:${env.apiKey}`).toString("base64")}`,
    "x-api-key": env.apiKey,
    "x-wise-namespace": env.namespace,
    "Content-Type": "application/json",
    "user-agent": "begifted-ops-phase1-probe/0.1",
  };
}

// -----------------------------------------------------------------------------
// Probe logic
// -----------------------------------------------------------------------------

type ProbeResult = {
  body: unknown;
  status: number;
  headers: Record<string, string>;
  bodyText: string;
};

async function probeResource(opts: {
  url: string;
  authHeaders: Record<string, string>;
  env: WisenetEnv;
}): Promise<ProbeResult> {
  const backoffMs = [1000, 2000, 4000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      const res = await fetch(opts.url, {
        method: "GET",
        headers: opts.authHeaders,
        signal: AbortSignal.timeout(15_000),
      });
      const bodyText = await res.text().catch(() => "");
      let body: unknown = null;
      try { body = JSON.parse(bodyText); } catch { body = null; }
      if (res.status >= 500 && res.status < 600 && attempt < backoffMs.length) {
        await new Promise((r) => setTimeout(r, backoffMs[attempt]));
        continue;
      }
      return { status: res.status, headers: redactHeaders(res.headers), body, bodyText };
    } catch (err) {
      lastError = err;
      if (attempt < backoffMs.length) {
        await new Promise((r) => setTimeout(r, backoffMs[attempt]));
        continue;
      }
    }
  }
  throw new Error(`probe request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/**
 * Look for a candidate field path in a body. Returns:
 *   { found: true, value_preview: "..." }   when the path resolves to a non-null value
 *   { found: false }                         otherwise
 * Used to populate `_field_paths_candidates` metadata.
 */
function checkFieldPath(body: unknown, pathSegments: string[]): { found: boolean; present_at?: string } {
  let cursor: unknown = body;
  const trail: string[] = [];
  for (const seg of pathSegments) {
    if (cursor === null || cursor === undefined) return { found: false };
    if (Array.isArray(cursor)) {
      if (cursor.length === 0) return { found: false };
      cursor = cursor[0]; // sample first element
      trail.push("[0]");
    }
    if (typeof cursor !== "object") return { found: false };
    const obj = cursor as Record<string, unknown>;
    if (!(seg in obj)) return { found: false };
    cursor = obj[seg];
    trail.push(seg);
  }
  if (cursor === null || cursor === undefined) return { found: false };
  return { found: true, present_at: trail.join(".") };
}

function buildFieldPathsAudit(body: unknown, expectedPaths: Array<{ label: string; path: string[] }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { label, path } of expectedPaths) {
    const r = checkFieldPath(body, path);
    out[label] = r.found ? `FOUND at ${r.present_at}` : "NOT FOUND";
  }
  return out;
}

// Extract a sample ID from a body using candidate paths
function extractId(body: unknown, candidatePaths: string[][]): string | null {
  for (const path of candidatePaths) {
    let cursor: unknown = body;
    for (const seg of path) {
      if (cursor === null || cursor === undefined) break;
      if (Array.isArray(cursor)) cursor = cursor[0];
      if (cursor && typeof cursor === "object") cursor = (cursor as Record<string, unknown>)[seg];
      else { cursor = null; break; }
    }
    if (typeof cursor === "string" && cursor.length > 0) return cursor;
  }
  return null;
}

async function main() {
  const env: WisenetEnv = {
    baseUrl: required("WISENET_BASE_URL"),
    apiKey: required("WISENET_API_KEY"),
    userId: required("WISENET_USER_ID"),
    centerId: required("WISENET_CENTER_ID"),
    namespace: required("WISENET_NAMESPACE"),
  };

  const authPath = resolve(FIXTURE_DIR, "_auth-fingerprint.json");
  const authFingerprint = JSON.parse(readFileSync(authPath, "utf8"));
  const authHeaders = buildAuthHeaders(authFingerprint, env);

  const probedAt = new Date().toISOString();
  const aestLocal = new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[field-shape-probe] starting at ${probedAt} (AEST ${aestLocal})`);

  // Budget check
  const budgetFile = resolve(FIXTURE_DIR, "_rate-limit-budget-used.json");
  let budgetUsed = 0;
  if (existsSync(budgetFile)) {
    try {
      const prev = JSON.parse(readFileSync(budgetFile, "utf8"));
      if (prev.date_aest === today && typeof prev.requests_used === "number") {
        budgetUsed = prev.requests_used;
        if (budgetUsed + 6 > 900) {
          console.error(`Field-shape probe would exceed budget (current: ${budgetUsed}, adding 6 = ${budgetUsed + 6} > 900). Abort.`);
          process.exitCode = 4;
          return;
        }
      }
    } catch { /* ignore unreadable budget file */ }
  }

  const full = (path: string) => new URL(path, env.baseUrl).toString();
  const resource_probes: Record<string, { status: number; url_pattern: string; field_paths?: Record<string, string> }> = {};
  let requestsMade = 0;

  async function delay() { await new Promise((r) => setTimeout(r, 500)); }

  // ---------- 1. students_list_page1.json ----------
  console.log("[field-shape] 1/6 students list (page 1, size=25)");
  const studentsListUrl = full(`/institutes/v3/${env.centerId}/students?page_number=1&page_size=25`);
  const studentsList = await probeResource({ url: studentsListUrl, authHeaders, env });
  requestsMade++;
  if (studentsList.status === 401 || studentsList.status === 403) {
    console.error(`Auth failure on students list: ${studentsList.status}`);
    writeErrorFixture(`field-shape-auth-fail-students-list-${Date.now()}.json`, { status: studentsList.status }, env);
    process.exitCode = 2;
    return;
  }

  const studentsListRedactedBody = redactStudentPII(studentsList.body);
  const studentsFieldPaths = buildFieldPathsAudit(studentsList.body, [
    { label: "Student Name → data.students[*].name", path: ["data", "students", "name"] },
    { label: "Student _id → data.students[*]._id", path: ["data", "students", "_id"] },
    { label: "Student uuid → data.students[*].uuid", path: ["data", "students", "uuid"] },
    { label: "Student email → data.students[*].email", path: ["data", "students", "email"] },
    { label: "Parents → data.students[*].parents", path: ["data", "students", "parents"] },
    { label: "Classrooms → data.students[*].classrooms", path: ["data", "students", "classrooms"] },
    { label: "Total count → data.count", path: ["data", "count"] },
    { label: "Credit balance (direct) → data.students[*].creditBalance", path: ["data", "students", "creditBalance"] },
    { label: "Credit balance (direct) → data.students[*].balance", path: ["data", "students", "balance"] },
    { label: "JoinedOn → data.students[*].joinedOn", path: ["data", "students", "joinedOn"] },
    { label: "Activated status → data.students[*].activated", path: ["data", "students", "activated"] },
    { label: "Tags → data.students[*].tags", path: ["data", "students", "tags"] },
  ]);
  writeFixture("students_list_page1.json", {
    probed_at: probedAt,
    probed_at_aest: aestLocal,
    endpoint: "GET /institutes/v3/{{WISENET_CENTER_ID}}/students?page_number=1&page_size=25",
    response_status: studentsList.status,
    response_headers: studentsList.headers,
    _field_paths_candidates: studentsFieldPaths,
    body: studentsListRedactedBody,
  }, env);
  resource_probes.students_list_page1 = { status: studentsList.status, url_pattern: "GET /institutes/v3/{{id}}/students", field_paths: studentsFieldPaths };

  // Extract sample IDs for downstream probes
  const sampleStudentId = extractId(studentsList.body, [["data", "students", "_id"]]);
  console.log(`  sample student _id: ${sampleStudentId ? "<extracted>" : "NONE"}`);

  await delay();

  // ---------- 2. student_detail_sample.json ----------
  console.log("[field-shape] 2/6 student detail");
  if (!sampleStudentId) {
    writeFixture("student_detail_sample.json", {
      _note: "SKIPPED — could not extract a sample student _id from students list response.",
      probed_at: probedAt,
      skipped: true,
    }, env);
  } else {
    const detailUrl = full(`/institutes/${env.centerId}/participants/${sampleStudentId}?showRegistrationData=true`);
    const detail = await probeResource({ url: detailUrl, authHeaders, env });
    requestsMade++;
    const redactedDetail = redactStudentPII(detail.body);
    const detailPaths = buildFieldPathsAudit(detail.body, [
      { label: "Name → data.name (or nested)", path: ["data", "name"] },
      { label: "Email → data.email", path: ["data", "email"] },
      { label: "Parents → data.parents", path: ["data", "parents"] },
      { label: "Parent name → data.parents[0].name", path: ["data", "parents", "name"] },
      { label: "Parent email → data.parents[0].email", path: ["data", "parents", "email"] },
      { label: "Phone → data.mobile or data.phone", path: ["data", "mobile"] },
      { label: "DOB → data.dateOfBirth", path: ["data", "dateOfBirth"] },
      { label: "Classrooms → data.classrooms", path: ["data", "classrooms"] },
      { label: "Enrolments → data.enrolments", path: ["data", "enrolments"] },
      { label: "Credit balance → data.creditBalance or data.balance", path: ["data", "creditBalance"] },
      { label: "Registration data → data.registrationData", path: ["data", "registrationData"] },
    ]);
    writeFixture("student_detail_sample.json", {
      probed_at: probedAt,
      probed_at_aest: aestLocal,
      endpoint: "GET /institutes/{{WISENET_CENTER_ID}}/participants/{{studentId}}?showRegistrationData=true",
      response_status: detail.status,
      response_headers: detail.headers,
      _field_paths_candidates: detailPaths,
      body: redactedDetail,
    }, env);
    resource_probes.student_detail_sample = { status: detail.status, url_pattern: "GET /institutes/{{id}}/participants/{{sid}}", field_paths: detailPaths };
    await delay();
  }

  // Extract class ID from student detail (if present in classrooms array)
  // Fall back to enumerating classes from student detail or students list
  let sampleClassId: string | null = null;
  if (sampleStudentId) {
    const detailFile = JSON.parse(readFileSync(resolve(FIXTURE_DIR, "student_detail_sample.json"), "utf8"));
    sampleClassId = extractId(detailFile.body, [["data", "classrooms", "_id"], ["data", "classrooms", "classId"], ["data", "classes", "_id"]]);
  }
  // If still null, list classes for the institute
  if (!sampleClassId) {
    console.log("  no classroom id in student detail — listing classes");
    const classesUrl = full(`/institutes/${env.centerId}/classes`);
    const classes = await probeResource({ url: classesUrl, authHeaders, env });
    requestsMade++;
    sampleClassId = extractId(classes.body, [["data", "classes", "_id"], ["data", "_id"]]);
    console.log(`  sample class _id: ${sampleClassId ? "<extracted>" : "NONE"}`);
  }

  await delay();

  // ---------- 3. enrolment_detail_sample.json ----------
  // Wisenet uses "class" as the enrolment concept (a class is a course a student is enrolled in)
  console.log("[field-shape] 3/6 enrolment detail (class)");
  if (!sampleClassId) {
    writeFixture("enrolment_detail_sample.json", {
      _note: "SKIPPED — could not extract a sample class/enrolment id.",
      probed_at: probedAt,
      skipped: true,
    }, env);
  } else {
    const enrolmentUrl = full(`/user/v2/classes/${sampleClassId}?full=true`);
    const enrolment = await probeResource({ url: enrolmentUrl, authHeaders, env });
    requestsMade++;
    const redactedEnrolment = redactStudentPII(enrolment.body);
    const enrolmentPaths = buildFieldPathsAudit(enrolment.body, [
      { label: "Class name → data.name or data.className", path: ["data", "name"] },
      { label: "Class subject → data.subject", path: ["data", "subject"] },
      { label: "Class status → data.status", path: ["data", "status"] },
      { label: "Student list → data.students", path: ["data", "students"] },
      { label: "Credit/session info → data.credits or data.sessionCredits", path: ["data", "credits"] },
      { label: "Start date → data.startDate", path: ["data", "startDate"] },
      { label: "End date → data.endDate", path: ["data", "endDate"] },
      { label: "Teacher → data.teacher", path: ["data", "teacher"] },
      { label: "Session duration → data.sessionDuration or data.duration", path: ["data", "sessionDuration"] },
      { label: "Package name → data.packageName", path: ["data", "packageName"] },
    ]);
    writeFixture("enrolment_detail_sample.json", {
      probed_at: probedAt,
      probed_at_aest: aestLocal,
      endpoint: "GET /user/v2/classes/{{classId}}?full=true",
      response_status: enrolment.status,
      response_headers: enrolment.headers,
      _field_paths_candidates: enrolmentPaths,
      body: redactedEnrolment,
    }, env);
    resource_probes.enrolment_detail_sample = { status: enrolment.status, url_pattern: "GET /user/v2/classes/{{cid}}", field_paths: enrolmentPaths };
    await delay();
  }

  // ---------- 4. past_sessions_sample.json ----------
  // Wisenet vocabulary: status must be PAST|FUTURE (uppercase), paginateBy must be DATE|COUNT,
  // AND when paginateBy=DATE both startDate and endDate are required (ISO date strings).
  // Empirical deviations discovered during Phase 1 probing.
  console.log("[field-shape] 4/6 past sessions (status=PAST, paginateBy=DATE, 30-day window)");
  const now = new Date();
  const pastStart = new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const pastEnd = now.toISOString().slice(0, 10);
  const pastSessionsUrl = full(`/institutes/${env.centerId}/sessions?page_number=1&page_size=25&status=PAST&paginateBy=DATE&startDate=${pastStart}&endDate=${pastEnd}`);
  const pastSessions = await probeResource({ url: pastSessionsUrl, authHeaders, env });
  requestsMade++;
  const redactedPastSessions = redactStudentPII(pastSessions.body);
  const pastSessionsPaths = buildFieldPathsAudit(pastSessions.body, [
    { label: "Sessions array → data.sessions", path: ["data", "sessions"] },
    { label: "Session _id → data.sessions[*]._id", path: ["data", "sessions", "_id"] },
    { label: "Final status → data.sessions[*].status or finalStatus", path: ["data", "sessions", "status"] },
    { label: "Teacher feedback → data.sessions[*].teacherFeedback or feedback", path: ["data", "sessions", "teacherFeedback"] },
    { label: "Credits consumed → data.sessions[*].creditsConsumed", path: ["data", "sessions", "creditsConsumed"] },
    { label: "Session duration → data.sessions[*].duration or sessionDuration", path: ["data", "sessions", "duration"] },
    { label: "Session date → data.sessions[*].date or sessionDate or startDate", path: ["data", "sessions", "startDate"] },
    { label: "Class id → data.sessions[*].classId", path: ["data", "sessions", "classId"] },
    { label: "Attendees → data.sessions[*].attendees", path: ["data", "sessions", "attendees"] },
  ]);
  writeFixture("past_sessions_sample.json", {
    probed_at: probedAt,
    probed_at_aest: aestLocal,
    endpoint: `GET /institutes/{{WISENET_CENTER_ID}}/sessions?status=PAST&paginateBy=DATE&startDate=${pastStart}&endDate=${pastEnd}&page_number=1&page_size=25`,
    response_status: pastSessions.status,
    response_headers: pastSessions.headers,
    _field_paths_candidates: pastSessionsPaths,
    body: redactedPastSessions,
  }, env);
  resource_probes.past_sessions_sample = { status: pastSessions.status, url_pattern: "GET /institutes/{{id}}/sessions?status=PAST&paginateBy=DATE&startDate&endDate", field_paths: pastSessionsPaths };
  await delay();

  // ---------- 5. upcoming_sessions_sample.json ----------
  console.log("[field-shape] 5/6 upcoming sessions (status=FUTURE, paginateBy=DATE, 30-day window)");
  const futureStart = now.toISOString().slice(0, 10);
  const futureEnd = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const upcomingSessionsUrl = full(`/institutes/${env.centerId}/sessions?page_number=1&page_size=25&status=FUTURE&paginateBy=DATE&startDate=${futureStart}&endDate=${futureEnd}`);
  const upcomingSessions = await probeResource({ url: upcomingSessionsUrl, authHeaders, env });
  requestsMade++;
  const redactedUpcomingSessions = redactStudentPII(upcomingSessions.body);
  const upcomingPaths = buildFieldPathsAudit(upcomingSessions.body, [
    { label: "Sessions array → data.sessions", path: ["data", "sessions"] },
    { label: "Scheduled date → data.sessions[*].startDate or scheduledDate", path: ["data", "sessions", "startDate"] },
    { label: "Session duration → data.sessions[*].duration", path: ["data", "sessions", "duration"] },
    { label: "Session status → data.sessions[*].status", path: ["data", "sessions", "status"] },
    { label: "Class id → data.sessions[*].classId", path: ["data", "sessions", "classId"] },
    { label: "Attendees → data.sessions[*].attendees", path: ["data", "sessions", "attendees"] },
    { label: "Teacher → data.sessions[*].teacher", path: ["data", "sessions", "teacher"] },
  ]);
  writeFixture("upcoming_sessions_sample.json", {
    probed_at: probedAt,
    probed_at_aest: aestLocal,
    endpoint: `GET /institutes/{{WISENET_CENTER_ID}}/sessions?status=FUTURE&paginateBy=DATE&startDate=${futureStart}&endDate=${futureEnd}&page_number=1&page_size=25`,
    response_status: upcomingSessions.status,
    response_headers: upcomingSessions.headers,
    _field_paths_candidates: upcomingPaths,
    body: redactedUpcomingSessions,
  }, env);
  resource_probes.upcoming_sessions_sample = { status: upcomingSessions.status, url_pattern: "GET /institutes/{{id}}/sessions?status=FUTURE&paginateBy=DATE&startDate&endDate", field_paths: upcomingPaths };
  await delay();

  // ---------- 6. credit_balance_sample.json ----------
  // The sessionCredits endpoint validates that the student is a member of the class.
  // Best source of a matched student+class pair is the past_sessions_sample response —
  // each session has .classId._id + .userId._id (the attending student, guaranteed enrolled).
  console.log("[field-shape] 6/6 credit balance (sessionCredits)");
  let balanceStudentId: string | null = sampleStudentId;
  let balanceClassId: string | null = sampleClassId;

  // Prefer a session-derived pair (100% enrolled)
  try {
    const pastSessionsFixture = JSON.parse(readFileSync(resolve(FIXTURE_DIR, "past_sessions_sample.json"), "utf8"));
    const pairedClass = extractId(pastSessionsFixture.body, [["data", "sessions", "classId", "_id"]]);
    const pairedStudent = extractId(pastSessionsFixture.body, [["data", "sessions", "userId", "_id"]]);
    if (pairedClass && pairedStudent) {
      balanceClassId = pairedClass;
      balanceStudentId = pairedStudent;
      console.log(`  using matched student+class pair from past_sessions`);
    }
  } catch {
    // fall through
  }

  if (!balanceStudentId || !balanceClassId) {
    writeFixture("credit_balance_sample.json", {
      _note: "SKIPPED — could not extract sample student+class ID pair required for sessionCredits endpoint.",
      probed_at: probedAt,
      skipped: true,
      endpoint: "GET /institutes/{{WISENET_CENTER_ID}}/classes/{{classId}}/students/{{studentId}}/sessionCredits",
    }, env);
  } else {
    const balanceUrl = full(`/institutes/${env.centerId}/classes/${balanceClassId}/students/${balanceStudentId}/sessionCredits?fetchHistory=true`);
    const balance = await probeResource({ url: balanceUrl, authHeaders, env });
    requestsMade++;
    const redactedBalance = redactStudentPII(balance.body);
    const balancePaths = buildFieldPathsAudit(balance.body, [
      { label: "Current balance → data.balance or data.remaining", path: ["data", "balance"] },
      { label: "Total credits → data.total or data.totalCredits", path: ["data", "total"] },
      { label: "Consumed → data.consumed or data.used", path: ["data", "consumed"] },
      { label: "History → data.history or data.transactions", path: ["data", "history"] },
      { label: "Remaining sessions → data.remainingSessions", path: ["data", "remainingSessions"] },
      { label: "Unit (hour/session) → data.unit or data.type", path: ["data", "unit"] },
    ]);
    if (balance.status === 404) {
      writeFixture("credit_balance_sample.json", {
        _note: "Endpoint returned 404 — native balance endpoint not available for this class/student pair. Per D-07, use derive-from-sessions fallback.",
        probed_at: probedAt,
        probed_at_aest: aestLocal,
        endpoint: "GET /institutes/{{WISENET_CENTER_ID}}/classes/{{classId}}/students/{{studentId}}/sessionCredits",
        response_status: 404,
        _field_paths_candidates: { "native balance": "NOT FOUND — 404" },
      }, env);
    } else if (balance.status === 400) {
      // "Student not found!" — student+class mismatch. Retry once with a second sample from enrolment.
      writeFixture("credit_balance_sample.json", {
        _note: "Endpoint returned 400 — student/class mismatch. The endpoint exists but strict validation rejects the probe's student+class pair. Phase 2 WCLI-04 must pair a student with a class they are actually enrolled in (derive from class roster).",
        probed_at: probedAt,
        probed_at_aest: aestLocal,
        endpoint: "GET /institutes/{{WISENET_CENTER_ID}}/classes/{{classId}}/students/{{studentId}}/sessionCredits",
        response_status: 400,
        response_body_snippet: typeof balance.bodyText === "string" ? balance.bodyText.slice(0, 300) : null,
        _field_paths_candidates: { "native balance": "UNTESTED — probe student/class pair rejected (400)" },
      }, env);
    } else {
      writeFixture("credit_balance_sample.json", {
        probed_at: probedAt,
        probed_at_aest: aestLocal,
        endpoint: "GET /institutes/{{WISENET_CENTER_ID}}/classes/{{classId}}/students/{{studentId}}/sessionCredits?fetchHistory=true",
        response_status: balance.status,
        response_headers: balance.headers,
        _field_paths_candidates: balancePaths,
        body: redactedBalance,
      }, env);
    }
    resource_probes.credit_balance_sample = { status: balance.status, url_pattern: "GET /institutes/{{id}}/classes/{{cid}}/students/{{sid}}/sessionCredits", field_paths: balancePaths };
  }

  // ---------- Update budget-used fixture ----------
  const budgetUpdate = {
    date_aest: today,
    endpoint: "students-list+students-detail+class-detail+sessions-past+sessions-upcoming+sessionCredits",
    requests_used: budgetUsed + requestsMade,
    remaining_at_start: budgetUsed === 0 ? "unknown (server does not expose rate-limit-remaining headers)" : budgetUsed,
    note: `Field-shape probe added ${requestsMade} requests. Total today: ${budgetUsed + requestsMade}.`,
  };
  writeFixture("_rate-limit-budget-used.json", budgetUpdate, env);

  // ---------- Post-write PII scan ----------
  console.log("[field-shape] post-write PII scan...");
  let piiLeak = false;
  const fixtureFiles = [
    "students_list_page1.json",
    "student_detail_sample.json",
    "enrolment_detail_sample.json",
    "past_sessions_sample.json",
    "upcoming_sessions_sample.json",
    "credit_balance_sample.json",
  ];
  for (const f of fixtureFiles) {
    const path = resolve(FIXTURE_DIR, f);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8");
    const emailMatches = content.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
    const nonSynth = emailMatches.filter((e) =>
      !e.includes("@example.test") &&
      !e.includes("@example.com") &&
      !e.includes("@begifted-ops-research.invalid")
    );
    if (nonSynth.length > 0) {
      console.error(`PII LEAK in ${f}: ${nonSynth.length} non-synthetic emails found`);
      piiLeak = true;
    }
    const phoneKeys = content.match(/"(mobile|phone|phoneNumber|contactNumber)"\s*:\s*"[0-9]{9,15}"/g) ?? [];
    const nonPlaceholderPhones = phoneKeys.filter((p) => !p.includes("\"0000000000\""));
    if (nonPlaceholderPhones.length > 0) {
      console.error(`PII LEAK in ${f}: non-placeholder phones found`);
      piiLeak = true;
    }
  }
  if (piiLeak) {
    process.exitCode = 5;
    return;
  }

  console.log(`[field-shape] done — ${requestsMade} requests. Exit 0.`);
  console.log(`  resource probes summary:`);
  for (const [name, r] of Object.entries(resource_probes)) {
    console.log(`    ${name}: ${r.status} (${r.url_pattern})`);
  }
  process.exitCode = 0;
}

void main().catch((err) => {
  console.error("[field-shape-probe] uncaught failure:", err);
  process.exitCode = 1;
});
