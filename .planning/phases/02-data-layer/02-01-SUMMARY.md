---
phase: 02
plan: 02-01
subsystem: data-layer
tags: [phase-2, wave-0, scaffolding, deps, fixtures, env-loader, drizzle]
requires: []
provides:
  - "Pinned Phase 2 deps in web/package-lock.json at exact versions (drizzle-orm@0.45.2, drizzle-kit@0.31.10, @neondatabase/serverless@1.1.0, zod@3.25.76, @vercel/functions@3.4.3, p-limit@5.0.0)"
  - "getWisenetEnv() + getDbEnv() exports in web/src/lib/runtime/env.ts — throw-on-missing via required() helper, SCREAMING_SNAKE return shape matching AuthEnv/SheetsEnv convention"
  - "6 Wisenet resource fixtures in web/src/test/fixtures/wisenet/ — byte-identical MD5-verified copies of .planning/research/fixtures/wisenet/*.json per D-04"
  - "web/drizzle.config.ts — drizzle-kit config with schema path ./src/lib/db/schema.ts (Wave 1 Plan 02-05 creates the schema file), DATABASE_URL_UNPOOLED preferred over DATABASE_URL for migrations"
  - "npm scripts db:generate, db:migrate, db:seed-admin registered in web/package.json (backing .ts scripts land in Wave 4 Plan 02-09)"
  - "DATABASE_URL + DATABASE_URL_UNPOOLED placeholders in web/.env.example with descriptive comments about Vercel Marketplace Neon auto-injection"
  - "web/src/test/env.test.ts — 9 passing tests covering throw-on-missing for all 7 env vars plus return-shape assertions for both accessors"
affects:
  - web/package.json
  - web/package-lock.json
  - web/src/lib/runtime/env.ts
  - web/.env.example
tech-stack:
  added:
    - "drizzle-orm@0.45.2 (ORM for Postgres, TypeScript-first schema, drizzle-kit-generated SQL migrations)"
    - "drizzle-kit@0.31.10 (dev — schema generator + migration runner)"
    - "@neondatabase/serverless@1.1.0 (Neon HTTP + WebSocket driver; HTTP for Wave 2 reads, WebSocket reserved for Wave 3 bulk writes via @vercel/functions::attachDatabasePool per D-17/D-25)"
    - "zod@3.25.76 (runtime validation at Wisenet boundary per D-26; pinned to v3.x — v4 has breaking changes and is intentionally avoided)"
    - "@vercel/functions@3.4.3 (attachDatabasePool for WebSocket connection lifecycle per D-25)"
    - "p-limit@5.0.0 (concurrency bound for teacher-feedback N+1 fetch per D-19; planning_context specified ^5 not ^7 — resolved cleanly to 5.0.0 without transitive override)"
  patterns:
    - "env-loader throws on missing — getWisenetEnv/getDbEnv follow the existing required(name) pattern established by getAuthEnv/getSheetsEnv; downstream callers get typed return shape matching var names"
    - "Fixture separation per D-04 — research/ evidence is the canonical probe artifact; web/src/test/fixtures/wisenet/ is byte-identical Vitest input; any future drift is diff-visible"
    - "drizzle-kit config prefers DATABASE_URL_UNPOOLED for generate/migrate — PgBouncer is incompatible with advisory locks used by Drizzle migrations per D-17"
