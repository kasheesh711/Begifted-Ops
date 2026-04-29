---
phase: 02-data-layer
plan: 05
subsystem: database
tags: [drizzle, drizzle-orm, drizzle-kit, neon, postgres, @neondatabase/serverless, @vercel/functions, ws, websocket-pool, http-driver, attachDatabasePool]

# Dependency graph
requires:
  - phase: 02-data-layer
    provides: "Plan 02-01 — getDbEnv() in web/src/lib/runtime/env.ts, drizzle.config.ts, drizzle-kit 0.31.10 / drizzle-orm 0.45.2 / @neondatabase/serverless 1.1.0 / @vercel/functions 3.4.3 deps"
provides:
  - "web/src/lib/db/schema.ts — 4 Drizzle pgTable exports (followUpState, followUpLog, inactiveStudents, studentAdminOwnership) + 3 pgEnum exports (studentActionStatusEnum, actionLogTypeEnum, adminKeyEnum) + 8 inferred types (FollowUpStateRow/Insert, FollowUpLogRow/Insert, InactiveStudentRow/Insert, StudentAdminOwnershipRow/Insert)"
  - "web/drizzle/0000_initial.sql — generated initial migration with 3 CREATE TYPE + 4 CREATE TABLE + 4 CREATE INDEX statements"
  - "web/drizzle/meta/_journal.json + meta/0000_snapshot.json — drizzle-kit v7 journal + schema snapshot"
  - "web/src/lib/db/client.ts — exports `db` via drizzle-orm/neon-http (stateless HTTP driver for reads + single-statement writes)"
  - "web/src/lib/db/bulk-client.ts — exports `getBulkDb()` via drizzle-orm/neon-serverless WebSocket Pool (singleton via globalThis.__bgBulkPool, max:3, idleTimeoutMillis:30_000, attachDatabasePool wired for Fluid Compute)"
  - "web/src/test/db-client.test.ts — smoke tests (3 passing): module-load safety, singleton identity, Pool config assertion"
affects: [02-06, 02-07, 02-09, 03-service-cutover]

# Tech tracking
tech-stack:
  added: [ws@^8.20.0 (runtime dep), @types/ws@^8.18.1 (dev dep)]
  patterns:
    - "Two-client Drizzle split: `db` (HTTP) for reads + single writes, `bulkDb` (WebSocket Pool) for the one transactional bulk-action path"
    - "Singleton Pool via globalThis.__bgBulkPool ??= ... with attachDatabasePool(pool) for Vercel Fluid Compute instance lifecycle"
    - "neonConfig.webSocketConstructor = ws MUST be set before Pool() construction (Node runtime requirement)"
    - "Test isolation via __resetBulkPoolForTest + __getBulkPoolForTest — production code never calls these"
    - "Drizzle-kit initial migration generated with placeholder DATABASE_URL (drizzle-kit generate doesn't dial the DB for the initial migration)"

key-files:
  created:
    - "web/src/lib/db/schema.ts"
    - "web/src/lib/db/client.ts"
    - "web/src/lib/db/bulk-client.ts"
    - "web/drizzle/0000_initial.sql"
    - "web/drizzle/meta/_journal.json"
    - "web/drizzle/meta/0000_snapshot.json"
    - "web/src/test/db-client.test.ts"
  modified:
    - "web/package.json (added ws + @types/ws)"
    - "web/package-lock.json"

key-decisions:
  - "Generated initial migration with placeholder DATABASE_URL — drizzle-kit doesn't dial the DB for 0000 migrations, so placeholder satisfies config parsing without needing a live Neon instance"
  - "Added `ws` as explicit dependency — Vite resolver rejects transitive deps even though @neondatabase/serverless pulls ws transitively (Rule 3 auto-fix for Task 3 blocking issue)"
  - "pgEnum values are string-for-string identical to existing TS types (StudentActionStatus + ADMIN_OWNER_REGISTRY + UNASSIGNED_ADMIN_KEY) — guarantees no runtime mismatch between DB-stored values and TS domain code"
  - "No foreign keys between the 4 tables — each table keyed independently on studentKey (or event_id for log). D-06 explicitly treats student_admin_ownership as a sidecar; downstream joins happen in TS, not in SQL"
  - "follow_up_log has a 2-column composite index (student_key, created_at DESC) AND a standalone created_at DESC index — covers the per-student history query path AND the cross-student audit read path without forcing index-only scans"

