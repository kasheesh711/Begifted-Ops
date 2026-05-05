# Workflow

## Purpose

This repository is set up for parallel work by humans and coding agents. GitHub provides task tracking and review. Claude and Codex follow the same core workflow, then use their own tool-specific instruction files for execution details.

## Source Of Truth

- GitHub Issues are the source of truth for non-trivial tasks.
- Every non-trivial implementation change starts from an issue.
- Tiny typo or maintenance-only changes may skip issue creation, but still require a PR if they touch `main`.

## Branching

- Create branches from `main`.
- Use one branch per issue or workstream.
- Naming:
  - `feature/<issue-or-short-name>`
  - `fix/<issue-or-short-name>`
  - `docs/<issue-or-short-name>`

## Parallel Work

- Agents must announce ownership in the issue or PR before starting.
- Ownership should list the file areas the agent expects to modify.
- Parallel work is preferred only when write scopes are disjoint.
- If work overlaps, split into smaller sequential PRs instead of racing on the same files.
- Rebase or merge from `main` before opening or updating the PR when the base moved.
- Prefer backend ownership at the `.gs` file level instead of claiming the entire Apps Script layer.
- Current backend ownership slices are `Code.gs` for bootstrap, `DashboardDataLoading.gs` for sheet access, `DashboardPackages.gs` plus `DashboardProjection.gs` for package rules, `DashboardAnalytics.gs` for queue/calendar shaping, `DashboardState.gs` for cache and snapshot storage, `DashboardActions.gs` for student action-state persistence, and `SharedHelpers.gs` for cross-cutting helpers.

## Pull Requests

- One issue maps to one PR unless the issue is intentionally split.
- `main` receives changes only through reviewed PRs.
- Squash merge is the default merge strategy.
- Each PR must include:
  - linked issue
  - change summary
  - touched files or ownership area
  - validation performed
  - deployment impact
  - documentation updates
  - handoff notes and blockers

## Documentation Updates

Documentation updates are required in the same PR whenever the change affects:

- setup or onboarding
- deployment or Apps Script workflow
- repo structure
- agent operating rules
- GitHub workflow or review expectations
- validation entrypoints or audit workflow
- async bootstrap, cache transport, or web app load-path behavior
- operator-facing command-center behavior such as queue filtering, bulk follow-up state, calendar navigation, triage flow, or selected-day detail patterns
- `web/` setup, auth, cache behavior, parity tooling, or shadow rollout status

## Apps Script Rules

- `.clasp.json` and `appsscript.json` are shared and tracked in Git.
- `.clasprc.local.json` is local-only and must never be committed.
- Use the shared Apps Script project unless the issue explicitly calls for an isolated test project.
- Record deployment impact in the PR even if no deployment was performed.
- Treat `SharedHelpers.gs` as a cross-cutting ownership area and avoid unrelated helper edits in otherwise isolated backend workstreams.
- The server source is split across multiple tracked `.gs` files; do not collapse new backend work back into a monolithic `Code.gs`.
- Treat `DashboardActions.gs` as a stateful ownership area; when changing it, verify cache invalidation and same-day visibility behavior instead of editing it incidentally.
- For web app changes, distinguish between source push and web app release:
  - `clasp push` updates the Apps Script project source.
  - `clasp deploy` creates or updates a versioned web app deployment.
- If a versioned web app URL still shows stale behavior after an apparent push, verify the remote project state and use `clasp push --force` before creating a fresh deployment.
- If a web app incident shows `Dashboard data unavailable`, `HTTP -1`, or chunk-transfer errors after a source fix, verify the deployment version in addition to the pushed source before assuming the code change failed.
- When backend changes affect balance logic, source-sheet contracts, or dashboard payload accuracy, run `clasp run runValidationSuite`.
- When backend changes affect student action-state persistence, actor attribution, or same-day visibility rules, run `clasp run runValidationSuite` and update the product docs in the same PR.
- When changing async bootstrap or chunked transfer behavior, add or update regression coverage for both warm-cache and cold-cache load paths before deploying.
- When a change affects live sheet parity, also run `clasp run runLiveAccuracyAudit` after the shared Apps Script project has been authorized for Google Sheets access.
- If `clasp run` returns a `SpreadsheetApp.openById` permission error, reauthorize the shared Apps Script project in the Apps Script editor before treating the audit runner as broken.

## Migration Handoffs

When work touches the Next.js shadow app in `web/`, the handoff must distinguish between:

- code complete locally
- blocked on secrets or auth
- blocked on live parity
- blocked on preview deployment

Do not leave migration status implicit. The next agent should be able to tell whether the blocker is code, credentials, Apps Script authorization, or Vercel setup without reopening prior chat history.

## Handoff Format

Use this format in the PR body, issue comment, or handoff note:

```md
## Handoff

- Issue: #<id>
- Branch: <branch-name>
- Status: <ready for review | blocked | partial | ready for next agent>
- Files touched: <paths or ownership area>
- Validation: <what was checked>
- Deployment impact: <none | Apps Script push needed | deployment updated>
- Shadow status: <not touched | local-only complete | blocked on secrets/auth | blocked on parity | blocked on preview deployment>
- Local validation: <commands and outcomes>
- External blockers: <none or explicit blocker>
- Pending setup actions: <none or explicit setup steps>
- Next step: <next recommended action>
- Blockers: <none or explicit blocker>
```

## Labels

Use these labels to make issue routing agent-friendly:

- `agent-ready`
- `blocked`
- `docs`
- `apps-script`
- `frontend`
- `backend/data`
- `handoff`
- `urgent`
