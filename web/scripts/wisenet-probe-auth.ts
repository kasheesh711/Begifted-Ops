#!/usr/bin/env tsx
// web/scripts/wisenet-probe-auth.ts
// Phase 1 Wisenet Discovery — verify live which auth header pattern returns 200.
// Run: tsx web/scripts/wisenet-probe-auth.ts
// Requires env vars: WISENET_BASE_URL, WISENET_API_KEY, WISENET_USER_ID, WISENET_CENTER_ID, WISENET_NAMESPACE
// Read-only GETs only per D-12. 401/403 per variant is expected (trying variants) — we halt only if ALL fail.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// -----------------------------------------------------------------------------
// Inline helpers (do NOT import from lib/runtime/env.ts — that's Phase 2 WCLI-07)
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
      lower === "authorization" ||
      lower === "x-api-key" ||
      lower === "cookie" ||
      lower === "set-cookie" ||
      lower === "x-user-id" ||
      lower === "x-wisenet-session" ||
      lower === "x-wise-session"
    ) {
      out[k] = "<REDACTED>";
    } else {
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}

// Minimal PII scrubber for the auth probe's body_snippet.
// The auth probe isn't a field-shape probe, but a 500-char body snippet of /students DOES contain PII.
// This function parses as JSON, recursively replaces any name/email/phone/DOB/address-like fields,
// and returns a JSON string. Falls back to marker string if body isn't JSON.
// (Plan Task 5 has a heavier redactStudentPII for the field-shape probe — this one is a minimal sibling.)
function redactJsonSnippetForAuthProbe(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "<non-json-body; length>" + raw.length + "; first-16-chars=" + raw.slice(0, 16).replace(/"/g, "'");
  }
  const redacted = scrub(parsed);
  return JSON.stringify(redacted).slice(0, 500);
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (["firstname", "first_name", "givenname", "lastname", "last_name", "familyname", "surname",
           "fullname", "full_name", "studentname", "student_name", "name",
           "parentname", "parent_name", "guardianname"].includes(lk)) {
        out[k] = "<REDACTED_NAME>";
      } else if (["email", "emailaddress", "parentemail", "contactemail"].includes(lk)) {
        out[k] = "redacted@example.test";
      } else if (["mobile", "phone", "phonenumber", "contactnumber"].includes(lk)) {
        out[k] = "0000000000";
      } else if (["dateofbirth", "dob", "birthdate"].includes(lk)) {
        out[k] = "2010-01-01";
      } else if (["address", "streetaddress", "homeaddress", "postaladdress",
                  "suburb", "city", "state", "postcode", "zipcode", "country"].includes(lk)) {
        out[k] = "Redacted";
      } else if (["loginpin", "pin", "password", "token"].includes(lk)) {
        out[k] = "<REDACTED>";
      } else if (["profilepicture"].includes(lk)) {
        // Profile picture URLs can embed user identifiers — drop to empty.
        out[k] = "";
      } else if (["_id", "id", "uuid", "userid", "studentid", "instituteid", "classid", "sessionid", "enrolmentid", "parentid"].includes(lk)) {
        // Auth probe doesn't need real IDs — preserve key shape by replacing with a typed placeholder.
        // (Field-shape probe KEEPS IDs for cross-fixture joins; that probe uses a different scrubber.)
        if (typeof v === "string") {
          out[k] = v.includes("-") ? "00000000-0000-0000-0000-000000000000" : "000000000000000000000000";
        } else {
          out[k] = v;
        }
      } else {
        out[k] = scrub(v);
      }
    }
    return out;
  }
  return value;
}

// Resolve fixture dir relative to the repo root (script is at web/scripts/, root is two levels up).
// Tolerates invocation from any cwd (e.g. `npx tsx` from web/ or repo root).
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const FIXTURE_DIR = resolve(REPO_ROOT, ".planning/research/fixtures/wisenet");
const ERRORS_DIR = resolve(FIXTURE_DIR, "_errors");

function writeFixture(filename: string, content: Record<string, unknown>) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const wrapped = {
    _note: "Auth headers redacted. No body content beyond 500-char snippet.",
    ...content,
  };
  writeFileSync(resolve(FIXTURE_DIR, filename), JSON.stringify(wrapped, null, 2), "utf8");
}

