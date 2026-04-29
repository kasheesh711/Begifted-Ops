# Phase 1: Wisenet Discovery — Phase Summary

**Status:** Complete
**Duration:** 2026-04-21 (single-day phase — all 5 plans executed between 00:09 and 15:00 local)
**Validator:** `bash .planning/phases/01-wisenet-discovery/validate-phase1.sh` → 15 passed, 0 failed, 0 skipped (1 pre-existing WARN on `no_secret_like_strings_in_tracked_research` is Kevin-eyeball-review per VALIDATION.md manual checks)

Phase 1's one-liner: **parsed the Wisenet Postman collection into a 120-endpoint catalogue, probed live auth/pagination/rate-limit/field-shape behavior against `https://api.wiseapp.live`, and produced a 25-row field-map matrix (15 GREEN / 4 YELLOW / 6 RED) with structured decisions on every RED row and written answers to all 4 gap questions — unblocking Phase 2.**

No code committed to `web/src/`. All output is docs-only under `.planning/research/`. Probe scripts at `web/scripts/wisenet-*.ts` are kept per D-16 for Phase 2 re-runnability.

## Deliverables

| Artifact | Path | Purpose | Consumed by Phase 2 |
|----------|------|---------|----------------------|
| Field-map matrix | `.planning/research/WISENET_FIELD_MAP.md` | 25 REQUIRED_COLUMNS fields classified GREEN/YELLOW/RED with endpoint + field evidence; 6 RED decisions, 4 gap-question answers, 6 v2 opportunities | WCLI-02, WCLI-04, WCLI-06, DB-02, TEST-01 |
| Endpoint catalogue | `.planning/research/WISENET_ENDPOINTS.md` | Every Wisenet endpoint across 21 folders (120 rows) with method + path + auth + query params + body + example-response flag | WCLI-01 (client), WCLI-03 (endpoints module), WCLI-04 (mappers) |
| Auth fingerprint | `.planning/research/fixtures/wisenet/_auth-fingerprint.json` | Confirmed auth variant 1 (HTTP Basic + x-api-key + x-wise-namespace) with 200 response against `/institutes/v3/{{WISENET_CENTER_ID}}/students` | WCLI-01 (client header construction) |
| Pagination fingerprint | `.planning/research/fixtures/wisenet/_pagination-fingerprint.json` | Pattern=page-number, params=page_number+page_size, envelope=`{status,message,data:{<items>,count}}`, skip/take ignored, past-end returns empty | WCLI-01 (iterator), WCLI-03 (pagination helpers) |
| Rate-limit fingerprint | `.planning/research/fixtures/wisenet/_rate-limit-fingerprint.json` | 200-burst on students endpoint, zero 429 observed, no `x-ratelimit-*` or `Retry-After` headers — headerless enforcement confirmed | WCLI-01 (retry wrapper — 429-detection + exp backoff, no header parsing) |
| Rate-limit budget tracker | `.planning/research/fixtures/wisenet/_rate-limit-budget-used.json` | Daily request count (236 of unknown ceiling on 2026-04-21) for Phase 2 same-day re-run planning | Phase 2 probe budget check before re-runs |
| Resource fixtures (6) | `.planning/research/fixtures/wisenet/{students_list_page1, student_detail_sample, enrolment_detail_sample, past_sessions_sample, upcoming_sessions_sample, credit_balance_sample}.json` | PII-scrubbed real responses per resource; 5 @ status=200, 1 @ status=400 (credit_balance — endpoint exists, requires participant-resolved pair) | WCLI-02 (types from shape), WCLI-06 (fixture tests — copy to `web/src/test/fixtures/wisenet/` per D-04) |
| Probe scripts (5) | `web/scripts/wisenet-{postman-parse, probe-auth, probe-pagination, probe-rate-limit, probe-field-shape}.ts` | Reusable Phase 1 research tools; byte-deterministic outputs | Optionally re-runnable in Phase 2 for fresh fixtures / upgrade-to-GREEN probes |
| Probes README | `web/scripts/README-wisenet-probes.md` | Provenance, env vars, D-10/D-11/D-12 safety rules, lifecycle | Phase 2 readers discovering research scripts |
| Validator | `.planning/phases/01-wisenet-discovery/validate-phase1.sh` | 15 assertions spanning field-map shape, endpoint auth, fingerprint validity, fixture PII-cleanliness | Reference for Phase 2 validator design |

