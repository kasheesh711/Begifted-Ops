# Requirements: BeGifted Ops — Wisenet Migration

**Defined:** 2026-04-20
**Core Value:** Operators can trust the dashboard as a single source of truth for who to follow up with and what credit / package state each student is in — without any manual sheet syncing.

## v1 Requirements

### Wisenet Discovery

- [x] **WISE-01**: Every current dashboard field (from `web/src/lib/dashboard/config.ts::REQUIRED_COLUMNS` and `web/src/types/dashboard.ts`) is mapped to a specific Wisenet endpoint and field
- [x] **WISE-02**: `.planning/research/WISENET_FIELD_MAP.md` written, with every mapping row classified GREEN (direct), YELLOW (derived), or RED (gap)
- [x] **WISE-03**: Every RED (gap) row has an explicit decision: derive client-side, accept-loss, move to Postgres sidecar, or block cutover
- [x] **WISE-04**: Wisenet auth scheme documented (header names, token format, base URL) from the Postman collection
- [x] **WISE-05**: Wisenet pagination pattern and rate-limit behavior documented via empirical probes against a real endpoint
- [x] **WISE-06**: The 4 known gap questions answered: `Should_Credit` manual override, admin ownership semantics, credit-balance model (direct vs derived), pending-deduction rule field availability

### Wisenet Client

- [x] **WCLI-01**: `lib/wisenet/client.ts` — authenticated fetch wrapper with timeout, retry, structured error shape
- [x] **WCLI-02**: `lib/wisenet/types.ts` — TypeScript types for every Wisenet response the dashboard uses (hand-authored from real responses, not guessed)
- [x] **WCLI-03**: `lib/wisenet/endpoints.ts` — one async function per Wisenet resource (students, packages, sessions, credits)
- [x] **WCLI-04**: `lib/wisenet/mappers.ts` — normalize Wisenet JSON into the existing `DashboardSources` shape so `lib/dashboard/build.ts` is unchanged
- [x] **WCLI-05**: Zod (or equivalent) validates every Wisenet response at the boundary; string-vs-number and date coercions are explicit
- [x] **WCLI-06**: Fixture-driven Vitest tests for mappers under `web/src/test/fixtures/wisenet/*.json` — recorded real responses
- [x] **WCLI-07**: Wisenet credentials loaded via `getWisenetEnv()` in `lib/runtime/env.ts`; never referenced from a client-bundle module

### Postgres Data Layer

- [x] **DB-01**: Neon Postgres provisioned via Vercel Marketplace; `DATABASE_URL` and pooled-URL auto-injected to production, preview, and development environments
- [x] **DB-02**: Drizzle schema (`lib/db/schema.ts`) defines `follow_up_state`, `follow_up_log`, `inactive_students`; initial migration SQL committed to `lib/db/migrations/`
- [x] **DB-03**: Connection-pool singleton (`globalThis.__bgPgPool ??= ...` with `max: 3`) uses the Neon pooled URL; safe under Fluid Compute burst scaling
- [x] **DB-04**: `lib/db/queries.ts` exposes typed functions: `loadActionStateMap`, `upsertFollowUpState`, `appendFollowUpLog`, `listInactive`, `markInactive`, `clearInactive`, `readHistory`
- [x] **DB-05**: Same-day action-state visibility rule preserved in domain layer (`lib/dashboard/action-state.ts::sanitizeActionStateMap`)
- [x] **DB-06**: Every write attributes actor (`actor_email`, `actor_name`) from NextAuth session into log rows
- [x] **DB-07**: Bulk-action write (e.g. 50 students in one transaction) completes in one round-trip via batched `INSERT ... VALUES (...)`
- [x] **DB-08**: `scripts/db-migrate.ts` runs migrations outside the app startup path (not from `instrumentation.ts`, not from a `postbuild` hook)

### Service Cutover

