# Agent Instructions

Follow the shared process in [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

This file is the Codex-facing and general agent operating guide for this repository.

## Default Execution Rules

- Use GitHub Issues as the source of truth for non-trivial work.
- Before editing, identify likely write scope and avoid overlapping changes with other active agents.
- Keep one branch and one PR per issue or workstream.
- Prefer smaller, composable PRs when file ownership overlaps.

## Shared Project Rules

- `.clasp.json` and `appsscript.json` are part of the repo baseline and should stay in sync with the shared Apps Script project.
- `.clasprc.local.json` is ignored and must remain local-only.
- Record deployment impact in every substantial PR or handoff, even if no deployment is performed.

## Documentation Rules

- Update `README.md`, `docs/WORKFLOW.md`, or tool-specific docs in the same PR whenever the change affects setup, structure, deployment, or collaboration policy.
- Do not leave undocumented workflow changes for a later cleanup PR.

## Handoff Rules

Use the shared handoff template in [`docs/WORKFLOW.md`](docs/WORKFLOW.md) whenever pausing, delegating, or leaving partial work for another human or agent.
