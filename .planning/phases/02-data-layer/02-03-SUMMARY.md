---
phase: 02-data-layer
plan: 03
subsystem: api
tags: [wisenet, endpoints, pagination, zod, fetch, async-generator]

# Dependency graph
requires:
  - phase: 02-02
    provides: wisenetFetch<T>(path, schema, init?) chokepoint + WisenetError + __resetAuthHeaderCacheForTest
  - phase: 02-02
    provides: 11 Zod schemas (WisenetStudentsListSchema, WisenetStudentDetailSchema, WisenetParentsListSchema, WisenetSessionsListSchema, WisenetClassSchema, WisenetSessionCreditsSchema, plus inferred types WisenetStudent/WisenetSession/WisenetParent)
  - phase: 02-01
    provides: getWisenetEnv() loader + 6 PII-scrubbed fixtures under web/src/test/fixtures/wisenet/
provides:
  - 7 resource functions in a single flat endpoints.ts (D-26) — getStudents, getStudent, getParents, getClass, getPastSessions, getUpcomingSessions, getSessionCredits
  - Internal paginate<TResponse, TItem>() async generator with short-page termination (records.length < PAGE_SIZE)
  - Exported PAGE_SIZE constant (= 50) matching Phase 1 empirical default
  - Exported __paginateForTest alias for test access
  - encodeURIComponent on every dynamic URL segment (centerId, studentId, classId, parentIds, resolvedStudentId)
  - Corrected Students path /institutes/v3/{center}/students (no trailing `s` — Postman typo fixed inline)
  - Sessions path with status/paginateBy=DATE/startDate/endDate ISO-YYYY-MM-DD query params
  - sessionCredits path at /institutes/{center}/classes/{classId}/students/{resolvedStudentId}/sessionCredits?fetchHistory=true
  - getParents returns Map<id, name> with per-call scope (no module-global parent cache — T-02-15)
