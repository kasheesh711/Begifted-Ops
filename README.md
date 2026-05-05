# BeGifted Ops

Package expiry alert dashboard for BeGifted Education, with a shared Google Apps Script production app and an in-progress Next.js shadow migration under `web/`.

This app gives admin staff a live view of which students are close to exhausting prepaid tutoring credits, which students need immediate follow-up, and when those students are scheduled to turn up next. The web app supports admin-scoped views driven by the `RemainingCredits` sheet so staff can switch between `All`, named admin ownership views, and `Unassigned` without loading separate payloads, uses a triage-first calendar that speeds up day selection instead of making operators parse dense month cells, and now lets operators record same-day follow-up state directly in the queue and student detail views.

Read [`docs/app-overview.md`](docs/app-overview.md) before changing business logic. It summarizes the product purpose, sheet dependencies, status model, and known PRD-versus-code gaps.

## Current System State

| Area | Current state |
| --- | --- |
| Production runtime | Google Apps Script web app remains the live operator-facing system |
| Shadow app | `web/` contains the Next.js migration surface, deployed to Vercel |
| Validated locally | `web/` passes `npm test` and `npm run build` |
| Vercel preview | Live at `https://web-six-liard-22.vercel.app` with Google Sign-In and Sheets API access |
| UX enhancements | Phase 1 (quick wins) and Phase 2 (decomposition + workflow redesign) deployed to production (2026-04-01) |
| Previously blocked | Google OAuth, Sheets service account, and Vercel linking are now resolved (2026-03-31) |

## Runtime Notes

The dashboard now uses an async bootstrap path instead of embedding the full data payload into the initial HTML response.

- `doGet()` returns the shell immediately so operators see the UI without waiting for spreadsheet reads.
- `dashboard.html` loads the data asynchronously through Apps Script and shows explicit loading or retry states while the payload is in flight.
- `beginDashboardDataTransfer()` checks chunked cache metadata before calling the expensive payload builder, so warm refreshes return the manifest without recomputing the dashboard payload.
- the Apps Script backend caches the computed dashboard payload in chunked `CacheService` entries for 2 minutes so warm refreshes can reuse the same payload
- the browser fetches chunked payloads in ordered batches of 5 parts at a time instead of issuing one Apps Script round-trip per chunk
- if chunk metadata or chunk parts disappear during a web-app transfer, the server now rebuilds the payload slices and the client retries the transfer once instead of surfacing a fatal chunk-loading error
- admin view tabs are rendered client-side from one payload fetch; switching between admin scopes does not trigger another Apps Script data load
- snapshot history and delta baselines are only persisted during a fresh recompute, not on cache hits
- student action-state writes invalidate the cached dashboard payload immediately so the next refresh cannot reuse stale queue metadata

### Next.js Web App UX Enhancements

The `web/` dashboard shell now includes the following operational improvements beyond workflow parity:

**Phase 1 (Tier 1 quick wins):**
- the dashboard polls for fresh data every 60 seconds in the background while the browser tab is focused, preserving the current admin filter, search, selected student, and calendar state across refreshes
- the selected admin filter tab is persisted to `localStorage` so operators return to their own scoped view on each session without manually reselecting
- the "Students in queue" summary card shows an actioned-today progress indicator with a count and progress bar so operators can track completion at a glance
- bulk and single-student `Clear` actions require a confirmation dialog before executing to prevent accidental erasure of same-day action records
- the queue table header is sticky and the table body scrolls within a viewport-constrained container so column labels stay visible on long lists
- success toast notifications display for 3.5 seconds; error toasts persist until manually dismissed with a close button and slide in with an animation

