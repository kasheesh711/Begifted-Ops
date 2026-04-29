# Testing Patterns

**Analysis Date:** 2026-04-20

This codebase has **two parallel test harnesses**, one per runtime:

1. **Vitest** (`web/` shadow app) — two test files, node environment, standard ESM.
2. **Apps Script validation suite** (`Validation.gs`) — 41 `test*` functions run via `clasp run runValidationSuite`, plus a `runLiveAccuracyAudit` parity harness. Acts as the de facto CI for the Apps Script backend; there is no Jest/Mocha.

The two suites are not run together, but they cover the same business rules so that the Next.js shadow at `web/` tracks Apps Script behavior during migration.

## Test Framework — Next.js (`web/`)

### Runner

- **Framework:** Vitest `^3.2.4` (from `web/package.json:29`)
- **Config:** `web/vitest.config.ts`

```typescript
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

### Run Commands

From `web/package.json:10-12`:

```bash
cd web
npm test                  # vitest run (single pass)
npm run test:watch        # vitest (watch mode)
```

**No coverage tooling is installed.** `@vitest/coverage-v8` is not in `devDependencies`.

### Test File Organization

**Location:** `web/src/test/` (NOT co-located with source)

**Naming:** `<feature>.test.ts`

**Current files:**
| File | Lines | Covers |
|------|-------|--------|
| `web/src/test/actions-route.test.ts` | 117 | `app/api/actions/route.ts` and `app/api/actions/bulk/route.ts` POST handlers |
| `web/src/test/dashboard-logic.test.ts` | 207 | Ported dashboard business logic in `lib/dashboard/` |

**No `*.spec.ts`, no `__tests__/` directories, no React component tests.**

### Test Structure

Standard Vitest `describe` / `it` / `expect` with `beforeEach` for mock reset:

```typescript
// web/src/test/actions-route.test.ts:23-41
describe("action routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireSessionUser.mockResolvedValue({ email: "palm@example.com", name: "Palm" });
    getDashboardPayload.mockResolvedValue({
      students: [
        { studentKey: "jade lim::ivy lim", student: "Jade Lim", parent: "Ivy Lim" },
        { studentKey: "gina ho::mira ho", student: "Gina Ho", parent: "Mira Ho" },
      ],
    });
  });

  it("returns 400 when studentKey is missing", async () => { /* ... */ });
});
```

**Assertions:** `expect(x).toBe(y)`, `expect(x).toHaveLength(n)`, `expect(x).toHaveBeenCalledWith(expect.objectContaining({...}))`, `expect(x).toBeNull()`.

### Mocking

**Pattern:** `vi.mock()` at module top level with `vi.fn()` handles declared above the mock block, so each `it` can override return values.

```typescript
// web/src/test/actions-route.test.ts:3-21
const requireSessionUser = vi.fn();
const getDashboardPayload = vi.fn();
const invalidateDashboardPayloadCache = vi.fn();
const setStudentActionInSheets = vi.fn();
const clearStudentActionInSheets = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireSessionUser,
}));

vi.mock("@/lib/dashboard/service", () => ({
  getDashboardPayload,
  invalidateDashboardPayloadCache,
}));

