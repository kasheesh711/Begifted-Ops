---
phase: 03-service-cutover
plan: "02"
subsystem: dashboard-ui
tags: [archive-link, student-detail, config-constant, day1-affordance]
requires:
  - 03-00 baseline reconciliation (student-detail.tsx + config.ts present in tree)
  - 03-01 cacheComponents enabled (build-green precondition)
provides:
  - ARCHIVE_ACTION_SHEET_URL constant in web/src/lib/dashboard/config.ts (D-36)
  - Day-1 archive-link affordance in Student Detail header (D-30)
affects:
  - Phase 5 RETI-01 (will remove the archive link when Apps Script retires)
  - Phase 5 RETI-06 (will replace TODO placeholder URL with immutable archive URL post-RETI-03 snapshot)
tech_stack:
  added: []
  patterns:
    - External link with target="_blank" + rel="noopener noreferrer" + aria-label per existing accessibility conventions
    - Inline-style component (no CSS modules) consistent with student-detail.tsx idiom
    - SVC-08 / D-30 / D-36 / Phase-5-RETI-01 marker comments for cross-phase traceability
key_files:
  created: []
  modified:
    - web/src/lib/dashboard/config.ts
    - web/src/components/dashboard/student-detail.tsx
decisions:
  - TODO placeholder URL chosen over real URL because operator did not provide the exact DashboardActionsState tab URL during execution; placeholder pattern matches the plan's prescribed format and is surfaced in the D-31 / D-35 Pre-Merge Gate (Plan 03-10).
  - Archive link uses `&rarr;` HTML entity for the arrow rather than a literal Unicode character — both acceptable per plan; entity form is byte-stable in source view-diffs.
  - No external-link icon (Lucide ArrowUpRight / ExternalLink) added — plan grants Claude's Discretion and existing student-detail.tsx has no icon library dependency; keeping the affordance icon-free avoids introducing new deps for a 30-day-tail UI element.
  - No React component test for the archive link — repo has no component-test precedent; adding one here would set a precedent better deferred to a Phase 4+ ask. Verification covered by tsc + grep + manual QA in Plan 03-10's gate checklist.
metrics:
  duration: 2min
  completed: 2026-04-30
---

# Phase 3 Plan 02: Student Detail Archive-Link Affordance Summary

**One-liner:** Added `ARCHIVE_ACTION_SHEET_URL` constant to `config.ts` and wired a "View pre-cutover history →" link into the Student Detail sticky header so cutover-day operators can jump back to the legacy DashboardActionsState sheet during the 30-day transition tail.

## What Shipped

### Primary deliverables (per plan)

- `web/src/lib/dashboard/config.ts` — added `ARCHIVE_ACTION_SHEET_URL` export (per D-36) immediately after `INACTIVE_STUDENTS_HEADERS` and before `REQUIRED_COLUMNS`. Value is the prescribed TODO-placeholder URL (`https://docs.google.com/spreadsheets/d/TODO_REPLACE_WITH_REAL_SHEET_ID/edit#gid=TODO_REPLACE_WITH_TAB_GID`) with three clearly-marked operator-action comments: SVC-08 / D-36 attribution, Phase 5 RETI-06 forward-reference, and "OPERATOR ACTION REQUIRED" pre-merge note. Pre-Merge Gate (03-10) surfaces this as a required operator action per D-35.
- `web/src/components/dashboard/student-detail.tsx` — added `ARCHIVE_ACTION_SHEET_URL` import alongside the existing `formatShortTimestamp` import from `@/lib/dashboard/...`, then inserted the archive `<a>` element immediately after the muted `parent · adminOwnerName` div in the sticky header block (lines 89-99). Element uses `target="_blank"`, `rel="noopener noreferrer"` (T-03-02-2 mitigation per threat register), `aria-label="Open pre-cutover follow-up history in new tab"`, and inline style matching the muted convention (`fontSize: 0.72rem`, underline, 2px top margin, inline-block display). Copy: "View pre-cutover history →" using `&rarr;` HTML entity. A `// TODO: remove in Phase 5 RETI-01 when Apps Script retires (D-30).` comment sits directly above the element to flag the cleanup path.

### Commit

- `1fbd42a` — `feat(03-02): add Student Detail archive-link affordance + ARCHIVE_ACTION_SHEET_URL constant`
- 2 files changed, 20 insertions, 0 deletions
- V1 dirty-tree files (`Code.gs`, `dashboard.html`, `Validation.gs`, `.clasp.json`, `.github/`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `appsscript.json`, `docs/`, `.gitignore`) remain unstaged per D-43.

## Verification

