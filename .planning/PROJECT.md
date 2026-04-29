# BeGifted Ops — Wisenet Migration Milestone

## What This Is

An internal operations dashboard for BeGifted Education that lets tutoring-center operators triage students with expiring packages and low credit balances, run follow-up actions, and plan the calendar. Today it ships as two stacks: a legacy Google Apps Script web app and a Next.js "shadow" deployed to Vercel. Both currently read from a Google Sheets source of truth.

This milestone finishes the migration to a single Next.js dashboard and swaps the data source from Google Sheets to the Wisenet student-management API.

## Core Value

Operators can trust the dashboard as a single source of truth for who to follow up with and what credit / package state each student is in — without any manual sheet syncing.

## Requirements

### Validated

<!-- Inferred from the existing codebase / current production state — these are what the dashboard already does and must continue to do after migration. -->

- ✓ Operators sign in with a BeGifted Google Workspace account (NextAuth v5 beta, Google provider) — existing
- ✓ Dashboard displays a student queue triaged by credit / package state — existing
- ✓ Operators can record follow-up actions against a student (today written back to Google action sheets) — existing
- ✓ Calendar view of package expiry and scheduling signals — existing
- ✓ Bulk follow-up actions, filter toolbar, keyboard shortcuts, and line-preview modal — existing
- ✓ Shadow Next.js deployment on Vercel with live/cold cache paths — existing
- ✓ Apps Script validation suites (`runValidationSuite`, `runLiveAccuracyAudit`) — existing

### Active

<!-- This milestone — building toward these. -->

- [ ] Next.js app reads all student / package / credit / session data from the Wisenet API (not Google Sheets)
- [ ] Wisenet field-mapping discovery: every field the current dashboard uses is mapped to a Wisenet endpoint; gaps explicitly documented
- [ ] Follow-up state (status, notes, timestamps, history) persists to a Neon Postgres database instead of Google action sheets
- [ ] Next.js dashboard UI rewired against the new Wisenet + Postgres data layer, with parity on queue / calendar / student detail / bulk actions
- [ ] Apps Script side fully retired (web app stopped, clasp deployment decommissioned, `.gs` source archived or removed)
- [ ] `web/src/lib/sheets/` and all `googleapis` Sheets usage removed from the production path
- [ ] Credentials moved to `.env` / Vercel env; no API keys, service-account JSONs, or Wisenet keys in tracked files
- [ ] Tests / validation covering the Wisenet read path and the Postgres write path (the cutover safety net)

### Out of Scope

<!-- Explicit exclusions — reasoning included to prevent re-adding. -->

- **Parallel shadow-compare mode against the Apps Script/Sheets stack** — user chose "just cut over." Validation comes from tests + operator sign-off, not a nightly diff job.
- **Migrating historical follow-up state from the action sheets into Postgres** — user chose "start fresh." Action sheets stay in place as read-only archive.
- **In-progress `codex/dashboard-load-performance` branch work** (dashboard-shell / queue-panel / student-detail / api/inactive uncommitted changes) — user decided to rebase/discard; migration will rewrite this surface anyway.
- **Writing follow-up state back into Wisenet custom fields** — user chose a separate Postgres store. Wisenet stays read-only for the dashboard.
- **Building a new Apps Script feature surface** — Apps Script is on a retirement path; no net-new `.gs` logic in this milestone.
- **Non-Google OAuth providers** — NextAuth stays Google-only.

## Context

**Existing stacks (from `.planning/codebase/`):**

