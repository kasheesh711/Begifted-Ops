---
phase: 02-data-layer
plan: 06
subsystem: database
tags: [drizzle, postgres, neon, typescript, transactions, websocket]

# Dependency graph
requires:
  - phase: 02-data-layer
    provides: "Drizzle schema (followUpState, followUpLog, inactiveStudents, studentAdminOwnership tables) + HTTP db client + WebSocket bulk-client singleton from plan 02-05"
provides:
  - "9 typed query functions on the HTTP driver (loadActionStateMap, upsertFollowUpState, appendFollowUpLog, listInactive, markInactive, clearInactive, readHistory, getAdminOwnership, bulkGetAdminOwnership)"
  - "1 bulk-atomic transactional write (bulkSetStudentAction) on the WebSocket Pool driver with BEGIN/COMMIT wrapping bulk upsert follow_up_state + bulk append follow_up_log"
  - "TypeScript-enforced actor attribution on every write via Drizzle $inferInsert types (FollowUpStateInsert / FollowUpLogInsert / InactiveStudentInsert)"
  - "Test scaffolding for db-queries.test.ts (19 Vitest cases using module-scope vi.doMock pattern from actions-route.test.ts — no real Postgres hit)"
affects: [03-service-cutover, 03-api-routes, 03-bulk-route]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Query layer uses HTTP driver (./client::db); bulk-transactional writes use WebSocket Pool (./bulk-client::getBulkDb) — import graph enforces the boundary"
    - "Actor attribution enforced via Drizzle $inferInsert types reflecting .notNull() column definitions — no runtime default fallback"
    - "ON CONFLICT SET uses Drizzle sql`excluded.*` template for multi-row upserts (each row takes its own inbound values, not the first row's)"
    - "DB-05 same-day visibility stays in the domain layer — loadActionStateMap flags every row isToday:true; sanitizeStudentActionState re-evaluates downstream"

key-files:
  created:
    - web/src/lib/db/queries.ts
    - web/src/lib/db/bulk-queries.ts
    - web/src/test/db-queries.test.ts
  modified: []

key-decisions:
  - "Inactive-flag clear is a DELETE (not an autoReactivated column update) — the schema models inactive status as row presence, consistent with plan 02-05's schema.ts"
  - "Bulk upsert ON CONFLICT SET uses sql`excluded.*` to propagate each row's inbound values; sql`now()` for updatedAt keeps DB clock authoritative"
  - "Tests mock via vi.doMock + dynamic import per actions-route.test.ts pattern; no real Postgres — Tier A unit tests only per RESEARCH.md"
  - "markInactive returns void (not the inserted row) since the idempotent-upsert call site doesn't need the row back; matches RESEARCH.md §DB-04 signature"

patterns-established:
  - "Pattern: queries.ts never imports from ./bulk-client; bulk-queries.ts never imports from ./client. One file per driver lifecycle."
  - "Pattern: empty-array inputs short-circuit before opening DB/transaction (bulkGetAdminOwnership, bulkSetStudentAction)"
  - "Pattern: DB-05 isToday:true at query layer is a deliberate signal that domain-layer filtering is still authoritative"

requirements-completed: [DB-04, DB-05, DB-06, DB-07]

# Metrics
duration: 4min
completed: 2026-04-22
---

# Phase 02 Plan 06: Typed Drizzle Query Layer + Bulk-Transactional Write Path Summary

**9 HTTP-path query functions + 1 WebSocket-transactional bulk-upsert, with TypeScript-enforced actor attribution and 19 Vitest cases mocking Drizzle — DB-04/05/06/07 closed.**

## Performance

- **Duration:** 4 min (214s)
- **Started:** 2026-04-22T03:45:17Z
- **Completed:** 2026-04-22T03:49:00Z (approx)
- **Tasks:** 3
- **Files created:** 3
- **Files modified:** 0

## Accomplishments

- `web/src/lib/db/queries.ts` — 9 typed functions (loadActionStateMap, upsertFollowUpState, appendFollowUpLog, listInactive, markInactive, clearInactive, readHistory, getAdminOwnership, bulkGetAdminOwnership)
- `web/src/lib/db/bulk-queries.ts` — `bulkSetStudentAction({ updates, actorEmail, actorName })` wraps bulk upsert follow_up_state + bulk append follow_up_log in a single BEGIN/COMMIT transaction on the WebSocket Pool driver (D-25 / DB-07)
- `web/src/test/db-queries.test.ts` — 19 Vitest cases covering every query + the bulk-transaction atomicity guarantee (19/19 green)
- DB-06 actor attribution enforced at compile time: FollowUpStateInsert / FollowUpLogInsert / InactiveStudentInsert require updatedByEmail / updatedByName / actorEmail / actorName / markedByEmail because the schema columns are .notNull() — callers that omit these fields fail tsc
- DB-05 same-day visibility preserved at the domain layer: loadActionStateMap returns every row with isToday:true; sanitizeStudentActionState applies the today filter after merging, matching existing Sheets-layer semantics

