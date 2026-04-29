---
phase: 02-data-layer
plan: 10
subsystem: infra
tags: [drizzle, neon, github-actions, tsx, clasp, ci, migrations, seed]

# Dependency graph
requires:
  - phase: 02-data-layer
    provides: "Drizzle schema + 0000_initial.sql migration (02-05), HTTP client + queries (02-06), package.json scripts entries db:migrate/db:seed-admin (02-01), getDbEnv + DATABASE_URL_UNPOOLED env shape (02-01)"
provides:
  - "DB-08 migration runner: web/scripts/db-migrate.ts — tsx-invokable with drizzle-orm/neon-http/migrator, redacts URL in logs, fails loudly on missing DATABASE_URL_UNPOOLED"
  - "DB-08 CI workflow: .github/workflows/db-migrate.yml — workflow_dispatch + push-to-main with path filter on web/drizzle/**, schema.ts, db-migrate.ts"
  - "D-21 seed script: web/scripts/seed-admin-ownership.ts — clasp-run-based cutover seed with allowlist validation + fallback-JSON on any failure path"
  - "Operator runbook: web/scripts/README-db-ops.md — covers both scripts + CI workflow, Q3 Neon-branch ordering + Q4 idempotency-vs-edit-UI documented"
affects: [03-service-cutover, 04-deploy-hardening, 05-apps-script-retirement]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "tsx-invokable script pattern with #!/usr/bin/env tsx shebang + env-first validation + process.exit(1) on missing env"
    - "URL redaction helper: regex replace :PASSWORD@ → :<REDACTED>@ before any log print (T-02-40 mitigation)"
    - "Fallback-JSON-on-failure: clasp/parse/validation failures write suspicious payload to .planning/research/ for manual review and exit non-zero (T-02-43 mitigation)"
    - "Allowlist-validation via Set<string> built from single-source-of-truth (ADMIN_OWNER_REGISTRY + UNASSIGNED_ADMIN_KEY) — no hardcoded duplication"
    - "Path-filtered GH Actions workflow — CI job only runs when schema/migration/runner-script files change, not on unrelated commits"

key-files:
  created:
    - "web/scripts/db-migrate.ts — 39 lines, tsx migration runner"
    - "web/scripts/seed-admin-ownership.ts — 182 lines, D-21 clasp-run seed"
    - "web/scripts/README-db-ops.md — 110 lines, operator runbook"
    - ".github/workflows/db-migrate.yml — 40 lines, CI migrate workflow"
  modified: []

key-decisions:
  - "URL redaction is belt-and-suspenders with GH Actions secret masking — regex :PASSWORD@ → :<REDACTED>@ runs in our code even though GH auto-masks secrets, so local runs also don't leak the password in log output"
  - "Fallback-JSON path (.planning/research/admin-ownership-seed.json) is intentionally OUTSIDE web/ so it doesn't pollute the build but sits near PLAN/CONTEXT artifacts where operator review naturally happens"
  - "BATCH = 500 rows per insert — each row emits ~3 params (studentKey, adminKey, assignedByEmail), 500 * 3 = 1500 params, well under PostgreSQL's 65535 parameter-count limit (T-02-43 upper bound)"
  - "Path filter on CI workflow: web/drizzle/**, web/src/lib/db/schema.ts, web/scripts/db-migrate.ts — lets schema-touching PRs trigger migrate automatically while unrelated cosmetic PRs don't spin up a Node runtime"
  - "seed-admin-ownership.ts validates BEFORE inserting — allowlist check runs across the full ownership map before the first db.insert call, so a single bad value aborts the whole run rather than leaving partial state"
  - "Fallback JSON content varies by failure path (clasp-fail writes error+timestamp; parse-fail writes raw claspOutput; allowlist-reject writes the offending entry + full ownership) — matches the principle 'preserve the suspicious payload exactly for human review'"
  - "npm scripts db:migrate + db:seed-admin were already registered by Plan 02-01; verified both point at the correct tsx targets rather than re-adding"

patterns-established:
  - "CI-runs-migration-before-deploy pattern — GH Actions picks up schema changes on push-to-main and runs migrate; Vercel deploy for the same commit cannot ship the code until migration step completes"
  - "Script-level env gate with actionable error messages — not just 'missing X' but 'here is the exact command to populate X locally (vercel env pull web/.env) or to wire it in CI (repo Settings → Secrets)'"
  - "Fallback-preserves-suspicious-payload: never insert or proceed when the upstream data is suspect; write it somewhere the reviewer will naturally look and exit non-zero"

requirements-completed: [DB-08]

# Metrics
duration: ~13min
completed: 2026-04-22
---

# Phase 2 Plan 10: Ops Scripts + CI Migrate Workflow Summary

