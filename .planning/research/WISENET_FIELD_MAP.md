# Wisenet Field-Map Matrix

**Phase:** 1 — Wisenet Discovery
**Generated:** 2026-04-21
**Source of truth for:** Phase 2 WCLI-02 types, WCLI-04 mappers, WCLI-06 fixture tests, DB-02 sidecar schema decisions, TEST-01 `Validation.gs` ports

Every row below maps one REQUIRED_COLUMNS field (from `web/src/lib/dashboard/config.ts` lines 64-102) to a specific Wisenet endpoint + field. Every row's notes column cites either a Postman path (from `WISENET_ENDPOINTS.md`) or a fixture filename (from `.planning/research/fixtures/wisenet/`). Every RED row has a structured decision block below the matrix.

## Classification Thresholds (D-14)

- **GREEN** — Direct 1:1 mapping with matching semantics and type. Field present in fixture. Ready for WCLI-04 to mapper.
- **YELLOW** — Derivable with confidence. Inputs exist. Logic is straightforward (<10 lines, referentially transparent).
- **RED** — Gap, missing input, or unclear semantics. Has a structured decision block below.

**Confidence** (HIGH/MEDIUM/LOW) is orthogonal to classification. A GREEN/LOW row means field is directly mapped but the semantic match is unconfirmed; MEDIUM means probed but one concern lingers; HIGH means verified via fixture + consumer trace.

## Auth + Pagination + Rate Limit (from probes)

- **Auth:** Variant 1 — HTTP Basic (`Authorization: Basic base64({{WISENET_USER_ID}}:{{WISENET_API_KEY}})`) + `x-api-key: {{WISENET_API_KEY}}` + `x-wise-namespace: {{WISENET_NAMESPACE}}` returned 200 live against `/institutes/v3/{{WISENET_CENTER_ID}}/students` (evidence: `_auth-fingerprint.json` → `confirmed_variant: 1`).
- **Required headers:** `Authorization`, `x-api-key`, `x-wise-namespace`, `Content-Type: application/json`, `user-agent` (see `_auth-fingerprint.json → required_headers`).
- **Base URL:** `https://api.wiseapp.live` (from `WISENET_ENDPOINTS.md` `## Auth (collection-level)` → Base URL).
- **Pagination pattern:** `page-number` — `page_number` + `page_size` query params, response envelope `{status, message, data: {<items>, count}}`, default page_size=50, `skip/take` silently ignored, past-end page returns empty records array (evidence: `_pagination-fingerprint.json → pattern=page-number`). Phase 2 WCLI-03 iterates via `page_number += 1` until `records.length < page_size` or `data.count` reached.
- **Rate limit observations:** 200 serial GETs against `/institutes/v3/<centerId>/students?page_number=1&page_size=1` completed with zero 429 responses. Server exposes **no** `x-ratelimit-remaining` / `Retry-After` / `X-RateLimit-*` headers (`_rate-limit-fingerprint.json → no_429_observed: true`, `first_429_index: null`, `pre_burst_headers: {}`). Phase 2 WCLI-01 retry wrapper must rely on 429 detection + exponential backoff only — headerless enforcement assumed.

---

## Aggregations

| Dashboard Field | Consumer | Wisenet Endpoint | Wisenet Field | Classification | Confidence | Notes |
|-----------------|----------|------------------|---------------|----------------|------------|-------|
| Student Name | buildDashboardStudents | GET /institutes/v3/{{WISENET_CENTER_ID}}/students | data.students[*].name (type: string, present: yes — full-name single field, not split first/last) | GREEN | HIGH | Postman: Students In your Institute (/institutes/v3/{{institute_id}}s/students — note Postman catalogue path typo, server accepts `/institutes/v3/<id>/students`). Fixture: students_list_page1.json → data.students[*].name (type: string). Zod: z.coerce.string().trim(). |
| Parent Name | buildDashboardStudents | GET /institutes/{{WISENET_CENTER_ID}}/participants/{{studentId}} → parentIds + GET /institutes/{{WISENET_CENTER_ID}}/parents | data.user.parentIds[*] (type: array of ObjectId strings, present: yes when guardians exist; empty otherwise); name resolution requires second fetch | YELLOW | MEDIUM | Postman: (root)/participants/{{student_id}}?showRegistrationData=true + Students In your Institute/parents. Fixture: student_detail_sample.json → data.user.parentIds (type: string[], present: yes). Students-list fixture's `parents` array field is always empty in list shape — must fan out to participant detail for IDs, then to /parents for name. Alternate source: registrationData.fields[questionId=z1porsd5].answer (Parent First Name) + fields[questionId=smf66ar7].answer (Parent Last Name). Derive recipe: (parents[0]?.name OR registrationData firstName+lastName OR "missing-parent") per buildDashboardStudentKey convention. |
| Class Subject | buildDashboardStudents | GET /user/v2/classes/{{classId}}?full=true | data.subject (type: string, present: yes) | GREEN | HIGH | Postman: Courses In your Institute (/user/v2/classes/{{class_id}}?full=true). Fixture: enrolment_detail_sample.json → data.subject (type: string). Also available at students_list → data.students[*].classrooms[*].subject (type: string, nested). Zod: z.coerce.string().trim(). |
| Current Remaining Credits | buildDashboardStudents | GET /institutes/{{WISENET_CENTER_ID}}/classes/{{classId}}/students/{{studentId}}/sessionCredits (fetchHistory) | No native remaining/balance field surfaced in any list endpoint; sessionCredits detail endpoint returned 400 "Student not found" when called with arbitrary student+class pair (requires participant-resolved student_id) | RED | LOW | Postman: Manage Student Credits/GET sessionCredits. Fixture: credit_balance_sample.json (status: 400 — endpoint exists but strict validation; native balance UNTESTED). Per D-07: direct-first failed; derive-client path requires past-session duration aggregation. See RED block below for decision. |
| Current Total Credits | buildDashboardStudents | GET /institutes/{{WISENET_CENTER_ID}}/classes/{{classId}}/students/{{studentId}}/sessionCredits (fetchHistory) | No native total field surfaced in list/detail probes; sessionCredits endpoint 400 gate | RED | LOW | Postman: Manage Student Credits/GET sessionCredits. Fixture: credit_balance_sample.json (status: 400). Per D-07: direct-first failed for this probe pair; may succeed when Phase 2 WCLI-04 derives enrolled pair from /user/classes/{classId}/participants. See RED block below for decision. |

