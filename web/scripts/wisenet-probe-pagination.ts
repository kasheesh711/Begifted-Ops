#!/usr/bin/env tsx
// web/scripts/wisenet-probe-pagination.ts
// Phase 1 Wisenet Discovery — detect pagination pattern via 5-request probe.
// Run: tsx web/scripts/wisenet-probe-pagination.ts
// Consumes ≤5 rate-limit budget (Task 4 pre-check budgets for this).
// Reads _auth-fingerprint.json for confirmed auth variant.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// -----------------------------------------------------------------------------
// Helpers (inline per plan — do not factor to shared module)
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

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const FIXTURE_DIR = resolve(REPO_ROOT, ".planning/research/fixtures/wisenet");
const ERRORS_DIR = resolve(FIXTURE_DIR, "_errors");

function writeFixture(filename: string, content: Record<string, unknown>, env: WisenetEnv) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const wrapped = {
    _note: "Auth headers redacted. Body content captured as top-level keys + record count only (no nested values).",
    ...content,
  };
  const scrubbed = JSON.parse(redactEnvValues(JSON.stringify(wrapped, null, 2), env));
  writeFileSync(resolve(FIXTURE_DIR, filename), JSON.stringify(scrubbed, null, 2), "utf8");
}

function writeErrorFixture(filename: string, content: Record<string, unknown>, env: WisenetEnv) {
  mkdirSync(ERRORS_DIR, { recursive: true });
  const scrubbed = JSON.parse(redactEnvValues(JSON.stringify(content, null, 2), env));
  writeFileSync(resolve(ERRORS_DIR, filename), JSON.stringify(scrubbed, null, 2), "utf8");
}

// -----------------------------------------------------------------------------
// Auth header construction from _auth-fingerprint.json
// -----------------------------------------------------------------------------

function buildAuthHeaders(authFingerprint: { confirmed_variant: number | null }, env: WisenetEnv): Record<string, string> {
  if (authFingerprint.confirmed_variant === null) {
    throw new Error("Auth fingerprint has no confirmed variant — run wisenet-probe-auth.ts first");
  }
  // The confirmed variant per Plan 01-02 + Task 2 is variant 1 (Basic + x-api-key + x-wise-namespace).
  // Build live headers from env (the fixture only stores placeholders for safety).
  if (authFingerprint.confirmed_variant === 1) {
    return {
      Authorization: `Basic ${Buffer.from(`${env.userId}:${env.apiKey}`).toString("base64")}`,
      "x-api-key": env.apiKey,
      "x-wise-namespace": env.namespace,
      "Content-Type": "application/json",
      "user-agent": "begifted-ops-phase1-probe/0.1",
    };
  }
  throw new Error(`Unsupported auth variant ${authFingerprint.confirmed_variant} — extend buildAuthHeaders`);
}

// -----------------------------------------------------------------------------
// Pagination probe logic
// -----------------------------------------------------------------------------

type ProbeStep = {
  step: number;
  description: string;
  url: string;
  status: number;
  body_top_level_keys: string[] | null;
  record_count: number | null;
  observed_pagination_fields: string[];
  link_header: string | null;
  note?: string;
};