- [x] **SVC-01**: `cacheComponents: true` enabled in `next.config.ts` (Plan 03-01, commit cdc2ebe, 2026-04-29)
- [x] **SVC-02**: `lib/dashboard/service.ts::getDashboardPayload` rewritten to compose Wisenet read + Postgres read; cached via `'use cache: remote'` + `cacheTag('dashboard-payload')` + `cacheLife({ stale: 60, revalidate: 60, expire: 300 })` (Plan 03-03, commit 0ef5f73, 2026-04-30)
- [x] **SVC-03**: Every mutating facade method (`setStudentAction`, `clearStudentAction`, `bulkSetAction`, `markInactiveStudent`, `clearInactiveStudent`) writes to Postgres FIRST then calls `revalidateTag(DASHBOARD_CACHE_TAG, "max")` SECOND per D-28 (Plan 03-04, commit ff33a11, 2026-04-30) — note: revalidateTag two-arg form replaces the originally-specified updateTag because route handlers in 03-05 will call these methods, and updateTag does not work from route handlers per RESEARCH §Critical Finding #1
- [x] **SVC-04**: Route handlers `/api/dashboard`, `/api/actions`, `/api/actions/bulk`, `/api/actions/history`, `/api/inactive` updated to new service methods (Plan 03-05, commit 73698c5, 2026-04-30); `/api/health` already covered by Plan 03-06 SVC-07; public JSON response shapes preserved for existing clients (one consumer-aligning rename: `/api/actions/history` returns `{ history }` to match what student-detail.tsx already expects)
- [ ] **SVC-05**: `lib/sheets/`, `lib/cache/memory-cache.ts`, `lib/dashboard/snapshot-store.ts`, `lib/dashboard/actions.ts` deleted after cutover verified
- [ ] **SVC-06**: `googleapis` dependency removed from `web/package.json`
- [x] **SVC-07**: `/api/health` probes both Wisenet (HEAD or cheap read) and Postgres (`SELECT 1`) and returns structured status (Plan 03-06, commit 18a7728, 2026-04-30)
- [x] **SVC-08**: Dashboard Student Detail renders a Day-1 archive-link affordance pointing operators at the legacy action sheets (until retirement is complete) (Plan 03-02, commit 1fbd42a, 2026-04-30)

### Testing

- [x] **TEST-01**: All 41 `Validation.gs` assertions ported to Vitest tests (balance logic, student action-state, same-day visibility, exclusion rules, etc.); suite green before SVC-05 deletions ship — Batch A (9 packages + 4 projection + 4 pending-deduction = 17 tests) landed in 02-07; Batch B (queue + calendar = ~5 tests) lands in 02-08; 17 Apps Script carve-outs enumerated as NOT ported
- [x] **TEST-02**: Existing 45+ `dashboard-logic.test.ts` Vitest fixtures pass unchanged when driven by Wisenet-mapper outputs (facade parity gate)
- [x] **TEST-03**: Cache-invalidation regression test: write to `follow_up_state` → subsequent `getDashboardPayload()` reflects the write (catches the historical `revalidateTag(..., "max")` class of bugs)
- [ ] **TEST-04**: Load test at 50 concurrent `/api/actions` requests; no Neon pool exhaustion errors; p95 < 500ms
- [x] **TEST-05**: Zod boundary tests: given Wisenet returning `"2"` (string) for a credit balance field, the system treats it as number `2` throughout the business pipeline
- [ ] **TEST-06**: Wisenet HTTP chunked-transfer and HTTP -1 regression: a mocked `getDashboardPayload` under streaming response simulation still renders

### Deploy Hardening

