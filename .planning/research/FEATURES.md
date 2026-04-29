# Feature Research — Wisenet API Field Mapping

**Domain:** Data-source migration (Google Sheets → Wisenet SMS + Neon Postgres)
**Researched:** 2026-04-20
**Confidence:** **LOW overall** — see Research Blocker section. Current-dashboard field inventory is HIGH confidence (read directly from source). Wisenet endpoint/field claims are LOW confidence (could not reach the Postman documentation in this environment).

---

## Research Blocker — RESOLVED by Phase 1

**Status:** CLOSED. Phase 1 (2026-04-21) unblocked this by parsing the Postman collection Kevin exported and running empirical probes against the live Wisenet API at `https://api.wiseapp.live`.

**Deliverables that replaced this blocker:**
- `.planning/research/WISENET_ENDPOINTS.md` — parsed endpoint catalogue (120 endpoints across 21 folders)
- `.planning/research/WISENET_FIELD_MAP.md` — master field map (25 rows: 15 GREEN, 4 YELLOW, 6 RED with structured decisions; supersedes this file's `## Wisenet API — Field Mapping (Unverified Hypothesis)` section)
- `.planning/research/fixtures/wisenet/*.json` — empirical probe fixtures (auth + pagination + rate-limit fingerprints + 6 resource samples, all PII-scrubbed)
- `.planning/phases/01-wisenet-discovery/01-PHASE-SUMMARY.md` — phase handoff document for Phase 2

The sections below are preserved for historical context. **For current field-mapping truth, go to `.planning/research/WISENET_FIELD_MAP.md`.** For verified auth / pagination / rate-limit facts, see `.planning/phases/01-wisenet-discovery/01-PHASE-SUMMARY.md` §Technical Findings.

<!-- original blocker text follows, unchanged -->

**The primary research source was unreachable from this environment.**

- Target: `https://documenter.getpostman.com/view/17903053/2sA3XPChyE`
- The Postman public documenter is a client-rendered single-page app. `WebFetch` converts HTML to markdown without executing JavaScript, so the returned content for this URL is literally just the page title ("Wise APIs") with no endpoints, schemas, headers, or auth details extractable.
- `WebSearch`, `Bash` network calls (e.g. `curl`), and `WebFetch` to alternative domains (postman.com, wisenet.co) were all denied by the sandbox policy in effect for this run.
- Consequence: I cannot cite specific endpoint paths (e.g., `GET /api/v1/students/{id}`), confirm the authentication scheme, rate limits, or pagination behavior from the authoritative source. The quality gate item "Endpoints cited by name" **is not met** for this pass.

**What I can deliver with confidence:**
1. Exhaustive inventory of every field the current dashboard reads from Google Sheets (HIGH confidence — read directly from `web/src/lib/dashboard/*` and `web/src/lib/sheets/*` in this repo).
2. A structured gap analysis *template* that slots Wisenet fields against the dashboard contract.
3. Hypotheses about typical Wisenet coverage based on the product category (student-management / CRICOS-oriented RTO platforms typically expose a specific set of primitives).

**What unblocks this research:**
- Any ONE of the following supplies the missing Wisenet-side truth:
  - Export the Postman collection as JSON from the "Wise APIs" documenter (Postman UI → ... → "Export Collection") and drop the file at `.planning/research/wisenet-postman.json`. I can then parse it directly.
  - Share the Wisenet public API reference URL if one exists outside the Postman documenter.
  - Paste a sample response for one student + one enrolment + one session into this folder and I can infer the shape.
  - Give me a sandbox API key plus a list of endpoints to hit (I'd need Bash network access re-enabled).

Everything below is explicitly partitioned into **Verified (current dashboard)** and **Unverified hypothesis (Wisenet)** so the downstream requirements doc does not mistake the second for the first.

---

## Current Dashboard Field Inventory (Verified — HIGH confidence)

Source of truth: `web/src/lib/dashboard/config.ts` (`REQUIRED_COLUMNS`), `web/src/lib/sheets/source-loader.ts`, `web/src/lib/dashboard/packages.ts`, `web/src/lib/dashboard/analytics.ts`, `web/src/types/dashboard.ts`, plus `web/src/lib/sheets/actions.ts` + `inactive-students.ts` for state.

The dashboard consumes six Sheets tabs. Every field below must be present or derivable post-migration or the migration is blocked.

### 1. `Aggregations` tab (per student × package row)

| Field | Type | Consumed by | Role |
|-------|------|-------------|------|
| `Student Name` | string | `buildDashboardStudents` | Primary student identity + join key |
| `Parent Name` | string | `buildDashboardStudents` | Composite `studentKey` component |
| `Class Subject` | string | `buildDashboardStudents` | Package/subject name (dashboard calls this "package") |
| `Current Remaining Credits` | number | `buildDashboardStudents` | Drives balance column and alert/exhaust projection |
| `Current Total Credits` | number | `buildDashboardStudents` | Shown in detail view, drives deltas |

### 2. `Credit_Control` tab (per past session row)

| Field | Type | Consumed by | Role |
|-------|------|-------------|------|
| `Student Name` | string | `buildPendingDeductionContext` | Join |
| `Package/Program` | string | `buildPendingDeductionContext` | Join |
| `session_date` | date | `buildPendingDeductionContext` | Filter (past vs today) |
| `final_status` | enum ("ENDED" etc.) | `shouldCountAsPendingDeduction` | Gate for counting as pending deduction |
| `teacher_feedback` | string | `shouldCountAsPendingDeduction` | Gate — empty / `"0"` means not yet scored |
| `credits_consumed` | number | `shouldCountAsPendingDeduction` | Gate — must be 0 for pending |
| `session_duration` | number (minutes) | `buildPendingDeductionDetail` | Fallback deduction value |
| `Should_Credit` | number | `buildPendingDeductionDetail` | Primary deduction value (overrides duration) |
| `session_id` (optional) | string | `buildPendingDeductionDetail` | Surfaced in detail panel if present |

### 3. `Upcoming Sessions` tab (per future session row)

| Field | Type | Consumed by | Role |
|-------|------|-------------|------|
| `Student Name` | string | `buildUpcomingSessionMap` | Join |
| `Package/Program` | string | `buildUpcomingSessionMap` | Join |
| `Scheduled Date` | date | `buildUpcomingSessionMap` | Filter + calendar placement |
| `Session Status` | enum ("UPCOMING") | `buildUpcomingSessionMap` | Filter |
| `Session Duration` | number (minutes) | `buildUpcomingSessionMap` | Credit-per-week / projection math |

### 4. `Students` tab (per student row — activity filter)

| Field | Type | Consumed by | Role |
|-------|------|-------------|------|
| `student_name` | string | `buildActiveStudentSet` | Identity |
| `Remaining Credits` | string / number / "N/A" | `buildActiveStudentSet` | **Active filter** — students with "N/A" or empty are dropped |

### 5. `Students & Courses` tab (per enrolment row — exclusion signal)

| Field | Type | Consumed by | Role |
|-------|------|-------------|------|
| `Student Name` | string | `buildExcludedPackageReasons` | Join |
| `Class Name` | string | `buildExcludedPackageReasons` | Exclusion keyword check (`pretest`, `trial`) |
| `Class Subject` | string | `buildExcludedPackageReasons` | Exclusion keyword check (`pretest`, `trial`) |

### 6. `RemainingCredits` tab (admin ownership)

| Field | Type | Consumed by | Role |
|-------|------|-------------|------|
| `Student` | string | `buildStudentAdminOwnershipMap` | Identity |
| `Admin` | string | `buildStudentAdminOwnershipMap` | Name-matched against `ADMIN_OWNER_REGISTRY` (6 named admins) → owning admin key |

### 7. State currently in Sheets (will move to Postgres, NOT to Wisenet)

- `DashboardActionsState` — follow-up status per student (contacted / pending-callback / resolved)
- `DashboardActionLog` — append-only follow-up audit log
- `InactiveStudents` — manual soft-delete list with auto-reactivation when a student reappears with active packages

Per the "Write-back to Wisenet" anti-feature rule in `PROJECT.md`, these stay on the dashboard side (Neon Postgres) and are **not** migration concerns against Wisenet.

---

## Wisenet API — Field Mapping (Unverified Hypothesis — LOW confidence)

> **SUPERSEDED:** This section's LOW-confidence hypothesis rows have been verified and replaced by `.planning/research/WISENET_FIELD_MAP.md` via Phase 1 probes (2026-04-21). The rows below are preserved for comparison with what was actually discovered; do NOT treat them as current truth. For the verified field-by-field mapping (25 rows, 15 GREEN / 4 YELLOW / 6 RED) with fixture evidence and RED decisions, go to `WISENET_FIELD_MAP.md`.

<!-- original hypothesis content follows, unchanged -->

**Caveat:** Every row below is a *hypothesis* from pattern-matching Wisenet's positioning as a CRICOS / RTO-oriented student management system. They need explicit verification against the Postman collection before any of them enter requirements.

**Notation:**
- `[DIRECT?]` — plausibly a single field on a Wisenet resource
- `[DERIVED?]` — likely must be computed from one or more Wisenet responses
- `[GAP?]` — I do not expect Wisenet to expose this (flag for explicit user discussion)
- `[TBD]` — cannot even hypothesize without seeing the collection

### Student identity

| Dashboard field | Likely Wisenet source | Confidence | Notes |
|-----------------|----------------------|------------|-------|
| `Student Name` | `[DIRECT?]` Student resource, `firstName` + `lastName` or full name | LOW | Almost every SMS exposes this — very high prior |
| `Parent Name` | `[DIRECT? / DERIVED?]` Parent/guardian relationship on a student, or a linked "Contact" record | LOW | RTOs frequently model guardians separately; current dashboard uses name string only, so any stable name field works |
| (Optional) `email`, `phone` | `[DIRECT?]` on student or parent | LOW | Not consumed today, but likely needed for any LINE-preview / contact features |

### Package / enrolment

Current dashboard's "package" concept blends two Wisenet concepts: a *course* (product catalogue) and an *enrolment* (instance of a student in a course). Field mapping likely spans both.

| Dashboard field | Likely Wisenet source | Confidence | Notes |
|-----------------|----------------------|------------|-------|
| `Class Subject` / package name | `[DIRECT?]` Course / Class / Subject resource, `name` | LOW | Wisenet almost certainly exposes a named course/subject entity |
| `Class Name` (exclusion signal `pretest`/`trial`) | `[DIRECT?]` Same or a class-type field | LOW | Exclusion rule is keyword-based; any string field naming the class works |
| Package start / expiry | `[DIRECT? / DERIVED?]` Enrolment `startDate` / `endDate` | LOW | Current dashboard doesn't explicitly consume these, but the exhaustion projection is effectively a derived expiry |
| Enrolment status (active/inactive) | `[DIRECT?]` Enrolment `status` field | LOW | This likely replaces the hacky `Remaining Credits != "N/A"` activity filter — a POSITIVE consequence of the migration |

### Credit balance

This is the highest-risk mapping area. Wisenet's built-in credit-tracking model (if any) may or may not match BeGifted's.

| Dashboard field | Likely Wisenet source | Confidence | Notes |
|-----------------|----------------------|------------|-------|
| `Current Total Credits` | `[DIRECT? / GAP?]` Enrolment `totalCredits` / `purchasedHours` / `totalSessions` | LOW | Depends entirely on whether Wisenet tracks hour/credit balances natively; many RTO systems track competencies instead |
| `Current Remaining Credits` | `[DIRECT? / DERIVED?]` Either a balance field, OR `total - consumed` computed from session history | LOW | If Wisenet is competency-based (pass/fail), this may be a GAP and the number must be derived from duration math over session records |
| Pending-deduction math (unscored sessions where `final_status=ENDED` + `teacher_feedback` empty + `credits_consumed=0`) | `[DERIVED?]` Compute from Wisenet session records with status + feedback fields | LOW | The rule is BeGifted-specific; Wisenet almost certainly won't have this exact primitive. It will need to be derivable from session status + marking/feedback fields, or we will need to replicate the intent with whatever Wisenet exposes |
| `Should_Credit` override per session | `[GAP?]` | LOW | This reads like a manually-entered override column on the Sheet — Wisenet likely has no direct equivalent and we may need to keep this on the Postgres side, or drop the override |

### Session history

| Dashboard field | Likely Wisenet source | Confidence | Notes |
|-----------------|----------------------|------------|-------|
| Past sessions with `session_date`, `session_duration`, `final_status`, `teacher_feedback`, `credits_consumed` | `[DIRECT?]` Attendance / Session / Timetable record on an enrolment | LOW | This is the highest-value gain if Wisenet exposes it cleanly — would eliminate the `Credit_Control` sheet's raw-data role |
| Upcoming sessions (`Session Status = "UPCOMING"`, `Scheduled Date`, duration) | `[DIRECT?]` Timetable / scheduled-class resource | LOW | Any decent SMS has a schedule; exposure over API is not a given |

### Admin / teacher ownership

Current rule: student has an "Admin" owner, resolved by majority-count of admin name across their rows in `RemainingCredits`, fallback to "unassigned." This is a BeGifted workflow concept.

| Dashboard field | Likely Wisenet source | Confidence | Notes |
|-----------------|----------------------|------------|-------|
| `Admin` (owning staff member for a student) | `[GAP? / DERIVED?]` Could be derived from enrolment's assigned trainer/teacher/coordinator, OR may not exist if Wisenet only models teacher-per-class not admin-per-student | LOW | High likelihood of genuine gap. Two options: (a) infer owner from a trainer field on enrolments, (b) store admin ownership in Postgres as BeGifted-specific metadata |

### Inactivity / follow-up signals

| Dashboard signal | Likely Wisenet source | Confidence | Notes |
|------------------|----------------------|------------|-------|
| "No upcoming sessions scheduled" | `[DERIVED?]` Absence of future timetable entries for the student's enrolments | LOW | If schedule endpoint exists, this derives cleanly |
| "Low balance + no schedule" | `[DERIVED?]` Balance-field + schedule-absence combination | LOW | Derivable if balance and schedule are both available |
| Operator-marked `InactiveStudents` | **N/A — stays in Postgres** | HIGH | Per PROJECT.md, this is a dashboard-side concept, not Wisenet-backed |

### Payment / invoice state

The current dashboard does **not** consume any payment or invoice field today — it only sees credits as a balance of teaching units, not money.

| Potential new signal | Likely Wisenet source | Confidence | Notes |
|----------------------|----------------------|------------|-------|
| Payment-overdue flag per student | `[DIRECT? / DERIVED?]` Invoice / payment resource with `status`, `dueDate`, `amountOutstanding` | LOW | If Wisenet exposes invoicing, this is a **differentiator** — new data the dashboard has never had |
| Last payment date | `[DIRECT?]` Payment record | LOW | Same — net-new |

### Notes / tags / custom fields

| Signal | Likely Wisenet source | Confidence | Notes |
|--------|----------------------|------------|-------|
| Arbitrary notes per student | `[DIRECT?]` Notes endpoint | LOW | Common feature; would replace some ad-hoc sheet columns if present |
| Tags / flags | `[DIRECT?]` Tags or custom-fields endpoint | LOW | If Wisenet supports tags, could replace the `Class Name / Class Subject` keyword-exclusion hack with explicit tag filtering |

---

## Auth / Pagination / Rate Limits (Unverified — LOW confidence)

> **SUPERSEDED:** See `.planning/phases/01-wisenet-discovery/01-PHASE-SUMMARY.md` §Technical Findings for verified facts (auth variant 1 = HTTP Basic + x-api-key + x-wise-namespace; pagination = page_number/page_size; rate-limit = headerless enforcement, no 429 at 200-burst). See `.planning/research/fixtures/wisenet/_auth-fingerprint.json`, `_pagination-fingerprint.json`, `_rate-limit-fingerprint.json` for probe evidence. The hypothesis below is preserved for historical context.

<!-- original hypothesis content follows, unchanged -->

Per the quality gate, these must be confirmed from the Postman docs before being treated as fact. I cannot confirm from this environment.

**From the credentials set the user has (per `PROJECT.md`):** User ID, Center ID, API Key, namespace `begifted-education`.

- The presence of a distinct **Center ID** alongside an **API Key** strongly suggests a multi-tenant SaaS where the center scopes queries — common patterns are `x-api-key: <key>` header plus either a URL path segment (`/api/v1/centres/{centerId}/...`) or a header (`x-centre-id`). **This is a guess, not verified.**
- **Namespace `begifted-education`** is likely a subdomain (e.g., `begifted-education.wisenet.co`) or a path prefix. **Guess.**
- **User ID** alongside API key is less standard — could be required for audit / write attribution, or for HMAC-style request signing. **Unclear.**
- Rate limits: **TBD** — nothing to report.
- Pagination: **TBD** — nothing to report.
- Webhooks / real-time: **TBD** — nothing to report. Assumption until proven otherwise: **pull-only.**

---

## Table Stakes / Gaps / Differentiators / Anti-Features (for requirements definition)

### Table stakes — every one of these MUST resolve to a Wisenet-reachable field or the migration is blocked

| Need | Dashboard field(s) | Migration status |
|------|--------------------|------------------|
| Identify active students | `Students.student_name` + `Remaining Credits != "N/A"` | **Verify** Wisenet exposes enrolment-status (active/inactive) so we can stop using the null-check hack |
| Student display name + parent name for queue / LINE preview | `Aggregations.Student Name`, `Aggregations.Parent Name` | **Verify** direct fields exist |
| Package name to group / join by | `Aggregations.Class Subject` | **Verify** course/subject resource is reachable |
| Current remaining credits per package | `Aggregations.Current Remaining Credits` | **Verify high-risk** — may be native or may require derivation from session history |
| Current total credits per package | `Aggregations.Current Total Credits` | **Verify high-risk** — same as above |
| Past sessions with status/feedback/consumed/duration fields for pending-deduction math | 6 `Credit_Control` fields | **Verify high-risk** — depends on whether Wisenet's attendance model matches |
| Future sessions (upcoming) with date + duration + status | 5 `Upcoming Sessions` fields | **Verify** — needs a schedule/timetable endpoint |
| Exclusion signal for `pretest` / `trial` classes | `Students & Courses.Class Name` + `Class Subject` | **Verify low-risk** — any string field naming the class enables the keyword filter; tags would be cleaner |
| Admin owner per student | `RemainingCredits.Admin` majority-vote | **Likely gap** — may have to keep this in Postgres as BeGifted metadata |

### Gaps (flag for Kevin to decide before requirements are frozen)

1. **`Should_Credit` manual override** — If Wisenet has no per-session override field, we need a decision: (a) drop the override entirely, (b) keep an override column in Postgres keyed by Wisenet session ID, (c) ask Wisenet to expose a custom field we can write.
2. **Admin ownership semantics** — Wisenet likely models teacher-per-class, not admin-per-student. Decide whether admin ownership stays in Postgres as dashboard-side metadata or we derive from a Wisenet trainer/coordinator field.
3. **Credit-balance model** — If Wisenet is competency-based rather than hour/credit-tracking, `Current Remaining Credits` and `Current Total Credits` are derived figures, not direct fields. This affects caching strategy significantly (derivation is more expensive than read).
4. **Pending-deduction rule semantics** — The rule `final_status = "ENDED" AND teacher_feedback is empty AND credits_consumed = 0 → count as pending` is a BeGifted-specific combination. Whether Wisenet exposes all three ingredients is uncertain.

### Differentiators (net-new data the migration could surface — use as ammo for post-cutover roadmap, NOT blockers)

| Differentiator | Why valuable | Complexity |
|----------------|--------------|------------|
| Invoice / payment status per student | Dashboard has never had this; enables payment-overdue triage queue | MEDIUM — assumes invoice endpoint exists |
| Attendance-rate / engagement metrics | Beyond "session happened" to "did the student show up / submit work" | MEDIUM |
| Notes / tags from Wisenet | Operators may already be leaving context in Wisenet we can surface | LOW if endpoint is straightforward |
| Real-time invalidation via webhooks | Remove the 60s `unstable_cache` staleness for state changes | HIGH — depends on Wisenet supporting webhooks at all |
| Richer enrolment timeline (start date, expiry, renewal history) | Adds context beyond "how many credits left" | MEDIUM |

### Anti-features (explicitly OUT of scope — do not build)

| Anti-feature | Why out |
|--------------|---------|
| Writing follow-up status back to Wisenet (custom field, note, tag) | `PROJECT.md` Out-of-Scope: follow-up state goes to Postgres, Wisenet stays read-only |
| Creating/editing students, enrolments, sessions, or invoices in Wisenet | Out of scope for this milestone — operators still use the Wisenet UI for those writes |
| Nightly parity diff against the old Sheets stack | `PROJECT.md` Out-of-Scope: cutover mode is "just cut over" |
| Importing historical follow-up state from the action sheets into Postgres | `PROJECT.md` Out-of-Scope: start fresh |
| New Apps Script features | `PROJECT.md` Out-of-Scope: Apps Script is retiring this milestone |

---

## Feature Dependencies (within-migration)

```
[Wisenet endpoint discovery]
    └──required-by──> [Field mapping confirmation]
                             └──required-by──> [Dashboard data-access layer replacement]
                                                     └──required-by──> [Parity validation]

[Postgres schema design for follow-up state]
    └──independent of──> [Wisenet discovery]
    └──required-by──> [Dashboard action write path]

[Admin-ownership decision (Wisenet-derived vs Postgres-stored)]
    └──required-by──> [Queue admin-filter feature continuity]
```

**Read this:** The Wisenet endpoint discovery blocks roughly half the migration work, because the shape of the read layer depends on what Wisenet returns and how expensive it is to call. The Postgres side can start in parallel — it's independent.

---

## Prioritization (for the requirements doc that consumes this file)

| Requirement | User Value | Implementation Cost | Priority |
|-------------|------------|---------------------|----------|
| Read student + package + balance from Wisenet | HIGH (migration is meaningless without it) | HIGH (depends on Wisenet's model) | P1 |
| Read past sessions from Wisenet (for pending-deduction math) | HIGH | HIGH (6 fields must align) | P1 |
| Read upcoming sessions from Wisenet (for calendar + projection) | HIGH | MEDIUM | P1 |
| Persist follow-up state to Postgres | HIGH | MEDIUM | P1 |
| Retain admin-ownership feature | MEDIUM | MEDIUM (likely Postgres-backed) | P2 |
| Surface payment / invoice status (differentiator) | MEDIUM | MEDIUM | P3 (post-cutover) |
| Real-time webhook invalidation | LOW | HIGH (depends on Wisenet capability) | P3 (post-cutover) |

---

## Sources

**Verified (this repo):**
- `web/src/lib/dashboard/config.ts` — `REQUIRED_COLUMNS`, sheet-name constants, admin registry, exclusion keywords
- `web/src/lib/dashboard/packages.ts` — field-consumption logic for all six sheets
- `web/src/lib/dashboard/analytics.ts` — queue / calendar / summary aggregation
- `web/src/types/dashboard.ts` — `PackageRecord`, `StudentRecord`, `StudentQueueRow`, `CalendarPayload`, `SummaryPayload`, `ActionState`
- `web/src/lib/sheets/actions.ts`, `web/src/lib/sheets/inactive-students.ts` — current follow-up state writes
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/INTEGRATIONS.md`
- `.planning/PROJECT.md` — in-scope / out-of-scope decisions

**Attempted (unreachable):**
- `https://documenter.getpostman.com/view/17903053/2sA3XPChyE` — target source, JS-rendered SPA that `WebFetch` cannot execute, returns only the page title
- Alternative domains (postman.com collection API, wisenet.co developer portal) — `WebFetch` permission denied in this sandbox
- `WebSearch` — permission denied in this sandbox
- `Bash` network calls (curl) — permission denied in this sandbox

---

*Research partially blocked — see Research Blocker section at top. Current-dashboard inventory is HIGH confidence; all Wisenet-side claims are LOW confidence and need verification before requirements definition.*