function writeErrorFixture(filename: string, content: Record<string, unknown>) {
  mkdirSync(ERRORS_DIR, { recursive: true });
  writeFileSync(resolve(ERRORS_DIR, filename), JSON.stringify(content, null, 2), "utf8");
}

// -----------------------------------------------------------------------------
// Auth variant catalogue
// -----------------------------------------------------------------------------

type AuthVariant = {
  variant_id: number;
  description: string;
  build: (env: WisenetEnv) => Record<string, string>;
  pathTemplate?: (env: WisenetEnv) => string;
};

type WisenetEnv = {
  baseUrl: string;
  apiKey: string;
  userId: string;
  centerId: string;
  namespace: string;
};

// Default probe path is the Students list endpoint from WISENET_ENDPOINTS.md:
// Postman catalogue shows: /institutes/v3/{{institute_id}}s/students
// Empirical probe confirmed the literal trailing "s" after {{institute_id}} is a Postman export typo
// (server returns 400 "instituteId must be 24 hexadecimal characters" when the s is included because
//  the route matches :instituteId greedily and the 25-char value fails validation).
// CORRECT path (verified 2026-04-21 with curl returning 200): /institutes/v3/<instituteId>/students
// This is Deviation Rule 1 (bug fix) — catalogue path typo discovered during probing.
function defaultStudentsPath(env: WisenetEnv): string {
  return `/institutes/v3/${env.centerId}/students?page_number=1&page_size=1`;
}

const AUTH_VARIANTS: AuthVariant[] = [
  {
    variant_id: 1,
    description: "HTTP Basic (userId:apiKey) + x-api-key + x-wise-namespace (Postman-confirmed per 01-02)",
    build: (env) => ({
      Authorization: `Basic ${Buffer.from(`${env.userId}:${env.apiKey}`).toString("base64")}`,
      "x-api-key": env.apiKey,
      "x-wise-namespace": env.namespace,
      "Content-Type": "application/json",
      "user-agent": "begifted-ops-phase1-probe/0.1",
    }),
  },
  {
    variant_id: 2,
    description: "HTTP Basic only (no x-api-key, no namespace)",
    build: (env) => ({
      Authorization: `Basic ${Buffer.from(`${env.userId}:${env.apiKey}`).toString("base64")}`,
      "Content-Type": "application/json",
      "user-agent": "begifted-ops-phase1-probe/0.1",
    }),
  },
  {
    variant_id: 3,
    description: "x-api-key + x-wise-namespace only (no Authorization)",
    build: (env) => ({
      "x-api-key": env.apiKey,
      "x-wise-namespace": env.namespace,
      "Content-Type": "application/json",
      "user-agent": "begifted-ops-phase1-probe/0.1",
    }),
  },
  {
    variant_id: 4,
    description: "Bearer apiKey + x-wise-namespace",
    build: (env) => ({
      Authorization: `Bearer ${env.apiKey}`,
      "x-wise-namespace": env.namespace,
      "Content-Type": "application/json",
      "user-agent": "begifted-ops-phase1-probe/0.1",
    }),
  },
  {
    variant_id: 5,
    description: "Variant 1 minus x-wise-namespace (is namespace required or inferred from Basic userId?)",
    build: (env) => ({
      Authorization: `Basic ${Buffer.from(`${env.userId}:${env.apiKey}`).toString("base64")}`,
      "x-api-key": env.apiKey,
      "Content-Type": "application/json",
      "user-agent": "begifted-ops-phase1-probe/0.1",
    }),
  },
  {
    variant_id: 6,
    description: "Variant 1 minus x-api-key (does Basic carry the secret alone?)",
    build: (env) => ({
      Authorization: `Basic ${Buffer.from(`${env.userId}:${env.apiKey}`).toString("base64")}`,
      "x-wise-namespace": env.namespace,
      "Content-Type": "application/json",
      "user-agent": "begifted-ops-phase1-probe/0.1",
    }),
  },
];

// -----------------------------------------------------------------------------
// Probe logic
// -----------------------------------------------------------------------------

