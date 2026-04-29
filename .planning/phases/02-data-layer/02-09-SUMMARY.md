---
phase: 02-data-layer
plan: 09
subsystem: testing
tags: [vitest, zod, lint, bash, ci, coercion]

# Dependency graph
requires:
  - phase: 02-data-layer
    provides: "Zod schemas (02-02), Wisenet→DashboardSources mappers (02-04), service.ts revalidateTag(_, 'max') occurrence (pre-existing)"
provides:
  - "TEST-05 parametric Zod boundary coercion coverage (Pitfall #1/#2 mitigation proven end-to-end)"
  - "TEST-03 deferral carve-out: lint-no-revalidate-max.sh static check + automated FLAG-3 negative test"
  - "npm script entry lint:no-revalidate-max (local + CI discoverability)"
affects: [03-service-cutover, 04-deploy-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parametric describe.each / it.each for drift-axis test tables (applied to z.coerce.number boundary)"
    - "grep-based static-check lint with explicit allowlist (bash + set -euo pipefail)"
    - "Runtime-constructed test fixture strings to avoid self-matching a lint regex"

key-files:
  created:
    - "web/src/test/wisenet-coercion.test.ts — 39 assertions, 7 describe blocks (TEST-05)"
    - "web/scripts/lint-no-revalidate-max.sh — executable, 2612 bytes, 0o755"
    - "web/src/test/lint-no-revalidate-max.test.ts — automated FLAG-3 coverage"
  modified:
    - "web/package.json — added lint:no-revalidate-max npm script"

key-decisions:
  - "Parametric it.each over [\"2\", 2, \"2.5\", 2.5, \"0\", 0, \"3600000\", 3_600_000] for the z.coerce.number() drift axis — matches D-20 guidance in RESEARCH.md"
  - "Rejected cases limited to \"NaN\", \"abc\", {} — pinned documented surprising coercions ([] → 0, \"  \" → 0, null → 0) in a separate it.each block to catch future Zod library upgrade surprises rather than asserting them as rejections"
  - "MeetingStatusSchema is strict — asserted 6 rejection cases (lowercase, mixed-case, trimmed, typo, empty) so any schema regression (e.g. swap to z.enum({errorMap}) for case-insensitive) trips loudly"
  - "End-to-end mapper assertion feeds raw Wisenet envelope with string \"3600000\" through WisenetSessionsListSchema.parse() then into composeDashboardSourcesFromData — proves the coerced number survives the full pipeline without re-coercion"
  - "TEST-03 closed via static grep-based lint with single-file allowlist (src/lib/dashboard/service.ts) rather than runtime cache-invalidation test — per D-23 Phase 2 has no cache infrastructure to regress against"
  - "Added automated FLAG-3 negative test (web/src/test/lint-no-revalidate-max.test.ts) using runtime string assembly to avoid the test file self-matching the lint regex — single serialized it() block to prevent temp-file races under vitest parallelism"
  - "Lint exit-code contract: 0 when no matches or only allowlisted matches; 1 when any non-allowlisted match is found"

patterns-established:
  - "Drift-axis test tables via it.each for schema/library upgrade guardrails"
  - "Static-lint carve-outs for deferred runtime tests (D-23 pattern for 'deferred but not ignored')"
  - "Allowlist-based grep lint with inline documentation of the Phase-3 removal target"

requirements-completed: [TEST-05, TEST-03]

# Metrics
duration: ~8min
completed: 2026-04-22
---

# Phase 2 Plan 9: Zod Coercion Tests + TEST-03 Deferral Lint Summary

**Parametric Zod boundary coercion suite (39 assertions) closes TEST-05 end-to-end, plus a bash+allowlist static lint carves out TEST-03 by preventing new `revalidateTag(_, "max")` anti-pattern code paths until Phase 3 SVC-02 removes the last one.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-22T04:55:00Z (first tool call)
- **Completed:** 2026-04-22T05:01:50Z
- **Tasks:** 2 (both auto, Task 1 TDD RED→GREEN, Task 2 auto)
- **Files created:** 3 (2 tests + 1 lint script)
- **Files modified:** 1 (web/package.json — script entry)

## Accomplishments

- **TEST-05 closed:** 39 parametric Zod assertions across 7 describe blocks prove `"2" === 2` at the Wisenet boundary, including end-to-end handoff through `composeDashboardSourcesFromData` producing numeric Aggregations cells.
- **TEST-03 carve-out shipped:** grep-based lint + npm script + automated negative test guarantee the `revalidateTag(tag, "max")` anti-pattern cannot expand beyond the one allowlisted service.ts occurrence until Phase 3 removes it.
- **FLAG-3 resolved:** automated positive/negative/cleanup cycle confirms the lint script actually detects violations — no reliance on manual discipline.

## Task Commits

Each task was committed atomically:

1. **Task 1 — wisenet-coercion.test.ts (TDD auto):** `a9f52bb` (test)
2. **Task 2 — lint-no-revalidate-max.sh + package.json + negative test:** `716431c` (feat)

**Plan metadata:** to be committed after SUMMARY/STATE updates.

## Files Created/Modified

### Created

- `web/src/test/wisenet-coercion.test.ts` (380 lines) — TEST-05 parametric coverage:
  - `describe.each` / `it.each` over accepted numeric cases (`"2"`/`2`, `"2.5"`/`2.5`, `"0"`/`0`, `"3600000"`/`3_600_000`)
  - Rejected cases: `"NaN"`, `"abc"`, `{}` throw ZodError
  - Documented surprising coercions (pinned): `[]`, `"  "`, `null` → `0`
  - MeetingStatusSchema strict enum: 4 accept + 6 reject
  - WisenetSessionCreditsSchema: 400-state empty data + string-numeric coercion + NaN rejection
  - z.coerce.boolean() on `activated`: truthiness semantics pinned
  - z.coerce.string().trim() on name: whitespace normalization
  - End-to-end: raw payload → `WisenetSessionsListSchema.parse()` → `composeDashboardSourcesFromData` → numeric Aggregations row
- `web/scripts/lint-no-revalidate-max.sh` (executable, 0o755) — grep-based static lint:
  - Regex: `revalidateTag\([^)]*,[[:space:]]*["\']max["\']\)` (covers both quote styles, optional whitespace)
  - Allowlist: single entry `src/lib/dashboard/service.ts`
  - Exit 0 = OK (no matches OR all allowlisted); Exit 1 = FAIL (any non-allowlisted match)
- `web/src/test/lint-no-revalidate-max.test.ts` — automated FLAG-3 coverage:
  - Single serialized `it()` block: clean → plant violation → assert exit 1 → cleanup → assert exit 0
  - Violation literal built at runtime from `"revalidate" + "Tag"` and `'"' + "max" + '"'` so the test file itself does not match the lint regex
  - `beforeAll` + `afterAll` cleanup hooks to prevent stray violation files

### Modified

- `web/package.json` — added one script entry:
  ```json
  "lint:no-revalidate-max": "bash scripts/lint-no-revalidate-max.sh"
  ```

## Existing `revalidateTag(_, "max")` Occurrence (for Phase 3 SVC-02 handoff)

Enumerated for Phase 3 removal:

| File | Line | Code |
| --- | --- | --- |
| `web/src/lib/dashboard/service.ts` | 20 | `  revalidateTag(DASHBOARD_CACHE_TAG, "max");` |

**Total:** 1 occurrence — the only match across `web/src/**/*.ts`.

**Allowlist contents** (single entry, matches the line above):

```bash
ALLOWLIST=(
  "src/lib/dashboard/service.ts"
)
```

**Phase 3 SVC-02 requirements:**

1. Remove `revalidateTag(DASHBOARD_CACHE_TAG, "max")` call in `service.ts:20` — switch to `revalidateTag(DASHBOARD_CACHE_TAG)` (single arg) per Next.js 16 API.
2. Remove the `"src/lib/dashboard/service.ts"` entry from the `ALLOWLIST` array in `web/scripts/lint-no-revalidate-max.sh`.
3. Confirm `npm run lint:no-revalidate-max` still exits 0 (no matches anywhere = `lint-no-revalidate-max: OK (no matches)` branch taken).
4. Plumb the real cache-invalidation regression test (TEST-03 runtime half) into `use cache: remote` infrastructure added by SVC-02.

## Verification Evidence

| Command | Result |
| --- | --- |
| `cd web && npm test -- --run src/test/wisenet-coercion.test.ts` | 39 passing (target was ≥15) |
| `cd web && npm test -- --run src/test/lint-no-revalidate-max.test.ts` | 1 passing (serialized positive/negative/cleanup) |
| `cd web && npm test -- --run` | 164 passing (baseline 124 + 39 coercion + 1 lint) |
| `cd web && npx tsc --noEmit` | exit 0, no output |
| `cd web && npm run lint:no-revalidate-max` | exit 0, OK (allowlisted) |
| `cd web && bash scripts/lint-no-revalidate-max.sh` (positive) | exit 0, allowlist message |
| Manual negative test (temp file planted) | exit 1, FAIL message shows `__lint_test_violation.ts` |

## Decisions Made

- **Coercion drift-axis table sized at 8 accept + 3 reject + 3 pinned-surprising.** Rationale: covers Pitfall #1 string/number equivalence without over-specifying (each branch has real behavioral meaning — accept cases assert coercion works, reject cases assert NaN never leaks, surprising cases pin library semantics for upgrade guardrail).
- **End-to-end integration assertion uses `composeDashboardSourcesFromData` directly** rather than `buildDashboardSourcesFromWisenet` — matches the existing `wisenet-mappers.test.ts` idiom (pure composer, no network) and doesn't require network mocking.
- **z.coerce.boolean() truthiness semantics documented, not asserted as "correct."** Zod v3 uses `Boolean(value)` which returns `true` for the string `"false"`; tests pin the observable behavior so any future schema change to `z.preprocess(x => x === true || x === "true")` for strict string parsing trips the test. Comment blocks on the test make the documented-vs-asserted distinction explicit.
- **Automated FLAG-3 coverage added** (not skipped) — deliberate small cost to keep FLAG-3 out of the SUMMARY's permanent-ignores list. The test runs in ~100ms.
- **Test-file self-match avoided via runtime string assembly** — simpler than allowlisting the test file, and documentable as a pattern future lint carve-outs can reuse.
- **Single `it()` block in lint test** — vitest parallelizes separate `it()` cases, which would race on the shared temp file; the 3-phase cycle inside one test case is deterministic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Initial rejected-duration list included cases Zod v3 accepts**
- **Found during:** Task 1 (TDD RED run showed 2/38 tests failing)
- **Issue:** Plan's `<behavior>` said `"NaN"` and `"abc"` throw — both do. But I had also added `[]` and `"  "` to the rejection list. JS's `Number([])` returns `0` and `Number("  ")` returns `0`, so `z.coerce.number()` accepts both — tests failed (`expected [Function] to throw`). This is documented Zod/JS behavior, not a library bug.
- **Fix:** Split into two blocks — rejected cases narrowed to `"NaN"`, `"abc"`, `{}` (real non-numerics); the `[]` / `"  "` / `null` cases moved to a new "documented surprising coercions" `it.each` block that asserts they coerce to `0` with an explanatory comment.
- **Files modified:** `web/src/test/wisenet-coercion.test.ts`
- **Verification:** 39/39 passing; documented pins protect against future library-upgrade drift.
- **Committed in:** `a9f52bb` (Task 1 — landed before commit).

**2. [Rule 1 - Bug] Lint test file self-matched the lint regex**
- **Found during:** Task 2 (first test run — clean-tree assertion failed because two lint matches existed: `service.ts:20` AND `lint-no-revalidate-max.test.ts:62`)
- **Issue:** The initial test file contained a literal string `'revalidateTag("foo", "max")'` passed to `writeFileSync` — the lint regex `revalidateTag\([^)]*,[[:space:]]*["']max["']\)` matched the test source file itself. Lint therefore reported 2 matches, 1 non-allowlisted, exit 1 — clean-tree case failed.
- **Fix:** Rewrote the test to assemble the violating literal from pieces at runtime (`"revalidate" + "Tag"`, `'"' + "max" + '"'`) so the grep regex sees no match. Also scrubbed a comment line that mentioned the shape `(_, "max")` which also matched. Serialized all 3 scenarios into one `it()` block to avoid vitest parallelism races on the shared temp file.
- **Files modified:** `web/src/test/lint-no-revalidate-max.test.ts`
- **Verification:** `grep -rEn 'revalidateTag\([^)]*,[[:space:]]*["'"'"']max["'"'"']\)' src/` now returns only `service.ts:20`; test passes in 100ms.
- **Committed in:** `716431c` (Task 2 — landed before commit).

---

**Total deviations:** 2 auto-fixed (both Rule 1 — test-authoring bugs discovered during TDD RED, fixed before landing).
**Impact on plan:** Zero — both fixes discovered pre-commit, corrected before the commit that would have introduced them. Plan's behavioral contract and file list unchanged.

## Issues Encountered

None during planned work. Both fixes above were caught by the test runner on first execution and corrected inline.

## User Setup Required

None.

## Next Phase Readiness

- **TEST-05 fully closed** — no further coverage needed. Phase 3 SVC-02 inherits a working Pitfall #1 test gate.
- **TEST-03 Phase 2 scope closed via static lint.** Phase 3 SVC-02 must:
  - Remove the one allowlisted `revalidateTag(DASHBOARD_CACHE_TAG, "max")` call in `service.ts:20` as part of the Wisenet cutover.
  - Remove the allowlist entry in `lint-no-revalidate-max.sh` in the same PR.
  - Add the runtime cache-invalidation regression test (TEST-03 proper) against the new `use cache: remote` + `cacheTag('dashboard-payload', ...)` surface per D-23.
- **CI wiring opportunity:** `npm run lint:no-revalidate-max` is ready to plug into `gh` workflows or a pre-commit hook; not wired in this plan per scope.
- **Remaining Phase 2 plan:** 02-10 (seed script — DB-08 migration runner + admin seed).

## Threat Flags

None. Scan of the 3 files created/modified shows no new network surface, no auth paths, no file-access patterns, no schema changes. The files are pure test code + a readonly grep script + one npm-script string.

## Self-Check: PASSED

Artifact verification:

- `web/src/test/wisenet-coercion.test.ts` — FOUND
- `web/scripts/lint-no-revalidate-max.sh` — FOUND (mode 755, executable bit set)
- `web/src/test/lint-no-revalidate-max.test.ts` — FOUND
- `web/package.json` `lint:no-revalidate-max` script entry — FOUND

Commit verification:

- `a9f52bb` (Task 1) — FOUND in `git log --oneline`
- `716431c` (Task 2) — FOUND in `git log --oneline`

Test verification:

- `npm test -- --run src/test/wisenet-coercion.test.ts` — 39 passed
- `npm test -- --run src/test/lint-no-revalidate-max.test.ts` — 1 passed
- `npm test -- --run` (full suite) — 164 passed / 0 failed
- `npx tsc --noEmit` — exit 0

Lint verification:

- `npm run lint:no-revalidate-max` — exit 0, OK (allowlisted)
- Manual negative test — exit 1 as expected

---
*Phase: 02-data-layer*
*Completed: 2026-04-22*
