# Phase 2: Data Layer - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the Wisenet read client (`lib/wisenet/*.ts`) and the Neon Postgres write layer (`lib/db/*.ts`) as parallel workstreams. Port all 41 `Validation.gs` assertions to Vitest as the de-facto parity spec. At end of phase, fixture-driven Wisenet mappers produce valid `DashboardSources` AND the existing 45+ dashboard-logic tests pass against those mappers — but `service.ts` is untouched and the old Sheets path still serves production.

In scope:
- `web/src/lib/wisenet/{client, endpoints, types, mappers, retry}.ts` (and supporting files)
- `web/src/lib/db/{schema, client, queries, migrations/*}.ts`
- `web/drizzle/` migration SQL files (generated from schema)
- `web/scripts/db-migrate.ts` (CI-invokable migration runner)
- `web/scripts/seed-admin-ownership.ts` (one-off cutover seed)
- `web/src/lib/runtime/env.ts` — add `getWisenetEnv()` and `getDbEnv()`
- `web/src/test/fixtures/wisenet/*.json` — copied from `.planning/research/fixtures/wisenet/`
- `web/src/test/{packages, projection, pending-deduction, queue, calendar}.test.ts` — Validation.gs port (split by domain)
- Cache-invalidation regression test — if it lands in Phase 2 at all (see D-23)

Out of scope (Phase 3 Service Cutover):
- Modifications to `web/src/lib/dashboard/service.ts`
- Deleting `web/src/lib/sheets/` / `web/src/lib/cache/memory-cache.ts`
- Removing `googleapis` from package.json
- Enabling `cacheComponents: true` in `next.config.ts`
- Rewiring `/api/dashboard`, `/api/actions`, `/api/actions/bulk`, `/api/actions/history`, `/api/inactive`, `/api/health` to the new service methods
- The Day-1 archive-link affordance on Student Detail

Out of scope (Phase 4 Deploy Hardening):
- NextAuth pinning, Dependabot ignore
- Playwright E2E, Sentry/observability, X-BG-Deploy-Id headers, TZ env var

Out of scope (Phase 5 Apps Script Retirement):
- Moved page, 30-day tail, CSV archival, .gs source archival, README/CLAUDE.md/docs updates

</domain>

<decisions>
## Implementation Decisions

### Carried forward from Phase 1 (locked, not re-litigated)

- **D-04** — Copy `.planning/research/fixtures/wisenet/*.json` → `web/src/test/fixtures/wisenet/` for Vitest (keeps research evidence separate from test inputs)
- **D-05** — Drop `Should_Credit` column entirely. TEST-01 ports drop/rewrite the 3-5 `Validation.gs` assertions that exercise `Should_Credit` priority over `session_duration`
- **D-06** — `student_admin_ownership(student_key PK, admin_key, assigned_at, assigned_by_email, updated_at)` Postgres table. Admin key values from `ADMIN_OWNER_REGISTRY`: `palm`, `kem`, `care`, `aya`, `petchy`, `muk`, `unassigned` fallback
- **D-07** — Credit balance: direct-first with derive-client fallback, decided per-field. Current path: derive from `past_sessions.duration` sum for all 3 balance rows (RED today, upgrades to GREEN if Phase 2 sessionCredits probe with resolved pair succeeds and response carries numeric `total`+`remaining`)
- **D-08** — Pending-deduction rule (1:1 replicate minus Should_Credit): `meetingStatus === "ENDED" AND teacher_feedback empty AND (duration / 3600000) > 0 → count as pending`
- **Auth headers** (from 01-02 + 01-03 probes): HTTP Basic `base64(WISENET_USER_ID:WISENET_API_KEY)` + `x-api-key: WISENET_API_KEY` + `x-wise-namespace: WISENET_NAMESPACE` (`begifted-education`) + `Content-Type: application/json` + identifier `user-agent`
- **Tenant identity** — `{{institute_id}}` = `WISENET_CENTER_ID` is a **path parameter**, e.g. `/institutes/v3/{center}/students`. NOT a header.
- **Base URL** — `https://api.wiseapp.live`
- **Pagination** — `page_number` (1-based) + `page_size` (default 50). Envelope: `{status, message, data: {<items>, count}}`. Iterator terminates when `records.length < page_size`. `skip`/`take` silently ignored. Past-end returns `data.<items>=[]`. NO Link header, NO cursor.
- **Rate-limit retry** (WCLI-01) — 429-detection + exponential backoff (1s → 2s → 4s → 8s, capped). Do NOT parse `Retry-After` or `X-RateLimit-*` (server is headerless — confirmed at 200-burst).
- **Path-typo fix** — Postman catalogue contains `{{institute_id}}s/students` typo (spurious trailing `s`). Probe scripts compensated inline in 01-03. Phase 2 WCLI-03 uses corrected path `/institutes/v3/{center}/students`.
- **Session-endpoint shape** — `data.sessions[*]` uses `meetingStatus` (enum `ENDED`/`CANCELLED`/`UPCOMING`/`IN_PROGRESS`) not `finalStatus`/`status`. `duration` is in milliseconds. `scheduledStartTime` is ISO 8601. `teacherFeedback` is NOT on list responses — requires detail fetch with `showFeedbackSubmission=true`.
- **sessionCredits gate** — Endpoint exists at `/institutes/{center}/classes/{classId}/students/{studentId}/sessionCredits` but rejects arbitrary student+class pairs (400 "Student not found"). Requires participant-resolved student_id — Phase 2 WCLI-04 must derive via `/user/classes/{classId}/participants` before calling.

