# Technology Stack

**Analysis Date:** 2026-04-20

This is a **hybrid codebase** with two concurrent runtimes:
1. **Google Apps Script** (legacy/primary) — `.gs` files at repo root, HTML dashboard served via `HtmlService`
2. **Next.js shadow app** — `web/` directory, being migrated for parity with Apps Script

## Languages

**Primary:**
- Google Apps Script (V8 runtime, ES2015+ JavaScript dialect) — backend in `Code.gs`, `DashboardActions.gs`, `DashboardAnalytics.gs`, `DashboardDataLoading.gs`, `DashboardPackages.gs`, `DashboardProjection.gs`, `DashboardState.gs`, `SharedHelpers.gs`, `Validation.gs`
- TypeScript 5.9.3 — entire `web/` shadow app (API routes, dashboard logic port, sheets client, React components)

**Secondary:**
- HTML + inline JS — single-file `dashboard.html` (3,673 lines) rendered by Apps Script `HtmlService`
- CSS — `web/src/app/globals.css` (1,788 lines) for the Next.js UI

## Runtime

**Apps Script Environment:**
- Runtime: V8 (declared in `appsscript.json` — `"runtimeVersion": "V8"`)
- Timezone: `Asia/Bangkok`
- Exception logging: `STACKDRIVER`
- Web app access: `ANYONE_ANONYMOUS`
- Web app executes as: `USER_DEPLOYING`
- Execution API access: `ANYONE`

**Next.js Environment:**
- Node.js — required by `@types/node` ^22.17.0 and `"runtime": "nodejs"` declarations on every API route (e.g. `web/src/app/api/actions/route.ts`, `web/src/app/api/dashboard/route.ts`, `web/src/app/api/health/route.ts`, `web/src/app/api/inactive/route.ts`)
- TypeScript compile target: `ES2022`, module `ESNext`, moduleResolution `Bundler`
- Production hosting: Vercel (linked project `prj_79Y3JFkRszm28pAltR3cbolYujZp` in `web/.vercel/project.json`)

**Package Manager:**
- npm — lockfile `web/package-lock.json` present (3,222 lines)
- No pnpm, yarn, or bun lockfiles detected

## Frameworks

**Apps Script Services (core):**
- `SpreadsheetApp` — primary data access (`DashboardDataLoading.gs`, `SharedHelpers.gs`)
- `HtmlService` — web-app entry point (`Code.gs` `doGet()`)
- `PropertiesService` — snapshot/history/action-state persistence (`DashboardState.gs`, `DashboardActions.gs`)
- `CacheService` — chunked dashboard payload cache (`DashboardState.gs`, `Code.gs`)
- `Utilities` — date formatting (`SharedHelpers.gs`)
- `Session` — script timezone (`SharedHelpers.gs`)
- `Logger` — Stackdriver logging

**Next.js Core:**
- `next` 16.2.1 — App Router, `src/app/` convention
- `react` 19.2.4 / `react-dom` 19.2.4
- Config: `web/next.config.ts` (only sets `reactStrictMode: true`)

**Auth:**
- `next-auth` 5.0.0-beta.30 (Auth.js v5) — Google OAuth provider, configured in `web/src/auth.ts`
- Handler route: `web/src/app/api/auth/[...nextauth]/route.ts`

**Google API Client:**
- `googleapis` 171.4.0 — JWT service-account auth, used in `web/src/lib/sheets/client.ts`, `web/src/lib/sheets/source-loader.ts`, `web/src/lib/sheets/actions.ts`, `web/src/lib/sheets/inactive-students.ts`

**Testing:**
- `vitest` ^3.2.4 — `web/src/**/*.test.ts` (node environment, config at `web/vitest.config.ts`)
- Apps Script side: custom validation suite in `Validation.gs` (2,411 lines, run via `clasp run runValidationSuite`)

**Build/Dev Tools:**
- `tsx` ^4.20.3 — runs standalone TypeScript scripts in `web/scripts/`
- `@clasp` — Google Apps Script CLI (project config `.clasp.json`; scriptId `1kAv9ICE5DQqE17JWynXJoV2Lu2bgs7pjzAfDzLNZ-1aMjhq_yKky1MQ6`, projectId `begifted-forms`)
- Next.js default bundler (Turbopack-capable in Next 16)

## Key Dependencies

**Production (`web/package.json` dependencies):**
- `googleapis` 171.4.0 — Google Sheets v4 API client with service-account JWT auth
- `next` 16.2.1 — Next.js App Router framework
- `next-auth` 5.0.0-beta.30 — Auth.js v5 (beta) with Google provider
- `react` 19.2.4
- `react-dom` 19.2.4

**Dev (`web/package.json` devDependencies):**
- `@types/node` ^22.17.0
- `@types/react` ^19.2.2
- `@types/react-dom` ^19.2.2
- `tsx` ^4.20.3 — one-shot TS script runner (used for `compare-live`, `ensure-action-sheets`, `ensure-inactive-sheet`)
- `typescript` ^5.9.3
- `vitest` ^3.2.4

**Apps Script Dependencies:**
- None — `appsscript.json` declares `"dependencies": {}` (no advanced services, no libraries). Everything is built on default global services.

