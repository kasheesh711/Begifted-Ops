---
phase: 03-service-cutover
plan: "00"
subsystem: infra
tags: [git-baseline, prod-snapshot, sheets-era-routes, drizzle, wisenet, planning-artifacts]

# Dependency graph
requires:
  - phase: 02-data-layer
    provides: Phase 1+2 source files (wisenet client, drizzle schema/queries, mappers, tests, scripts, CI workflow) sitting uncommitted on disk under web/
provides:
  - 7 Sheets-era route handler / page files restored from prod-snapshot (web/src/app/api/* + web/src/app/signin/page.tsx) — Plan 03-05 baseline-to-swap target
  - Phase 1+2 source committed to git for the first time (97 files): wisenet client/types/mappers/retry, drizzle schema/queries/clients, dashboard logic ports, tests, ops scripts, CI workflow
  - .planning/ asymmetric state reconciled (72 files): PROJECT.md, REQUIREMENTS.md, config.json, codebase/, research/ (excluding gitignored postman dump), phase 01/02 dirs, all phase 03 context/research/patterns/validation files
  - Self-consistent git baseline for all subsequent Phase 3 cutover plans (03-01..03-10)
affects: [03-01-SVC-01, 03-02-SVC-02, 03-03-SVC-03, 03-04-SVC-04, 03-05, 03-06-SVC-07, 03-07-SVC-08, 03-08-SVC-05, 03-09-SVC-06, 03-10-merge-gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "verbatim-copy-from-prod-snapshot — restore Sheets-era route shape that Plan 03-05 will swap to new service methods (additive-then-deletion ordering, per D-33)"
    - "explicit-git-add-with-paths — never `git add .` or `git add -A`; D-43 requires V1 dirty working-tree files to remain unstaged"
    - "negation-rule .gitignore preserves env.example while .env / .env.local stay ignored (carried from Phase 1 D-?)"

key-files:
  created:
    - "web/src/app/api/dashboard/route.ts (15 lines, restored from prod-snapshot)"
    - "web/src/app/api/health/route.ts (33 lines, restored from prod-snapshot)"
    - "web/src/app/api/inactive/route.ts (69 lines, restored from prod-snapshot)"
    - "web/src/app/api/auth/[...nextauth]/route.ts (3 lines, restored from prod-snapshot)"
    - "web/src/app/api/actions/bulk/route.ts (60 lines, restored from prod-snapshot)"
    - "web/src/app/api/actions/history/route.ts (62 lines, restored from prod-snapshot)"
    - "web/src/app/signin/page.tsx (31 lines, restored from prod-snapshot)"
  modified: []

key-decisions:
  - "D-40 honored — three sub-tasks, three atomic commits in additive-then-deletion order: chore(03-00) → feat(02-retroactive) → docs(planning)"
  - "D-41 honored — only the 7 named files copied from prod-snapshot; web/src/lib/dashboard/analytics.ts, web/src/lib/runtime/env.ts, and web/src/test/dashboard-logic.test.ts left untouched so Phase 2 work (getWisenetEnv, getDbEnv, wisenet parity test block) is preserved"
  - "D-42 deferred to Plan 03-10 — prod-snapshot transfer remains as a Pre-Merge Gate operator step; this plan stays inside Begifted-Ops/.git"
  - "D-43 honored — V1 dirty working-tree files (Code.gs, Validation.gs, dashboard.html, .clasp.json, AGENTS.md, CLAUDE.md, README.md, appsscript.json, docs/, .github/ISSUE_TEMPLATE/, .github/pull_request_template.md, .gitignore) remained unstaged across all three commits"
  - "Phase 1+2 source files staged as a single commit (97 files) rather than the suggested A/B/C split — explicit git-add-with-paths kept .env / .env.local / .env.production / .clasprc.local.json out of staging while still bundling related work into one logical retroactive commit"

patterns-established:
  - "Pattern: pre-stage audit — `git diff --staged --name-only | grep -i .env` before every commit; PASS gates the commit"
  - "Pattern: explicit gitignore verification — `git check-ignore -v` against the known sensitive paths (.env, .env.local, .env.production, .clasprc.local.json, .planning/research/wisenet-postman.json) confirms each is ignored before proceeding"
  - "Pattern: post-copy invariant check — re-grep the kept-as-is file (env.ts had `getWisenetEnv|getDbEnv`) immediately after the cp batch to confirm nothing was clobbered"

requirements-completed: []

# Metrics
duration: 3min
completed: 2026-04-29
---

# Phase 3 Plan 00: Baseline Reconciliation Summary

**Restored 7 Sheets-era route/page files from prod-snapshot baseline and committed 169 previously-untracked Phase 1+2 source + planning artifacts across 3 atomic commits, establishing a self-consistent git state for all subsequent Phase 3 cutover plans without staging any V1 dirty files or secrets.**

## Performance

- **Duration:** ~3min (193s wall clock from first cp to final commit)
- **Started:** 2026-04-29T15:43:12Z
- **Completed:** 2026-04-29T15:46:25Z
- **Tasks:** 3 sub-tasks completed
- **Files committed:** 7 (Sub-task 1) + 97 (Sub-task 2) + 72 (Sub-task 3) = **176 files total**

## Accomplishments

1. **Sub-task 1 — Sheets-era surface restored.** Verbatim copy of 7 route handler / page files from `../Begifted-Ops-prod-snapshot/web/src/app/` into the active dev tree. Plan 03-05 now has a "swap from" baseline at the expected paths. Critically did NOT touch the 3 files (analytics.ts, env.ts, dashboard-logic.test.ts) that have Phase 2 work in the active tree.
2. **Sub-task 2 — Phase 1+2 source committed.** 97 files spanning `web/src/lib/wisenet/`, `web/src/lib/db/`, `web/src/lib/dashboard/` (TypeScript ports), `web/src/components/dashboard/`, `web/src/test/` (164-test suite from Phase 2), `web/scripts/` (DB ops + wisenet probes + lint guard), `web/drizzle/0000_initial.sql` + meta, plus root configs (`web/package.json`, `tsconfig.json`, `vitest.config.ts`, `next.config.ts`, `next-env.d.ts`, `drizzle.config.ts`, `web/.gitignore`, `web/.env.example`) and `.github/workflows/db-migrate.yml`. STATE.md "Phase 1+2: Complete" now reflects work in git, not just on disk.
3. **Sub-task 3 — Asymmetric .planning/ state reconciled.** 72 files: PROJECT.md, REQUIREMENTS.md, config.json, all of codebase/, research/ (minus gitignored wisenet-postman.json), 01-wisenet-discovery/ (16 files including 5 plan/summary pairs + validate-phase1.sh), 02-data-layer/ (24 files including 10 plan/summary pairs + 02-PLAN-CHECK.md + deferred-items.md). The 03-service-cutover/ phase files (CONTEXT/DISCUSSION-LOG/PATTERNS/RESEARCH/VALIDATION + 11 PLAN.md files) were already committed by an earlier session — only their unbacked context (PROJECT.md / REQUIREMENTS.md / phase 01-02 history) was missing.
4. **Build verification passed.** `cd web && npm run build` exits 0 against the restored baseline. Next.js 16 Turbopack compiled all 11 routes (7 newly restored + 1 pre-existing /api/actions + 3 page routes /, /dashboard, /signin) in 8.1s with TypeScript clean in 12.2s.
5. **Test suite verification passed.** `cd web && npm test -- --run` exits 0 with 164/164 tests green across 15 test files — Phase 2 baseline unchanged by the route restoration (the Sheets-era handlers reuse existing `lib/sheets/*` and `lib/dashboard/service.ts` which haven't changed).

## Task Commits

Each sub-task was committed atomically per D-33 (additive-then-deletion ordering, per-commit buildable):

1. **Sub-task 1: Restore Sheets-era route handlers** — `e339f39` (chore) — 7 files, 273 insertions
2. **Sub-task 2: Commit Phase 1+2 source** — `de8e5a2` (feat(02-retroactive)) — 97 files
3. **Sub-task 3: Commit .planning/ artifacts** — `396d7c8` (docs(planning)) — 72 files, 27,098 insertions

_Note: This plan is not a TDD plan; no test/refactor commits applicable._

## Files Created/Modified

### Sub-task 1 (commit `e339f39`)
- `web/src/app/api/dashboard/route.ts` — Sheets-era GET dashboard handler (calls getDashboardPayload + auth check, NextResponse JSON)
- `web/src/app/api/health/route.ts` — Sheets-era health probe (sheets probe via loadDashboardSources, no per-subsystem JSON; Plan 03-06 will replace with D-32 shape)
- `web/src/app/api/inactive/route.ts` — POST/DELETE inactive-student toggle (uses lib/sheets/inactive-students)
- `web/src/app/api/auth/[...nextauth]/route.ts` — NextAuth handlers re-export (3-line shim; not touched by Phase 3 SVC-* — restored only because it was missing)
- `web/src/app/api/actions/bulk/route.ts` — bulk action POST handler (uses lib/sheets/actions; Plan 03-04 will swap to bulkDb)
- `web/src/app/api/actions/history/route.ts` — 7-day history GET handler (reads from DashboardActionLog tab via googleapis client; Plan 03-04 swaps to db/queries)
- `web/src/app/signin/page.tsx` — sign-in page with Google OAuth form action (not touched by Phase 3 — restored only because it was missing)

### Sub-task 2 (commit `de8e5a2`) — selected highlights from 97 files
- `web/src/lib/wisenet/{client.ts, endpoints.ts, types.ts, mappers.ts, retry.ts}` — Phase 2 Wisenet HTTP client + retry wrapper + Zod-validated types + dashboard mappers
- `web/src/lib/db/{schema.ts, client.ts, bulk-client.ts, queries.ts, bulk-queries.ts}` — Drizzle schema + HTTP/WebSocket clients + typed queries
- `web/src/lib/dashboard/{service.ts, build.ts, packages.ts, analytics.ts, projection.ts, helpers.ts, config.ts, domain.ts, ui-helpers.ts, snapshot-store.ts, health-state.ts, actions.ts}` — TypeScript ports of Apps Script business rules; service.ts contains the `revalidateTag(_, "max")` anti-pattern at line 20 (will be removed in SVC-02)
- `web/src/lib/runtime/env.ts` — env accessors (getAuthEnv, getSheetsEnv, getWisenetEnv, getDbEnv, getAllowedEmails)
- `web/src/test/{wisenet-client, wisenet-endpoints, wisenet-mappers, wisenet-coercion, db-client, db-queries, env, calendar, queue, packages, projection, pending-deduction, lint-no-revalidate-max, dashboard-logic, actions-route}.test.ts` — 164/164 tests
- `web/src/test/fixtures/wisenet/*.json` — 6 Phase 2 fixtures (D-04)
- `web/src/test/helpers/wisenet-to-dashboard-sources.ts` — fixture adapter
- `web/scripts/{db-migrate.ts, seed-admin-ownership.ts, lint-no-revalidate-max.sh, README-db-ops.md}` + 4 wisenet-probe-*.ts + wisenet-postman-parse.ts + compare-live.ts + ensure-action-sheets.ts + ensure-inactive-sheet.ts + README-wisenet-probes.md — ops scripts
- `web/drizzle/0000_initial.sql` + `web/drizzle/meta/{0000_snapshot.json, _journal.json}` — initial migration with placeholder DATABASE_URL (per Phase 2 D-?)
- `.github/workflows/db-migrate.yml` — push-to-main migration runner with path filters
- `web/{package.json, package-lock.json, tsconfig.json, vitest.config.ts, next.config.ts, next-env.d.ts, drizzle.config.ts, .gitignore, .env.example}` — root configs

### Sub-task 3 (commit `396d7c8`) — selected highlights from 72 files
- `.planning/PROJECT.md` — milestone scope, core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — 47 v1 requirements across 5 phases (SVC-01..08, TEST-04/06 are Phase 3 entries)
- `.planning/config.json` — gsd config (parallelization: true, code_review: standard, branching_strategy: none)
- `.planning/codebase/{ARCHITECTURE, CONCERNS, CONVENTIONS, INTEGRATIONS, STACK, STRUCTURE, TESTING}.md` — codebase intelligence
- `.planning/research/{SUMMARY, STACK, FEATURES, ARCHITECTURE, PITFALLS, WISENET_FIELD_MAP, WISENET_ENDPOINTS}.md` — research artifacts
- `.planning/research/fixtures/wisenet/*.json` (6 fingerprint files + 6 sample files + 2 .gitkeep) — Phase 1 probe outputs
- `.planning/phases/01-wisenet-discovery/{01-CONTEXT, 01-DISCUSSION-LOG, 01-RESEARCH, 01-VALIDATION, 01-VERIFICATION, 01-PHASE-SUMMARY}.md` + 5 plan/summary pairs + validate-phase1.sh — Phase 1 history
- `.planning/phases/02-data-layer/{02-CONTEXT, 02-RESEARCH, 02-VALIDATION, 02-VERIFICATION, 02-PLAN-CHECK, deferred-items}.md` + 10 plan/summary pairs — Phase 2 history

## Decisions Made

- **Single Phase 1+2 commit instead of A/B/C split** — the plan offered a 3-way split as Claude's Discretion; consolidated to one commit because the per-path explicit git-add already enforced the security boundary, and a single retroactive commit is easier to git-blame than three loosely-related ones. Acceptable trade-off; future bisecting still works because pre-Plan-03-00 history has no Phase 2 source at all (so anyone bisecting Phase 2 work would land on this single commit's contents and read it as one atomic introduction).
- **Restored handlers stay Sheets-era pending Plan 03-04/03-05/03-06** — health/route.ts uses the old shape (sheetsOk + lastPayloadBuiltAt), not D-32's per-subsystem JSON. Inactive route uses lib/sheets/inactive-students. Bulk + history use the googleapis client. All four are baseline-to-swap targets, NOT final shape. The build still passes because all referenced symbols exist on the active tree's lib/sheets/* and lib/dashboard/service.ts surfaces.
- **No commit hooks bypassed** — sequential-mode commits used normal `git commit` (no `--no-verify`). Per project memory: no `Co-Authored-By: Claude` trailer. All three messages are plain conventional commits with scope.

## Threat Mitigations Applied

| Threat ID | Status | Evidence |
|-----------|--------|----------|
| T-03-00-1 (Info Disclosure: web/ git add stages .env) | Mitigated | `git diff --staged --name-only \| grep -i .env` returned only `web/.env.example` (negation-allowed) for Sub-task 2; empty for Sub-tasks 1 & 3. `git check-ignore -v` confirmed `.env`, `.env.local`, `.env.production` are gitignored. |
| T-03-00-2 (Info Disclosure: prod-snapshot files contain hardcoded secrets) | Mitigated | All 7 files read pre-copy. Each uses `getSheetsEnv()` / `auth()` / `requireSessionUser()` — env-driven only. Zero hardcoded API keys, DB URLs, or service account material. Zero suspicious base64 or hex blobs. |
| T-03-00-3 (Info Disclosure: .planning/research/ stages wisenet-postman.json) | Mitigated | `git check-ignore -v .planning/research/wisenet-postman.json` confirmed gitignored. Sub-task 3 staging audit (`git diff --staged --name-only \| grep wisenet-postman`) returned empty. File on disk; not in any commit. |

## Deviations from Plan

**Sub-task 2 — single commit instead of optional A/B/C split.** The plan listed an A/B/C split as a "if preferred" suggestion (wisenet / db / remaining). Chose single commit for simplicity and atomic readability. No security or correctness implication — explicit per-path `git add` enforced the same gates the split would have.

No other deviations. No Rule 1/2/3 auto-fixes. No checkpoint hits.

## Build Result After Sub-task 3

```
> begifted-ops-web@0.1.0 build
> next build

▲ Next.js 16.2.1 (Turbopack)
✓ Compiled successfully in 8.1s
  Running TypeScript ...
  Finished TypeScript in 12.2s
✓ Generating static pages using 9 workers (11/11) in 422ms

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /api/actions
├ ƒ /api/actions/bulk
├ ƒ /api/actions/history
├ ƒ /api/auth/[...nextauth]
├ ƒ /api/dashboard
├ ƒ /api/health
├ ƒ /api/inactive
├ ƒ /dashboard
└ ƒ /signin
```

`npm test -- --run` exits 0 with 164/164 tests passing across 15 files in 662ms.

## Verification Checklist

- [x] Sub-task 1: 7 Sheets-era route/page files committed from prod-snapshot (one commit `e339f39`)
- [x] Sub-task 2: Phase 1+2 source files under web/ committed (one commit `de8e5a2`, 97 files)
- [x] Sub-task 3: .planning/ artifacts committed (one commit `396d7c8`, 72 files)
- [x] No .env* or .clasprc.local.json files in any commit (`git log --all --full-history -- "web/.env"` returns 0 lines)
- [x] No V1 root .gs/.html files in any commit (Code.gs, Validation.gs, dashboard.html etc. remain unstaged)
- [x] No wisenet-postman.json in any commit (gitignored, never staged)
- [x] `npm run build` passes after all three commits (web/ directory, exits 0)
- [x] `npm test -- --run` passes (164/164 green)
- [x] env.ts / analytics.ts / dashboard-logic.test.ts NOT clobbered by prod-snapshot copy (D-41 honored — `getWisenetEnv|getDbEnv` still present in env.ts)
- [x] Three commits in correct order: chore(03-00) → feat(02-retroactive) → docs(planning) (D-33 ordering)

## Next Plan

**Plan 03-01 — SVC-01: Enable cacheComponents in next.config.ts.** Single-line config change; standalone commit. Per D-33 commit ordering this is the first additive commit in the cutover sequence. Pre-condition met: web/next.config.ts is now committed (from this plan's Sub-task 2) and contains only `reactStrictMode: true` — Plan 03-01 will add `cacheComponents: true` as a sibling key.

## Self-Check: PASSED

All claims verified post-write:

- `web/src/app/api/dashboard/route.ts` exists in HEAD~2 (`e339f39`) — FOUND
- `web/src/lib/wisenet/client.ts` exists in HEAD~1 (`de8e5a2`) — FOUND
- `.planning/REQUIREMENTS.md` exists in HEAD (`396d7c8`) — FOUND
- Commits `e339f39`, `de8e5a2`, `396d7c8` all present in `git log --oneline -3` — FOUND
- Build exits 0 — FOUND
- 164/164 tests pass — FOUND
