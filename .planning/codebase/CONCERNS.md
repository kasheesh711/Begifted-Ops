# Codebase Concerns

**Analysis Date:** 2026-04-20

This repo is a hybrid codebase mid-migration. A live Apps Script dashboard (root `.gs` files + `dashboard.html`) is being superseded by a Next.js 16 shadow app at `web/`. This concerns map surfaces migration-specific risks (business-logic drift, parallel implementations) alongside conventional tech debt.

## Migration Parity Risks

**Severity: HIGH** — `npm run compare-live` is the only strict parity gate and it is currently blocked.
- Issue: The only automated parity check is `web/scripts/compare-live.ts`, which compares Next.js output against Apps Script by executing `clasp run fetchDashboardData`. This is blocked by a `SpreadsheetApp.openById` authorization failure (documented in `docs/nextjs-shadow-handoff.md:127`, `README.md:105`, `docs/app-overview.md:91`).
- Files: `web/scripts/compare-live.ts`, `DashboardDataLoading.gs:6-7`, `Validation.gs:839`
- Impact: The two code paths can drift silently. There is NO automated detection right now.
- Fix approach: Re-authorize the shared Apps Script project for Sheets access (`docs/WORKFLOW.md:78`) OR replace the Apps Script-backed comparison with a fixture-driven contract test that runs both implementations against the same canonical input set.

**Severity: HIGH** — Business-rule constants are duplicated between Apps Script and Next.js.
- Issue: Identical constants are declared independently in two places. Any edit to one side that forgets the other silently breaks parity.
  - `ALERT_THRESHOLD = 2`, `NOTIFY_WINDOW_DAYS = 30`, `EXCLUDED_PACKAGE_KEYWORDS = ["pretest", "trial"]`, `STATUS_ORDER`, `ADMIN_OWNER_REGISTRY`, `REQUIRED_COLUMNS` — all declared in both `Code.gs:17-86` and `web/src/lib/dashboard/config.ts:3-102`
  - `STUDENT_ACTION_STATUSES = ["contacted", "pending-callback", "resolved"]` — `Code.gs:42-46` and `web/src/lib/dashboard/actions.ts:4`
- Files: `Code.gs`, `web/src/lib/dashboard/config.ts`, `web/src/lib/dashboard/actions.ts`
- Impact: Changing the alert threshold, a recognized admin name, or a package exclusion keyword in one side without the other will cause dashboard queue divergence that's invisible until users notice.
- Fix approach: Treat `config.ts` as the source of truth, then either (a) generate a `.gs` constants file from it during migration, or (b) once cutover completes, delete the Apps Script copy.

**Severity: HIGH** — Business logic (package deduplication, pending deduction, status assignment, priority scoring, calendar grouping) is re-implemented in both runtimes.
- Files: `DashboardPackages.gs` (661 lines) vs `web/src/lib/dashboard/packages.ts` (657 lines); `DashboardAnalytics.gs` (678 lines) vs `web/src/lib/dashboard/analytics.ts` (649 lines); `DashboardActions.gs` (244 lines) vs `web/src/lib/dashboard/actions.ts` + `web/src/lib/sheets/actions.ts` (275 lines combined)
- Impact: Subtle logic drift. For example, admin-ownership tie-breaks, pending-deduction fallback rules, or calendar day student sort order can diverge without a test catching it.
- Fix approach: Keep the scope of each `.gs` file frozen during migration. After cutover, archive the `.gs` files rather than maintaining them.

**Severity: MEDIUM** — Two different action-state storage backends: Apps Script `ScriptProperties` (key `BG_ACTION_V1::<studentKey>`) vs Google Sheets tabs `DashboardActionsState` / `DashboardActionLog`.
- Files: `DashboardActions.gs:230-244`, `web/src/lib/sheets/actions.ts:43-156`, `web/src/lib/dashboard/config.ts:31-52`
- Impact: An operator using the Apps Script dashboard writes to script properties. An operator using the Next.js dashboard writes to sheet tabs. Same-day action state is not visible across runtimes. This is by design (`docs/app-overview.md:53-59`) but creates a cutover hazard if both dashboards are used in parallel by different staff.
- Fix approach: Publish a cutover date, communicate to staff, and disable the Apps Script action controls (or redirect the live web app) so writes only ever go to one backend.