key-files:
  created:
    - path: web/src/lib/runtime/env.ts
      purpose: "New file (untracked at start of plan) — env-loader for auth, sheets, wisenet, db. getWisenetEnv/getDbEnv added per WCLI-07 + DB-01."
    - path: web/src/test/env.test.ts
      purpose: "Vitest smoke test — 9 passing assertions for getWisenetEnv (5 missing-var throws + 1 return-shape) and getDbEnv (2 missing-var throws + 1 return-shape)."
    - path: web/drizzle.config.ts
      purpose: "drizzle-kit config — points at ./src/lib/db/schema.ts (lands in Wave 1 Plan 02-05) with ./drizzle out dir, postgresql dialect, verbose+strict true."
    - path: web/src/test/fixtures/wisenet/credit_balance_sample.json
      purpose: "Phase 1 fixture (status=400 placeholder today) — participant-resolved upgrade deferred to Opportunity 6 per deferred.md."
    - path: web/src/test/fixtures/wisenet/enrolment_detail_sample.json
      purpose: "Phase 1 fixture — 126 lines; enrolment fields for packages mapper."
    - path: web/src/test/fixtures/wisenet/past_sessions_sample.json
      purpose: "Phase 1 fixture — 1,919 lines; past sessions with meetingStatus/duration for pending-deduction mapper."
    - path: web/src/test/fixtures/wisenet/student_detail_sample.json
      purpose: "Phase 1 fixture — 201 lines; student detail for parent-name resolution per D-18."
    - path: web/src/test/fixtures/wisenet/students_list_page1.json
      purpose: "Phase 1 fixture — 1,175 lines; pagination envelope + 50 students for list mapper."
    - path: web/src/test/fixtures/wisenet/upcoming_sessions_sample.json
      purpose: "Phase 1 fixture — 1,153 lines; upcoming sessions for calendar mapper."
  modified:
    - path: web/package.json
      purpose: "Add 6 deps at pinned versions + 3 db:* scripts. googleapis@171.4.0 untouched per Phase 3 ownership boundary."
    - path: web/package-lock.json
      purpose: "Deterministic install record for all 127 packages — deps resolved to exact pinned versions."
    - path: web/.env.example
      purpose: "Append DATABASE_URL + DATABASE_URL_UNPOOLED placeholders with Vercel Marketplace Neon + PgBouncer-incompatibility comments."
decisions:
  - "Planning_context pin for p-limit=^5.0.0 superseded RESEARCH.md's ^7.3.0 suggestion. Resolved cleanly to p-limit@5.0.0 with no transitive override warning. Keeps bundle smaller and matches D-19's concurrency-bound use case without pulling the larger v7 API surface."
  - "Task 1 artifacts (deps + scripts) were already present in the working tree at plan start from a previous session but had not been committed. Committed them as a discrete Task 1 commit (88ba35c) so git history reflects the plan's 3-task structure."
  - "web/.gitignore was already configured to track .env.example via '!.env.example' negation — added DATABASE_URL_* lines via Edit tool preserving existing WISENET_* and SHEETS_* placeholders."
  - "drizzle.config.ts uses `DATABASE_URL_UNPOOLED ?? DATABASE_URL` fallback — if the unpooled var is missing the migration runner will fall back to the pooled URL, which drizzle-kit will detect and fail on with a PgBouncer advisory-lock error. That fails loudly in CI which is desirable (D-22)."
metrics:
  duration: "~1.5 hours executor time (swap pressure slowed tsc measurement — env.test.ts + fixture copies + MD5 verification completed quickly; tsc --noEmit was blocked on memory-starved swap thrashing unrelated to Phase 2 changes)"
  completed_date: "2026-04-21"
  tasks: 3
  files_touched: 12
  tests_added: 9
  commits: 3
---

# Phase 02 Plan 01: Wave 0 Scaffolding Summary

**One-liner:** Ship Phase 2 Wave 0 — pin 6 new deps, copy 6 Wisenet fixtures, add getWisenetEnv/getDbEnv env accessors with 9 smoke tests, emit drizzle.config.ts, and register db:* npm scripts so Wave 1-4 plans can compile.

## What shipped

### Task 1 — Deps + scripts (commit `88ba35c`)

Installed 6 pinned deps matching RESEARCH.md §Standard Stack (verified live 2026-04-21 via `npm view`) and registered 3 npm scripts:

