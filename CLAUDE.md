# Claude Instructions

Follow [`docs/WORKFLOW.md`](docs/WORKFLOW.md) as the shared collaboration policy.

## Repo Expectations

- Start from a GitHub Issue for non-trivial work.
- State planned file ownership before implementation when work may overlap.
- Keep one branch and one PR per issue.
- Update docs in the same PR when setup, deployment, or workflow changes.
- Update docs in the same PR when operator-facing command-center behavior changes, especially queue filters, follow-up state controls, calendar navigation, or triage flow.
- Prefer claiming a specific backend `.gs` ownership slice instead of the full Apps Script layer.
- Treat `DashboardActions.gs` as its own ownership slice when work touches student follow-up state.
- Treat `web/` as an active ownership area for migration work instead of assuming the repo is Apps Script-only.

## Apps Script

- Use the tracked `.clasp.json` and `appsscript.json` as the shared project baseline.
- Never commit `.clasprc.local.json` or any credential material.
- Call out Apps Script push or deployment impact clearly in the PR.
- Keep backend logic split across the tracked `.gs` files instead of rebuilding a monolithic `Code.gs`.
- For web app changes, distinguish between source push completion and creation of a fresh versioned deployment.
- When triaging web app incidents, treat `HTTP -1` and chunk-transfer failures as possible stale-deployment symptoms until the deployment version is confirmed.
- Run `clasp run runValidationSuite` when changing balance logic or source-sheet rules.
- Run `clasp run runValidationSuite` when changing student action-state persistence or same-day visibility rules.
- When changing async bootstrap or chunked transfer behavior, add regression coverage for both warm-cache and cold-cache load paths before deployment.
- Run `clasp run runLiveAccuracyAudit` for live parity changes once the shared Apps Script project has been authorized for Google Sheets access.
- If a live check fails on `SpreadsheetApp.openById`, document the authorization blocker instead of treating it as a code failure.
- When migration work touches `web/`, call out both Apps Script status and Next.js shadow status in the handoff.
- Treat auth, env, spreadsheet-access, and Vercel-linking blockers as explicit handoff items.

## Handoffs

