# App Overview

This document is the engineering-facing summary of what the BeGifted Credit Control Dashboard is supposed to do. The full product source of truth is the PRD document `Begifted Package Expiry Dashboard_PRD.docx`. Use this Markdown file for repo-local onboarding and for planning code changes.

## Purpose And Users

The dashboard is an internal admin operations tool for BeGifted Education. It helps admin staff identify which students are at risk of running out of tutoring credits, decide who needs follow-up first, and prepare parent outreach before credits are exhausted.

Primary users:

- admin staff monitoring package balances
- operations or strategy staff reviewing credit risk and follow-up priority
- admin staff switching between ownership-scoped views for their own student portfolio

## Problem And Operational Objective

BeGifted sells tutoring through prepaid credit packages. Before this dashboard, staff had to inspect multiple spreadsheets manually to understand a student's real balance and future risk.

The operational objective is to:

- show which students are at risk right now
- project when packages will fall below the alert threshold
- support proactive parent outreach
- reduce cases where students continue into negative credits without prior notification

## Data Sources And App State

The current production app reads live data from two Google Sheets files through Apps Script. The in-progress Next.js shadow app in `web/` reads those same spreadsheets through the Google Sheets API and persists migration-era action state in dedicated analytics tabs instead of Apps Script properties.

Required sources:

- `BeGifted Student Credits` / `Aggregations`
  - key fields: `Student Name`, `Parent Name`, `Class Subject`, `Current Remaining Credits`, `Current Total Credits`
  - role: starting balance and package metadata
- `BeGifted Education Analytics` / `Credit_Control`
  - key fields: `Student Name`, `Package/Program`, `final_status`, `teacher_feedback`, `credits_consumed`, `session_duration`, `session_date`, `Should_Credit`
  - role: detect sessions that should affect actual balance
- `BeGifted Education Analytics` / `Upcoming Sessions`
  - key fields: `Student Name`, `Package/Program`, `Scheduled Date`, `Session Duration`, `Session Status`
  - role: project future balance consumption
- `BeGifted Education Analytics` / `Students`
  - key fields: `student_name`, `Remaining Credits`
  - role: filter active versus inactive students
- `BeGifted Education Analytics` / `Students & Courses`
  - key fields: `Student Name`, `Student Full Name`, `Class Subject`
  - role: identify excluded package types
- `BeGifted Education Analytics` / `RemainingCredits`
  - key fields: `Student`, `Admin`
  - role: resolve the student-level admin ownership used by the web app's admin tabs
- Apps Script `ScriptProperties`
  - key pattern: `BG_ACTION_V1::<studentKey>`
  - role: retain per-student action-state history plus the latest visible same-day follow-up state
- `BeGifted Education Analytics` / `DashboardActionsState`
  - key fields: `student_key`, `student_name`, `parent_name`, `status`, `updated_at`, `updated_by_email`, `updated_by_name`
  - role: Next.js shadow action-state store for the latest per-student follow-up state
- `BeGifted Education Analytics` / `DashboardActionLog`
  - key fields: `event_id`, `student_key`, `student_name`, `parent_name`, `status`, `action_type`, `updated_at`, `updated_by_email`, `updated_by_name`
  - role: Next.js shadow action audit log

## Migration Status

The repository now contains two runtime paths:

- `Apps Script production`
  - current live operator-facing dashboard
  - canonical source for current business-logic behavior and deployment reality