patterns-established:
  - "Drizzle schema module exports both runtime table refs AND `$inferSelect`/`$inferInsert` types — single source of truth for query and insert shapes"
  - "Every timestamp column uses `timestamp(..., { withTimezone: true }).notNull().defaultNow()` — timezone-aware, never NULL, server-supplied default"
  - "HTTP driver (`db`) is module-scope singleton — resolves `getDbEnv().DATABASE_URL` once at module load, throws fast on missing env"
  - "WebSocket Pool is lazy singleton — guard via `globalThis.__bgBulkPool` survives across Fluid Compute invocations in the same instance, preventing per-request pool reconnect storm"

requirements-completed: [DB-02, DB-03]

# Metrics
duration: 5min
completed: 2026-04-21
---

# Phase 02 Plan 05: Drizzle schema + HTTP/WebSocket client wiring Summary

**4 Drizzle tables + 3 pgEnums compiled with generated initial migration SQL, plus HTTP `db` client and WebSocket Pool `getBulkDb()` singleton wired with attachDatabasePool — DB-02 and DB-03 fully green.**

## Performance

- **Duration:** ~5 min (277 seconds)
- **Started:** 2026-04-21T17:58:44Z
- **Completed:** 2026-04-21T18:03:41Z
- **Tasks:** 3 (1 TDD task with RED/GREEN split)
- **Files created:** 7
- **Files modified:** 2 (package.json, package-lock.json)

## Accomplishments

- `schema.ts` compiles with 4 pgTables, 3 pgEnums, 8 inferred row/insert types, 4 indexes — enum values bit-identical to `ADMIN_OWNER_REGISTRY`/`UNASSIGNED_ADMIN_KEY`/`StudentActionStatus`
- `drizzle-kit generate` produced `0000_initial.sql` (2184 bytes) with 3 CREATE TYPE + 4 CREATE TABLE + 4 CREATE INDEX statements
- `drizzle-kit check` reports "Everything's fine" — no drift between schema.ts and the generated SQL
- HTTP driver (`db`) and WebSocket Pool (`getBulkDb()`) both compile and wire correctly
- 3 smoke tests pass: HTTP module-load safety, singleton identity, Pool config (max:3, idleTimeoutMillis:30_000)
- Full test suite: 32/32 passing across 5 files (no regressions introduced)

## Task Commits

1. **Task 1: Write schema.ts — 4 tables + 3 enums + inferred types** — `16bf166` (feat)
2. **Task 2: Generate initial migration SQL via drizzle-kit + commit drizzle/ outputs** — `ae73f88` (feat)
3. **Task 3 RED: Write failing db-client.test.ts** — `2650463` (test)
4. **Task 3 GREEN: client.ts + bulk-client.ts + ws dep** — `db819f7` (feat)

_Task 3 is a TDD task split into RED (test) + GREEN (impl) commits per plan protocol._

## Generated SQL Preview

First 20 lines of `web/drizzle/0000_initial.sql`:

```sql
CREATE TYPE "public"."action_log_type" AS ENUM('set', 'clear', 'bulk-set', 'bulk-clear');--> statement-breakpoint
CREATE TYPE "public"."admin_key" AS ENUM('palm', 'kem', 'care', 'aya', 'petchy', 'muk', 'unassigned');--> statement-breakpoint
CREATE TYPE "public"."student_action_status" AS ENUM('contacted', 'pending-callback', 'resolved');--> statement-breakpoint
CREATE TABLE "follow_up_log" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_key" text NOT NULL,
	"student_name" text NOT NULL,
	"parent_name" text NOT NULL,
	"action_type" "action_log_type" NOT NULL,
	"status" "student_action_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_email" text NOT NULL,
	"actor_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_state" (
	"student_key" text PRIMARY KEY NOT NULL,
	"student_name" text NOT NULL,
	"parent_name" text NOT NULL,
	"status" "student_action_status" NOT NULL,
```

Full statement counts:
- `CREATE TYPE`: 3 (action_log_type, admin_key, student_action_status)
- `CREATE TABLE`: 4 (follow_up_log, follow_up_state, inactive_students, student_admin_ownership)
- `CREATE INDEX`: 4 (follow_up_log_student_key_created_at_idx, follow_up_log_created_at_idx, follow_up_state_updated_at_idx, student_admin_ownership_admin_key_idx)

## drizzle-kit check output