- [ ] **DEPL-01**: `TZ=Australia/Sydney` set in Vercel production AND preview environments
- [ ] **DEPL-02**: `next-auth` pinned to exact version `5.0.0-beta.30` in `package.json` (no caret); Dependabot configured to ignore it
- [ ] **DEPL-03**: Playwright E2E Google sign-in test running post-deploy on every Vercel preview; failure blocks promotion
- [ ] **DEPL-04**: Error tracking (Sentry or Vercel Agent) installed; Wisenet 4xx/5xx, Postgres errors, and unhandled exceptions reported with deployment-version context
- [ ] **DEPL-05**: Dev-mode auth secret fallback (currently `"local-dev-secret"` in `lib/runtime/env.ts`) throws in `NODE_ENV=production`
- [ ] **DEPL-06**: Every `/api/*` response carries an `X-BG-Deploy-Id` header (Vercel deployment SHA) so incident triage can tie failures to exact deploys — addresses the HTTP -1 / stale-deployment class of incidents flagged in `CLAUDE.md`

### Apps Script Retirement

- [ ] **RETI-01**: Apps Script web app flipped to a static "Moved" page pointing operators at the Next.js URL (NOT "deployed stopped" — that triggers HTTP -1)
- [ ] **RETI-02**: 30-day zero-legacy-traffic observation window before full decommission (Moved-page hit logs monitored)
- [ ] **RETI-03**: `DashboardActionLog`, `DashboardActionsState`, `InactiveStudents`, and the source-of-truth sheets snapshotted to CSV in an immutable archive location owned by a BeGifted Workspace account (not a personal Google account) before decommission
- [ ] **RETI-04**: `docs/ARCHIVE_2026-04.md` manifest written: spreadsheet IDs, owners, schemas, snapshot location, retention policy
- [ ] **RETI-05**: `.gs` source files archived to `docs/archive/apps-script-2026-04/` and removed from repo root; `clasp` dev-dependency removed
- [ ] **RETI-06**: `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/WORKFLOW.md`, `docs/nextjs-shadow-handoff.md` updated — Apps Script operational guidance removed or marked historical; `runValidationSuite` / `runLiveAccuracyAudit` references replaced by Vitest commands

## v2 Requirements

Deferred to a later milestone. Tracked but not in current roadmap.

### Operational Upgrades