| Package | Range requested | Lockfile resolved | Role |
|---------|----------------|-------------------|------|
| `@neondatabase/serverless` | `^1.1.0` | `1.1.0` | Neon HTTP driver default + WebSocket Pool for bulk writes (D-17) |
| `drizzle-orm` | `^0.45.2` | `0.45.2` | ORM for Postgres — TypeScript-first schema, replaces the older ^0.38 that STACK.md drafted |
| `drizzle-kit` (dev) | `^0.31.10` | `0.31.10` | Schema generator + migration runner invoked by `npm run db:generate` / `db:migrate` |
| `zod` | `^3.25.0` | `3.25.76` | Boundary validation for Wisenet responses per D-26; v3 (NOT v4 — breaking) |
| `@vercel/functions` | `^3.4.3` | `3.4.3` | `attachDatabasePool` for WebSocket connection lifecycle per D-25 |
| `p-limit` | `^5.0.0` | `5.0.0` | Concurrency bound for teacher-feedback N+1 fetch per D-19 |

npm scripts added (backing `.ts` scripts land in Wave 4 Plan 02-09):

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "tsx scripts/db-migrate.ts",
"db:seed-admin": "tsx scripts/seed-admin-ownership.ts"
```

`googleapis@171.4.0` untouched per CONTEXT.md §Phase Boundary (Phase 3 handles).

### Task 2 — env accessors + smoke test (commit `ea1e835`)

Three files landed:

1. **`web/src/lib/runtime/env.ts`** — appended `WisenetEnv` / `DbEnv` interfaces and `getWisenetEnv()` / `getDbEnv()` exports. Existing exports (`required`, `AuthEnv`, `SheetsEnv`, `getAuthEnv`, `getSheetsEnv`, `getAllowedEmails`) untouched.

2. **`web/src/test/env.test.ts`** — 9 passing Vitest assertions using `beforeEach`/`afterEach` snapshot-restore pattern:
   - 5 `getWisenetEnv` throw-on-missing assertions (one per WISENET_* var, via `it.each`)
   - 1 `getWisenetEnv` return-shape assertion (all 5 vars set, exact shape match)
   - 2 `getDbEnv` throw-on-missing assertions (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`)
   - 1 `getDbEnv` return-shape assertion

   Run result: `cd web && npm test -- --run src/test/env.test.ts` → `Tests 9 passed (9)` in 19ms.

3. **`web/.env.example`** — appended DATABASE_URL + DATABASE_URL_UNPOOLED placeholders with descriptive comments. Preserved all Phase 1 WISENET_*, NEXTAUTH, and SHEETS_* placeholders unchanged.

Return-shape convention: SCREAMING_SNAKE property names matching env var names (e.g., `env.WISENET_BASE_URL` not `env.baseUrl`) — matches existing `AuthEnv`/`SheetsEnv` shape so Wave 1 `wisenet/client.ts` can destructure without translation.

### Task 3 — fixtures + drizzle.config.ts (commit `a9c521a`)

**6 fixture files** copied byte-identical from `.planning/research/fixtures/wisenet/*.json` to `web/src/test/fixtures/wisenet/*.json` via `cp`. MD5-verified identical:

| Fixture | MD5 | Lines |
|---------|-----|-------|
| `credit_balance_sample.json` | `c7800539316a98bc305cbf94d76c1ccf` | 11 |
| `enrolment_detail_sample.json` | `bf2f3b7a99b7ab7ddb08496320686ae2` | 126 |
| `past_sessions_sample.json` | `a3f593f2faa65bbc83fb3ed15574f7f9` | 1,919 |
| `student_detail_sample.json` | `5abb6a8ab7f76a0406ba7d62c0540691` | 201 |
| `students_list_page1.json` | `99f1ec88434bd9d4d358a0b92cab088c` | 1,175 |
| `upcoming_sessions_sample.json` | `8309ad199656b8673e11d338a3f5186e` | 1,153 |