type VariantResult = {
  variant_id: number;
  description: string;
  request_url: string;
  request_headers: Record<string, string>;
  response_status: number;
  response_headers: Record<string, string>;
  body_length: number;
  body_snippet: string;
  www_authenticate: string | null;
  elapsed_ms: number;
  success: boolean;
  error?: string;
};

/**
 * Replace raw env-var VALUES with symbolic placeholders in any captured string.
 * Ensures fixtures can be committed without leaking WISENET_CENTER_ID, WISENET_USER_ID,
 * or WISENET_API_KEY — even if those values appeared in URLs, body snippets, or response headers.
 * API keys are already scrubbed by redactHeaders at the header level; this is belt-and-braces
 * for anything that survived.
 */
function redactEnvValues(input: string, env: WisenetEnv): string {
  let out = input;
  // Order matters: redact longest values first so shorter substrings can't overlap.
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

async function attemptVariant(variant: AuthVariant, env: WisenetEnv): Promise<VariantResult> {
  const path = variant.pathTemplate ? variant.pathTemplate(env) : defaultStudentsPath(env);
  const url = new URL(path, env.baseUrl).toString();
  const headers = variant.build(env);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const bodyText = await res.text().catch(() => "<unreadable body>");
    const elapsed = Date.now() - started;
    // PII scrub on body snippet — /students responses contain real names/emails.
    // Error bodies (non-2xx) don't usually contain PII — still scrub defensively.
    const redactedSnippet = redactEnvValues(redactJsonSnippetForAuthProbe(bodyText), env);
    const redactedUrl = redactEnvValues(url, env);
    return {
      variant_id: variant.variant_id,
      description: variant.description,
      request_url: redactedUrl,
      request_headers: redactHeaders(headers),
      response_status: res.status,
      response_headers: redactHeaders(res.headers),
      body_length: bodyText.length,
      body_snippet: redactedSnippet,
      www_authenticate: res.headers.get("www-authenticate"),
      elapsed_ms: elapsed,
      success: res.status === 200,
    };
  } catch (err) {
    const elapsed = Date.now() - started;
    return {
      variant_id: variant.variant_id,
      description: variant.description,
      request_url: redactEnvValues(url, env),
      request_headers: redactHeaders(headers),
      response_status: -1,
      response_headers: {},
      body_length: 0,
      body_snippet: "",
      www_authenticate: null,
      elapsed_ms: elapsed,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const env: WisenetEnv = {
    baseUrl: required("WISENET_BASE_URL"),
    apiKey: required("WISENET_API_KEY"),
    userId: required("WISENET_USER_ID"),
    centerId: required("WISENET_CENTER_ID"),
    namespace: required("WISENET_NAMESPACE"),
  };

  const probedAt = new Date().toISOString();
  const aestLocal = new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
  console.log(`[auth-probe] starting at ${probedAt} (AEST ${aestLocal})`);
  console.log(`[auth-probe] base=${env.baseUrl}, namespace=${env.namespace}`);

  const variants: VariantResult[] = [];
  let confirmedVariantId: number | null = null;
  let rateLimitedBeforeSuccess = false;
  const rateLimitHintFromFirstCall: Record<string, string> = {};

  for (const variant of AUTH_VARIANTS) {
    console.log(`[auth-probe] variant ${variant.variant_id}: ${variant.description}`);
    const result = await attemptVariant(variant, env);
    console.log(`  status=${result.response_status} elapsed=${result.elapsed_ms}ms`);

    // Capture rate-limit hint from first response (any status) for fixture metadata
    if (variants.length === 0) {
      for (const k of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "ratelimit-limit", "ratelimit-remaining"]) {
        const v = result.response_headers[k];
        if (v) rateLimitHintFromFirstCall[k] = v;
      }
    }

    variants.push(result);

    if (result.response_status === 200) {
      confirmedVariantId = variant.variant_id;
      break;
    }

    if (result.response_status === 429) {
      console.error(`[auth-probe] 429 hit before success on variant ${variant.variant_id} — abort (exitCode=3)`);
      rateLimitedBeforeSuccess = true;
      break;
    }

    // 5xx: single retry with 1s backoff (one variant deserves one more try)
    if (result.response_status >= 500 && result.response_status < 600) {
      console.log(`[auth-probe] 5xx observed, backing off 1s and retrying variant ${variant.variant_id}`);
      await new Promise((r) => setTimeout(r, 1000));
      const retry = await attemptVariant(variant, env);
      variants.push({ ...retry, description: `${retry.description} (retry)` });
      if (retry.response_status === 200) {
        confirmedVariantId = variant.variant_id;
        break;
      }
    }

    // Pacing between distinct variant attempts
    await new Promise((r) => setTimeout(r, 500));
  }

  // Build fixture record
  const requiredHeadersTemplate = confirmedVariantId !== null
    ? buildTemplateHeaders(AUTH_VARIANTS.find((v) => v.variant_id === confirmedVariantId)!)
    : null;

  const fixture = {
    probed_at: probedAt,
    probed_at_aest: aestLocal,
    aest_timing_note: "Ran during AEST teaching hours (13:40ish AEST) — accepted vendor-visibility risk per D-09 / Task 1 'ready but teaching hours, proceed'",
    endpoint_tested: "GET /institutes/v3/{{WISENET_CENTER_ID}}/students?page_number=1&page_size=1",
    base_url: env.baseUrl,
    variants,
    confirmed_variant: confirmedVariantId,
    required_headers: requiredHeadersTemplate,
    notes: confirmedVariantId !== null
      ? `Variant ${confirmedVariantId} returned 200. Subsequent probes should use this header set.`
      : "No variant returned 200.",
    rate_limit_hint: rateLimitHintFromFirstCall,
  };

  // Final safety pass: scrub env values across the entire serialised fixture so anything
  // we forgot to filter in an individual field is caught here. Any WISENET_* value found
  // becomes a {{placeholder}} before write — belt-and-braces for the commit-safety invariant.
  const fixtureJson = JSON.stringify(fixture, null, 2);
  const scrubbedJson = redactEnvValues(fixtureJson, env);
  const finalFixture = JSON.parse(scrubbedJson);

  writeFixture("_auth-fingerprint.json", finalFixture);

  if (confirmedVariantId !== null) {
    console.log(`[auth-probe] SUCCESS — variant ${confirmedVariantId} returned 200`);
    process.exitCode = 0;
    return;
  }

  if (rateLimitedBeforeSuccess) {
    console.error("[auth-probe] ABORTED: 429 before any variant succeeded (exitCode=3)");
    writeErrorFixture(`auth-probe-rate-limited-${Date.now()}.json`, { variants, halted: "429-before-success" });
    process.exitCode = 3;
    return;
  }

  // All variants failed (401/403 or network errors)
  console.error(`[auth-probe] FAILED — all ${variants.length} variants non-200`);
  writeErrorFixture(`auth-probe-all-failed-${Date.now()}.json`, { variants, halted: "all-variants-failed" });
  process.exitCode = 2;
}

/**
 * Build a template record showing the shape of winning headers with secret values
 * replaced by placeholders — so the fixture can be committed safely while still
 * teaching Phase 2 which keys/shapes to put into the real request.
 */
function buildTemplateHeaders(variant: AuthVariant): Record<string, string> {
  const template: Record<string, string> = {};
  // Re-build using placeholder env values
  const placeholderEnv: WisenetEnv = {
    baseUrl: "{{WISENET_BASE_URL}}",
    apiKey: "{{WISENET_API_KEY}}",
    userId: "{{WISENET_USER_ID}}",
    centerId: "{{WISENET_CENTER_ID}}",
    namespace: "{{WISENET_NAMESPACE}}",
  };
  const built = variant.build(placeholderEnv);
  for (const [k, v] of Object.entries(built)) {
    template[k] = v;
  }
  // Always redact Authorization regardless of shape — Bearer or Basic, value is derived from secrets
  if (template.Authorization) {
    template.Authorization = variant.description.toLowerCase().includes("basic")
      ? "Basic base64({{WISENET_USER_ID}}:{{WISENET_API_KEY}})"
      : "Bearer {{WISENET_API_KEY}}";
  }
  return template;
}

void main().catch((err) => {
  console.error("[auth-probe] uncaught failure:", err);
  process.exitCode = 1;
});