**Infrastructure:**
- Next cache layer uses two in-memory strategies:
  - `unstable_cache` from `next/cache` with tag `dashboard-payload`, 60s revalidate (`web/src/lib/dashboard/service.ts`)
  - In-process `Map`-based cache for sheet source loads and action-state reads, 15,000 ms TTL (`web/src/lib/cache/memory-cache.ts`, referenced from `web/src/lib/sheets/source-loader.ts:24`, `web/src/lib/sheets/actions.ts:159`, `web/src/lib/sheets/inactive-students.ts:27`)
  - Apps Script uses `CacheService.getScriptCache()` with chunked manifest storage (90,000-char chunks, 120s TTL) in `DashboardState.gs` and `Code.gs`

## Configuration

**Apps Script Configuration:**
- `appsscript.json` — runtime, timezone, webapp settings, OAuth scope
- `.clasp.json` — scriptId and extensions for clasp push/pull
- `.clasprc.local.json` — local clasp credentials (listed in repo root `.gitignore`, never committed)

**Next.js Configuration:**
- `web/next.config.ts` — `reactStrictMode: true`, nothing else
- `web/tsconfig.json` — strict mode, `@/*` path alias pointing at `./src/*`, JSX `react-jsx`
- `web/vitest.config.ts` — node environment, `@` alias to `./src`, test glob `src/**/*.test.ts`
- `web/next-env.d.ts` — Next-generated ambient types (do not edit)

**Environment (structure only; secrets out of scope):**
- `web/.env.example` declares required variables (see INTEGRATIONS.md for details):
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, `STAFF_ALLOWLIST`
  - `SHEETS_SERVICE_ACCOUNT_EMAIL`, `SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`, `SHEETS_SPREADSHEET_ID_CREDITS`, `SHEETS_SPREADSHEET_ID_ANALYTICS`
- `web/.env` exists locally (gitignored via `web/.gitignore` → `.env`, `.env.*`, `.env.local`)
- Env values are read through `web/src/lib/runtime/env.ts` which throws on missing required vars

**Vercel Linking:**
- `web/.vercel/project.json` links the `web` folder to Vercel project `prj_79Y3JFkRszm28pAltR3cbolYujZp` (team `team_eDfLdeP7EKIifzi1xLIHv8ca`)
- `web/.vercel/` is gitignored (`web/.gitignore` first line)

## Scripts

**`web/package.json` scripts:**
- `dev` — `next dev` (local development server)
- `build` — `next build`
- `start` — `next start` (production server)
- `test` — `vitest run` (CI-style single run)
- `test:watch` — `vitest` (watch mode)
- `compare-live` — `tsx scripts/compare-live.ts` (parity check between Apps Script `fetchDashboardData` via clasp and Next.js `/api/dashboard` payload)
- `ensure-action-sheets` — `tsx scripts/ensure-action-sheets.ts` (creates/validates `DashboardActionsState` and `DashboardActionLog` sheets via googleapis)
- `ensure-inactive-sheet` — `tsx scripts/ensure-inactive-sheet.ts` (creates/validates `InactiveStudents` sheet via googleapis)

**Apps Script entry points (invoked via `clasp run`):**
- `doGet()` in `Code.gs` — serves `dashboard.html`
- `fetchDashboardData()` in `Code.gs` — returns cached payload
- `runValidationSuite()` in `Validation.gs` — unit test runner for 40+ business-rule fixtures
- `runLiveAccuracyAudit` in `Validation.gs` — live parity audit (requires Sheets authorization)
- Student-action handlers: `setStudentAction`, `bulkSetStudentAction`, `clearStudentAction` in `DashboardActions.gs`
- Chunked transfer: `beginDashboardDataTransfer`, `fetchDashboardDataChunk`, `fetchDashboardDataChunkBatch` in `Code.gs`

## Platform Requirements

**Development:**
- Node.js compatible with `@types/node` ^22 (Node 22+ recommended)
- `@google/clasp` CLI (not listed in package.json — assumed globally installed per CLAUDE.md and `scripts/compare-live.ts` line 63 which executes `clasp`)
- A Google account authorized on the Apps Script project `1kAv9ICE5DQqE17JWynXJoV2Lu2bgs7pjzAfDzLNZ-1aMjhq_yKky1MQ6`
- Vercel CLI for deployments touching the `web/` shadow

**Production:**
- Apps Script: Google-hosted web app (anonymous access, executes as deployer). Source-of-truth for dashboard behavior at the time of this snapshot.
- Next.js: Vercel deployment of `web/` folder (standard Node runtime — no Edge runtime usage; `export const runtime = "nodejs"` is declared explicitly on every API route because `googleapis` requires Node APIs)

## CI / Governance

**`.github/` directory:**
- `CODEOWNERS` — single owner `* @kasheesh711`
- `pull_request_template.md` — requires linked issue, ownership area, validation evidence, deployment-impact checkboxes, documentation checklist, handoff section
- `ISSUE_TEMPLATE/agent-task.yml` + `ISSUE_TEMPLATE/config.yml` — structured template for agent-created issues

**No GitHub Actions workflow files detected** (no `.github/workflows/` directory). CI/CD is effectively Vercel's preview-per-PR plus manual `clasp push` and manual `runValidationSuite` execution per CLAUDE.md.

---

*Stack analysis: 2026-04-20*
