# BeGifted Ops

Package expiry alert dashboard for BeGifted Education, built as a shared Google Apps Script project and managed in GitHub.

This app gives admin staff a live view of which students are close to exhausting prepaid tutoring credits, which students need immediate follow-up, and when those students are scheduled to turn up next.

Read [`docs/app-overview.md`](docs/app-overview.md) before changing business logic. It summarizes the product purpose, sheet dependencies, status model, and known PRD-versus-code gaps.

## Runtime Notes

The dashboard now uses an async bootstrap path instead of embedding the full data payload into the initial HTML response.

- `doGet()` returns the shell immediately so operators see the UI without waiting for spreadsheet reads.
- `dashboard.html` loads the data asynchronously through Apps Script and shows explicit loading or retry states while the payload is in flight.
- the Apps Script backend caches the computed dashboard payload in chunked `CacheService` entries for 2 minutes so warm refreshes can reuse the same payload
- snapshot history and delta baselines are only persisted during a fresh recompute, not on cache hits

## Current Product Surfaces

The live app is now organized into two primary surfaces:

- `Command Center`: student-level prioritized queue plus a month/week/day calendar that expands daily schedule detail
- `Student Detail`: package-level balance waterfall, projection, data-quality warnings, and communication support

## Working Model

This repository is optimized for parallel agent-assisted development with Claude and Codex.

- GitHub Issues are the source of truth for non-trivial work.
- `main` is treated as protected and changes land through pull requests.
- One issue maps to one branch and one PR.
- Agents must document ownership, touched files, validation, deployment impact, and blockers.

The shared workflow lives in [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Repository Layout

- `Code.gs`: shared constants plus web-app entrypoints and async payload bootstrap.
- `DashboardDataLoading.gs`: sheet adapters and required-column validation.
- `DashboardPackages.gs`: active-student filtering, exclusion rules, pending deductions, package assembly, and action helpers.
- `DashboardAnalytics.gs`: package scoring, student-level queue aggregation, calendar shaping, summary metrics, and snapshot persistence helpers.
- `DashboardState.gs`: snapshot persistence and chunked cache helpers.
- `DashboardProjection.gs`: balance projection and status evaluation helpers.
- `SharedHelpers.gs`: generic spreadsheet, date, and parsing utilities used across backend files.
- `Validation.gs`: fixture-based validation runner for package-rule logic, student queue aggregation, calendar grouping, and cache helpers.
- `dashboard.html`: client-side command center and student detail UI.
- `appsscript.json`: shared Apps Script manifest and web app settings.
- `.clasp.json`: shared binding to the team Apps Script project.
- `CLAUDE.md`: Claude-specific repo instructions.
- `AGENTS.md`: Codex and general agent operating guidance.
- `docs/WORKFLOW.md`: shared collaboration, branching, PR, and handoff rules.

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

The validation suite now covers:

- package-rule behavior
- student queue aggregation, priority ranking, calendar grouping, and summary delta calculations
- payload cache miss and cache hit behavior
- chunked cache round-trips for large payloads
- chunked transport manifest and chunk reconstruction helpers

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
