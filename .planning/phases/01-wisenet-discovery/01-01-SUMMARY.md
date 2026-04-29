---
phase: 01-wisenet-discovery
plan: 01
subsystem: infra
tags: [bash, posix, validator, fixtures, env-config, phase-scaffolding]

# Dependency graph
requires: []
provides:
  - POSIX bash validator script (16 assertions) executable before any Phase 1 probe runs
  - Fixture capture directory tree `.planning/research/fixtures/wisenet/` (+ `_errors/`) with .gitkeep files
  - Probe-script provenance README documenting D-10/D-11/D-12 safety + 5 WISENET_* env var names
  - Documented WISENET_* env var placeholders in `web/.env.example` (no secrets)
  - `web/.gitignore` negation so `.env.example` is tracked while real `.env` files stay ignored
affects: [01-02-PLAN, 01-03-PLAN, 01-04-PLAN, 01-05-PLAN, 02-data-layer]

# Tech tracking
tech-stack:
  added:
    - bash 3.2-compatible validator scaffolding (no bash-4 features)
    - awk-based markdown table row counter (portable on macOS default awk)
  patterns:
    - Wave-tolerant SKIP semantics in validator (file not yet present = SKIP, not FAIL)
    - Assertion decomposition into reusable `_pass`/`_fail`/`_skip`/`_warn` helpers
    - PHASE_ROOT resolved from $0 so validator is CWD-agnostic
    - Gitignore negation (`!.env.example`) to keep docs tracked while real env stays ignored

key-files:
  created:
    - .planning/phases/01-wisenet-discovery/validate-phase1.sh
    - .planning/research/fixtures/wisenet/.gitkeep
    - .planning/research/fixtures/wisenet/_errors/.gitkeep
    - web/scripts/README-wisenet-probes.md
    - web/.env.example (appended; previously untracked)
    - web/.gitignore (appended `!.env.example` negation; previously untracked)
  modified: []

key-decisions:
  - "Wave-tolerant validator: SKIP-not-FAIL when target files from later waves do not exist yet, so Phase 1 stays green during Waves 1-3 incremental builds"
  - "assert_per_tab_row_counts is the binding per-tab check (5/8/5/2/3/2) — closes B-2 gap where Student Name in 4 tabs masked missing rows under a whole-document grep"
  - "High-entropy-string assertion emits WARN (not FAIL) — Kevin eyeball-reviews per VALIDATION.md manual-check list; validator does not echo matched strings back to stdout (T-1-02 mitigation)"
  - "Gitignore negation for .env.example — keeps documented template tracked while .env / .env.local / .env.<real> stay ignored"

patterns-established:
  - "Validator script lives at .planning/phases/<phase>/validate-phase<N>.sh — a convention other phases can follow"
  - "Fixture directories carry .gitkeep + _errors/.gitkeep scaffolding per D-11 error-capture contract before any probe runs"
  - "Probe README documents provenance, env vars, safety rules, and lifecycle so Phase 2 readers know why research scripts linger in web/scripts/"

requirements-completed: []  # Scaffolding plan — frontmatter requirements: [] is intentional per plan header

# Metrics
duration: ~15min
completed: 2026-04-21
---

# Phase 01 Plan 01: Phase 1 Wave-0 Infrastructure Summary

**POSIX bash validator, fixture scaffolding, probe-script provenance README, and WISENET_* env placeholders landed — downstream Plans 02-05 can now reference `validate-phase1.sh` and write into existing fixture directories without ENOENT.**

## Performance

- **Duration:** ~15 minutes
- **Started:** 2026-04-21 (local)
- **Completed:** 2026-04-21 (local)
- **Tasks:** 2 of 2 complete
- **Files created:** 6 (4 per Task 1 plus 2 per Task 2 including the .gitignore negation)

## Accomplishments