- `Next.js shadow app`
  - located in `web/`
  - intended to reproduce the current workflow behind Google Sign-In before cutover
  - uses an allowlisted Google Sign-In flow plus Sheets-backed API routes:
    - `GET /api/dashboard`
    - `POST /api/actions`
    - `POST /api/actions/bulk`
    - `GET /api/actions/history`
    - `GET /api/health`
  - uses a two-layer cache:
    - process-local in-memory cache for Sheets reads
    - Next.js/Vercel tag cache for the computed dashboard payload
  - currently includes a workflow-parity React shell for queue operations, calendar navigation, student detail, and LINE message support
  - includes operational UX enhancements beyond parity: 60-second background polling, persistent admin filter via localStorage, actioned-today progress indicator, confirmation on destructive Clear actions, sticky queue table header with contained scroll, improved toast notifications with persistent error toasts, LINE slide-over drawer with copy-and-mark combo, inline quick-action icons per queue row, full keyboard navigation with shortcut reference card, and calendar-to-queue cross-linking with scroll and flash
  - the dashboard shell has been decomposed from a monolithic 1932-line file into focused components (`QueuePanel`, `StudentDetail`, `CalendarPanel`, `SummaryBar`, `FilterToolbar`, `BulkActionBar`, `LinePreviewDrawer`, `ToastNotification`) with shared utilities in `ui-helpers.ts`
  - Phase 3 polish: resizable split layout for queue + calendar panels with drag divider and localStorage-persisted ratio, optimistic action updates with revert on failure and opacity pulse indicator, 5-second undo toasts after marking actions, search term highlighting in queue rows and calendar day student cards, bulk selection improvements with "Select all matching" and "Deselect all" buttons plus a floating selection count badge, and styled empty states for queue, calendar, and student detail panels

## Current Migration Gaps / External Blockers

Most external blockers were resolved on 2026-03-31. The shadow app is live on Vercel at `https://web-six-liard-22.vercel.app` with Google Sign-In and Sheets API access.

- `web/` passes `npm test` and `npm run build`
- `npm run ensure-action-sheets` works with configured Sheets env vars
- the Vercel preview is live and accessible to allowlisted staff
- **Remaining**: `npm run compare-live` is blocked because `clasp run fetchDashboardData` fails on `SpreadsheetApp.openById` authorization; this does not affect the Next.js shadow app which reads sheets directly via the service account
- **Remaining**: strict shadow parity has not yet been verified against live Apps Script output

## Current Business Rules

The current implementation shape in the Apps Script backend and the PRD indicate this flow:

1. Load all required sheets.
2. Keep only active students.
3. Exclude package types that should not count toward package alerts.
4. Resolve one admin owner per student from `RemainingCredits`.
5. Calculate an actual remaining balance by adjusting the reported balance with pending deductions.
6. Project upcoming sessions in chronological order.
7. Assign a status used for prioritization and UI display.

### Active Student Filter

Students are considered active when `Remaining Credits` in the `Students` sheet is neither `N/A` nor empty. Numeric values, including `0` or negative values, still count as active.

### Balance Model

The dashboard distinguishes between:

- `Current Remaining Credits`: the value from `Aggregations`
- `Actual Remaining Credits`: the balance used for alerts and projection after pending deductions are applied

The PRD defines:

`Actual Remaining = Current Remaining - Pending Deductions`

### Pending Deductions And Session Consumption

Credits are modeled as one credit per 60 minutes of session duration.

Examples:

- 60 minutes = 1.0 credit
- 90 minutes = 1.5 credits
- 120 minutes = 2.0 credits

The app uses historical session data from `Credit_Control` to identify sessions that affect the effective balance before future projection. Upcoming sessions are then applied in chronological order to project when the balance crosses alert or exhaustion thresholds.

### Package Deduplication

If a student appears more than once for the same package in `Aggregations`, the package record with the highest total credits is retained. This is intended to reduce duplicate package cards caused by source-sheet data quality issues.

### Admin Ownership Resolution

The web app exposes manual admin tabs for:

- `All`
- `Palm`
- `Kem`
- `Care`
- `Aya`
- `Petchy`
- `Muk`
- `Unassigned`

Ownership is resolved from `RemainingCredits` at the student level, even though the source sheet is package-row based.

The current code uses this rule:

