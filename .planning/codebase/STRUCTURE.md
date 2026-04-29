# Codebase Structure

**Analysis Date:** 2026-04-20

## Directory Layout

```
Begifted-Ops/                         # Repo root — Apps Script project + Next.js shadow
├── .clasp.json                       # Tracked clasp binding to shared Apps Script project
├── .clasprc.local.json               # Local clasp auth (gitignored; never commit)
├── .github/                          # GitHub config
│   ├── CODEOWNERS
│   ├── ISSUE_TEMPLATE/
│   │   ├── agent-task.yml
│   │   └── config.yml
│   └── pull_request_template.md
├── .gitignore                        # Ignores .clasprc.local.json, .DS_Store, web/.next, web/node_modules
├── .planning/                        # GSD planning outputs
│   └── codebase/                     # Where these mapper docs live
├── AGENTS.md                         # Codex + general agent operating rules
├── CLAUDE.md                         # Claude-specific instructions
├── Code.gs                           # Apps Script bootstrap, constants, entry points
├── DashboardActions.gs               # Student action-state persistence (stateful slice)
├── DashboardAnalytics.gs             # Queue, calendar, summary, snapshot view-model
├── DashboardDataLoading.gs           # Sheet adapters + column validation
├── DashboardPackages.gs              # Active filter, exclusions, admin ownership, package assembly
├── DashboardProjection.gs            # Balance projection + status evaluation
├── DashboardState.gs                 # Chunked CacheService helpers + snapshot persistence
├── README.md                         # Project readme + setup
├── SharedHelpers.gs                  # Generic spreadsheet/date/parsing utilities
├── Validation.gs                     # Fixture suite + live parity audit (80 KB, 2411 lines)
├── appsscript.json                   # Apps Script manifest (timezone, oauthScopes, webapp)
├── dashboard.html                    # Monolithic web-app frontend (3673 lines)
├── docs/
│   ├── WORKFLOW.md                   # Shared collaboration policy
│   ├── app-overview.md               # Engineering-facing PRD summary
│   └── nextjs-shadow-handoff.md      # Shadow migration continuation brief
└── web/                              # Next.js 16 shadow app
    ├── .env                          # Local env vars (gitignored)
    ├── .env.example                  # Env var template
    ├── .gitignore                    # Ignores .vercel, .env, node_modules, .next
    ├── .vercel/                      # Vercel link metadata
    ├── next-env.d.ts                 # Next.js type augmentation
    ├── next.config.ts                # Next config (reactStrictMode: true)
    ├── package-lock.json
    ├── package.json                  # next 16.2.1, next-auth 5.0.0-beta.30, react 19.2.4
    ├── scripts/                      # TypeScript ops scripts (run via tsx)
    │   ├── compare-live.ts           # Parity check vs Apps Script payload
    │   ├── ensure-action-sheets.ts   # Create DashboardActionsState + DashboardActionLog tabs
    │   └── ensure-inactive-sheet.ts  # Create InactiveStudents tab
    ├── src/
    │   ├── app/                      # App Router entry
    │   │   ├── (protected)/          # Route group guarded by auth()
    │   │   │   └── dashboard/
    │   │   │       └── page.tsx      # Dashboard shell host (server component)
    │   │   ├── api/                  # Route handlers (all runtime = "nodejs")
    │   │   │   ├── actions/
    │   │   │   │   ├── bulk/route.ts       # POST /api/actions/bulk
    │   │   │   │   ├── history/route.ts    # GET /api/actions/history?studentKey=
    │   │   │   │   └── route.ts            # POST /api/actions
    │   │   │   ├── auth/
    │   │   │   │   └── [...nextauth]/route.ts  # NextAuth catch-all
    │   │   │   ├── dashboard/route.ts  # GET /api/dashboard
    │   │   │   ├── health/route.ts     # GET /api/health
    │   │   │   └── inactive/route.ts   # POST and DELETE /api/inactive
    │   │   ├── globals.css           # Global styles
    │   │   ├── layout.tsx            # Root layout
    │   │   ├── page.tsx              # Root redirect to /dashboard or /signin
    │   │   └── signin/
    │   │       └── page.tsx          # Google Sign-In page (server action form)
    │   ├── auth.ts                   # NextAuth v5 config (handlers, auth, signIn, signOut)
    │   ├── components/
    │   │   └── dashboard/            # Decomposed React shell
    │   │       ├── bulk-action-bar.tsx
    │   │       ├── calendar-panel.tsx
    │   │       ├── dashboard-shell.tsx       # Orchestrator (1013 lines, "use client")
    │   │       ├── filter-toolbar.tsx
    │   │       ├── line-preview-modal.tsx    # Exports LinePreviewDrawer
    │   │       ├── queue-panel.tsx           # Exports QueuePanel + QueuePanelHandle
    │   │       ├── student-detail.tsx
    │   │       ├── summary-bar.tsx
    │   │       └── toast-notification.tsx
    │   ├── hooks/
    │   │   ├── use-keyboard-shortcuts.ts
    │   │   ├── use-resizable-split.ts
    │   │   └── use-theme.ts
    │   ├── lib/
    │   │   ├── auth/
    │   │   │   └── session.ts        # requireSessionUser() guard
    │   │   ├── cache/
    │   │   │   └── memory-cache.ts   # Process-local TTL cache
    │   │   ├── dashboard/            # Business-rule port of .gs files
    │   │   │   ├── actions.ts        # Action-state sanitization
    │   │   │   ├── analytics.ts      # Port of DashboardAnalytics.gs
    │   │   │   ├── build.ts          # Payload orchestrator (mirrors buildAndPersistDashboardPayload)
    │   │   │   ├── config.ts         # Constants mirror of Code.gs
    │   │   │   ├── domain.ts         # Internal type definitions
    │   │   │   ├── health-state.ts   # /api/health counters
    │   │   │   ├── helpers.ts        # Port of SharedHelpers.gs
    │   │   │   ├── packages.ts       # Port of DashboardPackages.gs
    │   │   │   ├── projection.ts     # Port of DashboardProjection.gs
    │   │   │   ├── service.ts        # unstable_cache wrapper + revalidateTag
    │   │   │   ├── snapshot-store.ts # In-process snapshot/history (parity gap)
    │   │   │   └── ui-helpers.ts     # Frontend-only helpers and shared UI types
    │   │   ├── runtime/
    │   │   │   └── env.ts            # getAuthEnv(), getSheetsEnv(), getAllowedEmails()
    │   │   └── sheets/
    │   │       ├── actions.ts        # DashboardActionsState + DashboardActionLog read/write
    │   │       ├── client.ts         # Singleton googleapis JWT client
    │   │       ├── inactive-students.ts  # InactiveStudents tab CRUD
    │   │       └── source-loader.ts  # batchGet for all source sheets (15 s memory cache)
    │   ├── test/
    │   │   ├── actions-route.test.ts     # Route handler contract test
    │   │   └── dashboard-logic.test.ts   # Fixture port of Apps Script validation suite
    │   └── types/
    │       ├── dashboard.ts          # Public payload types (DashboardPayload, etc.)
    │       └── next-auth.d.ts        # NextAuth session augmentation
    ├── tsconfig.json                 # strict: true, paths: { "@/*": ["./src/*"] }
    ├── tsconfig.tsbuildinfo          # Incremental build cache
    └── vitest.config.ts              # environment: node, include: src/**/*.test.ts
```

