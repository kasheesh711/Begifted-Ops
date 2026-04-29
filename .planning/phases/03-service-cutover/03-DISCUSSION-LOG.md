# Phase 3: Service Cutover - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md (`<rebaseline_2026_04_29>` block) — this log preserves the alternatives considered.

**Date:** 2026-04-29
**Phase:** 03-service-cutover
**Trigger:** `/gsd-execute-phase 3` blocked when orchestrator detected that 6 route handlers Phase 3 plans expected to "swap" did not exist in `Begifted-Ops/web/src/app/api/`. User invoked `/gsd-discuss-phase 3` to re-baseline before re-planning.
**Areas discussed:** Phase 3 target tree, Plan reuse strategy, Restore scope, Restore-step commit placement, Cross-cutting state issues, Deploy path, Plan 03-00 scope

---

## Phase 3 target tree

| Option | Description | Selected |
|--------|-------------|----------|
| Begifted-Ops/web/ — restore routes | Stay in this repo (where .planning/ lives). Copy Sheets-era route files from Begifted-Ops-prod-snapshot/web/src/app/api/ into Begifted-Ops/web/src/app/api/ as a prep commit. Existing 03-CONTEXT.md and plans then apply almost as written. | ✓ |
| Begifted-Ops/web/ — fresh routes | Stay in this repo, treat empty route dirs as clean slate. Plan 03-05 changes from 'swap 5 routes' to 'create 5 routes' from scratch. Diverges more from existing plans. | |
| Begifted-Ops-prod-snapshot/web/ | Move Phase 3 work to prod-snapshot. Requires copying lib/wisenet/ + lib/db/ + Phase 2 tests over first, plus initializing the prod-snapshot git repo and remote. | |
| Pause Phase 3 — reconcile first | Don't decide cutover target yet. First investigate the directory split, commit the asymmetric .planning/ files, decide whether to merge the two trees. | |

**User's choice:** Begifted-Ops/web/ — restore routes
**Notes:** Captured in CONTEXT.md as D-38. Confirmed in follow-up "Deploy path" question (see below) that this is the work location only — production deploy still flows through Begifted-Ops-prod-snapshot/.

---

## Plan reuse strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Keep, gap-patch only | Existing PLANs are mostly valid. Only Plans 03-04 and 03-05 need updates. Run /gsd-plan-phase 3 --gaps after CONTEXT update. | |
| Replan affected only | Replan 03-04 and 03-05 (and possibly 03-06). Other plans stay as-is. | |
| Full replan | Throw out all 10 existing plans and re-plan from scratch with the corrected CONTEXT.md. | ✓ |
| I want to see the impact first | Don't decide plan-reuse yet — first walk me through which specific assumptions in each plan are now invalid before I pick a strategy. | |

**User's choice:** Full replan
**Notes:** Captured in CONTEXT.md as D-39. RESEARCH.md and PATTERNS.md (committed `56540ad`, `6d1d84a`) remain valid and reusable. New 11-plan structure: 03-00 (baseline reconciliation, NEW) + 03-01..03-10 (regenerated).

---

## Restore scope

| Option | Description | Selected |
|--------|-------------|----------|
| Routes only (6 files) | Copy just the 6 missing route.ts files + signin/page.tsx. Leave the 3 differing files (analytics.ts, env.ts, dashboard-logic.test.ts) alone. | |
| Routes + missing pages | Routes + signin/page.tsx + investigate why analytics.ts / env.ts / dashboard-logic.test.ts diverge. | |
| Mirror prod-snapshot fully | Overwrite all differing files in Begifted-Ops/web/src/ from prod-snapshot. NOT RECOMMENDED. | |
| Investigate before deciding | Show me what differs in the 3 diverging files before I decide on scope. | ✓ |

**User's choice:** Investigate before deciding
**Notes:** Investigation revealed:
- `analytics.ts` (685 vs 649 lines) — Begifted-Ops/web has Phase 2 additions (imports `DAY_MS`). Phase 1/2 work, **keep current version**.
- `env.ts` (75 vs 45 lines) — Begifted-Ops/web has `getWisenetEnv()` + `getDbEnv()` (Phase 2 additions). **Keep current version.**
- `dashboard-logic.test.ts` (315 vs 207 lines) — current has 108 more lines (Phase 2 wisenet parity tests). **Keep current version.**