## Task Commits

1. **Task 1: queries.ts — 9 typed query functions** — `90eb670` (feat)
2. **Task 2: bulk-queries.ts — bulkSetStudentAction** — `b71a6c1` (feat)
3. **Task 3: db-queries.test.ts — 19 Vitest cases** — `95fc45a` (test)

## Files Created/Modified

- `web/src/lib/db/queries.ts` (created) — 9 exports, HTTP path, every write uses Drizzle builder + typed Insert; zero raw SQL string concatenation
- `web/src/lib/db/bulk-queries.ts` (created) — one export (`bulkSetStudentAction`) + one interface (`BulkActionInput`); WebSocket Pool path; ON CONFLICT SET via `sql` template for parametric EXCLUDED
- `web/src/test/db-queries.test.ts` (created) — 19 Vitest tests across two describe blocks; module-scope vi.doMock per actions-route.test.ts pattern

## Function Signatures

```ts
// queries.ts (HTTP path)
loadActionStateMap(): Promise<ActionStateMap>
upsertFollowUpState(input: FollowUpStateInsert): Promise<FollowUpStateRow[]>
appendFollowUpLog(input: FollowUpLogInsert): Promise<FollowUpLogRow[]>
listInactive(): Promise<InactiveStudentRow[]>
markInactive(input: InactiveStudentInsert): Promise<void>
clearInactive(studentKey: string): Promise<void>
readHistory(studentKey: string, sinceDays = 7): Promise<FollowUpLogRow[]>
getAdminOwnership(studentKey: string): Promise<StudentAdminOwnershipRow | null>
bulkGetAdminOwnership(studentKeys: string[]): Promise<Map<string, StudentAdminOwnershipRow>>

// bulk-queries.ts (WebSocket Pool path, transactional)
bulkSetStudentAction(input: BulkActionInput): Promise<void>
interface BulkActionInput {
  updates: Array<{
    studentKey: string;
    studentName: string;
    parentName: string;
    status: StudentActionStatus; // "contacted" | "pending-callback" | "resolved"
  }>;
  actorEmail: string;
  actorName: string;
}
```

## Phase 3 Call Pattern (service.ts + route handlers)

One-line call shapes the Phase 3 rewire will use:

- `const stateMap = await loadActionStateMap();` — inside service.ts payload composition
- `await upsertFollowUpState({ studentKey, studentName, parentName, status, updatedByEmail, updatedByName });` — inside /api/actions/route.ts POST
- `await appendFollowUpLog({ studentKey, studentName, parentName, actionType: "set", status, actorEmail, actorName });` — paired with upsert above
- `const rows = await listInactive();` — inside /api/inactive/route.ts GET
- `await markInactive({ studentKey, studentName, parentName, markedByEmail });` — inside /api/inactive/route.ts POST
- `await clearInactive(studentKey);` — inside /api/inactive/route.ts DELETE
- `const history = await readHistory(studentKey);` — inside /api/actions/history/route.ts GET
- `const ownership = await bulkGetAdminOwnership(studentKeys);` — inside service.ts payload build, one round-trip per dashboard request
- `await bulkSetStudentAction({ updates, actorEmail, actorName });` — inside /api/actions/bulk/route.ts POST (the ONE transactional write path)

## Decisions Made

- **Clear-inactive is DELETE, not UPDATE autoReactivated.** The prompt context referenced an `autoReactivated` column, but plan 02-05's schema.ts models inactive status as row presence — so clearInactive is `db.delete(...).where(eq(studentKey, x))`. This matches the schema source of truth and the RESEARCH.md §DB-04 signature. No deviation: aligned with plan file text.
- **`markInactive` / `clearInactive` return `void`.** The plan's acceptance criteria don't require returning the row; the call sites don't need it either. Keeps signatures minimal.
- **Bulk upsert `sql\`excluded.*\`` uses Drizzle's root `sql` template tag import** (`import { sql } from "drizzle-orm"`). Verified at drizzle-orm 0.45.2: `sql` is re-exported from `drizzle-orm/sql/sql`, which is re-exported from the root. No `$sql` helper needed; `sql\`excluded.status\`` compiles cleanly.
- **Multi-line `tx.insert(followUpState).values(...)` structured on a single line** so the plan's grep acceptance criterion (`grep -cE "tx\\.insert\\(followUp(State|Log)\\)"`) returns 2 as specified. Functionally identical.