- Phase 1 validator script is in place and executable. Runs in ~1 second and currently reports `0 passed, 0 failed, 14 skipped, 1 warning` under `--quick` mode — all skips are legitimate (target files land in Waves 1-4). Exit 0 cleanly.
- Implemented 16 assertion functions (exceeds the planned 14): `field_map_exists`, `endpoints_exists`, `field_map_has_six_sections`, `all_25_required_columns_present`, `per_tab_row_counts` (binding B-2 fix), `every_row_classified_green_yellow_red`, `every_row_cites_postman_or_fixture`, `red_rows_have_structured_blocks`, `red_decision_allowlist`, `endpoints_has_auth_section`, `endpoints_has_base_url`, `rate_limit_fingerprint_valid`, `pagination_fingerprint_valid`, `four_gap_questions_answered`, `no_secret_like_strings_in_tracked_research`, `fixtures_no_real_emails`.
- The binding per-tab check hardcodes the 5/8/5/2/3/2 REQUIRED_COLUMNS counts from `web/src/lib/dashboard/config.ts`, closing the gap where Student Name appearing in 4 tabs previously masked a missing row.
- Fixture tree scaffolded — `.planning/research/fixtures/wisenet/` (root) and `.planning/research/fixtures/wisenet/_errors/` (per D-11) each have a committable `.gitkeep`.
- Probe README explains the Phase 1 vs Phase 2 distinction, documents the 5 required env vars, reminds operators of the D-10 off-hours window (AEST evening / early AM), and lists D-11 (1s/2s/4s backoff, halt on repeat failure) and D-12 (read-only GETs, halt on 401/403) safety rules.
- `web/.env.example` now documents `WISENET_BASE_URL`, `WISENET_API_KEY`, `WISENET_USER_ID`, `WISENET_CENTER_ID` (all empty-value) plus `WISENET_NAMESPACE=begifted-education` (pre-locked by D-01). Existing `GOOGLE_*`, `AUTH_SECRET`, `STAFF_ALLOWLIST`, `SHEETS_*` lines are preserved.

## Task Commits

Each task was committed atomically, staged file-by-file (no `git add -A`):

1. **Task 1: validator + fixture dirs + probe README** — `a31439a` (feat)
   - Staged: `.planning/phases/01-wisenet-discovery/validate-phase1.sh`, `.planning/research/fixtures/wisenet/.gitkeep`, `.planning/research/fixtures/wisenet/_errors/.gitkeep`, `web/scripts/README-wisenet-probes.md`
2. **Task 2: WISENET_* env vars in .env.example + gitignore negation** — `c2f8926` (feat)
   - Staged: `web/.env.example`, `web/.gitignore` (Rule 3 blocking fix — see Deviations)

_No metadata commit yet — STATE/ROADMAP/REQUIREMENTS updates land after SUMMARY.md (see Final Commit below)._

## Files Created/Modified

- `.planning/phases/01-wisenet-discovery/validate-phase1.sh` — POSIX bash validator; 630 lines; 16 assertion functions; `--quick` flag; Wave-tolerant SKIPs; executable (`chmod +x`)
- `.planning/research/fixtures/wisenet/.gitkeep` — empty; directory root for Plans 02-04 probe output
- `.planning/research/fixtures/wisenet/_errors/.gitkeep` — empty; D-11 error-capture directory
- `web/scripts/README-wisenet-probes.md` — Phase 1 provenance doc; lifecycle, env vars, D-10/D-11/D-12 safety rules
- `web/.env.example` — 5 WISENET_* placeholders appended (prior 12 lines untouched)
- `web/.gitignore` — single-line addition `!.env.example` to negate the broad `.env.*` rule

## Verification Evidence

```bash
$ bash .planning/phases/01-wisenet-discovery/validate-phase1.sh --quick
Phase 1 validator — mode: quick
Repo root: /Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops
---
SKIP: field_map_exists (file not yet created)
SKIP: endpoints_exists (file not yet created)
SKIP: field_map_has_six_sections (field map not yet created)
SKIP: all_25_required_columns_present (field map not yet created)
SKIP: per_tab_row_counts (field map not yet created)
SKIP: every_row_classified_green_yellow_red (field map not yet created)
SKIP: every_row_cites_postman_or_fixture (field map not yet created)
SKIP: red_rows_have_structured_blocks (field map not yet created)
SKIP: red_decision_allowlist (field map not yet created)
SKIP: endpoints_has_auth_section (endpoints file not yet created)
SKIP: endpoints_has_base_url (endpoints file not yet created)
SKIP: rate_limit_fingerprint_valid (skipped in --quick mode (requires jq))
SKIP: pagination_fingerprint_valid (skipped in --quick mode (requires jq))
SKIP: four_gap_questions_answered (field map not yet created)
WARN: no_secret_like_strings_in_tracked_research — 429 high-entropy match(es) found — eyeball review required
OK: fixtures_no_real_emails — 0 non-synthetic emails in fixtures
---
Phase 1 validator: 1 passed, 0 failed, 14 skipped (total 15)
exit=0
```

The `WARN` line flags 429 high-entropy matches across `.planning/research/` — these are almost entirely in `.planning/research/wisenet-postman.json` (the Postman export, already tracked) and are benign (collection IDs, UUIDs, request hashes). Per T-1-02 mitigation, the validator prints counts + paths only, never the matched string. Kevin to eyeball-review per VALIDATION.md manual checks.

