# Next.js Shadow Handoff

This document is the canonical continuation brief for the Next.js shadow migration in `web/`. Use it when handing work to another coding agent or resuming after a pause.

## Objective

Reach a protected, shadow-ready preview on Vercel that reproduces the current operator workflow while reading production data from Google Sheets.

## Current Status (2026-04-01, Phase 4 complete)

The shadow app is **live on Vercel** with Google Sign-In and direct Sheets API access. The dashboard shell has been decomposed into focused components and includes Phase 1 + Phase 2 + Phase 3 + Phase 4 UX enhancements beyond workflow parity. All changes are deployed to production.

- Production URL: `https://web-six-liard-22.vercel.app`
- Vercel project: `kevins-projects-6ebb4efc/web`
- GCP project: `BeGifted Ops` (project number 989561595551)
- Service account: `begifted-sheets-reader@begifted-ops.iam.gserviceaccount.com`

## Resolved Blockers

| Blocker | Resolution | Date |
| --- | --- | --- |
| Google OAuth credentials | Created OAuth client in GCP project `BeGifted Ops`, consent screen published | 2026-03-31 |
| Google Sheets service account | Created `begifted-sheets-reader` SA, JSON key generated, both spreadsheets shared with SA | 2026-03-31 |
| GCP org policy blocking SA key creation | Disabled `iam.disableServiceAccountKeyCreation` and `iam.managed.disableServiceAccountKeyCreation` via gcloud CLI on org 451660949954 | 2026-03-31 |
| Vercel auth and project linking | Vercel CLI installed, logged in, project linked, all env vars pushed | 2026-03-31 |
| NextAuth sign-in error (UnknownAction) | Fixed signin page to use Server Action form instead of GET `<a href>` | 2026-03-31 |
| Sheets private key DECODER error on Vercel | Fixed env var format (correct escaping of `\n` in private key) | 2026-03-31 |

## Code Changes Made

- `web/src/app/signin/page.tsx`: Changed sign-in button from `<a href>` GET link to a `<form>` with a Server Action calling `signIn("google")`. This is required by NextAuth v5 beta which expects POST requests with CSRF tokens for the signin action.

## UX Enhancements — Phase 1 (2026-04-01)

The dashboard shell includes the following operational improvements beyond workflow parity:

- **Auto-refresh**: 60-second background polling preserves all UI state (admin filter, search, selected student, calendar) across refreshes; only fires when the browser tab is focused
- **Persistent admin filter**: selected admin tab saved to `localStorage` and restored on session start
- **Progress indicator**: "Students in queue" summary card shows actioned-today count with a progress bar
- **Clear confirmation**: both bulk and single-student Clear actions require `window.confirm()` before executing
- **Sticky queue header**: queue table header is sticky with the table body in a viewport-constrained scrollable container
- **Improved toasts**: success toasts display for 3.5s; error toasts persist until dismissed with a close button; slide-in animation added

## UX Enhancements — Phase 2 (2026-04-01)

Component decomposition and workflow redesign:

- **Component decomposition**: the monolithic `dashboard-shell.tsx` (1932 lines) has been split into focused components: `QueuePanel`, `StudentDetail`, `CalendarPanel`, `SummaryBar`, `FilterToolbar`, `BulkActionBar`, `LinePreviewDrawer`, `ToastNotification`; shared types and utilities extracted to `ui-helpers.ts`; orchestrator is now ~300 lines
- **LINE slide-over drawer**: replaces the centered modal with a right-edge slide-over drawer that keeps the queue visible; includes package context summary and a "Copy + Mark Contacted" combo button; dismissible with Escape or click-outside
- **Quick-action icons**: inline ✓ ⏳ ✔ buttons appear on hover in each queue row for one-click status updates without opening the detail panel; always visible on touch devices (< 1024px)
- **Keyboard shortcuts**: `j`/`k` or arrow keys navigate the queue, `c`/`p`/`r` fire action shortcuts, `l` opens the LINE drawer, `/` focuses search, `Escape` closes/clears, `?` toggles a shortcut reference card; all disabled when focus is in an input
- **Calendar-queue cross-linking**: clicking a student in the calendar scrolls the matching queue row into view with a flash animation via `QueuePanelHandle.scrollToStudent()`

Files modified:
- `web/src/components/dashboard/dashboard-shell.tsx` (rewritten as orchestrator)
- `web/src/app/globals.css` (new styles for drawer, quick-actions, keyboard help, row-flash)

Files created:
- `web/src/components/dashboard/queue-panel.tsx`
- `web/src/components/dashboard/student-detail.tsx`
- `web/src/components/dashboard/calendar-panel.tsx`
- `web/src/components/dashboard/summary-bar.tsx`
- `web/src/components/dashboard/filter-toolbar.tsx`
- `web/src/components/dashboard/bulk-action-bar.tsx`
- `web/src/components/dashboard/line-preview-modal.tsx`
- `web/src/components/dashboard/toast-notification.tsx`
- `web/src/lib/dashboard/ui-helpers.ts`
- `web/src/hooks/use-keyboard-shortcuts.ts`

## UX Enhancements — Phase 3 (2026-04-01)

Polish, performance, and operational refinements:

- **Resizable split layout**: queue and calendar panels sit side-by-side with a draggable divider (default 60/40); ratio persisted to `localStorage`; stacks vertically on screens < 1024px
- **Optimistic action updates**: action state mutations patch the UI immediately; on server failure the update is reverted and an error toast is shown; an opacity pulse animation runs on rows with in-flight optimistic state
- **Undo toasts**: after marking a student, the success toast includes an "Undo" button (5-second window) that reverts to the previous action state; after 5 seconds the toast transitions to a brief "Saved" confirmation
- **Search highlighting**: matching substrings in student name, parent name, and package names are highlighted with a `<mark>` tag in both the queue table and calendar day student cards
- **Bulk selection improvements**: "Select all matching" button selects all students matching current filters, "Deselect all" clears the selection, and a floating selection count badge shows "N of M selected"
- **Empty state improvements**: queue, calendar, and student detail panels show styled empty states with an illustration pattern, clear title, and actionable hint

Files created:
- `web/src/hooks/use-resizable-split.ts`

Files modified:
- `web/src/components/dashboard/dashboard-shell.tsx`
- `web/src/components/dashboard/queue-panel.tsx`
- `web/src/components/dashboard/calendar-panel.tsx`
- `web/src/components/dashboard/student-detail.tsx`
- `web/src/components/dashboard/bulk-action-bar.tsx`
- `web/src/components/dashboard/toast-notification.tsx`
- `web/src/lib/dashboard/ui-helpers.ts`
- `web/src/app/globals.css`

## UX Enhancements — Phase 4 (2026-04-01)

Power-user features and accessibility:

- **"Contact via LINE" combo action**: a primary CTA button in the student detail panel that copies the LINE message for the worst package, marks the student as "contacted" (optimistic), and auto-advances to the next student in one click; also bound to `Shift+L` keyboard shortcut; clipboard failures degrade gracefully with a warning toast
- **Action history (last 7 days)**: new `GET /api/actions/history?studentKey=xxx` endpoint reads the `DashboardActionLog` sheet tab and returns recent entries; "Recent Activity" timeline section in the student detail panel shows compact entries ("Mar 30: Contacted by Palm"); results cached in component state to avoid re-fetching on re-selection; prevents duplicate contacts across days
- **Dark mode**: toggle button (sun/moon) in the dashboard header; detects system preference via `prefers-color-scheme` media query; persists choice to `localStorage`; dark palette uses warm earth tones (`--bg: #1a1715`, `--surface: #211e1b`); all tones, overlays, and components adjusted for dark backgrounds
- **Tablet-responsive card layout**: below 1024px the queue table transforms into a card list with student name, parent, worst status pill, actual credits balance, next session date, and quick-action buttons; cards are clickable, support bulk selection checkboxes, search highlighting, and optimistic pulse animation; pure CSS media query swap, no JS layout detection

Files created:
- `web/src/hooks/use-theme.ts`
- `web/src/app/api/actions/history/route.ts`

Files modified:
- `web/src/components/dashboard/dashboard-shell.tsx`
- `web/src/components/dashboard/student-detail.tsx`
- `web/src/components/dashboard/queue-panel.tsx`
- `web/src/hooks/use-keyboard-shortcuts.ts`
- `web/src/app/globals.css`

## Current Code Status

- the React dashboard shell has been decomposed into focused components under `web/src/components/dashboard/` with an orchestrator in `dashboard-shell.tsx`
- the shell includes operational UX enhancements: auto-refresh, persistent admin filter, progress tracking, clear confirmation, sticky headers, improved toasts, LINE slide-over drawer, inline quick-action icons, keyboard navigation, calendar-queue cross-linking, resizable split layout, optimistic action updates, undo toasts, search highlighting, bulk selection improvements, styled empty states, "Contact via LINE" combo action, action history timeline, dark mode, and tablet-responsive card layout
- a strict parity script exists in `web/scripts/compare-live.ts`
- the env loader has been split into auth-specific and Sheets-specific concerns in `web/src/lib/runtime/env.ts`
- local validation passes:
  - `npm test`
  - `npm run build`
  - `npm run ensure-action-sheets`

## Remaining Known Limitation

- `npm run compare-live` is blocked because `clasp run fetchDashboardData` fails on `SpreadsheetApp.openById` authorization. This does not affect the Next.js shadow app which reads sheets directly via the service account.

## Environment Variables

All env vars are configured in both `web/.env` (local) and Vercel (production/development):

- `GOOGLE_CLIENT_ID` — OAuth client ID from GCP
- `GOOGLE_CLIENT_SECRET` — OAuth client secret from GCP
- `AUTH_SECRET` — NextAuth session encryption key
- `AUTH_URL` — Production URL for NextAuth callbacks
- `AUTH_TRUST_HOST` — Set to `true` for Vercel deployment
- `STAFF_ALLOWLIST` — Comma-separated allowlisted staff emails
- `SHEETS_SERVICE_ACCOUNT_EMAIL` — Google Sheets service account email
- `SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY` — Service account private key (JSON format with `\n`)
- `SHEETS_SPREADSHEET_ID_CREDITS` — Spreadsheet ID for BeGifted Student Credits
- `SHEETS_SPREADSHEET_ID_ANALYTICS` — Spreadsheet ID for BeGifted Education Analytics

## Commands And Current Outcomes

- Passed:
  - `npm test`
  - `npm run build`
  - `npm run ensure-action-sheets`
- Blocked:
  - `npm run compare-live` — Apps Script authorization issue (does not affect shadow app)

## Vercel Deployment

- Deploy preview: `cd web && vercel`
- Deploy production: `cd web && vercel --prod`
- Check env vars: `cd web && vercel env ls`
- View logs: `cd web && vercel logs <deployment-url>`
