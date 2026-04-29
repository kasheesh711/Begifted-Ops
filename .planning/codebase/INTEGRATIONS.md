# External Integrations

**Analysis Date:** 2026-04-20

This codebase integrates with Google services in **two parallel ways**: the Apps Script runtime uses built-in Google services (`SpreadsheetApp`, `HtmlService`, etc.), and the Next.js shadow uses the `googleapis` client with a service account. Both read/write the same two spreadsheets.

## APIs & External Services

**Google Sheets API v4 (Next.js shadow):**
- Used for: reading dashboard source data, writing action state/log, reading/writing inactive-student records, creating sheets for sidecar state
- SDK: `googleapis` 171.4.0 via `web/src/lib/sheets/client.ts`
- Auth: Service-account JWT (`google.auth.JWT`) with scope `https://www.googleapis.com/auth/spreadsheets` — see `web/src/lib/sheets/client.ts:11-16`
- Client is memoized (one instance per Node process) at `web/src/lib/sheets/client.ts:4` (`cachedClient`)
- Methods in use:
  - `sheets.spreadsheets.values.batchGet` — bulk source read (`web/src/lib/sheets/source-loader.ts:28-42`)
  - `sheets.spreadsheets.values.get` — single-range reads for action state and inactive students (`web/src/lib/sheets/actions.ts:162`, `web/src/lib/sheets/inactive-students.ts:30`, `web/src/app/api/actions/history/route.ts:23`)
  - `sheets.spreadsheets.values.update` — in-place row writes (`web/src/lib/sheets/actions.ts:106`, `web/src/lib/sheets/inactive-students.ts:176`)
  - `sheets.spreadsheets.values.append` — appending new rows (`web/src/lib/sheets/actions.ts:113, 121`, `web/src/lib/sheets/inactive-students.ts:78`)
  - `sheets.spreadsheets.get` — read sheet metadata (`web/src/lib/sheets/actions.ts:192`, `web/src/lib/sheets/inactive-students.ts:126, 159`)
  - `sheets.spreadsheets.batchUpdate` — `addSheet` and `deleteDimension` operations (`web/src/lib/sheets/actions.ts:208`, `web/src/lib/sheets/inactive-students.ts:148, 167`)

**Google Sheets (Apps Script runtime):**
- Uses Apps Script built-in `SpreadsheetApp` (no REST client needed)
- Entry: `SpreadsheetApp.openById(SPREADSHEET_ID_CREDITS)` and `SpreadsheetApp.openById(SPREADSHEET_ID_ANALYTICS)` in `DashboardDataLoading.gs:6-7`
- Spreadsheet IDs hard-coded in `Code.gs:6-7`:
  - `SPREADSHEET_ID_CREDITS = "100bidSt63ynf_y7Iq-nRQUj3MMQoNpnltOQdSiwHN-0"` (source of the `Aggregations` tab)
  - `SPREADSHEET_ID_ANALYTICS = "15XTOU1kYDib4stuiFzbTOT1MAeRlCw20maOXk5irfsc"` (`Credit_Control`, `Upcoming Sessions`, `Students`, `Students & Courses`, `RemainingCredits`, `DashboardActionsState`, `DashboardActionLog`, `InactiveStudents`, `Dashboard Accuracy Audit`)
- OAuth scope: `https://www.googleapis.com/auth/spreadsheets` (declared in `appsscript.json:6`)
- Web-app executes as the deploying Google account (`executeAs: USER_DEPLOYING` in `appsscript.json:11`) — so the deployer must have read/write access to both spreadsheets

**Sheet tabs accessed by both layers:**
- Read: `Aggregations`, `Credit_Control`, `Upcoming Sessions`, `Students`, `Students & Courses`, `RemainingCredits` (sheet names in `web/src/lib/dashboard/config.ts:15-20` and `Code.gs:9-14`)
- Read/write (Next.js only today): `DashboardActionsState`, `DashboardActionLog`, `InactiveStudents` (defined in `web/src/lib/dashboard/config.ts:31-62`)

**Google Fonts (dashboard.html only):**
- External CSS link: `https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:...&family=DM+Mono:...` — `dashboard.html:7`
- Next.js `web/src/app/layout.tsx` does not currently use `next/font`

## Data Storage

**Source-of-truth:**
- Google Sheets only. No relational database, no ORM, no Prisma/Drizzle.

**Sidecar state (persisted by Next.js into the Analytics spreadsheet):**
- `DashboardActionsState` tab — current action status per student (headers in `web/src/lib/dashboard/config.ts:33-41`)
- `DashboardActionLog` tab — append-only event log (headers in `web/src/lib/dashboard/config.ts:42-52`)
- `InactiveStudents` tab — soft-delete markers (headers in `web/src/lib/dashboard/config.ts:55-62`)
- Provisioning scripts:
  - `web/scripts/ensure-action-sheets.ts` → calls `ensureActionSheetsExist()` (`web/src/lib/sheets/actions.ts:189`)
  - `web/scripts/ensure-inactive-sheet.ts` → calls `ensureInactiveStudentsSheetExists()` (`web/src/lib/sheets/inactive-students.ts:156`)