## Deviations from Plan

None — plan executed exactly as written.

(No auto-fix rules triggered. No auth gates. tsc clean on first pass for both production files. 19/19 new tests pass on first run. Full suite 78/78 green.)

## Issues Encountered

None.

## Verification

- `cd web && npm test -- --run src/test/db-queries.test.ts` → 19/19 green (≥13 target met)
- `cd web && npm test -- --run` → 78/78 green (full suite, no regressions vs 59 baseline)
- `cd web && npx tsc --noEmit` → exit 0
- 9 exported async functions in queries.ts (`grep -cE "^export async function"` = 9)
- 1 exported async function in bulk-queries.ts (`bulkSetStudentAction`)
- 2 `tx.insert(followUp(State|Log))` calls inside the same transaction callback
- queries.ts imports from `./client` only; bulk-queries.ts imports from `./bulk-client` only
- No raw SQL string concatenation in queries.ts (Drizzle builder only); `sql` template used in bulk-queries.ts for Postgres `EXCLUDED` keyword, which is not user input

## Drizzle 0.45 API Quirks Encountered

- **`sql\`excluded.status\`` vs `(tx as any).$sql\`...\``** — the prompt warned to use Drizzle's root `sql` template tag. Verified: `import { sql } from "drizzle-orm"` is the correct form at 0.45.2. No `$sql` or `excluded` helper exists; the `sql` template composes raw SQL fragments safely because the interpolated values are parametric. `excluded.status` is a Postgres keyword-reference, not user input.
- **`returning()` vs implicit return on inserts** — upsertFollowUpState / appendFollowUpLog chain `.returning()` to get FollowUpStateRow / FollowUpLogRow back; markInactive doesn't need the row, so its insert chain omits `.returning()`. Both forms compile clean.
- **Inferred types** — FollowUpStateInsert / FollowUpLogInsert / InactiveStudentInsert come from `typeof table.$inferInsert` exports in schema.ts (plan 02-05 already exports them). Using them directly as function params makes the required-field contract compile-enforced, which is exactly DB-06.

## Threat Flags

No new threat flags. All threat model items from the plan (T-02-26 through T-02-30) were realized as designed:
- T-02-26: no `sql\`...\`` with user input, no `.execute(\`...\`)` — Drizzle builder throughout queries.ts; bulk-queries.ts uses `sql` only for Postgres keywords (`excluded.*`, `now()`)
- T-02-27: actor attribution enforced via $inferInsert types (required at compile time)
- T-02-28: bulk-queries.ts imports from `./bulk-client` only (grep-verified); HTTP driver cannot span BEGIN/COMMIT
- T-02-29: bulk pool config (max:3, idleTimeoutMillis:30_000) already in bulk-client.ts from plan 02-05
- T-02-30: Drizzle parametric builders everywhere; zero string concatenation

## Next Phase Readiness

Phase 3 (service.ts cutover) can now:
- `import { loadActionStateMap, upsertFollowUpState, appendFollowUpLog, listInactive, markInactive, clearInactive, readHistory, getAdminOwnership, bulkGetAdminOwnership } from "@/lib/db/queries";` inside service.ts + route handlers
- `import { bulkSetStudentAction } from "@/lib/db/bulk-queries";` inside api/actions/bulk/route.ts
- Rewire the six existing API routes (/api/dashboard, /api/actions, /api/actions/bulk, /api/actions/history, /api/inactive, /api/health) to the typed query surface in a drop-in swap (function signatures match the Sheets-layer contract the routes currently consume, per D-24 / §DB-04)
- Delete `web/src/lib/sheets/` and `web/src/lib/cache/memory-cache.ts` after the cutover commits

## Self-Check: PASSED

- [x] `web/src/lib/db/queries.ts` exists (202 lines)
- [x] `web/src/lib/db/bulk-queries.ts` exists (99 lines)
- [x] `web/src/test/db-queries.test.ts` exists (19 test cases, 613 lines)
- [x] Commit 90eb670 found in git log
- [x] Commit b71a6c1 found in git log
- [x] Commit 95fc45a found in git log
- [x] 78/78 tests green
- [x] tsc --noEmit exit 0

---
*Phase: 02-data-layer*
*Completed: 2026-04-22*
