# Architecture

**Analysis Date:** 2026-04-20

## Pattern Overview

**Overall:** Hybrid dual-stack architecture — legacy Google Apps Script web app (production) running in parallel with a Next.js 16 shadow migration targeted at Vercel. Both stacks consume the same Google Sheets as the source of truth and implement the same business rules so the shadow can be validated for parity before cutover.

**Key Characteristics:**

- Source-of-truth data lives in Google Sheets (`BeGifted Student Credits` + `BeGifted Education Analytics`); neither stack owns a database.
- Both stacks share the same constants (alert threshold `2`, notify window `30` days), admin registry (6 named admins + `unassigned`), excluded package keywords (`pretest`, `trial`), and package status enum (`notify`/`watch`/`ok`/`nodata`).
- Business logic is layered identically in both stacks: data loading → active-student filtering → exclusion rules → admin ownership resolution → pending deduction computation → projection → analytics shaping (queue, calendar, summary).
- The Apps Script backend persists action state and snapshots to `PropertiesService`; the Next.js shadow persists the same concepts to dedicated analytics sheet tabs (`DashboardActionsState`, `DashboardActionLog`, `InactiveStudents`).
- The Apps Script frontend is a monolithic `dashboard.html` served by `doGet()`. The Next.js frontend is a decomposed React shell under `web/src/components/dashboard/` driven by an orchestrator (`dashboard-shell.tsx`).
- The Apps Script runtime streams the computed payload in 90 KB chunks through `CacheService`; the Next.js runtime uses Next's `unstable_cache` tagged with `dashboard-payload` plus a 15 s process-local memory cache for Sheets reads.

## Layers

### Google Apps Script stack (production, at repo root)

**Bootstrap / Entry layer:**
- Purpose: Serves the web-app shell, orchestrates cached chunked payload delivery, and defines all shared constants.
- Location: `Code.gs`
- Contains: `doGet()` web-app entrypoint, `beginDashboardDataTransfer()`, `fetchDashboardDataChunk()`, `fetchDashboardDataChunkBatch()`, `getCachedDashboardPayload()`, `buildAndPersistDashboardPayload()`, plus constants (`SPREADSHEET_ID_CREDITS`, `SPREADSHEET_ID_ANALYTICS`, `ALERT_THRESHOLD`, `ADMIN_OWNER_REGISTRY`, `REQUIRED_COLUMNS`, `DASHBOARD_CACHE_KEY`, `DASHBOARD_CACHE_TTL_SECONDS = 120`, `DASHBOARD_CACHE_CHUNK_SIZE = 90000`).
- Depends on: `DashboardDataLoading.gs`, `DashboardPackages.gs`, `DashboardAnalytics.gs`, `DashboardState.gs`.
- Used by: `dashboard.html` frontend client code (`google.script.run`) and external `clasp run` callers.

**Data-access layer:**
- Purpose: Read the six required sheets through `SpreadsheetApp.openById()` and enforce column contracts.
- Location: `DashboardDataLoading.gs`
- Contains: `loadDashboardSources()`, `getSheetSnapshot()`, `findHeaderRowIndex()`, `validateRequiredColumns()`.
- Depends on: `SharedHelpers.gs` (generic spreadsheet helpers), plus `Code.gs` constants.
- Used by: `Code.gs` (`buildAndPersistDashboardPayload`) and `Validation.gs` diagnostics.

**Business-rule layer (package assembly):**
- Purpose: Apply the core business rules (active filter, exclusions, admin ownership, pending deductions, duplicate merging, package record construction).
- Location: `DashboardPackages.gs`
- Contains: `buildActiveStudentSet()`, `buildExcludedPackageReasons()`, `buildStudentAdminOwnershipMap()`, `buildPendingDeductionContext()`, `buildPendingDeductionDetail()`, `buildUpcomingSessionMap()`, `buildDashboardPayload()`, `createPackageRecord()`, `upsertPackageRecord()`, `getRecommendedAction()`, `getActionReason()`.
- Depends on: `DashboardProjection.gs`, `SharedHelpers.gs`.
- Used by: `Code.gs`, `DashboardAnalytics.gs`, `Validation.gs`.

