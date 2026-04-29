---
phase: 01-wisenet-discovery
plan: 02
subsystem: research
tags: [wisenet, postman, parser, tsx, catalogue, deterministic-output, secret-redaction, phase-1]

# Dependency graph
requires:
  - 01-01-PLAN (validator + fixture scaffolding)
  - .planning/research/wisenet-postman.json (Kevin's manual Postman export, pre-resolved)
provides:
  - "`.planning/research/WISENET_ENDPOINTS.md` — deterministic catalogue of 120 endpoints across 21 folders"
  - "Collection-level auth verified: HTTP Basic (username={{user_id}}, password={{api_key}})"
  - "Resolved base URL https://api.wiseapp.live from web/.env WISENET_BASE_URL"
  - "Reusable Postman v2.1 parser at web/scripts/wisenet-postman-parse.ts (re-run after re-export)"
  - "Answers to RESEARCH.md Open Questions #1-3 (auth header, base URL, collection-level vs per-request auth shape)"
affects: [01-03-PLAN, 01-04-PLAN, 01-05-PLAN, 02-WCLI-01]

# Tech tracking
tech-stack:
  added:
    - Postman v2.1 collection JSON parsing via inline TypeScript types (no schema library)
    - tsx one-shot script pattern for Postman parsing (reusable after re-exports)
    - Shape-aware secret-redaction heuristic (digit/underscore/dash/hex test) distinguishing secrets from camelCase API identifiers
  patterns:
    - Parser reads local-only gitignored JSON, emits redacted committed markdown (defense-in-depth against Postman variable-default secret leakage)
    - Input mtime used as "Parsed at" timestamp for deterministic byte-identical output across re-runs
    - Symbolic preservation of `{{api_key}}`, `{{user_id}}` via name-pattern + entropy heuristics
    - Inline MongoDB ObjectId (24-char lowercase hex) substitution to `{{INLINE_ID}}` so path shape is preserved without emitting hex identifiers

key-files:
  created:
    - web/scripts/wisenet-postman-parse.ts
    - .planning/research/WISENET_ENDPOINTS.md
  modified:
    - .planning/phases/01-wisenet-discovery/validate-phase1.sh (Rule 3 fix — awk range bug in assert_endpoints_has_auth_section)

key-decisions:
  - "Collection auth is HTTP Basic (username={{user_id}}, password={{api_key}}) — feeds WISE-04. Per-request headers also include `x-api-key` and `x-wise-namespace` for redundant auth surfaces"
  - "Base URL resolves from web/.env `WISENET_BASE_URL` to `https://api.wiseapp.live` — flows into Phase 2 `getWisenetEnv()` as WISE-04 evidence"
  - "Redaction heuristic refined beyond plan's literal `[A-Za-z0-9_-]{24,}` regex: secrets require digits OR underscore/dash OR sk_/pk_/Bearer prefix OR all-lowercase-hex. Long camelCase English identifiers (e.g. `showSequentialLearningDisabledSections`) pass through as legitimate API parameter names"
  - "Inline hex ObjectIds embedded in Postman paths (e.g. `66793e38fa9c2a40d81d259a` in `/institutes/.../demoRooms/sessions`) substituted to `{{INLINE_ID}}` — keeps path shape visible without leaking identifier material"
  - "Source-mtime used as `**Parsed at:**` timestamp (not `new Date()`) so re-runs produce byte-identical output — verified via diff"
  - "Query strings stripped from Path column (query params listed separately in Query params column) — prevents long query-param names from colliding with entropy-guard false positives AND produces cleaner diffs"

patterns-established:
  - "parser: reads input via `readFileSync(.planning/research/wisenet-postman.json)` (local-only, gitignored), resolves scaffolding vars from `web/.env`, emits redacted markdown to `.planning/research/WISENET_ENDPOINTS.md` (committed). Input never enters git; output never contains secrets."
  - "Shape-aware secret detection: `looksSecretShaped()` considers digits, underscores/dashes, known prefixes, and hex. Applied inside `redactOutput` as fail-closed guard before `writeFileSync`."
  - "Deterministic output ordering: sort by folder, then by method+path within folder. Re-running is byte-identical."
  - "`{{INLINE_ID}}` substitution for 24-char hex IDs in paths so Phase 2 readers see path shape without ambiguous hard-coded sample IDs."

requirements-completed:
  - WISE-04  # auth scheme documented from Postman

# Metrics
duration: ~8min
completed: 2026-04-21
---

# Phase 01 Plan 02: Wisenet Endpoint Catalogue Summary

**Postman v2.1 collection parsed deterministically into a 120-endpoint catalogue at `.planning/research/WISENET_ENDPOINTS.md`, with HTTP Basic auth (username={{user_id}}, password={{api_key}}) + `x-api-key` + `x-wise-namespace` header stack confirmed, base URL resolved to `https://api.wiseapp.live`, and secret-bearing variables preserved symbolically via a shape-aware redaction heuristic.**

## Parser Invocation

```bash
cd /Users/kevinhsieh/Desktop/Credit\ Control/Begifted-Ops
./web/node_modules/.bin/tsx web/scripts/wisenet-postman-parse.ts
```

Expected output:

```
Wrote 120 endpoints to .../\.planning/research/WISENET_ENDPOINTS.md
Top-level folders (21): (root), Admins In your Institute, Agendas for Lens, ...
```

Re-run any time Kevin re-exports the Postman collection. Output is byte-identical until the source JSON mtime changes.

## Catalogue Metrics

- **Total endpoints:** 120
- **Endpoints with example responses:** 84
- **Unique HTTP methods:** DELETE, GET, POST, PUT
- **Top-level folders:** 21

### Endpoint Counts by Folder

| # | Folder | Endpoints |
|---|--------|-----------|
| 1 | (root) | 2 |
| 2 | Admins In your Institute | 2 |
| 3 | Agendas for Lens | 4 |
| 4 | Assessments in your course | 4 |
| 5 | Chats | 5 |
| 6 | Consultations | 4 |
| 7 | Courses In your Institute | 12 |
| 8 | Creating Users | 6 |
| 9 | Discussions in your course | 5 |
| 10 | Get Account Information | 2 |
| 11 | Lens Sessions | 5 |
| 12 | Manage Course Content | 2 |
| 13 | Manage Fees | 10 |
| 14 | Manage Institutes | 2 |
| 15 | Manage Live Sessions | 10 |
| 16 | Manage Student Credits | 3 |
| 17 | Managing Webinars | 1 |
| 18 | Resources in your course | 3 |
| 19 | Students In your Institute | 14 |
| 20 | Teachers In your Institute | 6 |
| 21 | Tests in your course (incl. nested) | ~18 |

(Exact per-folder counts are visible in the `## Endpoints` tables of `WISENET_ENDPOINTS.md`. The Postman export also has 3 empty-body folders — Polls, Student Reports, Student Registration Data — that contained no requests; those drop out of the catalogue since there is nothing to enumerate.)

## Answers to RESEARCH.md Open Questions + H1-H5

| # | Question | Answer from Postman parse |
|---|----------|---------------------------|
| **#1** | **What is the Wisenet base URL?** | `https://api.wiseapp.live` (resolved from `web/.env WISENET_BASE_URL`; the Postman collection uses `{{host}}` placeholder) |
| **#2 / H1** | **What is the auth header name?** | Collection-level: HTTP Basic (`Authorization: Basic <base64(user_id:api_key)>`). Per-request headers ALSO present: `x-api-key`, `x-wise-namespace`. Both the Basic header AND `x-api-key` appear across the collection — Phase 2 WCLI-01 should send **both** until probes prove one is sufficient. |
| **#2 / H2** | **Does centre/tenant ID go in a header?** | **PARTIAL — no `x-centre-id` header observed in the collection.** Centre/tenant identity appears as path params instead: `/institutes/{{institute_id}}/...`, `/centres/{{centre_id}}/...` in several endpoints. The Postman collection uses `{{institute_id}}` as the canonical multi-tenant discriminator. Phase 2 WCLI-01: tenant ID is a path variable, NOT a header. |
| **#3** | **Pagination pattern?** | Postman shows `page_number`, `page_size` query params on list endpoints (e.g. `/institutes/.../demoRooms/sessions?status=FUTURE&page_number=1&page_size=50`). Phase 1 Plan 04 probes will confirm the response shape (`hasNext`, `totalCount`, etc.). |
| **H3** | **Is namespace a header?** | **YES — confirmed.** `x-wise-namespace` header present across endpoints. Value comes from `web/.env WISENET_NAMESPACE` (resolves to the tenant slug Kevin configured). |
| **H4** | **Is User ID the credential?** | **YES.** Collection-level HTTP Basic uses `username={{user_id}} / password={{api_key}}` — the User ID is the Basic-auth username, the API key is the Basic-auth password. This is redundant with the `x-api-key` header; Phase 2 WCLI-01 should adopt both until a probe proves one alone is sufficient. |
| **H5** | **Rate-limit headers visible in examples?** | **Deferred to Phase 1 Plan 04** — Postman captures response **bodies** but not headers in most examples. The rate-limit fingerprint probe (Plan 04) will capture `Retry-After` / `X-RateLimit-*` from live responses during the ~200-GET burst. |

## Observed Auth Header Stack (per-request)

From `## Auth (collection-level)` section of the catalogue:

- `Authorization` — HTTP Basic base64-encoded `user_id:api_key`
- `x-api-key` — alternate/redundant api key header, value `{{api_key}}`
- `x-wise-namespace` — tenant-slug header, value `{{namespace}}`

Phase 2 WCLI-01 client should construct all three headers.

## Raw Postman JSON Stayed Local

```bash
$ git check-ignore -v .planning/research/wisenet-postman.json
.gitignore:5:.planning/research/wisenet-postman.json    .planning/research/wisenet-postman.json

$ git status --short | grep wisenet-postman\.json
(empty)
```

The 784K raw JSON was never staged. Only the 260-line redacted markdown catalogue entered the repo.

## Deviations from Plan

### Pre-resolved Checkpoints (documented per prompt)

**1. Task 1 checkpoint pre-resolved**
- **Status:** Skipped as instructed in the prompt. The `.gitignore` entry for `wisenet-postman.json` was already at `.gitignore:5` (added during Plan 01-01 or earlier work). Kevin's Postman export was already at `.planning/research/wisenet-postman.json` (784K, valid v2.1 JSON, 102 request items across 23 folders — the 3 zero-request folders drop out during walk). All Task 1 acceptance criteria verified (`test -f`, `jq empty`, `git check-ignore -q`) — no new work needed.
- **Note on automated keyword-entropy guard:** The raw JSON triggers the Task-1-step-3 defense-in-depth guard (contains `api-key: 7fc0f2a1bcb0295e1ca466a279adaad...` in request.description text and an ObjectId `66793e38fa9c2a40d81d259a` in `item.18.item.*.request.description`). These are in description text, not structural fields the parser emits. The gitignore prevents commit risk; the parser's `redactOutput` prevents emission risk. Both defenses held.

### Rule 3 — Auto-fixed Blocking Issues

**2. [Rule 3 - Blocking] Fixed validate-phase1.sh awk range bug**
- **Found during:** Task 2 verification
- **Issue:** `assert_endpoints_has_auth_section` used `awk '/^## Auth/,/^## [A-Z]/'` to slice the auth section. The `^## [A-Z]` end pattern ALSO matches `## Auth (collection-level)` itself (both `^## ` and uppercase `A`). POSIX awk closes the range on the same line when start and end match, so the slice captured only the heading line — `Type:` and `Header name:` content was never scanned. Validator FAILed even though the correct content was present.
- **Fix:** Replaced the range with a flag-based scanner: `/^## Auth/ { in_auth = 1; next } in_auth && /^## / { exit } in_auth { print }`. Captures everything between the Auth heading and the NEXT `## ` heading.
- **Files modified:** `.planning/phases/01-wisenet-discovery/validate-phase1.sh` (one function edited)
- **Commit:** `b467495`
- **Scope note:** This file is not in Plan 01-02's `files_modified`; it was produced by Plan 01-01. The bug was blocking 01-02's `endpoints_has_auth_section` check from ever passing regardless of catalogue content, so fixing it under Rule 3 (blocking issues) was the only path forward. Plan 01-01 was already closed; the fix is documented here rather than re-opened there.

### Rule 1 — Auto-fixed Bugs

**3. [Rule 1 - Bug] Refined plan's entropy regex to handle real Wisenet data**
- **Found during:** Task 2 initial parser run
- **Issue:** The plan's literal acceptance-criterion `grep -E "[A-Za-z0-9_-]{24,}" .planning/research/WISENET_ENDPOINTS.md` returns empty expects **zero** 24+ char alphanumeric runs. The real Wisenet Postman collection contains legitimate camelCase API parameter names ≥24 chars: `checkSessionsAvailability` (path segment), `populateSessionAttendees`, `showRegistrationFormSubmission`, `showSequentialLearningDisabledSections` (query param keys). These are not secrets; they are the actual API contract surface Phase 2's `lib/wisenet/endpoints.ts` must reference. A naive implementation would have had to choose between (a) breaking the catalogue's purpose by dropping them, or (b) failing the plan's acceptance test.
- **Fix:** `redactOutput` uses a shape-aware `looksSecretShaped()` helper. A 24+ char token is secret-shaped only if it has at least one of: digits, underscores/dashes, `sk_`/`pk_` prefix, or all-lowercase hex. Long camelCase English identifiers (letters only, mixed case, no digits, no `_`/`-`) pass through. Actual secrets (ObjectIds `66793e38fa9c2a40d81d259a`, tokens `7fc0f2a1bcb0295e1ca466a279adaadb`, Bearer/sk_/pk_ prefixes) still fail closed.
- **Files modified:** `web/scripts/wisenet-postman-parse.ts` (refined `redactOutput`, added `looksSecretShaped`)

**4. [Rule 1 - Bug] Fixed non-determinism in output timestamp**
- **Found during:** Plan-spec determinism check (`diff` of two consecutive runs)
- **Issue:** `new Date().toISOString()` produced a different `**Parsed at:**` line on each run, so `diff` returned 1 non-matching line (the timestamp). The plan's acceptance criterion requires byte-identical output on re-run.
- **Fix:** Use the input Postman JSON's mtime (via `statSync(POSTMAN_JSON_PATH).mtime.toISOString()`) as the timestamp. Stable until Kevin re-exports. `diff` now returns empty.
- **Files modified:** `web/scripts/wisenet-postman-parse.ts` (added `statSync` import, replaced `new Date()` call, threaded mtime arg through `emitMarkdown`)

**5. [Rule 1 - Bug] Strip query strings from Path column; substitute inline hex IDs**
- **Found during:** Task 2 initial parser run (entropy guard false-positives on camelCase query-param names in URLs)
- **Issue:** Emitting full URLs with query strings in the Path column (e.g. `/sessions?status=FUTURE&page_number=1&populateSessionAttendees=true`) mingled long English param names into the path text, which triggered the plan's literal entropy regex. Separately, some Postman endpoint authors embedded real MongoDB ObjectIds directly in paths (e.g. `/institutes/66793e38fa9c2a40d81d259a/demoRooms/sessions`) instead of using `{{institute_id}}` placeholders.
- **Fix:** `resolveUrl` now (a) drops the query string from the Path column — query keys already surface in the separate Query params column, and (b) substitutes any 24+ char lowercase-hex run with `{{INLINE_ID}}`. Preserves path shape for Phase 2 readers without emitting hex identifiers.
- **Files modified:** `web/scripts/wisenet-postman-parse.ts` (`resolveUrl` refined)

### Rule 2 — Auto-added Critical Functionality

**6. [Rule 2 - Security] Added `SECRET_VAR_NAME_PATTERN` for name-based preservation**
- **Reason:** The plan's `isSecretLike` catches secret *values* by shape, but cannot catch secrets declared as Postman variables with non-shape-suspicious defaults (e.g. a short `{{api_key}}` value like `"abc"` is not entropy-flagged but the NAME `api_key` is a strong signal it should be preserved symbolically regardless of value). Defense-in-depth alongside shape-based detection.
- **What:** `SECRET_VAR_NAME_PATTERN` regex (matches `api_key`, `apikey`, `user_id`, `userid`, `secret`, `token`, `bearer`, `password`, `client_secret`, `auth`). Checked by name in `buildVariableMap`; such keys always map to `PRESERVE_SENTINEL` regardless of value.
- **Files modified:** `web/scripts/wisenet-postman-parse.ts` (added `SECRET_VAR_NAME_PATTERN` constant + `isSecretVarName` helper)

## Self-Check: PASSED

**Files verified on disk:**
- `FOUND: web/scripts/wisenet-postman-parse.ts`
- `FOUND: .planning/research/WISENET_ENDPOINTS.md` (260 lines, 120 endpoint rows)
- `FOUND: .planning/phases/01-wisenet-discovery/validate-phase1.sh` (modified)

**Commits verified:**
- `FOUND: b467495` — feat(01-02): parse Wisenet Postman collection into endpoint catalogue

**Validator status:**
- `bash .planning/phases/01-wisenet-discovery/validate-phase1.sh --quick` → 4 passed, 0 failed, 11 skipped (expected — downstream Wave-2/3 target files not yet created)
- `assert_endpoints_exists` → OK
- `assert_endpoints_has_auth_section` → OK
- `assert_endpoints_has_base_url` → OK
- `assert_fixtures_no_real_emails` → OK

**Determinism check:**
- `tsx wisenet-postman-parse.ts && cp ENDPOINTS.md /tmp/run1 && tsx wisenet-postman-parse.ts && cp ENDPOINTS.md /tmp/run2 && diff /tmp/run1 /tmp/run2` → empty (byte-identical)

**Secret containment:**
- `git check-ignore -q .planning/research/wisenet-postman.json` → exits 0 (ignored)
- `git diff --cached --name-only | grep wisenet-postman\.json` → empty (not staged)
- Committed markdown 24+ char alphanumeric tokens (4 unique): `checkSessionsAvailability`, `populateSessionAttendees`, `showRegistrationFormSubmission`, `showSequentialLearningDisabledSections` — all legitimate camelCase API identifiers, zero secrets.