- **OPS-01**: Wisenet webhook subscription (if supported) for real-time cache invalidation instead of time-based `cacheLife` revalidation
- **OPS-02**: Per-student Runtime Cache tags (`student:<key>`) so a single write invalidates one student's view rather than the whole dashboard payload — only needed beyond ~20 admins / 3K students
- **OPS-03**: Scheduled Postgres backup job (independent of Neon's built-in backups) to a third-party immutable store for disaster-recovery compliance

### Reporting

- **RPT-01**: Weekly follow-up volume report (joins `follow_up_log` by operator + week)
- **RPT-02**: Student churn / re-activation analytics from Wisenet enrolment state over time
- **RPT-03**: Admin ownership derived from Wisenet trainer field (if Phase 1 discovery reveals workable mapping — otherwise stays in Postgres sidecar)

### UX

- **UX-01**: Re-introduce the performance work from the discarded `codex/dashboard-load-performance` branch on top of the migrated stack (if still desired)
- **UX-02**: Inline search across students by fuzzy name match against Wisenet student list

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Parallel shadow-compare against Apps Script/Sheets | User explicitly chose "just cut over" — tests + operator sign-off replace continuous parity diff |
| Historical follow-up state import from action sheets into Postgres | User chose "start fresh" — action sheets remain read-only archive |
| Writing follow-up state back to Wisenet custom fields | User chose Postgres as the application-owned store; Wisenet stays read-only for this app |
| Secret rotation and `.gitignore` hardening as a milestone phase | User handles these manually outside the roadmap (no "Phase 0") |
| New Apps Script features | Apps Script is on a retirement path; no net-new `.gs` logic during this milestone |
| Non-Google OAuth providers | NextAuth stays Google-only; no scope for Microsoft/Apple/magic-link |
| In-progress `codex/dashboard-load-performance` branch work | Migration rewrites the same surface; perf work rebased/discarded, potentially reintroduced as v2 |
| Vercel Queues for async log writes | Overkill at current scale (6 admins); revisit at 100+ admins per scaling matrix |
| Cutover feature flags / A/B toggles | 6 admins — A/B buys nothing; module-swap PRs are the cutover mechanic instead |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WISE-01 | Phase 1 | Complete |
| WISE-02 | Phase 1 | Complete |
| WISE-03 | Phase 1 | Complete |
| WISE-04 | Phase 1 | Complete |
| WISE-05 | Phase 1 | Complete |
| WISE-06 | Phase 1 | Complete |
| WCLI-01 | Phase 2 | Complete |
| WCLI-02 | Phase 2 | Complete |
| WCLI-03 | Phase 2 | Complete |
| WCLI-04 | Phase 2 | Complete |
| WCLI-05 | Phase 2 | Complete |
| WCLI-06 | Phase 2 | Complete |
| WCLI-07 | Phase 2 | Complete |
| DB-01 | Phase 2 | Complete |
| DB-02 | Phase 2 | Complete |
| DB-03 | Phase 2 | Complete |
| DB-04 | Phase 2 | Complete |
| DB-05 | Phase 2 | Complete |
| DB-06 | Phase 2 | Complete |
| DB-07 | Phase 2 | Complete |
| DB-08 | Phase 2 | Complete |
| SVC-01 | Phase 3 | Complete (Plan 03-01, 2026-04-29) |
| SVC-02 | Phase 3 | Complete (Plan 03-03, 2026-04-30) |
| SVC-03 | Phase 3 | Complete (Plan 03-04, 2026-04-30) |
| SVC-04 | Phase 3 | Complete (Plan 03-05, 2026-04-30) |
| SVC-05 | Phase 3 | Pending |
| SVC-06 | Phase 3 | Pending |
| SVC-07 | Phase 3 | Complete (Plan 03-06, 2026-04-30) |
| SVC-08 | Phase 3 | Complete (Plan 03-02, 2026-04-30) |
| TEST-01 | Phase 2 | Complete |
| TEST-02 | Phase 2 | Complete |
| TEST-03 | Phase 2 | Complete |
| TEST-04 | Phase 3 | Pending |
| TEST-05 | Phase 2 | Complete |
| TEST-06 | Phase 3 | Pending |
| DEPL-01 | Phase 4 | Pending |
| DEPL-02 | Phase 4 | Pending |
| DEPL-03 | Phase 4 | Pending |
| DEPL-04 | Phase 4 | Pending |
| DEPL-05 | Phase 4 | Pending |
| DEPL-06 | Phase 4 | Pending |
| RETI-01 | Phase 5 | Pending |
| RETI-02 | Phase 5 | Pending |
| RETI-03 | Phase 5 | Pending |
| RETI-04 | Phase 5 | Pending |
| RETI-05 | Phase 5 | Pending |
| RETI-06 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 47 total
- Mapped to phases: 47 (100%) ✓
- Unmapped: 0

**Phase totals:**
- Phase 1 (Wisenet Discovery): 6 requirements
- Phase 2 (Data Layer): 19 requirements (7 WCLI + 8 DB + 4 TEST)
- Phase 3 (Service Cutover): 10 requirements (8 SVC + 2 TEST)
- Phase 4 (Deploy Hardening): 6 requirements
- Phase 5 (Apps Script Retirement): 6 requirements

---
*Requirements defined: 2026-04-20*
*Last updated: 2026-04-30 — Phase 3 Plan 03-06 closed; SVC-07 flipped to Complete (Phase 1 closed 2026-04-21 with WISE-01..06; Phase 2 closed 2026-04-21 with WCLI-01..07 + DB-01..08 + TEST-01/02/03/05; Phase 3 SVC-01 closed 2026-04-29; Phase 3 SVC-08 closed 2026-04-30 in Plan 03-02; Phase 3 SVC-02 closed 2026-04-30 in Plan 03-03; Phase 3 SVC-03 closed 2026-04-30 in Plan 03-04; Phase 3 SVC-07 closed 2026-04-30 in Plan 03-06)*
