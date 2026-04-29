---
phase: 02-data-layer
verified: 2026-04-21T12:30:00Z
status: passed
score: 5/5 success criteria verified (SC#4 PASS-with-flag per D-23 explicit deferral)
overrides_applied: 1
overrides:
  - must_have: "A cache-invalidation regression test exists and passes: write to follow_up_state → subsequent getDashboardPayload() reflects the write"
    reason: "Per D-23 (locked in 02-CONTEXT.md and accepted in 02-PLAN-CHECK.md), TEST-03's runtime half is deferred to Phase 3 because Phase 2 leaves service.ts untouched and the old Sheets cache path remains in prod. Phase 2 ships the static-lint carve-out (web/scripts/lint-no-revalidate-max.sh) with an allowlist pinning the one remaining service.ts:20 occurrence and a 1-item negative regression test. Phase 3 SVC-02 is contractually required to remove the allowlist entry AND port the runtime cache-invalidation test against use-cache-remote."
    accepted_by: "kevin (via D-23 lock)"
    accepted_at: "2026-04-21T00:00:00Z"
re_verification:
  previous_status: initial
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 2: Data Layer Verification Report

**Phase Goal:** Stand up the Wisenet read client and Postgres write layer as parallel workstreams, with the 41 Validation.gs assertions ported to Vitest as the de-facto parity spec. At end of phase, fixture-driven Wisenet mappers produce valid `DashboardSources` AND the existing 45+ dashboard-logic tests pass against those mappers — but `service.ts` is untouched and the old Sheets path still serves production.

**Verified:** 2026-04-21T12:30:00Z
**Status:** passed (with 1 D-23 override on SC#4)
**Re-verification:** No — initial verification

## Goal Achievement

**YES.** All 5 success criteria materially satisfied. Phase 3 (Service Cutover) has a complete, consumer-ready toolkit to rewire `service.ts` today with zero additional Phase 2 work. One intentional deviation (SC#4 deferral per D-23) is tracked as an explicit override with a Phase 3 contractual closure path. Full suite is 164/164 green, tsc --noEmit exits 0.

## Success Criteria — Trace to Code

### SC#1 — Wisenet client + mappers + Zod boundary + fixtures

**Status:** VERIFIED

| Artifact | Status | Evidence |
|---|---|---|
| `web/src/lib/wisenet/client.ts` | VERIFIED | Lines 70-93: `wisenetFetch<T>(path, schema, init)` parses every response through passed Zod schema (`schema.parse(json)` line 92). Auth headers line 43-55 (6 headers). `AbortSignal.timeout(15_000)` line 81. `retryOn429` wrapping at line 78. PII redaction regex covers all 6 keys at line 61-62. `WisenetError` class line 25-34. |
| `web/src/lib/wisenet/endpoints.ts` | VERIFIED | 7 exported resource functions (grep confirmed: getStudents, getStudent, getParents, getClass, getPastSessions, getUpcomingSessions, getSessionCredits). PAGE_SIZE=50. Path-typo fix inline; `/institutes/v3/{center}/students` corrected. |
| `web/src/lib/wisenet/types.ts` | VERIFIED | 15 Zod schemas + 12 type aliases; 40 `z.coerce.*` occurrences (Pitfall #2 mitigation). MeetingStatusSchema enum with 4 values. |
| `web/src/lib/wisenet/mappers.ts` | VERIFIED | Pitfall-7 dual-entry split confirmed: `buildDashboardSourcesFromWisenet` at line 263 (network), `composeDashboardSourcesFromData` at line 307 (pure). 4 field transforms exported (lines 103-121), 2 network helpers (lines 167, 216), `TEACHER_FEEDBACK_CONCURRENCY = 5`. |
| `web/src/test/helpers/wisenet-to-dashboard-sources.ts` | VERIFIED | 130-line D-24 fixture adapter. `loadWisenetFixtureSet()` + `toDashboardSources()`. Zero network. |
| 6 fixtures in `web/src/test/fixtures/wisenet/` | VERIFIED | All 6 resource fixtures present. SHA-256 `shasum -a 256` confirms byte-identical to `.planning/research/fixtures/wisenet/` (spot-checked past_sessions_sample.json: `86384432a30aafeefc48000de1beb2d3758c8df173c7f49aa621351c61c081e7` matches both). |
| Fixture-driven tests | VERIFIED | `wisenet-mappers.test.ts` (36 tests), `wisenet-client.test.ts` (14 tests), `wisenet-endpoints.test.ts` (10 tests), `wisenet-coercion.test.ts` (39 tests) — all green. |

### SC#2 — Neon provisioning codebase side + typed query layer

**Status:** VERIFIED (codebase half); MANUAL-ONLY half noted below

| Artifact | Status | Evidence |
|---|---|---|
| `web/src/lib/db/schema.ts` | VERIFIED | 4 `pgTable` (followUpState line 56, followUpLog line 78, inactiveStudents line 106, studentAdminOwnership line 119) + 3 `pgEnum` (studentActionStatus, actionLogType, adminKey) + 8 inferred types. |
| `web/src/lib/db/client.ts` | VERIFIED | HTTP driver via `drizzle-orm/neon-http`; imports `getDbEnv` from env.ts; module-scope `db` export. |
| `web/src/lib/db/bulk-client.ts` | VERIFIED | WebSocket Pool via `drizzle-orm/neon-serverless` + `attachDatabasePool` + `globalThis.__bgBulkPool` singleton. max:3, idleTimeoutMillis:30_000. |
| `web/src/lib/db/queries.ts` | VERIFIED | 9 exported async functions present: `loadActionStateMap`, `upsertFollowUpState`, `appendFollowUpLog`, `listInactive`, `markInactive`, `clearInactive`, `readHistory`, `getAdminOwnership`, `bulkGetAdminOwnership`. |
| `web/src/lib/db/bulk-queries.ts` | VERIFIED | `bulkSetStudentAction` exported at line 50; BEGIN/COMMIT atomicity verified in `db-queries.test.ts` Test "opens exactly one transaction with BOTH inserts inside". |
| `web/drizzle/0000_initial.sql` + meta | VERIFIED | SQL file (2184 bytes) with 3 CREATE TYPE + 4 CREATE TABLE + 4 CREATE INDEX. `meta/_journal.json` + `meta/0000_snapshot.json` both present. |

**Manual-only (operator action, per VALIDATION.md §Manual-Only):** Neon Postgres actual provisioning via Vercel Marketplace and DATABASE_URL auto-injection is an operator gate. Phase 2's codebase-side deliverable is the schema + migration SQL + query layer, all of which are complete and consumer-ready.

### SC#3 — 41 Validation.gs assertions ported + z.coerce boundary tests green

**Status:** VERIFIED

| Component | Tests | Evidence |
|---|---|---|
| TEST-01 Batch A — packages.test.ts | 9 | All pass. Validation.gs line citations present. |
| TEST-01 Batch A — projection.test.ts | 4 | All pass. Includes `buildWeeklyBuckets` (Rule 2 inline port). |
| TEST-01 Batch A — pending-deduction.test.ts | 4 | 1 PORT + 2 REWRITE (D-05 Should_Credit drop) + 1 DB-05. 17 Apps Script carve-outs enumerated in file header lines 16-32. |
| TEST-01 Batch B — queue.test.ts | 4 | All pass. Pipeline-driven fixtures. |
| TEST-01 Batch B — calendar.test.ts | 4 (3 ports + T-02-35) | All pass. D-23 cache-miss comment block present. |
| TEST-02 (parity) | 2 in `dashboard-logic.test.ts` | "wisenet parity (TEST-02)" describe at line 217. Full pipeline green against Wisenet-mapper-derived DashboardSources. |
| TEST-05 (Zod coercion) | 39 in `wisenet-coercion.test.ts` | 7 describe blocks. Parametric `it.each` over accepted/rejected/surprising coercion cases. End-to-end integration through `composeDashboardSourcesFromData`. |
| Assertion math | 24 ported + 17 carved out + 1 dropped + 2 rewrites = 41 Validation.gs parity (minus D-05 drops/rewrites properly accounted) |  |

Full suite: `cd web && npm test -- --run` → **164/164 tests pass across 15 files** in 1.04s. `cd web && npx tsc --noEmit` → **exit 0** (the 2 pre-existing dashboard-logic.test.ts errors from 02-01 were resolved during TEST-02 parity extension in 02-04 — tsc now clean).

### SC#4 — Cache-invalidation regression test

**Status:** PASSED (override) — per D-23 explicit deferral to Phase 3

**Literal criterion** ("A cache-invalidation regression test exists and passes: write to follow_up_state → subsequent getDashboardPayload() reflects the write") is NOT satisfied in Phase 2. D-23 (locked in 02-CONTEXT.md, reaffirmed in 02-PLAN-CHECK.md FLAG analysis, and executed in 02-09) explicitly defers the runtime half because:

1. Phase 2 deliberately leaves `service.ts` untouched (the whole point of the phase boundary)
2. The `use cache: remote` / `cacheTag('dashboard-payload')` infrastructure the runtime test targets does NOT yet exist (Phase 3 SVC-02 lands it)
3. Writing a test against the current Sheets cache path would be thrown away by Phase 3

**Spirit satisfied** via the lint carve-out:
- `web/scripts/lint-no-revalidate-max.sh` — 2612 bytes, executable (`-rwxr-xr-x`), runs clean against current tree with exit 0
- Allowlist contains single entry: `src/lib/dashboard/service.ts` (the one pre-existing `revalidateTag(DASHBOARD_CACHE_TAG, "max")` at line 20 — the exact historical-bug class ROADMAP SC#4 calls out)
- `web/src/test/lint-no-revalidate-max.test.ts` — 1 automated negative test (serialized plant-violation → assert exit 1 → cleanup)
- `npm run lint:no-revalidate-max` script registered (Phase 3 can wire into pre-commit)
- 02-09-SUMMARY.md "Phase 3 SVC-02 requirements" section documents the 4-step closure path: remove line 20, remove allowlist entry, plumb runtime test, confirm lint still exits 0

Verdict: PASS-with-override. Deferral is EXPLICIT, documented, and contractually bound to Phase 3 SVC-02. A raw FAIL would be incorrect because the planner, plan-checker, and executor all aligned on this deferral before execution.

### SC#5 — Env accessors server-only + migrations outside app startup

**Status:** VERIFIED

| Check | Result |
|---|---|
| `getWisenetEnv()` exists in `web/src/lib/runtime/env.ts` | VERIFIED (line 60) |
| `getDbEnv()` exists | VERIFIED (line 70) |
| Client-bundle modules (`web/src/components/**/*.tsx`) reference neither | VERIFIED — `grep getWisenetEnv\|getDbEnv web/src/components/` returns 0 matches |
| All callers are server-side (lib/wisenet, lib/db, test) | VERIFIED — 20 matches total, all in server paths |
| `web/scripts/db-migrate.ts` is standalone tsx script | VERIFIED — `#!/usr/bin/env tsx` shebang; imports `drizzle-orm/neon-http/migrator` only |
| Not referenced from `instrumentation.ts` | VERIFIED — file doesn't exist: `ls web/instrumentation.ts` returns "No such file" |
| Not referenced from `postbuild` hook in package.json | VERIFIED — no `postbuild`/`prebuild`/`postinstall` entries in scripts section |
| `.github/workflows/db-migrate.yml` gates the deploy | VERIFIED — file present (40 lines), YAML valid, path-filtered push-to-main trigger |

## Requirements Coverage (19 claimed closed)

| Req | Plan | Code Evidence | REQUIREMENTS.md Status | Verifier Verdict |
|---|---|---|---|---|
| WCLI-01 | 02-02 | `wisenetFetch` + `WisenetError` + `retryOn429` + `AbortSignal.timeout` (client.ts) | Complete | SATISFIED |
| WCLI-02 | 02-02 | 15 Zod schemas + 12 inferred types (types.ts, 40 z.coerce.*) | Complete | SATISFIED |
| WCLI-03 | 02-03 | 7 resource functions + paginate generator (endpoints.ts, 144 lines) | Complete | SATISFIED |
| WCLI-04 | 02-04 | Dual-entry mapper + 6 snapshot builders + D-05/D-06/D-07/D-08/D-18/D-19 enforcement (mappers.ts, 598 lines) | Complete | SATISFIED |
| WCLI-05 | 02-02 + 02-09 | `schema.parse` at client.ts:92; 40 z.coerce.* in types.ts; 39 TEST-05 assertions in wisenet-coercion.test.ts (all green) | **Pending (ledger drift)** | SATISFIED — code implements WCLI-05 fully; REQUIREMENTS.md line 23 `- [ ]` and line 129 `Pending` are stale. See Findings below. |
| WCLI-06 | 02-04 | Fixture-driven mapper tests + 6 byte-identical fixtures (wisenet-mappers.test.ts, 36 tests) | Complete | SATISFIED |
| WCLI-07 | 02-01 | `getWisenetEnv()` at env.ts:60; 0 client-bundle references | Complete | SATISFIED |
| DB-01 | 02-01 | `getDbEnv()` at env.ts:70 + `.env.example` placeholders for DATABASE_URL + DATABASE_URL_UNPOOLED | Complete | SATISFIED (codebase half; operator Neon provisioning is manual-only per VALIDATION.md) |
| DB-02 | 02-05 | 4 pgTable + 3 pgEnum in schema.ts + 0000_initial.sql migration committed | Complete | SATISFIED |
| DB-03 | 02-05 | `globalThis.__bgBulkPool` singleton in bulk-client.ts, max:3, attachDatabasePool wired | Complete | SATISFIED |
| DB-04 | 02-06 | 9 typed query functions in queries.ts | Complete | SATISFIED |
| DB-05 | 02-06 + 02-07 | `isToday:true` at query layer + `sanitizeStudentActionState` at domain layer; pending-deduction.test.ts + queue.test.ts integration coverage | Complete | SATISFIED |
| DB-06 | 02-06 | Drizzle `$inferInsert` types enforce actorEmail/actorName at compile time | Complete | SATISFIED |
| DB-07 | 02-06 | `bulkSetStudentAction` BEGIN/COMMIT wrap in bulk-queries.ts; DB-07 atomicity test green | Complete | SATISFIED |
| DB-08 | 02-10 | `db-migrate.ts` standalone tsx + `.github/workflows/db-migrate.yml` + path filter + secret masking | Complete | SATISFIED |
| TEST-01 | 02-07 + 02-08 | 24 assertions ported across 5 files + 17 Apps Script carve-outs + 1 DROP + 2 REWRITE per D-05 | **Partial (ledger drift)** | SATISFIED — Batch B closed in 02-08; REQUIREMENTS.md line 148 still says "Batch B in 02-08 (~5 tests remaining)". Stale — Batch B is shipped (queue.test.ts 4 + calendar.test.ts 3+1). See Findings. |
| TEST-02 | 02-04 | "wisenet parity (TEST-02)" describe at dashboard-logic.test.ts:217 | Complete | SATISFIED |
| TEST-03 | 02-09 | Lint carve-out + allowlist + negative test (deferral-to-Phase-3 per D-23, explicit not missing) | Complete | SATISFIED (see SC#4 override above for literal-vs-spirit nuance) |
| TEST-05 | 02-09 | 39 parametric Zod coercion tests in wisenet-coercion.test.ts | Complete | SATISFIED |

**19/19 requirements implemented in code.** Two have stale ledger entries (WCLI-05 Pending, TEST-01 Partial) that should be flipped to Complete when phase closes.

## Goal-Backward Test: Can Phase 3 Start TODAY?

**Yes.** Every Phase 3 (Service Cutover) dependency on Phase 2 is consumer-ready:

| Phase 3 Task | Required Phase 2 Artifact | Status |
|---|---|---|
| Rewrite `service.ts::getDashboardPayload` to compose Wisenet + Postgres | `buildDashboardSourcesFromWisenet(today)` + `composeDashboardSourcesFromData(data, today)` | READY. Dual-entry split implemented; `service.ts` currently uses Sheets path (D-23-correct) but the swap is mechanical. |
| Join Postgres ownership onto RemainingCredits Admin column | `bulkGetAdminOwnership(studentKeys)` returns `Map<string, StudentAdminOwnershipRow>` | READY. queries.ts:193. Mapper emits Admin="" per D-06; Phase 3 service.ts joins post-compose. |
| Swap `/api/actions/route.ts` from Sheets writes to Postgres | `upsertFollowUpState({...FollowUpStateInsert})` + `appendFollowUpLog({...FollowUpLogInsert})` | READY. queries.ts:69 + 95. Drizzle `$inferInsert` enforces actor attribution at compile time. |
| Swap `/api/actions/bulk/route.ts` to Postgres transactional bulk | `bulkSetStudentAction({updates, actorEmail, actorName})` on WebSocket Pool | READY. bulk-queries.ts:50. BEGIN/COMMIT atomicity proven by db-queries.test.ts. |
| Run admin-ownership seed at cutover day | `npm run db:seed-admin` → `scripts/seed-admin-ownership.ts` | READY. clasp-run-based, allowlist validation, fallback-JSON on failure, onConflictDoUpdate idempotent. README-db-ops.md documents cutover checklist invocation. |
| Replace `revalidateTag(_, "max")` with `use cache: remote` | Lint carve-out at service.ts:20 with allowlist entry; SVC-02 checklist in 02-09-SUMMARY.md | READY. Lint is deterministic gate. |
| Postgres history `readHistory(studentKey, 7)` for `/api/actions/history` | queries.ts:153 | READY. |
| Inactive toggle routes | `listInactive` / `markInactive` / `clearInactive` | READY. queries.ts:108/118/139. |
| Port runtime cache-invalidation regression test (SC#4 spirit) | Scaffolding in 02-09-SUMMARY.md; the write→read round-trip is SVC-02's responsibility against new cache surface | READY. |

**Zero additional Phase 2 work required to unblock Phase 3.**

## Anti-Pattern Scan

Ran grep across the 20 Phase 2-touched files for `TODO|FIXME|placeholder|stub|not yet implemented|coming soon`:

- `mappers.ts` — inline comments documenting D-07 session-count proxy as a "Phase 2 decision with Phase 3 upgrade path through sessionCredits if Opportunity 6 probe succeeds" — intentional, NOT a stub. The derivation produces real non-zero values (verified by `FLAG-2: Aggregations credit balance is non-zero for fixture with ENDED sessions` test).
- `client.ts` — `__resetAuthHeaderCacheForTest` is a test-only helper, intentionally named, NOT a stub.
- No TODO/FIXME/stub markers in any production code.
- No empty-array hardcoded returns in rendered paths.
- No `console.log` debug leftover.

**Verdict:** Clean. No blockers.

## Behavioral Spot-Checks

| Behavior | Command | Result |
|---|---|---|
| Full vitest suite green | `cd web && npm test -- --run` | PASS — 164/164 tests across 15 files in 1.04s |
| TypeScript compile clean | `cd web && npx tsc --noEmit` | PASS — exit 0 |
| Lint anti-pattern carve-out runs | `bash web/scripts/lint-no-revalidate-max.sh` | PASS — exit 0, "all matches are allowlisted" |
| db-migrate.ts fails safely on missing env | `cd web && DATABASE_URL_UNPOOLED= npx tsx scripts/db-migrate.ts` | Documented in 02-10-SUMMARY: exit 1 with actionable error |
| 6 Wisenet fixtures byte-identical to research | `shasum -a 256 web/src/test/fixtures/wisenet/past_sessions_sample.json .planning/research/fixtures/wisenet/past_sessions_sample.json` | PASS — `86384432...1e7` on both |
| 7 exported resource functions in endpoints.ts | `grep "^export async function" endpoints.ts | wc -l` | PASS — 7 |
| Client-bundle isolation (no env leak to tsx) | `grep getWisenetEnv web/src/components/` | PASS — 0 matches |

## Plan-Check FLAG Resolution

| Flag | Origin | Resolution |
|---|---|---|
| FLAG-1 (RESEARCH.md §Open Questions formatting) | 02-PLAN-CHECK dimension 11 | NOT BLOCKING — optional cleanup. All 4 research recommendations honored in plans. Safe to leave for post-phase tidy. |
| FLAG-2 (02-04 credit balance placeholder) | 02-PLAN-CHECK dimension 4 | RESOLVED — 02-04-SUMMARY.md `key-decisions` line 5: "FLAG-2 non-zero verified" via session-count proxy. Test "FLAG-2: Aggregations credit balance is non-zero for fixture with ENDED sessions" passes with totalHours=3, remainingHours=1.5. |
| FLAG-3 (02-10 seed lint negative-test manual) | 02-PLAN-CHECK dimension 4 | RESOLVED — 02-09 shipped `web/src/test/lint-no-revalidate-max.test.ts` with automated positive/negative/cleanup cycle. Not manual any more. |

## Findings

### F-001: REQUIREMENTS.md ledger drift — WCLI-05 Pending should be Complete
- **Location:** `.planning/REQUIREMENTS.md` line 23 `- [ ]` and line 129 `| WCLI-05 | Phase 2 | Pending |`
- **Evidence that code satisfies WCLI-05:**
  - `wisenetFetch<T>(path, schema, init)` calls `schema.parse(json)` at client.ts:92 for every response
  - types.ts declares 40 `z.coerce.*` instances for string-vs-number and date coercions
  - wisenet-coercion.test.ts ships 39 TEST-05 assertions proving boundary coercion (all green)
  - 02-02-SUMMARY explicitly lists WCLI-05 (partial); 02-09-SUMMARY's closure of TEST-05 satisfies the boundary-validation requirement end-to-end
- **Severity:** Informational (ledger-only; code is correct)
- **Recommendation:** Flip `- [ ]` → `- [x]` and `Pending` → `Complete` during phase close / Phase 3 kickoff

### F-002: REQUIREMENTS.md ledger drift — TEST-01 still says Partial
- **Location:** `.planning/REQUIREMENTS.md` line 148 "Partial — Batch A shipped in 02-07 (17 tests); Batch B in 02-08 (~5 tests remaining)"
- **Evidence:** 02-08-SUMMARY shipped Batch B (queue.test.ts 4 ports + calendar.test.ts 3 ports + 1 T-02-35 guard). All 8 tests pass in the 164-total suite.
- **Severity:** Informational
- **Recommendation:** Update to "Complete — 24 assertions ported (17 Batch A + 7 Batch B); 17 Apps Script-specific carved out; 1 DROP + 2 REWRITE per D-05"

### F-003: ROADMAP.md Progress table drift
- **Location:** `.planning/ROADMAP.md` line 116 `| 2. Data Layer | 1/10 | In Progress|  |`
- **Evidence:** All 10 PLAN checkboxes above (lines 65-74) already `- [x]`. All 10 SUMMARY.md files present in phase dir.
- **Severity:** Informational
- **Recommendation:** Flip to `| 2. Data Layer | 10/10 | Complete | 2026-04-22 |` during phase close

### F-004: Phase 2 branch uncommitted state
- **Location:** `git status` at verification time
- **Evidence:** Working tree shows untracked artifacts (Begifted-Ops subdir, screenshots, credentials JSONs, PRD docx) — none of these are Phase 2 deliverables, but one of them (`begifted-ops-faea81a282d6.json`) is a credential file. Global CLAUDE.md rule: "Never commit `.clasprc.local.json` or any credential material." Does not affect Phase 2 verification but operator should move or gitignore these.
- **Severity:** Informational (operational hygiene)
- **Recommendation:** Confirm `.gitignore` covers `*.json` credentials at repo root, or move them to a gitignored path

### F-005: All FLAG-1/2/3 from 02-PLAN-CHECK.md resolved
- FLAG-1: Non-blocking cleanup (RESEARCH.md §Open Questions formatting) — can defer
- FLAG-2: Resolved in 02-04 (session-count proxy produces non-zero balances)
- FLAG-3: Resolved in 02-09 (automated negative test replaces manual verification)

## Gaps Summary

None blocking. Phase goal is achieved.

One intentional deviation (SC#4 literal — cache-invalidation regression test) is handled via D-23 override: lint carve-out + allowlist + automated negative test substitute for the runtime half, which Phase 3 SVC-02 is contractually bound to port against the new `use cache: remote` surface. The deferral is explicit, documented in 02-CONTEXT.md, acknowledged in 02-PLAN-CHECK.md, and has a concrete Phase 3 closure plan in 02-09-SUMMARY.md.

## Recommendation

**Proceed to Phase 3 (Service Cutover).** Phase 2 goal achieved; 164/164 tests pass; tsc clean; all 10 plans shipped; all 19 requirements implemented in code. Before (or during) Phase 3 kickoff, flip the 3 ledger-drift items (F-001, F-002, F-003) to reflect actual completion state.

---

*Verified: 2026-04-21T12:30:00Z*
*Verifier: Claude (gsd-verifier)*