→ Effective scope = routes + signin/page.tsx only (7 files). Captured as D-41.

---

## Restore-step commit placement

| Option | Description | Selected |
|--------|-------------|----------|
| Plan 03-00 (new, in Phase 3) | Add a new Plan 03-00 at the head of Phase 3's wave 0 — 'Restore Sheets-era route handlers from prod-snapshot'. Then 03-01..03-09 run as planned. | ✓ |
| Pre-Phase-3 prep commit | Land restoration as a standalone commit on main BEFORE Phase 3 starts (no plan file). | |
| Inline in Plan 03-05 | Plan 03-05 itself does the restore-then-rewire in one commit. | |

**User's choice:** Plan 03-00 (new, in Phase 3)
**Notes:** Captured as D-40. Plan 03-00 expanded scope (see "Plan 03-00 scope" below) to also commit Phase 1+2 source files and untracked .planning/ artifacts.

---

## Cross-cutting state issues (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Commit untracked .planning/ files now | PROJECT.md, REQUIREMENTS.md, config.json, phases/01-*/, phases/02-*/, 03-CONTEXT.md committed in a one-shot commit. | ✓ |
| Leave 13 V1 .gs/.html/.json edits alone | The dirty Apps Script files at repo root stay as-is. Phase 5 deals with them later. | ✓ |
| Verify Vercel deploy path | Confirm whether Vercel auto-deploys from kasheesh711/Begifted-Ops or kasheesh711/begifted-credit-dashboard. | ✓ |
| Verify Phase 1+2 commits actually shipped | Phase 1+2 code committed in this repo's git but surrounding .planning/ files aren't. Verify integrity. | ✓ |

**User's choice:** All four selected
**Notes:**
- "Commit untracked .planning/" → captured as Plan 03-00 sub-task 3 in D-40.
- "Leave V1 .gs edits" → captured as D-43.
- "Verify Vercel deploy path" → resolved during investigation: Vercel deploys from `kasheesh711/begifted-credit-dashboard` via prod-snapshot's git. Confirmed via `gh api repos/kasheesh711/begifted-credit-dashboard/commits` (2 commits, last 2026-04-27) + `git -C Begifted-Ops-prod-snapshot/web` showing remote linked + branch `main` synced with `origin/main`.
- "Verify Phase 1+2 commits" → resolved during investigation: Phase 1+2 source files (`web/src/lib/wisenet/`, `web/src/lib/db/`, `web/scripts/`, `web/drizzle/`, `.github/workflows/`, etc.) are NOT in `Begifted-Ops/.git` HEAD. They exist on disk only as uncommitted local files. STATE.md's "Phase 1+2: Complete" reflects work done, not work in git. Captured as Plan 03-00 sub-task 2 in D-40.

---

## Deploy path

| Option | Description | Selected |
|--------|-------------|----------|
| Work here, transfer at end | Phase 3 runs entirely in Begifted-Ops/web/ (uncommitted). When complete, copy all Phase 1+2+3 changes into Begifted-Ops-prod-snapshot/web/, commit + push there — Vercel deploys via git integration. | ✓ |
| Move all work to prod-snapshot now | Stop work in Begifted-Ops/web/. Copy Phase 1+2 code into Begifted-Ops-prod-snapshot/web/, commit them as 'Phase 1+2 land' first, then run Phase 3 there. | |
| Push Begifted-Ops to GitHub, switch Vercel | Make Begifted-Ops/web/ the new live source. Force-push Begifted-Ops to a new branch on the begifted-credit-dashboard repo. NOT RECOMMENDED. | |
| Defer the deploy question to Phase 4 | Lock 'work here in Begifted-Ops/web/' for Phase 3 execution. Phase 4 handles the transfer-to-prod-snapshot. | |

