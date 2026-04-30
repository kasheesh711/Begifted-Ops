# Roadmap: BeGifted Ops — Wisenet Migration

**Created:** 2026-04-20
**Granularity:** standard (5 phases, 3-5 plans each)
**Parallelization:** enabled
**Core Value:** Operators can trust the dashboard as a single source of truth for who to follow up with and what credit / package state each student is in — without any manual sheet syncing.

## Overview

Five-phase migration from the Google Sheets + Apps Script hybrid stack to a single Next.js app reading from Wisenet + Neon Postgres. Phases flow from documentation-only discovery (Phase 1) through the data layer build-out in parallel with validation-port coverage (Phase 2), a single high-risk cutover PR that rewires the service and retires `lib/sheets/` (Phase 3), deploy hardening to make the cutover rollback-safe (Phase 4), and a 30-day Apps Script retirement tail with archival (Phase 5).

**Build-order dependencies** (encoded from `research/ARCHITECTURE.md` and the user's constraints):

1. Phase 1 produces `WISENET_FIELD_MAP.md` — Phase 2 cannot start until every `REQUIRED_COLUMNS` row is classified GREEN/YELLOW/RED AND the 4 gap questions are decided.
2. Phase 2's two halves — Wisenet client (WCLI-*) and Postgres data layer (DB-*) — can parallelize; TEST-01 (41 Validation.gs ports) is a hard gate at the end of Phase 2 before Phase 3.
3. Phase 3 depends on BOTH halves of Phase 2 being green. It is one atomic cutover PR — the old `lib/sheets/` path stays live until this phase ships.
4. Phase 4 requires Phase 3's new service surface to exist (E2E sign-in and `X-BG-Deploy-Id` only meaningful against the migrated app).
5. Phase 5 cannot start until DEPL-03 (E2E sign-in) is green AND TEST-01 (Validation.gs ports) is green — retirement has no fallback if auth or coverage regresses.

**What's NOT in the roadmap** (per user constraints):

- No Phase 0 housekeeping (secret rotation, `.gitignore` hardening, branch triage handled manually)
- No nightly shadow-compare — tests + operator sign-off are the cutover safety net
- No feature flags — module-swap PRs are the cutover mechanic
- No migration of historical follow-up state — action sheets stay as read-only archive
- No Wisenet write-back — Wisenet stays read-only

## Phases

- [x] **Phase 1: Wisenet Discovery** — Produce field-map matrix, answer the 4 gap questions, fingerprint auth / pagination / rate limits. Docs-only, no code commits. **COMPLETE 2026-04-21** — 5/5 plans, all 6 WISE-* requirements closed, 01-PHASE-SUMMARY.md shipped as Phase 2 handoff.
- [ ] **Phase 2: Data Layer** — Build Wisenet client + Postgres schema + queries in parallel; port all 41 Validation.gs assertions; wire cache-invalidation regression test. Service.ts untouched, old Sheets path still live.
- [ ] **Phase 3: Service Cutover** — Enable `cacheComponents`, rewire `service.ts` to compose Wisenet + Postgres, delete `lib/sheets/` / `memory-cache.ts` / `snapshot-store.ts` / `actions.ts`, remove `googleapis`, ship Day-1 archive-link affordance.
- [ ] **Phase 4: Deploy Hardening** — Set `TZ=Australia/Sydney`, pin NextAuth + Dependabot ignore, add Playwright E2E sign-in, install Sentry / observability, stamp `X-BG-Deploy-Id` on every API response, harden dev-mode auth fallback.
- [ ] **Phase 5: Apps Script Retirement** — Snapshot sheets to CSV, write archive manifest, flip Apps Script to "Moved" page (NOT deployed-stopped), archive `.gs` sources, update docs, wait 30 days with zero legacy traffic.

## Phase Details

### Phase 1: Wisenet Discovery
**Goal**: Produce the field-map matrix and empirical auth / pagination / rate-limit facts needed to unblock Phase 2 implementation. No code committed — the artifact is `.planning/research/WISENET_FIELD_MAP.md` plus updates to research docs.
**Depends on**: Nothing (first phase)
**Requirements**: WISE-01, WISE-02, WISE-03, WISE-04, WISE-05, WISE-06
**Success Criteria** (what must be TRUE):
  1. `.planning/research/WISENET_FIELD_MAP.md` exists and every dashboard field from `web/src/lib/dashboard/config.ts::REQUIRED_COLUMNS` has a row classified GREEN (direct), YELLOW (derived), or RED (gap) with a Wisenet endpoint + field name
  2. Every RED row has an explicit written decision: derive client-side, accept-loss, move to Postgres sidecar, or block cutover
  3. The 4 known gap questions are answered in writing: `Should_Credit` manual override disposition, admin ownership semantics, credit-balance model (direct vs derived), pending-deduction rule field availability
  4. Wisenet auth scheme (header names, token format, base URL), pagination pattern, and rate-limit behavior are documented from the real Postman collection and empirical probes (not guessed)
**Plans**: 5 plans
- [x] 01-01-PLAN.md — Wave 0 infrastructure: validator script, fixture directories, probe README, env.example placeholders
- [x] 01-02-PLAN.md — Wave 1: parse exported Postman collection into deterministic WISENET_ENDPOINTS.md catalogue
- [x] 01-03-PLAN.md — Wave 2: auth + pagination + rate-limit + field-shape probes with PII redaction
- [x] 01-04-PLAN.md — Wave 3: write WISENET_FIELD_MAP.md matrix + RED decisions + gap question answers + opportunities
- [x] 01-05-PLAN.md — Wave 4: full validator run + 01-PHASE-SUMMARY.md + update SUMMARY.md / FEATURES.md pointers (complete 2026-04-21)

### Phase 2: Data Layer
**Goal**: Stand up the Wisenet read client and Postgres write layer as parallel workstreams, with the 41 Validation.gs assertions ported to Vitest as the de-facto parity spec. At end of phase, fixture-driven Wisenet mappers produce valid `DashboardSources` AND the existing 45+ dashboard-logic tests pass against those mappers — but `service.ts` is untouched and the old Sheets path still serves production.
**Depends on**: Phase 1 (field map must classify every RED row before WCLI-04 mappers can be written)
**Requirements**: WCLI-01, WCLI-02, WCLI-03, WCLI-04, WCLI-05, WCLI-06, WCLI-07, DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-08, TEST-01, TEST-02, TEST-03, TEST-05
**Success Criteria** (what must be TRUE):
  1. `lib/wisenet/{client,endpoints,types,mappers}.ts` exists with Zod schemas at the boundary and fixture-driven tests green against `web/src/test/fixtures/wisenet/*.json`
  2. Neon Postgres is provisioned via Vercel Marketplace, `DATABASE_URL` + pooled URL auto-injected across environments, and `lib/db/{schema,client,queries}.ts` exposes typed query functions for follow-up state + inactive students + history
  3. All 41 `Validation.gs` assertions are ported to Vitest and the suite is green — including the `z.coerce` tests that catch string-vs-number coercion bugs
  4. A cache-invalidation regression test exists and passes: write to `follow_up_state` → subsequent `getDashboardPayload()` call reflects the write (catches the historical `revalidateTag(..., "max")` class of bugs)
  5. `getWisenetEnv()` lives in `lib/runtime/env.ts`, never referenced from client-bundle code; migrations run via `scripts/db-migrate.ts` outside app startup path
**Plans**: 10 plans
- [x] 02-01-PLAN.md — Wave 0 scaffolding (deps, env accessors, fixture copy, drizzle.config.ts) — DB-01, WCLI-07
- [x] 02-02-PLAN.md — Wave 1 Wisenet client core (retry.ts, types.ts, client.ts) — WCLI-01, WCLI-02, WCLI-05
- [x] 02-03-PLAN.md — Wave 2 Wisenet endpoints (7 resource functions + paginate) — WCLI-03
- [x] 02-04-PLAN.md — Wave 3 Mappers + TEST-02 fixture adapter (buildDashboardSourcesFromWisenet + composeDashboardSourcesFromData + dashboard-logic wisenet parity block) — WCLI-04, WCLI-06, TEST-02
- [x] 02-05-PLAN.md — Wave 1 DB schema + migration SQL + clients (HTTP db, WebSocket bulkDb) — DB-02, DB-03
- [x] 02-06-PLAN.md — Wave 2 DB queries + bulk transaction (actor attribution type-enforced, D-07 atomicity) — DB-04, DB-05, DB-06, DB-07
- [x] 02-07-PLAN.md — Wave 1 TEST-01 port batch A (packages.test.ts + projection.test.ts + pending-deduction.test.ts; 17 tests; 17 Apps Script tests documented as not-ported) — TEST-01
- [x] 02-08-PLAN.md — Wave 2 TEST-01 port batch B (queue.test.ts + calendar.test.ts; 7 tests) — TEST-01
- [x] 02-09-PLAN.md — Wave 4 TEST-05 Zod coercion tests + TEST-03 deferral lint carve-out (revalidateTag-max anti-pattern block) — TEST-05, TEST-03
- [x] 02-10-PLAN.md — Wave 4 Operational scripts (db-migrate.ts + GH workflow + seed-admin-ownership.ts + README-db-ops.md) — DB-08

### Phase 3: Service Cutover
**Goal**: Atomically rewire `service.ts` from Sheets to Wisenet + Postgres in one high-risk PR. Preceded by a baseline-reconciliation plan that restores Sheets-era route handlers and commits the uncommitted Phase 1+2 work. Enable `cacheComponents`, route handlers unchanged to external clients, delete the old Sheets path and the per-process caches, remove `googleapis`. Ship the Day-1 archive-link affordance on Student Detail so operators can find pre-cutover history. Transfer cutover diff to prod-snapshot for Vercel deploy.
**Depends on**: Phase 2 (both WCLI and DB halves must be green; TEST-01 Validation.gs ports must pass before this ships)
**Requirements**: SVC-01, SVC-02, SVC-03, SVC-04, SVC-05, SVC-06, SVC-07, SVC-08, TEST-06
**Success Criteria** (what must be TRUE):
  1. `/api/dashboard` round-trip returns the payload composed from real Wisenet + Postgres data with the JSON shape unchanged for existing clients; `/api/actions`, `/api/actions/bulk`, `/api/actions/history`, `/api/inactive`, `/api/health` route handlers all hit the new service methods
  2. Every write path (`setStudentAction`, `clearStudentAction`, `bulk*`, `markInactive`, `clearInactive`) calls `revalidateTag('dashboard-payload', 'max')` after its Postgres commit (via 'use server' actions.ts facade), and subsequent reads reflect the write
  3. `lib/sheets/`, `lib/cache/memory-cache.ts`, `lib/dashboard/snapshot-store.ts`, `lib/dashboard/build.ts` are deleted and `googleapis` is removed from `web/package.json` — production build succeeds with zero references
  4. `/api/health` probes both Wisenet and Postgres and returns structured status (D-32 shape); Student Detail renders a visible Day-1 archive-link affordance pointing operators at the legacy action sheets
  5. A mocked chunked-transfer / Wisenet streaming response simulation still renders (TEST-06 reframed); cache-invalidation integration test exists gated on TEST_DATABASE_URL (TEST-03)
**Plans**: 11 plans
- [x] 03-00-PLAN.md — Wave 0: Baseline reconciliation — restore Sheets-era routes from prod-snapshot; commit Phase 1+2 source; commit .planning/ artifacts (D-40, D-41, D-43) (complete 2026-04-29; commits e339f39 / de8e5a2 / 396d7c8; 176 files)
- [x] 03-01-PLAN.md — Wave 1: Enable cacheComponents in next.config.ts (SVC-01) (complete 2026-04-29; commit cdc2ebe; 10 files — 1 config + 6 route handler runtime drops + 3 page Suspense wraps; build green, 164/164 tests)
- [x] 03-02-PLAN.md — Wave 1: Student Detail archive-link affordance + ARCHIVE_ACTION_SHEET_URL constant (SVC-08, D-30, D-36) (complete 2026-04-30; commit 1fbd42a; 2 files — config + student-detail; TODO placeholder URL queued for Plan 03-10 Pre-Merge Gate; build green, 164/164 tests)
- [x] 03-03-PLAN.md — Wave 2: Rewrite service.ts to compose Wisenet + Postgres with use-cache-remote + cacheTag + cacheLife; create logger.ts; flip lint (SVC-02, D-37) (complete 2026-04-30; commit 0ef5f73; 13 files — service.ts rewrite + logger.ts + lint flip + 3 route-handler revalidateTag(_, "max") cascade + actions-route test mocks + 4 D-35 baseline tsc fixes + db/client.ts lazy Proxy + p-limit serverExternalPackages + .gitignore tsbuildinfo; build green, 164/164 tests, lint green with empty allowlist, tsc clean)
- [ ] 03-04-PLAN.md — Wave 3: 'use server' actions.ts facade with 5 mutation methods + revalidateTag(tag, \max\) (SVC-03, Critical Finding #1)
- [ ] 03-05-PLAN.md — Wave 3: Swap 5 route handlers to new service methods + update actions-route.test.ts mock surface (SVC-04)
- [ ] 03-06-PLAN.md — Wave 3: Structured /api/health per-subsystem probe + new health-route.test.ts (SVC-07, D-32)
- [ ] 03-07-PLAN.md — Wave 4: cache-invalidation.test.ts (TEST-03, gated) + chunked-transfer-regression.test.ts (TEST-06 reframed per D-34)
- [ ] 03-08-PLAN.md — Wave 5: Delete lib/sheets, memory-cache, snapshot-store, build.ts, compare-live, ensure-* (SVC-05)
- [ ] 03-09-PLAN.md — Wave 5: Remove googleapis dep + Sheets-era npm scripts; refresh package-lock (SVC-06)
- [ ] 03-10-PLAN.md — Wave 6: Pre-Merge Gate (operator-only) — D-31 admin seed + D-35 checklist + D-42 prod-snapshot transfer + Vercel deploy
**UI hint**: yes
**Note**: TEST-04 (50-concurrent load test, p95 < 500ms) DEFERRED to Phase 4 DEPL-04 per D-34 — requires load-gen tooling and deployed Vercel preview URL.

### Phase 4: Deploy Hardening
**Goal**: Make the migrated app production-ready with timezone correctness, auth regression coverage, version-stamped responses for incident triage, and observability. This phase exists to eliminate the HTTP -1 / stale-deployment class of incidents flagged in `CLAUDE.md` and to prevent NextAuth beta bumps from silently breaking sign-in.
**Depends on**: Phase 3 (E2E sign-in test runs against the migrated app; `X-BG-Deploy-Id` header is added to the new route handlers)
**Requirements**: DEPL-01, DEPL-02, DEPL-03, DEPL-04, DEPL-05, DEPL-06
**Success Criteria** (what must be TRUE):
  1. `TZ=Australia/Sydney` is set in Vercel production AND preview environments — calendar day math and same-day action-state visibility match operator expectations across UTC boundary hours
  2. Playwright E2E Google sign-in test runs post-deploy on every Vercel preview and blocks promotion on failure; `next-auth` is pinned to exact `5.0.0-beta.30` with Dependabot configured to ignore it
  3. Every `/api/*` response carries an `X-BG-Deploy-Id` header set to the Vercel deployment SHA so incident triage can tie failures to exact deploys
  4. Error tracking (Sentry or Vercel Agent) is installed and reports Wisenet 4xx/5xx, Postgres errors, and unhandled exceptions with deployment-version context; the dev-mode auth secret fallback throws in `NODE_ENV=production`
**Plans**: TBD

### Phase 5: Apps Script Retirement
**Goal**: Complete the migration by retiring the Apps Script stack with a 30-day zero-legacy-traffic tail. Snapshots first, moved-page second, archive manifest third, source archival and dependency removal last. This phase ships in stages across the 30-day window — the first PR starts the tail, the final PR ends the milestone.
**Depends on**: Phase 4 (E2E sign-in and deploy hardening must be green before the Apps Script fallback goes away) AND Phase 2 TEST-01 ports (Validation.gs coverage must survive the `.gs` archival)
**Requirements**: RETI-01, RETI-02, RETI-03, RETI-04, RETI-05, RETI-06
**Success Criteria** (what must be TRUE):
  1. `DashboardActionLog`, `DashboardActionsState`, `InactiveStudents`, and the source-of-truth sheets are snapshotted to CSV in an immutable archive location owned by a BeGifted Workspace account (not a personal Google account); `docs/ARCHIVE_2026-04.md` manifest lists spreadsheet IDs, owners, schemas, snapshot location, and retention policy
  2. Apps Script web app serves a static "Moved" page pointing operators at the Next.js URL — NOT "deployment stopped" (which triggers HTTP -1); Moved-page hit logs are monitored for 30 days with zero legacy traffic
  3. `.gs` source files are archived to `docs/archive/apps-script-2026-04/` and removed from repo root; `clasp` dev-dependency is removed; `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/WORKFLOW.md`, `docs/nextjs-shadow-handoff.md` are updated with Apps Script operational guidance removed or marked historical, and `runValidationSuite` / `runLiveAccuracyAudit` references replaced by Vitest commands
  4. Milestone is complete when the 30-day tail expires with no operator reports AND the archive manifest is checked in
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Wisenet Discovery | 5/5 | Complete | 2026-04-21 |
| 2. Data Layer | 10/10 | Complete | 2026-04-21 |
| 3. Service Cutover | 4/11 | Executing (Plans 03-00, 03-01, 03-02, 03-03 complete 2026-04-30) | - |
| 4. Deploy Hardening | 0/? | Not started | - |
| 5. Apps Script Retirement | 0/? | Not started | - |

Plan counts will be populated when `/gsd-plan-phase` decomposes each phase.

---
*Roadmap created: 2026-04-20*