vi.mock("@/lib/sheets/actions", () => ({
  setStudentActionInSheets,
  clearStudentActionInSheets,
}));
```

**Dynamic import of the route handler** is used so the mocks are applied before the module loads:
```typescript
const { POST } = await import("@/app/api/actions/route");
const response = await POST(
  new Request("http://localhost/api/actions", {
    method: "POST",
    body: JSON.stringify({ studentKey: "jade lim::ivy lim", status: "contacted" }),
    headers: { "Content-Type": "application/json" },
  }),
);
```

**What's mocked:**
- `@/lib/auth/session` (session lookup) — avoids NextAuth setup
- `@/lib/dashboard/service` (cached payload loader)
- `@/lib/sheets/actions` (the real Google Sheets writes)

**What's NOT mocked in `dashboard-logic.test.ts`:**
- The pure business-logic modules are exercised directly: `buildDashboardModel`, `buildDashboardStudents`, `buildPendingDeductionContext`, `buildActiveStudentSet`, `buildExcludedPackageReasons`, `buildUpcomingSessionMap`, `buildStudentAdminOwnershipMap`, `attachActionStatesToStudents`, `sanitizeStudentActionState`.
- No `googleapis`, `next-auth`, or `next/cache` mocking is attempted — these tests don't touch that layer.

### Fixtures

Tests build `SheetSnapshot` objects inline with a helper:

```typescript
// web/src/test/dashboard-logic.test.ts:15-33
function snapshot(
  sheetName: string,
  header: string[],
  rows: unknown[][],
  headerRowIndex = 0,
): SheetSnapshot {
  const cols = header.reduce<Record<string, number>>((map, value, index) => {
    map[value] = index;
    return map;
  }, {});
  return {
    sheetName,
    headerRowIndex,
    dataRowStartIndex: headerRowIndex + 2,
    cols,
    rows,
  };
}
```

No shared fixture directory; each `it` constructs its own sheet data.

### Current Coverage

**Business logic (`lib/dashboard/*`):** partially covered.
- `buildDashboardModel` → `testBuildsTheSameLowBalanceQueueShape` (`dashboard-logic.test.ts:36`)
- `sanitizeStudentActionState` → `testOnlySurfacesSameDayActionState` (`dashboard-logic.test.ts:104`)
- `attachActionStatesToStudents` + queue rollup → `testMergesActionStateOntoStudentsBeforeQueueRollup` (`dashboard-logic.test.ts:131`)

**Route handlers (`app/api/actions/**`):**
- 400 on missing `studentKey` (`actions-route.test.ts:43`)
- Happy path set + cache invalidation (`actions-route.test.ts:56`)
- Bulk dedup (`actions-route.test.ts:89`)

## Test Framework — Apps Script (`Validation.gs`)

### Entry Points

**Suite runner:** `Validation.gs:6-73` — `runValidationSuite()`

```javascript
function runValidationSuite() {
  const tests = [
    testTrialPackagesAreExcluded,
    testPretestPackagesAreExcluded,
    testPendingFeedbackCreatesPendingDeduction,
    // ... 41 tests total
  ];
  const failures = [];
  tests.forEach(function(testFn) {
    try { testFn(); }
    catch (error) { failures.push(testFn.name + ": " + error.message); }
  });
  Logger.log(JSON.stringify(summary, null, 2));
  if (failures.length) throw new Error("Validation suite failed:\n" + failures.join("\n"));
  return summary;
}
```

**Live parity audit:** `Validation.gs:138-157` — `runLiveAccuracyAudit()`. Reads live Google Sheets via `SpreadsheetApp.openById`, builds the expected model from a duplicate audit pipeline (`buildAuditExpectedModel`), compares to the actual dashboard payload, and writes findings to the `Dashboard Accuracy Audit` sheet.

### Run Commands

```bash
clasp run runValidationSuite       # unit-style fixture tests (fast, no sheet access needed)
clasp run runLiveAccuracyAudit     # live parity against real sheets (requires auth)
```

Both commands require the local clasp setup (`.clasp.json` and a non-committed `.clasprc.local.json`).

### Test List (41 tests)

Grouped by concern:

**Package exclusion** (`Validation.gs:1035, 1054`)
- `testTrialPackagesAreExcluded`
- `testPretestPackagesAreExcluded`

**Pending deduction** (`Validation.gs:1073, 1113, 1163, 1213`)
- `testPendingFeedbackCreatesPendingDeduction`
- `testPendingDeductionUsesShouldCreditWhenAvailable`
- `testPendingDeductionFallsBackToDurationWhenShouldCreditMissing`
- `testConsumedCreditsDoNotDoubleDeduct`

**Status thresholds** (`Validation.gs:1263, 1273, 1283`)
- `testNoUpcomingSessionsStayNoData`
- `testAlertThresholdBoundaryAtExactlyTwoCredits`
- `testWatchWindowBoundaryAtThirtyDays`

**Admin ownership** (`Validation.gs:1303, 1322, 1340, 1379`)
- `testRecognizedAdminOwnershipResolvesCorrectly`
- `testBlankAdminOwnershipFallsBackToUnassigned`
- `testConflictingAdminOwnershipUsesCountThenFirstRow`
- `testStudentsMissingOwnershipMapDefaultToUnassigned`

**Dashboard rollup** (`Validation.gs:1414, 1457, 1491, 1558, 1613, 1671, 1729, 1774`)
- `testDuplicatePackagesKeepLargestTotalCredits`
- `testLowBalanceWithoutScheduleGetsDataQualityFlag`
- `testPriorityScoreRanksNotifyAheadOfHealthy`
- `testStudentQueueRollsUpPackagesIntoOneRow`
- `testPinnedStudentsSortAheadOfOtherRisk`
- `testCalendarGroupsStudentSessionsByDay`
- `testSummaryDeltasCompareAgainstPreviousSnapshot`
- `testWeeklyBucketsGroupProjectedAlerts`

**Cache + payload persistence** (`Validation.gs:1791, 1812`)
- `testDashboardCacheMissBuildsAndCachesPayload`
- `testDashboardCacheHitReusesPayloadWithoutRebuild`

**Student action state** (`Validation.gs:1841, 1876, 1900, 1921, 1946, 1958, 1980`)
- `testSetStudentActionPersistsAndClearsCache`
- `testClearStudentActionKeepsHistoryButRemovesVisibleState`
- `testBulkSetStudentActionUpdatesMultipleStudents`
- `testStudentActionStateOnlySurfacesToday`
- `testStudentActionActorFallsBackToNullForAllView`
- `testStudentActionHistoryTrimsToLimit`
- `testDashboardModelMergesStudentActionStateIntoStudentsAndQueue`

**Chunked cache / async bootstrap** (`Validation.gs:2016, 2028, 2050, 2069, 2090, 2109, 2127, 2144, 2166, 2188, 2217`)
- `testChunkedCacheRoundTripPreservesLargePayload`
- `testDashboardTransferChunkedCacheHitSkipsPayloadLoad`
- `testDashboardTransferManifestUsesChunkedMode`
- `testDashboardTransferCacheMissReturnsChunkedAfterCaching`
- `testDashboardTransferCacheMissFallsBackInlineWhenManifestMissing`
- `testDashboardTransferChunkBatchReadsOrderedSlices`
- `testDashboardTransferChunkBatchHandlesFinalPartialBatch`
- `testDashboardTransferChunkBatchRecoversWhenManifestMissing`
- `testDashboardTransferChunkBatchRecoversWhenPartMissing`
- `testDashboardTransferChunkBatchRejectsInvalidRange`
- `testDashboardTransferChunkReadsStoredChunk`

### Assertion Helpers

Hand-rolled in `Validation.gs:2387-2411`:

```javascript
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + " Expected " + expected + " but received " + actual + ".");
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(fn, expectedMessageFragment, message) {
  try { fn(); }
  catch (error) {
    const actualMessage = error && error.message ? error.message : String(error || "");
    if (expectedMessageFragment && actualMessage.indexOf(expectedMessageFragment) === -1) {
      throw new Error(message + " Expected error containing \"" + expectedMessageFragment + "\" but received \"" + actualMessage + "\".");
    }
    return;
  }
  throw new Error(message + " Expected function to throw.");
}
```

### Fixtures & Fakes

**Sheet fixture builder:** `createSnapshot(headers, rowObjects)` — shared helper used throughout `Validation.gs` test bodies (search for usages in the package-exclusion and pending-deduction tests).

**Student fixture:** `createActionTestStudentFixture(studentName, parentName, today)` at `Validation.gs:2258`.

**Dashboard payload fixture:** `createDashboardPayloadFixture(generatedAt, previousGeneratedAt)` at `Validation.gs:2259+` (referenced from cache tests).

**Fake cache:** `createFakeCache()` at `Validation.gs:2335-2368` — in-memory `get`/`getAll`/`putAll`/`remove`/`removeAll`, matching the shape Apps Script `CacheService` exposes.

**Fake properties:** `createFakeProperties()` at `Validation.gs:2370-2385` — matches `PropertiesService.getScriptProperties()` shape.

**Dependency injection seam:** Every mutator that reads cache / properties / clock accepts an `options` argument (see `Code.gs:117-119`, `DashboardActions.gs:234-244`). Tests pass `{ properties, cache, cacheKey, now, today }`; production calls pass nothing and fall back to the real services. Preserve this pattern when adding new helpers.

### Live Accuracy Audit

`runLiveAccuracyAudit()` (`Validation.gs:138`) is a separate harness:
- Runs against live Google Sheets via `SpreadsheetApp.openById(SPREADSHEET_ID_CREDITS)` and `(SPREADSHEET_ID_ANALYTICS)`.
- Builds a parallel **expected model** using `buildAudit*` functions (`Validation.gs:247-323`) that mirror the production pipeline.
- Compares every package, queue row, and summary field; emits `FAIL`/`WARN` findings.
- Writes results to the `Dashboard Accuracy Audit` sheet (`Validation.gs:838-874`) plus `Logger.log` summary.
- **Authorization failure on `SpreadsheetApp.openById` is a handoff blocker, not a code failure** (`CLAUDE.md:28`).

A single-student drill-down, `inspectStudentPackageBalance(studentName, packageName)` (`Validation.gs:75`), is available for debugging specific rows.

### Shadow Parity Script

`web/scripts/compare-live.ts` (referenced from `web/package.json:12` as `npm run compare-live`):
- Loads the Apps Script dashboard payload via `clasp run` (through `execFile`).
- Builds the `web/` payload directly by calling `buildDashboardPayloadUncached()` from `lib/dashboard/build.ts`, OR hits a running Next.js `/api/dashboard` when `NEXT_BASE_URL` is set.
- Compares queue rows and packages field-by-field, capping output at `MAX_MISMATCHES = 200`.
- Exit code 1 on any mismatch.

Run it whenever Apps Script logic changes to confirm `web/` still tracks.

## When to Run Which Suite

| Change area | Run |
|-------------|-----|
| Balance logic, pending-deduction rules, sheet-driven payload shape | `clasp run runValidationSuite` (`CLAUDE.md:24`, `AGENTS.md:25`) |
| Student action-state persistence, same-day visibility | `clasp run runValidationSuite` (`CLAUDE.md:25`, `AGENTS.md:26`) |
| Async bootstrap / chunked-transfer behavior | Extend `runValidationSuite` with warm-cache and cold-cache coverage; manual smoke tests alone are not acceptable (`CLAUDE.md:26`, `AGENTS.md:27`) |
| Live sheet parity or diagnostics | `clasp run runLiveAccuracyAudit` after the script is authorized for Google Sheets (`CLAUDE.md:27`, `AGENTS.md:28`) |
| `web/` route handlers or business logic | `cd web && npm test` |
| `web/` shadow parity against Apps Script | `cd web && npm run compare-live` |

## Coverage Gaps

**React components (`web/src/components/**/*.tsx`):** zero tests. `DashboardShell`, `QueuePanel`, `CalendarPanel`, `StudentDetail`, `BulkActionBar`, `FilterToolbar`, `SummaryBar`, `LinePreviewDrawer`, `ToastNotification` are untested. No React Testing Library or Playwright setup.

**Hooks (`web/src/hooks/**`):** zero tests. `use-keyboard-shortcuts`, `use-theme`, `use-resizable-split` all rely on manual QA.

**Route handlers not covered by Vitest:**
- `app/api/dashboard/route.ts` — auth + payload fetch
- `app/api/health/route.ts` — Sheets probe
- `app/api/inactive/route.ts` — mark/clear inactive
- `app/api/actions/history/route.ts` — action log lookup

**Sheets adapters (`web/src/lib/sheets/**`):** zero tests. `actions.ts`, `inactive-students.ts`, `source-loader.ts`, `client.ts` are exercised only through end-to-end paths (`compare-live.ts`) or indirectly via the Apps Script validation suite.

**No snapshot tests**, no MSW/nock for HTTP mocking, no integration tests that exercise real `googleapis` calls against a test spreadsheet.

## How to Add New Tests

### Next.js (`web/`)

1. Create `web/src/test/<feature>.test.ts`.
2. Declare `vi.fn()` handles for every dependency, then `vi.mock("@/lib/...", () => ({...}))` at module scope.
3. Use `beforeEach(() => { vi.resetAllMocks(); /* set default resolved values */ })`.
4. For route handlers, dynamically `await import("@/app/api/.../route")` inside the `it`, then call `POST(new Request(...))` and assert on `response.status` / `await response.json()`.
5. For pure logic in `lib/dashboard/**`, import directly and assert on return values.
6. Run with `npm test` from `web/`.

### Apps Script (`Validation.gs`)

1. Add a new `function testMyNewRule() { ... }` — use `assertEqual` / `assertTrue` / `assertThrows`.
2. Build snapshots with `createSnapshot(headers, rowObjects)` or construct sheet snapshots inline.
3. Inject fakes through the options argument: `{ properties: createFakeProperties(), cache: createFakeCache(), now: new Date(...), today: new Date(...) }`.
4. Register the function in the `tests` array at the top of `runValidationSuite` (`Validation.gs:7-47`) — otherwise it will not run.
5. Verify locally with `clasp run runValidationSuite`.

### Adding Shadow Parity Coverage

If the change touches both layers, also:
1. Mirror the new test in `web/src/test/dashboard-logic.test.ts` so Vitest enforces the same rule on `web/`.
2. Run `npm run compare-live` to confirm payload parity.

---

*Testing analysis: 2026-04-20*