affects: [02-04-mappers, 02-06, 03-service-cutover, WCLI-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Resource-per-function module (D-26): single endpoints.ts, one exported async function per Wisenet resource, every function routes through wisenetFetch + a Zod schema"
    - "Async generator pagination with short-page termination — yields TItem[] per page, returns on records.length < PAGE_SIZE"
    - "Per-call scoped caches only (T-02-15) — getParents dedupes via Set, no module-level state"
    - "URL construction via encodeURIComponent on every dynamic segment (T-02-12/13)"
    - "Date query params as YYYY-MM-DD ISO via Date.toISOString().slice(0, 10) for sessions endpoints"

key-files:
  created:
    - web/src/lib/wisenet/endpoints.ts (144 lines, 7 resource functions + paginate + PAGE_SIZE + formatDate + encodeCenter)
    - web/src/test/wisenet-endpoints.test.ts (197 lines, 10 Vitest cases)
  modified: []

key-decisions:
  - "Kept Task 1 implementation verbatim from plan — no schema name adaptations needed (02-02 exported the expected 6 list/detail schemas and inferred types)"
  - "Test-side URL extraction via `new URL(fetch.mock.calls[i][0])` because wisenetFetch invokes fetch with a URL object (not string) — URL constructor accepts URL | string"
  - "Reused wisenet-client.test.ts pattern for env snapshot/restore + __resetAuthHeaderCacheForTest + vi.stubGlobal('fetch', vi.fn())"
  - "Added explicit path-typo negative assertion in Test 1 (expect url.pathname NOT to contain 'center-XYZs/students')"

patterns-established:
  - "D-26 implementation: one async function per Wisenet resource, single-file layout matching web/src/lib/sheets/source-loader.ts — downstream Plan 02-04 mappers can now import { getStudents, getStudent, getParents, getClass, getPastSessions, getUpcomingSessions, getSessionCredits, PAGE_SIZE }"
  - "Paginate generator is reusable — future endpoint work (e.g., sessions-credits history) can reuse the same helper when a new list endpoint lands"
  - "Per-call cache scoping makes mapper callers responsible for cache lifecycle (Plan 02-04 mapper calls getParents once per student batch)"

requirements-completed: [WCLI-03]

# Metrics
duration: 16min
completed: 2026-04-22
---

# Phase 02 Plan 03: Wisenet endpoints.ts Summary

**7 async resource functions in a single flat endpoints.ts with short-page-termination paginate generator, corrected Postman path typo inline, and ISO date-window query params on the sessions endpoints — ready for Plan 02-04 mappers to consume.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-04-22T03:23:29Z
- **Completed:** 2026-04-22T03:39:40Z
- **Tasks:** 2
- **Files modified:** 2 (both created new)

## Accomplishments

- Shipped the single-file endpoints.ts per D-26 with 7 exported async resource functions (getStudents, getStudent, getParents, getClass, getPastSessions, getUpcomingSessions, getSessionCredits) plus PAGE_SIZE = 50 and an internal paginate<TResponse, TItem>() async generator.
- Hardened pagination against unbounded loops: termination rule `items.length < PAGE_SIZE` (matches _pagination-fingerprint.json) plus fetch-failure propagation via WisenetError (T-02-14 mitigation).
- Applied encodeURIComponent to every dynamic URL segment (6 call sites) — T-02-12/13 path-injection + query-injection guards.
- Kept parent lookup per-call scoped (deduped via Set), no module-global cache (T-02-15 Pitfall 5).
- Inlined the Phase 1 Postman catalogue path typo fix (`/institutes/v3/{center}/students` with no trailing `s` on the centerId segment) with an explicit negative-assertion test.
- Landed 10 Vitest cases covering URL construction, page iteration (2-page + 1-page + first-page-short), encoded student IDs, ISO date windows, status=PAST vs FUTURE, and the sessionCredits/fetchHistory contract.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write endpoints.ts with 7 resource functions + paginate generator** — `07a68af` (feat)
2. **Task 2: Write wisenet-endpoints.test.ts — URL construction + pagination** — `a7ad837` (test)

## Files Created/Modified

- `web/src/lib/wisenet/endpoints.ts` (NEW, 144 lines) — 7 resource functions + PAGE_SIZE + paginate async generator + formatDate/encodeCenter helpers + __paginateForTest alias
- `web/src/test/wisenet-endpoints.test.ts` (NEW, 197 lines) — 10 test cases with env snapshot/restore, URL-from-mock extraction helper, sample row factories for students + sessions

## Evidence — Path-typo fix applied

```
$ grep -n "/institutes/v3/.*/students" web/src/lib/wisenet/endpoints.ts
63:    `/institutes/v3/${encodeCenter()}/students?page_number=${p}&page_size=${PAGE_SIZE}`;

$ grep -n "institutes/v3/.*}s/students" web/src/lib/wisenet/endpoints.ts
(no matches — negative check passes, trailing `s` typo NOT present)

$ grep -n "institutes/v3/center-XYZs" web/src/test/wisenet-endpoints.test.ts
(no matches — test fixtures also free of the typo)
```

Explicit negative assertion lives at test 1 (`expect(url.pathname).not.toContain("center-XYZs/students")`).

## Evidence — 7 functions exported

```
$ grep "^export async function" web/src/lib/wisenet/endpoints.ts | wc -l
7
```

Exports: `getStudents`, `getStudent`, `getParents`, `getClass`, `getPastSessions`, `getUpcomingSessions`, `getSessionCredits`.

## Evidence — Test count

```
$ npm test -- --run src/test/wisenet-endpoints.test.ts
✓ src/test/wisenet-endpoints.test.ts (10 tests) 43ms
Tests  10 passed (10)
```

All 10 assertions green. Full suite (`npm test -- --run`): 59 tests passed across 9 test files — no regressions introduced by this plan.

```
$ npx tsc --noEmit
(exit 0 — no type errors)
```

## Function signatures exported

```ts
export const PAGE_SIZE = 50;
export async function getStudents(): Promise<WisenetStudent[]>;
export async function getStudent(studentId: string);
export async function getParents(parentIds: string[]): Promise<Map<string, string>>;
export async function getClass(classId: string);
export async function getPastSessions(startDate: Date, endDate: Date): Promise<WisenetSession[]>;
export async function getUpcomingSessions(startDate: Date, endDate: Date): Promise<WisenetSession[]>;
export async function getSessionCredits(classId: string, resolvedStudentId: string);
export { paginate as __paginateForTest };
```

## Downstream contracts for Plan 02-04 mappers

Plan 02-04 (WCLI-04) can now:

- `import { getStudents, getStudent, getParents, getClass, getPastSessions, getUpcomingSessions, getSessionCredits, PAGE_SIZE } from "@/lib/wisenet/endpoints"`
- Call `getStudents()` to retrieve the full paginated active-student list (mapper is responsible for calling `getStudent(id)` for per-student detail lookups that provide `parentIds`).
- Call `getParents(uniqueParentIds)` once per batch — the function dedupes internally and returns a `Map<id, name>` for lookup (D-18 2-step join).
- Call `getPastSessions(startDate, endDate)` / `getUpcomingSessions(startDate, endDate)` with ISO Date windows — the function emits `YYYY-MM-DD` on the query string automatically.
- Call `getSessionCredits(classId, resolvedStudentId)` ONLY with a participant-resolved student_id — arbitrary student+class pairs still return 400 per Phase 1 01-03; the mapper must resolve via `/user/classes/{classId}/participants` before calling (Opportunity 6 upgrade path).

## Schema Name Mismatches Resolved

**None.** Plan 02-02 exported all schemas under exactly the names this plan imports. A pre-flight read of `web/src/lib/wisenet/types.ts` confirmed:

| Plan expected | Exported (verified) |
| --- | --- |
| `WisenetStudentsListSchema` | ✓ |
| `WisenetStudentDetailSchema` | ✓ |
| `WisenetParentsListSchema` | ✓ |
| `WisenetSessionsListSchema` | ✓ |
| `WisenetClassSchema` | ✓ |
| `WisenetSessionCreditsSchema` | ✓ |
| `WisenetStudent` (type) | ✓ |
| `WisenetSession` (type) | ✓ |

No import adjustments required.

## Decisions Made

None — plan executed exactly as written. The `<action>` block in Task 1 lists `type WisenetStudent, type WisenetSession` imports and the shipped file imports both; plan's test shape matches the shipped 10 cases 1:1.

## Deviations from Plan

**None — plan executed exactly as written.**

No Rule 1 (bug), Rule 2 (missing critical), Rule 3 (blocking), or Rule 4 (architectural) deviations triggered. The plan pre-engineered the T-02-12/13/14/15 mitigations, the path-typo fix, the per-call parent cache scoping, and the `items.length < PAGE_SIZE` termination, so no auto-fixes were needed.

## Issues Encountered

### Cold-start vitest cache issue (self-resolving)

**Symptom:** First invocation of `npm test -- --run src/test/wisenet-endpoints.test.ts` failed with `TypeError: pico is not a function` at `node_modules/picomatch/index.js:13` during vite config resolution; subsequent runs cleared the error and all 10 tests passed consistently.

**Diagnosis:** Caused by an npm-install warm-up state where vite's dynamic require of picomatch@4.0.4 had a stale module cache before the first JIT pass. Running `npm install` (no-op, lockfile synced) + one subsequent `vitest` invocation cleared the transient issue. No code-level fix required; not a blocking issue for this plan.

**Not a deviation:** Per deviation rules scope-boundary, this is out-of-scope (an existing tooling quirk unrelated to the endpoints.ts code). All 10 tests pass reliably on warm runs.

## User Setup Required

None — no external service configuration required. The plan's endpoints rely on `getWisenetEnv()` from Plan 02-01 which reads `WISENET_*` variables already documented in `web/.env.example`.

## Next Phase Readiness

- **Plan 02-04 (WCLI-04 mappers) is unblocked.** The 7 resource-function imports, `PAGE_SIZE`, and the per-call `getParents` dedupe contract are all in place.
- **Plan 02-06 (WCLI-05 boundary) remains blocked on its own work items, not on endpoints.ts** — Zod parse-at-boundary already happens inside `wisenetFetch` (Plan 02-02 shipped it).
- **Phase 1 Opportunity 6 probe:** Still a future option. The endpoints.ts surface is already correct for the upgrade — when Plan 02-04 gates `getSessionCredits` behind participant resolution and the 200 response carries numeric `total`+`remaining`, the 3 RED field-map rows flip to GREEN without any endpoints.ts change.
- **No changes to `web/src/lib/dashboard/service.ts`** per D-23 — existing Sheets path continues serving prod. Phase 3 cutover wires `service.ts` to the new client + mappers + DB.

## Self-Check: PASSED

**Files created:**
- `/Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops/web/src/lib/wisenet/endpoints.ts` — FOUND
- `/Users/kevinhsieh/Desktop/Credit Control/Begifted-Ops/web/src/test/wisenet-endpoints.test.ts` — FOUND

**Commits exist:**
- `07a68af` — FOUND (feat 02-03: add wisenet endpoints.ts with 7 resource functions)
- `a7ad837` — FOUND (test 02-03: add wisenet-endpoints tests — URL + pagination)

**Verification:**
- 10/10 Vitest assertions pass (`npm test -- --run src/test/wisenet-endpoints.test.ts`)
- `npx tsc --noEmit` exits 0 (no type errors)
- Full suite `npm test -- --run`: 59/59 tests passing across 9 test files (no regressions)
- 7 exported `async function` declarations confirmed
- Path-typo negative check passes (`institutes/v3/.*}s/students` has no matches)
- `encodeURIComponent` used 6 times (threshold ≥ 5)
- No module-global parent cache (`^(const|let|var) (parentNameCache|_parents)` empty)
- No stubs, placeholders, or TODOs in shipped code

---

*Phase: 02-data-layer*
*Completed: 2026-04-22*