**Phase 2 (Component decomposition + workflow redesign):**
- the monolithic dashboard shell has been decomposed into focused components: `QueuePanel`, `StudentDetail`, `CalendarPanel`, `SummaryBar`, `FilterToolbar`, `BulkActionBar`, `LinePreviewDrawer`, and `ToastNotification`, with shared types and utilities extracted to `ui-helpers.ts`
- the LINE message preview is now a slide-over drawer from the right edge instead of a centered modal; includes a "Copy + Mark Contacted" combo button and remains open alongside the queue
- inline quick-action icons (Contacted, Pending callback, Resolved) appear on hover in each queue row for one-click status updates; always visible on touch devices
- full keyboard navigation: `j`/`k` or arrow keys to move through the queue, `c`/`p`/`r` for action shortcuts, `l` for LINE drawer, `/` to focus search, `Escape` to close/clear, `?` for a shortcut reference card
- calendar-to-queue cross-linking: clicking a student in the calendar scrolls and flashes the corresponding queue row

## Student Action Workflow

The command center now carries lightweight same-day operator state in addition to balance and projection data.

- operators can mark a student as `Contacted`, `Pending Callback`, or `Resolved`, or clear the state entirely
- the queue supports multi-select bulk updates for the currently visible rows
- the student detail header exposes the same controls for one-off updates
- visible action state is day-scoped: history is retained in Apps Script script properties, but only entries updated today appear in the payload
- action attribution is recorded only when the change is made from a named admin view; updates from `All` or `Unassigned` intentionally omit actor attribution

## Apps Script Release Notes

The shared Apps Script project now uses a split source layout instead of keeping all backend logic inside one monolithic `Code.gs`.

- `Code.gs` is the bootstrap and shared constants entrypoint.
- `DashboardActions.gs` owns script-properties-backed student action state and cache invalidation helpers.
- The package, analytics, projection, cache, and helper logic live in separate tracked `.gs` files.
- A successful `clasp push` updates the server source, but versioned web app URLs still require a fresh `clasp deploy` to expose new UI or backend behavior.
- Deployment `AKfycbzhBoQM6QeGlq3_zIchOzPVvXiYo6RSuLq4qV4FeuYWBmKP8FdROk7bPu6P2qi9fL-H1A` still requires a fresh versioned deploy whenever new queue, action-state, or transfer behavior is pushed to the shared script project.
- If `clasp push` unexpectedly reports `Skipping push.` while the remote project is clearly stale, verify the remote state and rerun with `clasp push --force` before deploying a new web app version.
- If the browser shows `Dashboard data unavailable` with `HTTP -1` after a backend fix was pushed, confirm that the affected web app deployment was also updated; pushed source alone is not enough for a versioned URL.

## Next.js Shadow App

The `web/` directory is the active Phase 1 migration target. It is not the live production dashboard yet. Its job is to reproduce the current operational workflow behind Google Sign-In while reading directly from Google Sheets through the Sheets API.

- Purpose:
  - preserve the current dashboard payload contract and workflow in a protected Next.js app
  - move request-time work off Apps Script while keeping Google Sheets as the source of truth
  - prepare a shadow preview for parity testing before any cutover decision
- Current implementation surface:
  - allowlisted Google Sign-In via NextAuth
  - Sheets-backed `GET /api/dashboard`
  - Sheets-backed `POST /api/actions` and `POST /api/actions/bulk`
  - `GET /api/health` for auth, Sheets, and cache diagnostics
  - decomposed React dashboard shell in `web/src/components/dashboard/` with orchestrator in `dashboard-shell.tsx` and focused sub-components
- Local commands:

```sh
cd web
npm test
npm run build
npm run ensure-action-sheets
npm run compare-live
```

- External prerequisites (all resolved 2026-03-31):
  - Google OAuth credentials configured in GCP project `BeGifted Ops` (project 989561595551)
  - Google Sheets service account `begifted-sheets-reader@begifted-ops.iam.gserviceaccount.com` with access to both spreadsheets
  - Vercel project linked under `kevins-projects-6ebb4efc/web`
  - All env vars set in both `web/.env` (local) and Vercel (production/development)
- Remaining known limitation:
  - `npm run compare-live` is blocked because `clasp run fetchDashboardData` fails on `SpreadsheetApp.openById` authorization; this does not affect the Next.js shadow app which reads sheets directly via the service account

