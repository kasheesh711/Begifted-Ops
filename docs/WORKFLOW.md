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

## Apps Script Rules

- `.clasp.json` and `appsscript.json` are shared and tracked in Git.
- `.clasprc.local.json` is local-only and must never be committed.
- Use the shared Apps Script project unless the issue explicitly calls for an isolated test project.
- Record deployment impact in the PR even if no deployment was performed.

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