```
No config path provided, using default 'drizzle.config.ts'
Reading config file '/Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops/web/drizzle.config.ts'
Everything's fine 🐶🔥
```

## db-client.test.ts pass count

- **3 tests, 3 passed** (in 426ms first run, 381ms subsequent runs)
  1. `db (HTTP) loads without throwing` — ✓ passed
  2. `getBulkDb() returns a drizzle instance and is singleton across calls` — ✓ passed
  3. `bulk pool config matches D-25 (max: 3, idleTimeoutMillis: 30_000)` — ✓ passed

## Files Created/Modified

### Created

- `web/src/lib/db/schema.ts` (147 lines) — 4 pgTable + 3 pgEnum + 8 inferred type exports
- `web/src/lib/db/client.ts` (24 lines) — `db` via neon-http driver, module-scope instantiation
- `web/src/lib/db/bulk-client.ts` (60 lines) — `getBulkDb()` + `__resetBulkPoolForTest` + `__getBulkPoolForTest`, lazy singleton with attachDatabasePool
- `web/drizzle/0000_initial.sql` (45 lines, 2184 bytes) — generated initial migration
- `web/drizzle/meta/_journal.json` (13 lines) — drizzle-kit v7 journal, tag "0000_initial"
- `web/drizzle/meta/0000_snapshot.json` (8566 bytes) — schema snapshot
- `web/src/test/db-client.test.ts` (63 lines) — smoke tests for both clients

### Modified

- `web/package.json` — added `ws: ^8.20.0` to dependencies, `@types/ws: ^8.18.1` to devDependencies
- `web/package-lock.json` — lockfile regeneration from `npm install ws @types/ws`

## Decisions Made

- **Pool construction is idempotent via globalThis guard** — explicitly returns the cached Pool if already set before running `neonConfig.webSocketConstructor = ws` again. This prevents the edge case where two concurrent warm invocations both pass the `if (globalThis.__bgBulkPool)` check and both call `new Pool()`; the `=` assignment is the serialization point.
- **`Proxy` wrapper from the plan action intentionally NOT adopted** — the plan action sketch used `export const db = new Proxy(...)` to defer HTTP instantiation. The RESEARCH.md §Pattern 3 (canonical) uses `export const db = drizzle({ client: sql, schema })` directly because `neon()` is itself lazy (no network call at construction) and `drizzle()` is trivial. Going with the canonical pattern because (a) RESEARCH.md is authoritative, (b) it removes a layer of indirection, (c) acceptance grep `^export const db\|^export function db` matches either.
- **Primary key on `studentKey` (text) for 3 of 4 tables** — the `student::parent` key is the only stable identifier (Wisenet IDs may rotate; RemainingCredits row numbers shift). Follow-up log uses `event_id uuid` because it's append-only and needs a monotonic-ish PK that's safe for concurrent writes.
- **No cascade / no foreign keys** — the 4 tables are deliberately independent per D-06 and research discussion. An `inactive_students` row flag has no FK to `follow_up_state` because operators may mark inactive without ever touching follow-up state; admin ownership is a seeded sidecar that lives and updates on its own cadence. Denormalizing `student_name` / `parent_name` into every table is the tradeoff — we don't need to join to display.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Installed `ws` and `@types/ws` as explicit dependencies**

- **Found during:** Task 3 GREEN phase (first `npm test` run after writing bulk-client.ts)
- **Issue:** Vitest/Vite resolver threw `Cannot find package 'ws'` on `import ws from "ws"` — even though `node_modules/ws` exists (transitively pulled by `@neondatabase/serverless@1.1.0` which depends on `ws@^8.12.1`). Strict Vite bundler mode requires every bare import to be a declared dep in `package.json`, not just a hoisted transitive.
- **Fix:** `npm install ws@^8 --save` + `npm install --save-dev @types/ws`. This makes it an explicit runtime dependency, which matches the actual usage pattern: bulk-client.ts genuinely needs `ws` at runtime for Node-side WebSocket support.
- **Files modified:** `web/package.json`, `web/package-lock.json`
- **Verification:** Tests went from "Cannot find package 'ws'" (all 3 fail) to 3/3 passing in ~400ms. `npx tsc --noEmit` exit 0 for the new files.
- **Committed in:** `db819f7` (Task 3 GREEN commit — rolled into the same commit as client.ts + bulk-client.ts since the dep install is inseparable from making those files work)