**Projection layer:**
- Purpose: Iterate upcoming sessions chronologically to compute alert/exhaust dates and assign package status.
- Location: `DashboardProjection.gs`
- Contains: `computeProjection()`, `worstStatus()`, `DAY_MS` constant.
- Depends on: `SharedHelpers.gs`.
- Used by: `DashboardPackages.gs`, `DashboardAnalytics.gs`.

**Analytics / view-model layer:**
- Purpose: Transform package records into the queue, calendar day groupings, summary counts with deltas, and persistence snapshot used by the frontend payload.
- Location: `DashboardAnalytics.gs`
- Contains: `buildDashboardModel()`, `buildPackageRows()`, `computePriorityScore()`, `buildStudentQueue()`, `buildStudentQueueRow()`, `compareStudentQueueRows()`, `buildCalendarData()`, `buildSummary()`, `buildSummaryDeltas()`, `buildWeeklyBuckets()`, `buildSnapshotForPersistence()`, `updateHistory()`.
- Depends on: `DashboardPackages.gs`, `DashboardProjection.gs`, `DashboardActions.gs`, `SharedHelpers.gs`.
- Used by: `Code.gs` (`buildAndPersistDashboardPayload`).

**Action-state layer:**
- Purpose: Persist per-student follow-up state (contacted/pending-callback/resolved) with actor attribution, trim history, and invalidate the dashboard cache on writes. **Stateful ownership slice.**
- Location: `DashboardActions.gs`
- Contains: `setStudentAction()`, `bulkSetStudentAction()`, `clearStudentAction()`, `writeStudentActionState()`, `attachActionStatesToStudents()`, `loadStudentActionStatesByStudentKey()`, `sanitizeStudentActionState()` (same-day visibility gate), `resolveStudentActionActor()`.
- Storage: `PropertiesService.getScriptProperties()` under `BG_ACTION_V1::<studentKey>` keys; history limit `20` entries per student.
- Depends on: `SharedHelpers.gs`, `Code.gs` constants (`STUDENT_ACTION_STATUSES`, `STUDENT_ACTION_PROPERTY_PREFIX`, `ADMIN_OWNER_REGISTRY`), `DashboardState.gs` (`clearDashboardCache`).
- Used by: `DashboardAnalytics.gs` (`buildDashboardModel`), `Validation.gs`.

**State / cache layer:**
- Purpose: Manage chunked `CacheService` payload storage plus snapshot/history persistence via `PropertiesService`.
- Location: `DashboardState.gs`
- Contains: `loadSnapshotState()`, `persistSnapshotState()`, `getDashboardCache()`, `readChunkedCacheValue()`, `readChunkedCacheManifest()`, `writeChunkedCacheValue()`, `clearDashboardCache()`, `chunkString()`.
- Storage: `CacheService.getScriptCache()` with meta key `BG_DASHBOARD_PAYLOAD_V2::meta` and part keys `BG_DASHBOARD_PAYLOAD_V2::part::<N>`; 2-minute TTL.
- Used by: `Code.gs`, `DashboardActions.gs`.

**Cross-cutting helpers:**
- Purpose: Generic spreadsheet/date/parsing utilities shared across all Apps Script slices.
- Location: `SharedHelpers.gs`
- Contains: `getSheetData()`, `getColMap()`, `readTrimmedCell()`, `readUpperCell()`, `parseNumber()`, `normalizeText()`, `buildDashboardStudentKey()`, `getTodayDate()`, `parseDate()`, `roundToTenth()`, `roundToHundredth()`, `formatDate()`, `formatDateTime()`, `parseJsonSafely()`.

**Validation / diagnostics layer:**
- Purpose: Fixture-based validation suite plus live-sheet parity and inspection tools.
- Location: `Validation.gs` (80 KB, 2411 lines — the largest file in the repo)
- Contains: `runValidationSuite()` (41 test functions), `inspectStudentPackageBalance(studentName, packageName)`, `runLiveAccuracyAudit()` (writes to `Dashboard Accuracy Audit` sheet), `buildAuditExpectedModel()`, `buildLiveAccuracyAuditReport()`, all audit-mirror helpers prefixed `buildAudit*`.