- count recognized non-blank `Admin` rows per student
- choose the admin with the most rows
- if tied, use the earliest recognized row in `RemainingCredits`
- if no recognized admin can be resolved, classify the student as `Unassigned`

Recognized admin names currently are:

- `Chiraya (Palm) Takornkulwut`
- `Kemjira (Kem) Waritpariya`
- `Kittiya (Care) Taweesinprasarn`
- `Pakwalan (Aya) Singkhorn`
- `Panida (Petchy) Wiya`
- `Suphitsara (Muk) Manosamrit`

### Student Action State

The web app now tracks a lightweight same-day outreach state per student in addition to balance and schedule data.

Supported statuses:

- `contacted`
- `pending-callback`
- `resolved`

Current implementation rules:

- action state is saved by `studentKey`, not package key
- queue bulk actions and student-detail controls both write the same backend state
- only statuses updated on the current day are surfaced in the payload; older entries remain in history but disappear from the visible dashboard state
- named admin views persist actor attribution such as `Palm`; updates made from `All` or `Unassigned` intentionally store no actor label
- writes invalidate the cached dashboard payload so refreshed queue and detail views cannot keep stale action pills

### Package Exclusion Rules

Packages are excluded from the dashboard when the package context indicates either:

- `Pretest`
- `Trial`

The current code treats either keyword in `Students & Courses`.`Student Full Name` or `Class Subject` as an exclusion match for that student's package.

## Status Definitions

The dashboard uses four package-level statuses:

- `notify`: actual remaining credits are already below the immediate alert threshold
- `watch`: projected to fall below the alert threshold within the notification window
- `ok`: not currently at immediate risk and no near-term alert is projected
- `nodata`: no useful projection is available, typically because there are no upcoming sessions

The current code uses:

- alert threshold: `2` credits
- watch window: `30` days

## What The Dashboard Should Show

The current frontend organizes the operator experience into two layers:

- `Command Center`
  - a student-level prioritized action queue instead of repeated package rows
  - top-level admin tabs that scope the command center to `All`, one named admin, or `Unassigned`
  - risk filter chips for `All`, `Notify`, `Watch`, and `Healthy`
  - rolled-up system and actual balances across all active packages
  - the nearest next session across any package for each queued student
  - sortable queue headers for priority, student, rolled-up balances, next session date, and package count
  - row selection plus bulk action-state updates for the currently visible student set
  - same-day action-state pills in the queue, including timestamp and optional acting admin label
  - an actioned-today progress indicator in the summary cards showing how many queued students have been handled
  - a sticky queue table header so column labels remain visible while scrolling through long student lists
  - a viewport-constrained scrollable queue table body instead of full-page height extension
  - confirmation dialogs on bulk and single-student Clear actions to prevent accidental erasure of same-day records
  - inline quick-action icons (Contacted, Pending callback, Resolved) on hover per queue row for one-click status updates; always visible on touch devices or screens below 1024px
  - full keyboard navigation: `j`/`k` or arrow keys move through the queue, `c`/`p`/`r` fire action shortcuts, `l` opens the LINE drawer, `/` focuses search, `Escape` closes or clears, `?` toggles a shortcut reference card
  - calendar-to-queue cross-linking that scrolls and flashes the matching queue row when a student is selected from the calendar
  - a triage-first calendar that supports month, week, and day views while keeping `month` as the primary overview
  - a compact toolbar with one mode switch, a centered period navigator, and quick jumps for `Today`, `Next urgent`, and `Next scheduled`
  - lightweight month and week cells that show the date, total scheduled students, and one severity signal instead of dense summary copy
  - an actionable-days strip that surfaces the next relevant scheduled dates as direct jump targets
  - a persistent selected-day detail rail on desktop that shows totals, urgency counts, adjacent actionable-day navigation, and the student list sorted by urgency
  - a mobile layout that stacks the selected-day rail below the grid instead of keeping a side-by-side calendar/detail layout
  - a resizable split layout (60/40 default, localStorage-persisted) so admin staff can focus on either the queue or the calendar; stacks vertically on screens below 1024px