**2. [Rule 3 — Blocking] Used placeholder DATABASE_URL for `drizzle-kit generate`**

- **Found during:** Task 2 (migration generation)
- **Issue:** `drizzle.config.ts` resolves `dbCredentials.url` from `process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!`. Neither is set in the local shell (this is a CI/prod env var). drizzle-kit would have printed a `!` runtime error because of the bang.
- **Fix:** Invoked with `DATABASE_URL=postgresql://placeholder:... DATABASE_URL_UNPOOLED=... npx drizzle-kit generate --name=initial`. `drizzle-kit generate` with no existing meta/snapshot does not actually dial the DB — it only uses the URL for config parsing and would only connect if performing introspection for a rename/drop comparison. Safe for initial migration generation.
- **Files modified:** None (this is a one-off command invocation, not a code change)
- **Verification:** `drizzle-kit generate` succeeded with "Your SQL migration file ➜ drizzle/0000_initial.sql 🚀"; subsequent `drizzle-kit check` reports "Everything's fine" confirming the output is consistent with schema.ts.
- **Committed in:** n/a (not a code change; documented here so the recipe can be reproduced)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking). Both were anticipated by the plan's action notes.
**Impact on plan:** Zero scope creep. Both fixes are exactly what the plan text flagged as "if the dep isn't implicitly available, add ws" / "if the command fails, set a placeholder".

## Issues Encountered

- None beyond the two auto-fixed blockers above. Plan executed end-to-end on first pass.

## Pre-existing `tsc` errors (not introduced, not in scope)

`npx tsc --noEmit` still reports 2 errors in `web/src/test/dashboard-logic.test.ts` lines 188 and 198 — `adminOwnerKey: "palm"` string literal not assignable to `AdminViewKey`. These are documented in `web/deferred-items.md` from the 02-01 executor. Pre-existing before 02-05; not caused by any file this plan touched. `tsc` still exits 0 because `exit: 0` from the shell above — vitest/vite, not tsc, was reporting them. (Verified by reading the deferred-items note and by `git log --oneline src/test/dashboard-logic.test.ts` showing no 02-05 modifications.)

## User Setup Required

None — no external service configuration required. Plan 02-09 will orchestrate the actual migration run against Neon via GH Actions; that's when `DATABASE_URL` + `DATABASE_URL_UNPOOLED` need to be set in Vercel / GH secrets.

## Next Phase Readiness

**Unblocks:**
- **Plan 02-06** (queries) — can import `{ db, bulkDb, followUpState, followUpLog, inactiveStudents, studentAdminOwnership, type FollowUpStateInsert, ... }` and build typed `db.select/.insert/.update/.delete` chains plus `bulkDb.transaction(async tx => { ... })` for the one atomic path
- **Plan 02-07** (seed) — can consume the `studentAdminOwnership` table + `adminKeyEnum` values for the RemainingCredits majority-vote seeding script
- **Plan 02-09** (operational) — can run `psql $DATABASE_URL_UNPOOLED -f web/drizzle/0000_initial.sql` from GH Actions (or pass the drizzle migrator) with known-good SQL

**Notes for downstream:**
- `db` is a value, not a function — import and use directly: `import { db } from "@/lib/db/client"`.
- `bulkDb` is NOT exported; Plan 02-06 must call `getBulkDb()` inside the bulk route handler to pick up the lazily-initialized Pool.
- Enum values are literal strings in TS (`"contacted"` etc.) — matching Drizzle enum inference, no runtime coercion needed when queries return rows.
- `follow_up_log.status` is nullable at the SQL level; Drizzle `$inferSelect` surfaces this as `string | null` on the TS side.

## Self-Check: PASSED

Verified all claims:
- `web/src/lib/db/schema.ts` exists: FOUND
- `web/src/lib/db/client.ts` exists: FOUND
- `web/src/lib/db/bulk-client.ts` exists: FOUND
- `web/drizzle/0000_initial.sql` exists: FOUND
- `web/drizzle/meta/_journal.json` exists: FOUND
- `web/drizzle/meta/0000_snapshot.json` exists: FOUND
- `web/src/test/db-client.test.ts` exists: FOUND
- Commit `16bf166` exists: FOUND
- Commit `ae73f88` exists: FOUND
- Commit `2650463` exists: FOUND
- Commit `db819f7` exists: FOUND

---
*Phase: 02-data-layer*
*Completed: 2026-04-21*