**Ships DB-08 (tsx db-migrate.ts + GH Actions workflow with path-filtered push-to-main trigger using DATABASE_URL_UNPOOLED) and D-21 (clasp-run-based admin-ownership seed with allowlist validation + fallback-JSON), plus an operator runbook documenting the RESEARCH Q3/Q4 open items.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-04-22T05:10:13Z
- **Completed:** 2026-04-22T05:22:51Z
- **Tasks:** 3 (all auto, no checkpoints)
- **Files created:** 4 (2 scripts + 1 workflow + 1 README)
- **Files modified:** 0 (npm scripts already registered by Plan 02-01)

## Accomplishments

- **DB-08 migration runner shipped:** `web/scripts/db-migrate.ts` uses `drizzle-orm/neon-http/migrator`'s `migrate()` against `./drizzle` folder. Reads `DATABASE_URL_UNPOOLED` (direct Neon URL — PgBouncer is incompatible with migration DDL per Pitfall 3). Fails loudly with exit 1 + actionable fix message when env missing. Redacts the password segment from log output before printing (T-02-40 belt-and-suspenders over GH Actions secret masking).
- **DB-08 CI workflow shipped:** `.github/workflows/db-migrate.yml` triggers on `workflow_dispatch` + `push` to `main` path-filtered to `web/drizzle/**`, `web/src/lib/db/schema.ts`, `web/scripts/db-migrate.ts`. Runs Node 22 + `npm ci` + `npx tsx scripts/db-migrate.ts` in `web/` working directory. Reads `DATABASE_URL_UNPOOLED` from `secrets.DATABASE_URL_UNPOOLED`. Verify-env step surfaces missing-secret errors with a GitHub `::error::` annotation before spending Node install time.
- **D-21 seed script shipped:** `web/scripts/seed-admin-ownership.ts` runs `clasp run buildStudentAdminOwnershipMap` from repo root (so clasp finds `.clasp.json` + `.clasprc.local.json`), parses JSON output, validates every `adminKey` against `VALID_ADMIN_KEYS` (set built from `ADMIN_OWNER_REGISTRY` + `UNASSIGNED_ADMIN_KEY`), then bulk-upserts into `student_admin_ownership` via Drizzle `onConflictDoUpdate` (sql\`excluded.admin_key\` / sql\`now()\`) in 500-row batches. Every failure path — clasp fail, parse fail, empty map, malformed entry, allowlist reject — writes the suspicious payload to `.planning/research/admin-ownership-seed.json` and exits 1 without inserting anything.
- **Operator runbook shipped:** `web/scripts/README-db-ops.md` covers setup (Vercel Marketplace Neon + GitHub secret wiring), invocation (local `npm run db:migrate`/`db:seed-admin` + CI triggers), generating new migrations, Q3 Neon preview-branch ordering (branches inherit `__drizzle_migrations` table; preview migrate failure blocks preview deploy same as main), Q4 idempotency vs future dashboard edit UI (this script would overwrite operator edits if re-run post-cutover; mitigation = run once only + Phase 3 checklist entry + future guard on `updated_at > assigned_at`).

## Task Commits

Each task was committed atomically:

1. **Task 1 — db-migrate.ts migration runner (DB-08):** `9ed96f4` (feat)
2. **Task 2 — GH Actions db-migrate workflow (DB-08 + D-22):** `aecedf6` (feat)
3. **Task 3 — seed-admin-ownership.ts + README-db-ops.md (D-21):** `e8a056b` (feat)

**Plan metadata:** to be committed after SUMMARY/STATE updates.

## Files Created/Modified

- `web/scripts/db-migrate.ts` (created) — tsx migration runner, exit-1 on missing env, URL redaction, uses drizzle-orm/neon-http/migrator against ./drizzle
- `web/scripts/seed-admin-ownership.ts` (created) — D-21 clasp-run seed with VALID_ADMIN_KEYS allowlist, fallback-JSON on any failure, batched onConflictDoUpdate
- `web/scripts/README-db-ops.md` (created) — operator runbook covering both scripts + CI workflow, Q3 + Q4 open questions addressed
- `.github/workflows/db-migrate.yml` (created) — CI migrate job with workflow_dispatch + path-filtered push-to-main trigger

## Decisions Made

See `key-decisions` in frontmatter. Most notable:

- **URL redaction runs in-script** even though GitHub Actions auto-masks secret references in logs. This makes local-dev runs safe too (Vercel log scrapers, terminal scrollback, screencaps).
- **Fallback JSON lives outside web/** — path is `.planning/research/admin-ownership-seed.json` so it sits with other planning/research artifacts the operator reviews manually. Gitignored by virtue of never being committed + fallback content can contain live clasp output (PII-sensitive).
- **Batch size 500** chosen as a round number comfortably under PostgreSQL's 65535 parameter-count limit (500 * 3 = 1500 params per batch). Real student count is in the hundreds, so this is one batch in practice but the loop handles future growth.
- **Allowlist is a Set built from single sources of truth** — `ADMIN_OWNER_REGISTRY.map(a => a.key)` spread with `UNASSIGNED_ADMIN_KEY`. If the registry ever changes, allowlist tracks automatically.

## Deviations from Plan

None - plan executed exactly as written.

The plan's example code in `<action>` blocks was followed closely; all 3 files came out within the plan's prescriptive shape. Minor spots where the implementation diverged non-materially:

- Added a per-entry malformed-entry guard before allowlist check (handles `entry.adminKey` not being a string before `.has()` is called on a non-string). Defensive but not a plan deviation — still within the "fail loudly on malformed clasp output" contract from the plan's acceptance criteria.
- Log messages prefixed with `[db-migrate]` / `[seed-admin-ownership]` tags for log discoverability. Plan used ✓/✗ markers; I kept those markers AND added the tag prefix.

## Issues Encountered

**Flaky vitest parallel-worker timeout on first full-suite run.** First `npm test -- --run` showed 9 failures in 5 files (wisenet-endpoints.test.ts + 4 others) with `Timeout calling "onTaskUpdate"` unhandled errors. Duration was 123s with `tests 217.41s` parallel-time — suggesting worker RPC under load. Re-running the same suite immediately produced **15 files passed, 164 tests passed (0.947s total)**. The affected test files were untouched by this plan (all new files are under `web/scripts/` which is outside `src/**/*.test.ts` glob). Not a regression; not a deviation. Flag for STATE.md so future runs don't misread this signal.

## User Setup Required

None for Plan 02-10 code itself — all scripts fail safely without env vars.

**For the CI workflow and seed script to actually run in production**, Kevin needs:

1. Provision Neon via Vercel Marketplace (auto-injects `DATABASE_URL` + `DATABASE_URL_UNPOOLED` to Vercel env).
2. Copy `DATABASE_URL_UNPOOLED` value into GitHub repo Settings → Secrets and variables → Actions → `DATABASE_URL_UNPOOLED`.
3. Run `vercel env pull web/.env` to pull env locally (for local `npm run db:migrate` and `npm run db:seed-admin`).
4. Verify `.clasprc.local.json` is present + `clasp login` authenticated (seed script prerequisite).
5. Phase 3 cutover-day checklist will include `cd web && npm run db:seed-admin` as a manual invocation — documented in README-db-ops.md.

These are operator actions, not Phase 2 code deliverables. Fully documented in `web/scripts/README-db-ops.md` §Setup.

## Verification Evidence

### Task 1 — db-migrate.ts

- `test -f web/scripts/db-migrate.ts` — FOUND
- `head -1 web/scripts/db-migrate.ts` — `#!/usr/bin/env tsx`
- `grep -c DATABASE_URL_UNPOOLED` — 3 (env-var read, error message, doc comment)
- `grep -c drizzle-orm/neon-http/migrator` — 1 (import)
- `grep -c "migrationsFolder.*drizzle"` — 1 (migrate call)
- `grep -c REDACTED` — 2 (regex replacement + substituted value)
- `cd web && npx tsc --noEmit` — clean (exit 0)
- **Dry-run on missing env:** `DATABASE_URL_UNPOOLED= npx tsx scripts/db-migrate.ts` → exit 1, stderr:
  ```
  [db-migrate] DATABASE_URL_UNPOOLED is required. Vercel Marketplace Neon integration auto-injects this in prod/preview; for local runs, pull via `vercel env pull web/.env`.
  ```

### Task 2 — db-migrate.yml

- `test -f .github/workflows/db-migrate.yml` — FOUND
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/db-migrate.yml'))"` — exit 0 (YAML valid)
- `grep -c workflow_dispatch` — 1
- `grep -c "branches: \[main\]"` — 1
- `grep -c secrets.DATABASE_URL_UNPOOLED` — 1
- `grep -c "working-directory: web"` — 1
- `grep -c web/drizzle` — 1
- `grep -c "web/src/lib/db/schema.ts"` — 1
- `grep -c "node-version: \"22\""` — 1
- `grep -c "npx tsx scripts/db-migrate.ts"` — 1

### Task 3 — seed-admin-ownership.ts + README-db-ops.md

- `test -f web/scripts/seed-admin-ownership.ts` — FOUND
- `test -f web/scripts/README-db-ops.md` — FOUND
- `head -1 seed-admin-ownership.ts` — `#!/usr/bin/env tsx`
- `grep -c "clasp run buildStudentAdminOwnershipMap"` — 3 (import/call + comments)
- `grep -c VALID_ADMIN_KEYS` — 4 (define + 2 usages + 1 in error-message join)
- `grep -c onConflictDoUpdate` — 2 (call + comment)
- `grep -c "now()"` — 1 (sql`now()` in conflict SET)
- `grep -c "admin-ownership-seed.json"` — 3 (FALLBACK_PATH + 2 references)
- `grep -c "DATABASE_URL_UNPOOLED is required"` — 1
- `grep -c "^##" README-db-ops.md` — 17 (README has many top-level sections; ≥3 required)
- `grep -c "Q3:" README-db-ops.md` — 1
- `grep -c "Q4:" README-db-ops.md` — 1
- `cd web && npx tsc --noEmit` — clean (exit 0)
- **Dry-run on missing env:** `DATABASE_URL_UNPOOLED= npx tsx scripts/seed-admin-ownership.ts` → exit 1, stderr:
  ```
  [seed-admin-ownership] DATABASE_URL_UNPOOLED is required — pull via `vercel env pull web/.env` or export in your shell
  ```

### Full-suite regression

- `cd web && npm test -- --run` — **15 files passed / 164 tests passed / 0 failed** (second run, 0.947s)
- First run showed transient parallel-worker timeout (9 failures in 5 unrelated files due to `Timeout calling "onTaskUpdate"`); second run clean. See "Issues Encountered" — not a regression.

## Threat Register Coverage

All 6 threats from the plan's `<threat_model>` are actively mitigated by code or workflow config:

| Threat ID | Category | Mitigation evidence |
|-----------|----------|---------------------|
| T-02-39 | Tampering | `VALID_ADMIN_KEYS` set built from `ADMIN_OWNER_REGISTRY` + `UNASSIGNED_ADMIN_KEY` — every entry validated before the first insert; reject writes fallback JSON |
| T-02-40 | Info Disclosure | `redactedUrl = url.replace(/:[^:@]*@/, ":<REDACTED>@")` runs before any `console.log` of the URL; GH Actions also auto-masks `secrets.DATABASE_URL_UNPOOLED` references (belt + suspenders) |
| T-02-41 | EoP (accepted) | D-21 requires seed to run with DDL-privileged URL; operator-invoked (not user-facing) |
| T-02-42 | Repudiation (mitigated in doc) | README-db-ops.md §Q4 documents idempotency-vs-edit-UI consequence + mitigation ("run once only, add guard when UI lands") |
| T-02-43 | DoS | `BATCH = 500` bounds per-insert parameter count (~1500 params / 65535 PG limit); HTTP `neon()` client is stateless per-invocation (no connection pool to exhaust) |
| T-02-44 | Spoofing | Workflow triggers only on `push` to `main` (path-filtered) + `workflow_dispatch` (requires repo write access); CODEOWNERS = `@kasheesh711` gates merges |

## Next Phase Readiness

**Phase 3 handoff:** cutover-day runbook is now a concrete invocation sequence:

1. Merge Phase 2 PR(s) to `main` → `.github/workflows/db-migrate.yml` auto-runs → migrations land in Neon before Vercel deploy picks up the new code.
2. On cutover day: `cd web && npm run db:seed-admin` populates `student_admin_ownership` from current Sheets majority-vote.
3. Verify rows: `psql $DATABASE_URL_UNPOOLED -c "SELECT admin_key, COUNT(*) FROM student_admin_ownership GROUP BY admin_key;"` — expected rough distribution per current Sheet.
4. Phase 3 SVC-* plans wire the Drizzle queries to `service.ts`; the seeded table powers the admin filter.

**Phase 2 closure:** all 10 plans complete. DB-08 + D-21 + D-22 closed. Ready for `/gsd-plan-phase 3` decomposition.

**No blockers.** Flagged items (operator must wire GH secret + provision Neon) are documented in README-db-ops.md and will surface naturally when Kevin runs the first Phase 3 PR.

## Self-Check: PASSED

Files verified:
- `web/scripts/db-migrate.ts` — FOUND
- `web/scripts/seed-admin-ownership.ts` — FOUND
- `web/scripts/README-db-ops.md` — FOUND
- `.github/workflows/db-migrate.yml` — FOUND

Commits verified:
- `9ed96f4` — FOUND in git log
- `aecedf6` — FOUND in git log
- `e8a056b` — FOUND in git log

Suite health:
- Full test suite 164/164 passing (second run; first run flaky due to vitest worker RPC timeout on unrelated test files)
- tsc --noEmit exits 0 across web/

---
*Phase: 02-data-layer*
*Completed: 2026-04-22*