**Frontend:**
- Purpose: Browser-side command center and student detail UI rendered into the Apps Script web app shell.
- Location: `dashboard.html` (3673 lines, single file)
- Contains: CSS, state machine for async payload reconstruction (chunk batch requests of 5 parts), admin-tab filtering, queue rendering, triage-first calendar, student detail, LINE message preview.

### Next.js shadow stack (at `web/`)

**Entry / route layer (App Router):**
- Purpose: Next.js 16 App Router pages and API routes.
- Location: `web/src/app/`
- Route segments:
  - `web/src/app/page.tsx` — root redirect based on session to `/dashboard` or `/signin`.
  - `web/src/app/signin/page.tsx` — Google Sign-In server-action form.
  - `web/src/app/(protected)/dashboard/page.tsx` — server component that calls `auth()`, redirects unauthenticated users, and renders `<DashboardShell>` client component.
  - `web/src/app/layout.tsx` — root layout with `globals.css`.
- Used by: Next.js runtime on Vercel.

**API layer (Route Handlers):**
- Purpose: JSON REST endpoints for the shadow dashboard, all pinned to `export const runtime = "nodejs"`.
- Location: `web/src/app/api/`
- Endpoints:
  - `web/src/app/api/dashboard/route.ts` — `GET /api/dashboard` returns the computed payload (auth-gated).
  - `web/src/app/api/actions/route.ts` — `POST /api/actions` writes single student action.
  - `web/src/app/api/actions/bulk/route.ts` — `POST /api/actions/bulk` writes multiple.
  - `web/src/app/api/actions/history/route.ts` — `GET /api/actions/history?studentKey=...` reads last 7 days from `DashboardActionLog` sheet.
  - `web/src/app/api/health/route.ts` — `GET /api/health` probes auth, Sheets read, and cache state.
  - `web/src/app/api/inactive/route.ts` — `POST /api/inactive` and `DELETE /api/inactive` mark/clear inactive students.
  - `web/src/app/api/auth/[...nextauth]/route.ts` — NextAuth v5 beta catch-all handlers.
- Depends on: `web/src/auth.ts`, `web/src/lib/auth/session.ts`, `web/src/lib/dashboard/service.ts`, `web/src/lib/sheets/actions.ts`, `web/src/lib/sheets/inactive-students.ts`.

**Auth layer:**
- Purpose: NextAuth v5 beta with Google provider, allowlisted by `STAFF_ALLOWLIST` env var.
- Location: `web/src/auth.ts` (exports `handlers`, `auth`, `signIn`, `signOut`), `web/src/lib/auth/session.ts` (`requireSessionUser()` guard that throws `"Unauthorized"`).
- Session callback normalizes email to lowercase; sign-in callback rejects non-allowlisted emails.
- Env reads via `web/src/lib/runtime/env.ts` (`getAuthEnv()`, `getAllowedEmails()`).

**Data-access / integration layer:**
- Purpose: Authenticated Google Sheets API access via `googleapis` service account JWT.
- Location: `web/src/lib/sheets/`
- Files:
  - `web/src/lib/sheets/client.ts` — singleton `getSheetsClient()` that builds a JWT from `SHEETS_SERVICE_ACCOUNT_EMAIL` + `SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`.
  - `web/src/lib/sheets/source-loader.ts` — `loadDashboardSources()` does `batchGet` across the six source sheets in one round-trip per spreadsheet; wrapped in 15 s memory cache.
  - `web/src/lib/sheets/actions.ts` — `loadActionStates()`, `setStudentActionInSheets()`, `clearStudentActionInSheets()`, `ensureActionSheetsExist()` writing to `DashboardActionsState` and `DashboardActionLog` tabs.
  - `web/src/lib/sheets/inactive-students.ts` — `loadInactiveStudents()`, `markStudentInactive()`, `clearStudentInactive()`, `removeInactiveStudents()`, `ensureInactiveStudentsSheetExists()` targeting the `InactiveStudents` tab.

