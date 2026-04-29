# Phase 2 Plan Check Report

**Phase:** 02 — Data Layer
**Checked:** 2026-04-21
**Verdict:** **PASS** with 3 optional flags
**Recommendation:** Proceed to `/gsd-execute-phase 2`

---

## Summary

Goal-backward analysis of the 10 Phase 2 PLAN.md files against the 5 ROADMAP.md success criteria and 19 requirements (WCLI-01..07, DB-01..08, TEST-01/02/03/05). All 19 requirements covered, all 5 success criteria traceable, all 15 locked decisions honored, no intra-wave file-modified clashes, no scope reduction. 3 optional flags are soft cleanup — none block execution.

## Per-Dimension Scores

| # | Dimension | Result | Notes |
|---|-----------|--------|-------|
| 1 | Requirement coverage | **PASS** | 19/19 mapped. TEST-01 intentionally split across 02-07 + 02-08 (batch A + B). No orphans. |
| 2 | Success-criterion achievability | **PASS** | SC#1 ← 02-02+02-03+02-04; SC#2 ← 02-01+02-05+02-06; SC#3 ← 02-07+02-08 (minus 17 carved out + 1 dropped + 2 rewritten); SC#4 ← 02-09 deferral lint per D-23; SC#5 ← 02-01 (env) + 02-10 (migrate). |
| 3 | Decision consistency | **PASS** | All 15 Phase-2-relevant locks (D-04, D-05, D-06, D-07, D-08, D-17..D-26) honored. No plan contradicts a lock. |
| 4 | Task quality (spot-checked 02-02-T3, 02-05-T1, 02-06-T2, 02-07-T3, 02-10-T3) | **PASS** | Every spot-checked task has `<read_first>` + `<acceptance_criteria>` with grep/file/test-command checks + `<action>` with concrete values. |
| 5 | Intra-wave files_modified overlap | **PASS** | Waves 1 (02-02, 02-05, 02-07), 2 (02-03, 02-06, 02-08), 4 (02-09, 02-10) verified zero overlap. |
| 6 | Dependency graph | **PASS** | All `depends_on` references point to same-or-earlier waves. No circular deps. No intra-wave deps. |
| 7 | Security threat model | **PASS** | 44 STRIDE threats (T-02-01..T-02-44) mapped across 10 plans. Zero `high` severity blockers. Mitigations concrete, not boilerplate. |
| 8 | Nyquist/VALIDATION.md population | **PASS** | 27 tasks in per-task map correspond 1:1 to plan tasks (3+3+2+3+3+3+3+2+2+3 = 27). `nyquist_compliant: true` set. |
| 9 | 17 Apps Script carve-out | **PASS** | 02-07-PLAN.md Task 3 enumerates the 17 `Validation.gs` assertions explicitly not ported; stay in `.gs` until Phase 5 archive. |
| 10 | Deferred decisions | **PASS** | All "Claude's Discretion" items from CONTEXT.md honored at task level. Planner didn't escalate discretion back to user. |
| 11 | Research resolution | **FLAG** | See FLAG-1 below. RESEARCH.md §Open Questions lacks explicit `(RESOLVED)` marker on section header or per-item "RESOLVED:" prefix. All 4 recommendations are honored in plans, so this is audit-only. |

---

## Findings

### FLAG-1 (Dimension 11) — RESEARCH.md §Open Questions resolution marker

**Location:** `.planning/phases/02-data-layer/02-RESEARCH.md` §Open Questions (line 1634).

**Issue:** Section contains 4 open questions with "Recommendation" bullets, but the section header lacks `(RESOLVED)` suffix and individual items lack `RESOLVED:` prefix. By the literal dimension-11 test, this is not-resolved formatting, even though the 4 recommendations are all honored:
- Q1 (sessionCredits upgrade probe) → D-23 explicitly defers TEST-03 to Phase 3; probe itself is deferred opportunity per Phase 1 PHASE-SUMMARY §Phase 2 Opportunity Upgrade
- Q2 (parent fetch performance) → D-18 chose 2-step join; Plan 02-03 implements with p-limit concurrency; Plan 02-04 mapper integrates
- Q3 (Neon branch migration ordering) → Plan 02-10 README documents first-PR verification step
- Q4 (Admin seed idempotency vs future edit UI) → Plan 02-10 seed script README covers ON CONFLICT DO UPDATE semantics