When stopping mid-task, leave a concise handoff using the shared format in [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Review Standard

- Prefer small PRs with a clear issue link.
- Include validation evidence, even when validation is manual.
- If a change affects team workflow, update the docs before handing off.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**BeGifted Ops — Wisenet Migration Milestone**

An internal operations dashboard for BeGifted Education that lets tutoring-center operators triage students with expiring packages and low credit balances, run follow-up actions, and plan the calendar. Today it ships as two stacks: a legacy Google Apps Script web app and a Next.js "shadow" deployed to Vercel. Both currently read from a Google Sheets source of truth.

This milestone finishes the migration to a single Next.js dashboard and swaps the data source from Google Sheets to the Wisenet student-management API.

**Core Value:** Operators can trust the dashboard as a single source of truth for who to follow up with and what credit / package state each student is in — without any manual sheet syncing.

### Constraints

- **Tech stack**: Next.js 16 App Router + TypeScript — existing shadow architecture stays, only the data layer changes.
- **Tech stack**: Neon Postgres via Vercel Marketplace — chosen for follow-up state (relational queries, history/audit). No ORM prescribed yet; pick during Phase 2.
- **Tech stack**: No nightly shadow-compare or parity diff job — user chose "just cut over." Tests + operator sign-off are the safety net.
- **Security**: Wisenet API credentials and Google service-account JSON must never be committed. `.env` files are gitignored; credentials referenced by env-var name only. If any secret is ever pasted into chat, rotate it.
- **Compatibility**: Google Workspace login (existing NextAuth Google provider) stays the auth method — operators don't re-learn a login flow.
- **Dependencies**: Wisenet API field coverage is unverified; Phase 1 must surface gaps before subsequent phases commit to UI shape.
- **Deployment**: Vercel is the only production target; Apps Script / clasp are on a retirement path this milestone.
- **Workflow**: Small PRs per issue, claim ownership by file slice, keep docs updated alongside code changes (per `CLAUDE.md` / `AGENTS.md`).
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- Google Apps Script (V8 runtime, ES2015+ JavaScript dialect) — backend in `Code.gs`, `DashboardActions.gs`, `DashboardAnalytics.gs`, `DashboardDataLoading.gs`, `DashboardPackages.gs`, `DashboardProjection.gs`, `DashboardState.gs`, `SharedHelpers.gs`, `Validation.gs`
- TypeScript 5.9.3 — entire `web/` shadow app (API routes, dashboard logic port, sheets client, React components)
- HTML + inline JS — single-file `dashboard.html` (3,673 lines) rendered by Apps Script `HtmlService`
- CSS — `web/src/app/globals.css` (1,788 lines) for the Next.js UI
## Runtime
- Runtime: V8 (declared in `appsscript.json` — `"runtimeVersion": "V8"`)
- Timezone: `Asia/Bangkok`
- Exception logging: `STACKDRIVER`
- Web app access: `ANYONE_ANONYMOUS`
- Web app executes as: `USER_DEPLOYING`
- Execution API access: `ANYONE`
- Node.js — required by `@types/node` ^22.17.0 and `"runtime": "nodejs"` declarations on every API route (e.g. `web/src/app/api/actions/route.ts`, `web/src/app/api/dashboard/route.ts`, `web/src/app/api/health/route.ts`, `web/src/app/api/inactive/route.ts`)
- TypeScript compile target: `ES2022`, module `ESNext`, moduleResolution `Bundler`
- Production hosting: Vercel (linked project `prj_79Y3JFkRszm28pAltR3cbolYujZp` in `web/.vercel/project.json`)
- npm — lockfile `web/package-lock.json` present (3,222 lines)
- No pnpm, yarn, or bun lockfiles detected
## Frameworks
- `SpreadsheetApp` — primary data access (`DashboardDataLoading.gs`, `SharedHelpers.gs`)
- `HtmlService` — web-app entry point (`Code.gs` `doGet()`)
- `PropertiesService` — snapshot/history/action-state persistence (`DashboardState.gs`, `DashboardActions.gs`)
- `CacheService` — chunked dashboard payload cache (`DashboardState.gs`, `Code.gs`)
- `Utilities` — date formatting (`SharedHelpers.gs`)
- `Session` — script timezone (`SharedHelpers.gs`)
- `Logger` — Stackdriver logging
- `next` 16.2.1 — App Router, `src/app/` convention
- `react` 19.2.4 / `react-dom` 19.2.4
- Config: `web/next.config.ts` (only sets `reactStrictMode: true`)
- `next-auth` 5.0.0-beta.30 (Auth.js v5) — Google OAuth provider, configured in `web/src/auth.ts`
- Handler route: `web/src/app/api/auth/[...nextauth]/route.ts`
- `googleapis` 171.4.0 — JWT service-account auth, used in `web/src/lib/sheets/client.ts`, `web/src/lib/sheets/source-loader.ts`, `web/src/lib/sheets/actions.ts`, `web/src/lib/sheets/inactive-students.ts`
- `vitest` ^3.2.4 — `web/src/**/*.test.ts` (node environment, config at `web/vitest.config.ts`)
- Apps Script side: custom validation suite in `Validation.gs` (2,411 lines, run via `clasp run runValidationSuite`)
- `tsx` ^4.20.3 — runs standalone TypeScript scripts in `web/scripts/`
- `@clasp` — Google Apps Script CLI (project config `.clasp.json`; scriptId `1kAv9ICE5DQqE17JWynXJoV2Lu2bgs7pjzAfDzLNZ-1aMjhq_yKky1MQ6`, projectId `begifted-forms`)
- Next.js default bundler (Turbopack-capable in Next 16)
## Key Dependencies
- `googleapis` 171.4.0 — Google Sheets v4 API client with service-account JWT auth
- `next` 16.2.1 — Next.js App Router framework
- `next-auth` 5.0.0-beta.30 — Auth.js v5 (beta) with Google provider
- `react` 19.2.4
- `react-dom` 19.2.4
- `@types/node` ^22.17.0
- `@types/react` ^19.2.2
- `@types/react-dom` ^19.2.2
- `tsx` ^4.20.3 — one-shot TS script runner (used for `compare-live`, `ensure-action-sheets`, `ensure-inactive-sheet`)
- `typescript` ^5.9.3
- `vitest` ^3.2.4
- None — `appsscript.json` declares `"dependencies": {}` (no advanced services, no libraries). Everything is built on default global services.
- Next cache layer uses two in-memory strategies:
## Configuration
- `appsscript.json` — runtime, timezone, webapp settings, OAuth scope
- `.clasp.json` — scriptId and extensions for clasp push/pull
- `.clasprc.local.json` — local clasp credentials (listed in repo root `.gitignore`, never committed)
- `web/next.config.ts` — `reactStrictMode: true`, nothing else
- `web/tsconfig.json` — strict mode, `@/*` path alias pointing at `./src/*`, JSX `react-jsx`
- `web/vitest.config.ts` — node environment, `@` alias to `./src`, test glob `src/**/*.test.ts`
- `web/next-env.d.ts` — Next-generated ambient types (do not edit)
- `web/.env.example` declares required variables (see INTEGRATIONS.md for details):
- `web/.env` exists locally (gitignored via `web/.gitignore` → `.env`, `.env.*`, `.env.local`)
- Env values are read through `web/src/lib/runtime/env.ts` which throws on missing required vars
- `web/.vercel/project.json` links the `web` folder to Vercel project `prj_79Y3JFkRszm28pAltR3cbolYujZp` (team `team_eDfLdeP7EKIifzi1xLIHv8ca`)
- `web/.vercel/` is gitignored (`web/.gitignore` first line)
## Scripts
- `dev` — `next dev` (local development server)
- `build` — `next build`
- `start` — `next start` (production server)
- `test` — `vitest run` (CI-style single run)
- `test:watch` — `vitest` (watch mode)
- `compare-live` — `tsx scripts/compare-live.ts` (parity check between Apps Script `fetchDashboardData` via clasp and Next.js `/api/dashboard` payload)
- `ensure-action-sheets` — `tsx scripts/ensure-action-sheets.ts` (creates/validates `DashboardActionsState` and `DashboardActionLog` sheets via googleapis)
- `ensure-inactive-sheet` — `tsx scripts/ensure-inactive-sheet.ts` (creates/validates `InactiveStudents` sheet via googleapis)
- `doGet()` in `Code.gs` — serves `dashboard.html`
- `fetchDashboardData()` in `Code.gs` — returns cached payload
- `runValidationSuite()` in `Validation.gs` — unit test runner for 40+ business-rule fixtures
- `runLiveAccuracyAudit` in `Validation.gs` — live parity audit (requires Sheets authorization)
- Student-action handlers: `setStudentAction`, `bulkSetStudentAction`, `clearStudentAction` in `DashboardActions.gs`
- Chunked transfer: `beginDashboardDataTransfer`, `fetchDashboardDataChunk`, `fetchDashboardDataChunkBatch` in `Code.gs`
## Platform Requirements
- Node.js compatible with `@types/node` ^22 (Node 22+ recommended)
- `@google/clasp` CLI (not listed in package.json — assumed globally installed per CLAUDE.md and `scripts/compare-live.ts` line 63 which executes `clasp`)
- A Google account authorized on the Apps Script project `1kAv9ICE5DQqE17JWynXJoV2Lu2bgs7pjzAfDzLNZ-1aMjhq_yKky1MQ6`
- Vercel CLI for deployments touching the `web/` shadow
- Apps Script: Google-hosted web app (anonymous access, executes as deployer). Source-of-truth for dashboard behavior at the time of this snapshot.
- Next.js: Vercel deployment of `web/` folder (standard Node runtime — no Edge runtime usage; `export const runtime = "nodejs"` is declared explicitly on every API route because `googleapis` requires Node APIs)
## CI / Governance
- `CODEOWNERS` — single owner `* @kasheesh711`
- `pull_request_template.md` — requires linked issue, ownership area, validation evidence, deployment-impact checkboxes, documentation checklist, handoff section
- `ISSUE_TEMPLATE/agent-task.yml` + `ISSUE_TEMPLATE/config.yml` — structured template for agent-created issues
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

- **Apps Script layer** at repo root — tracked `.gs` files deployed via `clasp` to a shared Apps Script project. ES5-style JavaScript constrained by the Apps Script runtime.
- **Next.js shadow app** at `web/` — TypeScript / Next.js 16 App Router / Vitest. Mirrors the Apps Script business logic for migration.
## Repo-Level Ownership Rules
- Start from a GitHub Issue for non-trivial work (`CLAUDE.md:7`, `AGENTS.md:9`).
- Keep one branch and one PR per issue (`CLAUDE.md:9`).
- Prefer small composable PRs when file ownership overlaps (`AGENTS.md:12`).
- Never rebuild a monolithic `Code.gs` — backend logic stays split across the tracked `.gs` files (`CLAUDE.md:21`, `AGENTS.md:22`).
- Claim ownership by individual `.gs` slice, not "backend" broadly (`CLAUDE.md:13`, `AGENTS.md:13`).
- Treat `DashboardActions.gs` as its own stateful ownership slice whenever work touches student follow-up state (`CLAUDE.md:14`, `AGENTS.md:14`).
- Treat `web/` as an active ownership area for migration work, not a side project (`CLAUDE.md:15`, `AGENTS.md:15`).
- In handoffs that touch `web/`, report both Apps Script status and Next.js shadow status (`CLAUDE.md:29`, `AGENTS.md:30`).
- `.clasprc.local.json` is git-ignored and must stay local-only (`CLAUDE.md:19`, `AGENTS.md:20`).
- `.clasp.json` and `appsscript.json` ARE part of the repo baseline.
## Apps Script Layer Conventions
### File Organization
| File | Lines | Role |
|------|-------|------|
| `Code.gs` | 300 | Constants, `doGet`, `beginDashboardDataTransfer`, chunked cache entry points |
| `SharedHelpers.gs` | 107 | Generic helpers (`getSheetData`, `parseNumber`, `formatDate`, `parseJsonSafely`) |
| `DashboardDataLoading.gs` | 89 | Sheet loading (`loadDashboardSources`, `getSheetSnapshot`, column validation) |
| `DashboardPackages.gs` | 661 | Business rule helpers (`buildActiveStudentSet`, `buildPendingDeductionContext`, etc.) |
| `DashboardProjection.gs` | 86 | `computeProjection`, `worstStatus` |
| `DashboardAnalytics.gs` | 678 | View-model (`buildDashboardModel`, queue/summary/calendar rollups) |
| `DashboardActions.gs` | 244 | Student action state (set/clear/bulk, history trimming, actor resolution) |
| `DashboardState.gs` | 120 | Snapshot + chunked cache persistence |
| `Validation.gs` | 2411 | Test harness, fixtures, live accuracy audit |
### Naming
### Code Style
- `const` and `let` freely
- `function() { ... }` expressions (NOT arrow functions) inside `.forEach`/`.map` callbacks — see `SharedHelpers.gs:9-13`
- No `async`/`await` (Apps Script is synchronous)
- No destructuring in function parameters
- No imports/exports — everything is global
### Error Handling
### Cache / State Patterns
- Prefix: `BG_ACTION_V1::` + `studentKey` (`Code.gs:40`, `DashboardActions.gs:230-232`)
- History cap: `STUDENT_ACTION_HISTORY_LIMIT = 20` (`Code.gs:41`, `DashboardActions.gs:44`)
- Only same-day action state surfaces in the payload — see `sanitizeStudentActionState` (`DashboardActions.gs:157-173`).
### Options Objects
## Next.js / TypeScript Layer Conventions (`web/`)
### Directory Structure
### TypeScript Config
- `strict: true` (no exceptions)
- `target: ES2022`, `module: ESNext`, `moduleResolution: "Bundler"`
- Path alias `@/*` → `./src/*`
- `allowJs: false` — TypeScript only, no JS escape hatch
### Naming
- Components: `dashboard-shell.tsx`, `queue-panel.tsx`, `line-preview-modal.tsx`
- Hooks: `use-*.ts` — `use-theme.ts`, `use-keyboard-shortcuts.ts`, `use-resizable-split.ts`
- Lib modules: `memory-cache.ts`, `source-loader.ts`, `health-state.ts`
- Route handlers: `route.ts` (Next.js App Router convention)
- Pages: `page.tsx`, `layout.tsx`
- Functions, variables: `camelCase` (`loadDashboardSources`, `getSheetsClient`, `sanitizeStudentActionState`)
- React components: `PascalCase` (`DashboardShell`, `QueuePanel`, `CalendarPanel`)
- Hooks: `useCamelCase` prefix (`useTheme`, `useKeyboardShortcuts`, `useResizableSplit`)
- Types/interfaces: `PascalCase` (`DashboardPayload`, `StudentRecord`, `ActionState`, `AppSessionUser`)
- Constants: `SCREAMING_SNAKE_CASE` exported from `lib/dashboard/config.ts` (`DASHBOARD_CACHE_TAG`, `ALERT_THRESHOLD`, `SHEETS_IN_MEMORY_TTL_MS`, `ADMIN_OWNER_REGISTRY`)
- String-literal union types preferred over enums: `PackageStatus = "notify" | "watch" | "ok" | "nodata"` (`web/src/types/dashboard.ts:1`)
### Imports
### App Router Conventions
- `app/(protected)/dashboard/page.tsx` — route group `(protected)` for auth-gated pages (not in URL)
- `app/api/**/route.ts` — Route Handlers (Node.js runtime, `export const runtime = "nodejs"` on every one)
- `app/api/auth/[...nextauth]/route.ts` — catch-all for NextAuth
### Error Handling
- Normalize with `String(body.x ?? "").trim()` before checking `!studentKey`.
- Return 400 with `{ error: "studentKey is required" }` for missing input.
- Return 404 with `{ error: "Student not found" }` when a studentKey doesn't match the payload.
### Cache / Data Patterns
- Always go through `getSheetsClient()` in `lib/sheets/client.ts` — it memoizes the JWT auth.
- Multi-sheet loads use `spreadsheets.values.batchGet` (`lib/sheets/source-loader.ts:27-42`).
- Row reads sit behind `getOrSetMemoryCache("sheets:<name>", ...)` (`lib/sheets/actions.ts:159`, `lib/sheets/source-loader.ts:24`).
### Logging
### Comments
### React / Component Patterns
## Validation Run Rules
| When changing... | Run |
|------------------|-----|
| Balance logic or source-sheet rules | `clasp run runValidationSuite` |
| Student action-state persistence or same-day visibility | `clasp run runValidationSuite` |
| Async bootstrap / chunked transfer | Extend `Validation.gs` with warm-cache and cold-cache coverage — no manual-smoke-test-only changes |
| Live sheet parity or diagnostics | `clasp run runLiveAccuracyAudit` (requires Google Sheets authorization on the shared script) |
| `web/` shadow parity | `npm run compare-live` from `web/` (`web/scripts/compare-live.ts`) |
## Deployment Discipline
- `.clasp.json` and `appsscript.json` stay in sync with the shared Apps Script project (`CLAUDE.md:18`, `AGENTS.md:19`).
- Distinguish **source push** from **versioned deployment** — both get called out in PRs (`CLAUDE.md:22`, `AGENTS.md:23`).
- `HTTP -1` and chunk-transfer errors are deploy-state symptoms first, not source-state bugs (`CLAUDE.md:23`, `AGENTS.md:24`).
- Deployment impact recorded in every substantial PR or handoff, even when no deploy happens (`AGENTS.md:21`).
## PR / Review Standards
- Small PRs with a clear issue link
- Validation evidence included, even when manual
- Docs updated in the same PR when the change affects setup, deployment, workflow, command-center behavior (queue filters, follow-up state, calendar, triage), or migration tooling
- Auth, env, service-account, and Vercel-linking blockers are first-class handoff items
- Handoff format lives in `docs/WORKFLOW.md`
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Source-of-truth data lives in Google Sheets (`BeGifted Student Credits` + `BeGifted Education Analytics`); neither stack owns a database.
- Both stacks share the same constants (alert threshold `2`, notify window `30` days), admin registry (6 named admins + `unassigned`), excluded package keywords (`pretest`, `trial`), and package status enum (`notify`/`watch`/`ok`/`nodata`).
- Business logic is layered identically in both stacks: data loading → active-student filtering → exclusion rules → admin ownership resolution → pending deduction computation → projection → analytics shaping (queue, calendar, summary).
- The Apps Script backend persists action state and snapshots to `PropertiesService`; the Next.js shadow persists the same concepts to dedicated analytics sheet tabs (`DashboardActionsState`, `DashboardActionLog`, `InactiveStudents`).
- The Apps Script frontend is a monolithic `dashboard.html` served by `doGet()`. The Next.js frontend is a decomposed React shell under `web/src/components/dashboard/` driven by an orchestrator (`dashboard-shell.tsx`).
- The Apps Script runtime streams the computed payload in 90 KB chunks through `CacheService`; the Next.js runtime uses Next's `unstable_cache` tagged with `dashboard-payload` plus a 15 s process-local memory cache for Sheets reads.
## Layers
### Google Apps Script stack (production, at repo root)
- Purpose: Serves the web-app shell, orchestrates cached chunked payload delivery, and defines all shared constants.
- Location: `Code.gs`
- Contains: `doGet()` web-app entrypoint, `beginDashboardDataTransfer()`, `fetchDashboardDataChunk()`, `fetchDashboardDataChunkBatch()`, `getCachedDashboardPayload()`, `buildAndPersistDashboardPayload()`, plus constants (`SPREADSHEET_ID_CREDITS`, `SPREADSHEET_ID_ANALYTICS`, `ALERT_THRESHOLD`, `ADMIN_OWNER_REGISTRY`, `REQUIRED_COLUMNS`, `DASHBOARD_CACHE_KEY`, `DASHBOARD_CACHE_TTL_SECONDS = 120`, `DASHBOARD_CACHE_CHUNK_SIZE = 90000`).
- Depends on: `DashboardDataLoading.gs`, `DashboardPackages.gs`, `DashboardAnalytics.gs`, `DashboardState.gs`.
- Used by: `dashboard.html` frontend client code (`google.script.run`) and external `clasp run` callers.
- Purpose: Read the six required sheets through `SpreadsheetApp.openById()` and enforce column contracts.
- Location: `DashboardDataLoading.gs`
- Contains: `loadDashboardSources()`, `getSheetSnapshot()`, `findHeaderRowIndex()`, `validateRequiredColumns()`.
- Depends on: `SharedHelpers.gs` (generic spreadsheet helpers), plus `Code.gs` constants.
- Used by: `Code.gs` (`buildAndPersistDashboardPayload`) and `Validation.gs` diagnostics.
- Purpose: Apply the core business rules (active filter, exclusions, admin ownership, pending deductions, duplicate merging, package record construction).
- Location: `DashboardPackages.gs`
- Contains: `buildActiveStudentSet()`, `buildExcludedPackageReasons()`, `buildStudentAdminOwnershipMap()`, `buildPendingDeductionContext()`, `buildPendingDeductionDetail()`, `buildUpcomingSessionMap()`, `buildDashboardPayload()`, `createPackageRecord()`, `upsertPackageRecord()`, `getRecommendedAction()`, `getActionReason()`.
- Depends on: `DashboardProjection.gs`, `SharedHelpers.gs`.
- Used by: `Code.gs`, `DashboardAnalytics.gs`, `Validation.gs`.
- Purpose: Iterate upcoming sessions chronologically to compute alert/exhaust dates and assign package status.
- Location: `DashboardProjection.gs`
- Contains: `computeProjection()`, `worstStatus()`, `DAY_MS` constant.
- Depends on: `SharedHelpers.gs`.
- Used by: `DashboardPackages.gs`, `DashboardAnalytics.gs`.
- Purpose: Transform package records into the queue, calendar day groupings, summary counts with deltas, and persistence snapshot used by the frontend payload.
- Location: `DashboardAnalytics.gs`
- Contains: `buildDashboardModel()`, `buildPackageRows()`, `computePriorityScore()`, `buildStudentQueue()`, `buildStudentQueueRow()`, `compareStudentQueueRows()`, `buildCalendarData()`, `buildSummary()`, `buildSummaryDeltas()`, `buildWeeklyBuckets()`, `buildSnapshotForPersistence()`, `updateHistory()`.
- Depends on: `DashboardPackages.gs`, `DashboardProjection.gs`, `DashboardActions.gs`, `SharedHelpers.gs`.
- Used by: `Code.gs` (`buildAndPersistDashboardPayload`).
- Purpose: Persist per-student follow-up state (contacted/pending-callback/resolved) with actor attribution, trim history, and invalidate the dashboard cache on writes. **Stateful ownership slice.**
- Location: `DashboardActions.gs`
- Contains: `setStudentAction()`, `bulkSetStudentAction()`, `clearStudentAction()`, `writeStudentActionState()`, `attachActionStatesToStudents()`, `loadStudentActionStatesByStudentKey()`, `sanitizeStudentActionState()` (same-day visibility gate), `resolveStudentActionActor()`.
- Storage: `PropertiesService.getScriptProperties()` under `BG_ACTION_V1::<studentKey>` keys; history limit `20` entries per student.
- Depends on: `SharedHelpers.gs`, `Code.gs` constants (`STUDENT_ACTION_STATUSES`, `STUDENT_ACTION_PROPERTY_PREFIX`, `ADMIN_OWNER_REGISTRY`), `DashboardState.gs` (`clearDashboardCache`).
- Used by: `DashboardAnalytics.gs` (`buildDashboardModel`), `Validation.gs`.
- Purpose: Manage chunked `CacheService` payload storage plus snapshot/history persistence via `PropertiesService`.
- Location: `DashboardState.gs`
- Contains: `loadSnapshotState()`, `persistSnapshotState()`, `getDashboardCache()`, `readChunkedCacheValue()`, `readChunkedCacheManifest()`, `writeChunkedCacheValue()`, `clearDashboardCache()`, `chunkString()`.
- Storage: `CacheService.getScriptCache()` with meta key `BG_DASHBOARD_PAYLOAD_V2::meta` and part keys `BG_DASHBOARD_PAYLOAD_V2::part::<N>`; 2-minute TTL.
- Used by: `Code.gs`, `DashboardActions.gs`.
- Purpose: Generic spreadsheet/date/parsing utilities shared across all Apps Script slices.
- Location: `SharedHelpers.gs`
- Contains: `getSheetData()`, `getColMap()`, `readTrimmedCell()`, `readUpperCell()`, `parseNumber()`, `normalizeText()`, `buildDashboardStudentKey()`, `getTodayDate()`, `parseDate()`, `roundToTenth()`, `roundToHundredth()`, `formatDate()`, `formatDateTime()`, `parseJsonSafely()`.
- Purpose: Fixture-based validation suite plus live-sheet parity and inspection tools.
- Location: `Validation.gs` (80 KB, 2411 lines — the largest file in the repo)
- Contains: `runValidationSuite()` (41 test functions), `inspectStudentPackageBalance(studentName, packageName)`, `runLiveAccuracyAudit()` (writes to `Dashboard Accuracy Audit` sheet), `buildAuditExpectedModel()`, `buildLiveAccuracyAuditReport()`, all audit-mirror helpers prefixed `buildAudit*`.
- Purpose: Browser-side command center and student detail UI rendered into the Apps Script web app shell.
- Location: `dashboard.html` (3673 lines, single file)
- Contains: CSS, state machine for async payload reconstruction (chunk batch requests of 5 parts), admin-tab filtering, queue rendering, triage-first calendar, student detail, LINE message preview.
### Next.js shadow stack (at `web/`)
- Purpose: Next.js 16 App Router pages and API routes.
- Location: `web/src/app/`
- Route segments:
- Used by: Next.js runtime on Vercel.
- Purpose: JSON REST endpoints for the shadow dashboard, all pinned to `export const runtime = "nodejs"`.
- Location: `web/src/app/api/`
- Endpoints:
- Depends on: `web/src/auth.ts`, `web/src/lib/auth/session.ts`, `web/src/lib/dashboard/service.ts`, `web/src/lib/sheets/actions.ts`, `web/src/lib/sheets/inactive-students.ts`.
- Purpose: NextAuth v5 beta with Google provider, allowlisted by `STAFF_ALLOWLIST` env var.
- Location: `web/src/auth.ts` (exports `handlers`, `auth`, `signIn`, `signOut`), `web/src/lib/auth/session.ts` (`requireSessionUser()` guard that throws `"Unauthorized"`).
- Session callback normalizes email to lowercase; sign-in callback rejects non-allowlisted emails.
- Env reads via `web/src/lib/runtime/env.ts` (`getAuthEnv()`, `getAllowedEmails()`).
- Purpose: Authenticated Google Sheets API access via `googleapis` service account JWT.
- Location: `web/src/lib/sheets/`
- Files:
- Purpose: TypeScript port of the Apps Script business logic — identical rules, identical outputs.
- Location: `web/src/lib/dashboard/`
- Files and responsibilities:
- Purpose: Environment variable reading split by concern.
- Location: `web/src/lib/runtime/env.ts`
- Contains: `required()` validator, `getAuthEnv()`, `getSheetsEnv()`, `getAllowedEmails()`.
- Purpose: Two-level cache — process-local memory cache for Sheets reads (15 s) plus Next.js `unstable_cache` tagged entry for the computed dashboard payload (60 s revalidate).
- Location: `web/src/lib/cache/memory-cache.ts` (`getMemoryCache`, `setMemoryCache`, `getOrSetMemoryCache`, `clearMemoryCache`) used by `source-loader.ts`, `sheets/actions.ts`, and `sheets/inactive-students.ts`.
- The payload-level cache lives in `web/src/lib/dashboard/service.ts`.
- Purpose: React 19 client components rendered inside the protected App Router segment.
- Location: `web/src/components/dashboard/`
- Orchestrator: `web/src/components/dashboard/dashboard-shell.tsx` (1013 lines, `"use client"`).
- Decomposed sub-components: `queue-panel.tsx`, `student-detail.tsx`, `calendar-panel.tsx`, `summary-bar.tsx`, `filter-toolbar.tsx`, `bulk-action-bar.tsx`, `line-preview-modal.tsx` (exports `LinePreviewDrawer`), `toast-notification.tsx`.
- Custom hooks at `web/src/hooks/`: `use-keyboard-shortcuts.ts`, `use-resizable-split.ts`, `use-theme.ts`.
- Shared utilities at `web/src/lib/dashboard/ui-helpers.ts`.
- Global styles at `web/src/app/globals.css`.
- Purpose: Vitest-based unit tests for business logic and route handlers.
- Location: `web/src/test/`
- Files: `web/src/test/dashboard-logic.test.ts` (sheet-snapshot fixture port of Apps Script validation suite), `web/src/test/actions-route.test.ts` (NextResponse behavior with mocked dependencies).
- Purpose: External-facing payload and session types used by both frontend and API routes.
- Location: `web/src/types/`
- Files: `web/src/types/dashboard.ts` (DashboardPayload, StudentRecord, PackageRecord, StudentQueueRow, CalendarPayload, SummaryPayload, ActionState, AppSessionUser), `web/src/types/next-auth.d.ts`.
- Purpose: Ops automation invoked via `tsx` from the `scripts` npm section.
- Location: `web/scripts/`
- Files: `web/scripts/compare-live.ts` (runs `buildDashboardPayloadUncached()` vs `clasp run fetchDashboardData` — currently blocked on Apps Script authorization), `web/scripts/ensure-action-sheets.ts`, `web/scripts/ensure-inactive-sheet.ts`.
## Data Flow
### Apps Script load path (production)
### Apps Script action-state write path
### Next.js load path (shadow)
### Next.js action-state write path
## Key Abstractions
### Sheet snapshot
- Purpose: Uniform shape for reading any source sheet, validating required columns, and indexing cells by column name.
- Apps Script: `getSheetSnapshot(spreadsheet, sheetName, requiredColumns, options)` in `DashboardDataLoading.gs`.
- Next.js: `getSheetSnapshot(range, sheetName, requiredColumns, options?)` in `web/src/lib/sheets/source-loader.ts`. Shape typed as `SheetSnapshot` in `web/src/lib/dashboard/domain.ts`.
- Shape: `{ sheetName, headerRowIndex, dataRowStartIndex, cols: Record<string, number>, rows: unknown[][] }`.
### Student key (dashboard identifier)
- Purpose: Stable primary key for action state and inactive-student lookup that survives column renames.
- Format: `<normalized-student-name>::<normalized-parent-name>` (both lowercased, whitespace-collapsed; `"missing-parent"` fallback when parent is blank).
- Apps Script: `buildDashboardStudentKey(studentName, parentName)` in `SharedHelpers.gs`.
- Next.js: `buildDashboardStudentKey(studentName, parentName)` in `web/src/lib/dashboard/helpers.ts`.
### Student–package key (deduplication key)
- Format: `<student-name>|||<package-name>` (trimmed, not lowercased).
- Both stacks: `buildStudentPackageKey()`.
### Package record
- Purpose: Canonical per-package projection, balance, and status shape returned in the payload.
- TypeScript contract: `PackageRecord` in `web/src/types/dashboard.ts`.
- Constructor: `createPackageRecord(...)` in `DashboardPackages.gs` and `web/src/lib/dashboard/packages.ts`.
### Student queue row
- Purpose: Aggregated per-student queue entry with rolled-up balances, priority score, and action state.
- TypeScript contract: `StudentQueueRow` in `web/src/types/dashboard.ts`.
- Builder: `buildStudentQueueRow()` in both stacks.
### Chunked cache protocol (Apps Script only)
- Purpose: Work around Apps Script response-size limits for the payload.
- Meta key: `BG_DASHBOARD_PAYLOAD_V2::meta` → `{ parts: <N> }`.
- Part keys: `BG_DASHBOARD_PAYLOAD_V2::part::<index>` → chunk string.
- Readers: `readChunkedCacheValue()`, `readChunkedCacheManifest()` in `DashboardState.gs`.
- Writer: `writeChunkedCacheValue()` in `DashboardState.gs`.
### Tagged revalidation cache (Next.js only)
- Tag: `dashboard-payload` (defined as `DASHBOARD_CACHE_TAG` in `web/src/lib/dashboard/config.ts`).
- Built via `unstable_cache(buildDashboardPayloadUncached, [DASHBOARD_CACHE_TAG], { revalidate: 60, tags: [DASHBOARD_CACHE_TAG] })` in `web/src/lib/dashboard/service.ts`.
- Invalidated via `revalidateTag(DASHBOARD_CACHE_TAG, "max")`.
### Action-state store
- Apps Script: Script properties under prefix `BG_ACTION_V1::<studentKey>`, history limited to 20 entries per student.
- Next.js: Two sheet tabs in the analytics spreadsheet — `DashboardActionsState` (current state, columns `student_key, student_name, parent_name, status, updated_at, updated_by_email, updated_by_name`) and `DashboardActionLog` (append-only audit, adds `event_id` and `action_type`).
- Same-day visibility: `sanitizeStudentActionState()` in both stacks drops rows whose `updatedAt` date is not today.
## Entry Points
### Apps Script
- `doGet()` in `Code.gs` — HTTP GET entry for the deployed web app (`ANYONE_ANONYMOUS` access per `appsscript.json`). Returns the HTML shell.
- `fetchDashboardData()` / `getStudentData()` / `beginDashboardDataTransfer(options)` / `fetchDashboardDataChunk(index, options)` / `fetchDashboardDataChunkBatch(startIndex, batchSize, options)` in `Code.gs` — exposed to the browser via `google.script.run`.
- `setStudentAction(studentKey, status, actorAdminKey, options)` / `bulkSetStudentAction(...)` / `clearStudentAction(...)` in `DashboardActions.gs` — action mutations.
- `runValidationSuite()` / `runLiveAccuracyAudit()` / `inspectStudentPackageBalance(...)` in `Validation.gs` — invoked via `clasp run`.
### Next.js
- `app/page.tsx`, `app/signin/page.tsx`, `app/(protected)/dashboard/page.tsx` — HTML routes.
- `app/api/dashboard/route.ts::GET` — dashboard payload.
- `app/api/actions/route.ts::POST` — single action write.
- `app/api/actions/bulk/route.ts::POST` — bulk write.
- `app/api/actions/history/route.ts::GET` — 7-day action log per student.
- `app/api/health/route.ts::GET` — ops health probe.
- `app/api/inactive/route.ts::POST, DELETE` — inactive-student toggle.
- `app/api/auth/[...nextauth]/route.ts::GET, POST` — NextAuth handlers.
### Scripts (npm)
- `npm test` → `vitest run` (at `web/`).
- `npm run build` → `next build`.
- `npm run compare-live` → `tsx scripts/compare-live.ts` (parity check).
- `npm run ensure-action-sheets` → `tsx scripts/ensure-action-sheets.ts`.
- `npm run ensure-inactive-sheet` → `tsx scripts/ensure-inactive-sheet.ts`.
## Error Handling
- Apps Script: throw `Error` objects with Thai-language prefixes (`"ดึงข้อมูลไม่ได้: "`) and English technical detail; `Logger.log()` the full stack before rethrow.
- Next.js route handlers: catch at the handler boundary and return `NextResponse.json({ error }, { status })`. Use `requireSessionUser()` which throws `"Unauthorized"`, caught to return 401; all other errors return 500.
- Client: `DashboardShell` maintains an `error` string in state and persists error toasts until dismissed (success toasts fade after 3.5 s).
- Apps Script `validateRequiredColumns()` throws with the missing-column list so sheet-contract drift fails loudly at load time.
- Next.js `required()` in `web/src/lib/runtime/env.ts` throws with the variable name on any missing env var; auth-related and sheets-related vars are split into `getAuthEnv()` and `getSheetsEnv()` so the dashboard page can render sign-in even when Sheets env is misconfigured.
- Apps Script chunked transfer: if chunk metadata or parts disappear mid-transfer, the server rebuilds slices and the browser retries the transfer once.
## Cross-Cutting Concerns
- Apps Script: `Logger.log()` for build errors and validation summaries.
- Next.js: No structured logger configured; relies on `console.error` and Vercel log capture.
- Apps Script sheet-contract validation in `DashboardDataLoading.gs::validateRequiredColumns()` + `Validation.gs::runValidationSuite()` (41 fixture tests covering package rules, admin ownership, pending deductions, queue aggregation, calendar grouping, cache behavior, chunked transport).
- Next.js fixture tests in `web/src/test/dashboard-logic.test.ts` and `web/src/test/actions-route.test.ts`.
- Type-level validation via strict TypeScript (`"strict": true` in `web/tsconfig.json`).
- Apps Script: `ANYONE_ANONYMOUS` access per `appsscript.json` (known PRD gap — deployment access model pending hardening).
- Next.js: NextAuth v5 beta with Google provider, allowlisted by `STAFF_ALLOWLIST` env var. Session email is lowercased. `requireSessionUser()` enforces email + name presence.
- Apps Script: `Session.getScriptTimeZone()` (project is set to `Asia/Bangkok` per `appsscript.json`).
- Next.js: `Intl.DateTimeFormat` with explicit `timeZone: "Asia/Bangkok"` in `web/src/lib/dashboard/helpers.ts::formatDateTime()` and `formatShortTimestamp()`.
## Parity & Diagnostics Tooling
- `runLiveAccuracyAudit()` in `Validation.gs` — compares the generated payload against a fresh independent recomputation from the same source sheets and writes mismatches to a sheet tab named by `SHEET_AUDIT_REPORT` (`Dashboard Accuracy Audit`).
- `inspectStudentPackageBalance(studentName, packageName)` — returns source-row-level arithmetic trail for one package.
- `runValidationSuite()` — 41 fixture tests covering all business rules; required after changes to balance logic, source-sheet rules, or action-state persistence.
- `web/scripts/compare-live.ts` — invoked via `npm run compare-live`; loads the Next.js payload (from `buildDashboardPayloadUncached()` or a deployed `NEXT_BASE_URL`) and the Apps Script payload (via `clasp run fetchDashboardData`) and emits a mismatch list with types `QueueComparableField` and `PackageComparableField`. **Currently blocked** because `clasp run fetchDashboardData` fails on `SpreadsheetApp.openById` authorization. Does not affect the shadow app itself.
- `web/scripts/ensure-action-sheets.ts` — creates `DashboardActionsState` and `DashboardActionLog` tabs if missing and writes headers.
- `web/scripts/ensure-inactive-sheet.ts` — creates `InactiveStudents` tab if missing and writes headers.
- `web/src/app/api/health/route.ts` — runtime health probe reporting auth state, Sheets probe success, and cache stats.
## Relationship Between The Two Stacks
- Both stacks open the same two Google spreadsheets (`SPREADSHEET_ID_CREDITS = 100bidSt63ynf_y7Iq-nRQUj3MMQoNpnltOQdSiwHN-0`, `SPREADSHEET_ID_ANALYTICS = 15XTOU1kYDib4stuiFzbTOT1MAeRlCw20maOXk5irfsc`).
- Both read the same six source tabs: `Aggregations`, `Credit_Control`, `Upcoming Sessions`, `Students`, `Students & Courses`, `RemainingCredits`.
- Business rules (active filter, exclusions, admin ownership, pending deduction computation with `Should_Credit`/duration fallback, projection, priority scoring, queue roll-up, calendar day grouping) produce byte-identical payloads modulo ordering/rounding — which is what `compare-live` validates.
- Apps Script stores action history and snapshots in `PropertiesService` (script-scoped).
- Next.js stores action state in sheet tabs (`DashboardActionsState`, `DashboardActionLog`) so the shadow can run with no Apps Script state dependency. Snapshot/history store in Next.js is in-process (`web/src/lib/dashboard/snapshot-store.ts`) — an acknowledged parity gap since deltas will reset on cold starts.
- Next.js adds a concept Apps Script does not have: an `InactiveStudents` sheet with auto-reactivation logic when a student reappears with active packages.
- Apps Script is the live production surface; the Vercel deployment is shadow-only.
- `compare-live.ts` is the intended parity gate.
- The shadow stack duplicates the business-rule layer in TypeScript (see `web/src/lib/dashboard/*.ts`) rather than calling back into Apps Script, so the two runtimes are fully independent once the shared sheets are reachable.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