**Business-rule / domain layer:**
- Purpose: TypeScript port of the Apps Script business logic — identical rules, identical outputs.
- Location: `web/src/lib/dashboard/`
- Files and responsibilities:
  - `web/src/lib/dashboard/config.ts` — constants (mirrors `Code.gs`: `ALERT_THRESHOLD`, `NOTIFY_WINDOW_DAYS`, `ADMIN_OWNER_REGISTRY`, `REQUIRED_COLUMNS`, `DASHBOARD_CACHE_TAG = "dashboard-payload"`, `DASHBOARD_CACHE_REVALIDATE_SECONDS = 60`, `SHEETS_IN_MEMORY_TTL_MS = 15000`, sheet-name constants).
  - `web/src/lib/dashboard/domain.ts` — internal type definitions (`SheetSnapshot`, `DashboardSources`, `PackageRow`, `DashboardSnapshotState`, `ActionStateMap`).
  - `web/src/lib/dashboard/helpers.ts` — port of `SharedHelpers.gs`.
  - `web/src/lib/dashboard/packages.ts` — port of `DashboardPackages.gs`.
  - `web/src/lib/dashboard/projection.ts` — port of `DashboardProjection.gs`.
  - `web/src/lib/dashboard/analytics.ts` — port of `DashboardAnalytics.gs` (`buildDashboardModel`, `buildPackageRows`, `buildStudentQueue`, `buildCalendarData`, `buildSummary`).
  - `web/src/lib/dashboard/actions.ts` — sanitization + same-day visibility gate (`normalizeStudentActionStatus`, `sanitizeStudentActionState`, `attachActionStatesToStudents`, `isActionStateToday`).
  - `web/src/lib/dashboard/build.ts` — `buildDashboardPayloadUncached(now?)` orchestrator mirroring Apps Script `buildAndPersistDashboardPayload`; adds inactive-student filtering + auto-reactivation.
  - `web/src/lib/dashboard/service.ts` — `getDashboardPayload()` wraps the builder with `unstable_cache(... , [DASHBOARD_CACHE_TAG], { revalidate: 60, tags: [DASHBOARD_CACHE_TAG] })`; `invalidateDashboardPayloadCache()` calls `revalidateTag(..., "max")`.
  - `web/src/lib/dashboard/snapshot-store.ts` — in-process snapshot/history store (not persisted across deployments — parity-gap compared to Apps Script `PropertiesService`).
  - `web/src/lib/dashboard/health-state.ts` — in-process build-health counters read by `/api/health`.
  - `web/src/lib/dashboard/ui-helpers.ts` — types and pure utilities shared across frontend components (`RiskFilter`, `CalendarView`, `SortField`, `Toast`, `formatNumber`, `formatShortDate`, `statusLabel`, `buildParentMessage`, `getVisibleCalendarDates`).

**Runtime / config layer:**
- Purpose: Environment variable reading split by concern.
- Location: `web/src/lib/runtime/env.ts`
- Contains: `required()` validator, `getAuthEnv()`, `getSheetsEnv()`, `getAllowedEmails()`.

**Cache layer:**
- Purpose: Two-level cache — process-local memory cache for Sheets reads (15 s) plus Next.js `unstable_cache` tagged entry for the computed dashboard payload (60 s revalidate).
- Location: `web/src/lib/cache/memory-cache.ts` (`getMemoryCache`, `setMemoryCache`, `getOrSetMemoryCache`, `clearMemoryCache`) used by `source-loader.ts`, `sheets/actions.ts`, and `sheets/inactive-students.ts`.
- The payload-level cache lives in `web/src/lib/dashboard/service.ts`.

