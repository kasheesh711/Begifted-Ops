# Agent Instructions

Follow the shared process in [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

This file is the Codex-facing and general agent operating guide for this repository.

## Default Execution Rules

- Use GitHub Issues as the source of truth for non-trivial work.
- Before editing, identify likely write scope and avoid overlapping changes with other active agents.
- Keep one branch and one PR per issue or workstream.
- Prefer smaller, composable PRs when file ownership overlaps.
- For backend work, claim ownership by `.gs` slice rather than "server logic" broadly whenever possible.
- Treat `DashboardActions.gs` as its own stateful ownership slice when a task touches student follow-up state.
- Treat `web/` as an active ownership area for migration work instead of assuming the repo is Apps Script-only.

## Shared Project Rules

- `.clasp.json` and `appsscript.json` are part of the repo baseline and should stay in sync with the shared Apps Script project.
- `.clasprc.local.json` is ignored and must remain local-only.
- Record deployment impact in every substantial PR or handoff, even if no deployment is performed.
- Keep backend logic split across the tracked `.gs` files; do not reintroduce a monolithic `Code.gs`.
- For web app changes, call out both the Apps Script source push state and whether a fresh versioned deployment was created.
- When debugging live web app failures, treat `HTTP -1` and chunk-transfer errors as deploy-state questions first, not just source-state questions.
- When changing balance logic or sheet-driven payload behavior, run `clasp run runValidationSuite`.
- When changing student action-state persistence or visibility behavior, also run `clasp run runValidationSuite`.
- When changing async bootstrap or chunked transfer logic, extend validation coverage for warm-cache and cold-cache load paths instead of relying on manual smoke tests alone.
- When changing live sheet parity or diagnostics, run `clasp run runLiveAccuracyAudit` after the shared script has been authorized for Google Sheets access.
- If a live Apps Script check fails on `SpreadsheetApp.openById`, treat it as an authorization blocker first and note that in the handoff.
- When migration work touches `web/`, report both Apps Script status and Next.js shadow status in the handoff.
- Treat auth, env, service-account, and Vercel-linking blockers as first-class handoff items; do not assume another agent will infer them.

## Documentation Rules

- Update `README.md`, `docs/WORKFLOW.md`, or tool-specific docs in the same PR whenever the change affects setup, structure, deployment, or collaboration policy.
- Update product-facing docs in the same PR whenever the command-center interaction model changes, especially queue filters, bulk follow-up state, calendar navigation, triage shortcuts, or selected-day detail behavior.
- Update migration docs in the same PR whenever `web/` setup, auth, cache, parity tooling, or rollout status changes.
- Do not leave undocumented workflow changes for a later cleanup PR.

## Handoff Rules

Use the shared handoff template in [`docs/WORKFLOW.md`](docs/WORKFLOW.md) whenever pausing, delegating, or leaving partial work for another human or agent.