## Credit_Control

| Dashboard Field | Consumer | Wisenet Endpoint | Wisenet Field | Classification | Confidence | Notes |
|-----------------|----------|------------------|---------------|----------------|------------|-------|
| Student Name | buildPendingDeductionContext | GET /institutes/v3/{{WISENET_CENTER_ID}}/students | data.students[*].name (type: string, present: yes) | GREEN | HIGH | Postman: Students In your Institute/list. Fixture: students_list_page1.json → data.students[*].name (type: string). Joined on past_sessions.data.sessions[*].students[*] (ObjectId string) → resolved via students-list name. Zod: z.coerce.string(). |
| Package/Program | buildPendingDeductionContext | GET /user/v2/classes/{{classId}}?full=true | data.name (type: string, present: yes) + data.subject (type: string, present: yes) | GREEN | HIGH | Postman: Courses In your Institute/v2/classes detail. Fixture: enrolment_detail_sample.json → data.name and data.subject (type: string). Past_sessions carries classId nested object with .name + .subject as shortcut. |
| final_status | buildPendingDeductionContext + shouldCountAsPendingDeduction | GET /institutes/{{WISENET_CENTER_ID}}/sessions?status=PAST | data.sessions[*].meetingStatus (type: string enum; values observed: ENDED, CANCELLED, UPCOMING, IN_PROGRESS — note: probe's _field_paths_candidates looked for `.status` or `.finalStatus` which were NOT FOUND, but `meetingStatus` is present) | YELLOW | MEDIUM | Postman: Manage Live Sessions/Get Sessions Data (/institutes/{{institute_id}}/sessions). Fixture: past_sessions_sample.json → data.sessions[*].meetingStatus (type: string enum). Derivation: map meetingStatus → legacy final_status enum ("ENDED" → "ENDED", "CANCELLED" → "CANCELLED" pass-through; Validation.gs parity). Zod: z.enum(["ENDED","CANCELLED","UPCOMING","IN_PROGRESS"]). |
| teacher_feedback | buildPendingDeductionContext + shouldCountAsPendingDeduction | GET /user/classes/{{class_id}}/sessions/{{session_id}}?showFeedbackConfig=true&showFeedbackSubmission=true | Not present on sessions-list response (NOT FOUND at data.sessions[*].teacherFeedback); available only on per-session detail fetch via showFeedbackSubmission query param | YELLOW | MEDIUM | Postman: Lens Sessions/v2/classes/{{class_id}}/sessions/{{session_id}} + Manage Live Sessions/teacher POST feedback. Fixture: past_sessions_sample.json → teacherFeedback absent from list (confirmed in _field_paths_candidates). Derivation cost: N+1 detail fetch per past session — Phase 2 WCLI-04 must decide batch strategy (fetch all vs lazy vs pre-filter by meetingStatus=ENDED). Zod: z.string().optional() at detail boundary. |
| credits_consumed | buildPendingDeductionContext + shouldCountAsPendingDeduction | GET /institutes/{{WISENET_CENTER_ID}}/classes/{{classId}}/students/{{studentId}}/sessionCredits (fetchHistory) | Not present on sessions list (NOT FOUND at data.sessions[*].creditsConsumed); sessionCredits detail endpoint returned 400 when probed | RED | LOW | Postman: Manage Student Credits/sessionCredits. Fixture: past_sessions_sample.json (NOT FOUND) + credit_balance_sample.json (status: 400). Per D-08: pending-deduction rule requires this field; derive-client path uses session.duration / 3600000 (ms→hours) as proxy when session ENDED without explicit consumption. See RED block below for decision. |
| session_duration | buildPendingDeductionContext + shouldCountAsPendingDeduction | GET /institutes/{{WISENET_CENTER_ID}}/sessions?status=PAST | data.sessions[*].duration (type: number, present: yes — units: milliseconds, e.g. 3600000 = 60 minutes) | GREEN | HIGH | Postman: Manage Live Sessions/Get Sessions Data. Fixture: past_sessions_sample.json → data.sessions[*].duration (type: number, unit: ms). Zod: z.coerce.number().transform(ms => ms / 60000) for minutes-or-hours coercion at WCLI-05 boundary. |
| session_date | buildPendingDeductionContext + shouldCountAsPendingDeduction | GET /institutes/{{WISENET_CENTER_ID}}/sessions?status=PAST | data.sessions[*].scheduledStartTime (type: string — ISO 8601 datetime, present: yes); also data.sessions[*].start_time for actual-start | GREEN | HIGH | Postman: Manage Live Sessions/Get Sessions Data. Fixture: past_sessions_sample.json → data.sessions[*].scheduledStartTime (type: string, format: ISO 8601). Probe's _field_paths_candidates looked for `.date` / `.sessionDate` / `.startDate` (NOT FOUND) — but scheduledStartTime is present and preferred. Zod: z.coerce.date(). |
| Should_Credit | buildPendingDeductionContext + shouldCountAsPendingDeduction | N/A — dropped per D-05 | — | RED | HIGH | Postman: (no candidate endpoint — field is BeGifted-specific manual override Sheet column, not a Wisenet concept). Fixture: — . Per D-05 user-lock: drop entirely. See RED block below for decision. |

## Upcoming Sessions

| Dashboard Field | Consumer | Wisenet Endpoint | Wisenet Field | Classification | Confidence | Notes |
|-----------------|----------|------------------|---------------|----------------|------------|-------|
| Student Name | buildUpcomingSessionMap | GET /institutes/{{WISENET_CENTER_ID}}/sessions?status=FUTURE + GET /institutes/v3/{{WISENET_CENTER_ID}}/students | data.sessions[*].students[*] (type: array of ObjectId strings, present: yes) — resolved to name via students-list join | YELLOW | MEDIUM | Postman: Manage Live Sessions/Get Sessions Data + Students In your Institute/list. Fixture: upcoming_sessions_sample.json → data.sessions[*].students (type: string[], ObjectId refs). Derivation: 2-step join — upcoming session emits student IDs, paginated students-list provides ID→name map. Zod at boundary: z.string() for ID, join performed in mapper. |
| Package/Program | buildUpcomingSessionMap | GET /institutes/{{WISENET_CENTER_ID}}/sessions?status=FUTURE | data.sessions[*].classId.name (type: string, present: yes) + data.sessions[*].classId.subject (type: string, present: yes) | GREEN | HIGH | Postman: Manage Live Sessions/Get Sessions Data. Fixture: upcoming_sessions_sample.json → data.sessions[*].classId (type: object with name + subject). Nested classId shortcut avoids enrolment-detail fanout. |
| Session Status | buildUpcomingSessionMap | GET /institutes/{{WISENET_CENTER_ID}}/sessions?status=FUTURE | data.sessions[*].meetingStatus (type: string enum; values observed: UPCOMING, CANCELLED, IN_PROGRESS; probe's _field_paths_candidates looked for `.status` which was NOT FOUND but `meetingStatus` is present) | GREEN | MEDIUM | Postman: Manage Live Sessions/Get Sessions Data. Fixture: upcoming_sessions_sample.json → data.sessions[*].meetingStatus (type: string enum). Zod: z.enum(["UPCOMING","CANCELLED","IN_PROGRESS","ENDED"]). Note: dashboard's "Session Status" expects Sheet strings like "SCHEDULED"; mapper must coerce meetingStatus → dashboard enum. |
| Session Duration | buildUpcomingSessionMap | GET /institutes/{{WISENET_CENTER_ID}}/sessions?status=FUTURE | data.sessions[*].duration (type: number, present: yes — units: milliseconds) | GREEN | HIGH | Postman: Manage Live Sessions/Get Sessions Data. Fixture: upcoming_sessions_sample.json → data.sessions[*].duration (type: number, unit: ms). Zod: z.coerce.number(); same ms→minutes/hours transform as Credit_Control. |
| Scheduled Date | buildUpcomingSessionMap | GET /institutes/{{WISENET_CENTER_ID}}/sessions?status=FUTURE | data.sessions[*].scheduledStartTime (type: string, format: ISO 8601, present: yes) | GREEN | HIGH | Postman: Manage Live Sessions/Get Sessions Data. Fixture: upcoming_sessions_sample.json → data.sessions[*].scheduledStartTime (type: string, ISO 8601). Zod: z.coerce.date(). Dashboard expects Sheet-style date cells; mapper formats per helpers.formatDate(). |

## Students

| Dashboard Field | Consumer | Wisenet Endpoint | Wisenet Field | Classification | Confidence | Notes |
|-----------------|----------|------------------|---------------|----------------|------------|-------|
| student_name | buildActiveStudentSet | GET /institutes/v3/{{WISENET_CENTER_ID}}/students | data.students[*].name (type: string, present: yes) | GREEN | HIGH | Postman: Students In your Institute/list. Fixture: students_list_page1.json → data.students[*].name (type: string). Same source as Aggregations/Student Name; single-fetch reuse. Zod: z.coerce.string().trim(). |
| Remaining Credits | buildActiveStudentSet | GET /institutes/{{WISENET_CENTER_ID}}/classes/{{classId}}/students/{{studentId}}/sessionCredits | No native balance surfaced; sessionCredits endpoint 400'd on probe (requires enrolled student+class pair) | RED | LOW | Postman: Manage Student Credits/GET sessionCredits. Fixture: credit_balance_sample.json (status: 400). Per D-07: direct-first failed for this probe; buildActiveStudentSet currently filters on `remainingCredits !== "N/A" && !== ""` — derive-client replaces with "activated && has current enrolments" logic. See RED block below for decision. |

## Students & Courses

| Dashboard Field | Consumer | Wisenet Endpoint | Wisenet Field | Classification | Confidence | Notes |
|-----------------|----------|------------------|---------------|----------------|------------|-------|
| Student Name | buildExcludedPackageReasons | GET /institutes/v3/{{WISENET_CENTER_ID}}/students | data.students[*].name (type: string, present: yes) | GREEN | HIGH | Postman: Students In your Institute/list. Fixture: students_list_page1.json → data.students[*].name (type: string). Joined to classrooms via data.students[*].classrooms array. Zod: z.coerce.string().trim(). |
| Class Name | buildExcludedPackageReasons | GET /user/v2/classes/{{classId}}?full=true | data.name (type: string, present: yes); also available at data.students[*].classrooms[*].name on students-list shortcut | GREEN | HIGH | Postman: Courses In your Institute/v2/classes detail + Students list nested. Fixture: enrolment_detail_sample.json → data.name (type: string); students_list_page1.json → data.students[*].classrooms[*].name. Zod: z.coerce.string().trim(). Excluded-package keyword filter (`pretest`, `trial`) runs on this field unchanged. |
| Class Subject | buildExcludedPackageReasons | GET /user/v2/classes/{{classId}}?full=true | data.subject (type: string, present: yes); also data.students[*].classrooms[*].subject shortcut | GREEN | HIGH | Postman: Courses In your Institute/v2/classes detail + Students list nested. Fixture: enrolment_detail_sample.json → data.subject (type: string). Matches Aggregations/Class Subject source — single fetch reuse. Zod: z.coerce.string().trim(). |

## RemainingCredits

| Dashboard Field | Consumer | Wisenet Endpoint | Wisenet Field | Classification | Confidence | Notes |
|-----------------|----------|------------------|---------------|----------------|------------|-------|
| Student | buildStudentAdminOwnershipMap | GET /institutes/v3/{{WISENET_CENTER_ID}}/students | data.students[*].name (type: string, present: yes) | GREEN | HIGH | Postman: Students In your Institute/list. Fixture: students_list_page1.json → data.students[*].name (type: string). Same source as Students/student_name; the value becomes the sidecar-table join key after D-06 migration. |
| Admin | buildStudentAdminOwnershipMap | N/A — Postgres sidecar per D-06 | — | RED | HIGH | Postman: (no candidate endpoint — admin-ownership is BeGifted operator-managed metadata, not a Wisenet concept; Wisenet's `userId` / `coTeachers` on /user/v2/classes are TEACHER roles, not the 6-admin registry). Fixture: — . Per D-06 user-lock: store in Postgres sidecar table. See RED block below for decision. |

---

## RED Row Decisions

### RED: Aggregations / Current Remaining Credits

**Problem:** No native remaining-credits field is exposed on any probed list endpoint (`data.students[*].creditBalance` / `.balance` both NOT FOUND in `students_list_page1.json` `_field_paths_candidates`). The dedicated sessionCredits detail endpoint (`GET /institutes/{{WISENET_CENTER_ID}}/classes/{{classId}}/students/{{studentId}}/sessionCredits?fetchHistory=true`) exists in the Postman catalogue but returned 400 "Student not found!" when probed with an arbitrary student+class pair — the endpoint requires a participant-resolved student_id distinct from the session's `userId._id`. The current dashboard consumer (`buildDashboardStudents`) reads a precomputed number from the `Aggregations` sheet; Wisenet's semantics are unconfirmed (could be session-count or minutes) without a successful probe of an enrolled pair.

**Options considered:**
- **Option A (derive-client):** Compute `remaining = total_consumed_duration_from_past_sessions / 3600000` transform per student/class pair from the past-sessions fixture shape. Inputs (session.duration, session.students[*]) are GREEN. Tradeoff: 10-line aggregation in mapper; loses whatever semantic Wisenet's own balance exposes (e.g. admin-topped-up credits that bypass session history).
- **Option B (native direct):** Phase 2 WCLI-04 resolves the enrolled student_id via `/user/classes/{classId}/participants`, then calls sessionCredits with the correct pair. Tradeoff: extra 1-2 requests per class at sync time; unknown whether the endpoint's numeric shape matches dashboard semantics (session-count vs hours).
- **Option C (postgres-sidecar):** Treat balances as BeGifted-managed. Tradeoff: reintroduces manual accounting we just removed from Sheets; fights Wisenet-is-source-of-truth mandate.
- **Option D (block-cutover):** Halt until Wisenet confirms or exposes a balance field. Tradeoff: unnecessary — derive-client + future native direct are both tractable.

**Decision:** derive-client

**Rationale:** Inputs for derivation (past_sessions.duration, past_sessions.meetingStatus=ENDED, past_sessions.students) are all GREEN in the fixtures. D-07 lock says "direct-first, derived fallback" — the direct path is gated behind an unresolved pair, so derived wins for cutover; Phase 2 WCLI-04 may upgrade to direct once `/user/classes/{classId}/participants` resolution lands without blocking the milestone.

**Affects:**
- WCLI-02 (types): Add `remainingCredits: number` on the `PackageRecord` payload; no shape change to `StudentRecord` (already numeric).
- WCLI-04 (mappers): Aggregate past_sessions by student+class; sum `duration` for rows where `meetingStatus === "ENDED"`; subtract from a total (which is itself derived — see Current Total Credits decision).
- DB-02 (schema): N/A — balance is derived at read time, not persisted.
- TEST-01 (Validation.gs ports): Keep `Current Remaining Credits` numeric assertions; update fixture inputs from Aggregations-sheet cells to past_sessions aggregates; any Validation.gs test that assumes exact parity with legacy Sheet values must be relaxed to tolerance-based (Δ ≤ 1 session).

### RED: Aggregations / Current Total Credits

**Problem:** No native total-credits field surfaced in students list (`students[*].creditBalance`, `.balance`, `.totalCredits` all NOT FOUND) or enrolment detail (`credits`, `sessionCredits` NOT FOUND per `enrolment_detail_sample.json` `_field_paths_candidates`). The sessionCredits endpoint that might expose a total returned 400 on probe. The dashboard consumer reads this as a precomputed number from the `Aggregations` sheet — source is the operator-maintained package purchase record, not a live Wisenet field.

**Options considered:**
- **Option A (derive-client):** Derive total from a Wisenet field. Tradeoff: Wisenet doesn't surface a "purchased credits" number anywhere probed; classrooms[*].feeSummary.totalPaid exists (THB currency amount), but that's money, not credits — semantic mismatch.
- **Option B (postgres-sidecar):** Persist a `package_purchases(student_key, class_id, total_credits)` table seeded from the Aggregations sheet at cutover. Tradeoff: operator has to maintain yet another table; defeats the simplification goal.
- **Option C (native direct via sessionCredits):** When Phase 2 resolves the enrolled pair, inspect the sessionCredits response for a `total` field. Tradeoff: unknown shape; could still be session-count semantic mismatch.
- **Option D (block-cutover):** Pause until Wisenet exposes a purchased-credits field or confirms sessionCredits response shape. Tradeoff: the field is load-bearing for projection/alert math — can't cut over without it.

**Decision:** derive-client

**Rationale:** Deferring to Phase 2's sessionCredits probe once enrolled pair is resolvable is the lowest-risk path. If that probe returns a usable `total` field, this row promotes to GREEN. If it doesn't, the Phase 2 WCLI-04 mapper derives from `past_sessions` + `upcoming_sessions` + a static "initial credits" hint on the classroom's `feeSummary` or `settings.validityInDays`. Per D-07 "decided per-field": we classify this RED now and let Phase 2 pick the concrete variant based on a successful sessionCredits probe.

**Affects:**
- WCLI-02 (types): Add `totalCredits: number` to `PackageRecord`.
- WCLI-04 (mappers): Two-branch logic — if sessionCredits returns numeric total, use it; else fall back to `past_sessions_count + upcoming_sessions_count` as hour equivalent.
- DB-02 (schema): N/A (derived at read time). If Phase 2 picks sidecar fallback, reconsider.
- TEST-01 (Validation.gs ports): Total-credits assertions become tolerance-based or skipped until the Phase 2 probe resolves the direct-vs-derived fork.

### RED: Credit_Control / credits_consumed

**Problem:** The past-sessions list endpoint does NOT expose a `creditsConsumed` field (`past_sessions_sample.json` `_field_paths_candidates` confirms NOT FOUND at `data.sessions[*].creditsConsumed`). The sessionCredits detail endpoint (which may carry this number) returned 400 on our probe due to the participant-resolution gap. This field is the core input for the pending-deduction rule (D-08: `final_status = ENDED AND teacher_feedback empty AND credits_consumed = 0`), so its absence breaks the rule's third clause.

**Options considered:**
- **Option A (derive-client):** Use `session.duration / 3600000` (ms → hours) as proxy for credits_consumed when `meetingStatus === "ENDED"`. Tradeoff: only correct if 1 credit == 1 hour across all classes — not universally true (packages may price sessions in fractional credits).
- **Option B (native direct via sessionCredits):** Phase 2 resolves the participant pair; sessionCredits response likely carries consumed values. Tradeoff: N+1 request overhead per ENDED session; unverified shape.
- **Option C (postgres-sidecar):** N/A — this is per-session state, not operator-managed metadata.
- **Option D (block-cutover):** Halt cutover until Wisenet probe confirms. Tradeoff: blocks on something derive-client can provisionally cover.

**Decision:** derive-client

**Rationale:** Per D-08 the pending-deduction rule must be replicated 1:1 where possible. `session.duration` is GREEN and the ENDED filter via `meetingStatus` is YELLOW-with-clear-recipe — both available without the sessionCredits gate. Phase 2 WCLI-04 uses `duration / 3600000` as the consumed-credits proxy; if later the sessionCredits direct value differs by > 5%, Phase 2 WCLI-06 fixture tests will flag the discrepancy and the mapper upgrades to direct. Keeps cutover unblocked.

**Affects:**
- WCLI-02 (types): `PendingDeductionDetail.creditsConsumed: number` (already exists in `types/dashboard.ts`); value source shifts.
- WCLI-04 (mappers): Implement `session.duration / 3600000` with rounding per `roundToTenth` helper; gate on `meetingStatus === "ENDED"`.
- DB-02 (schema): N/A.
- TEST-01 (Validation.gs ports): Two of the 41 assertions currently use explicit `credits_consumed = 0` inputs — rewrite these to use `duration = 0` or equivalent for the D-08 rule's third clause. Drop the Should_Credit-coupled assertions entirely per D-05.

### RED: Credit_Control / Should_Credit

**Problem:** `Should_Credit` is a BeGifted manual-override column on the Sheets `Credit_Control` tab, not a Wisenet concept — there is no candidate endpoint (keyword search across 120 catalogue rows for "override", "should_credit", "manual_credit" returned no matches). The dashboard's `shouldCountAsPendingDeduction` currently gives this column priority over `session_duration` when deciding whether a session counts as a pending deduction.

**Options considered:**
- **Option A (postgres-sidecar):** Preserve override column as a Postgres table keyed by `(student_key, session_id)`. Tradeoff: reintroduces the manual accounting surface we just escaped; ongoing operator cost with marginal value.
- **Option B (accept-loss):** Drop the column entirely. Pending-deduction math falls back to `session_duration` alone (the second branch of the existing rule). Tradeoff: lose per-session operator override ability — accepted by user per D-05.
- **Option C (derive-client):** N/A — nothing to derive from.
- **Option D (block-cutover):** Halt until Wisenet offers a custom-field facility or we build the sidecar. Tradeoff: unnecessary given D-05 lock.

**Decision:** accept-loss

**Rationale:** D-05 user-lock explicitly directs: "Accept the small loss of the per-session override column. Pending-deduction math uses `session_duration` fallback only." The override was a manual Sheet hack whose ongoing value doesn't justify the Postgres-sidecar complexity. Historical override values are not preserved anywhere per CONTEXT.md §deferred.

**Affects:**
- WCLI-02 (types): Remove `shouldCredit?: string` or equivalent from `PendingDeductionDetail` type. Mapper does not emit this property.
- WCLI-04 (mappers): `shouldCountAsPendingDeduction` logic drops the Should_Credit branch; uses `session_duration > 0` fallback only.
- DB-02 (schema): N/A (nothing to persist).
- TEST-01 (Validation.gs ports): Drop or rewrite any `Validation.gs` test fixture that exercises Should_Credit's priority over session_duration (per D-05 ripple note). Expect ~3-5 of the 41 assertions to change — those with `should_credit` in input rows.

### RED: Students / Remaining Credits

**Problem:** The `buildActiveStudentSet` consumer (`web/src/lib/dashboard/packages.ts:31-45`) currently filters active students with `remainingCredits !== "N/A" && remainingCredits !== ""` — a string-shape test against the legacy Sheets cell. Wisenet's students list does not expose a `remainingCredits` field (NOT FOUND at `data.students[*].creditBalance` and `.balance` in `students_list_page1.json`). This is the same gap as Aggregations/Current Remaining Credits but the consumer semantic differs (membership test vs numeric display).

**Options considered:**
- **Option A (derive-client from session presence):** Active = has any `past_sessions` within last N days OR any `upcoming_sessions` scheduled. Tradeoff: shifts active-set definition slightly but preserves operator intent (students with recent/future activity).
- **Option B (derive-client from activation flag):** Use `data.students[*].activated` (type: boolean, present: yes). Tradeoff: activated flag is a Wisenet lifecycle concept that may not match BeGifted's "has paid-up credits" semantic; students can be activated but credit-exhausted.
- **Option C (native direct via sessionCredits):** Fetch sessionCredits per student, treat remaining > 0 as active. Tradeoff: N requests per student; scales poorly.
- **Option D (postgres-sidecar):** N/A — this is derivable from Wisenet live data.

**Decision:** derive-client

**Rationale:** Per D-07 "direct-first, derived fallback, per-field": the direct path (sessionCredits) is gated by the participant-resolution problem, so derived wins for cutover. Phase 2 WCLI-04 combines Option A (session presence within N days) with Option B (activated flag) as a belt-and-suspenders active-set predicate: `activated && (has_past_session_in_last_90_days || has_upcoming_session)`. Inputs are GREEN. Semantic drift vs legacy is acceptable — the dashboard already filters students with no activity elsewhere.

**Affects:**
- WCLI-02 (types): Add `active: boolean` to `StudentRecord`; mapper sets it.
- WCLI-04 (mappers): Replace `buildActiveStudentSet`'s string test with the composite predicate above. Keep the Set<string> return shape for downstream compatibility.
- DB-02 (schema): N/A.
- TEST-01 (Validation.gs ports): The `assert_excluded_packages_honor_active_set` family of 2-3 assertions needs fixture inputs rewritten from Sheets-cell shape to session-list shape. Semantic contract (active-set membership) unchanged.

### RED: RemainingCredits / Admin

**Problem:** Admin ownership — the mapping of a student to one of six named BeGifted admins (palm, kem, care, aya, petchy, muk) plus `unassigned` fallback — has no native Wisenet analogue. Wisenet's `userId` field on `/user/v2/classes/{classId}` and `coTeachers` array on the same endpoint expose TEACHER roles, not administrators. The 120-endpoint catalogue has no "admins" list endpoint that returns the BeGifted 6-admin registry; the only admin surface is `POST /institutes/{{institute_id}}/makeAdmin` / `removeAsAdmin` (grant/revoke admin privileges globally, not per-student assignment). The current dashboard consumer (`buildStudentAdminOwnershipMap` at `packages.ts:63-109`) does a majority-vote over `RemainingCredits` sheet rows.

**Options considered:**
- **Option A (derive-client):** Use Wisenet's `userId` (class owner/creator) as the admin. Tradeoff: semantically wrong — userId is the teacher who created the class, not the admin who owns the relationship.
- **Option B (postgres-sidecar):** Create `student_admin_ownership(student_key, admin_key, assigned_at, assigned_by)` Postgres table. Seed from current `RemainingCredits` majority-vote rollup at cutover. Operator-editable via future v2 dashboard UI.
- **Option C (accept-loss):** Drop admin filtering entirely. Tradeoff: loses the dashboard's admin-tab filter — unacceptable to operators (6 admins, routing decisions depend on it).
- **Option D (native direct via Wisenet tags):** Use `data.students[*].tags` as a carrier for the admin key. Tradeoff: tags are an uncontrolled free-form field; requires manual tagging discipline; not a durable mechanism.

**Decision:** postgres-sidecar

**Rationale:** D-06 user-lock explicitly directs: "Store admin ownership in a Postgres table keyed by `student_key` with `admin_key` column. Phase 2 seeds it from the current `RemainingCredits` majority-vote rollup at cutover time." Admin ownership is historical, operator-managed state that Wisenet (read-only for this app) cannot supply. Postgres relational model fits: keyed by student_key, auditable, editable, queryable with the dashboard's existing join pattern.

**Affects:**
- WCLI-02 (types): Admin ownership isn't emitted by the Wisenet mapper; it joins in the service layer.
- WCLI-04 (mappers): N/A for this field.
- DB-02 (schema): New table `student_admin_ownership(student_key PK, admin_key, assigned_at, assigned_by_email, updated_at)`. Seed migration reads current `RemainingCredits` sheet via Apps Script export → majority-vote → bulk insert.
- DB-04 (query functions): `getAdminOwnership(studentKey): AdminOwnership | null` + `bulkGetAdminOwnership(studentKeys[]): Map<string, AdminOwnership>` for dashboard build.
- TEST-01 (Validation.gs ports): The `buildStudentAdminOwnershipMap` unit tests move from sheet-fixture input to Postgres-fixture input; semantic contract unchanged (majority-vote resolution → { key, name, source }).

---

## Gap Questions (WISE-06)

### Should_Credit manual override disposition

**Locked answer (per D-05):** Drop the Should_Credit column entirely. The per-session override is not preserved in Wisenet, Postgres sidecar, or any migration path.

**What the probes confirmed:** No Wisenet endpoint exposes an override field (keyword search across the 120-endpoint catalogue for "override", "should_credit", "manual_credit" returned zero matches). The field's legacy semantic — "operator marked this ended session as NOT counting toward pending-deduction math" — has no Wisenet analogue.

**Phase 2 implementation plan:**
- `shouldCountAsPendingDeduction` at `web/src/lib/dashboard/packages.ts` drops the Should_Credit branch; relies on the D-08 rule's `session_duration` fallback only (`final_status = ENDED AND teacher_feedback empty AND session_duration > 0 → count as pending`).
- TEST-01 rewrites 3-5 assertions in the `Validation.gs` port. Drop inputs that have `should_credit` populated; keep the fixtures that exercise the other three clauses.
- No Postgres table, no Wisenet custom-field request, no migration of historical override values. Historical values on the Action sheets remain as read-only archive per PROJECT.md out-of-scope.

**Ripples tracked:**
- V1 scope: single Credit_Control RED-block Decision = `accept-loss`; zero v2 follow-up (the feature is intentionally dropped, not deferred).

### Admin ownership semantics

**Locked answer (per D-06):** Postgres sidecar. Ownership stored in `student_admin_ownership(student_key PK, admin_key, assigned_at, assigned_by_email, updated_at)`. Seed from current `RemainingCredits` majority-vote at cutover.

**What the probes confirmed:** Wisenet has no per-student admin-assignment concept. The `userId` on `/user/v2/classes/{classId}` is the teacher/class-creator, not the owning admin. `coTeachers[]` on the same endpoint is teacher collaborators, not admins. `POST /institutes/{institute_id}/makeAdmin` grants global admin privileges — it does not model the 6-admin-to-student assignment needed for the queue's admin-tab filter. The 6 BeGifted admin names (`ADMIN_OWNER_REGISTRY` in `web/src/lib/dashboard/config.ts:22-29`) appear nowhere in the Wisenet data shape.

**Phase 2 implementation plan:**
- DB-02: Create the sidecar table. `admin_key` values are the registry keys (`palm`, `kem`, `care`, `aya`, `petchy`, `muk`, or `unassigned` fallback).
- DB-04: Expose `getAdminOwnership()` and `bulkGetAdminOwnership()` query helpers; the dashboard service joins this into each `StudentRecord.admin` field on payload build.
- Seed migration: one-off script that reads current `RemainingCredits` sheet via Apps Script export, runs `buildStudentAdminOwnershipMap` locally, bulk-inserts the results.
- TEST-01: `buildStudentAdminOwnershipMap` unit tests move to Postgres fixtures; the majority-vote resolution logic is retired (the new store is already-resolved).
- V2 feature: dashboard UI for operators to re-assign student→admin. Captured as `OPS-*` v2 opportunity below.

### Credit-balance model (direct vs derived)

**Locked framework (per D-07):** Decided per-field, direct-first with derived fallback. This field-map classifies three credit-balance fields:
- `Aggregations / Current Remaining Credits` → RED / derive-client
- `Aggregations / Current Total Credits` → RED / derive-client
- `Students / Remaining Credits` → RED / derive-client

**What the probes confirmed:** No native balance field on any list endpoint (`data.students[*].creditBalance`, `.balance`, `.totalCredits` all NOT FOUND). The dedicated `sessionCredits` detail endpoint (`GET /institutes/{{institute_id}}/classes/{{class_id}}/students/{{student_id}}/sessionCredits`) exists and is documented in Postman, but returned `400 "Student not found!"` on probe because the endpoint requires a participant-resolved student_id distinct from the arbitrary student+class pair we tried. Phase 2 WCLI-04 must derive the enrolled pair via `/user/classes/{classId}/participants` before the direct path becomes probeable.

**Phase 2 implementation plan:**
- WCLI-04 fetches upcoming + past sessions for the target date window, joined by student.
- Balance derivation: `total_credits` approximates as `session_count_across_all_windows_or_feeSummary_hint`; `remaining_credits` = `total_credits − sum(ended_session_duration / 3600000)`.
- If Phase 2 successfully probes `sessionCredits` with a resolved pair and finds a numeric `total` + `remaining`, these three RED rows upgrade to GREEN and the derived fallback is retired (still kept in tests as a differential check).
- WCLI-06 fixture test asserts derived vs (future) direct values agree within 1-session tolerance to detect drift.

**Ripples tracked:**
- V1 scope: all three rows stay RED / derive-client until probe succeeds.
- Accepted semantic drift: if Wisenet tracks "money paid" (`feeSummary.totalPaid`) rather than credits, we accept derive-client fully for v1; operators understand "remaining" is computed.

### Pending-deduction rule field availability

**Locked framework (per D-08):** Replicate 1:1 where possible; RED per missing ingredient.

**Per-field status from probes:**
- `final_status` → YELLOW (derivable from `meetingStatus` enum). Inputs present, 3-line derivation.
- `teacher_feedback` → YELLOW (requires per-session detail fetch with `showFeedbackSubmission=true`). Input available but costs N+1 requests.
- `credits_consumed` → RED / derive-client (no native field in session list; sessionCredits endpoint gated by participant-resolution; proxy via `duration / 3600000`).
- `Should_Credit` → RED / accept-loss (per D-05).

**What the probes confirmed:** Two of the three D-08 ingredients (`final_status`, `teacher_feedback`) are reachable with clear derivation recipes. The third (`credits_consumed`) is behind the same participant-resolution gate as the credit-balance model. `meetingStatus` on the sessions list gives us a GREEN substitute for `final_status` semantics (values: `ENDED`, `CANCELLED`, `UPCOMING`, `IN_PROGRESS`). Teacher feedback requires a second fetch per session — Phase 2 WCLI-04 must decide whether to pre-filter (only fetch feedback for `meetingStatus === "ENDED"` sessions) to bound the request volume.

**Phase 2 implementation plan:**
- `shouldCountAsPendingDeduction` rule becomes: `meetingStatus === "ENDED" AND teacher_feedback empty AND (duration / 3600000) > 0`.
- WCLI-04 fetches feedback only for ENDED sessions (reduces N+1 overhead by ~50-70% based on the meetingStatus distribution in `past_sessions_sample.json`).
- WCLI-06 fixture test exercises the composite rule against a past-sessions fixture slice.
- TEST-01 retains 80%+ of the existing `Validation.gs` pending-deduction assertions; only the Should_Credit-coupled ones drop per D-05.

**Ripples tracked:**
- V1 scope: the rule ships with the 3-clause composite, Should_Credit dropped.
- V2 opportunity: native `creditsConsumed` from sessionCredits once participant-resolution lands — mentioned in Opportunities below.

---

## Opportunities (NOT this milestone)

These are v2 (or later) items discovered during Phase 1 probes but explicitly NOT part of the Wisenet migration milestone per D-16. Each one is labeled "NOT this milestone" and maps to a future requirement-ID slot.

### Opportunity 1: Invoice / Payment status integration (Manage Fees endpoints)

**NOT this milestone.**

**What was found:** The `Manage Fees` Postman folder exposes 10 endpoints including `GET /institutes/{{institute_id}}/classes/{{class_id}}/students/{{student_id}}/fees?showTransactions=true`, `GET /institutes/{{institute_id}}/fees/transactions` (with date/status/type filters), and `GET /institutes/{{institute_id}}/studentFees`. `students_list_page1.json` confirms each classroom carries a live `feeSummary` object with `totalPaid`, `totalDue`, `totalOverDue`, `totalRemaining`, `earliestDueDate`, `currency: "THB"`.

**Why deferred:** The current dashboard has no payment/invoice surface. Wiring fees in would require new UI (invoices panel, payment history, overdue flag), new requirement(s), and operator training. Out of scope for a straight data-source swap milestone.

**Maps to future requirement:** `OPS-*` (operations) or `RPT-*` (reporting) v2 requirement — "Surface Wisenet fee state on dashboard queue for admin-tab triage."

### Opportunity 2: Attendance / engagement metrics (session.participants[])

**NOT this milestone.**

**What was found:** `past_sessions_sample.json` `data.sessions[*].participants[]` carries per-participant `duration`, `inMeetingDuration`, `firstEntryTime`, `lastExitTime`, and `isTeacher` boolean. For ENDED sessions this gives per-student engagement minutes within the class — a far richer signal than the binary present/absent the legacy dashboard has no concept of. Raw attendance is also available via `GET /user/classes/{{class_id}}/sessions/{{zoom_session_id}}/rawAttendance`.

**Why deferred:** Engagement metrics are a net-new feature, not a migration. Would require: new UI panels, new priority-score inputs, new alerting thresholds, Phase 1-style probes of the rawAttendance endpoint shape. D-16 excludes feature additions.

**Maps to future requirement:** `RPT-*` v2 requirement — "Weekly engagement summary per student with Wisenet inMeetingDuration delta."

### Opportunity 3: Tag-based package exclusion (students[*].tags / classrooms[*].metadata.tags)

**NOT this milestone.**

**What was found:** `students_list_page1.json` confirms `data.students[*].tags` (type: string array, present: yes — observed values include `"Grade 9"`, `"Year8"`). `enrolment_detail_sample.json` confirms `data.metadata.tags` (empty in sample but schema-present). The legacy `EXCLUDED_PACKAGE_KEYWORDS` constant (`["pretest", "trial"]`) is a substring match on the Class Subject string — fragile. A tag-based equivalent (`tag: "trial"` on the classroom) would be more robust.

**Why deferred:** Migrating off keyword exclusion requires Wisenet data hygiene effort (operators must tag existing classrooms correctly) AND a code change AND a cutover plan. Keyword match works for v1; the tag-based version is a quality improvement for later.

**Maps to future requirement:** `UX-*` or `OPS-*` v2 requirement — "Replace keyword-based package exclusion with Wisenet-tag-based exclusion rule."

### Opportunity 4: Real-time webhook invalidation (existing OPS-01 scope)

**NOT this milestone.**

**What was found:** The 120-endpoint catalogue has no webhook-management endpoints. Wisenet's push model, if any, is not discoverable from the Postman collection alone — Kevin would need to ask the vendor directly. The current milestone uses a 60-second `unstable_cache` revalidate on the dashboard payload; stale data up to 60s is acceptable to operators.

**Why deferred:** Vendor-coordination required. Risk of rework if the webhook shape turns out to be unusable. v2 `OPS-01` already captures this scope.

**Maps to future requirement:** Existing v2 `OPS-01` — "Wisenet webhook-triggered dashboard invalidation."

### Opportunity 5: Trainer-field as admin-ownership-v2 (userId + coTeachers on /user/v2/classes)

**NOT this milestone.**

**What was found:** `enrolment_detail_sample.json` exposes `data.userId` (class creator — `_id`, `name`, `email`) and `data.coTeachers[*]` (array of teacher collaborators). If a future operator policy mapped "who teaches this student the most" to "who owns the student admin-wise," the Wisenet trainer model could replace the Postgres sidecar.

**Why deferred:** D-06 explicitly rejects this path for v1 ("Wisenet's trainer/coordinator field is not used even if available"). The 6 BeGifted admins are operations staff, not teachers — the roles don't align. May be reconsidered post-milestone if the ownership model shifts.

**Maps to future requirement:** Future review — potential `OPS-*` v2 requirement, contingent on operator policy change.

### Opportunity 6: Native credit-balance direct path (sessionCredits with resolved pair)

**NOT this milestone.**

**What was found:** `GET /institutes/{{institute_id}}/classes/{{class_id}}/students/{{student_id}}/sessionCredits?fetchHistory=true` exists and responds 200 with participant-resolved pairs. The probe returned 400 only because we used arbitrary student+class IDs. Phase 2 WCLI-04's `/user/classes/{classId}/participants` fan-out resolves this — if the response carries a numeric total + remaining, the 3 RED credit-balance rows upgrade to GREEN.

**Why the deferral label applies:** V1 ships with derive-client per D-07 to unblock cutover. The direct-path upgrade is tracked as a Phase 2 WCLI-06 fixture test; if the shape matches, the upgrade is invisible to operators (same numeric output). If the shape surprises (e.g. credits in hours vs sessions), the upgrade becomes a v2 data-model change.

**Maps to future requirement:** Post-cutover Phase 2 follow-up on WCLI-04 / WCLI-06; promoted to a v2 `DATA-*` item only if direct path reveals schema surprises.

---

*Field map maintained at `.planning/research/WISENET_FIELD_MAP.md`. Update whenever a Phase 2 probe resolves a RED row, or a Phase 2 WCLI-06 fixture test reveals new semantic drift.*