**Frontend / UI layer:**
- Purpose: React 19 client components rendered inside the protected App Router segment.
- Location: `web/src/components/dashboard/`
- Orchestrator: `web/src/components/dashboard/dashboard-shell.tsx` (1013 lines, `"use client"`).
- Decomposed sub-components: `queue-panel.tsx`, `student-detail.tsx`, `calendar-panel.tsx`, `summary-bar.tsx`, `filter-toolbar.tsx`, `bulk-action-bar.tsx`, `line-preview-modal.tsx` (exports `LinePreviewDrawer`), `toast-notification.tsx`.
- Custom hooks at `web/src/hooks/`: `use-keyboard-shortcuts.ts`, `use-resizable-split.ts`, `use-theme.ts`.
- Shared utilities at `web/src/lib/dashboard/ui-helpers.ts`.
- Global styles at `web/src/app/globals.css`.

**Testing layer:**
- Purpose: Vitest-based unit tests for business logic and route handlers.
- Location: `web/src/test/`
- Files: `web/src/test/dashboard-logic.test.ts` (sheet-snapshot fixture port of Apps Script validation suite), `web/src/test/actions-route.test.ts` (NextResponse behavior with mocked dependencies).

**Shared type layer:**
- Purpose: External-facing payload and session types used by both frontend and API routes.
- Location: `web/src/types/`
- Files: `web/src/types/dashboard.ts` (DashboardPayload, StudentRecord, PackageRecord, StudentQueueRow, CalendarPayload, SummaryPayload, ActionState, AppSessionUser), `web/src/types/next-auth.d.ts`.

**Parity / ops scripts:**
- Purpose: Ops automation invoked via `tsx` from the `scripts` npm section.
- Location: `web/scripts/`
- Files: `web/scripts/compare-live.ts` (runs `buildDashboardPayloadUncached()` vs `clasp run fetchDashboardData` — currently blocked on Apps Script authorization), `web/scripts/ensure-action-sheets.ts`, `web/scripts/ensure-inactive-sheet.ts`.

## Data Flow

### Apps Script load path (production)

1. Admin opens the deployed web-app URL.
2. `doGet()` in `Code.gs` immediately returns `dashboard.html` via `HtmlService.createHtmlOutputFromFile("dashboard")` without doing any spreadsheet reads.
3. The browser renders the shell and then calls `google.script.run.beginDashboardDataTransfer()`.
4. `beginDashboardDataTransfer()` reads the chunked cache manifest first. If the manifest exists, it returns `{ mode: "chunked", parts }` without invoking the payload builder (warm cache). If not, it calls `fetchDashboardData()` → `getCachedDashboardPayload()` → `buildAndPersistDashboardPayload()`.
5. `buildAndPersistDashboardPayload()` runs the full pipeline: `loadDashboardSources()` → `buildActiveStudentSet()` → `buildExcludedPackageReasons()` → `buildStudentAdminOwnershipMap()` → `buildPendingDeductionContext()` → `buildUpcomingSessionMap()` → `buildDashboardPayload()` → `buildDashboardModel()` (which calls `attachActionStatesToStudents()`, `buildPackageRows()`, `buildStudentQueue()`, `buildCalendarData()`, `buildSummary()`, `buildSnapshotForPersistence()`).
6. Payload is written to `CacheService` as chunked parts (`DASHBOARD_CACHE_CHUNK_SIZE = 90000` bytes each) with a 2-minute TTL; snapshot is written to `PropertiesService`.
7. Browser calls `fetchDashboardDataChunkBatch(startIndex, 5)` repeatedly until all chunks are received. If a chunk is missing mid-transfer the builder re-runs once.
8. Client reconstructs JSON and renders the queue, calendar, and detail views.

### Apps Script action-state write path

1. Frontend calls `google.script.run.setStudentAction(studentKey, status, actorAdminKey)` (or bulk/clear variants).
2. `DashboardActions.gs::writeStudentActionState()` loads existing history from `ScriptProperties`, prepends a new entry, trims to 20, and persists.
3. `clearDashboardCache()` removes the chunked cache entries so the next load rebuilds.
4. Response returns the sanitized (same-day-only) action state.

### Next.js load path (shadow)

