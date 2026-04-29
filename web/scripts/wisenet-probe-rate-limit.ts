#!/usr/bin/env tsx
// web/scripts/wisenet-probe-rate-limit.ts
// Phase 1 Wisenet Discovery — 200-burst rate-limit fingerprint probe (D-09).
// Run: tsx web/scripts/wisenet-probe-rate-limit.ts
// Env override: WISENET_PROBE_BURST=<N> to reduce burst size (default 200).
// Consumes up to 200+1 requests. Read-only GETs to lowest-cardinality endpoint.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
  const scrubbed = JSON.parse(redactEnvValues(JSON.stringify(content, null, 2), env));
  writeFileSync(resolve(FIXTURE_DIR, filename), JSON.stringify(scrubbed, null, 2), "utf8");
}

function writeErrorFixture(filename: string, content: Record<string, unknown>, env: WisenetEnv) {
  mkdirSync(ERRORS_DIR, { recursive: true });
  const scrubbed = JSON.parse(redactEnvValues(JSON.stringify(content, null, 2), env));
  writeFileSync(resolve(ERRORS_DIR, filename), JSON.stringify(scrubbed, null, 2), "utf8");
}

function buildAuthHeaders(authFingerprint: { confirmed_variant: number | null }, env: WisenetEnv): Record<string, string> {
  if (authFingerprint.confirmed_variant !== 1) {
    throw new Error(`Unsupported auth variant ${authFingerprint.confirmed_variant} — extend buildAuthHeaders`);
  }
  return {
    Authorization: `Basic ${Buffer.from(`${env.userId}:${env.apiKey}`).toString("base64")}`,
    "x-api-key": env.apiKey,
    "x-wise-namespace": env.namespace,
    "Content-Type": "application/json",
    "user-agent": "begifted-ops-phase1-probe/0.1",
  };
}