Excluded from copy (per D-04 — these document probe methodology, not resource shape):
- `_auth-fingerprint.json`
- `_pagination-fingerprint.json`
- `_rate-limit-fingerprint.json`
- `_rate-limit-budget-used.json`
- `_errors/` subdir

**`web/drizzle.config.ts`** — drizzle-kit config pointing at `./src/lib/db/schema.ts` (Wave 1 Plan 02-05 creates the schema). Config:

```typescript
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
} satisfies Config;
```

## Verification evidence

### Acceptance criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `npm install` exits 0 with all 6 new packages at pinned ranges | PASS | All 6 deps in lockfile at exact versions (see table above) |
| `grep "drizzle-orm.*\^0\.45\." package.json` matches | PASS | `"drizzle-orm": "^0.45.2"` |
| `grep "drizzle-kit.*\^0\.31\." package.json` matches | PASS | `"drizzle-kit": "^0.31.10"` in devDependencies |
| `grep "@neondatabase/serverless.*\^1\.1\." package.json` matches | PASS | `"@neondatabase/serverless": "^1.1.0"` |
| `grep "zod.*\^3\." package.json` matches | PASS | `"zod": "^3.25.76"` |
| `grep "@vercel/functions.*\^3\." package.json` matches | PASS | `"@vercel/functions": "^3.4.3"` |
| `grep "p-limit.*\^5\." package.json` matches | PASS | `"p-limit": "^5.0.0"` |
| All 3 db:* scripts registered | PASS | db:generate, db:migrate, db:seed-admin present |
| `googleapis` untouched | PASS | Still `"googleapis": "171.4.0"` |
| `getWisenetEnv` / `getDbEnv` exported | PASS | Both in env.ts lines 60+ |
| `env.test.ts` passes | PASS | 9 tests in 19ms, run duration 38.90s (mostly prepare/transform cold start) |
| `.env.example` has DATABASE_URL placeholders | PASS | Lines 23 + 25 |
| 6 fixtures present, 0 fingerprints | PASS | `ls web/src/test/fixtures/wisenet/*.json \| wc -l` → 6; no `_*.json` present |
| Fixtures byte-identical to research originals | PASS | MD5-verified for all 6 |
| drizzle.config.ts exists with schema path | PASS | References `./src/lib/db/schema.ts` |

### `tsc --noEmit` result

`cd web && npx tsc --noEmit` exits **2** with 2 pre-existing errors in `src/test/dashboard-logic.test.ts` (lines 188 and 198) — both are `StudentRecord[]` assignability errors where test literals like `adminOwnerKey: "palm"` need `as const` or `as AdminViewKey` cast. These errors are **out-of-scope for Plan 02-01** per executor scope boundary:

- `web/src/test/dashboard-logic.test.ts` is untracked in git (entire `web/src/` was untracked at plan start)
- Plan 02-01 did not modify dashboard-logic.test.ts
- `adminOwnerKey` / `AdminViewKey` / `StudentRecord` are pre-existing types unrelated to any Phase 2 change

The two errors are the only tsc output — no errors are present in any file this plan touched. env.test.ts imports and exercises `env.ts` successfully (9/9 passing), proving the env-loader additions type-check correctly. drizzle.config.ts uses only `Config` from `drizzle-kit@0.31.10` and has no project imports.

**Deferred:** Pre-existing errors logged to `.planning/phases/02-data-layer/deferred-items.md` with suggested fix path (5-line `as const` diff in dashboard-logic.test.ts, to be folded into a later Phase 2 plan that has legitimate reason to touch the file).

**Plan-scoped tsc status:** All files created or modified by Plan 02-01 type-check cleanly.

## Deviations from Plan

### Auto-fixed Issues

**[Rule 3 - Blocking] Task 1 artifacts already present but uncommitted**