**Apps Script-only persistence:**
- `PropertiesService.getScriptProperties()` — stores:
  - `BG_DASHBOARD_SNAPSHOT_V2` (previous payload snapshot for deltas, `Code.gs:33`, `DashboardState.gs:10-23`)
  - `BG_DASHBOARD_HISTORY_V2` (historical summary series)
  - `BG_ACTION_V1::<studentKey>` (per-student action history, `DashboardActions.gs:230-244`)
- `CacheService.getScriptCache()` — chunked dashboard payload cache (`DashboardState.gs:26-29`, chunk size 90,000 chars, TTL 120s, manifest-plus-parts pattern)

**Next.js cache layer (ephemeral, per Node process):**
- `unstable_cache` from `next/cache` wraps `buildDashboardPayloadUncached` with tag `dashboard-payload` and 60s revalidate — `web/src/lib/dashboard/service.ts:10-13`
- Tag-based invalidation via `revalidateTag(DASHBOARD_CACHE_TAG, "max")` on writes — `web/src/lib/dashboard/service.ts:20`
- In-memory `Map` cache in `web/src/lib/cache/memory-cache.ts` (15,000 ms TTL, keys prefixed `sheets:dashboard-sources`, `sheets:action-state`, `sheets:inactive-students`) — per-process, not shared across Vercel lambdas
- No Redis, KV, or external cache store configured

**File Storage:**
- None. Neither layer reads/writes blobs or attachments.

## Authentication & Identity

**Next.js shadow (NextAuth v5 / Auth.js):**
- Provider: Google OAuth — `web/src/auth.ts:9-12`
- Config surface:
  - `secret: process.env.AUTH_SECRET || "local-dev-secret"` (dev-only fallback)
  - `clientId: process.env.GOOGLE_CLIENT_ID || "missing-google-client-id"`
  - `clientSecret: process.env.GOOGLE_CLIENT_SECRET || "missing-google-client-secret"`
- Custom sign-in page: `/signin` (route `web/src/app/signin/page.tsx`)
- `signIn` callback — restricts access to emails in `STAFF_ALLOWLIST` via `getAllowedEmails()` (`web/src/auth.ts:17-21`, `web/src/lib/runtime/env.ts:41-45`)
- `session` callback — lowercases `session.user.email` (`web/src/auth.ts:22-27`)
- Session extraction helper: `requireSessionUser()` in `web/src/lib/auth/session.ts` (throws `Unauthorized` when email or name missing, used by all mutating API routes)
- Auth handler: `web/src/app/api/auth/[...nextauth]/route.ts` exports `handlers.GET` and `handlers.POST`
- Custom types: `web/src/types/next-auth.d.ts` extends `Session.user`

**Apps Script web app:**
- `appsscript.json` declares `"access": "ANYONE_ANONYMOUS"` (public URL) but `"executeAs": "USER_DEPLOYING"` — data access is gated by whether the deploying Google account has Sheets access, not by end-user identity
- No NextAuth-equivalent; the front-end `dashboard.html` does not enforce an allowlist — authorization is effectively implicit via the Sheets scope granted to the deploying account
- OAuth consent prompt is granted once by the deploying user for scope `https://www.googleapis.com/auth/spreadsheets`

**Authorization policy (Next.js):**
- `STAFF_ALLOWLIST` env var — comma-separated emails, parsed in `web/src/lib/runtime/env.ts:41-45`
- Enforced in NextAuth `signIn` callback (auth happens at sign-in, not per request)
- API route gating: calls `requireSessionUser()` or `await auth()` at top of each handler (e.g. `web/src/app/api/dashboard/route.ts:8-11`, `web/src/app/api/actions/route.ts:11`)

## Monitoring & Observability

**Apps Script:**
- Stackdriver Error Reporting enabled: `appsscript.json:4` (`"exceptionLogging": "STACKDRIVER"`)
- `Logger.log(...)` calls throughout `.gs` files (visible via Apps Script Executions view)

**Next.js:**
- No Sentry, Datadog, or similar SDK installed in `web/package.json`
- `/api/health` route (`web/src/app/api/health/route.ts`) exposes:
  - `authenticated`, `user`
  - `sheetsOk`, `sheetsError` (probe of `loadDashboardSources()`)
  - `cache.lastPayloadBuiltAt`, `cache.lastPayloadBuildDurationMs`, `cache.lastCacheInvalidatedAt`
- Health state is tracked in-memory in `web/src/lib/dashboard/health-state.ts` (updated by `recordPayloadBuild`, `recordSheetsCheck`, `recordCacheInvalidation`)
- Errors surface as `NextResponse.json({ error }, { status })` from route handlers; no structured logger

**Logs (default):**
- Apps Script: `Logger.log` → Stackdriver
- Vercel: default `console.*` captured by Vercel runtime logs; no custom logger wrapper exists