## Directory Purposes

### Repo root (Google Apps Script layer)

**Root `.gs` files:**
- Purpose: Backend business logic served by the deployed Apps Script web app. Split by ownership slice per `docs/WORKFLOW.md`.
- Contains: One file per concern; never a monolithic `Code.gs`.
- Key files: `Code.gs` (bootstrap), `DashboardActions.gs` (action state), `DashboardAnalytics.gs` (view model), `DashboardDataLoading.gs` (sheet reads), `DashboardPackages.gs` (business rules), `DashboardProjection.gs` (projection), `DashboardState.gs` (cache + snapshots), `SharedHelpers.gs` (generic helpers), `Validation.gs` (fixture tests + live audit).

**`dashboard.html`:**
- Purpose: The full Apps Script web-app frontend, served by `doGet()`. Inline CSS + JS in one file.
- Contains: Styles (`--bg`, `--orange`, `--navy` CSS vars), chunked-payload reconstruction client, admin-tab filters, queue rendering, triage-first calendar, student detail drawer, LINE message preview.

**`appsscript.json`:**
- Purpose: Apps Script manifest (`timeZone: "Asia/Bangkok"`, `oauthScopes: ["https://www.googleapis.com/auth/spreadsheets"]`, `webapp.access: "ANYONE_ANONYMOUS"`, `runtimeVersion: "V8"`).