## Monolith Files

**Severity: HIGH** — `Validation.gs` is an 80 KB (2411-line) single file with 45+ test functions.
- Issue: Everything from unit-style helpers to full cold-cache chunk-transfer tests lives in one file. Understanding any one test requires loading the entire file. There is no suite-level organization (no `describe` / grouping primitives — Apps Script doesn't offer them).
- Files: `Validation.gs` (2411 lines, 80145 bytes)
- Impact: The file is the de facto spec of Apps Script behavior. If it drifts from actual behavior or is incomplete, the "run `clasp run runValidationSuite`" guidance in `CLAUDE.md:24-25` gives false assurance. Readability is poor enough that subtle bugs in fixtures are likely to go unnoticed.
- Fix approach: During migration, treat `Validation.gs` as frozen reference material. Port the *assertions* (not the harness) into `web/src/test/dashboard-logic.test.ts` as canonical cases so the Next.js runtime inherits the same coverage surface. Currently `dashboard-logic.test.ts` is only 207 lines — a tiny fraction of the Apps Script harness.

**Severity: HIGH** — `dashboard.html` is a 103 KB (3673-line) single HTML file with inline CSS (lines 8-…) and a single inline `<script>` block from line 1639 to 3671 (~2000 lines of JS).
- Files: `dashboard.html` (3673 lines, 103555 bytes); inline script block at lines 1639-3671
- Impact: Cannot be linted, typechecked, unit-tested, or diffed sanely. Any UI bug in the production Apps Script dashboard must be debugged by editing this monolith and round-tripping through a `clasp push` + `clasp deploy`. Tree-shaking, module boundaries, and reusability do not exist.
- Fix approach: Do not invest in refactoring this file. Treat cutover to `web/` as the remediation. The Next.js shadow has already decomposed the equivalent logic into `web/src/components/dashboard/*.tsx` (~8 focused files of 74-463 lines each).

**Severity: MEDIUM** — `web/src/components/dashboard/dashboard-shell.tsx` is 1013 lines even after the Phase 2 decomposition described in `docs/nextjs-shadow-handoff.md:44-68`.
- Files: `web/src/components/dashboard/dashboard-shell.tsx` (1013 lines)
- Impact: Holds 20+ `useState`/`useCallback`/`useEffect` blocks, 10+ derived `useMemo` computations, and orchestrates every child component. Reviewer / new-agent onboarding cost is high. Risk of state-sync bugs (e.g., `selectedStudentKey` sync effect at lines 270-282 depends on 6 pieces of derived state).
- Fix approach: Extract view-state orchestration into a custom hook (e.g., `useDashboardShellState()`) and keep the component as a pure layout + prop-wiring file (~300 lines).

**Severity: MEDIUM** — `web/src/lib/dashboard/packages.ts` (657 lines) and `web/src/lib/dashboard/analytics.ts` (649 lines) are the two largest logic files.
- Files: `web/src/lib/dashboard/packages.ts`, `web/src/lib/dashboard/analytics.ts`
- Impact: Business-rule edits require holding many closures in memory. These are the primary drift-risk files vs. Apps Script.
- Fix approach: Low priority — current structure mirrors the `.gs` layout intentionally to make parity review easier. Revisit after cutover.

## Pre-Release Dependencies

**Severity: HIGH** — `next-auth: 5.0.0-beta.30` is a pre-release beta. Auth is the entire perimeter of the shadow app.
- Files: `web/package.json:19`
- Impact: Breaking changes between betas are common. The `docs/nextjs-shadow-handoff.md:26` entry "NextAuth sign-in error (UnknownAction) — Fixed signin page to use Server Action form" documents one such breakage already encountered. Future `beta.N` upgrades can silently change CSRF handling, redirect behavior, or session shape.
- Fix approach: Pin the exact version (already done). Before upgrading, review the NextAuth v5 migration / release notes and run a manual sign-in + session round-trip in preview before production. Consider adding an E2E test for the sign-in flow so regressions are caught.

**Severity: MEDIUM** — `next: 16.2.1` is a very recent Next.js major (v16). The codebase uses `unstable_cache` which is explicitly marked experimental in the Next cache API.
- Files: `web/package.json:18`, `web/src/lib/dashboard/service.ts:1,10`
- Impact: `unstable_cache` API and semantics can change in minor releases. The code also calls `revalidateTag(DASHBOARD_CACHE_TAG, "max")` (`web/src/lib/dashboard/service.ts:20`) with a second positional argument — this signature should be verified against the installed Next version because an incorrect second arg may be silently ignored, defeating cache invalidation.
- Fix approach: Verify `revalidateTag` 2-arg signature against installed `next@16.2.1`. If unsupported, drop the second arg. Add a regression test that asserts cache-clear behavior after a `POST /api/actions`.

**Severity: MEDIUM** — React 19.2.4 + Next 16 + NextAuth 5 beta is a stack on the bleeding edge with minimal ecosystem resources.
- Files: `web/package.json:16-22`
- Impact: When something goes wrong, Stack Overflow / blog posts are thin. Debugging requires reading source.
- Fix approach: Keep a tight feedback loop via Vercel preview deploys before merging any dep bump.

## Known Incident Patterns

**Severity: HIGH** — `HTTP -1` / chunk-transfer errors are an established, recurring incident pattern in the Apps Script runtime.
- Files referenced in: `CLAUDE.md:23`, `AGENTS.md:24`, `README.md:73`, `docs/WORKFLOW.md:73`, `docs/app-overview.md:286`
- Symptoms: Browser shows "Dashboard data unavailable" with `HTTP -1` even after a source fix was pushed via `clasp push`.
- Root cause documented: Stale versioned deployment — `clasp push` alone is not enough; a fresh `clasp deploy` is required for the web app URL to see a UI change.
- Files implicated: `Code.gs:115-236` (chunk-transfer entrypoints `beginDashboardDataTransfer`, `fetchDashboardDataChunk`, `fetchDashboardDataChunkBatch`), `dashboard.html` (client-side chunk reconstruction in the inline script block)
- Current mitigation: Documented in WORKFLOW.md; runbook tells operators to confirm deployment version before assuming a code failure.
- Fix approach: Long-term remediation = cutover to the Next.js shadow, which does not use chunk-transfer at all. Short-term = add a "deployed version" banner to `dashboard.html` so operators can verify at a glance whether a stale deploy is serving them.

**Severity: MEDIUM** — Chunk-transfer cold-path recovery code tries to rebuild chunks on the fly if cache metadata disappears mid-transfer.
- Files: `Code.gs:159-235` (recovery branches in `fetchDashboardDataChunk`, `fetchDashboardDataChunkBatch`)
- Why risky: Recovery rebuilds the payload from scratch (`payloadLoader()`), which re-hits Google Sheets. Under load this can push Apps Script toward execution-time limits, exacerbating the original `HTTP -1` symptom.
- Current mitigation: `Validation.gs` includes `testDashboardTransferChunkBatchHandlesFinalPartialBatch`, `testDashboardTransferChunkBatchRejectsInvalidRange`, and cache-recovery tests (`Validation.gs:38-46`).
- Fix approach: Retire this code path on cutover — the Next.js service uses `unstable_cache` which handles the "cold cache" path transparently.

## Auth / Env / Handoff Blockers

**Severity: HIGH** — Dev-mode auth fallbacks accept hardcoded strings if env vars are missing.
- Files: `web/src/auth.ts:7,10,11`
- Issue: `secret: process.env.AUTH_SECRET || "local-dev-secret"` and equivalents for `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. If a deployment accidentally ships without env vars wired, NextAuth will not throw at startup — it will run with a predictable `"local-dev-secret"` signing key, which is a serious session-forgery risk.
- Impact: A misconfigured Vercel environment could silently become insecure. Current production is configured (per `docs/nextjs-shadow-handoff.md:130-142`) but there's no guard.
- Fix approach: Make `web/src/auth.ts` fail loudly when env vars are missing (call `getAuthEnv()` which already throws in `web/src/lib/runtime/env.ts:3-7`) instead of falling back. Keep dev-only override behind an explicit `NODE_ENV !== "production"` check.

**Severity: MEDIUM** — Apps Script web app access is `ANYONE_ANONYMOUS`.
- Files: `appsscript.json:10`
- Issue: The live Apps Script dashboard has no auth at the web-app level. Anyone with the URL can hit `doGet()` and retrieve the dashboard shell. Data fetching *does* run as `USER_DEPLOYING` which implicitly scopes reads, but the URL itself is unauthenticated.
- Current mitigation: `docs/app-overview.md:308-311` explicitly flags this as a follow-up ("the intended production access model should be confirmed before the next hardening pass").
- Fix approach: Decide whether cutover to `web/` (which is behind Google Sign-In + `STAFF_ALLOWLIST`) happens fast enough to make this moot. If cutover is weeks out, change `"access": "ANYONE_ANONYMOUS"` to `"access": "DOMAIN"` or `"MYSELF"` and redeploy.

**Severity: MEDIUM** — Apps Script parity script blocked by live-sheet authorization failure.
- Files: `Validation.gs:839` (`SpreadsheetApp.openById(SPREADSHEET_ID_ANALYTICS)`), `DashboardDataLoading.gs:6-7`
- Issue: `clasp run fetchDashboardData` and `clasp run runLiveAccuracyAudit` fail at `SpreadsheetApp.openById` because the shared Apps Script project has not been (re-)authorized for Sheets access.
- Impact: The "compare against live Apps Script" gate is offline.
- Fix approach: Open the Apps Script editor under the deploying user, run one function interactively, accept the Sheets scope prompt. Then `clasp run` will work.

**Severity: LOW** — `ANYONE` execution API access.
- Files: `appsscript.json:14`
- Issue: `executionApi.access: "ANYONE"`. This allows `clasp run` and `scripts.run` API calls from any authenticated Google account.
- Impact: Low in current setup (functions don't mutate production without auth context), but an external caller could exhaust quota.
- Fix approach: Restrict to `"MYSELF"` or the deploying domain.

## Secrets / Credentials Hygiene

**Verification:** Performed per prompt — I did NOT read any `.env` or credential file contents.

**Severity: MEDIUM** — Credential JSONs live in the parent directory outside this repo, which is correct containment, but a few gaps remain.

- Credential files confirmed present in parent `Credit Control/` directory (outside git scope of `Begifted-Ops/`):
  - `begifted-ops-faea81a282d6.json` (service account key — per filename pattern)
  - `client_secret_*.apps.googleusercontent.com.json` (OAuth client secrets — per filename pattern, two files)
  - These live OUTSIDE the repo root, so `.gitignore` at the repo root cannot cover them. This is correct — external storage means they cannot be committed from this repo.

- Root `.gitignore` (`/Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops/.gitignore`) coverage:
  - Ignores: `.clasprc.local.json`, `.DS_Store`, `web/.next/`, `web/node_modules/`
  - **Does NOT list** `.env`, `.env.*`, `credentials*.json`, `*-credentials.json`, `serviceAccountKey.json`, `*.pem`, `*.key` at repo root
  - Any future `.env` or credential file placed at repo root would NOT be ignored.

- `web/.gitignore` (`/Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops/web/.gitignore`) coverage:
  - Ignores: `.vercel`, `.env`, `.env.*`, `.env.local`, `node_modules/`, `.next/`
  - Confirmed `web/.env` IS covered by `web/.gitignore`.

- **Gap:** The root `.gitignore` has no belt-and-braces entry for `.env` or credential JSON patterns. A developer creating `Begifted-Ops/.env` (at the repo root, outside `web/`) would commit it by accident.
- Files: `.gitignore`, `web/.gitignore`
- Fix approach: Add a root-level `.env` / `.env.*` / `*.json` credential pattern block to `.gitignore` even though no such file exists today. Also add `*-credentials.json`, `*.pem`, `*.key`, `id_rsa*`, `service-account*.json` as defensive patterns.

**Severity: LOW** — No pre-commit / CI secret-scanning hook detected in `.github/` (only `CODEOWNERS`, `pull_request_template.md`, `ISSUE_TEMPLATE/`). No GitHub Actions workflow directory.
- Files: `.github/` contents: `CODEOWNERS`, `pull_request_template.md`, `ISSUE_TEMPLATE/agent-task.yml`, `ISSUE_TEMPLATE/config.yml` — no workflows.
- Impact: No automated check prevents an accidentally committed secret from reaching `origin/main`.
- Fix approach: Add a lightweight GitHub Action using e.g. `gitleaks` or `trufflehog` on PRs.

## Cache Correctness (Cold vs Warm Load Paths)

**Severity: MEDIUM** — Two-layer cache in Next.js has distinct cold/warm semantics that are not individually tested.
- Files: `web/src/lib/cache/memory-cache.ts` (process-local 15s TTL cache for Sheets reads, key `sheets:dashboard-sources`), `web/src/lib/dashboard/service.ts:10-13` (Next.js `unstable_cache` layer with 60s revalidate + tag `"dashboard-payload"`)
- Issue: On Vercel serverless, the process-local `Map` in `memory-cache.ts` is per-instance. Two concurrent requests hitting different warm instances will each pay the Sheets read cost, but the `unstable_cache` layer on top should absorb most of this. Correctness depends on `invalidateDashboardPayloadCache()` firing `revalidateTag` reliably. The `"max"` second argument in `service.ts:20` is unusual and may not do what it claims (see "Pre-Release Dependencies" above).
- Impact: If invalidation silently fails, action writes will not immediately reflect in subsequent reads — operators could see stale state even after clicking "Contacted".
- Fix approach: Add a test that (1) reads `GET /api/dashboard`, (2) calls `POST /api/actions`, (3) reads `GET /api/dashboard` again and asserts the action state reflects the write.

**Severity: LOW** — `memory-cache.ts` is completely untyped for cache *values* — callers depend on `getMemoryCache<T>` generic arg being correct.
- Files: `web/src/lib/cache/memory-cache.ts:8-15` (`cache.get(key) as Entry<unknown>` → `entry.value as T`)
- Impact: A caller passing the wrong `T` is a silent type assertion.
- Fix approach: Low-priority. Could add a runtime schema check for cached values.

## Fragile Areas

**Severity: HIGH** — `loadDashboardSources` hardcodes sheet names and required columns that MUST match the upstream Google Sheet layout.
- Files: `web/src/lib/sheets/source-loader.ts:23-65`, `web/src/lib/dashboard/config.ts:15-102` (`REQUIRED_COLUMNS`), parallel `Code.gs:48-86`
- Why fragile: If a source sheet admin renames a column (e.g., `Current Remaining Credits` → `Current Remaining`) or a tab, `getSheetSnapshot` throws "Sheet missing required columns" and the entire dashboard goes down until a code fix + deploy.
- Current mitigation: The schema validator throws early with a clear message.
- Fix approach: Add a `/api/health` check that enumerates missing columns as a warning rather than letting the 500 reach `/api/dashboard`. Or: log a Slack alert when the health check fails.

**Severity: MEDIUM** — `web/src/lib/sheets/actions.ts` writes row-by-row to Google Sheets via `spreadsheets.values.update` / `append` with no retry, no batching, and no transactionality.
- Files: `web/src/lib/sheets/actions.ts:92-140`
- Why fragile: A bulk action (`POST /api/actions/bulk`) runs writes sequentially via `for (const studentKey of uniqueKeys)` (`web/src/app/api/actions/bulk/route.ts:25-47`). If the loop fails halfway through, earlier students are persisted but later students are not, and the user sees an error with partial state.
- Impact: Partial bulk-update state is user-visible and confusing.
- Fix approach: Use a single `spreadsheets.values.batchUpdate` call per bulk action, or wrap the loop so a partial failure still returns the set of successfully-updated students with a clear error message.

**Severity: MEDIUM** — `snapshot-store.ts` is an in-process module-global `let`. On serverless (Vercel Functions), this is effectively per-instance ephemeral memory.
- Files: `web/src/lib/dashboard/snapshot-store.ts:3-18`
- Why fragile: The snapshot is supposed to drive delta and trend calculations (`docs/app-overview.md:267-283`). On Vercel, every cold-start starts with `snapshotState = { lastSnapshot: null, history: [] }`. Deltas will be empty on the first request after a cold start.
- Impact: Summary "delta vs previous load" is unreliable in production — it only works within a single warm process.
- Fix approach: Persist the snapshot to the analytics sheet (a new `DashboardSnapshots` tab) or to KV/Redis so deltas survive cold starts.

**Severity: MEDIUM** — `health-state.ts` has the same serverless-ephemeral problem.
- Files: `web/src/lib/dashboard/health-state.ts:9-15`
- Why fragile: `/api/health` reports `lastPayloadBuiltAt`, `lastCacheInvalidatedAt` etc. from an in-process `let`. Hitting the health endpoint on a fresh instance returns `null` even though the cache is fully warm on another instance.
- Impact: Confuses monitoring / debugging. Operators may think "no builds happened" when really they hit a different replica.
- Fix approach: Either document the limitation in the `/api/health` response (add `"instance": "cold-start"` hint) or move to a shared store.

**Severity: LOW** — `web/src/lib/sheets/client.ts:14` does `env.SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n")` unconditionally.
- Files: `web/src/lib/sheets/client.ts:14`
- Why risky: If the key is ever stored without escaped `\n` (e.g., in a `.env` that supports actual newlines), this becomes a no-op, which is fine. But the `docs/nextjs-shadow-handoff.md:27` entry "Sheets private key DECODER error on Vercel — Fixed env var format" shows this has bitten once. A future re-rotation by a new operator is likely to re-introduce the DECODER error.
- Fix approach: Detect the missing-newline case and give a more actionable error ("Private key appears to contain literal '\n' — make sure Vercel env var has real newlines OR escaped `\\n`").

## Test Coverage Gaps

**Severity: HIGH** — Inactive-student auto-reactivation has no test.
- What's not tested: `web/src/lib/dashboard/build.ts:52-63` automatically reactivates students previously marked inactive when they reappear with active packages. This is a side effect that mutates sheet state during a read request.
- Files: `web/src/lib/dashboard/build.ts:52-63`, `web/src/lib/sheets/inactive-students.ts:111-119`
- Risk: A bug causing mass-reactivation on every read (e.g., wrong key comparison) would silently erase inactive-state history without any test to catch it.
- Priority: High — this code mutates persisted state on a read endpoint.

**Severity: HIGH** — No test exercises the `POST /api/actions/bulk` partial-failure path.
- What's not tested: The sequential loop in `web/src/app/api/actions/bulk/route.ts:25-47` has no coverage for "middle iteration throws". Only happy-path tests exist in `web/src/test/actions-route.test.ts`.
- Files: `web/src/app/api/actions/bulk/route.ts`, `web/src/test/actions-route.test.ts` (117 lines)
- Risk: See "Fragile Areas" → bulk write partial failure.
- Priority: High.

**Severity: MEDIUM** — The Next.js test suite (`web/src/test/`, 2 files totaling 324 lines) does not mirror the 45+ assertions in `Validation.gs` (2411 lines).
- What's not tested in Next.js: Cold-cache / warm-cache paths, chunk-transfer recovery (N/A for Next.js), admin ownership tie-breaks on conflicting rows, pending-deduction fallback flags, snapshot-history trimming, calendar grouping edge cases, pinned-student ordering.
- Files: `web/src/test/dashboard-logic.test.ts` (207 lines), `web/src/test/actions-route.test.ts` (117 lines) vs `Validation.gs` (2411 lines)
- Risk: When the Apps Script runtime is retired, this coverage evaporates unless ported first.
- Priority: Medium to High — must be addressed before cutover.

**Severity: MEDIUM** — No E2E / integration test for sign-in flow.
- What's not tested: The fix described in `docs/nextjs-shadow-handoff.md:26` ("Changed sign-in button from `<a href>` GET link to a `<form>` with a Server Action") is only covered by manual click-testing. A future NextAuth beta bump could re-break this silently.
- Files: `web/src/app/signin/page.tsx:18-27`, `web/src/auth.ts`
- Priority: Medium — auth is security-critical.

**Severity: LOW** — `web/src/lib/dashboard/helpers.ts` (130 lines of pure functions) has no direct test file; it's only indirectly exercised via `dashboard-logic.test.ts`.
- Files: `web/src/lib/dashboard/helpers.ts`
- Priority: Low — logic is simple and the indirect coverage is adequate.

## TODO / FIXME Markers

**Result of repo scan:** `grep` for `TODO|FIXME|HACK|XXX` across `src/` (both Apps Script `.gs` files and `web/src/`) yields effectively zero real markers.
- The only hit is `SharedHelpers.gs:89` which is the literal string `"yyyy-MM-dd'T'HH:mm:ssXXX"` (a date-format template, not an XXX-marker).
- Files scanned: all `*.gs` at repo root, `web/src/**/*.{ts,tsx}`, `dashboard.html`.
- Interpretation: Either the codebase really is that clean, or the team uses issues / docs instead of inline markers. Given the extensive doc coverage in `docs/`, `CLAUDE.md`, `AGENTS.md`, and `README.md`, the latter is likely.
- Action: Not a concern in itself, but future agents should not mistake "zero TODO markers" for "zero known issues". Reference this CONCERNS.md and `docs/nextjs-shadow-handoff.md` for the actual backlog.

## Documentation Follow-Ups Explicitly Flagged by Product Docs

**Severity: LOW-MEDIUM** — Two follow-ups called out in `docs/app-overview.md:303-311`:
1. PRD references an older GitHub repository path; the active repo is `kasheesh711/Begifted-Ops`. Low-risk doc-only fix.
2. `appsscript.json` still uses `"access": "ANYONE_ANONYMOUS"` pending production access-model confirmation. **See "Auth / Env / Handoff Blockers" above — upgraded to MEDIUM severity there.**

## Scaling Limits

**Severity: MEDIUM** — Google Sheets read/write quota is the hard ceiling.
- Current behavior: Each `/api/dashboard` cache miss triggers 2 `batchGet` calls (one per spreadsheet, `web/src/lib/sheets/source-loader.ts:27-42`). Each `/api/actions` triggers 2-3 sheet writes. Each `/api/actions/bulk` triggers 2 writes per student in the batch.
- Limit: Google Sheets API default per-user per-100-seconds quota is 100 reads / 100 writes. A bulk action on 50 students = 100 writes, potentially hitting the quota in a single click.
- Fix approach: (1) Switch bulk writes to a single `batchUpdate`. (2) Monitor API quota headers in response and surface near-quota warnings to the client.

**Severity: LOW** — Action log (`DashboardActionLog` sheet) grows forever with no rotation.
- Files: `web/src/lib/sheets/actions.ts:121-140`, `web/src/app/api/actions/history/route.ts` reads last 7 days only
- Impact: At ~N actions/day, the log will eventually hit the 10-million-cell Google Sheets limit (years away, but real).
- Fix approach: Add a monthly archival job or a hard-capped sheet with oldest-row eviction.

## Dependencies At Risk

**Severity: MEDIUM** — `next-auth@5.0.0-beta.30` — see "Pre-Release Dependencies" above.

**Severity: LOW** — `googleapis@171.4.0` is a current stable, no risk.

**Severity: LOW** — Only `tsx`, `typescript`, `vitest`, `@types/*` in devDependencies. Minimal surface area for supply-chain issues.

## Missing Critical Features (Pre-Cutover)

**Severity: HIGH** — No real parity verification before shadow cutover.
- What's missing: `compare-live` is blocked; no fixture-based parity contract exists as a backup.
- Blocks: Confidence in declaring the shadow "parity complete" per `docs/app-overview.md:84-92`.
- Fix approach: Build a snapshot-based fixture test that freezes a known-good Apps Script output as a JSON file, then asserts Next.js output matches it for the same input.

**Severity: MEDIUM** — No observability / error reporting in the Next.js shadow.
- What's missing: No Sentry, Datadog, Vercel Analytics, or equivalent. Errors in API routes return JSON to the client but are not captured centrally.
- Files: `web/src/app/api/**/route.ts` (all routes just `catch (error)` and return `NextResponse.json`)
- Impact: Production incidents require `vercel logs <deployment-url>` per the handoff runbook (`docs/nextjs-shadow-handoff.md:158`). No alerting, no error-rate dashboards.
- Fix approach: Add Vercel Analytics (`@vercel/analytics`) for traffic, plus Sentry for error capture.

**Severity: LOW** — No rate limiting on API routes.
- Files: `web/src/app/api/**/route.ts`
- Impact: An authenticated allowlisted operator could (accidentally) trigger a burst of writes that hits Sheets quota.
- Fix approach: Lightweight token-bucket middleware; or rely on Vercel / Cloudflare edge rate limiting.

## Security Considerations

**Severity: HIGH** — Auth fallback strings create a silent-insecure failure mode (see "Auth / Env / Handoff Blockers").

**Severity: MEDIUM** — Apps Script web app exposed to `ANYONE_ANONYMOUS` (see "Auth / Env / Handoff Blockers").

**Severity: LOW** — Email allowlist comparison in `web/src/auth.ts:19-20` trusts Google's email claim. If a staff member's Google account is compromised, an attacker gains the same access as the staff member. No 2FA enforcement at the app layer.
- Files: `web/src/auth.ts:19-20`
- Current mitigation: Google Workspace 2FA at the account level.
- Fix approach: Document 2FA as a requirement for allowlisted accounts.

**Severity: LOW** — API routes don't verify `Origin` / `Referer` or CSRF tokens for state-changing operations.
- Files: `web/src/app/api/actions/route.ts:9-52`, `web/src/app/api/actions/bulk/route.ts:9-60`, `web/src/app/api/inactive/route.ts`
- Reasoning: NextAuth v5 handles session validation on every request via `auth()`; it doesn't auto-add CSRF tokens to arbitrary POST routes. If an attacker can get a logged-in operator to visit a malicious page, a cross-origin `fetch` with `credentials: include` would succeed.
- Fix approach: Add a CSRF token or `Origin` header check on state-changing routes. For this internal tool the risk is low but the fix is cheap.

---

*Concerns audit: 2026-04-20*