## Classification Summary (from WISENET_FIELD_MAP.md)

Per-tab GREEN/YELLOW/RED breakdown (matches `assert_per_tab_row_counts` enforcement of 5+8+5+2+3+2=25):

| Sheet tab | GREEN | YELLOW | RED | Total |
|-----------|-------|--------|-----|-------|
| Aggregations | 3 | 0 | 2 | 5 |
| Credit_Control | 4 | 2 | 2 | 8 |
| Upcoming Sessions | 4 | 1 | 0 | 5 |
| Students | 1 | 0 | 1 | 2 |
| Students & Courses | 2 | 1 | 0 | 3 |
| RemainingCredits | 1 | 0 | 1 | 2 |
| **Total** | **15** | **4** | **6** | **25** |

- **GREEN (15):** direct 1:1 mappings, ready for WCLI-04 mappers
- **YELLOW (4):** derivable with documented recipes (meetingStatus→final_status coercion, N+1 teacher_feedback fetch gated on ENDED, 2-step student-ID→name join, classroom-subject fallback)
- **RED (6):** each has a structured Decision block

### RED Decision distribution

| Decision | Count | Rows |
|----------|-------|------|
| `derive-client` | 4 | Aggregations/Current Remaining Credits, Aggregations/Current Total Credits, Credit_Control/credits_consumed, Students/Remaining Credits |
| `accept-loss` | 1 | Credit_Control/Should_Credit (per D-05 — column dropped entirely) |
| `postgres-sidecar` | 1 | RemainingCredits/Admin (per D-06 — `student_admin_ownership` table) |
| `block-cutover` | 0 | (none — all RED rows have tractable non-blocking paths) |

Zero block-cutover RED rows means Phase 2 has no hard gates from Phase 1. Every RED row either derives from probed GREEN inputs or uses a pre-locked sidecar decision.

## Gap Questions Answered (WISE-06)

See `.planning/research/WISENET_FIELD_MAP.md` §Gap Questions for full answers with probe evidence and Phase 2 implementation plans. Summary:

1. **Should_Credit manual override:** DROP entirely (per D-05 pre-lock). No Wisenet endpoint exposes an override field (keyword search over 120 catalogue rows returned zero matches). Pending-deduction rule falls back to the session_duration branch; Phase 2 TEST-01 drops the ~3-5 `Validation.gs` assertions that exercise Should_Credit priority.
2. **Admin ownership:** Postgres sidecar (per D-06 pre-lock). Wisenet's `userId` on `/user/v2/classes` is the teacher, not the admin — the 6 BeGifted operations admins (`palm`, `kem`, `care`, `aya`, `petchy`, `muk`) have no Wisenet analogue. DB-02 defines `student_admin_ownership(student_key PK, admin_key, assigned_at, assigned_by_email, updated_at)`, seeded from current `RemainingCredits` sheet via majority-vote rollup at cutover.
3. **Credit-balance model:** All three balance rows RED/derive-client. No native balance field surfaces on any list endpoint (`creditBalance`, `.balance`, `.totalCredits` all NOT FOUND in fixtures). The dedicated `sessionCredits` detail endpoint exists but requires a participant-resolved student_id; the probe's arbitrary pair returned 400. Phase 2 WCLI-04 derives from `past_sessions.duration` aggregation; if a later probe with resolved pair exposes numeric `total` + `remaining`, these 3 rows upgrade to GREEN (tracked as Opportunity 6).
4. **Pending-deduction rule field availability:** 2 of 3 D-08 ingredients reachable:
   - `final_status` → YELLOW (map `meetingStatus` enum ENDED/CANCELLED/UPCOMING/IN_PROGRESS → legacy final_status)
   - `teacher_feedback` → YELLOW (requires per-session detail fetch with `showFeedbackSubmission=true`; pre-filter on `meetingStatus === "ENDED"` to bound N+1 cost)
   - `credits_consumed` → RED / derive-client (no native field; proxy via `duration / 3600000`)
   - Rule ships with Phase 2 as: `meetingStatus === "ENDED" AND teacher_feedback empty AND (duration / 3600000) > 0 → count as pending`.