**Severity:** Non-blocking. Recommendation for cleanup: rename section to `## Open Questions (RESOLVED)` and prefix each with `RESOLVED:` for audit clarity.

**Action:** Optional. Planner may patch RESEARCH.md in a follow-up `docs(02):` commit, or leave as-is. Does not block executor.

### FLAG-2 (Dimension 4) — Plan 02-04 Task 1 Aggregations snapshot derivation is placeholder-only

**Location:** `.planning/phases/02-data-layer/02-04-PLAN.md` Task 1 (`toAggregationsSnapshot` remaining/total credits derivation, ~lines 444-453).

**Issue:** The current derivation is `totalHours = consumedHours + 0` → `remainingHours = max(0, totalHours - consumedHours)`, which always evaluates to `0`. This is a placeholder, not a real derivation against D-07's `derive-client` decision (derive from `past_sessions.duration` aggregation). The plan acknowledges "Phase 2 fallback: session count as proxy" but the written code doesn't implement even that — it's zero-ed out.

**TEST-05 impact:** `wisenet-coercion.test.ts` asserts `typeof row[remCol] === 'number'` — passes because `0` is numeric. So TEST-05 stays green.

**TEST-02 impact (D-24 parity gate):** The existing `dashboard-logic.test.ts` assertions that verify non-zero credit-balance scenarios will FAIL when fed through the Wisenet fixture adapter → `composeDashboardSourcesFromData` → mapper output, because the Aggregations shape will emit `0` for every balance.

**Severity:** Execution-time defect, not a planning defect. Plan 02-04 executor must implement real derivation. Consider adding an explicit acceptance-criteria check like `grep -E "totalHours|consumedHours" mappers.ts | grep -v "= 0"` or a fixture-driven Vitest assertion that `row[remCol] > 0` for at least one fixture case.

**Action:** Executor-caught, not planner-caught. Surface to the executor via the plan's existing `<acceptance_criteria>` block — consider tightening with a non-zero check before marking task complete.

### FLAG-3 (Dimension 4) — Plan 02-10 seed lint negative-test acceptance is manual

**Location:** `.planning/phases/02-data-layer/02-10-PLAN.md` Task 3 acceptance criteria.

**Issue:** "Negative test (verify the lint actually detects violations)" is listed as "manual verification, not automated acceptance" — the executor must hand-craft a fake file violating the rule, confirm the lint catches it, then delete. No standing automated assertion.

**Severity:** Low. The anti-pattern lint is a belt-and-suspenders check over the explicit `revalidateTag(DASHBOARD_CACHE_TAG, "max")` allowlist entry for Phase 2's existing `service.ts`. Phase 3 removes both the allowlist entry and the offending line.

**Action:** Optional. Could add a temp-file smoke test (create file, run lint, assert exit 1, delete file). Or tolerate as manual per operator discipline — 6-admin team is small enough to catch drift.

---

## Decision Coverage Audit (15 Phase-2-relevant locks)