**`.clasp.json`:**
- Purpose: Tracked clasp binding. `scriptId: 1kAv9ICE5DQqE17JWynXJoV2Lu2bgs7pjzAfDzLNZ-1aMjhq_yKky1MQ6`. Keeps `.js` + `.gs` + `.html` + `.json` extensions.

**`docs/`:**
- Purpose: Repo-local engineering documentation.
- Contains: `WORKFLOW.md`, `app-overview.md`, `nextjs-shadow-handoff.md`.

**`.planning/codebase/`:**
- Purpose: Output target for GSD mapper agents (this file and `ARCHITECTURE.md`).

**`.github/`:**
- Purpose: GitHub config and templates.
- Contains: `CODEOWNERS`, `ISSUE_TEMPLATE/agent-task.yml`, `pull_request_template.md`.

### `web/` (Next.js shadow layer)

**`web/src/app/`:**
- Purpose: Next.js 16 App Router file-based routing.
- Contains: Server components, client components, route handlers, layouts, global CSS.
- Key files: `app/layout.tsx`, `app/page.tsx`, `app/signin/page.tsx`, `app/(protected)/dashboard/page.tsx`, `app/api/**/route.ts`, `app/globals.css`.

**`web/src/app/(protected)/`:**
- Purpose: Route group containing auth-guarded pages. The parenthesized segment does not add to the URL path.
- Contains: `dashboard/page.tsx` (checks session and redirects to `/signin` on failure).

**`web/src/app/api/`:**
- Purpose: JSON route handlers for the shadow app. All use `export const runtime = "nodejs"` (googleapis requires Node runtime).
- Contains: One folder per endpoint path, each exporting `GET`/`POST`/`DELETE` handler functions from `route.ts`.

**`web/src/components/dashboard/`:**
- Purpose: Decomposed React shell for the dashboard. All client components.
- Contains: Orchestrator `dashboard-shell.tsx` plus focused sub-components.
- Key file: `dashboard-shell.tsx` imports the sub-components and hooks and wires up state.

**`web/src/hooks/`:**
- Purpose: Reusable React hooks used by the dashboard shell.
- Contains: `use-keyboard-shortcuts.ts`, `use-resizable-split.ts`, `use-theme.ts`.

**`web/src/lib/`:**
- Purpose: Non-component logic; split by domain.
- Sub-directories:
  - `lib/auth/` — session helpers beyond `auth.ts`.
  - `lib/cache/` — process-local memory cache.
  - `lib/dashboard/` — business-rule port of the Apps Script slices (one file per `.gs` equivalent) plus cache service and UI helpers.
  - `lib/runtime/` — env var readers.
  - `lib/sheets/` — Google Sheets API client and tab-specific adapters.

**`web/src/test/`:**
- Purpose: Vitest unit tests. Centralized (not colocated) — `vitest.config.ts` scans `src/**/*.test.ts`.

**`web/src/types/`:**
- Purpose: Shared TypeScript types consumed by both frontend and API layers.
- Contains: `dashboard.ts` (payload contract), `next-auth.d.ts` (session type augmentation).

**`web/scripts/`:**
- Purpose: Ops scripts invoked through `package.json` scripts via `tsx`.
- Contains: `compare-live.ts`, `ensure-action-sheets.ts`, `ensure-inactive-sheet.ts`.

**`web/.vercel/`:**
- Purpose: Vercel CLI link state (project ID, org ID).
- Generated: Yes.
- Committed: No (in `web/.gitignore`).

**`web/.next/`:**
- Purpose: Next.js build cache.
- Generated: Yes.
- Committed: No.

## Key File Locations

**Entry points:**
- `Code.gs` — Apps Script `doGet()` and data-transfer orchestrators.
- `web/src/app/page.tsx` — Next.js root redirect.
- `web/src/app/(protected)/dashboard/page.tsx` — Next.js dashboard page.
- `web/src/app/api/dashboard/route.ts` — Next.js dashboard API.

