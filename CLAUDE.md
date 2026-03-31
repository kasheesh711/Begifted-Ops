# Claude Instructions

Follow [`docs/WORKFLOW.md`](docs/WORKFLOW.md) as the shared collaboration policy.

## Repo Expectations

- Start from a GitHub Issue for non-trivial work.
- State planned file ownership before implementation when work may overlap.
- Keep one branch and one PR per issue.
- Update docs in the same PR when setup, deployment, or workflow changes.
- Prefer claiming a specific backend `.gs` ownership slice instead of the full Apps Script layer.

## Apps Script

- Use the tracked `.clasp.json` and `appsscript.json` as the shared project baseline.
- Never commit `.clasprc.local.json` or any credential material.
- Call out Apps Script push or deployment impact clearly in the PR.
- Keep backend logic split across the tracked `.gs` files instead of rebuilding a monolithic `Code.gs`.
- For web app changes, distinguish between source push completion and creation of a fresh versioned deployment.

## Handoffs

When stopping mid-task, leave a concise handoff using the shared format in [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Review Standard

- Prefer small PRs with a clear issue link.
- Include validation evidence, even when validation is manual.
- If a change affects team workflow, update the docs before handing off.