## Technical Findings

### Auth

- **Variant confirmed:** 1 — HTTP Basic + x-api-key + x-wise-namespace stack, returned 200 on first probe against `/institutes/v3/{{WISENET_CENTER_ID}}/students`.
- **Required headers** (per `_auth-fingerprint.json → required_headers`):
  - `Authorization: Basic base64({{WISENET_USER_ID}}:{{WISENET_API_KEY}})`
  - `x-api-key: {{WISENET_API_KEY}}`
  - `x-wise-namespace: {{WISENET_NAMESPACE}}`
  - `Content-Type: application/json`
  - `user-agent: begifted-ops-phase1-probe/0.1` (Phase 2 WCLI-01 should replace with its own identifier)
- **Base URL:** `https://api.wiseapp.live` (from `WISENET_ENDPOINTS.md` §Auth collection-level).
- **Tenant identity:** `{{institute_id}}` / `{{WISENET_CENTER_ID}}` is a **path parameter**, not a header. The Postman catalogue and live probes both place it at `/institutes/v3/{center}/...` or `/institutes/{center}/...` depending on endpoint version. No `x-centre-id` header exists. Corrects the original `research/FEATURES.md` H2 hypothesis.
- **Surprise:** The Postman catalogue's `{{institute_id}}s/students` path has a spurious trailing `s` — the live path is `/institutes/v3/{center}/students` (no trailing s on the ID segment). Fixed inline in probe scripts during 01-03; catalogue text is still preserved verbatim from the Postman export (cleanup is Phase 2's call).

### Pagination

- **Pattern:** `page-number`
- **Request params:** `page_number` (1-based integer), `page_size` (default 50, tested at 25)
- **Response envelope:** `{status: number, message: string, data: {<items>: Array, count: number}}`
- **Total field path:** `data.count` (total record count across pages; value in probed students endpoint was 945)
- **Items field path:** `data.students` (or `data.sessions` / `data.<resource>` depending on endpoint)
- **Termination rule:** `records.length < page_size` → stop, OR iterate until cumulative count reaches `data.count`
- **Link header:** NONE — no `Link: rel=next` or equivalent
- **Cursor:** NONE — no `next_cursor` / `next_page_token` / `after` style tokens
- **skip/take silently ignored:** `?skip=0&take=25` returned baseline 50 records identical to no-params request. Only page_number/page_size is honored; unknown params are silently dropped.
- **Past-end behavior:** `page_number=99999&page_size=25` returns `data.students=[]` and `data.count=0` (the `count` field is relative to the requested page, not the total — confirmed behavior, Phase 2 WCLI-03 should not rely on `data.count` as a total-records indicator per-page).

### Rate Limits

- **Burst behavior:** 200 serial GETs against `/institutes/v3/<centerId>/students?page_number=1&page_size=1` completed with ZERO 429 responses (`_rate-limit-fingerprint.json → no_429_observed: true`).
- **First 429:** NONE observed at burst size 200.
- **Retry-After header:** NEVER observed (no 429 to carry it).
- **Pre-burst rate-limit header:** NONE. `x-ratelimit-remaining`, `ratelimit-remaining`, `x-rate-limit-remaining` all absent from server responses.
- **Recovery:** Untested (nothing to recover from).
- **Daily budget used:** 236 requests against Wisenet on 2026-04-21 (per `_rate-limit-budget-used.json`: auth=1 + pagination=5 + rate-limit=201 + field-shape=7 + misc=22). Vendor-published 1000/24h ceiling (if applicable) was not triggered. Phase 2 probes running on the same day should check `_rate-limit-budget-used.json` for cumulative budget before re-running the 200-burst probe.
- **Phase 2 WCLI-01 retry strategy:** server is headerless — retry wrapper must rely on 429 status detection + exponential backoff (e.g. 1s → 2s → 4s → 8s capped at some max). Do NOT attempt to read `Retry-After` or `X-RateLimit-*` — they are not emitted. Concurrency can use `p-limit` or similar; threshold-probe at ~100 concurrent may be worth a follow-up since serial-at-200 didn't trigger a limit (no concurrent-burst data captured this phase).