- `Student Detail`
  - one student header with roll-up status, package counts, and resolved admin owner
  - same-day student action-state summary and direct action controls
  - per-package modules for current balance, balance waterfall, projection, and recommended action
  - a cross-package upcoming-session list for the selected student
  - communication support via a LINE message slide-over drawer that keeps the queue visible, with a "Copy + Mark Contacted" combo button that copies the message and marks the student in one click

The current product requirements now emphasize:

- admin-scoped switching that filters the whole visible app surface, not just the queue
- top-bar search across student name, parent name, and package names
- sortable student queue headers with ascending/descending toggle
- same-day action-state tracking so operators can mark completed follow-up without leaving the dashboard
- bulk queue updates for outreach progress on the current filtered view
- pinned queue priority for students with no future schedule and low or negative rolled-up balance
- calendar-driven visibility into which students are attending next and who should be contacted first
- fast date selection through triage controls instead of heavy month navigation chrome
- compact calendar scanning that highlights urgent days before explanatory copy
- a consistent selected-day workload surface shared by the month, week, and day calendar modes
- student detail views with one package card per active package
- package projections showing balance reduction across upcoming sessions
- a generated LINE message template for parent communication

## High-Level Data Flow

The current technical flow is:

1. Admin opens the Apps Script web app.
2. `doGet()` returns the dashboard shell immediately instead of embedding the full payload into the HTML template.
3. `dashboard.html` requests the dashboard payload asynchronously from Apps Script after the shell is already visible.
4. `beginDashboardDataTransfer()` checks for chunked cache metadata first; on warm cache hits it returns only the manifest, and on cache misses it reads the required sheets and applies business logic on a fresh recompute.
5. The backend enriches the payload with admin ownership metadata, same-day student action state, package scoring, student-level queue aggregation, summary counts, and calendar day groupings.
6. On a fresh recompute, the app stores a lightweight comparison snapshot in Apps Script script properties for delta-aware queue scoring and summary comparisons.
7. The payload is cached in chunked `CacheService` entries for 2 minutes so warm loads can reuse the same data generation result without rebuilding the payload during transfer startup.
8. The frontend reconstructs the payload in ordered chunk batches, then renders the queue, triage-first calendar, admin tabs, detail views, and message templates client-side.

### Load-Path Notes

- The async bootstrap avoids the prior blank-screen behavior where HTML delivery was blocked on spreadsheet reads.
- The transfer bootstrap must stay manifest-first on warm cache hits; calling the payload builder before checking the chunk manifest can push the web app past Apps Script execution limits.
- The browser currently requests chunked payloads in batches of 5 parts per Apps Script round-trip to reduce transfer overhead for large payloads.
- The cached payload keeps `lastUpdatedAt` stable across cache hits because it reflects payload generation time, not page-open time.
- If chunk metadata or an individual cached chunk disappears during a web-app transfer, the current implementation rebuilds the payload slices and the browser retries the transfer once instead of failing immediately.
- Admin view switches are client-side filters over the loaded payload and do not issue another server request.
- Calendar quick jumps, actionable-day pills, and selected-day rail updates are client-side interactions over the already-loaded payload and do not issue another server request.
- Queue action-state writes are server mutations, but they patch the in-memory queue and student detail models immediately after success so the operator does not need to reload manually.
- The Next.js web app polls `/api/dashboard` every 60 seconds when the browser tab is focused, preserving all current UI state (selected student, admin filter, search, calendar position) across background refreshes so operators see fresh data without manual reload.
- The selected admin filter tab is persisted to `localStorage` in the Next.js web app so operators return to their scoped view on each session start.
- Snapshot persistence happens only on fresh recomputes so delta and trend baselines do not churn on repeated page loads.
- Source push and web app release are separate steps: `clasp push` updates the Apps Script project source, while a fresh `clasp deploy` is required for a new versioned web app URL to reflect UI changes.
- A stale versioned deployment can still show `Dashboard data unavailable` or `HTTP -1` after a source fix is pushed, so debugging web-app incidents must confirm both the pushed source and the deployed version.