- **Apps Script layer:** `Code.gs`, `SharedHelpers.gs`, `DashboardActions.gs` (student follow-up state), `DashboardAnalytics.gs`, `DashboardPackages.gs`, `DashboardState.gs`, `DashboardDataLoading.gs`, `DashboardProjection.gs`, `Validation.gs` (80KB validation core), `dashboard.html` (103KB monolithic frontend). Deployed via clasp; validation suites are the de-facto tests.
- **Next.js shadow app** at `web/`: Next 16.2.1, React 19.2.4, next-auth 5.0.0-beta.30, googleapis 171.4.0, TypeScript 5.9, Vitest 3.2. App Router with `(protected)/` auth gate, `api/dashboard`, `api/actions`, `api/health` routes. Libs under `src/lib/{auth,cache,dashboard,runtime,sheets}`. Two existing test files in `src/test/`.
- **Data source today:** Google Sheets via `googleapis` client. `src/lib/sheets/source-loader.ts` + `src/lib/sheets/client.ts` own Sheets access; `src/lib/sheets/actions.ts` writes follow-up rows.
- **Deployment:** Vercel. Google OAuth, Google Sheets API. Shadow is live as of 2026-03-31.
- **Operator workflow rules (from `CLAUDE.md`/`AGENTS.md`):** Backend logic must stay split across `.gs` slices; `DashboardActions.gs` is its own ownership slice for follow-up state; HTTP -1 / chunk-transfer errors are deploy-state symptoms first; run `runValidationSuite` before balance / action-state changes. These rules fade as Apps Script retires but constrain the transition period.

**Wisenet API:**

- Vendor: Wisenet (Australian student-management system), namespace `begifted-education`.
- Credentials provided: User ID, Center ID, API Key, namespace. **Credentials will live only in `web/.env` (gitignored) and Vercel env vars — never in tracked files.**
- Public Postman docs available.
- Field coverage vs. current Sheets-driven dashboard is **not yet confirmed** — Phase 1 must explicitly map every current dashboard field to a Wisenet endpoint/field and list gaps.

**Known risks (from `.planning/codebase/CONCERNS.md`):**

- `next-auth: 5.0.0-beta.30` is pre-release — behavior changes on minor bumps are expected.
- HTTP -1 / chunked-transfer failures historically correlate with stale Vercel/clasp deployments.
- Monoliths: `dashboard.html` (103KB) and `Validation.gs` (80KB) — either retire or leave untouched during migration, don't half-refactor.

## Constraints

- **Tech stack**: Next.js 16 App Router + TypeScript — existing shadow architecture stays, only the data layer changes.
- **Tech stack**: Neon Postgres via Vercel Marketplace — chosen for follow-up state (relational queries, history/audit). No ORM prescribed yet; pick during Phase 2.
- **Tech stack**: No nightly shadow-compare or parity diff job — user chose "just cut over." Tests + operator sign-off are the safety net.
- **Security**: Wisenet API credentials and Google service-account JSON must never be committed. `.env` files are gitignored; credentials referenced by env-var name only. If any secret is ever pasted into chat, rotate it.
- **Compatibility**: Google Workspace login (existing NextAuth Google provider) stays the auth method — operators don't re-learn a login flow.
- **Dependencies**: Wisenet API field coverage is unverified; Phase 1 must surface gaps before subsequent phases commit to UI shape.
- **Deployment**: Vercel is the only production target; Apps Script / clasp are on a retirement path this milestone.
- **Workflow**: Small PRs per issue, claim ownership by file slice, keep docs updated alongside code changes (per `CLAUDE.md` / `AGENTS.md`).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Wisenet swap first, then retire Apps Script | Proves Wisenet parity inside the shadow before removing the legacy fallback. Reduces blast radius of a bad Wisenet mapping. | — Pending |
| Neon Postgres for follow-up state (not Wisenet custom fields, not Redis, not Blob) | Relational queries, audit history, and future reporting make Postgres the right shape. Wisenet stays read-only to keep their data model clean. | — Pending |
| Start follow-up history fresh (no import from action sheets) | Action sheets remain as archive; cutover speed matters more than historical continuity. Reduces Phase 2 scope significantly. | — Pending |
| Apps Script fully retired at milestone end (not "backup read-only") | Two dashboards = two mental models for operators. A clean single-source cutover is the whole point. | — Pending |
| Rebase/discard current `codex/dashboard-load-performance` uncommitted work | Migration will rewrite the dashboard surface; perf work would be superseded. | — Pending |
| No nightly parity-diff safety net | User prioritizes cutover speed over parallel-stack validation. Tests + operator QA cover correctness. | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-20 after initialization*