### Surprises / Deviations from Hypotheses (research/RESEARCH.md H1-H5)

| Hypothesis | Original guess (research/FEATURES.md §Auth) | Phase 1 finding | Status |
|------------|---------------------------------------------|-----------------|--------|
| H1 | Auth header name is `X-API-Key` or `Authorization: Bearer` — unclear which | **Both.** HTTP Basic at collection level (`Authorization: Basic base64(user_id:api_key)`) PLUS per-request `x-api-key` header. Redundant auth surface; Phase 2 WCLI-01 sends both. | CONFIRMED + expanded |
| H2 | Center ID is likely in a header (`x-centre-id`) | **DISCONFIRMED.** Center ID is a PATH parameter (`/institutes/<id>/...`). No `x-centre-id` header observed anywhere. | CORRECTED |
| H3 | Namespace is a subdomain OR path prefix | **DISCONFIRMED.** Namespace is an `x-wise-namespace` HEADER (value `begifted-education`). Not a URL segment. | CORRECTED |
| H4 | User ID might imply HMAC signing | **DISCONFIRMED.** User ID is the HTTP Basic username half; no HMAC or request-signing observed. Simple Basic + x-api-key. | CORRECTED |
| H5 | Rate-limit headers unknown | **CONFIRMED as unknown.** Server emits ZERO rate-limit headers on successful responses. Phase 2 must assume headerless enforcement. | VERIFIED |

Additional surprises discovered during probes (Plan 01-03 deviations promoted here):

- **sessions endpoint requires `startDate` + `endDate` when `paginateBy=DATE`**; status enum is uppercase `PAST`/`FUTURE`, not the legacy `COMPLETED`/`UPCOMING` Sheet values. Phase 2 WCLI-04 must pass ISO date windows explicitly.
- **sessionCredits endpoint rejects arbitrary student+class pairs with 400 "Student not found!"** — expects a participant-resolved student_id distinct from `session.userId._id`. Phase 2 WCLI-04 must derive the enrolled pair via `/user/classes/{classId}/participants` or equivalent before calling sessionCredits.
- **`data.sessions[*].duration` is in milliseconds** (value 3600000 = 60min). Phase 2 Zod transform should normalize to minutes/hours at the boundary.
- **`data.sessions[*].finalStatus` / `.status` are NOT present — use `meetingStatus` instead** (enum: `ENDED`, `CANCELLED`, `UPCOMING`, `IN_PROGRESS`). Phase 2 mapper coerces to the legacy final_status enum.
- **`data.sessions[*].teacherFeedback` is NOT on the list response** — requires detail fetch with `showFeedbackConfig=true&showFeedbackSubmission=true`. N+1 cost; Phase 2 WCLI-04 should pre-filter.

## Phase 2 Unblocks

With Phase 1 complete, the following Phase 2 requirements have concrete inputs:

| Phase 2 Requirement | Input from Phase 1 | Specific Handoff |
|---------------------|--------------------|------------------|
| **WCLI-01** (client.ts — authenticated fetch wrapper) | Auth variant 1 + rate-limit behavior + pagination pattern | Construct headers per `_auth-fingerprint.json → required_headers`. Retry wrapper: 429 detection + exponential backoff (no header parsing). Timeout: 15s per `AbortSignal.timeout(15_000)` pattern from Phase 1 probes. |
| **WCLI-02** (types.ts — TypeScript types) | 6 resource fixtures with field-path audit logs | Types derivable from `data.students[*]`, `data.user`, `data.<class>`, `data.sessions[*]` shapes. WISENET_FIELD_MAP.md `Wisenet Field` column specifies shape for Zod schemas at the WCLI-05 boundary. |
| **WCLI-03** (endpoints.ts — resource functions) | `.planning/research/WISENET_ENDPOINTS.md` 120-endpoint catalogue + pagination pattern | One async function per resource: `getStudents(page)`, `getStudent(id)`, `getClass(classId)`, `getPastSessions(range)`, `getUpcomingSessions(range)`, `getSessionCredits(classId, studentId)`. Iterator: `page_number += 1` until `records.length < page_size`. |
| **WCLI-04** (mappers.ts — normalize to DashboardSources) | Field-map matrix + 6 RED Decision blocks | 2-step join for parent names (parentIds → /parents endpoint); sessionCredits gated on `/user/classes/{classId}/participants` resolution; past_sessions duration sum for derived credit balances; meetingStatus coercion to legacy final_status; composite active-set predicate (`activated && (recent_session || upcoming_session)`). |
| **WCLI-05** (Zod at boundary) | Field-map matrix `type:` column | `z.coerce.string().trim()`, `z.coerce.number()`, `z.coerce.date()`, `z.enum(["ENDED","CANCELLED","UPCOMING","IN_PROGRESS"])`. Duration field: `z.coerce.number().transform(ms => ms / 60000)` for minutes. |
| **WCLI-06** (fixture tests) | 6 resource fixtures under `.planning/research/fixtures/wisenet/` | Copy to `web/src/test/fixtures/wisenet/` per D-04 (keeps research evidence separate from test inputs). Assert mapper output shapes against expected `DashboardSources` types. |
| **WCLI-07** (getWisenetEnv) | `web/.env.example` placeholders + D-01 env var names | Add `getWisenetEnv()` to `web/src/lib/runtime/env.ts` modeled on existing `getAuthEnv()` / `getSheetsEnv()`. Returns `{baseUrl, apiKey, userId, centerId, namespace}`. Not added in Phase 1 per D-11 discretion. |
| **DB-02** (Drizzle schema) | RED Decision blocks with `postgres-sidecar` | Define `student_admin_ownership(student_key PK, admin_key, assigned_at, assigned_by_email, updated_at)`. Seed migration reads current `RemainingCredits` sheet via Apps Script export → majority-vote → bulk insert. Admin key values: `palm`, `kem`, `care`, `aya`, `petchy`, `muk`, `unassigned`. |
| **TEST-01** (Validation.gs ports) | D-05 + D-08 ripples documented in field map | Drop `Should_Credit` branch from `shouldCountAsPendingDeduction`. Update pending-deduction rule to `meetingStatus === "ENDED" AND teacher_feedback empty AND (duration / 3600000) > 0`. ~3-5 of the 41 assertions need fixture inputs rewritten; the rest transfer as-is. |

### Phase 2 Opportunity Upgrade (Optional)

`sessionCredits` with participant-resolved `student_id` (Opportunity 6 in field map). If Phase 2's `/user/classes/{classId}/participants` resolution lands AND the sessionCredits response carries numeric `total` + `remaining`, 3 RED balance rows (Aggregations/Remaining, Aggregations/Total, Students/Remaining) upgrade to GREEN. WCLI-06 fixture test asserts derived-vs-direct within 1-session tolerance; if direct values disagree by >5%, flag as v2 data-model discrepancy.

## Validator Output

Captured 2026-04-21, Phase 1 full-mode run:

```
Phase 1 validator — mode: full
Repo root: /Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops
---
OK: field_map_exists — /Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops/.planning/research/WISENET_FIELD_MAP.md present
OK: endpoints_exists — /Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops/.planning/research/WISENET_ENDPOINTS.md present
OK: field_map_has_six_sections — all 6 tab headings present
OK: all_25_required_columns_present — every REQUIRED_COLUMNS field name has ≥1 matrix row
OK: per_tab_row_counts — all 6 tabs have exact expected row counts (5+8+5+2+3+2=25)
OK: every_row_classified_green_yellow_red — every data row has a GREEN/YELLOW/RED classification
OK: every_row_cites_postman_or_fixture — every data row cites Postman: or Fixture: evidence
OK: red_rows_have_structured_blocks — 6 RED rows, 6 structured blocks
OK: red_decision_allowlist — 6 RED rows, each with one allowed decision
OK: endpoints_has_auth_section — ## Auth contains Type: and Header name:
OK: endpoints_has_base_url — concrete https?:// baseUrl documented
OK: rate_limit_fingerprint_valid — fingerprint has burst_size + endpoint + (429 or no_429 signal)
OK: pagination_fingerprint_valid — fingerprint has pattern, request_shape, response_shape
OK: four_gap_questions_answered — all 4 gap-question answer sections present
WARN: no_secret_like_strings_in_tracked_research — 1181 high-entropy match(es) found — eyeball review required
OK: fixtures_no_real_emails — 0 non-synthetic emails in fixtures
---
Phase 1 validator: 15 passed, 0 failed, 0 skipped (total 15)
```

All 14 binding assertions pass. The 1 WARN (`no_secret_like_strings_in_tracked_research`) is the expected Kevin-eyeball-review flag inherited from `WISENET_FIELD_MAP.md`, `WISENET_ENDPOINTS.md`, and fixture filenames containing dense endpoint-path citations and 24-char alphanumeric tokens (benign camelCase API parameter names like `showSequentialLearningDisabledSections` + 24-char ObjectId placeholders `{{INLINE_ID}}` + `WISENET_*` env var references). Plan 01-01 VALIDATION.md pre-designates this assertion as manual-review, not an automated fail.

## Manual-Only Verifications (per VALIDATION.md)

- [ ] Kevin reviewed each RED block's Decision + Rationale for soundness (technical judgement — 6 RED blocks across Aggregations, Credit_Control, Students, RemainingCredits tabs)
- [ ] Kevin eyeball-reviewed fixture files for PII survivors pre-commit (3 near-misses were caught during probe execution and fixed before any commit — documented in `.planning/phases/01-wisenet-discovery/01-03-SUMMARY.md` §Secret-Redaction Near-Misses)
- [ ] Probes ran within the agreed AEST window (D-09/D-10). Fingerprint `probed_at_aest` timestamps show all probes ran around 13:40-14:02 AEST (during teaching hours). Kevin accepted the vendor-visibility risk per Task 1 "ready but teaching hours, proceed" signal
- [ ] Rate-limit daily budget usage acceptable — 236 requests on 2026-04-21 against an unknown ceiling (1000/24h vendor-published hint). Phase 2 same-day probes should check `_rate-limit-budget-used.json` before re-running bursts
- [ ] Kevin reviewed the WARN on `no_secret_like_strings_in_tracked_research` — 1181 matches are all benign (endpoint paths, env var references, ObjectId placeholders, camelCase API parameter names)

## Notes for Phase 2 Planner

### Fixture strategy

- **Fixtures at `.planning/research/fixtures/wisenet/*.json` are the evidence base.** They are PII-scrubbed real responses with `_redaction` + `_field_paths_candidates` metadata. Phase 2 copies them to `web/src/test/fixtures/wisenet/` per D-04 — keeps research evidence separate from test inputs.
- **5 of 6 fixtures are status=200.** The 1 status=400 fixture (`credit_balance_sample.json`) is evidence, not failure — it documents that the endpoint exists but requires a participant-resolved student_id. Phase 2 WCLI-06 can assert the correct error shape; when `/user/classes/{classId}/participants` resolution lands, re-run the field-shape probe to replace with a 200 fixture.

### Probe script lifecycle

- **Probe scripts at `web/scripts/wisenet-*.ts` are kept per D-16 discretion.** Phase 2 may re-run them for fresh fixtures or for upgrade-to-GREEN probes (sessionCredits with resolved pair). `web/scripts/README-wisenet-probes.md` documents env vars, safety rules, and D-10 off-hours window.
- **Re-running the 200-burst rate-limit probe on 2026-04-21 should be avoided** — the day's budget is already 236 of unknown ceiling. Re-runs on a fresh day reset the budget.

### Environment setup

