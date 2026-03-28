# Claude Instructions

Follow [`docs/WORKFLOW.md`](docs/WORKFLOW.md) as the shared collaboration policy.

## Repo Expectations

- Start from a GitHub Issue for non-trivial work.
- State planned file ownership before implementation when work may overlap.
- Keep one branch and one PR per issue.
- Update docs in the same PR when setup, deployment, or workflow changes.

## Apps Script

- Use the tracked `.clasp.json` and `appsscript.json` as the shared project baseline.
- Never commit `.clasprc.local.json` or any credential material.
- Call out Apps Script push or deployment impact clearly in the PR.

## Handoffs

When stopping mid-task, leave a concise handoff using the shared format in [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Review Standard

- Prefer small PRs with a clear issue link.
- Include validation evidence, even when validation is manual.
- If a change affects team workflow, update the docs before handing off.