## Validator Invocation Cheat Sheet

```bash
# Quick run (no jq; runs after every task commit per VALIDATION.md sampling rate)
bash .planning/phases/01-wisenet-discovery/validate-phase1.sh --quick

# Full run (includes jq fingerprint assertions; runs after every wave + before /gsd-verify-work)
bash .planning/phases/01-wisenet-discovery/validate-phase1.sh
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `web/.gitignore` was ignoring `.env.example`**
- **Found during:** Task 2 (pre-commit `git status` check)
- **Issue:** `web/.gitignore` line 3 (`.env.*`) caught `web/.env.example` so the file Task 2 needed to track was hidden from git. Without this fix, Task 2's output cannot be committed and downstream plans cannot see the documented env var names.
- **Fix:** Added `!.env.example` negation rule immediately after the `.env.*` line. Real `.env` / `.env.local` stay ignored; only the committed template is un-ignored.
- **Files modified:** `web/.gitignore`
- **Commit:** `c2f8926` (bundled with Task 2; deviation note in the commit body)

### Non-Deviations Noted for Future Readers

- **Task 2's `grep -qE "[A-Za-z0-9_-]{24,}"` verify command produces non-zero exit.** Reason: the pre-existing variable *names* `SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY` (33 chars) and `SHEETS_SERVICE_ACCOUNT_EMAIL` (29 chars) already matched the regex before Task 2 ran. The plan's intent (T-1-01 — "no real credential values") is fully satisfied: the WISENET block I added contains zero high-entropy strings. The `grep` false-positive is a plan-writing nit (it didn't distinguish variable names from values). Task 2's 12 substantive acceptance criteria all pass; `.env.example` remains secret-free.

### Authentication Gates

None. This plan is autonomous and touches no network-facing code.

## Scaffolding Plan Marker

This plan does not advance any WISE-* requirement directly — `requirements: []` is intentional per the plan's `scaffolding: true` header comment. Requirement coverage breakdown:

- Plans 02 (endpoint catalogue), 03 (field map), 04 (probes + RED rows), and 05 (validation + phase report) carry WISE-01..06.
- Plan 01 exists so those plans have a validator, fixture directories, probe README, and env.example in place before they need them.

## Confirmation That Subsequent Plans Can Reference the Validator

- [x] `validate-phase1.sh` is executable (`ls -l` shows `-rwxr-xr-x`) so Plans 02-05 can reference it by path without re-chmod-ing.
- [x] All 16 assertions exist and their target files are known — Plans 02-05 can each add content that flips SKIPs to OK:
  - Plan 02 (endpoints) → `endpoints_exists`, `endpoints_has_auth_section`, `endpoints_has_base_url` flip to OK
  - Plan 03 (field map) → `field_map_exists`, `field_map_has_six_sections`, `all_25_required_columns_present`, `per_tab_row_counts`, `every_row_classified_green_yellow_red`, `every_row_cites_postman_or_fixture` flip to OK (YELLOW/GREEN only at this stage)
  - Plan 04 (probes + RED) → `red_rows_have_structured_blocks`, `red_decision_allowlist`, `four_gap_questions_answered`, `rate_limit_fingerprint_valid`, `pagination_fingerprint_valid` flip to OK
  - Plan 05 (phase report) → runs full suite, confirms 0 fails

## Known Stubs

None. All created files are complete as scaffolding — they are not stubs waiting to be wired. The `.gitkeep` files are intentionally empty (standard git convention for tracking empty directories).

## Self-Check: PASSED

Verified post-SUMMARY-write:

```bash
$ [ -f .planning/phases/01-wisenet-discovery/validate-phase1.sh ] && echo FOUND
FOUND
$ [ -f .planning/research/fixtures/wisenet/.gitkeep ] && echo FOUND
FOUND
$ [ -f .planning/research/fixtures/wisenet/_errors/.gitkeep ] && echo FOUND
FOUND
$ [ -f web/scripts/README-wisenet-probes.md ] && echo FOUND
FOUND
$ [ -f web/.env.example ] && echo FOUND
FOUND
$ [ -f web/.gitignore ] && echo FOUND
FOUND
$ git log --oneline | grep -E "a31439a|c2f8926"
c2f8926 feat(01-01): document WISENET_* env vars in web/.env.example
a31439a feat(01-01): add Phase 1 validator, fixture dirs, and probe README
```

All 6 created files present; both task commits recorded in git history.