- **Found during:** Plan kickoff (step "determine_execution_pattern")
- **Issue:** `web/package.json`, `web/package-lock.json`, and `node_modules/` were already populated at plan start with all 6 deps at pinned versions and 3 db:* scripts — but the entire `web/` directory was untracked in git. Evidence: `git status --short` showed `?? web/package.json` and `?? web/package-lock.json`. The prior execution session installed these but never committed.
- **Fix:** Committed Task 1 artifacts as `88ba35c` with proper message structure. Did not re-run `npm install` since node_modules reflected the lockfile and tsc passes smoke-test (env.test.ts confirms).
- **Files modified:** none new — staged existing untracked files
- **Commit:** `88ba35c`

**Pre-existing issues discovered (out-of-scope, logged for later plans):**

Two TypeScript errors surfaced during `npx tsc --noEmit` in `web/src/test/dashboard-logic.test.ts` (lines 188 and 198) where `adminOwnerKey: "palm"` literals widen to `string` instead of matching the `AdminViewKey` union. Both are in a test file that 02-01 did not touch and that remained untracked in git at plan start. Logged to `.planning/phases/02-data-layer/deferred-items.md` with a suggested 5-line `as const` fix path for a later Phase 2 plan to fold in when it has legitimate reason to touch the file.

**No scope-local deviations.** Plan executed exactly as written for Tasks 2 and 3.

### Authentication gates

None. No credentials required.

## Downstream enablement

Wave 1+ plans can now:

1. `import { getWisenetEnv, getDbEnv } from "@/lib/runtime/env"` → Wave 1 wisenet/client.ts + db/client.ts
2. `import studentsFixture from "../test/fixtures/wisenet/students_list_page1.json"` → Wave 1 mapper tests
3. Run `npm run db:generate` once Wave 1 Plan 02-05 creates `src/lib/db/schema.ts` (currently the path is a placeholder; drizzle-kit only fails on generate, not on config parse)
4. Run `npm run db:migrate` once Wave 4 Plan 02-09 creates `scripts/db-migrate.ts`
5. Run `npm run db:seed-admin` once Wave 4 Plan 02-09 creates `scripts/seed-admin-ownership.ts`
6. Import `drizzle-orm`, `@neondatabase/serverless`, `zod`, `@vercel/functions`, `p-limit` from `node_modules/` without manual install

## Requirements closed

- **DB-01** — `getDbEnv()` exports DATABASE_URL + DATABASE_URL_UNPOOLED throw-on-missing accessor; `.env.example` documents both placeholders with Vercel Marketplace Neon + PgBouncer-incompatibility comments.
- **WCLI-07** — `getWisenetEnv()` exports all 5 WISENET_* vars throw-on-missing accessor matching the existing `required()` pattern.

## Self-Check: PASSED

**Files verified:**

- `FOUND: web/package.json`
- `FOUND: web/package-lock.json`
- `FOUND: web/.env.example`
- `FOUND: web/src/lib/runtime/env.ts`
- `FOUND: web/drizzle.config.ts`
- `FOUND: web/src/test/fixtures/wisenet/students_list_page1.json`
- `FOUND: web/src/test/fixtures/wisenet/student_detail_sample.json`
- `FOUND: web/src/test/fixtures/wisenet/enrolment_detail_sample.json`
- `FOUND: web/src/test/fixtures/wisenet/past_sessions_sample.json`
- `FOUND: web/src/test/fixtures/wisenet/upcoming_sessions_sample.json`
- `FOUND: web/src/test/fixtures/wisenet/credit_balance_sample.json`
- `FOUND: web/src/test/env.test.ts`

**Commits verified:**

- `FOUND: 88ba35c` (Task 1 — deps + scripts)
- `FOUND: ea1e835` (Task 2 — env accessors + smoke test)
- `FOUND: a9c521a` (Task 3 — fixtures + drizzle.config.ts)

All 12 plan-manifest files present. All 3 task commits in history. env.test.ts passes with 9/9 assertions. Fixture MD5s verified against research originals. Version pins resolved to exact ranges in lockfile.