The current continuation brief for migration work is [`docs/nextjs-shadow-handoff.md`](docs/nextjs-shadow-handoff.md).

## Current Product Surfaces

The live app is now organized into two primary surfaces:

- `Command Center`: student-level prioritized queue plus a triage-first month/week/day calendar with quick jumps, compact severity-first day cells, an actionable-days strip, and a persistent selected-day detail rail, with top-level admin tabs for `All`, named staff ownership views, and `Unassigned`
- `Student Detail`: package-level balance waterfall, projection, data-quality warnings, communication support, and per-student action-state controls

### Calendar UX

The command-center calendar is optimized for triage rather than broad calendar navigation.

- `Month` remains the default view.
- The calendar toolbar uses one compact mode switch, a centered period navigator, and fast actions for `Today`, `Next urgent`, and `Next scheduled`.
- Month and week cells show only the date, scheduled student count, and one severity signal.
- A horizontal actionable-days strip exposes the next relevant scheduled dates without requiring repeated `Prev`/`Next` clicks.
- Selected-day detail lives in a persistent right rail on desktop and stacks below the grid on narrow screens.
- `Day` view reuses the same selected-day workload detail instead of switching to a separate hourly-style layout.

### Queue And Follow-Up UX

- top-level risk chips let operators narrow the queue to `All`, `Notify`, `Watch`, or `Healthy`
- queue rows are sortable by priority, student, rolled-up balances, next session date, and package count
- visible rows can be multi-selected and updated in bulk to `Contacted`, `Pending Callback`, `Resolved`, or `Clear`
- bulk and single-student `Clear` actions require confirmation before executing
- queue rows and student detail headers both show the latest same-day action state with timestamp and optional acting admin label
- the queue table header is sticky so column labels remain visible while scrolling through long student lists
- the queue table scrolls within a viewport-constrained container instead of extending the full page height
- inline quick-action icons (Contacted, Pending, Resolved) appear on hover in each queue row for one-click status updates without opening the detail panel; on touch devices they are always visible
- keyboard shortcuts navigate the queue (`j`/`k` or arrow keys), fire actions (`c`/`p`/`r`), open the LINE drawer (`l`), focus search (`/`), and toggle a help card (`?`)
- clicking a student in the calendar scrolls the matching queue row into view with a flash animation

## Working Model

This repository is optimized for parallel agent-assisted development with Claude and Codex.

- GitHub Issues are the source of truth for non-trivial work.
- `main` is treated as protected and changes land through pull requests.
- One issue maps to one branch and one PR.
- Agents must document ownership, touched files, validation, deployment impact, and blockers.