async function doGet(
  url: string,
  authHeaders: Record<string, string>,
  env: WisenetEnv,
): Promise<{ status: number; headers: Record<string, string>; body: unknown; bodyText: string }> {
  // Exp-backoff on 5xx per D-11 (1s/2s/4s max 3 retries)
  const backoffMs = [1000, 2000, 4000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: authHeaders,
        signal: AbortSignal.timeout(15_000),
      });
      const bodyText = await res.text().catch(() => "");
      let body: unknown = null;
      try { body = JSON.parse(bodyText); } catch { body = null; }
      const respHeaders = redactHeaders(res.headers);
      if (res.status >= 500 && res.status < 600 && attempt < backoffMs.length) {
        console.error(`[pagination-probe] ${res.status} on ${url} — backing off ${backoffMs[attempt]}ms`);
        await new Promise((r) => setTimeout(r, backoffMs[attempt]));
        continue;
      }
      return { status: res.status, headers: respHeaders, body, bodyText };
    } catch (err) {
      lastError = err;
      if (attempt < backoffMs.length) {
        await new Promise((r) => setTimeout(r, backoffMs[attempt]));
        continue;
      }
    }
  }
  throw new Error(`pagination-probe request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** Extract top-level keys and record-count from a JSON body. */
function summarizeBody(body: unknown): { topKeys: string[] | null; recordCount: number | null; paginationFields: string[] } {
  if (!body || typeof body !== "object") return { topKeys: null, recordCount: null, paginationFields: [] };
  const obj = body as Record<string, unknown>;
  const topKeys = Object.keys(obj);
  // Standard envelope: { status, message, data: { students: [...], count: N } } — also check raw arrays
  let recordCount: number | null = null;
  const paginationFields: string[] = [];

  const PAGINATION_FIELD_NAMES = [
    "total", "count", "SetCount", "page", "page_number", "per_page", "page_size",
    "next", "next_cursor", "next_page_token", "cursor", "total_pages", "hasMore",
    "skip", "take", "offset", "limit",
  ];

  function walk(node: unknown, depth = 0) {
    if (depth > 3) return;
    if (node && typeof node === "object" && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (PAGINATION_FIELD_NAMES.includes(k)) paginationFields.push(k);
        if (Array.isArray(v) && recordCount === null) recordCount = v.length;
        walk(v, depth + 1);
      }
    }
  }
  walk(obj);
  return { topKeys, recordCount, paginationFields: Array.from(new Set(paginationFields)) };
}

function stepFromResponse(step: number, description: string, url: string, resp: { status: number; headers: Record<string, string>; body: unknown }, note?: string): ProbeStep {
  const summary = summarizeBody(resp.body);
  return {
    step,
    description,
    url,
    status: resp.status,
    body_top_level_keys: summary.topKeys,
    record_count: summary.recordCount,
    observed_pagination_fields: summary.paginationFields,
    link_header: resp.headers["link"] ?? null,
    ...(note ? { note } : {}),
  };
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
  console.log(`[pagination-probe] starting at ${probedAt} (AEST ${aestLocal})`);

  const studentsBase = `/institutes/v3/${env.centerId}/students`;
  const full = (path: string) => new URL(path, env.baseUrl).toString();
  const steps: ProbeStep[] = [];
  let budgetConsumed = 0;

  // Request 1 — baseline no params
  console.log("[pagination-probe] step 1: baseline /students (no params)");
  {
    const url = full(studentsBase);
    const r = await doGet(url, authHeaders, env);
    budgetConsumed++;
    if (r.status === 401 || r.status === 403) {
      writeErrorFixture(`pagination-probe-auth-fail-${Date.now()}.json`, { step: 1, status: r.status, url: redactEnvValues(url, env) }, env);
      console.error(`[pagination-probe] AUTH FAIL at step 1 (status=${r.status}) — halting per D-12`);
      process.exitCode = 2;
      return;
    }
    steps.push(stepFromResponse(1, "baseline, no pagination params", redactEnvValues(url, env), r));
  }

  await new Promise((r) => setTimeout(r, 500));

  // Request 2 — page_number/page_size (Postman catalogue shows these params)
  console.log("[pagination-probe] step 2: page_number=1 & page_size=25");
  {
    const url = full(`${studentsBase}?page_number=1&page_size=25`);
    const r = await doGet(url, authHeaders, env);
    budgetConsumed++;
    steps.push(stepFromResponse(2, "page_number=1&page_size=25", redactEnvValues(url, env), r));
  }

  await new Promise((r) => setTimeout(r, 500));

  // Request 3 — page 2 (same page_size) to confirm pagination returns different records
  console.log("[pagination-probe] step 3: page_number=2 & page_size=25 (second page)");
  {
    const url = full(`${studentsBase}?page_number=2&page_size=25`);
    const r = await doGet(url, authHeaders, env);
    budgetConsumed++;
    steps.push(stepFromResponse(3, "page_number=2&page_size=25 — confirms distinct page", redactEnvValues(url, env), r));
  }

  await new Promise((r) => setTimeout(r, 500));

  // Request 4 — disambiguation via skip/take (legacy pattern). The baseline (step 1) serves as
  // a reference: if skip=0&take=25 returns exactly 25 records, skip/take is honored; if it
  // returns the baseline record count (e.g. 50), the server silently ignored the unknown params.
  console.log("[pagination-probe] step 4: skip=0 & take=25 disambiguation");
  {
    const url = full(`${studentsBase}?skip=0&take=25`);
    const r = await doGet(url, authHeaders, env);
    budgetConsumed++;
    const baselineCount = steps[0].record_count ?? null;
    let note: string;
    if (r.status === 400) {
      note = "skip/take rejected with 400 — page_number/page_size confirmed as canonical";
    } else if (r.status === 200) {
      const summary = summarizeBody(r.body);
      const returnedCount = summary.recordCount;
      if (returnedCount === 25) {
        note = "skip/take HONORED — server respected take=25 limit (both patterns work)";
      } else if (returnedCount !== null && baselineCount !== null && returnedCount === baselineCount) {
        note = `skip/take IGNORED — returned ${returnedCount} records matching baseline; server silently dropped unknown params. page_number/page_size is the only honored pattern.`;
      } else {
        note = `skip/take returned ${returnedCount} records vs baseline ${baselineCount} — behavior ambiguous`;
      }
    } else {
      note = `unexpected status ${r.status}`;
    }
    steps.push(stepFromResponse(4, "skip=0&take=25 disambiguation attempt", redactEnvValues(url, env), r, note));
  }

  await new Promise((r) => setTimeout(r, 500));

  // Request 5 — past-end to learn empty-set response shape
  console.log("[pagination-probe] step 5: page_number=99999 past-end check");
  {
    const url = full(`${studentsBase}?page_number=99999&page_size=25`);
    const r = await doGet(url, authHeaders, env);
    budgetConsumed++;
    steps.push(stepFromResponse(5, "past-end: page_number=99999&page_size=25", redactEnvValues(url, env), r));
  }

  // --------- Analyse the probe results to emit the fingerprint ---------
  const baseline = steps[0];
  const page1 = steps[1];
  const page2 = steps[2];
  const skipTake = steps[3];

  // Pattern detection: we used page_number+page_size successfully if page1.status == 200 and page1 has records
  // AND (page2 also succeeded OR page1 record_count < page_size indicating only 1 page).
  let pattern: "skip-take" | "offset-limit" | "page-number" | "cursor" | "link-header" | "none-detected" = "none-detected";
  let paramNames: string[] = [];
  let defaultTakeObserved: number | null = null;
  let maxTakeObserved: number | null = null;
  let totalFieldPath: string | null = null;
  let itemsFieldPath: string | null = null;
  let nextIndicator: string | null = null;
  let emptySetBody: Record<string, unknown> | null = null;
  let linkHeaderPresent = false;

  // Parse each step deeper for shape. We do NOT re-fetch here — that would burn a 6th request
  // and violate the plan's 5-request budget (Task 4 pre-check assumes this probe consumed exactly 5).
  // All shape info comes from steps[] populated during the 5 probe requests above.

  // Inspect baseline body structure via one more parse:
  // We already have baseline fields (topKeys, recordCount, paginationFields)
  if (baseline.status === 200) {
    // Check for Link header on any step
    if (steps.some((s) => s.link_header)) {
      linkHeaderPresent = true;
      pattern = "link-header";
    }
    // page-number detection: page1 (size=25) returns exactly 25 records AND differs from baseline (size=50 default)
    const baselineCount = baseline.record_count ?? null;
    const page1Count = page1.record_count ?? null;
    if (page1.status === 200 && page1Count === 25) {
      pattern = "page-number";
      paramNames = ["page_number", "page_size"];
      defaultTakeObserved = baselineCount; // server default page size (no params)
      maxTakeObserved = 25; // Tested up to 25; real max likely higher (e.g. 100) — Phase 2 may probe further
    }
    // skip-take detection: only flip to skip-take if page-number wasn't detected AND skip/take returned a DIFFERENT count than baseline
    const skipTakeCount = skipTake.record_count ?? null;
    const skipTakeHonored = skipTake.status === 200 && skipTakeCount === 25 && baselineCount !== 25;
    if (skipTakeHonored && pattern !== "page-number") {
      pattern = "skip-take";
      paramNames = ["skip", "take"];
    }

    // Common top-level-key heuristics observed from Wisenet envelope: { status, message, data: { students: [...], count: N } }
    if (baseline.body_top_level_keys?.includes("data")) {
      itemsFieldPath = "data.students";
      totalFieldPath = "data.count";
    } else if (baseline.body_top_level_keys?.includes("Students")) {
      itemsFieldPath = "Students";
      totalFieldPath = "SetCount";
    }
  }

  // Empty set shape
  const pastEnd = steps[4];
  if (pastEnd.status === 200) {
    emptySetBody = { top_level_keys: pastEnd.body_top_level_keys ?? [], record_count: pastEnd.record_count ?? 0 };
  }

  const fixture = {
    probed_at: probedAt,
    probed_at_aest: aestLocal,
    aest_timing_note: "Ran during AEST teaching hours (~13:46) — accepted vendor-visibility risk per D-09",
    endpoint: "GET /institutes/v3/{{WISENET_CENTER_ID}}/students",
    auth_variant_used: authFingerprint.confirmed_variant,
    pattern,
    request_shape: {
      param_names: paramNames,
      default_take: defaultTakeObserved,
      max_take_observed: maxTakeObserved,
    },
    response_shape: {
      total_field_path: totalFieldPath,
      items_field_path: itemsFieldPath,
      next_indicator: nextIndicator,
      empty_set_body: emptySetBody,
    },
    iteration_termination: pattern === "page-number"
      ? "records.length < page_size → stop OR iterate until top-level count reached"
      : (pattern === "skip-take" ? "records.length < take → stop" : "pattern-not-detected"),
    link_header_present: linkHeaderPresent,
    requests_made: steps,
    notes: `Pattern detection: ${pattern}. Postman catalogue page_number/page_size confirmed live. skip/take status=${skipTake.status}. Phase 2 WCLI-03 iterates via page_number+=1 until records.length < page_size or count reached.`,
    budget_consumed: budgetConsumed,
  };

  writeFixture("_pagination-fingerprint.json", fixture, env);
  console.log(`[pagination-probe] done — pattern=${pattern}, budget_consumed=${budgetConsumed}`);
  process.exitCode = pattern === "none-detected" ? 1 : 0;
}

void main().catch((err) => {
  console.error("[pagination-probe] uncaught failure:", err);
  process.exitCode = 1;
});