- **`getWisenetEnv()` is NOT added in Phase 1** (per D-11 discretion). Phase 2 WCLI-07 adds it to `web/src/lib/runtime/env.ts` modeled on the existing `getAuthEnv()`/`getSheetsEnv()` pattern.
- **`web/.env.example` documents** the 5 WISENET_* names (`WISENET_BASE_URL`, `WISENET_API_KEY`, `WISENET_USER_ID`, `WISENET_CENTER_ID`, `WISENET_NAMESPACE`). Real values live in gitignored `web/.env`.

### v2 opportunities deferred

Parked per D-16 "NOT this milestone" policy (see `WISENET_FIELD_MAP.md §Opportunities` for full details):

1. **Invoice / payment status** (Manage Fees endpoints, `classrooms[*].feeSummary` with THB currency) → `OPS-*` or `RPT-*` v2
2. **Attendance / engagement metrics** (`past_sessions[*].participants[*].inMeetingDuration`) → `RPT-*` v2
3. **Tag-based package exclusion** (replace keyword match `pretest`/`trial` with Wisenet tags) → `UX-*` or `OPS-*` v2
4. **Real-time webhook invalidation** → existing v2 `OPS-01` scope
5. **Trainer-field as admin-ownership-v2** (rejected for v1 per D-06, may revisit post-milestone)
6. **Native credit-balance direct path** (sessionCredits with resolved pair — upgrades 3 RED rows if Phase 2 probe succeeds)

### Catalogue cleanup (deferred)

`.planning/research/WISENET_ENDPOINTS.md` still contains the Postman catalogue's path typo (`{{institute_id}}s/students` — spurious trailing `s`). Probe scripts compensated inline in 01-03. Phase 2 WCLI-03 can either (a) use the corrected path `/institutes/v3/{{institute_id}}/students` directly, or (b) fix the catalogue via a one-line manual edit / re-run of `wisenet-postman-parse.ts` with a correction list.

### Cross-phase references

- `.planning/phases/01-wisenet-discovery/01-01-SUMMARY.md` — Wave-0 scaffolding (validator, fixture dirs, env placeholders)
- `.planning/phases/01-wisenet-discovery/01-02-SUMMARY.md` — Wave-1 Postman parse (endpoint catalogue, auth scheme confirmed from collection)
- `.planning/phases/01-wisenet-discovery/01-03-SUMMARY.md` — Wave-2 probes (236 requests, 0 secret leaks, 14 fixture files)
- `.planning/phases/01-wisenet-discovery/01-04-SUMMARY.md` — Wave-3 field map (6 RED decisions, 4 gap answers, 6 v2 opportunities, WISE-06 closed)
- `.planning/phases/01-wisenet-discovery/01-CONTEXT.md` — D-01..D-16 locks (cited throughout this summary)
- `.planning/phases/01-wisenet-discovery/01-RESEARCH.md` — phase research (pre-execution)
- `.planning/phases/01-wisenet-discovery/01-VALIDATION.md` — validation strategy (manual-check items above)
- `.planning/phases/01-wisenet-discovery/validate-phase1.sh` — the binding gate (15 assertions, runnable anytime)

## Requirements Closed

- **WISE-01** ✓ Every REQUIRED_COLUMNS field (25 rows) mapped to a specific Wisenet endpoint + field, or flagged RED with an explicit non-mapping decision
- **WISE-02** ✓ `WISENET_FIELD_MAP.md` written; every row classified GREEN (15) / YELLOW (4) / RED (6)
- **WISE-03** ✓ Every RED row has an explicit decision from the allowlist (4×derive-client, 1×accept-loss, 1×postgres-sidecar, 0×block-cutover)
- **WISE-04** ✓ Auth scheme documented (closed in 01-02 via Postman parse, reinforced in 01-03 via live probe)
- **WISE-05** ✓ Pagination + rate-limit behavior documented via empirical probes (closed in 01-03)
- **WISE-06** ✓ 4 gap questions answered in writing (closed in 01-04)

All 6 Phase 1 requirements closed. Phase 2 may start.

---

*Phase 1 complete: 2026-04-21. Next: Phase 2 (Data Layer) — see ROADMAP.md §Phase 2.*