**Configuration:**
- `appsscript.json` — Apps Script manifest.
- `.clasp.json` — clasp binding.
- `web/package.json` — dependencies and npm scripts.
- `web/next.config.ts` — Next config.
- `web/tsconfig.json` — strict TypeScript with `@/*` path alias rooted at `web/src/`.
- `web/vitest.config.ts` — Vitest config (`@/` alias mirrors tsconfig).
- `web/.env` / `web/.env.example` — env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST`, `STAFF_ALLOWLIST`, `SHEETS_SERVICE_ACCOUNT_EMAIL`, `SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`, `SHEETS_SPREADSHEET_ID_CREDITS`, `SHEETS_SPREADSHEET_ID_ANALYTICS`).

**Core logic:**
- Apps Script business rules: `DashboardPackages.gs`, `DashboardProjection.gs`.
- Apps Script analytics: `DashboardAnalytics.gs`.
- Apps Script action state: `DashboardActions.gs`.
- Next.js business rules: `web/src/lib/dashboard/packages.ts`, `web/src/lib/dashboard/projection.ts`.
- Next.js analytics: `web/src/lib/dashboard/analytics.ts`.
- Next.js payload orchestrator: `web/src/lib/dashboard/build.ts`.
- Next.js payload cache + invalidation: `web/src/lib/dashboard/service.ts`.
- Sheets access: `web/src/lib/sheets/client.ts`, `web/src/lib/sheets/source-loader.ts`, `web/src/lib/sheets/actions.ts`, `web/src/lib/sheets/inactive-students.ts`.

**Shared constants and types:**
- Apps Script constants: top of `Code.gs`.
- Next.js constants: `web/src/lib/dashboard/config.ts`.
- Payload types: `web/src/types/dashboard.ts`.
- Internal types: `web/src/lib/dashboard/domain.ts`.

**Testing:**
- Apps Script fixture suite: `Validation.gs::runValidationSuite()` (run with `clasp run runValidationSuite`).
- Apps Script live audit: `Validation.gs::runLiveAccuracyAudit()` (run with `clasp run runLiveAccuracyAudit`; writes to the `Dashboard Accuracy Audit` sheet tab).
- Apps Script inspector: `Validation.gs::inspectStudentPackageBalance(studentName, packageName)`.
- Next.js unit tests: `web/src/test/dashboard-logic.test.ts`, `web/src/test/actions-route.test.ts`.
- Parity script: `web/scripts/compare-live.ts` (currently blocked on Apps Script authorization).

## Naming Conventions

### Apps Script

**Files:**
- Backend slices: `Dashboard<Slice>.gs` in PascalCase (`DashboardActions.gs`, `DashboardAnalytics.gs`, `DashboardDataLoading.gs`, `DashboardPackages.gs`, `DashboardProjection.gs`, `DashboardState.gs`).
- Bootstrap: `Code.gs` (Apps Script default name; kept small and bootstrap-only).
- Cross-cutting helpers: `SharedHelpers.gs`.
- Validation / diagnostics: `Validation.gs`.
- Frontend: `dashboard.html` (lowercase; matches `HtmlService.createHtmlOutputFromFile("dashboard")`).

**Functions:**
- camelCase (`loadDashboardSources`, `buildStudentQueueRow`, `writeStudentActionState`).
- Builder functions start with `build` (`buildDashboardPayload`, `buildStudentAdminOwnershipMap`, `buildPendingDeductionContext`).
- Getters start with `get` (`getSheetSnapshot`, `getStudentAdminOwnership`, `getPackageExclusionReason`).
- Validation tests in `Validation.gs` start with `test` (`testTrialPackagesAreExcluded`, `testWatchWindowBoundaryAtThirtyDays`).
- Audit helpers in `Validation.gs` start with `buildAudit*` (`buildAuditActiveStudentSet`, `buildAuditExpectedModel`) to keep them distinct from production builders.

**Constants:**
- SCREAMING_SNAKE_CASE (`SPREADSHEET_ID_CREDITS`, `ALERT_THRESHOLD`, `NOTIFY_WINDOW_DAYS`, `ADMIN_OWNER_REGISTRY`, `UNASSIGNED_ADMIN_KEY`, `DASHBOARD_CACHE_KEY`, `STUDENT_ACTION_PROPERTY_PREFIX`).

**Storage keys:**
- Script-property keys: `BG_<DOMAIN>_<NAME>_V<N>` (`BG_DASHBOARD_SNAPSHOT_V2`, `BG_DASHBOARD_HISTORY_V2`, `BG_ACTION_V1::<studentKey>`).
- Cache keys: `BG_DASHBOARD_PAYLOAD_V2`, meta suffix `::meta`, part suffix `::part::<index>`.

### Next.js

**Files:**
- Route files: `route.ts` (Next.js App Router convention — required name).
- Page files: `page.tsx` (App Router convention).
- Layout files: `layout.tsx`.
- Component files: kebab-case (`dashboard-shell.tsx`, `queue-panel.tsx`, `line-preview-modal.tsx`, `toast-notification.tsx`).
- Hook files: kebab-case with `use-` prefix (`use-keyboard-shortcuts.ts`, `use-resizable-split.ts`, `use-theme.ts`).
- Library files: kebab-case or single-word (`source-loader.ts`, `memory-cache.ts`, `snapshot-store.ts`, `ui-helpers.ts`, `actions.ts`, `analytics.ts`, `build.ts`).
- Test files: `*.test.ts` (Vitest convention).
- Type files: single-word (`dashboard.ts`, `next-auth.d.ts`).

**Directories:**
- App Router route groups: parentheses (`(protected)`).
- Dynamic segments: square brackets (`[...nextauth]`).
- All other directories: kebab-case or single-word (`components`, `hooks`, `lib`, `types`, `test`, `auth`, `cache`, `dashboard`, `runtime`, `sheets`).

**Functions and components:**
- React components: PascalCase exported as named exports (`DashboardShell`, `QueuePanel`, `CalendarPanel`, `LinePreviewDrawer`).
- Hooks: camelCase with `use` prefix (`useKeyboardShortcuts`, `useResizableSplit`, `useTheme`).
- Library functions: camelCase (`buildDashboardPayloadUncached`, `getSheetsClient`, `loadDashboardSources`, `requireSessionUser`).

**Constants:**
- SCREAMING_SNAKE_CASE in `web/src/lib/dashboard/config.ts` (`ALERT_THRESHOLD`, `DASHBOARD_CACHE_TAG`, `SHEETS_IN_MEMORY_TTL_MS`, `DASHBOARD_ACTION_STATE_SHEET`).

**Types:**
- PascalCase in `web/src/types/` and `web/src/lib/dashboard/domain.ts` (`DashboardPayload`, `StudentRecord`, `PackageRecord`, `StudentQueueRow`, `ActionState`, `SheetSnapshot`).

**Sheet tab names** (consumed as string constants):
- Existing source tabs use the exact names from the production sheets: `Aggregations`, `Credit_Control`, `Upcoming Sessions`, `Students`, `Students & Courses`, `RemainingCredits`.
- New shadow-app tabs use PascalCase: `DashboardActionsState`, `DashboardActionLog`, `InactiveStudents`.
- Audit tab: `Dashboard Accuracy Audit` (Apps Script).

## Where to Add New Code

### Apps Script changes

**New backend business rule:**
- If it touches package assembly, balance, or exclusions: add to `DashboardPackages.gs`.
- If it touches projection/status: add to `DashboardProjection.gs`.
- If it touches queue/calendar/summary shaping: add to `DashboardAnalytics.gs`.
- If it touches cache or snapshot storage: add to `DashboardState.gs`.
- Generic helpers used by multiple slices: add to `SharedHelpers.gs`.

**New action-state behavior:**
- All student follow-up state writes belong in `DashboardActions.gs` (explicit stateful slice per `CLAUDE.md` / `AGENTS.md`).
- Invalidate the dashboard cache via `clearDashboardCache(...)` on every write.
- Add a matching `testStudentAction*` case in `Validation.gs::runValidationSuite()`.

**New constant:**
- Add to the top of `Code.gs` next to the existing block of `const` declarations.

**New entry point callable from the browser:**
- Add the top-level function to `Code.gs` (must be top-level to be callable by `google.script.run`).

**New sheet read:**
- Extend `REQUIRED_COLUMNS` in `Code.gs`, add the sheet snapshot in `DashboardDataLoading.gs::loadDashboardSources()`, and mirror the change in `web/src/lib/dashboard/config.ts::REQUIRED_COLUMNS` plus `web/src/lib/sheets/source-loader.ts`.

**New validation case:**
- Append a test function to the `tests` array at the top of `Validation.gs::runValidationSuite()`.

**New frontend feature:**
- Edit `dashboard.html` directly (single file; inline CSS/JS). Confirm `clasp deploy` produces a new version — source push alone is not enough.

### Next.js shadow changes

**New API endpoint:**
- Create `web/src/app/api/<path>/route.ts` exporting `GET`/`POST`/`DELETE` handler functions.
- Set `export const runtime = "nodejs"` (required for googleapis).
- Guard with `await requireSessionUser()` inside a `try/catch` that maps `"Unauthorized"` to a 401 response.

**New page route:**
- Place protected pages under `web/src/app/(protected)/<segment>/page.tsx` so the route-group convention signals auth-guarded code.
- Public pages under `web/src/app/<segment>/page.tsx`.

**New React component:**
- If dashboard-related: `web/src/components/dashboard/<kebab-case>.tsx`.
- Other surfaces: create `web/src/components/<area>/` and place there. There is currently only one area (`dashboard`).
- Mark client components with `"use client"` at the top. Server components do not need a directive.
- Export as named export (`export function Foo`).

**New custom hook:**
- `web/src/hooks/use-<kebab-case>.ts`.
- Export as named export (`export function useFoo`).

**New business-rule logic:**
- Mirror the Apps Script split: add to the corresponding file under `web/src/lib/dashboard/`.
  - Package rules: `packages.ts`.
  - Projection: `projection.ts`.
  - View-model shaping: `analytics.ts`.
  - Action-state sanitization: `actions.ts`.
  - Generic helpers: `helpers.ts`.
  - Frontend-only helpers: `ui-helpers.ts`.

**New Sheets adapter:**
- `web/src/lib/sheets/<tab-name>.ts`.
- Reuse `getSheetsClient()` from `web/src/lib/sheets/client.ts` and `getSheetsEnv()` from `web/src/lib/runtime/env.ts`.
- Wrap reads in `getOrSetMemoryCache("sheets:<key>", SHEETS_IN_MEMORY_TTL_MS, loader)` from `web/src/lib/cache/memory-cache.ts`.
- Bust the cache on writes with `clearMemoryCache("sheets:<key>")`.
- If the new sheet needs bootstrap, add an `ensure<Tab>Exists()` function and a matching script under `web/scripts/`.

**New payload field:**
- Add to the interface in `web/src/types/dashboard.ts`.
- Build it into the payload in `web/src/lib/dashboard/analytics.ts::buildDashboardModel()` (or wherever the concept lives).
- Invalidate the cache via `invalidateDashboardPayloadCache()` on any write path that affects the new field.
- Mirror the change on the Apps Script side in `DashboardAnalytics.gs` to keep parity.

**New env var:**
- Add to `web/src/lib/runtime/env.ts` inside `getAuthEnv()` or `getSheetsEnv()` (pick the right group).
- Add to `web/.env` (local) and `web/.env.example`.
- Add to Vercel env vars via `vercel env add`.
- Document in `docs/nextjs-shadow-handoff.md` under "Environment Variables".

**New test:**
- Unit test: `web/src/test/<name>.test.ts` (centralized; vitest config scans `src/**/*.test.ts`).
- Import modules through the `@/` alias (`import { buildDashboardModel } from "@/lib/dashboard/analytics"`).

**New npm script:**
- Add to `web/package.json::scripts`, prefer `tsx` for TypeScript entry points that need to run outside Next.
- If the script touches Sheets, require the sheets env vars via `getSheetsEnv()`.

**New frontend behavior:**
- Orchestrator state: `web/src/components/dashboard/dashboard-shell.tsx`. Do not push state into individual panels that belongs at the shell level; pass via props.
- Panel UI: the matching sub-component (`queue-panel.tsx`, `calendar-panel.tsx`, `student-detail.tsx`, etc.).
- Shared utilities across panels: `web/src/lib/dashboard/ui-helpers.ts`.
- Global CSS: `web/src/app/globals.css`.

## Special Directories

**`web/.next/`:**
- Purpose: Next.js build artifacts, dev server cache, and type hints.
- Generated: Yes (by `next dev` / `next build`).
- Committed: No (`web/.gitignore`).

**`web/.vercel/`:**
- Purpose: Vercel CLI project link metadata (`kevins-projects-6ebb4efc/web`).
- Generated: Yes (by `vercel` CLI).
- Committed: No.

**`web/node_modules/`:**
- Purpose: Installed npm dependencies.
- Generated: Yes (`npm install`).
- Committed: No (both root `.gitignore` and `web/.gitignore` exclude it).

**`.planning/codebase/`:**
- Purpose: GSD mapper agent output target — where `ARCHITECTURE.md`, `STRUCTURE.md`, and sibling docs land.
- Generated: Yes (by GSD mapper agents).
- Committed: Project-specific — check `.gitignore`. Currently not excluded so commits would include it.

**Apps Script tracked configuration:**
- `.clasp.json` — tracked so every collaborator targets the same script project.
- `appsscript.json` — tracked so the manifest (timezone, scopes, webapp access) is uniform.
- `.clasprc.local.json` — local-only; `.gitignore` excludes it.

---

*Structure analysis: 2026-04-20*