1. Admin opens the Vercel URL; Next.js routes through `app/page.tsx` or `app/signin/page.tsx`.
2. NextAuth session check in `app/(protected)/dashboard/page.tsx` either redirects to `/signin` or renders `<DashboardShell>` with `{ email, name }`.
3. `DashboardShell` fetches `GET /api/dashboard`.
4. `app/api/dashboard/route.ts` runs `auth()` guard, then calls `getDashboardPayload()` from `web/src/lib/dashboard/service.ts`.
5. `getDashboardPayload()` hits `unstable_cache` entry tagged `dashboard-payload`. On a miss, it calls `buildDashboardPayloadUncached(now)` in `web/src/lib/dashboard/build.ts`.
6. `buildDashboardPayloadUncached()` calls `loadDashboardSources()` (Sheets `batchGet` wrapped in 15 s memory cache), runs the same pipeline as Apps Script (`buildActiveStudentSet` → `buildExcludedPackageReasons` → `buildStudentAdminOwnershipMap` → `buildPendingDeductionContext` → `buildUpcomingSessionMap` → `buildDashboardStudents`), calls `loadActionStates(today)` to read the `DashboardActionsState` sheet, calls `attachActionStatesToStudents(students, today, actionStates)`, filters out rows from `InactiveStudents` tab with auto-reactivation, and runs `buildDashboardModel()`.
7. `unstable_cache` stores the payload for 60 s; `invalidateDashboardPayloadCache()` calls `revalidateTag("dashboard-payload", "max")` on any write.
8. Client receives JSON and re-renders. The client polls `GET /api/dashboard` every 60 seconds when the tab is focused.

### Next.js action-state write path

1. `DashboardShell` calls `fetch("/api/actions", { method: "POST", body: { studentKey, status }})`.
2. `app/api/actions/route.ts` validates session via `requireSessionUser()`, looks up the student in the cached payload to recover `studentName`/`parentName`, then calls `setStudentActionInSheets()` or `clearStudentActionInSheets()`.
3. `web/src/lib/sheets/actions.ts` appends a row to the `DashboardActionLog` tab and updates or appends on `DashboardActionsState` via `spreadsheets.values.update` / `append`.
4. `clearMemoryCache("sheets:action-state")` busts the 15 s action cache.
5. `invalidateDashboardPayloadCache()` revalidates the `dashboard-payload` tag so the next `/api/dashboard` call rebuilds.

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

**Strategy:**
- Apps Script: throw `Error` objects with Thai-language prefixes (`"ดึงข้อมูลไม่ได้: "`) and English technical detail; `Logger.log()` the full stack before rethrow.
- Next.js route handlers: catch at the handler boundary and return `NextResponse.json({ error }, { status })`. Use `requireSessionUser()` which throws `"Unauthorized"`, caught to return 401; all other errors return 500.
- Client: `DashboardShell` maintains an `error` string in state and persists error toasts until dismissed (success toasts fade after 3.5 s).

**Patterns:**
- Apps Script `validateRequiredColumns()` throws with the missing-column list so sheet-contract drift fails loudly at load time.
- Next.js `required()` in `web/src/lib/runtime/env.ts` throws with the variable name on any missing env var; auth-related and sheets-related vars are split into `getAuthEnv()` and `getSheetsEnv()` so the dashboard page can render sign-in even when Sheets env is misconfigured.
- Apps Script chunked transfer: if chunk metadata or parts disappear mid-transfer, the server rebuilds slices and the browser retries the transfer once.

## Cross-Cutting Concerns

**Logging:**
- Apps Script: `Logger.log()` for build errors and validation summaries.
- Next.js: No structured logger configured; relies on `console.error` and Vercel log capture.

**Validation:**
- Apps Script sheet-contract validation in `DashboardDataLoading.gs::validateRequiredColumns()` + `Validation.gs::runValidationSuite()` (41 fixture tests covering package rules, admin ownership, pending deductions, queue aggregation, calendar grouping, cache behavior, chunked transport).
- Next.js fixture tests in `web/src/test/dashboard-logic.test.ts` and `web/src/test/actions-route.test.ts`.
- Type-level validation via strict TypeScript (`"strict": true` in `web/tsconfig.json`).