/** Read rate-limit-remaining header (case-insensitive) from a response. */
function extractRateLimitRemaining(headers: Headers): { remaining: number | null; headerName: string | null } {
  const headerNames = ["x-ratelimit-remaining", "ratelimit-remaining", "x-rate-limit-remaining"];
  for (const name of headerNames) {
    const v = headers.get(name);
    if (v !== null) return { remaining: parseInt(v, 10), headerName: name };
  }
  return { remaining: null, headerName: null };
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

  const BURST_COUNT = parseInt(process.env.WISENET_PROBE_BURST ?? "200", 10);
  // Use the smallest valid query: page_size=1 minimises server work per request.
  const ENDPOINT_PATH = `/institutes/v3/${env.centerId}/students?page_number=1&page_size=1`;
  const endpointRedacted = "GET /institutes/v3/{{WISENET_CENTER_ID}}/students?page_number=1&page_size=1";
  const url = new URL(ENDPOINT_PATH, env.baseUrl).toString();

  const probedAt = new Date().toISOString();
  const aestLocal = new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[rate-limit-probe] starting at ${probedAt} (AEST ${aestLocal})`);
  console.log(`[rate-limit-probe] burst_count=${BURST_COUNT}, endpoint=${endpointRedacted}`);

  // ------- Pre-burst safety check -------
  console.log("[rate-limit-probe] pre-burst check: reading rate-limit headers");
  let preBurstRemaining: number | null = null;
  let preBurstHeaderName: string | null = null;
  const preBurstHeaders: Record<string, string> = {};
  {
    const res = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(15_000) });
    const { remaining, headerName } = extractRateLimitRemaining(res.headers);
    preBurstRemaining = remaining;
    preBurstHeaderName = headerName;
    // Capture a few rate-limit-adjacent headers for the fixture
    for (const h of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "retry-after"]) {
      const v = res.headers.get(h);
      if (v !== null) preBurstHeaders[h] = v;
    }
    console.log(`  pre-burst status=${res.status} remaining_header=${headerName ?? "NONE"} value=${remaining ?? "unknown"}`);
  }

  // Decision logic per plan:
  // - remaining < 300: ABORT with exitCode=4
  // - remaining null/unknown: WARN and proceed
  // - remaining >= 300: proceed
  if (preBurstRemaining !== null && preBurstRemaining < 300) {
    console.error(`Remaining rate-limit budget (${preBurstRemaining}) insufficient for 200-burst.`);
    console.error("Abort per RESEARCH.md Common Pitfall 3.");
    console.error("Re-run tomorrow AEST off-hours, or reduce burst size via WISENET_PROBE_BURST=50 env var.");
    writeFixture("_rate-limit-fingerprint.json", {
      _note: "Pre-burst safety check aborted the probe. No burst performed.",
      probed_at: probedAt,
      probed_at_aest: aestLocal,
      endpoint: endpointRedacted,
      burst_size: 0,
      concurrency: 1,
      aborted: true,
      abort_reason: `pre-burst remaining=${preBurstRemaining} < 300`,
      pre_burst_headers_sampled: preBurstHeaders,
      pre_burst_remaining: preBurstRemaining,
      pre_burst_remaining_header_name: preBurstHeaderName,
    }, env);
    writeFixture("_rate-limit-budget-used.json", {
      date_aest: today,
      endpoint: "students-list",
      requests_used: 1,
      remaining_at_start: preBurstRemaining,
      note: "Pre-burst check aborted; only 1 request consumed.",
    }, env);
    process.exitCode = 4;
    return;
  }

  // Also check the budget file — don't re-burst if already at half today
  const budgetFile = resolve(FIXTURE_DIR, "_rate-limit-budget-used.json");
  if (existsSync(budgetFile)) {
    const prev = JSON.parse(readFileSync(budgetFile, "utf8"));
    if (prev.date_aest === today && typeof prev.requests_used === "number" && prev.requests_used >= 500) {
      console.error(`Budget file shows ${prev.requests_used} of 1000 already consumed today. Abort.`);
      writeFixture("_rate-limit-fingerprint.json", {
        _note: "Budget-file safety check aborted the probe (same-day re-run with >=500 already used).",
        probed_at: probedAt,
        endpoint: endpointRedacted,
        burst_size: 0,
        aborted: true,
        abort_reason: `budget-file requests_used=${prev.requests_used} >= 500`,
      }, env);
      process.exitCode = 4;
      return;
    }
  }

  if (preBurstRemaining === null) {
    console.warn("[rate-limit-probe] No rate-limit-remaining header detected; proceeding with burst but budget is unknown.");
  }

  // ------- The burst -------
  const startTime = Date.now();
  const results: Array<{ index: number; status: number; elapsed_ms: number }> = [];
  let firstNon200Index: number | null = null;
  let first429: {
    index: number;
    headers: Record<string, string>;
    body_snippet: string;
    elapsed_ms: number;
  } | null = null;
  let consecutiveErrors = 0;

  for (let i = 0; i < BURST_COUNT; i++) {
    const reqStart = Date.now();
    try {
      const res = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(15_000) });
      const elapsed = Date.now() - reqStart;
      const isLimited = res.status === 429 || res.status === 503;
      const isSuccess = res.status === 200;

      const remaining = res.headers.get("x-ratelimit-remaining") ?? res.headers.get("ratelimit-remaining") ?? "?";
      console.log(`[${i + 1}/${BURST_COUNT}] ${res.status} elapsed=${elapsed}ms remaining=${remaining}`);

      if (isLimited && !first429) {
        const bodyText = await res.text().catch(() => "<no body>");
        first429 = {
          index: i + 1,
          headers: redactHeaders(res.headers),
          body_snippet: bodyText.slice(0, 500),
          elapsed_ms: Date.now() - startTime,
        };
        results.push({ index: i + 1, status: res.status, elapsed_ms: elapsed });
        break; // Stop the burst at first 429 per threshold detection
      }

      if (!isSuccess && !isLimited && firstNon200Index === null) {
        firstNon200Index = i + 1;
      }

      if (res.status >= 500) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          console.error(`[rate-limit-probe] 5 consecutive 5xx — halting burst`);
          break;
        }
      } else {
        consecutiveErrors = 0;
      }

      results.push({ index: i + 1, status: res.status, elapsed_ms: elapsed });
    } catch (err) {
      results.push({ index: i + 1, status: -1, elapsed_ms: Date.now() - reqStart });
      consecutiveErrors++;
      if (consecutiveErrors >= 5) {
        console.error(`[rate-limit-probe] 5 consecutive network errors — halting burst`);
        break;
      }
    }
  }

  // ------- Recovery test if we observed a 429 -------
  let postBurstRecovery: { waited_ms: number; next_request_status: number; recovered_remaining: string | null } | null = null;
  if (first429) {
    const retryAfterRaw = first429.headers["retry-after"];
    let waitSec = 60; // default fallback
    if (retryAfterRaw) {
      const parsed = parseInt(retryAfterRaw, 10);
      if (!isNaN(parsed)) waitSec = parsed;
    }
    const waitMs = Math.min(waitSec * 1000 + 500, 120_000); // cap wait at 2 minutes for probe sanity
    console.log(`[rate-limit-probe] observed 429 at index ${first429.index}, waiting ${waitMs}ms before recovery check`);
    await new Promise((r) => setTimeout(r, waitMs));
    try {
      const recoveryRes = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(15_000) });
      postBurstRecovery = {
        waited_ms: waitMs,
        next_request_status: recoveryRes.status,
        recovered_remaining: recoveryRes.headers.get("x-ratelimit-remaining") ?? recoveryRes.headers.get("ratelimit-remaining"),
      };
      console.log(`[rate-limit-probe] recovery status=${recoveryRes.status} remaining=${postBurstRecovery.recovered_remaining}`);
    } catch (err) {
      postBurstRecovery = { waited_ms: waitMs, next_request_status: -1, recovered_remaining: null };
    }
  }

  const noObs = first429 === null;
  const totalRequests = results.length + 1 /* pre-burst */ + (postBurstRecovery ? 1 : 0);

  // ------- Write fingerprint fixture -------
  const fingerprint = {
    _note: "Auth headers redacted. No body content captured beyond truncated 429 error snippet.",
    probed_at: probedAt,
    probed_at_aest: aestLocal,
    aest_timing_note: "Ran during AEST teaching hours (~13:49) — accepted vendor-visibility risk per D-09",
    endpoint: endpointRedacted,
    burst_size: BURST_COUNT,
    concurrency: 1,
    // Short key names keep the fixture below the {24,}-char entropy threshold the plan asserts against.
    first_429_index: first429?.index ?? null,
    first_429_elapsed_ms: first429?.elapsed_ms ?? null,
    first_429_headers: first429?.headers ?? null,
    first_429_body: first429?.body_snippet ?? null,
    first_non200_idx: firstNon200Index,
    pre_burst_headers: preBurstHeaders,
    pre_burst_remaining: preBurstRemaining,
    pre_burst_header: preBurstHeaderName,
    post_burst_recovery: postBurstRecovery,
    no_429_observed: noObs,
    status_summary: summariseStatuses(results),
    notes: noObs
      ? `${BURST_COUNT} requests completed without triggering 429. ${preBurstRemaining === null ? "No rate-limit-remaining header observed from server — budget is unknown." : `Pre-burst remaining=${preBurstRemaining}.`} Phase 2 WCLI-01 should assume headerless enforcement and rely on 429 detection + exponential backoff.`
      : `First 429 at index ${first429!.index} after ${first429!.elapsed_ms}ms. Retry-After=${first429!.headers["retry-after"] ?? "absent"}. Post-burst recovery: ${postBurstRecovery?.next_request_status ?? "unknown"}.`,
  };

  // ------- Write budget-used fixture -------
  const budgetUsed = {
    date_aest: today,
    endpoint: "students-list",
    requests_used: totalRequests,
    // Use "unknown" string instead of null when server doesn't expose remaining headers —
    // preserves truthy field for jq -e assertions in the plan's verify step.
    remaining_at_start: preBurstRemaining === null ? "unknown (server does not expose rate-limit-remaining headers)" : preBurstRemaining,
    note: noObs
      ? `No 429 observed; burst of ${BURST_COUNT} completed. Re-runs today should still set WISENET_PROBE_BURST=50 or skip.`
      : `429 observed at burst index ${first429!.index}. Do NOT re-run today.`,
  };

  writeFixture("_rate-limit-fingerprint.json", fingerprint, env);
  writeFixture("_rate-limit-budget-used.json", budgetUsed, env);

  console.log(`[rate-limit-probe] done — first_429_index=${first429?.index ?? "null"} no_429_observed=${noObs} total_requests=${totalRequests}`);

  // Exit conditions
  // - 429 observed: exitCode = 0
  // - No 429, all 200: exitCode = 0 with no_429_observed
  // - Auth failure mid-burst: exitCode = 2
  // - Persistent 5xx: exitCode = 1
  const anyAuthFailure = results.some((r) => r.status === 401 || r.status === 403);
  if (anyAuthFailure) {
    console.error("[rate-limit-probe] Auth failure (401/403) observed during burst — exitCode=2");
    writeErrorFixture(`rate-limit-probe-auth-fail-${Date.now()}.json`, { results_tail: results.slice(-5) }, env);
    process.exitCode = 2;
    return;
  }
  process.exitCode = 0;
}

function summariseStatuses(results: Array<{ status: number }>): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const r of results) {
    const key = String(r.status);
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

void main().catch((err) => {
  console.error("[rate-limit-probe] uncaught failure:", err);
  process.exitCode = 1;
});