### ORM + Postgres driver (WCLI / DB stack)

- **D-17:** Drizzle ORM + `@neondatabase/serverless` HTTP driver as default. WebSocket `Pool` (via `@vercel/functions::attachDatabasePool`) reserved for the bulk-action write path only (DB-07). HTTP mode for all reads and single-statement writes; WebSocket only when we need `BEGIN ... COMMIT` across multiple statements. One extra client file (`db/bulk-client.ts`) isolates the WebSocket pool lifecycle.
- **Rationale:** Drizzle = TS-first schema, `drizzle-kit`-generated plain SQL migrations, no Prisma-engine binary, no schema-push dance. HTTP default = zero pool overhead on Fluid, fastest cold start. Bulk path gets true atomicity when it matters (action row + history log insert + deduct from cache).
- **Packages to add:** `@neondatabase/serverless@^1.0.0`, `drizzle-orm@^0.38.x`, `drizzle-kit@^0.30.x` (dev), `zod@^3.23.x`, `@vercel/functions@^3.x`.
- **Ripple:** `web/src/lib/db/client.ts` exports `db` (HTTP, default) and `bulkDb` (WebSocket Pool, lazy). API routes import `db` by default. `api/actions/bulk/route.ts` imports `bulkDb` and wraps its writes in a transaction.

### Wisenet client shape (WCLI-01/02/03)

- **D-26:** Single `web/src/lib/wisenet/endpoints.ts` with all resource functions (`getStudents`, `getStudent`, `getClass`, `getPastSessions`, `getUpcomingSessions`, `getSessionCredits`, `getParents`). Flat, discoverable, matches existing `web/src/lib/sheets/source-loader.ts` pattern. ~100-150 lines.
- **Companion files:** `client.ts` (fetch wrapper with auth + timeout + retry), `types.ts` (TypeScript + Zod schemas), `mappers.ts` (Wisenet JSON → `DashboardSources` shape), `retry.ts` (429-detection + exponential backoff helper).
- **Client structure** — `wisenetFetch<T>(path, schema, init)` parses responses through Zod at the boundary (WCLI-05). Single chokepoint for `z.coerce.string().trim()`, `z.coerce.number()`, `z.coerce.date()`, `z.enum([...])`, and `z.coerce.number().transform(ms => ms / 60000)` for duration-to-minutes.
- **Error shape** — `class WisenetError extends Error` with `status`, `path`, `redactedBody` (strip `email`, `phone`, `displayIdentifier`, `answer` before attaching). Caught at route-handler boundary; 4xx → 400, 5xx → 502/503.
- **Timeout** — 15s per request via `AbortSignal.timeout(15_000)`.

### Parent-name resolution (WCLI-04 YELLOW row)

