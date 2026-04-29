# Phase 1: Wisenet Discovery - Research

**Researched:** 2026-04-21
**Domain:** Wisenet API discovery + empirical fingerprinting (docs-only phase; zero production code)
**Confidence:** HIGH on repo-internal facts and Postman v2.1 schema; MEDIUM on generic rate-limit / pagination patterns; **LOW on Wisenet-specific behavior until the Postman collection is parsed and probes run** — the entire phase exists to replace that LOW with HIGH.

## Summary

Phase 1 converts the current Google Sheets field inventory (HIGH confidence) and the Wisenet hypothesis rows (LOW confidence from FEATURES.md) into a verified field-map matrix backed by evidence — either a Postman endpoint citation or a recorded fixture response. Every existing `REQUIRED_COLUMNS` field must be classified GREEN / YELLOW / RED with a Wisenet endpoint + field reference, and every RED row needs one of four structured decisions. In parallel, empirical probe scripts fingerprint Wisenet's auth scheme, pagination semantics, and rate-limit shape so Phase 2's `lib/wisenet/client.ts` can be built against measured facts rather than guesses.

Two external-source findings from today's live research re-frame the probe design:
1. **Wisenet runs two parallel API surfaces.** The legacy API at `https://{orgcode}-api.wisenet.co/` uses HTTP Basic auth, `skip`/`take` pagination, and a documented **1,000-call-per-24-hour hard ceiling per organisation** [CITED: learn.wisenet.co/old-api-developer-resources/]. The newer IAE (Integrated App Platform) API at `https://api.wisenet.co/v1/` uses OAuth 2.1 Bearer tokens plus a required `x-api-key` header [CITED: api-docs.wisenet.co/iae/oauth/index.html]. Kevin's credential set (`WISENET_API_KEY`, `WISENET_USER_ID`, `WISENET_CENTER_ID`, `WISENET_NAMESPACE=begifted-education`, `WISENET_BASE_URL`) does not cleanly match either documented pattern — `USER_ID` and `CENTER_ID` are not in the published IAE OAuth flow, which means either (a) this is a vendor-specific variant scheme, or (b) these fields are carried in the URL path / query string rather than as headers. **The Postman collection is the only authoritative source for which variant Kevin has access to.** No probe can proceed without parsing it first.
2. **The 1,000-call/24h ceiling (if it applies) changes the probe design.** A naïve 200-request burst against the low-cardinality students-list endpoint is 20% of a full-day budget. The probe must keep a running count, stop if it crosses 80% of the remaining daily budget, and be run once in the AEST off-hours window (D-10) with a documented "already consumed N of today's budget before re-running" note. If Kevin's API is on the IAE variant the ceiling may be different or absent — the Postman collection should disclose it; if not, the probe itself must discover it.

**Primary recommendation:** Parse the Postman v2.1 collection JSON with a read-only tsx script (`wisenet-postman-parse.ts`) that emits `WISENET_ENDPOINTS.md` as a deterministic table, THEN write a second tsx script per probe concern (`wisenet-probe-auth.ts`, `wisenet-probe-pagination.ts`, `wisenet-probe-rate-limit.ts`) that reads env vars, hits targeted endpoints, captures request+response headers to fixtures, and fails loudly on 401/403 or persistent error. Build the field map incrementally against the parsed catalogue + recorded fixtures — every row cites at least one Postman path and ideally one fixture file.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Wisenet access method:**
- **D-01:** Kevin exports the Wisenet Postman collection as JSON to `.planning/research/wisenet-postman.json`; the live Wisenet API key lives in `web/.env` as `WISENET_API_KEY` (plus `WISENET_USER_ID`, `WISENET_CENTER_ID`, `WISENET_NAMESPACE=begifted-education`, `WISENET_BASE_URL`).
- **D-02:** Claude parses the Postman JSON and runs targeted tsx probes from `web/scripts/wisenet-probe-*.ts` — Kevin invokes them locally with env vars set. No Wisenet creds ever written to tracked files.
- **D-03:** Parsed endpoint catalogue lives at `.planning/research/WISENET_ENDPOINTS.md` (separate from the field map) — method, path, headers, query params, body schema, auth per endpoint. Becomes the reference Phase 2's `lib/wisenet/endpoints.ts` is written against.
- **D-04:** Recorded real responses land in `.planning/research/fixtures/wisenet/*.json` (e.g. `students_list_page1.json`, `enrolment_detail_<id>.json`). Phase 2 copies relevant ones into `web/src/test/fixtures/wisenet/` for Vitest — keeps research evidence separate from test inputs.

**Gap-question pre-answers (WISE-06):**
- **D-05: Should_Credit manual override — DROP entirely.** Accept the small loss of the per-session override column. Pending-deduction math uses `session_duration` fallback only. No Postgres overrides table, no Wisenet custom-field request, no migration of historical override values.
  - **Ripple:** Phase 2 TEST-01 must drop or adapt any `Validation.gs` assertions that exercise `Should_Credit` priority over `session_duration`. Fixture inputs in dashboard-logic tests that use `Should_Credit` need review.
- **D-06: Admin ownership — Postgres sidecar as BeGifted metadata.** Store admin ownership in a Postgres table keyed by `student_key` with `admin_key` column. Phase 2 seeds it from the current `RemainingCredits` majority-vote rollup at cutover time. Future feature: operators edit ownership via dashboard (v2). Wisenet's trainer/coordinator field is not used even if available.
- **D-07: Credit-balance model — Direct-first, derived fallback, decided per-field.** If Wisenet exposes a native balance matching our semantics (number of sessions/hours), use it. If missing or semantically wrong, derive from session history (`total − consumed`). Phase 1 must document the per-field decision for `Current Remaining Credits` and `Current Total Credits` in `WISENET_FIELD_MAP.md` based on the actual Wisenet probe.
- **D-08: Pending-deduction rule — Replicate 1:1, document RED if fields missing.** Keep the existing rule `final_status = "ENDED" AND teacher_feedback empty AND credits_consumed = 0 → count as pending`. Each of the three field ingredients gets its own row in `WISENET_FIELD_MAP.md`; any missing one is RED with a block-cutover or derivation plan. Preserves `Validation.gs` parity (minus the Should_Credit-related assertions from D-05).

**Empirical probe strategy:**
- **D-09:** Aggressive rate-limit fingerprint — deliberate burst of ~200 read-only GETs against a low-cardinality endpoint (e.g. students list page 1 repeatedly) to observe rate-limit threshold and response headers (`Retry-After`, `X-RateLimit-*`). Captures threshold + recovery behavior — Phase 2's WCLI-01 retry logic is written against this evidence.
- **D-10:** Probe window — off-hours AEST (evening AEST / early AM local). Tutoring centers are low-traffic outside teaching hours; minimizes operator visibility and reduces any chance of vendor alarm.
- **D-11:** Failure handling — exponential backoff with retry up to 3× (1s / 2s / 4s), then stop. Transient failures during the burst are expected; persistent failure halts the script and captures response body + headers to `.planning/research/fixtures/wisenet/_errors/`. Affected rows flagged RED in the field map.
- **D-12:** Probes are read-only GETs only. Zero writes, zero mutations, regardless of vendor risk posture. Creds are treated as sensitive; any 401/403 halts the script immediately and Kevin is notified.