## CI/CD & Deployment

**Hosting:**
- Apps Script web app — Google-hosted at an Apps Script deployment URL (script/deployment IDs managed through clasp)
- Next.js — Vercel project `prj_79Y3JFkRszm28pAltR3cbolYujZp` in org `team_eDfLdeP7EKIifzi1xLIHv8ca`, project name `web` (`web/.vercel/project.json`)

**CI Pipeline:**
- No `.github/workflows/` directory present — no GitHub Actions configured
- Effective CI/CD:
  - Vercel preview deployments per PR (inferred from `web/.vercel/` linkage and PR template's "Web app deployment updated" checkbox)
  - Manual `clasp push` for Apps Script (called out in `CLAUDE.md` "Apps Script push needed" checkbox and `pull_request_template.md` deployment-impact section)
  - Manual `clasp run runValidationSuite` for Apps Script regression fixtures
  - Manual `npm run compare-live` (from `web/`) for Apps Script vs Next.js parity — `web/scripts/compare-live.ts:62-63` shells out to `clasp run fetchDashboardData` and diffs against `buildDashboardPayloadUncached()` or a live `/api/dashboard` response (`NEXT_BASE_URL` env var controls which)

## Environment Configuration

**Required env vars (Next.js, declared in `web/.env.example`):**

Authentication group (validated by `getAuthEnv()` in `web/src/lib/runtime/env.ts:23-30`):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_SECRET`
- `STAFF_ALLOWLIST` — comma-separated list of email addresses allowed to sign in

Sheets group (validated by `getSheetsEnv()` in `web/src/lib/runtime/env.ts:32-39`):
- `SHEETS_SERVICE_ACCOUNT_EMAIL`
- `SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY` — newlines encoded as `\n` (unescaped at use time in `web/src/lib/sheets/client.ts:14`)
- `SHEETS_SPREADSHEET_ID_CREDITS`
- `SHEETS_SPREADSHEET_ID_ANALYTICS`

Optional (script-only):
- `NEXT_BASE_URL` — used by `web/scripts/compare-live.ts:45` to choose live HTTP fetch vs in-process payload build

All required vars throw at first read via `required(name)` in `web/src/lib/runtime/env.ts:1-7`.

**Secrets location:**
- Local dev: `web/.env` (gitignored per `web/.gitignore`)
- Production: Vercel environment variables for project `web`
- Credentials for the Apps Script layer (clasp auth) live outside this repo per CLAUDE.md (parent `Credit Control/` directory; `.clasprc.local.json` and `.clasp.json` are gitignored in repo root)

**No secrets are committed.** Both `.gitignore` files (root and `web/`) exclude `.env*` and local clasp credentials.

## Webhooks & Callbacks

**Incoming:**
- `web/src/app/api/auth/[...nextauth]/route.ts` — Google OAuth callback (standard NextAuth catch-all)
- No other inbound webhooks

**Outgoing:**
- None scheduled/cron-triggered. Neither Apps Script triggers (no `onEdit`/`onOpen`/time-driven triggers declared in `appsscript.json`) nor Vercel cron jobs (no `vercel.json`) are configured.

## API Routes (Next.js inventory)

All API routes declare `export const runtime = "nodejs"` at the top:

| Method + Path | File | Purpose |
|---|---|---|
| `GET /api/auth/[...nextauth]` | `web/src/app/api/auth/[...nextauth]/route.ts` | NextAuth callback |
| `POST /api/auth/[...nextauth]` | `web/src/app/api/auth/[...nextauth]/route.ts` | NextAuth sign-in/out |
| `GET /api/dashboard` | `web/src/app/api/dashboard/route.ts` | Return cached `DashboardPayload` |
| `POST /api/actions` | `web/src/app/api/actions/route.ts` | Set/clear single student action |
| `POST /api/actions/bulk` | `web/src/app/api/actions/bulk/route.ts` | Bulk set/clear across student keys |
| `GET /api/actions/history` | `web/src/app/api/actions/history/route.ts` | Read recent log entries for a student (last 7 days, top 20) |
| `POST /api/inactive` | `web/src/app/api/inactive/route.ts` | Mark student inactive |
| `DELETE /api/inactive` | `web/src/app/api/inactive/route.ts` | Clear inactive status |
| `GET /api/health` | `web/src/app/api/health/route.ts` | Liveness + sheets-probe + cache telemetry |

## Apps Script server functions (called via `google.script.run` from `dashboard.html`)

Invoked through the `requestServer(fnName, ...args)` helper in `dashboard.html:1904-1914`:
- `beginDashboardDataTransfer` — negotiates inline vs chunked mode (`Code.gs:115-145`)
- `fetchDashboardDataChunkBatch` / `fetchDashboardDataChunk` — streams cached payload (`Code.gs:151-236`, referenced from `dashboard.html:1958`)
- Student-action endpoints (`setStudentAction`, `bulkSetStudentAction`, `clearStudentAction` in `DashboardActions.gs`)

---

*Integration audit: 2026-04-20*
