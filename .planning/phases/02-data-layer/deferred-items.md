# Phase 2 — Deferred items discovered during execution

## Discovered during 02-01 execution (2026-04-21)

### TSC: 2 pre-existing type errors in dashboard-logic.test.ts

**Location:** `web/src/test/dashboard-logic.test.ts` (line 188 arg, line 198 arg — both pass `studentRecords` to `attachActionStatesToStudents` / `buildDashboardModel`)

**Error:**
```
src/test/dashboard-logic.test.ts(188,34): error TS2345: Argument of type '{ ...; adminOwnerKey: string; ... }[]' is not assignable to parameter of type 'StudentRecord[]'.
  Types of property 'adminOwnerKey' are incompatible.
    Type 'string' is not assignable to type 'AdminViewKey'.
src/test/dashboard-logic.test.ts(198,7): error TS2345: Argument of type '{ ...; adminOwnerKey: string; ... }[]' is not assignable to parameter of type 'StudentRecord[]'.
  Types of property 'adminOwnerKey' are incompatible.
    Type 'string' is not assignable to type 'AdminViewKey'.
```

**Root cause:** Test literals like `adminOwnerKey: "palm"` need `as const` or `as AdminViewKey` cast. TypeScript widens string literals to `string` by default unless the target position is explicitly typed.

**Evidence it's pre-existing:**
- `web/src/test/dashboard-logic.test.ts` is untracked in git (entire `web/src/` is untracked per git status 2026-04-21)
- File was not modified by Phase 2 Plan 01 (02-01 only modified env.ts, .env.example, package.json; added env.test.ts, drizzle.config.ts, 6 fixtures)
- `adminOwnerKey`, `AdminViewKey`, and `StudentRecord` are pre-existing types unrelated to any Phase 2 change

**Scope:** Out-of-scope for 02-01 per executor role scope boundary ("Only auto-fix issues DIRECTLY caused by the current task's changes"). Logging here per GSD scope rule.

**Suggested fix path:** Phase 2 Plan 02-02 or 02-05 (whichever plans a dashboard-logic.test.ts-adjacent edit) can add `as const` on the `"palm"` literal and the 6 other admin-key literals. 5-line diff.

**Does not block:** 02-01 env.test.ts runs cleanly (9/9 passing); runtime code unaffected; fixture copies byte-identical. Phase 2 Wave 1+ plans can still import from `@/lib/runtime/env` and `@/test/fixtures/wisenet/*.json` without issue.