**Field-map structure & RED-row decision format:**
- **D-13:** `WISENET_FIELD_MAP.md` is one master matrix grouped by current Sheet tab (6 sections — Aggregations, Credit_Control, Upcoming Sessions, Students, Students & Courses, RemainingCredits). Columns: `dashboard_field | consumer | wisenet_endpoint | wisenet_field | classification | confidence | notes`.
- **D-14:** Classification thresholds: **GREEN** = direct 1:1 mapping with matching semantics and type. **YELLOW** = derivable with confidence (inputs exist, logic is straightforward, no ambiguity). **RED** = gap, missing input, or unclear semantics. Confidence column is HIGH/MEDIUM/LOW, orthogonal to GREEN/YELLOW/RED.
- **D-15:** Each RED row gets a structured block immediately below the matrix: **Problem** (what's missing), **Options considered** (3-4 alternatives), **Decision** (exactly one of: `derive-client` / `accept-loss` / `postgres-sidecar` / `block-cutover`), **Rationale** (2-3 sentences), **Affects** (which WCLI/DB/TEST requirements in REQUIREMENTS.md). Planner extracts structured requirements from these blocks.
- **D-16:** After the matrix and RED blocks, a **Opportunities** section captures differentiator/parking-lot items Phase 1 discovers — invoice/payment, attendance-rate, notes, tags, webhook support — with explicit "NOT this milestone" labels. Folds back into v2 `OPS-*` / `RPT-*` / `UX-*` when a future milestone opens.

### Claude's Discretion
- Exact probe endpoint set (TBD from Postman parse, but must cover: students list, student detail, enrolment detail, past sessions, upcoming sessions, and any balance/credit endpoint if one exists)
- Exact tsx probe script layout and CLI flags
- Formatting details within the RED structured blocks (as long as the four required fields are present)
- Which specific fixture filenames to use (consistent pattern: `{resource}_{shape}_{qualifier}.json`)
- Whether to delete the probe scripts at end of Phase 1 or leave them in `web/scripts/` for later ad-hoc use (lean toward leave with a README noting Phase 1 provenance)

### Deferred Ideas (OUT OF SCOPE)
- **Opportunities captured during Phase 1 discovery** land in a dedicated section of `WISENET_FIELD_MAP.md` with explicit "NOT this milestone" labels. Expected topics: invoice/payment status (potential new `OPS-*` / `RPT-*` requirement), attendance-rate / engagement metrics, Wisenet notes/tags as a tag-based replacement for keyword exclusion (`pretest`/`trial`), real-time webhook invalidation (mapped to existing v2 `OPS-01`).
- **Sandbox / test namespace for probes** — not pursued this phase. If Wisenet flags the production account during aggressive probing, Phase 1 pauses and Kevin requests a sandbox before resuming.
- **Historical `Should_Credit` override values** — not preserved anywhere. Action sheets remain as read-only archive per PROJECT.md, including any historical `Should_Credit` column data.
- **Vendor coordination before probes** — not pursued; accepted as acceptable vendor risk. If reconsidered, probe start is delayed until vendor response.
- **Endpoint catalogue for endpoints the dashboard does not touch** — Phase 1 still catalogues them in `WISENET_ENDPOINTS.md` (from the Postman parse — cheap) but does not probe them. Future milestones can reach in.
- **Moving probe scripts out of `web/scripts/`** after Phase 1 — deferred. Leaves them in place with a README noting Phase 1 provenance so they're discoverable but clearly labelled as research.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WISE-01 | Every current dashboard field (REQUIRED_COLUMNS + dashboard.ts types) mapped to specific Wisenet endpoint + field | `## Field-Map Matrix Mechanics` + enumerated REQUIRED_COLUMNS in `## Field Inventory` — 26 canonical fields across 6 tabs |
| WISE-02 | `.planning/research/WISENET_FIELD_MAP.md` written with each row classified GREEN/YELLOW/RED | D-13/D-14 structure specified in `## Field-Map Matrix Mechanics` |
| WISE-03 | Every RED row carries one of 4 decisions (derive-client / accept-loss / postgres-sidecar / block-cutover) | `## RED-Row Decision Framework` provides heuristics per decision type |
| WISE-04 | Wisenet auth scheme documented (headers, token format, base URL) from Postman | `## Postman Collection Parsing Strategy` + `## Probe Script Patterns` (auth probe section) |
| WISE-05 | Pagination + rate-limit behavior documented via empirical probes | `## Rate-Limit Fingerprinting Approach` + `## Pagination Pattern Detection` |
| WISE-06 | The 4 gap questions answered: Should_Credit, admin ownership, credit-balance model, pending-deduction availability | D-05/D-06/D-07/D-08 pre-answered in CONTEXT.md; Phase 1 executes the per-field probes that turn D-07/D-08 into concrete matrix rows |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives the planner MUST honor:

| Directive | Where | Action |
|-----------|-------|--------|
| Never commit `.clasprc.local.json` or credential material | CLAUDE.md §Apps Script | Probe creds in `web/.env` only; fixtures scanned for secrets before commit |
| Small PRs with clear issue link | CLAUDE.md §Review Standard | Phase 1 may decompose into: (a) Postman-parser PR, (b) probe-scripts PR, (c) field-map-and-ENDPOINTS PR |
| Include validation evidence in PR body | CLAUDE.md §Review Standard | Each PR carries fixture citations + grep assertions (see Validation Architecture) |
| Treat `web/` as active ownership area | CLAUDE.md | Probe scripts live in `web/scripts/`, not at repo root |
| Run GSD workflow before file-changing tools | CLAUDE.md §GSD | All research artifacts + probe commits flow through `/gsd-execute-phase` |
| Update docs in the same PR when workflow changes | CLAUDE.md §Review Standard | If probe scripts introduce a new npm script, `docs/WORKFLOW.md` updates land in the same PR |
| `web/` distinguishes source push from versioned deployment | CLAUDE.md §Apps Script | N/A for Phase 1 — no Next.js deploy involved |
| Auth / env / spreadsheet-access blockers are first-class handoff items | CLAUDE.md §Handoffs | Probe 401/403 halts → handoff note, not silent retry |

## Wisenet API — What We Know From External Sources (for probe calibration only)

These findings are cited from Wisenet's public docs to **calibrate probe assumptions**, NOT to replace the Postman collection as the authoritative source. Kevin's API variant may differ on any of these points.

| Fact | Source | Confidence | Impact on Phase 1 |
|------|--------|------------|-------------------|
| Legacy API: base URL `https://{orgcode}-api.wisenet.co/` | [CITED: learn.wisenet.co/old-api-developer-resources/] | HIGH | Compare against Kevin's `WISENET_BASE_URL` — if pattern differs, this is NOT the legacy API |
| Legacy API: HTTP Basic auth, `Authorization: Basic <base64(user:pass)>` | [CITED: learn.wisenet.co/old-api-developer-resources/] | HIGH | Kevin's creds shape (`API_KEY` + `USER_ID` + `CENTER_ID`) doesn't match Basic auth — probably IAE variant |
| Legacy API: `skip` / `take` pagination, designed to limit returned data to 1,000 records | [CITED: learn.wisenet.co/old-api-developer-resources/] | HIGH | If probes see `skip`/`take` params, this is legacy API |
| Legacy API: **1,000 calls per 24-hour sliding window per organisation** | [CITED: learn.wisenet.co/old-api-developer-resources/] | HIGH | Rate-limit probe MUST check remaining daily budget before the 200-burst — or burst could exhaust production's day |
| IAE API: base URL `https://api.wisenet.co/v1/` | [CITED: api-docs.wisenet.co/iae/oauth/index.html] | HIGH | Compare against Kevin's `WISENET_BASE_URL` |
| IAE API: OAuth 2.1 Bearer token in `Authorization`, plus `x-api-key` header | [CITED: api-docs.wisenet.co/iae/oauth/index.html] | HIGH | If probes show 401 on API-key-only, OAuth dance is needed — Phase 2 complication |
| IAE API: Accept header `application/vnd.mywisenet.api.v1+json` | [CITED: learn.wisenet.co/api/ (vendor MIME)] | MEDIUM | Probes should try default `application/json` first, then fall back |
| IAE API: OAuth scope gating — scopes granted narrowly per integration | [CITED: api-docs.wisenet.co/iae/oauth/index.html] | HIGH | 403s on specific endpoints may mean "scope not granted" rather than "endpoint doesn't exist" |
| Sandbox / test environment available on request | [CITED: learn.wisenet.co/api/] | MEDIUM | Deferred per CONTEXT.md — if vendor flags production, Kevin requests sandbox and Phase 1 pauses |

**Critical gap:** Neither public doc source explains how `USER_ID` or `CENTER_ID` from Kevin's credential set are used. Hypotheses (to verify via Postman):
- **H1:** `CENTER_ID` is a URL path segment (e.g. `/v1/centres/{centerId}/students`)
- **H2:** `CENTER_ID` is a custom header (e.g. `x-centre-id`)
- **H3:** `USER_ID` is audit attribution only (e.g. `x-user-id`) — not required for auth
- **H4:** The combination is an HMAC signing scheme (`USER_ID` + `API_KEY` → request signature)
- **H5:** This is a third variant not documented publicly — only the Postman collection reveals it

The Postman parse is the ONLY way to disambiguate. Probes must not launch until H1-H5 are narrowed to one.

## Postman Collection Parsing Strategy

### Postman v2.1 Schema (Canonical)

**Source:** [CITED: schema.postman.com/collection/json/v2.1.0/draft-07/collection.json]

**Top-level shape:**
```json
{
  "info": {
    "name": "Wisenet API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    "_postman_id": "<uuid>"
  },
  "item": [ /* items or folders */ ],
  "auth": { /* collection-level auth */ },
  "event": [ /* pre-request / test scripts */ ],
  "variable": [ /* {{baseUrl}} etc. */ ]
}
```

**Item shape (a single request):**
```json
{
  "name": "Get Student List",
  "request": {
    "method": "GET",
    "header": [
      { "key": "Authorization", "value": "Bearer {{apiKey}}", "type": "text" },
      { "key": "x-api-key", "value": "{{apiKey}}", "disabled": false }
    ],
    "url": {
      "raw": "{{baseUrl}}/students?skip=0&take=100",
      "host": ["{{baseUrl}}"],
      "path": ["students"],
      "query": [
        { "key": "skip", "value": "0" },
        { "key": "take", "value": "100" }
      ]
    },
    "body": { "mode": "raw", "raw": "{...}" },
    "auth": { /* optional per-request override */ }
  },
  "response": [ /* saved example responses — GOLD for field shape */ ]
}
```

**Item-group (folder) shape:**
```json
{
  "name": "Students",
  "item": [ /* nested items or sub-folders */ ]
}
```

### Extraction Strategy (for `wisenet-postman-parse.ts`)

**Approach:** Read the JSON in Node, resolve collection-level variables (`{{baseUrl}}`, `{{apiKey}}`, etc.) against the `variable[]` array, walk `item[]` recursively, and emit a deterministic table.

**Why tsx (not jq):**
- jq is a sharp tool but Postman's item tree is recursive and variable-substituted — jq recipes for this get hairy fast.
- tsx gives us the same Node environment as the probe scripts (env reading, fixture writing) — one script pattern, one dependency.
- Output is deterministic (sort endpoints alphabetically by `method + path`) — diff-friendly in PRs.

**Output structure for WISENET_ENDPOINTS.md:**

```markdown
# Wisenet Endpoint Catalogue
Parsed from `.planning/research/wisenet-postman.json` on <date>.

## Auth (collection-level)
- Type: <bearer | apikey | basic | oauth2 | awsv4 | custom>
- Header name: <exact from Postman>
- Variable name: <{{apiKey}} | {{token}} | ...>
- Collection variables: `baseUrl = https://...` etc.

## Endpoints

### Students
| Method | Path | Auth | Query params | Required headers | Postman folder | Notes |
|--------|------|------|--------------|------------------|----------------|-------|
| GET | /students | bearer+apikey | skip, take, state | Accept, x-api-key | Students/List | Has saved response — see fixture |
| GET | /students/{studentId} | bearer+apikey | — | Accept, x-api-key | Students/Detail | |

### Enrolments
...
```

### Risk: variable resolution

Collection-level `variable[]` entries use `{{name}}` substitution. Some Wisenet Postman collections inline the `WISENET_API_KEY` as a default variable value — **the parser must scan for the string `WISENET_API_KEY`, any hex key-looking strings, and the literal `apikey` / `token` substrings and refuse to emit them into `WISENET_ENDPOINTS.md`**. Treat the collection file as potentially-tainted and apply a redaction pass before any output file is written.

**Safe substitution rule:** Replace any variable whose resolved value looks like a key (length ≥ 16, alphanumeric, no whitespace) with the literal string `{{apiKey}}` — never the resolved value. Preserve `{{baseUrl}}`, `{{namespace}}`, `{{centerId}}`, `{{userId}}` as symbolic placeholders in the output.

## Probe Script Patterns (follow `web/scripts/compare-live.ts`)

### Canonical pattern (from `web/scripts/compare-live.ts` lines 1-9, 27-42, 60-80)

- Top-of-file imports + `async function main()` + `void main()` footer — no CLI framework
- Env vars read via `process.env.X?.trim()` with explicit null checks before use
- `execFileAsync` for child processes (not needed here since probes use `fetch`)
- `console.error` for mismatches → `process.exitCode = 1`; `console.log` for success
- `maxBuffer: 20 * 1024 * 1024` for subprocess stdout — probes don't need this, but demonstrates the existing "one-shot script, no streaming" attitude

### Probe script shape (recommended)

```typescript
#!/usr/bin/env tsx
// web/scripts/wisenet-probe-<concern>.ts
// Phase 1 only — delete or archive after WISENET_ENDPOINTS.md + WISENET_FIELD_MAP.md are verified.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Inline env reader — do NOT import getWisenetEnv from lib/runtime/env.ts (Phase 2 adds that; Phase 1 probes must not
// pre-shape lib/runtime/env.ts in ways Phase 2 then has to refactor).
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function readWisenetEnv() {
  return {
    baseUrl: required("WISENET_BASE_URL"),
    apiKey: required("WISENET_API_KEY"),
    userId: required("WISENET_USER_ID"),
    centerId: required("WISENET_CENTER_ID"),
    namespace: required("WISENET_NAMESPACE"),
  };
}

const FIXTURE_DIR = resolve(
  new URL(".", import.meta.url).pathname,
  "../../.planning/research/fixtures/wisenet",
);

async function main() {
  const env = readWisenetEnv();
  // ... probe-specific logic
}

void main().catch((err) => {
  console.error("Probe failed:", err);
  process.exitCode = 1;
});
```

### Conventions each probe script MUST follow

| Concern | Convention |
|---------|------------|
| **Env loading** | Inline `required()` — do NOT import from `lib/runtime/env.ts` (that's Phase 2's `getWisenetEnv()`) |
| **CLI args** | None — zero creds via CLI per D-12; if a probe needs a target resource ID, read from env (`WISENET_PROBE_TARGET_STUDENT_ID`) or a fixture filename |
| **Fixture output path** | `.planning/research/fixtures/wisenet/{resource}_{shape}_{qualifier}.json` — `mkdirSync(..., { recursive: true })` on startup |
| **Error fixture path** | `.planning/research/fixtures/wisenet/_errors/{resource}_{timestamp}_{status}.json` — one error = one fixture |
| **Request capture** | Fixture file records `{ request: {method, url, headers}, response: {status, headers, body}, timestamp, probe: "wisenet-probe-X" }` — full round-trip |
| **Header redaction on write** | Redact `Authorization`, `x-api-key`, cookies, and any header whose value matches the API-key length/shape heuristic. Replace with `"<REDACTED>"`. Include a comment in the fixture: `"_note": "Auth headers redacted for commit safety"` |
| **Burst pacing** | `for (let i = 0; i < BURST_COUNT; i++) { await fetch(...); }` — serial, not `Promise.all`. The point is to fingerprint threshold behavior, not race the server |
| **401/403 handling** | Immediate halt per D-12. Write the error fixture, `console.error` the status + WWW-Authenticate header if present, `process.exitCode = 2` (distinct from `= 1` for test-like failures) |
| **5xx handling** | Exponential backoff per D-11 (1s → 2s → 4s, max 3 retries), then halt with error fixture |
| **Retry-After handling** | If response has `Retry-After` header, wait that long + 500ms jitter before resuming the burst. Log the value |
| **Timeout** | 15s per request via `AbortSignal.timeout(15_000)` — matches STACK.md's recommended client timeout |
| **Logging** | `console.log` one line per request: `[i/N] GET /path -> 200 (remaining: X, reset: Y)` — makes a dropped request obvious |

### Probe script roster (inferred from WISE-05 + CONTEXT.md)

| Script | Concern | Endpoint pattern | Exit criteria |
|--------|---------|------------------|---------------|
| `wisenet-postman-parse.ts` | Parse Postman JSON, emit WISENET_ENDPOINTS.md | none (no network) | Catalogue written, variables redacted |
| `wisenet-probe-auth.ts` | Verify which auth scheme works; discover required header set | 1 GET to cheapest endpoint | Records the exact header set that returns 200 |
| `wisenet-probe-pagination.ts` | Detect pagination style (skip/take vs cursor vs link-header vs page) | 3 GETs to students list (page 1, page 2, past-end) | Records the shape of `next`/`total` indicators in response |
| `wisenet-probe-rate-limit.ts` | 200-burst to low-cardinality endpoint | 200 GETs to students list | Records first 429 index, headers returned, `Retry-After` value |
| `wisenet-probe-field-shape.ts` | Per-endpoint: capture one representative response for each Wisenet resource the field map references | 1 GET per resource (students, enrolments, past sessions, upcoming sessions, credit balance) | Fixtures written for every dashboard-field candidate |

**Script lifecycle (per D-16 Claude's-discretion):** Leave them in `web/scripts/` with a `web/scripts/README-wisenet-probes.md` noting Phase 1 provenance, so they're re-runnable for debugging during Phase 2 without re-inventing them.

## Rate-Limit Fingerprinting Approach

### What the probe records (structured for Phase 2 WCLI-01 consumption)

`.planning/research/fixtures/wisenet/_rate-limit-fingerprint.json`:

```json
{
  "probed_at": "2026-04-21T22:00:00+10:00",
  "endpoint": "GET /students?skip=0&take=100",
  "burst_size": 200,
  "concurrency": 1,
  "first_429_index": 127,
  "first_429_elapsed_ms": 8432,
  "first_429_headers": {
    "retry-after": "60",
    "x-ratelimit-limit": "1000",
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": "1714089600",
    "content-type": "application/json"
  },
  "first_429_body_snippet": "{\"error\":\"rate limit exceeded\",\"...\"}",
  "pre_burst_headers_sampled": {
    "x-ratelimit-limit": "1000",
    "x-ratelimit-remaining": "873"
  },
  "post_burst_recovery": {
    "waited_ms": 60500,
    "next_request_status": 200,
    "recovered_remaining": "50"
  },
  "notes": "Daily budget consumed: ~127 of 1000. Do NOT rerun today."
}
```

### What Phase 2 WCLI-01 reads from this file

- `first_429_headers` keys → tells retry wrapper which header names to parse (`Retry-After` vs `X-RateLimit-Reset` vs custom)
- `burst_size`, `first_429_index` → informs default `p-limit` concurrency (if 1 req/sec triggers 429 at index 127, a client doing 10 req/sec needs heavier rate limiting)
- `post_burst_recovery.waited_ms` → validates `Retry-After` was honored; documents if vendor recovered faster or slower than advertised

### Standard headers to probe for [CITED: ietf.org/archive/id/draft-polli-ratelimit-headers-02.html]

Non-exhaustive; Wisenet may use any subset or a custom variant:

| Header | Semantics |
|--------|-----------|
| `Retry-After` | RFC 7231 — seconds or HTTP-date; honored by most HTTP clients |
| `X-RateLimit-Limit` | Window ceiling (e.g. 1000) |
| `X-RateLimit-Remaining` | Requests left in current window |
| `X-RateLimit-Reset` | Unix timestamp or seconds until window resets |
| `RateLimit` / `RateLimit-Policy` | IETF draft — modern standardized form |
| Custom Wisenet headers | `x-wisenet-*` possible; probe records all non-standard headers verbatim |

### Safety guard: daily-budget check

**Before the 200-burst runs**, the probe makes ONE throwaway GET to read the current `X-RateLimit-Remaining` header (or equivalent). If remaining < 300, the probe aborts with:

```
Remaining daily budget (N) insufficient for 200-burst. Abort.
Re-run tomorrow AEST off-hours, or reduce burst size via WISENET_PROBE_BURST env var.
```

This protects production from the 1,000/24h ceiling if it applies (legacy API fact).

**Structured output file `_rate-limit-budget-used.json`** records consumption so subsequent probe runs can avoid re-spending:

```json
{ "date_aest": "2026-04-21", "endpoint": "students-list", "requests_used": 127, "remaining_at_start": 873 }
```

## Pagination Pattern Detection

### Four patterns to distinguish [CITED: embedded.gusto.com/blog/api-pagination/, stainless.com/sdk-api-best-practices/how-to-implement-rest-api-pagination-offset-cursor-keyset]

| Pattern | Request shape | Response signal |
|---------|--------------|-----------------|
| **Offset/limit** | `?skip=0&take=100` or `?offset=0&limit=100` | Body has `total` or `SetCount`; next page = increment skip |
| **Page number** | `?page=1&per_page=50` | Body has `page`, `per_page`, `total_pages` |
| **Cursor/opaque token** | `?cursor=abc123` | Body returns `next_cursor` or `next_page_token`; no total |
| **Link header (RFC 5988)** | Standard URL | `Link: <https://api/next>; rel="next", <...>; rel="prev"` header |

### Probe logic (`wisenet-probe-pagination.ts`)

1. **Request 1:** Baseline GET with no pagination params. Inspect response body for `total`, `count`, `SetCount`, `page`, `per_page`, `next`, `next_cursor`, `next_page_token`. Inspect headers for `Link`.
2. **Request 2:** If baseline has fewer records than a common limit (e.g. 100), try `?skip=0&take=100` (legacy pattern). If body matches baseline shape but with 100 records, skip/take works. If 400 error, try `?offset=0&limit=100`.
3. **Request 3:** If step 2 succeeded, issue `?skip={N}&take={N}` where N = whatever step 2 returned, and confirm records DON'T overlap baseline. This proves skip/take semantics, not just that the params are accepted.
4. **Request 4:** Issue a past-end request (`?skip=100000&take=100`) and record the empty-set response shape — Phase 2 needs this to know when to stop iterating.

### Output (`_pagination-fingerprint.json`)

```json
{
  "pattern": "skip-take",
  "request_shape": {
    "param_names": ["skip", "take"],
    "default_take": 100,
    "max_take": 1000
  },
  "response_shape": {
    "total_field_path": "SetCount",
    "items_field_path": "Students",
    "next_indicator": null,
    "empty_set_body": { "SetCount": 0, "Students": [] }
  },
  "iteration_termination": "records.length < take → stop",
  "link_header_present": false
}
```

Phase 2's `lib/wisenet/client.ts` iterator helper reads this file shape directly — the `pattern` field selects which iterator strategy to use.

### Field-map + endpoint-catalogue pagination notes

For each endpoint in `WISENET_ENDPOINTS.md` that returns a list, the row records:
- Pagination pattern inherited from collection-level probe, OR overridden per endpoint (some APIs use skip/take for most but cursor for one or two)
- Max records-per-page value observed

For each dashboard field in `WISENET_FIELD_MAP.md` that depends on a paginated endpoint, the row's `notes` column flags "requires iteration" — Phase 2 then knows to budget time / rate-limit cost for that mapping.

## Field-Map Matrix Mechanics (WISE-01, WISE-02)

### Canonical REQUIRED_COLUMNS inventory (verified from `web/src/lib/dashboard/config.ts:64-102`)

26 fields across 6 Sheet tabs. **Every row in `WISENET_FIELD_MAP.md` MUST map to one of these** — if a probe discovers a Wisenet field that's NOT in this list, the Opportunities section captures it instead.

| Tab | Fields | Count |
|-----|--------|-------|
| aggregations | `Student Name`, `Parent Name`, `Class Subject`, `Current Remaining Credits`, `Current Total Credits` | 5 |
| creditControl | `Student Name`, `Package/Program`, `final_status`, `teacher_feedback`, `credits_consumed`, `session_duration`, `session_date`, `Should_Credit` | 8 |
| upcoming | `Student Name`, `Package/Program`, `Session Status`, `Session Duration`, `Scheduled Date` | 5 |
| students | `student_name`, `Remaining Credits` | 2 |
| studentsCourses | `Student Name`, `Class Name`, `Class Subject` | 3 |
| remainingCredits | `Student`, `Admin` | 2 |
| **total** | | **25** (the 8th creditControl row lists Should_Credit — dropped per D-05, but still gets a field-map row marked `accept-loss`) |

### Downstream payload shapes (verified from `web/src/types/dashboard.ts`)

The field map classifies against REQUIRED_COLUMNS, but every field must also survive its downstream payload consumer. The `consumer` column in the matrix references one of:

| Consumer module | File | What it reads |
|-----------------|------|---------------|
| `buildActiveStudentSet` | `lib/dashboard/packages.ts:31-45` | `students.student_name`, `students.Remaining Credits` |
| `buildExcludedPackageReasons` | `lib/dashboard/packages.ts:47-61` | `studentsCourses.Student Name`, `Class Name`, `Class Subject` |
| `buildStudentAdminOwnershipMap` | `lib/dashboard/packages.ts:63-109` | `remainingCredits.Student`, `Admin` (**noted: D-06 retires this consumer in favor of Postgres sidecar**) |
| `buildPendingDeductionContext` + `shouldCountAsPendingDeduction` + `buildPendingDeductionDetail` | `lib/dashboard/packages.ts:152-260` | All 8 creditControl fields |
| `buildUpcomingSessionMap` | `lib/dashboard/packages.ts:262-294` | All 5 upcoming fields |
| `buildDashboardStudents` | `lib/dashboard/packages.ts:296-359` | All 5 aggregations fields |
| `StudentQueueRow`, `CalendarPayload`, `SummaryPayload` | `lib/dashboard/analytics.ts` + `types/dashboard.ts` | Downstream of all above — no raw Wisenet consumption |

### Workflow for filling in one row (planner uses this as the loop)

```
For each of the 25 REQUIRED_COLUMNS fields:
  1. Find candidate endpoint in WISENET_ENDPOINTS.md (keyword match on tab concept: "student", "enrolment", "attendance", "timetable", "credit")
  2. If no candidate → classify RED, decision = block-cutover (or derive-client if fallback exists)
  3. If candidate exists → run wisenet-probe-field-shape.ts for that endpoint → fixture written
  4. Inspect fixture for field presence + type + semantics:
     - Present + 1:1 type + matching semantics → GREEN, confidence HIGH
     - Present but type differs (e.g. string "2" vs number 2) → GREEN with Zod coerce note, confidence HIGH
     - Present but semantics differ (e.g. Wisenet "active" != BeGifted "Remaining Credits != N/A") → YELLOW, confidence MEDIUM, notes: derivation recipe
     - Partial (field exists on one endpoint but not another required) → YELLOW or RED depending on whether a single-source alternative exists
     - Missing → RED, run through RED-row decision framework
  5. Record row: dashboard_field | consumer | wisenet_endpoint | wisenet_field | classification | confidence | notes
  6. Notes column MUST cite: (a) Postman path (from WISENET_ENDPOINTS.md), (b) fixture filename (if probed)
```

### Evidence citation format (every row)

**Minimum acceptable note format for GREEN/YELLOW:**
> `Postman: Students/List (v1/students). Fixture: students_list_page1.json → students[0].firstName. Zod: z.coerce.string().`

**Minimum acceptable note format for RED:**
> `Postman: (no candidate endpoint — searched "credit", "balance", "remaining" in catalogue). Fixture: — . See RED block below for decision.`

Rows with a note that doesn't cite at least one Postman path OR one fixture filename fail validation (see `## Validation Architecture`).

## RED-Row Decision Framework (WISE-03)

Each RED row's structured block names exactly one decision from {`derive-client`, `accept-loss`, `postgres-sidecar`, `block-cutover`}. Heuristics:

### Decision tree

```
Start: field is RED (missing from Wisenet or semantically wrong)
  │
  ├─ Can the field be reconstructed from other Wisenet fields with straightforward logic?
  │   (e.g. Current Remaining = Total − sum(session_duration/60 where final_status=ENDED))
  │   └─ YES → derive-client
  │
  ├─ Can we live without the field? (e.g. Should_Credit per D-05)
  │   └─ YES → accept-loss
  │
  ├─ Does the field require historical state not in any current source?
  │   (e.g. admin ownership across time, manual overrides, follow-up notes)
  │   └─ YES → postgres-sidecar
  │
  └─ None of the above → block-cutover (matrix row forces Phase 2 gate)
```

### Heuristic details

**`derive-client` wins when:**
- All inputs for the derivation are in Wisenet (GREEN or YELLOW)
- The derivation logic is <10 lines, referentially transparent, testable in Vitest
- The field is NOT historical (a one-time derivation on current state is sufficient)
- Example: `Current Remaining Credits` if Wisenet exposes `total_credits` + session-list, not a native balance

**`accept-loss` wins when:**
- The field is nice-to-have, not load-bearing for core triage
- Users have explicitly agreed it can go (D-05 is the canonical case)
- The legacy behavior is reproduced by a simpler default (e.g. Should_Credit → use session_duration fallback always)
- No compliance / audit requirement depends on the lost field

**`postgres-sidecar` wins when:**
- The derivation needs historical state (operator marked a student inactive last month, admin ownership assigned in Q3)
- The state is operator-managed, not Wisenet-managed (Wisenet is read-only for this app)
- The field is small and relational (student_key → metadata) — not a full replication
- Example: `Admin` per D-06 (admin ownership has no native Wisenet analogue; sidecar table is the architectural answer)

**`block-cutover` wins when:**
- Field is load-bearing (priority scoring breaks if wrong/missing)
- None of the above three options work
- Losing the field changes operator workflow fundamentally
- Example: If `final_status` from creditControl has no Wisenet analogue AND the pending-deduction rule (D-08) can't be replicated another way, the cutover must pause until a solution is found (e.g. custom field request to Wisenet, or re-scope the feature)

### Pre-answered decisions from CONTEXT.md

Three of the four gap-question answers arrive with a pre-decided bucket:

| Gap question | Pre-answer | Decision bucket |
|--------------|------------|-----------------|
| Should_Credit | D-05: drop entirely | accept-loss |
| Admin ownership | D-06: Postgres sidecar | postgres-sidecar |
| Credit-balance model | D-07: direct-first, derived fallback | GREEN or derive-client per field — decided by probe |
| Pending-deduction rule fields (3 of them) | D-08: replicate 1:1; RED if any missing | derive-client (if inputs present) or block-cutover (if inputs missing) — per probe |

The field map's RED blocks document these decisions with rationale linking back to CONTEXT.md D-number.

## Runtime State Inventory

> Phase 1 is docs-only with probe scripts. No production code touched; no existing runtime state is renamed or migrated. This section is included for completeness per the researcher protocol; every category is "none."

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 1 writes only to `.planning/research/fixtures/wisenet/*.json` (tracked research evidence, not a live datastore) | none |
| Live service config | None — probe scripts do not register with Wisenet webhooks, callbacks, or any external-service UI | none |
| OS-registered state | None — probes are one-shot `tsx` invocations, not daemons / cron / Task Scheduler entries | none |
| Secrets/env vars | `WISENET_API_KEY`, `WISENET_USER_ID`, `WISENET_CENTER_ID`, `WISENET_NAMESPACE`, `WISENET_BASE_URL` added to `web/.env` (gitignored) and documented in `web/.env.example` (values replaced with placeholders) | Phase 2 adds `getWisenetEnv()` in `lib/runtime/env.ts` — Phase 1 does NOT pre-shape this to avoid Phase 2 refactor churn |
| Build artifacts | None — probe scripts are tsx one-shots; no package install expected unless `@types/node` needs a bump (currently `^22`, sufficient) | none |

## Common Pitfalls

### Pitfall 1: Committing resolved variable values from the Postman collection

**What goes wrong:** `wisenet-postman-parse.ts` resolves `{{apiKey}}` → actual key string, emits it into `WISENET_ENDPOINTS.md`, Kevin approves the commit, creds leak to git history.

**Why it happens:** Postman collections routinely ship with default values for convenience variables. A naïve parser resolves everything; the output looks correct but contains credentials.

**How to avoid:**
- Parser's variable-resolution pass tags any value matching the API-key heuristic (length ≥ 16, alphanumeric, no whitespace) as **preserve-as-symbolic** — write `{{apiKey}}` to output, not the resolved string.
- Parser runs `grep -E '[a-zA-Z0-9]{24,}'` on its own output before writing; if any match, it refuses to write and prints the offending line.
- CI check (if gitleaks is installed — currently not, per PITFALLS.md Pitfall 8) catches anything the parser misses.

### Pitfall 2: Including recorded response bodies that contain student PII

**What goes wrong:** A `students_list_page1.json` fixture contains 50 real student names, parent emails, phone numbers, DOBs. Committing to the repo exposes PII to everyone with repo access (and the repo may not be private-only forever).

**Why it happens:** Fixtures are recorded verbatim from real responses. Wisenet returns everything it has on a student — name, email, mobile, DOB, address, sometimes NAPLAN scores or special-needs flags.

**How to avoid:**
- **Redaction pass** on every fixture before write:
  - Replace `firstName` / `lastName` / `parentName` → `"Student_{index}"` / `"Parent_{index}"`
  - Replace `email` / `emailAddress` → `"student{index}@example.test"`
  - Replace `mobile` / `phone` → `"0000000000"`
  - Replace `dateOfBirth` → `"2010-01-01"` (preserve shape, not value)
  - Replace `address*` fields → `"Redacted"`
  - Preserve: IDs (so cross-fixture joins still make sense), status enums, dates (non-DOB), numeric balances
- **Decision-support for the planner, not a mandate** — Kevin has final say on whether real PII or redacted fixtures land in the repo. Recommendation: redacted by default, keep real-data fixtures in `web/.env.d/wisenet-raw/` (gitignored) for deeper Phase 2 reference if needed.
- Fixture file header comment records the redaction policy applied: `"_redaction": "names=synthetic, contact=synthetic, dates=dob-only, ids=preserved"`.

### Pitfall 3: Exhausting the 1,000/24h rate-limit budget during a probe run

**What goes wrong:** Probe consumes 200-300 requests; legitimate dashboard queries later that day fail because the organisation budget is spent; operator sees "rate limit exceeded" on a live read.

**Why it happens:** Rate-limit budget is per-organisation, not per-client. A probe is indistinguishable from production traffic.

**How to avoid:**
- Pre-burst check: read `X-RateLimit-Remaining` from one cheap GET before the burst; abort if < 300.
- Record budget consumed to `_rate-limit-budget-used.json` so same-day re-runs abort early.
- Schedule per D-10: AEST off-hours (evening AEST = early AM at BeGifted's local time, when tutoring centers are dark).
- If the 1,000 budget is confirmed inapplicable (IAE variant may have different limits), remove the check — document the confirmation in the fingerprint fixture.

### Pitfall 4: Assuming Wisenet auth is what the public docs describe

**What goes wrong:** Probe author reads the public docs, wires `Authorization: Basic ...` header, gets 401, assumes creds are wrong, asks Kevin to rotate. Kevin rotates. Creds still fail because the actual scheme is different.

**Why it happens:** Wisenet has two parallel API surfaces (legacy + IAE); Kevin's creds shape (`API_KEY` + `USER_ID` + `CENTER_ID`) doesn't cleanly match either public scheme. The Postman collection is the authoritative source.

**How to avoid:**
- **Step order:** Parse Postman FIRST, build the auth-header block from what Postman shows, THEN probe.
- If auth probe gets 401, capture the exact request headers + response body + `WWW-Authenticate` header to an error fixture. Do NOT ask Kevin to rotate; do ask Kevin to confirm the Postman example request works interactively.
- Never assume — always cite.

### Pitfall 5: Classifying a field GREEN because the endpoint exists, without checking response field presence

**What goes wrong:** `WISENET_ENDPOINTS.md` has `GET /students/{id}` — field map author marks `Parent Name` as GREEN pointing at `/students/{id}.parent.name`. Probe fixture later shows Wisenet's student resource has no parent field (parents are a separate resource). Cutover ships with null parent names.

**Why it happens:** The field map is populated from the endpoint catalogue, but the catalogue only lists paths + params, not response shapes.

**How to avoid:**
- GREEN classification requires BOTH: (a) endpoint citation from `WISENET_ENDPOINTS.md`, AND (b) fixture file with the field physically present and of correct shape.
- A YELLOW or RED classification can skip the fixture requirement if the reason is documented ("probe couldn't hit this endpoint within Phase 1 budget — need follow-up").
- The Validation Architecture's grep assertion (below) catches missing fixture citations programmatically.

### Pitfall 6: Writing the field map before the endpoint catalogue is complete

**What goes wrong:** Field map author picks the "obvious" Wisenet endpoint by name match (`Student` for student rows), misses that Wisenet has separate `Student` and `Enrolment` resources with different shapes, ends up putting 60% of rows against the wrong endpoint.

**How to avoid:**
- Sequence matters: `WISENET_ENDPOINTS.md` FIRST (exhaustive, one-pass parse from Postman), `WISENET_FIELD_MAP.md` SECOND (per-field lookup into the catalogue).
- Field map author is not allowed to reference endpoints not in the catalogue — if a row needs an endpoint that isn't there, the catalogue gets updated first, with provenance (Postman folder name + path).

## Code Examples

### Pattern 1: tsx probe script skeleton (follows `compare-live.ts` conventions)

```typescript
// web/scripts/wisenet-probe-pagination.ts
#!/usr/bin/env tsx

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const FIXTURE_DIR = resolve(process.cwd(), ".planning/research/fixtures/wisenet");

function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of headers.entries()) {
    const lower = k.toLowerCase();
    if (lower === "authorization" || lower === "x-api-key" || lower === "cookie") {
      out[k] = "<REDACTED>";
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function probe() {
  const baseUrl = required("WISENET_BASE_URL");
  const apiKey = required("WISENET_API_KEY");

  mkdirSync(FIXTURE_DIR, { recursive: true });

  // Step 1: baseline — no pagination params
  const res = await fetch(new URL("/students", baseUrl), {
    headers: {
      "Accept": "application/json",
      "x-api-key": apiKey, // confirm exact header name from Postman parse
      // add any CENTER_ID / USER_ID / NAMESPACE header here based on Postman
    },
    signal: AbortSignal.timeout(15_000),
  });

  const body = await res.json().catch(() => null);
  const fixture = {
    probe: "wisenet-probe-pagination",
    timestamp: new Date().toISOString(),
    request: {
      method: "GET",
      url: res.url,
      headers: { /* redacted above */ },
    },
    response: {
      status: res.status,
      headers: redactHeaders(res.headers),
      body_shape: body ? Object.keys(body) : null,
      record_count: Array.isArray(body) ? body.length
        : body && typeof body === "object" ? Object.values(body).find(Array.isArray)?.length ?? null
        : null,
    },
  };

  writeFileSync(
    resolve(FIXTURE_DIR, `_pagination-probe-baseline.json`),
    JSON.stringify(fixture, null, 2),
  );

  if (res.status === 401 || res.status === 403) {
    console.error(`AUTH FAILURE (${res.status}) — halting per D-12`);
    process.exitCode = 2;
    return;
  }

  // Step 2+: retry with skip/take, then with offset/limit, then inspect for Link header
  // ...
}

void probe().catch((err) => {
  console.error("Probe failed:", err);
  process.exitCode = 1;
});
```

### Pattern 2: Postman parser shape (for WISENET_ENDPOINTS.md emission)

```typescript
// web/scripts/wisenet-postman-parse.ts
interface PostmanV21Collection {
  info: { name: string; schema: string };
  item: PostmanItem[];
  variable?: Array<{ key: string; value: string; type?: string }>;
  auth?: PostmanAuth;
}

interface PostmanItem {
  name: string;
  item?: PostmanItem[]; // folder
  request?: {
    method: string;
    header: Array<{ key: string; value: string; disabled?: boolean }>;
    url: string | { raw: string; host?: string[]; path?: string[]; query?: Array<{ key: string; value: string }> };
    body?: { mode: string; raw?: string };
    auth?: PostmanAuth;
  };
  response?: Array<{ name: string; status: string; body: string }>;
}

function isSecretLike(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,}$/.test(value.trim());
}

function resolveVariable(raw: string, variables: Record<string, string>): string {
  return raw.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    const resolved = variables[name];
    if (resolved && isSecretLike(resolved)) return match; // preserve {{name}} symbolically
    return resolved ?? match;
  });
}

function walkItems(items: PostmanItem[], folderPath: string[] = []): ParsedEndpoint[] {
  const out: ParsedEndpoint[] = [];
  for (const item of items) {
    if (item.item) {
      out.push(...walkItems(item.item, [...folderPath, item.name]));
    } else if (item.request) {
      out.push({
        folder: folderPath.join(" / "),
        name: item.name,
        method: item.request.method,
        path: typeof item.request.url === "string" ? item.request.url : item.request.url.raw,
        headers: item.request.header.filter((h) => !h.disabled),
        // ...
      });
    }
  }
  return out;
}
```

### Pattern 3: Fixture redaction helper

```typescript
// Used by any probe that records a real Wisenet response body
function redactStudentPII<T>(record: T): T {
  if (!record || typeof record !== "object") return record;
  const redacted: any = { ...record };
  if ("firstName" in redacted) redacted.firstName = "Student_FN";
  if ("lastName" in redacted) redacted.lastName = "Student_LN";
  if ("emailAddress" in redacted) redacted.emailAddress = "student@example.test";
  if ("mobile" in redacted) redacted.mobile = "0000000000";
  if ("dateOfBirth" in redacted) redacted.dateOfBirth = "2010-01-01";
  // preserve IDs and status enums
  return redacted;
}
```

## Validation Architecture

> `workflow.nyquist_validation: true` in `.planning/config.json`. This section defines the minimum validation set for this docs-only phase.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Bash grep assertions + tsx-based schema validators (no Vitest for Phase 1) |
| Config file | None — assertions are plain shell commands invoked from a per-task validation section |
| Quick run command | `bash .planning/phases/01-wisenet-discovery/validate-phase1.sh` (Wave 0 creates this script) |
| Full suite command | same as quick — Phase 1 outputs are small enough that full validation runs in < 5 seconds |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WISE-01 | Every REQUIRED_COLUMNS field has exactly one row in the matrix | grep assertion | `for field in "Student Name" "Parent Name" ... ; do grep -c "\| $field \|" WISENET_FIELD_MAP.md; done == 1` | ❌ Wave 0 |
| WISE-02 | Every row classified GREEN / YELLOW / RED (not blank, not other) | grep assertion | `awk -F'\|' '/^\|/ {print $6}' WISENET_FIELD_MAP.md \| grep -vE '^\s*(GREEN\|YELLOW\|RED\|classification\|-+)\s*$'` returns empty | ❌ Wave 0 |
| WISE-02 | Every row cites a Postman path OR a fixture filename in notes column | grep assertion | Every non-header row's notes column contains `Postman:` or `Fixture:` | ❌ Wave 0 |
| WISE-03 | Every RED row has a structured block with all 5 fields (Problem / Options / Decision / Rationale / Affects) | grep assertion | For each RED row in matrix, confirm the block below has `**Problem**`, `**Options considered**`, `**Decision**`, `**Rationale**`, `**Affects**` sub-headers | ❌ Wave 0 |
| WISE-03 | Every RED row's Decision value is one of {derive-client, accept-loss, postgres-sidecar, block-cutover} | grep assertion | `grep -oP '\*\*Decision\*\*:\s*\K\S+' \| sort -u \| diff - <allowlist>` returns empty | ❌ Wave 0 |
| WISE-04 | `WISENET_ENDPOINTS.md` has an `## Auth (collection-level)` section with Type + Header name filled in | grep assertion | `grep -A5 '## Auth (collection-level)' WISENET_ENDPOINTS.md \| grep -E '(Type:\|Header name:)'` returns 2+ lines | ❌ Wave 0 |
| WISE-04 | `WISENET_ENDPOINTS.md` has a base URL value (not `{{baseUrl}}`) | grep assertion | `grep -E 'baseUrl\s*=\s*https?://' WISENET_ENDPOINTS.md` returns ≥ 1 match | ❌ Wave 0 |
| WISE-05 | `.planning/research/fixtures/wisenet/_rate-limit-fingerprint.json` exists with required keys | jq assertion | `jq -e '.first_429_headers and .burst_size and .endpoint' fixtures/wisenet/_rate-limit-fingerprint.json` | ❌ Wave 0 |
| WISE-05 | `.planning/research/fixtures/wisenet/_pagination-fingerprint.json` exists with required keys | jq assertion | `jq -e '.pattern and .request_shape and .response_shape' fixtures/wisenet/_pagination-fingerprint.json` | ❌ Wave 0 |
| WISE-06 | All 4 gap questions answered in writing in WISENET_FIELD_MAP.md | grep assertion | `grep -cE '^###?\s*(Should_Credit\|Admin ownership\|Credit.balance\|Pending.deduction)' WISENET_FIELD_MAP.md` returns 4 | ❌ Wave 0 |
| Secrets | No `WISENET_API_KEY` values leaked into any tracked file | grep + entropy check | `grep -rE '[A-Za-z0-9_-]{24,}' .planning/research/ web/scripts/wisenet-*.ts` | hand-review against known keys | ❌ Wave 0 |
| PII | Fixtures don't contain real email patterns | grep assertion | `grep -rE '[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' .planning/research/fixtures/wisenet/` excludes `@example.test` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Task-specific grep subset (e.g. "just assert the field map row count" for the matrix-writing task)
- **Per wave merge:** Full `validate-phase1.sh` script — all assertions green
- **Phase gate:** Full suite green + Kevin operator sign-off on the matrix content (qualitative review beyond what grep can check) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `.planning/phases/01-wisenet-discovery/validate-phase1.sh` — validation script with all 12 assertions above
- [ ] `.planning/research/fixtures/wisenet/.gitkeep` — directory exists for probes to write into
- [ ] `.planning/research/fixtures/wisenet/_errors/.gitkeep` — error fixture subfolder
- [ ] `web/scripts/README-wisenet-probes.md` — Phase 1 provenance note (required by D-16 discretion rec-leave-in-place)
- [ ] `web/.env.example` updated with `WISENET_*` placeholders — documentation-only, no real values
- [ ] No framework install needed — `tsx` (^4.20.3), `zod` (^3.23) already in `web/package.json`; bash/jq assumed present on macOS (Kevin's dev machine)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `tsx` (npm) | All probe scripts + parser | ✓ | 4.20.3 (per package.json) | — |
| `zod` (npm) | Optional field-shape validator | ✓ | 3.23.x in STACK.md rec; latest 4.3.6 on npm [VERIFIED: npm view] | If latest 4.x breaks existing test types, pin to 3.23.x |
| `node` runtime | tsx | ✓ (assumed — Kevin's dev machine) | `@types/node` ^22 → Node 22+ expected | — |
| `jq` CLI | Validation shell script assertions | ✓ on macOS (assumed default) | — | Write node-based assertion fallback if missing |
| `bash` 4+ | Validation shell script | ⚠️ | macOS default is bash 3.2 | Use `/bin/sh` + POSIX constructs, or add `brew install bash` to README |
| Wisenet Postman export (`wisenet-postman.json`) | Parser script | ✗ (human provides per D-01) | — | Kevin exports before Phase 1 starts; blocker otherwise |
| `WISENET_*` env vars | All probe scripts | ✗ (human provides per D-01) | — | Kevin populates `web/.env` before probe runs; blocker otherwise |
| Wisenet API access (network) | All probe scripts | ⚠️ (depends on IP allowlist, if any) | — | If vendor IP-allowlists, probes fail with network error; document as blocker in handoff |

**Missing dependencies with no fallback:**
- Postman collection export (human-provided)
- Wisenet API credentials (human-provided)

**Missing dependencies with fallback:**
- `bash` 4+ → use POSIX-compatible `sh` syntax in `validate-phase1.sh`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Kevin's Wisenet API is IAE-variant (namespace-scoped), not legacy Basic-auth | `## Wisenet API — What We Know From External Sources` | Rate-limit probe may be too aggressive (if legacy 1000/24h applies); auth probe tries wrong header shape first |
| A2 | `x-api-key` header name is correct for IAE variant | `## Postman Collection Parsing Strategy`, `## Common Pitfalls 4` | Probe gets 401 — expected, handled by halting and re-reading Postman; not catastrophic |
| A3 | Max 1000 records per list response (legacy-API take ceiling) applies to IAE too | `## Pagination Pattern Detection` | Overly conservative pagination default — performance but not correctness impact |
| A4 | Wisenet responses are JSON (not XML) for IAE variant | `## Postman Collection Parsing Strategy` | If XML, Zod schemas from Phase 2 need XML adapter; probe fixtures need content-type check |
| A5 | Bash 4+ features NOT used in validation script (macOS compatibility) | `## Validation Architecture` | Kevin's machine may have bash 3.2; mitigation documented |
| A6 | Probe scripts can be kept in `web/scripts/` indefinitely without causing Phase 2 confusion | `## Probe Script Patterns`, D-16 discretion | Low — scripts have a README pointing at Phase 1 provenance |
| A7 | Postman variable values that look like secrets (length ≥ 16, alphanumeric) are actually secrets | `## Common Pitfalls 1` | False positive = a legitimate long URL parameter gets symbolized — minor inconvenience; false negative = secret leaks — caught by the grep check before write |
| A8 | Redacting student names/emails/DOBs from fixtures preserves enough shape for Phase 2 mapper tests | `## Common Pitfalls 2` | Phase 2 discovers a mapper test needs real-name-shape data — can be regenerated on-demand from a separate gitignored fixture dir |
| A9 | Kevin's off-hours AEST window (per D-10) is truly low-traffic enough that a 200-burst + rate-limit probe doesn't impact operators | `## Rate-Limit Fingerprinting Approach` | Low — if an operator opens the dashboard during the probe window, they may see a brief rate-limit error; acceptable per D-09 "accepted vendor-visibility risk" |

**Confirmation needed before probes run:** A1, A2, A4 — all three are settled by the Postman parse step, which runs BEFORE any probe fires.

## Open Questions (resolved empirically by Plan 03 probes)

1. **Does Kevin's IAE variant require the OAuth authorization-code dance, or is the API key + x-api-key alone sufficient for read-only GETs?**
   - What we know: Public docs describe OAuth → Bearer + API key, but Kevin has `WISENET_API_KEY` only (no client_secret, no redirect_uri mentioned in CONTEXT.md)
   - What's unclear: Whether the Postman collection uses Bearer (requires OAuth dance) or API key alone (simpler)
   - Recommendation: Postman parse reveals this first; `wisenet-probe-auth.ts` confirms. If OAuth is needed, Phase 1 still completes (probe scripts can do the OAuth dance once, cache the token in memory, then probe) — flag for Phase 2 WCLI-01 as a client-design input.
   - **RESOLVED-BY:** Plan 03 Task 2 (auth probe) confirms which variant works. Exit code 0 + `_auth-fingerprint.json` fixture records the confirmed auth header set; exit code 2 halts the plan with CHECKPOINT REACHED for Kevin diagnosis.

2. **Is there a single Wisenet endpoint that returns the full "dashboard fields" shape, or do we need to fan out to multiple endpoints per student?**
   - What we know: Legacy API has separate student / enrolment / attendance endpoints; IAE likely same shape
   - What's unclear: Whether there's a `/students/{id}/balance` or similar that bundles credit fields, or whether we derive from session history per D-07
   - Recommendation: Endpoint catalogue reveals this; field map confirms per-field.
   - **RESOLVED-BY:** Plan 03 Task 5 (field-shape probe) empirically captures one fixture per resource and records in `_field_paths_candidates` which expected field paths were FOUND vs NOT FOUND. Plan 04 Task 1 reads these fixtures and classifies GREEN/YELLOW/RED per-field.

3. **Does Wisenet's IAE variant have a webhook / events endpoint?**
   - What we know: Public docs don't explicitly mention webhooks for IAE
   - What's unclear: Whether Kevin's Postman collection has webhook subscription endpoints
   - Recommendation: Catalogue logs them if present; Opportunities section (D-16) flags "webhook subscription may enable v2 OPS-01 real-time invalidation."
   - **DEFERRED:** If the Postman parse (Plan 02) surfaces webhook endpoints, Plan 04 Task 1 records them in the `## Opportunities (NOT this milestone)` section with mapping to v2 `OPS-01`. Not a v1 blocker either way.

4. **Does the Wisenet trainer/coordinator field on enrolments match BeGifted's admin-ownership semantics, even though D-06 says we're ignoring it?**
   - What we know: D-06 decided Postgres sidecar regardless
   - What's unclear: Whether Wisenet's trainer field is close enough that a future v2 feature (v2 `RPT-03`) could swap to it
   - Recommendation: Opportunities section captures this if probe confirms a plausible mapping.
   - **DEFERRED:** Plan 04 Task 1 captures this in `## Opportunities (NOT this milestone)` (Opportunity 5). Per D-06 we use the Postgres sidecar in v1 regardless; the Wisenet trainer field is documented for potential v2 `RPT-03` but not used in v1.

5. **For the 1000-record-per-page ceiling: does BeGifted's student count exceed 1000?**
   - What we know: PROJECT.md mentions "~500 students" ballpark; research/ARCHITECTURE.md scaling table mentions "20 admins, ~3K students" as a future-tier concern
   - What's unclear: Current active-student count
   - Recommendation: Baseline pagination probe records the `total` / `SetCount` value — Phase 2 sizes client pagination accordingly.
   - **RESOLVED-BY:** Plan 03 Task 3 (pagination probe) records the `total` / `SetCount` field value from the baseline request in `_pagination-fingerprint.json`. Phase 2 sizes client pagination accordingly.

## Standard Stack (for Phase 1 probe scripts only — Phase 2 uses STACK.md)

### Core (already installed in `web/`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tsx` | 4.21.0 latest [VERIFIED: npm view tsx] / ^4.20.3 in package.json | Run the probe + parser scripts | Same runner as `compare-live.ts`, `ensure-action-sheets.ts`, `ensure-inactive-sheet.ts` — zero onboarding cost |
| `typescript` | ^5.9.3 | Type the parser + probe scripts | Already strict-mode; no config change |

### Optional for Phase 1

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 4.3.6 latest [VERIFIED: npm view zod] / ^3.23 per STACK.md | Validate probe response shapes early | Only if a probe needs to confirm "fixture matches an expected shape before we emit the field-map row" — can be deferred to Phase 2 |

**Installation:** No new dependencies for Phase 1 (all probe needs are in the existing `web/package.json`). Phase 2 adds `zod`, `@neondatabase/serverless`, `drizzle-orm`, `drizzle-kit`, `@vercel/functions` per STACK.md.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsx script for Postman parse | `jq` one-liner | jq is faster but Postman's recursive item tree needs a real lexer — tsx is cleaner and matches probe scripts |
| Real HTTP probes | HAR file import from Postman | Postman "Run" can emit a HAR file Kevin exports; parser could read those. Skipped because live probes are needed for rate-limit fingerprinting anyway |
| In-memory fixtures | File-based fixtures (`.planning/research/fixtures/wisenet/*.json`) | File-based per D-04 — enables PR review of the evidence, not just the conclusions |

## Architecture Patterns (for probe-script design)

### Pattern: One-shot read-only probe

**What:** Each probe script does one concern, writes one fixture, exits. No state, no daemon, no persistence beyond the fixture file.

**When to use:** Phase 1 discovery probes — the opposite of Phase 2's reusable client library (WCLI-01).

**Trade-offs:**
- Pro: Easy to audit, easy to delete/archive, easy to rerun
- Pro: Per-script failure doesn't block other probes
- Con: Shared helpers (like `redactHeaders`) get copy-pasted across 4-5 scripts

**Acceptable copy-paste:** For the 4-5 probe scripts in Phase 1, duplicating a 20-line `redactHeaders` + `required()` + fixture-path resolver is cheaper than extracting a shared module Phase 2 then has to decide whether to keep.

### Pattern: Fixture-as-evidence

**What:** Every claim in WISENET_FIELD_MAP.md cites a fixture file; every fixture file is committed to git (after redaction); fixtures become Phase 2's test inputs verbatim.

**When to use:** Any research phase whose output must be reproducible and challengeable.

**Trade-offs:**
- Pro: Reviewers can verify claims without re-running probes
- Pro: Phase 2 test suite is pre-seeded — no fresh fixture capture during Phase 2
- Con: Fixtures may drift from Wisenet reality between Phase 1 and Phase 2 (days/weeks). Mitigation: Phase 2 WCLI-01 can re-run probes and compare to verify nothing changed.

### Anti-Patterns to Avoid

- **Anti-pattern: Writing `lib/wisenet/client.ts` during Phase 1 "because the probes would use it."** That's WCLI-01, belongs in Phase 2. Phase 1 probes inline their fetch calls.
- **Anti-pattern: Porting Validation.gs assertions to verify field map correctness.** That's TEST-01, Phase 2. Phase 1 uses grep assertions over markdown only.
- **Anti-pattern: Provisioning Neon Postgres "because D-06 needs a sidecar table."** That's DB-01, Phase 2. Phase 1 documents the schema decision in WISENET_FIELD_MAP.md, not via migration.
- **Anti-pattern: Guessing at Wisenet field names when probe data is missing.** Every field must either have fixture evidence or be RED. "I think Wisenet calls this `student_code`" is not acceptable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Postman v2.1 parsing | Custom `JSON.parse` + recursive walker | `JSON.parse` + a plain typed walker (no library needed for this shape) | tsx + typed interfaces are sufficient; a `postman-collection` npm library would be overkill for a one-shot parse |
| Rate-limit header parsing | Your own regex over header strings | Direct `res.headers.get("retry-after")` etc. | Node 22+ `fetch` normalizes headers; no library needed |
| Shell assertions | Your own awk/sed pipelines for matrix integrity | POSIX `grep` + `awk -F'|'` | Portable, readable in PR review |
| Secret detection in fixtures | Custom entropy check | Length-plus-charset heuristic (length ≥ 16, `[A-Za-z0-9_-]`) plus `git-leaks`-style regex | Good-enough for Phase 1; gitleaks CI (pitfall 8 future work) catches what this misses |

**Key insight:** Phase 1 is a one-shot research phase. The tools are deliberately minimal — the long-term libraries live in Phase 2 (Zod, Drizzle, Neon client). Any library added in Phase 1 is library-debt that Phase 2 may have to remove.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Wisenet Basic-auth legacy API | Wisenet IAE OAuth + API key | Rollout circa 2024-2025 (IAE docs live as of 2026-04-21) | Auth probe must try IAE first; legacy-variant fallback only if Kevin's creds look Basic-auth-shaped |
| Hand-rolled rate-limit backoff | `p-limit` + `Retry-After` aware wrapper (Phase 2 WCLI-01) | Not a Phase 1 concern | Phase 1 probe records the shape; Phase 2 implements |
| Postman SPA scraping | Postman JSON export (D-01) | Kevin provides the collection in a parseable form | Unblocks what FEATURES.md couldn't do |

**Deprecated/outdated:**
- **FEATURES.md Wisenet rows:** LOW-confidence hypothesis rows from 2026-04-20. Phase 1 REPLACES these with verified rows; FEATURES.md's Wisenet section becomes historical reference only.

## Sources

### Primary (HIGH confidence)
- `web/src/lib/dashboard/config.ts:64-102` — `REQUIRED_COLUMNS` canonical list (25 fields)
- `web/src/types/dashboard.ts:1-250` — downstream payload shapes
- `web/src/lib/dashboard/packages.ts:31-359` — consumer modules
- `web/src/lib/sheets/source-loader.ts:23-122` — current read-layer shape (Phase 2 mirrors)
- `web/scripts/compare-live.ts:1-268` — canonical tsx probe pattern
- `web/src/lib/runtime/env.ts:1-45` — env-var reader pattern
- `.planning/phases/01-wisenet-discovery/01-CONTEXT.md` — D-01..D-16 locked decisions
- [Postman Collection Format v2.1 Schema Documentation](https://schema.postman.com/collection/json/v2.1.0/draft-07/docs/index.html) — schema definition
- [Wisenet OAuth Docs](https://api-docs.wisenet.co/iae/oauth/index.html?v=1) — IAE auth flow confirmation
- [Wisenet OLD API Developer Resources](https://learn.wisenet.co/old-api-developer-resources/) — legacy API auth, pagination, rate-limit facts
- [Wisenet OLD API Students Endpoint](https://learn.wisenet.co/old-api-endpoints-students/) — endpoint shape reference
- [IETF RateLimit Headers Draft](https://www.ietf.org/archive/id/draft-polli-ratelimit-headers-02.html) — standard header names to probe for

### Secondary (MEDIUM confidence)
- [Wisenet API Resources](https://learn.wisenet.co/api/) — cross-verified with IAE docs
- [REST API Pagination patterns overview (Stainless)](https://www.stainless.com/sdk-api-best-practices/how-to-implement-rest-api-pagination-offset-cursor-keyset) — pattern enumeration
- [Embedded Gusto Blog — Offset vs Cursor Pagination](https://embedded.gusto.com/blog/api-pagination/) — detection approaches
- `.planning/research/FEATURES.md` — Research Blocker section (what Phase 1 replaces)
- `.planning/research/STACK.md` — Wisenet client shape (what Phase 1 probes against)
- `.planning/research/PITFALLS.md` — Pitfalls 1 (field gap), 2 (type coercion), 8 (secret leak), 10 (rate-limit surprise)
- `.planning/research/ARCHITECTURE.md` — Facade pattern, Open Questions for Phase 0

### Tertiary (LOW confidence — flagged for probe verification)
- Wisenet IAE variant's use of `WISENET_USER_ID` + `WISENET_CENTER_ID` (none of the public docs explain this; Postman parse confirms)
- Whether Kevin's API surface is truly IAE or a third variant
- The 1,000/24h rate-limit ceiling applicability to IAE (legacy-documented only)
- npm version confirmation (tsx 4.21.0 per `npm view`; zod 4.3.6 per `npm view`) — latest may break existing lockfile, confirm with `npm install --dry-run` at implementation time

## Metadata

**Confidence breakdown:**
- Canonical REQUIRED_COLUMNS inventory: HIGH — read directly from code
- Postman v2.1 parsing strategy: HIGH — official schema cited
- Probe script patterns: HIGH — modeled against `compare-live.ts` which exists and works
- Wisenet auth/pagination/rate-limit specifics for Kevin's API: LOW — Postman parse + probe is the HIGH-to-MEDIUM upgrade path Phase 1 owns
- RED-row decision heuristics: HIGH — derived from D-05..D-08 pre-answers
- Validation architecture: MEDIUM — grep-assertion approach is standard, but macOS bash 3.2 compatibility needs testing

**Research date:** 2026-04-21
**Valid until:** 2026-05-05 (14 days) — Wisenet API is vendor-controlled, can change; Postman collection Kevin exports is the volatile input