| Lock | Plan(s) | Evidence |
|------|---------|----------|
| D-04 (fixture copy location) | 02-01 Task 3 | `web/src/test/fixtures/wisenet/*.json` — 6 files copied |
| D-05 (drop Should_Credit) | 02-07 Task 3 (pending-deduction) | 1 dropped (`testPendingDeductionUsesShouldCreditWhenAvailable`), 2 rewritten |
| D-06 (admin sidecar table) | 02-05 Task 1 | `student_admin_ownership(student_key PK, admin_key, assigned_at, assigned_by_email, updated_at)` |
| D-07 (derive-client credit balance) | 02-04 Task 1 | `toAggregationsSnapshot` past-sessions aggregation path ← FLAG-2 notes placeholder derivation |
| D-08 (pending-deduction rule) | 02-07 Task 3 | `meetingStatus === "ENDED" AND teacher_feedback empty AND (duration / 3600000) > 0` |
| D-17 (Drizzle + HTTP default + WebSocket bulk) | 02-05 Tasks 1-3 | Two clients (`db/client.ts` HTTP + `db/bulk-client.ts` WebSocket Pool) |
| D-18 (2-step parent join) | 02-03 Task 2 | `/parents` endpoint + per-call ID→name cache |
| D-19 (pre-filter ENDED + p-limit 5) | 02-04 Task 1 | `TEACHER_FEEDBACK_CONCURRENCY = 5`, `meetingStatus === "ENDED"` filter |
| D-20 (5 port files split by domain) | 02-07, 02-08 | packages + projection + pending-deduction (batch A) + queue + calendar (batch B) |
| D-21 (seed via clasp run) | 02-10 Task 3 | `scripts/seed-admin-ownership.ts` + `ON CONFLICT DO UPDATE` + fallback JSON |
| D-22 (CI job migrations) | 02-10 Task 2 | `.github/workflows/db-migrate.yml` with push-to-main trigger + Vercel deploy dependency |
| D-23 (no Phase 2 cache) | 02-09 Task 2 | Lint script `scripts/lint-no-revalidate-max.sh`, TEST-03 deferred with explicit note |
| D-24 (fixture adapter) | 02-04 Task 2 | `web/src/test/helpers/wisenet-to-dashboard-sources.ts` + mapper refactor to `composeDashboardSourcesFromData` |
| D-25 (bulk WebSocket + BEGIN/COMMIT) | 02-06 Task 2 | `globalThis.__bgBulkPool` singleton, `attachDatabasePool`, transaction wrapping |
| D-26 (single endpoints.ts) | 02-03 Tasks 1-2 | Flat file with 7 resource functions (no per-resource split) |

---

## Requirement Coverage Matrix (19/19)

| Req | Plan | Req | Plan |
|-----|------|-----|------|
| WCLI-01 | 02-02 | DB-01 | 02-01 |
| WCLI-02 | 02-02 | DB-02 | 02-05 |
| WCLI-03 | 02-03 | DB-03 | 02-05 |
| WCLI-04 | 02-04 | DB-04 | 02-06 |
| WCLI-05 | 02-02 | DB-05 | 02-06 |
| WCLI-06 | 02-04 | DB-06 | 02-06 |
| WCLI-07 | 02-01 | DB-07 | 02-06 |
| TEST-02 | 02-04 | DB-08 | 02-10 |
| TEST-03 | 02-09 (deferral lint) | TEST-01 | 02-07 + 02-08 |
| TEST-05 | 02-09 | | |

---

## Wave Execution Readiness

| Wave | Plans | Parallel-safe | Verdict |
|------|-------|---------------|---------|
| 0 | 02-01 | N/A (single plan) | Ready |
| 1 | 02-02, 02-05, 02-07 | YES (zero file overlap) | Ready |
| 2 | 02-03, 02-06, 02-08 | YES (zero file overlap) | Ready |
| 3 | 02-04 | N/A (single plan) | Ready |
| 4 | 02-09, 02-10 | YES (zero file overlap) | Ready |

---

## Recommendation

**Proceed to `/gsd-execute-phase 2`.** The 3 flags are optional cleanup; none block execution. FLAG-2 is the most substantive — executor of 02-04 must implement real credit-balance derivation, not the current zero-placeholder. Consider tightening 02-04 Task 1's acceptance criteria with a non-zero check before marking complete.

**If addressing flags first:** FLAG-1 is a 5-minute RESEARCH.md edit (add `(RESOLVED)` header + `RESOLVED:` prefixes). FLAG-2 is best addressed by the 02-04 executor. FLAG-3 is optional (10-15 min to add automated negative test, or tolerate as operator-discipline manual check).