**Authentication:**
- Apps Script: `ANYONE_ANONYMOUS` access per `appsscript.json` (known PRD gap — deployment access model pending hardening).
- Next.js: NextAuth v5 beta with Google provider, allowlisted by `STAFF_ALLOWLIST` env var. Session email is lowercased. `requireSessionUser()` enforces email + name presence.

**Timezone:**
- Apps Script: `Session.getScriptTimeZone()` (project is set to `Asia/Bangkok` per `appsscript.json`).
- Next.js: `Intl.DateTimeFormat` with explicit `timeZone: "Asia/Bangkok"` in `web/src/lib/dashboard/helpers.ts::formatDateTime()` and `formatShortTimestamp()`.

## Parity & Diagnostics Tooling

**Apps Script live audit:**
- `runLiveAccuracyAudit()` in `Validation.gs` — compares the generated payload against a fresh independent recomputation from the same source sheets and writes mismatches to a sheet tab named by `SHEET_AUDIT_REPORT` (`Dashboard Accuracy Audit`).
- `inspectStudentPackageBalance(studentName, packageName)` — returns source-row-level arithmetic trail for one package.
- `runValidationSuite()` — 41 fixture tests covering all business rules; required after changes to balance logic, source-sheet rules, or action-state persistence.

**Shadow parity script:**
- `web/scripts/compare-live.ts` — invoked via `npm run compare-live`; loads the Next.js payload (from `buildDashboardPayloadUncached()` or a deployed `NEXT_BASE_URL`) and the Apps Script payload (via `clasp run fetchDashboardData`) and emits a mismatch list with types `QueueComparableField` and `PackageComparableField`. **Currently blocked** because `clasp run fetchDashboardData` fails on `SpreadsheetApp.openById` authorization. Does not affect the shadow app itself.

**Ops bootstrap scripts:**
- `web/scripts/ensure-action-sheets.ts` — creates `DashboardActionsState` and `DashboardActionLog` tabs if missing and writes headers.
- `web/scripts/ensure-inactive-sheet.ts` — creates `InactiveStudents` tab if missing and writes headers.
- `web/src/app/api/health/route.ts` — runtime health probe reporting auth state, Sheets probe success, and cache stats.

## Relationship Between The Two Stacks

**Same data, same rules:**
- Both stacks open the same two Google spreadsheets (`SPREADSHEET_ID_CREDITS = 100bidSt63ynf_y7Iq-nRQUj3MMQoNpnltOQdSiwHN-0`, `SPREADSHEET_ID_ANALYTICS = 15XTOU1kYDib4stuiFzbTOT1MAeRlCw20maOXk5irfsc`).
- Both read the same six source tabs: `Aggregations`, `Credit_Control`, `Upcoming Sessions`, `Students`, `Students & Courses`, `RemainingCredits`.
- Business rules (active filter, exclusions, admin ownership, pending deduction computation with `Should_Credit`/duration fallback, projection, priority scoring, queue roll-up, calendar day grouping) produce byte-identical payloads modulo ordering/rounding — which is what `compare-live` validates.

**Different state persistence:**
- Apps Script stores action history and snapshots in `PropertiesService` (script-scoped).
- Next.js stores action state in sheet tabs (`DashboardActionsState`, `DashboardActionLog`) so the shadow can run with no Apps Script state dependency. Snapshot/history store in Next.js is in-process (`web/src/lib/dashboard/snapshot-store.ts`) — an acknowledged parity gap since deltas will reset on cold starts.
- Next.js adds a concept Apps Script does not have: an `InactiveStudents` sheet with auto-reactivation logic when a student reappears with active packages.

**Cutover strategy:**
- Apps Script is the live production surface; the Vercel deployment is shadow-only.
- `compare-live.ts` is the intended parity gate.
- The shadow stack duplicates the business-rule layer in TypeScript (see `web/src/lib/dashboard/*.ts`) rather than calling back into Apps Script, so the two runtimes are fully independent once the shared sheets are reachable.

---

*Architecture analysis: 2026-04-20*