**User's choice:** Work here, transfer at end
**Notes:** Captured as D-42. Transfer mechanics fold into Plan 03-10's Pre-Merge Gate as a new operator step. Conflicts against prod-snapshot's older `analytics.ts` / `env.ts` / `dashboard-logic.test.ts` resolve in favor of `Begifted-Ops/web/` versions (Phase-2-aware).

---

## Plan 03-00 scope (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Copy 7 files from prod-snapshot | Copy 6 route.ts files + signin/page.tsx from Begifted-Ops-prod-snapshot/web/src/app/. | ✓ |
| Commit untracked .planning/ files | Stage and commit PROJECT.md, REQUIREMENTS.md, config.json, phases/01/, phases/02/, 03-CONTEXT.md. | ✓ |
| Commit Phase 1+2 source files | Commit all the uncommitted Phase 1+2 code (wisenet/, db/, scripts/, drizzle/, tests, workflows/). Big addition but resolves the root inconsistency. | ✓ |
| Skip Plan 03-00 — do prep manually | Do restoration / commits as a one-shot manual prep step before Phase 3 starts. | |

**User's choice:** First three (3 sub-tasks in Plan 03-00)
**Notes:** Captured as D-40. Plan 03-00 becomes a sequential 3-sub-task plan with one atomic commit per sub-task:
1. `chore(03-00): restore Sheets-era route handlers from prod-snapshot baseline`
2. `feat(02-retroactive): commit Phase 1+2 source — wisenet client, drizzle schema/queries, tests, scripts, CI` (or split per-area at planner's discretion)
3. `docs(planning): commit asymmetric .planning/ state`

Plan 03-00 runs in a single executor agent (sequential, no worktree) since the 3 sub-tasks share the working tree. After 03-00 commits, parallel execution of later waves resumes per `parallelization: true`.

---

## Claude's Discretion (carried forward + new)

From 2026-04-21 (still applies):
- actions.ts reconciliation (a vs b)
- exact cacheLife semantics
- TEST-03 Neon branch setup mechanics
- TEST-06 exact mock shape
- Which route handlers get their own Vitest shell
- Archive-link icon
- Logger helper file location
- React component test for SVC-08
- Chunked-transfer regression test placement
- Route handler `export const runtime = "nodejs"` verification

New from 2026-04-29:
- **Plan 03-00 sub-task 2 commit granularity** — single `feat(02-retroactive): commit Phase 1+2 source` commit, OR split per-area (one per: wisenet/, db/, tests, scripts, drizzle/, workflows). Planner's call. The single-commit version is simpler; the split version preserves logical grouping for later forensic analysis.
- **Plan 03-10 transfer mechanics** — rsync vs `cp -r` vs curated diff vs git format-patch. Planner picks. Critical constraint: the transfer must NOT overwrite prod-snapshot's `analytics.ts`/`env.ts`/`dashboard-logic.test.ts` with prod-snapshot's own older versions when Begifted-Ops/web/ has Phase-2-updated versions. (One option: use `cp -r web/src` from Begifted-Ops to prod-snapshot, since Begifted-Ops/web/ is canonical for everything Phase 1+2 touches by this point.)
- **Plan 03-10 commit message in prod-snapshot** — Planner picks; suggestion: `feat: Phase 3 Wisenet+Postgres cutover (transferred from Begifted-Ops/)` with a body summarizing the diff.

## Deferred Ideas (added 2026-04-29)

- **Reconciliation of `Begifted-Ops/.git` and `Begifted-Ops-prod-snapshot/web/.git`** — long-term, the GSD planning workspace and the live deploy repo should converge. Phase 5 (Apps Script Retirement) is the natural fold-in point: when V1 retires, `Begifted-Ops/` loses its V1 reason for existing and could become the deploy repo, OR `Begifted-Ops-prod-snapshot/` could absorb the planning artifacts.
- **Re-establish `Begifted-Ops` git push topology** — `kasheesh711/Begifted-Ops` (PUBLIC, V1 only) hasn't received a push since 2026-03-30. Whether to keep pushing GSD planning + V2 work commits there is a Phase 5 question.