## Expected Staff Actions

The app is not just a reporting view. It is meant to support operations decisions:

- narrow the command center to one admin's owned students or review the shared `Unassigned` backlog
- identify packages requiring immediate parent contact
- monitor students that are not urgent yet but will soon need follow-up
- record whether a student was contacted, is waiting on a callback, or is already resolved for the current day
- jump directly to the next urgent or next scheduled day from the command center
- compare upcoming attendance dates against rolled-up credit risk without reading dense month-cell copy
- inspect a student's package-level projections before contacting the parent
- copy a prewritten LINE message appropriate to the package state
- track triage progress at a glance through the actioned-today progress indicator in the summary cards

## Remaining PRD Follow-Ups

The following gaps remain after the current business-rule cleanup:

- repository reference:
  - the PRD still names the older GitHub repository path
  - the active collaboration repo is now `kasheesh711/Begifted-Ops`
- deployment/access wording:
  - the tracked manifest currently uses `ANYONE_ANONYMOUS`
  - the intended production access model should be confirmed before the next hardening pass

## Canonical Pending Deduction Rule

Pending deductions currently mean:

- historical session in `Credit_Control`
- `final_status` is `ENDED`
- `teacher_feedback` is blank or `0`
- `credits_consumed` is `0`
- deduction amount uses `Should_Credit` when present and greater than `0`
- if `Should_Credit` is missing or invalid, the app falls back to `session_duration / 60` and flags that row as a data-quality warning in the live audit

These sessions are treated as completed operationally but not yet reflected in consumed credits, so they reduce the dashboard's `Actual Remaining Credits`.

## Validation Harness

The repo now includes `runValidationSuite()` in `Validation.gs` for deterministic fixture-based checks of:

- `Trial` exclusion
- `Pretest` exclusion
- recognized admin ownership resolution from `RemainingCredits`
- `Unassigned` fallback when ownership is blank or missing
- conflicting admin ownership tie-breaks
- pending deductions
- watch/notify boundaries
- no-data status behavior
- duplicate package deduplication
- low-balance packages without schedule data
- student queue roll-up behavior
- student action-state persistence, clearing, bulk updates, actor attribution, and same-day-only visibility
- pinned student ordering
- calendar day grouping
- triage-first calendar selection behavior can continue to rely on the existing `calendar.days` payload contract without backend schema changes
- summary delta calculations against stored snapshots
- weekly alert bucket aggregation
- dashboard payload cache miss and cache hit behavior
- chunked cache storage for large payloads
- chunked browser transport manifest and chunk reconstruction helpers
- chunk-batch reads, partial final batches, and recovery when metadata or chunk parts disappear mid-transfer
- warm-cache transfer behavior that must not call the payload loader when chunk metadata already exists
- cold-cache transfer behavior that returns chunked mode after caching and preserves inline fallback only when chunk metadata is still unavailable
- chunk-batch recovery when cached chunk metadata or individual chunk entries disappear between manifest read and browser fetch

The repo also includes live-sheet diagnostics:

- `inspectStudentPackageBalance(studentName, packageName)` for tracing one package's source rows and arithmetic
- `runLiveAccuracyAudit()` for comparing the generated website payload against live source-sheet calculations and writing results to the `Dashboard Accuracy Audit` tab

## How To Use This Doc

- Read this file first when starting engineering work on the dashboard.
- Use the PRD for full product detail and business context.
- If a planned code change alters any rule described here, update this file in the same PR.
- If migration work changes the status of the Next.js shadow app, also update [`docs/nextjs-shadow-handoff.md`](nextjs-shadow-handoff.md).