The shared workflow lives in [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Repository Layout

- `Code.gs`: shared constants plus web-app entrypoints and async payload bootstrap.
- `DashboardActions.gs`: student action-state persistence, history trimming, and cache invalidation.
- `DashboardDataLoading.gs`: sheet adapters and required-column validation, including `RemainingCredits`.
- `DashboardPackages.gs`: active-student filtering, exclusion rules, admin ownership resolution, pending deductions, package assembly, and action helpers.
- `DashboardAnalytics.gs`: package scoring, student-level queue aggregation, calendar shaping, scoped view metadata, summary metrics, and snapshot persistence helpers.
- `DashboardState.gs`: snapshot persistence and chunked cache helpers.
- `DashboardProjection.gs`: balance projection and status evaluation helpers.
- `SharedHelpers.gs`: generic spreadsheet, date, and parsing utilities used across backend files.
- `Validation.gs`: fixture-based validation runner for package-rule logic, student queue aggregation, calendar grouping, and cache helpers.
- `dashboard.html`: client-side command center and student detail UI, including the triage-first calendar, actionable-day shortcuts, and selected-day rail.
- `web/`: Next.js shadow migration app, including auth, Sheets-backed APIs, cache layer, parity tooling, and the decomposed React command-center (orchestrator in `dashboard-shell.tsx`, focused sub-components in `web/src/components/dashboard/`, shared utilities in `web/src/lib/dashboard/ui-helpers.ts`, keyboard shortcuts in `web/src/hooks/use-keyboard-shortcuts.ts`).
- `appsscript.json`: shared Apps Script manifest and web app settings.
- `.clasp.json`: shared binding to the team Apps Script project.
- `CLAUDE.md`: Claude-specific repo instructions.
- `AGENTS.md`: Codex and general agent operating guidance.
- `docs/WORKFLOW.md`: shared collaboration, branching, PR, and handoff rules.
- `docs/nextjs-shadow-handoff.md`: decision-complete continuation brief for the Next.js shadow migration.

## Shared Apps Script Project

- Script ID: `1kAv9ICE5DQqE17JWynXJoV2Lu2bgs7pjzAfDzLNZ-1aMjhq_yKky1MQ6`
- Editor URL: <https://script.google.com/d/1kAv9ICE5DQqE17JWynXJoV2Lu2bgs7pjzAfDzLNZ-1aMjhq_yKky1MQ6/edit>

This repo intentionally tracks `.clasp.json` and `appsscript.json` so every collaborator and agent targets the same Apps Script project.

## Local Setup

1. Clone the repository.
2. Authenticate locally with `clasp login`.
3. Keep local credentials out of Git. Only `.clasprc.local.json` is used for machine-local auth and must never be committed.
4. Pull the latest GitHub changes before starting work.

Useful commands:

```sh
clasp login
clasp pull
clasp push
clasp deploy
```

Validation entrypoint in Apps Script:

```sh
clasp run runValidationSuite
```

Live diagnostics entrypoints in Apps Script:

```sh
clasp run runLiveAccuracyAudit
clasp run inspectStudentPackageBalance --params '["Varis (Dean.Ka) Karuhadej","Y12-13 / G11-12 (Int.)"]'
```

The validation suite now covers:

- package-rule behavior
- canonical pending deductions sourced from `Should_Credit`, with duration fallback coverage
- admin ownership resolution from `RemainingCredits`, including conflicting-owner tie-breaks and `Unassigned` fallback
- student queue aggregation, priority ranking, calendar grouping, and summary delta calculations
- student action-state persistence, clearing, bulk updates, same-day visibility rules, and actor attribution
- payload cache miss and cache hit behavior
- chunked cache round-trips for large payloads
- chunked transport manifest and chunk reconstruction helpers
- chunk-batch reads, partial final batches, and recovery when chunk metadata or individual parts disappear mid-transfer
- warm-cache transfer behavior that must not invoke the payload loader when chunk metadata already exists
- cold-cache transfer behavior that promotes to chunked mode after caching and preserves inline fallback if chunk metadata is still unavailable
- chunk-batch recovery when metadata or an individual cached chunk disappears during web-app transfer

The live audit runner covers:

- package-level parity between the website payload and live sheet calculations
- student queue roll-up parity
- summary metric parity for source-derived counts
- explicit warnings for pending rows that fell back to duration-based deductions
- report output written to the `Dashboard Accuracy Audit` sheet for live mismatch review
- a focused Dean.Ka assertion that currently expects `system = 1.5`, `pending = 1.5`, and `actual = 0.0`

## Development Rules

- Start non-trivial work from a GitHub Issue.
- Use branch names like `feature/<issue-or-short-name>`, `fix/<issue-or-short-name>`, and `docs/<issue-or-short-name>`.
- Claim backend ownership by file slice whenever possible so concurrent work stays disjoint.
- Include documentation updates in the same PR when workflow, deployment, setup, or structure changes.
- Never commit auth tokens, local machine config, or personal credentials.

## Documentation Requirements

Every substantial PR must include:

- linked issue
- summary of changes
- touched files or ownership area
- validation performed
- deployment impact
- documentation updates
- handoff notes or blockers

Use the PR template and the handoff format in [`docs/WORKFLOW.md`](docs/WORKFLOW.md).