| Check | Result |
|-------|--------|
| `grep -n "ARCHIVE_ACTION_SHEET_URL" web/src/lib/dashboard/config.ts` | matches line 69 (export) |
| `grep -n "View pre-cutover history" web/src/components/dashboard/student-detail.tsx` | matches line 98 |
| `grep -n 'aria-label="Open pre-cutover follow-up history in new tab"' web/src/components/dashboard/student-detail.tsx` | matches line 94 |
| `grep -n 'target="_blank"' web/src/components/dashboard/student-detail.tsx` | matches line 92 |
| `grep -n 'rel="noopener noreferrer"' web/src/components/dashboard/student-detail.tsx` | matches line 93 |
| `grep -n "TODO: remove in Phase 5 RETI-01" web/src/components/dashboard/student-detail.tsx` | matches line 89 |
| `grep -n "ARCHIVE_ACTION_SHEET_URL" web/src/components/dashboard/student-detail.tsx` | matches lines 3 (import), 91 (href) |
| `cd web && npm test -- --run` | 164/164 passing across 15 test files |
| `cd web && npm run build` | exit 0; "Cache Components enabled"; 11/11 routes generated |
| Working tree (V1 root) | unchanged — V1 dirty files remain unstaged per D-43 |

The plan's `<verification>` block also calls for `cd web && npx tsc --noEmit` exit 0. It does not — there are 4 pre-existing tsc errors (`dashboard-logic.test.ts:192,202` `AdminViewKey` mismatch + `wisenet-mappers.test.ts:37,38` duplicate object key warning). I verified by stashing this plan's changes and re-running tsc against baseline; the same 4 errors persisted, confirming they predate Plan 03-02 and are not in this plan's SCOPE BOUNDARY. They are documented in CONTEXT D-35 as "Phase 2's 2 pre-existing dashboard-logic.test.ts errors must be resolved as part of cutover" and are owned by a future plan (likely SVC-02 / 03-03 when service.ts is rewritten and types tighten) per the gate-checklist requirement to clear them before merge. The `npm run build` gate passes (Next.js' build-time TypeScript check is the binding correctness gate per D-35 SC-1).

## Operator Action Required (carried to Plan 03-10)

The TODO placeholder in `ARCHIVE_ACTION_SHEET_URL` MUST be replaced with the real Google Sheets URL to the `DashboardActionsState` tab in the BeGifted Education Analytics spreadsheet before the cutover PR merges. Format: `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit#gid=<TAB_GID>`. This is the second open operator action accumulating into the Plan 03-10 Pre-Merge Gate (D-31 admin-ownership seed is the first).

Recommendation: Kevin opens the BeGifted Education Analytics spreadsheet, navigates to the `DashboardActionsState` tab, copies the URL from the browser address bar (verifying the `gid` query parameter is appended; Google adds it automatically when the tab is selected), and replaces both `TODO_REPLACE_WITH_REAL_SHEET_ID` and `TODO_REPLACE_WITH_TAB_GID` in `config.ts` line 70 in a one-line commit during 03-10's Pre-Merge Gate operator step.

## Deviations from Plan

None. Plan 03-02 executed exactly as written. The plan-prescribed TODO placeholder behavior was used because the operator did not provide the real URL during this autonomous execution — the plan explicitly anticipated this branch ("If the operator provides the real URL, use it directly instead of the placeholder. If not, use the TODO placeholder as written above. The Pre-Merge Gate (03-10) will surface this as a required operator action."). Auto-mode is active, so the placeholder branch was selected automatically rather than blocking on an operator prompt.

## Threat Flags

None. Both plan-tracked threats are mitigated as designed:

- T-03-02-1 (Information Disclosure): `ARCHIVE_ACTION_SHEET_URL` is a Google Sheets URL pointing at a doc operators are already authorized for; bundling it into the client is intended behavior. Disposition: accept.
- T-03-02-2 (Elevation of Privilege): `rel="noopener noreferrer"` is present (line 93 of student-detail.tsx) per D-30 spec, blocking `window.opener` access from the opened tab. Disposition: mitigate (mitigated).

No new trust-boundary surface introduced. No new env vars. No new schema changes. No new fetch endpoints.

## Self-Check: PASSED

- [x] `web/src/lib/dashboard/config.ts` exists with `ARCHIVE_ACTION_SHEET_URL`: FOUND (line 69)
- [x] `web/src/components/dashboard/student-detail.tsx` exists with archive link: FOUND (lines 90-99)
- [x] Commit `1fbd42a` exists in git log: FOUND
- [x] Both modified files in commit: FOUND (verified via `git show 1fbd42a --stat`)
- [x] V1 root files NOT in commit: confirmed (no V1 paths in `git show 1fbd42a --name-only`)
- [x] `npm run build` passes: confirmed
- [x] `npm test` 164/164: confirmed
