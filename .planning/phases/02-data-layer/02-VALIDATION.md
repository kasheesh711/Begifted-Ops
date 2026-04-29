---
phase: 02
slug: data-layer
status: approved
nyquist_compliant: true
wave_0_complete: false  # flips to true after Plan 02-01 ships
created: 2026-04-21
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` ^3.2.4 (already installed in `web/package.json` — unchanged) |
| **Config file** | `web/vitest.config.ts` (existing; node env, `@` alias) |
| **Quick run command** | `cd web && npm test -- --run <pattern>` (per-task scoped) |
| **Full suite command** | `cd web && npm test -- --run` |
| **Estimated runtime** | ~5-15s full suite (Phase 2 adds ~45-60 test files) |

**Additional tooling:**
- `tsx` for running `scripts/db-migrate.ts`, `scripts/seed-admin-ownership.ts`, `scripts/wisenet-probe-*.ts`
- `drizzle-kit` CLI for schema generation (`npm run db:generate`)
- `bash` for the existing Phase 1 validator (runs from any directory)

---

## Sampling Rate

- **After every task commit:** Run the scoped test for that task's file (e.g. `npm test -- --run src/test/packages.test.ts`)
- **After every plan wave:** Run `cd web && npm test -- --run` (full suite)
- **Before `/gsd-verify-work`:** Full suite green + TypeScript compile clean (`cd web && npx tsc --noEmit`)
- **Max feedback latency:** 15 seconds for scoped runs, 60 seconds for full suite

---

## Per-Task Verification Map

*Populated by planner when PLAN.md files land. Each task maps to a requirement ID, optional threat-model reference, an automated command, and a wave-0 dependency flag.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 02-01 | 0 | DB-01 + WCLI-07 (scaffolding) | T-02-01, T-02-02 | pinned dep ranges, gitignored secrets | smoke | `cd web && npm install && npx tsc --noEmit` | Wave 0 creates | ⬜ pending |
| 02-01-T2 | 02-01 | 0 | WCLI-07 | T-02-03 | env-loader throws on missing | unit | `cd web && npm test -- --run src/test/env.test.ts` | Wave 0 creates | ⬜ pending |
| 02-01-T3 | 02-01 | 0 | WCLI-06 (fixtures), DB-08 (drizzle.config) | T-02-05 | byte-identical fixture copies | smoke | `ls web/src/test/fixtures/wisenet/*.json \| wc -l` == 6 | Wave 0 creates | ⬜ pending |
| 02-02-T1 | 02-02 | 1 | WCLI-01 (retry) | T-02-10 | bounded retry, no header parsing | unit | `cd web && npm test -- --run src/test/wisenet-client.test.ts -t "retryOn429"` | ❌ Wave 0 | ⬜ pending |
| 02-02-T2 | 02-02 | 1 | WCLI-02 (Zod schemas) | T-02-09 | z.coerce.* at every numeric field | unit (via schema parse) | `cd web && npx tsc --noEmit` + fixture parse smoke | ❌ Wave 0 | ⬜ pending |
| 02-02-T3 | 02-02 | 1 | WCLI-01 + WCLI-05 (auth + error + redaction) | T-02-06, T-02-07, T-02-08, T-02-11 | PII redaction, Zod chokepoint | unit | `cd web && npm test -- --run src/test/wisenet-client.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-03-T1 | 02-03 | 2 | WCLI-03 | T-02-12, T-02-13 | encodeURIComponent all dynamic segments | unit (compile) | `cd web && npx tsc --noEmit` | ❌ Wave 0 | ⬜ pending |
| 02-03-T2 | 02-03 | 2 | WCLI-03 | T-02-14, T-02-15 | pagination termination, per-call parent cache | unit | `cd web && npm test -- --run src/test/wisenet-endpoints.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-04-T1 | 02-04 | 3 | WCLI-04 | T-02-16, T-02-17, T-02-18, T-02-20 | D-05 Should_Credit empty, D-08 rule, p-limit(5) bound | unit (compile) | `cd web && npx tsc --noEmit` | ❌ Wave 0 | ⬜ pending |
| 02-04-T2 | 02-04 | 3 | WCLI-06, WCLI-04 | T-02-16 | fixture-driven parity without network | unit | `cd web && npm test -- --run src/test/wisenet-mappers.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-04-T3 | 02-04 | 3 | TEST-02 | T-02-19 | existing dashboard-logic.test.ts passes against Wisenet sources | integration | `cd web && npm test -- --run src/test/dashboard-logic.test.ts` | ✅ existing (extended) | ⬜ pending |
| 02-05-T1 | 02-05 | 1 | DB-02 | T-02-23 | 4 tables match schema.ts exactly | unit (compile) | `cd web && npx tsc --noEmit` | ❌ Wave 0 | ⬜ pending |
| 02-05-T2 | 02-05 | 1 | DB-02 | T-02-23 | drizzle-kit check = no drift | static | `cd web && npx drizzle-kit check` | ❌ Wave 0 | ⬜ pending |
| 02-05-T3 | 02-05 | 1 | DB-03 | T-02-21, T-02-24 | max:3 singleton, attachDatabasePool | unit | `cd web && npm test -- --run src/test/db-client.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-06-T1 | 02-06 | 2 | DB-04, DB-05, DB-06 | T-02-26, T-02-27 | parametric queries, TS-enforced actor attribution | unit (compile) | `cd web && npx tsc --noEmit` | ❌ Wave 0 | ⬜ pending |
| 02-06-T2 | 02-06 | 2 | DB-07 | T-02-28, T-02-30 | transaction atomicity on WebSocket only | unit (mock drizzle) | `cd web && npm test -- --run src/test/db-queries.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-06-T3 | 02-06 | 2 | DB-04/05/06/07 | T-02-26..T-02-30 | mock drizzle + shape assertions | unit | `cd web && npm test -- --run src/test/db-queries.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-07-T1 | 02-07 | 1 | TEST-01 (packages) | T-02-31 | parity gates: exclusion keywords, admin majority vote | unit (parity gate) | `cd web && npm test -- --run src/test/packages.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-07-T2 | 02-07 | 1 | TEST-01 (projection) | — | ALERT_THRESHOLD, priority score ordering | unit (parity gate) | `cd web && npm test -- --run src/test/projection.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-07-T3 | 02-07 | 1 | TEST-01 (pending-deduction) + DB-05 | T-02-31, T-02-32 | D-05 drop, D-08 rule, DB-05 same-day | unit (parity gate) | `cd web && npm test -- --run src/test/pending-deduction.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-08-T1 | 02-08 | 2 | TEST-01 (queue) | — | queue rollup, pinned-first, action-state merge | unit (parity gate) | `cd web && npm test -- --run src/test/queue.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-08-T2 | 02-08 | 2 | TEST-01 (calendar) | T-02-34, T-02-35 | day grouping, summary deltas, cache-miss build path | unit (parity gate) | `cd web && npm test -- --run src/test/calendar.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-09-T1 | 02-09 | 4 | TEST-05 | T-02-36, T-02-38 | parametric Zod coercion | unit | `cd web && npm test -- --run src/test/wisenet-coercion.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-09-T2 | 02-09 | 4 | TEST-03 (deferred lint carve-out) | T-02-36, T-02-37 | revalidateTag-max anti-pattern lint | static lint | `cd web && bash scripts/lint-no-revalidate-max.sh` | ❌ Wave 0 | ⬜ pending |
| 02-10-T1 | 02-10 | 4 | DB-08 | T-02-40 | URL-redaction, fail-on-missing-env | smoke | `cd web && DATABASE_URL_UNPOOLED= npx tsx scripts/db-migrate.ts; test $? -eq 1` | ❌ Wave 0 | ⬜ pending |
| 02-10-T2 | 02-10 | 4 | DB-08 | T-02-44 | YAML valid, triggers + secrets + path filter | static | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/db-migrate.yml'))"` | ❌ Wave 0 | ⬜ pending |
| 02-10-T3 | 02-10 | 4 | DB-08 (D-21 seed) | T-02-39, T-02-41, T-02-42 | allowlist validation, fallback JSON, fail on missing env | smoke | `cd web && DATABASE_URL_UNPOOLED= npx tsx scripts/seed-admin-ownership.ts; test $? -eq 1` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Infrastructure pieces that must land before any other test can pass. Planner elaborates.

- [ ] `web/src/test/fixtures/wisenet/*.json` — 6 resource fixtures copied from `.planning/research/fixtures/wisenet/` per D-04
- [ ] `web/src/test/helpers/wisenet-to-dashboard-sources.ts` — fixture adapter stub (D-24)
- [ ] `web/src/lib/wisenet/types.ts` — Zod schema stubs for 6 resources (WCLI-02, WCLI-05)
- [ ] `web/src/lib/db/schema.ts` — Drizzle table stubs for 4 tables (`follow_up_state`, `follow_up_log`, `inactive_students`, `student_admin_ownership`) (DB-02)
- [ ] `web/drizzle.config.ts` — drizzle-kit configuration (DB-08)
- [ ] `web/.env.example` additions for `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (DB-01)
- [ ] `web/src/lib/runtime/env.ts` — `getWisenetEnv()` + `getDbEnv()` stubs (WCLI-07)
- [ ] `web/package.json` scripts: `db:generate`, `db:migrate`, `db:seed-admin` (DB-08)
- [ ] New deps installed: `@neondatabase/serverless`, `drizzle-orm`, `drizzle-kit` (dev), `zod`, `@vercel/functions`, `p-limit`

---

## Critical Parity Gates (from RESEARCH.md)

Not all 41 `Validation.gs` assertions are equally load-bearing. The following are the hard parity gates that MUST be green — failure of any one blocks phase completion:

| Gate | Test File | Assertion | Why load-bearing |
|------|-----------|-----------|------------------|
| Active-student filter | `packages.test.ts` | `buildActiveStudentSet` includes students with `active=true` AND (recent past session OR upcoming session) | Drives queue eligibility — wrong here = wrong dashboard everywhere |
| Exclusion keywords | `packages.test.ts` | `EXCLUDED_PACKAGE_KEYWORDS` match is case-insensitive substring on Class Subject | Operators will notice if pretest/trial packages leak into queue |
| Admin ownership majority vote | `packages.test.ts` | `buildStudentAdminOwnershipMap` resolves to `palm`/`kem`/`care`/`aya`/`petchy`/`muk`/`unassigned` | Seed migration correctness (D-21) depends on this port being exact |
| Pending-deduction rule | `pending-deduction.test.ts` | `shouldCountAsPendingDeduction` = `meetingStatus === "ENDED" AND teacher_feedback empty AND (duration / 3600000) > 0` | Core business rule; D-05 drops Should_Credit branch — ensure fallback works |
| Projection math | `projection.test.ts` | `computeProjection` produces correct `alertDate`/`exhaustDate` via upcoming-session iteration | Dashboard status (notify/watch/ok/nodata) derives from this |
| Priority score | `queue.test.ts` | `computePriorityScore` + `compareStudentQueueRows` ordering preserved | Queue ordering is operator muscle memory |
| Calendar day grouping | `calendar.test.ts` | `buildCalendarData` day groupings match Sheet-driven reference | Day-by-day triage is a primary workflow |
| Same-day visibility | `pending-deduction.test.ts` OR `packages.test.ts` | `sanitizeStudentActionState()` drops non-today action rows | DB-05 preserves this — must not regress |
| Zod coercion at boundary | inline in `wisenet-mapper.test.ts` (or equivalent) | `"2"` (string) from Wisenet → `2` (number) through pipeline | TEST-05 explicit; Pitfall #2 mitigation |
| Bulk write atomicity | `db/queries.test.ts` (integration) | `bulkUpsertFollowUpState` rolls back on partial failure | DB-07 correctness (WebSocket Pool + BEGIN/COMMIT) |

---

## Not-Ported Apps Script Infrastructure (deliberate carve-out)

Per RESEARCH.md port analysis, 17 `Validation.gs` assertions exercise Apps Script-specific infrastructure (`CacheService`, chunked-transfer, `HtmlService`, `PropertiesService`) that has no Next.js analogue. These stay in `Validation.gs` untouched until Phase 5 archives the `.gs` sources.

- Chunked cache manifest reads/writes (`BG_DASHBOARD_PAYLOAD_V2::meta`, `::part::<N>`)
- PropertiesService prefix-scoped reads (`BG_ACTION_V1::<studentKey>`)
- `HtmlService` template rendering
- Apps Script timezone / `Session.getScriptTimeZone()` semantics
- `beginDashboardDataTransfer` / `fetchDashboardDataChunkBatch` flow
- `runLiveAccuracyAudit` live-sheet parity (already blocked on clasp auth per existing state)

**If a future Phase 2 task tries to port one of these:** stop — re-scope the task. These assertions belong to the retiring stack.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Neon Postgres provisioning via Vercel Marketplace | DB-01 | Requires operator action in Vercel UI; auto-injects `DATABASE_URL` + unpooled variant across prod/preview/dev | 1. `vercel marketplace add neon` → 2. Confirm env vars land in Vercel project → 3. `vercel env pull web/.env` to sync locally → 4. Run `cd web && npx tsx scripts/db-migrate.ts` against `DATABASE_URL_UNPOOLED` |
| GitHub Actions CI job running on push-to-main | DB-08 | First PR verifies; each deploy proves | Merge a schema-change PR → watch the `db-migrate` action run → confirm Vercel deploy is gated on action success |
| Admin-ownership seed runs clean | DB-02 + D-21 | Depends on live clasp auth + live Apps Script + live Sheets | Run `cd web && npm run db:seed-admin` → spot-check 5-10 rows in `student_admin_ownership` via `psql` → verify each admin_key is in the allowlist |
| Wisenet sessionCredits-with-resolved-pair upgrade probe | Opportunity 6 | Depends on live Wisenet traffic; optional Phase 2 upgrade | Run `cd web && npx tsx scripts/wisenet-probe-field-shape.ts --resolved-pair` with a known enrolled student → if 200 with numeric `total`+`remaining`, upgrade the 3 RED balance rows; else document and defer |
| Bulk-action atomicity under partial failure | DB-07 | Neon branching test required; not practical in CI unit tests | Provision Neon branch → inject a constraint violation mid-batch via raw SQL → verify all 50 rows roll back (`SELECT count(*) FROM follow_up_state` returns 0) |

---

## Validation Sign-Off

- [ ] All 19 Phase 2 requirements (WCLI-01..07, DB-01..08, TEST-01/02/03/05) have `<automated>` verify steps OR a Wave 0 dependency flag
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all MISSING references from the per-task map
- [ ] No watch-mode flags in commands (all `--run` / one-shot)
- [ ] Feedback latency < 15s for scoped runs, < 60s for full suite
- [ ] `nyquist_compliant: true` set in frontmatter after per-task map is populated and sign-off items check

**Approval:** nyquist_compliant flipped to true — per-task map populated by planner 2026-04-21. Wave 0 flag stays false until Plan 02-01 ships.

---

## Notes for Planner

1. **TEST-03 is explicitly deferred to Phase 3** per RESEARCH.md + D-23. Add a Phase 2 lint-style check instead: grep for `revalidateTag(*, "max")` call sites in new paths; fail the commit if any new path introduces the anti-pattern. Document this carve-out in the PLAN.md for TEST-03.
2. **17 Apps Script-specific assertions are deliberately NOT ported.** If the planner enumerates tasks against all 41, explicitly list these 17 as "out of scope — stay in Validation.gs until Phase 5".
3. **Integration tests for Drizzle queries use a Neon branch.** Gate with `TEST_DATABASE_URL` env var; default skip in CI. One or two integration tests is enough — the rest mock Drizzle per `actions-route.test.ts` pattern.
4. **Wave 0 test-infra dependencies** are listed above. Planner populates `<requirements>` for each Wave 0 task so downstream tasks can reference them.
5. **Nyquist sign-off is gated on the per-task map being populated.** Planner writes it; this document updates `nyquist_compliant: true` only after sign-off items check.
