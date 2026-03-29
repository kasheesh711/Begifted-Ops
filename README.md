# BeGifted Ops

Package expiry alert dashboard for BeGifted Education, built as a shared Google Apps Script project and managed in GitHub.

This app gives admin staff a live view of which students are close to exhausting prepaid tutoring credits, which packages need immediate follow-up, what changed since the previous review, and which risk drivers deserve attention.

Read [`docs/app-overview.md`](docs/app-overview.md) before changing business logic. It summarizes the product purpose, sheet dependencies, status model, and known PRD-versus-code gaps.

## Current Product Surfaces

The live app is now organized into three primary surfaces:

- `Command Center`: action KPIs, prioritized package queue, and contextual risk brief for the selected package
- `Analytics`: trend, segment, and planning views derived from the current sheet data plus stored comparison snapshots
- `Student Detail`: package-level balance waterfall, projection, data-quality warnings, and communication support

## Working Model

This repository is optimized for parallel agent-assisted development with Claude and Codex.

- GitHub Issues are the source of truth for non-trivial work.
- `main` is treated as protected and changes land through pull requests.
- One issue maps to one branch and one PR.
- Agents must document ownership, touched files, validation, deployment impact, and blockers.

The shared workflow lives in [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Repository Layout

- `Code.gs`: server-side Apps Script logic.
- `Validation.gs`: fixture-based validation runner for package-rule logic and analytics helpers.
- `dashboard.html`: client-side command center, analytics workspace, and student detail UI.
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

The validation suite now covers both package-rule behavior and dashboard analytics helpers such as priority ranking, data-quality flags, and summary delta calculations.

## Development Rules

- Start non-trivial work from a GitHub Issue.
- Use branch names like `feature/<issue-or-short-name>`, `fix/<issue-or-short-name>`, and `docs/<issue-or-short-name>`.
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