- **D-18:** 2-step join via `parentIds[]` → `/parents` endpoint. `mappers.ts` collects unique `parentIds` across the student batch, calls `getParents(ids)` once (cached `ID → name` map in the mapper call's scope), joins back. Fallback to `"missing-parent"` when `parentIds` is empty, per existing `buildDashboardStudentKey` semantic.
- **Rationale:** Canonical. Degrades gracefully. Doesn't couple mapper to Wisenet form question IDs (which operators can change without notice — `registrationData.fields[questionId=z1porsd5]` option was fragile).
- **Implementation note:** Batch is scoped per-`getStudents` page call (one `/parents` request per page of 50 students). If Phase 2 measurement shows this is slow, Phase 3 can upgrade to a persistent Wisenet-reads cache; not done in Phase 2 per D-23.
- **Ripple:** `DashboardSources.parents` type added (or embedded into student records). Mapper tests assert correct resolution + "missing-parent" fallback path.

### Teacher-feedback fetch strategy (WCLI-04 N+1)

- **D-19:** Pre-filter on `meetingStatus === "ENDED"` only. `mappers.ts` collects past-session entries where `meetingStatus === "ENDED"`, fetches `teacherFeedback` per session via detail endpoint with `showFeedbackSubmission=true`. Uses `p-limit` (concurrency 5) to bound parallel request count.
- **Rationale:** Phase 1 fingerprint showed session list doesn't carry `teacherFeedback` — N+1 is inherent. Bounding to ENDED sessions is the only filter Phase 1 D-08 needs. `p-limit` avoids accidental 50-concurrent-GET bursts that might trigger rate limits (200 serial didn't trigger, but 50 concurrent is untested per 01-03 summary).
- **Package to add:** `p-limit@^5.x`.
- **Ripple:** Mapper exposes an option to skip teacher-feedback fetch entirely (for tests that don't need pending-deduction accuracy). Tests without the option use synthetic `teacherFeedback` values in fixtures.

### Validation.gs port strategy (TEST-01)

- **D-20:** 5 files under `web/src/test/`, split by domain, parametric `describe.each(fixtures)` pattern matching existing `dashboard-logic.test.ts` style:
  - `packages.test.ts` — active-filter, exclusion-keyword, admin-ownership, duplicate-merge
  - `projection.test.ts` — `computeProjection`, `worstStatus`, alert/exhaust dates
  - `pending-deduction.test.ts` — `shouldCountAsPendingDeduction`, the 3-5 `Should_Credit` assertions DROP/REWRITE per D-05
  - `queue.test.ts` — queue-row construction, priority-score, compare-student-queue-rows
  - `calendar.test.ts` — day-grouping, weekly-buckets, calendar payload
- **Rationale:** Matches current codebase test style; easy to locate breakage; parametric pattern handles fixture churn without test-file churn.
- **Fixture sources:** Inline test fixtures (same pattern as `Validation.gs`'s `buildFixture*` helpers — port them as `buildFixture*()` TS functions co-located with the test file). Wisenet-derived `DashboardSources` fixtures (from 01-03 probe fixtures + mappers) for the parity-gate coverage separately wired via D-24.
- **Assertions dropped/rewritten (per D-05):** Any `Validation.gs` test that feeds non-zero `should_credit` is dropped if it purely exercises the Should_Credit priority branch, or rewritten to use `session_duration` fallback if it exercises a shared code path.

### Admin-ownership seed migration

- **D-21:** One-off `web/scripts/seed-admin-ownership.ts` runs `clasp run buildStudentAdminOwnershipMap` against the live Apps Script, receives majority-vote JSON from the current `RemainingCredits` sheet, bulk-inserts into `student_admin_ownership` via Drizzle. Idempotent on `student_key` (ON CONFLICT DO UPDATE with `updated_at = NOW()`).
- **Runs:** Once at cutover (Phase 3 activates the seed run as part of cutover-day checklist). Can be re-run safely if seed logic changes.
- **Requires:** Kevin's existing clasp auth (already configured at `.clasprc.local.json`), `DATABASE_URL_UNPOOLED` in the execution env (same var `db-migrate.ts` uses), live Apps Script project authorized on Sheets.
- **Fallback:** If `clasp run buildStudentAdminOwnershipMap` fails (auth drift, Apps Script offline), the script writes the received-or-empty JSON to `.planning/research/admin-ownership-seed.json` for manual review before inserting. Never inserts half-baked data.

### Database migration runner (DB-08)

- **D-22:** Separate GitHub Actions CI job runs `tsx scripts/db-migrate.ts` on PR merge to main, before Vercel deploy kicks off. Uses `DATABASE_URL_UNPOOLED` (auto-injected by the Vercel Marketplace Neon integration). Idempotent via Drizzle's `__drizzle_migrations` table.
- **Rationale:** Keeps builds fast; migration failure = failed deploy (catches errors before production traffic hits). Actions logs are auditable. Doesn't couple migration to Vercel's build lifecycle (which would slow every build).
- **Layout:** `.github/workflows/db-migrate.yml` with two triggers — manual `workflow_dispatch` for out-of-band runs, and `push` on `main` for automatic runs.
- **Does NOT run:** During `next build` (Vercel build env is ephemeral; we want migration idempotency separate from deploy). Does NOT run from `instrumentation.ts` (per DB-08 explicit exclusion).

### Wisenet read caching (service.ts untouched constraint)

- **D-23:** **NO caching in Phase 2.** Wisenet client reads hit live API every time during Phase 2. The Phase 3 Cutover PR adds `'use cache: remote'` + `cacheTag('dashboard-payload', 'wisenet:students', ...)` + `cacheLife({ expire: 60 })` wrapping the new `service.ts` composition. Phase 2 leaves the caching decision there.
- **Rationale:** Phase 2 Wisenet traffic is test-fixture-driven and ad-hoc — no production calls. Adding cache in Phase 2 means writing a wrapper Phase 3 throws away. Keeps Phase 2 a pure client+mappers+tests deliverable.
- **Existing `memory-cache.ts` untouched:** Phase 2 doesn't delete `web/src/lib/cache/memory-cache.ts` or modify `web/src/lib/sheets/source-loader.ts`'s use of it. The existing Sheets path continues to serve prod with its existing 15s + 60s cache layers. Phase 3 deletes both.
- **Ripple:** TEST-03 (cache-invalidation regression) — still in Phase 2 scope per ROADMAP, but must operate on existing cache infrastructure (Sheets path), not the new one. Planner decides whether TEST-03 is more naturally a Phase 3 task.

### TEST-02 parity gate wiring (existing tests pass via Wisenet mappers)

- **D-24:** Build a test-only fixture adapter at `web/src/test/helpers/wisenet-to-dashboard-sources.ts` that takes Wisenet fixture JSON (6 resource samples from `.planning/research/fixtures/wisenet/`) and the new mappers, and produces `DashboardSources` shape. Fed into the existing 45+ assertions in `dashboard-logic.test.ts` via a new `describe("wisenet parity", ...)` block. Assertion bodies don't change — only the fixture source switches.
- **Rationale:** Proves mapper output is business-rule-compatible without duplicating or parameterizing the existing tests. Keeps parity coverage as tight as it currently is.
- **Adapter signature:** `async function toDashboardSources(wisenetFixtures: WisenetFixtureSet): Promise<DashboardSources>`. Calls mappers with pre-fetched data (no network). Returns the same shape `web/src/lib/sheets/source-loader.ts::loadDashboardSources` returns today.
- **Ripple:** If existing assertions fail on Wisenet-derived `DashboardSources`, the fix goes in `mappers.ts`, not the tests. Failure = proof of semantic drift that must be closed before Phase 3.

### DB-07 bulk-write atomicity

- **D-25:** WebSocket `Pool` from `@neondatabase/serverless` + `attachDatabasePool(pool)` from `@vercel/functions`. Bulk writes wrap `BEGIN ... COMMIT` around (a) bulk `INSERT INTO follow_up_state VALUES (...), (...)` and (b) bulk `INSERT INTO follow_up_log VALUES (...), (...)` for the history. All-or-nothing across the 50-student batch.
- **Rationale:** CONCERNS.md flagged the current Sheets pattern's lack of bulk transactionality (MEDIUM risk). Postgres is an upgrade opportunity — we fix it while migrating. Follow-up state + history log stay consistent on partial failure.
- **Pool config:** `max: 3`, `idleTimeoutMillis: 30_000`, singleton via `globalThis.__bgBulkPool ??= ...`. Per DB-03 spec.
- **Scope:** WebSocket used ONLY in `api/actions/bulk/route.ts` (the one route that issues bulk writes). Every other route continues on the HTTP driver. Phase 2 `db/bulk-client.ts` owns the pool; Phase 3 wires `api/actions/bulk/route.ts` to use it.

### Claude's Discretion

The planner decides these without re-asking Kevin:

- Exact `web/src/lib/wisenet/client.ts` internal structure (retry wrapper composition, auth-header construction helper, timeout/abort signal orchestration)
- Exact `web/src/lib/db/schema.ts` table definitions beyond the 4 locked ones (`follow_up_state`, `follow_up_log`, `inactive_students`, `student_admin_ownership`) — any supporting tables the queries need
- Zod schema file organization — one `types.ts` with all schemas, or split per-resource, at planner's discretion (small surface either way)
- `p-limit` concurrency value for teacher-feedback batch (default to 5; planner may raise if Phase 2 measurement proves safe)
- Exact file names in `web/src/test/` for the 5 Validation.gs port files (match domain names above)
- Whether to emit `drizzle.config.ts` separately or inline in the migrate script (planner's call)
- Whether to include a `package.json` scripts row for `npm run db:migrate` / `npm run db:generate` (recommend yes, for local dev discoverability)
- Whether `retry.ts` lives as a separate file or inlined in `client.ts` (recommend separate for test isolation)
- Error-response parsing: `WisenetError.redactedBody` redaction regex list (should include `email`, `phone`, `loginPin`, `displayIdentifier`, `answer`, `notes` — planner may add fields)
- Exact TEST-03 (cache invalidation) placement — Phase 2 (against Sheets path) or deferred to Phase 3 (against new `use cache: remote` tags). Planner's call with justification.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope and constraints
- `.planning/PROJECT.md` — Core value, in-scope/out-of-scope, constraints (Neon Postgres for follow-up state, Wisenet read-only, NextAuth Google stays, no parity-diff)
- `.planning/REQUIREMENTS.md` §Wisenet Client / Postgres Data Layer / Testing — WCLI-01..07, DB-01..08, TEST-01/02/03/05 (19 Phase 2 requirements)
- `.planning/ROADMAP.md` §Phase 2 Data Layer — goal, success criteria, dependency on Phase 1

### Phase 1 handoff (required reading — Phase 2 is derivative of this)
- `.planning/phases/01-wisenet-discovery/01-PHASE-SUMMARY.md` — The Phase 2 handoff doc. Lists concrete WCLI-01..07 / DB-02 / TEST-01 unblocks with evidence paths.
- `.planning/research/WISENET_FIELD_MAP.md` — 25 rows classified GREEN/YELLOW/RED. Every mapper field traces back to a row here. 6 RED blocks have `Decision:` values that become WCLI-04 code paths.
- `.planning/research/WISENET_ENDPOINTS.md` — 120 endpoints with auth/path/params. Phase 2 WCLI-03 is written against this catalog.
- `.planning/research/fixtures/wisenet/*.json` — 9 fixture files. Copy 6 resource samples to `web/src/test/fixtures/wisenet/` per D-04; the 3 fingerprint files stay in research.
- `.planning/phases/01-wisenet-discovery/01-CONTEXT.md` — D-01..D-16 locks cited throughout this document.

### Stack decisions (already researched, referenced not re-derived)
- `.planning/research/STACK.md` — Recommended stack: Drizzle + Neon HTTP default + WebSocket for bulk + Zod at boundary + fetch-based Wisenet client. Decision rationales cite Vercel docs fetched live 2026-04-20.
- `.planning/research/ARCHITECTURE.md` §Facade pattern — target shape Phase 2 mappers must produce; informs `DashboardSources` contract stability
- `.planning/research/PITFALLS.md` §Pitfall 2 (silent type coercion) — why Zod at boundary with `.coerce.*` is mandatory
- `.planning/research/PITFALLS.md` §Pitfall 3 (connection-pool exhaustion) — why `max: 3` singleton + `attachDatabasePool` are required for the WebSocket path

### Code source of truth (what every mapper and test must resolve against)
- `web/src/lib/dashboard/config.ts` — `REQUIRED_COLUMNS`, `ALERT_THRESHOLD = 2`, `ADMIN_OWNER_REGISTRY`, `EXCLUDED_PACKAGE_KEYWORDS`, `DASHBOARD_CACHE_TAG`, `SHEETS_IN_MEMORY_TTL_MS`
- `web/src/types/dashboard.ts` — `DashboardPayload`, `PackageRecord`, `StudentRecord`, `StudentQueueRow`, `CalendarPayload`, `SummaryPayload`, `ActionState`, `AppSessionUser` — the external contract mappers must satisfy
- `web/src/lib/dashboard/packages.ts` — `buildActiveStudentSet`, `buildExcludedPackageReasons`, `buildStudentAdminOwnershipMap`, `buildPendingDeductionContext`, `shouldCountAsPendingDeduction`, `buildDashboardPayload`, `createPackageRecord`, `upsertPackageRecord`, `getRecommendedAction`, `getActionReason`
- `web/src/lib/dashboard/projection.ts` — `computeProjection`, `worstStatus`, `DAY_MS`
- `web/src/lib/dashboard/analytics.ts` — `buildDashboardModel`, `buildStudentQueue`, `buildStudentQueueRow`, `compareStudentQueueRows`, `buildCalendarData`, `buildSummary`
- `web/src/lib/dashboard/helpers.ts` — `buildDashboardStudentKey`, `buildStudentPackageKey`, `formatDate`, `formatDateTime`, `parseDate`, `parseNumber`, `roundToTenth`, `roundToHundredth`
- `web/src/lib/runtime/env.ts` — Existing env-loader pattern (`required()`, `getAuthEnv()`, `getSheetsEnv()`). WCLI-07 adds `getWisenetEnv()` and `getDbEnv()` modeled on this.
- `web/src/lib/sheets/source-loader.ts` + `web/src/lib/sheets/client.ts` — Pattern for the Wisenet client shape (memoized auth, one module owns endpoints). Phase 2 modeled on this.
- `web/src/test/dashboard-logic.test.ts` — The 45+ assertion file TEST-02's parity gate extends. Pattern for `describe.each(fixtures)` that the 5 TEST-01 port files follow.
- `web/src/test/actions-route.test.ts` — The route-test mocking pattern (`vi.mock` for feature modules, `vi.stubGlobal("fetch", ...)` at network boundary). WCLI-06 and DB unit tests follow this.

### Apps Script source (port reference for TEST-01)
- `Validation.gs` (repo root) — 2,411 lines with 41 fixture-driven assertions. Hand-port to the 5 TEST-01 test files.
- `DashboardPackages.gs` — `buildPendingDeductionContext`, `shouldCountAsPendingDeduction` — the pending-deduction branch to port with D-05 `Should_Credit` drop
- `SharedHelpers.gs` — `buildDashboardStudentKey`, `parseNumber`, `parseDate` — identical semantics to TS version; cross-reference for any drift

### Operational / security
- `CLAUDE.md` / `AGENTS.md` §Security — credential handling (`.env` gitignored, rotate on paste)
- `CLAUDE.md` — Validation Run Rules section: after changes to balance logic or student action-state, run `clasp run runValidationSuite`. Phase 2 TEST-01 ports are the TS equivalent; Phase 3 cutover retires the `clasp run` gate entirely.

### Retained probe scripts (D-16 Phase 1 decision)
- `web/scripts/wisenet-postman-parse.ts` — re-runnable if Postman collection changes
- `web/scripts/wisenet-probe-{auth, pagination, rate-limit, field-shape}.ts` — re-runnable for fresh fixtures or for sessionCredits-with-resolved-pair upgrade probe
- `web/scripts/README-wisenet-probes.md` — provenance, env vars, D-10/D-11/D-12 safety rules
- `.planning/research/fixtures/wisenet/_rate-limit-budget-used.json` — check before re-running the 200-burst probe on the same day

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `web/src/lib/runtime/env.ts::required()` — validator pattern used by every env loader. `getWisenetEnv()` and `getDbEnv()` follow the same shape (throws on missing, typed return).
- `web/src/lib/sheets/client.ts::getSheetsClient` — memoized auth pattern. Wisenet client mirrors this: single module owns `wisenetFetch()`, feature modules call into it.
- `web/src/lib/cache/memory-cache.ts` — **Phase 2 does not modify** per D-23. The existing Sheets path keeps its 15s in-process cache through Phase 2.
- `web/src/lib/sheets/source-loader.ts` — **Phase 2 does not modify**. Continues to serve prod traffic. Phase 3 deletes.
- `web/src/test/dashboard-logic.test.ts` — The 45+ assertion file. TEST-02 extends this with a `describe("wisenet parity", ...)` block using D-24's fixture adapter.
- `web/src/test/actions-route.test.ts` — The Vitest mocking pattern template. WCLI-06 fixture tests use the same `vi.stubGlobal("fetch", ...)` pattern for the Wisenet client boundary.
- `web/scripts/compare-live.ts` — tsx script pattern; `web/scripts/db-migrate.ts` and `web/scripts/seed-admin-ownership.ts` follow the same `#!/usr/bin/env tsx` shebang + env-reader pattern.
- `web/package.json` scripts section — add `db:generate`, `db:migrate`, `db:seed-admin` following the existing `ensure-action-sheets` / `ensure-inactive-sheet` convention.
- `.planning/research/fixtures/wisenet/*.json` — 9 fixture files (6 resource samples + 3 fingerprints). Copy the 6 resource samples to `web/src/test/fixtures/wisenet/` per D-04.

### Established Patterns
- **Memoized client** — `web/src/lib/sheets/client.ts::getSheetsClient` memoizes JWT auth. Wisenet client memoizes header construction similarly (user-agent, Basic auth, constant headers).
- **Node runtime declaration** — every `web/src/app/api/**/route.ts` declares `export const runtime = "nodejs"` (required for `googleapis` today, required for `@neondatabase/serverless` WebSocket mode tomorrow). Keep this pattern.
- **Env-loader throws on missing** — `web/src/lib/runtime/env.ts::required(name, value)` throws typed error. `getWisenetEnv()` and `getDbEnv()` use the same helper.
- **Route-handler return shape** — `NextResponse.json({ error }, { status })`. Keep unchanged for route tests.
- **Fixture-driven tests** — `describe.each(fixtures)` from `dashboard-logic.test.ts`. TEST-01 port follows the same pattern.
- **Same-day action-state visibility** — `sanitizeStudentActionState()` drops rows whose `updatedAt` date is not today. DB-05 preserves this rule in the domain layer.

### Integration Points
- Phase 2 writes NEW modules under `web/src/lib/wisenet/*.ts` and `web/src/lib/db/*.ts`. Zero modifications to existing code paths (`service.ts`, `source-loader.ts`, route handlers, React components).
- `web/src/lib/runtime/env.ts` gets new exports (`getWisenetEnv`, `getDbEnv`). Existing exports unchanged.
- `web/package.json` gets new deps (`@neondatabase/serverless`, `drizzle-orm`, `drizzle-kit`, `zod`, `@vercel/functions`, `p-limit`), new scripts (`db:generate`, `db:migrate`, `db:seed-admin`). Existing deps unchanged.
- `web/.env.example` already documents `WISENET_*` (from Phase 1). Phase 2 adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED` (auto-injected by Vercel Marketplace Neon — operator action, not Phase 2 code).
- `.github/workflows/db-migrate.yml` (new) — CI job invokes `tsx scripts/db-migrate.ts`. No existing workflow to modify.

</code_context>

<specifics>
## Specific Ideas

- **Kevin accepted all four primary stack recommendations**: Drizzle + Neon HTTP (with WebSocket for bulk), 2-step parent join, pre-filter on ENDED for teacher-feedback, and split-by-domain parametric port layout. This means the STACK.md research is ratified as the stack source of truth for Phase 2 — the planner can cite it as evidence for version pins and import paths.
- **Kevin accepted the clasp-run seed approach over googleapis-based seed.** Rationale: reuses the exact same `buildStudentAdminOwnershipMap` logic that currently serves prod; the TS re-implementation of that logic doesn't happen until Phase 3 (WCLI-04 mapper) which means seeding can't depend on the not-yet-ported code.
- **Kevin accepted CI-job migrations over Vercel-build-step migrations.** Rationale: keeps Vercel builds fast and uncoupled from migration state; GH Actions logs are easier to audit than Vercel build logs for schema concerns.
- **Kevin accepted NO cache in Phase 2 Wisenet reads.** Rationale: Phase 2 is pure client+mappers+tests; production still reads from Sheets. Adding a wrapper in Phase 2 just to throw it away in Phase 3 is thrashing.
- **Kevin accepted fixture-adapter parity-gate wiring over parameterized tests.** Rationale: preserves existing assertion bodies unchanged; proves drift by failing in `mappers.ts`, not in test definitions.
- **Kevin accepted WebSocket-Pool-for-bulk-only atomicity.** Rationale: upgrades CONCERNS.md's bulk-transactionality gap while keeping every other write on the zero-pool HTTP driver.
- **Kevin accepted single-endpoints.ts layout over one-file-per-resource.** Rationale: matches existing `web/src/lib/sheets/source-loader.ts` pattern; low surface (7 functions) doesn't justify splitting.
- **Phase 1 probe scripts are retained per D-16.** Phase 2 may re-run `wisenet-probe-field-shape.ts` if it wants to capture a sessionCredits-with-resolved-pair fixture for Opportunity 6 upgrade — check `_rate-limit-budget-used.json` for same-day cumulative budget before running.
- **Every new test fixture must be PII-scrubbed.** Phase 1 established the 3-layer redaction (key-based + value-based + env-value final-pass). Phase 2 fixtures inherit this bar.

</specifics>

<deferred>
## Deferred Ideas

- **sessionCredits-with-resolved-pair probe** (Opportunity 6 from Phase 1 field map). If Phase 2 WCLI-04 derives participant-resolved `student_id` via `/user/classes/{classId}/participants`, rerun `wisenet-probe-field-shape.ts` with the resolved pair. If the response carries numeric `total` + `remaining`, the 3 RED credit-balance rows upgrade to GREEN and mappers switch to direct-read. This is in Phase 2 if time allows; otherwise Phase 3 takes it.
- **sessionCredits fixture upgrade to 200 status.** Current fixture is status=400 evidence. Once Opportunity 6 probe succeeds, replace `credit_balance_sample.json` with the 200 response.
- **Tag-based package exclusion** (replace keyword match `pretest`/`trial` with Wisenet-classroom tags per `tags[]` array observed in 01-03 fixtures). Captured in Phase 1 field map Opportunity 3; not in Phase 2. Future `UX-*` or `OPS-*` v2 milestone.
- **Invoice/payment status tracking** (`classrooms[*].feeSummary` with THB amounts). Field map Opportunity 1; future `OPS-*` / `RPT-*` v2.
- **Attendance-rate / engagement metrics** (`past_sessions[*].participants[*].inMeetingDuration`). Field map Opportunity 2; future `RPT-*` v2.
- **Real-time webhook invalidation.** Field map Opportunity 4; existing v2 `OPS-01` scope.
- **Trainer-field as admin-ownership v2** (explicitly rejected by D-06 for v1; reconsiderable post-milestone if operator policy shifts).
- **Neon read replicas per region** for dashboard latency — out of scope. Revisit post-milestone only if latency becomes a concern.
- **Upstash Redis / cross-region session storage** — out of scope. Not needed for 6-admin dashboard; `use cache: remote` in Phase 3 covers all read caching.
- **Prisma Studio admin UI.** Drizzle doesn't have a Studio equivalent. Acceptable — operators use the dashboard, not DB admin tools. Future consideration if an internal DB inspector becomes a need.
- **TEST-03 cache-invalidation regression test placement.** Per D-23 the caching infra doesn't exist yet in Phase 2. Planner may defer this to Phase 3 if it's more naturally tested there. Left as Claude's Discretion with rationale.
- **Moving probe scripts out of `web/scripts/`** — deferred per Phase 1 D-16. Stay discoverable.
- **WISENET_ENDPOINTS.md catalogue cleanup** (the `{{institute_id}}s/students` typo). Deferred — probe scripts already handle inline; Phase 2 WCLI-03 uses the corrected path. A one-line fix can land any time but isn't Phase 2's priority.

</deferred>

---

*Phase: 02-data-layer*
*Context gathered: 2026-04-21*
