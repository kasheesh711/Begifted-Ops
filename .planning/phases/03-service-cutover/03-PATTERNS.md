# Phase 3: Service Cutover - Pattern Map

**Mapped:** 2026-04-29
**Phase directory:** `.planning/phases/03-service-cutover/`
**Files analyzed:** 23 (15 new/modified + 8 deletions)
**Analogs found:** 14 / 15 in-scope files (logger.ts is greenfield)

## File Classification

### Modified files

| File | Role | Data Flow | Closest Analog | Match Quality |
|------|------|-----------|----------------|---------------|
| `web/next.config.ts` | config | build-time directive | `web/next.config.ts` (current 7-line shape) | exact (in-place edit) |
| `web/src/lib/dashboard/service.ts` | cache-tagged service / payload composer | request-response (Wisenet+Postgres → DashboardPayload) | `web/src/lib/dashboard/build.ts` (the uncached body to migrate) + current `service.ts` (the wrapper to replace) | role-match — directive replaces `unstable_cache` |
| `web/src/lib/dashboard/actions.ts` | mutation facade (`'use server'`) | request-response (route handler → Postgres + revalidateTag) | current `actions.ts` (sanitize helpers) + `web/src/lib/sheets/actions.ts` (write+invalidate flow) | role-shift — current file is pure helpers; mutation methods come from `lib/sheets/actions.ts` |
| `web/src/lib/dashboard/config.ts` | constants | static export | current `config.ts` (existing constants like `DASHBOARD_CACHE_TAG`) | exact (additive: new const) |
| `web/src/components/dashboard/student-detail.tsx` | React client component | static link in JSX header | current `student-detail.tsx` lines 81-94 (sticky header with student name + admin badge) | exact (additive: new element in same header block) |
| `web/src/app/api/actions/route.ts` | route handler (mutation) | POST → Postgres write → revalidateTag | current `actions/route.ts` (Sheets-era shape — same skeleton, different deps) | exact role match |
| `web/src/app/api/dashboard/route.ts` | route handler (read) | GET → service.ts → JSON | `actions/route.ts` (NextResponse + auth + try/catch shape) | role-match (new file, same skeleton) |
| `web/src/app/api/actions/bulk/route.ts` | route handler (bulk mutation) | POST → bulkDb transaction → revalidateTag | `actions/route.ts` + `lib/db/bulk-queries.ts::bulkSetStudentAction` | role-match (new file using existing bulk pattern) |
| `web/src/app/api/actions/history/route.ts` | route handler (read) | GET → readHistory(studentKey) → JSON | `actions/route.ts` shape + `db/queries.ts::readHistory` (data source) | role-match (new file) |
| `web/src/app/api/inactive/route.ts` | route handler (toggle mutation) | POST/DELETE → markInactive/clearInactive → revalidateTag | `actions/route.ts` shape + `db/queries.ts::markInactive,clearInactive` | role-match (new file) |
| `web/src/app/api/health/route.ts` | route handler (probe — uncached) | GET → live probes (Wisenet/Postgres/Auth) → status JSON | `actions/route.ts` skeleton + `lib/wisenet/client.ts` + `lib/db/client.ts` | role-shift — same NextResponse pattern, no auth gate (uptime-monitor accessible), no cache directive |
| `web/package.json` | manifest | npm scripts/deps | current `package.json` | exact (in-place edit) |
| `web/scripts/lint-no-revalidate-max.sh` | bash lint guard | grep + allowlist exit code | current script lines 26-77 | exact (in-place regex flip) |
| `web/src/test/lint-no-revalidate-max.test.ts` | regression test for the lint | shells out, asserts exit code | current test (89 lines) | exact (in-place — flip violation literal) |
| `web/src/test/actions-route.test.ts` | route-handler smoke test | `vi.mock` deps, send Request, assert NextResponse | current test (118 lines) | exact (in-place — swap mocked module names) |

### New files

| File | Role | Data Flow | Closest Analog | Match Quality |
|------|------|-----------|----------------|---------------|
| `web/src/lib/runtime/logger.ts` | utility (structured logger) | sync side-effecting `console.error` | `web/src/lib/runtime/env.ts` (only sibling in `lib/runtime/`; pure-function utility module) | role-match (new utility, conventions match) |
| `web/src/test/cache-invalidation.test.ts` | integration test (gated) | seed→read→write→read against Neon | `web/src/test/db-queries.test.ts` (env-stubbed Drizzle pattern) + `web/src/test/wisenet-client.test.ts` (env snapshot/restore) + `db-queries.test.ts` (vi.doMock + dynamic-import) | role-match — combination of two existing test patterns |
| `web/src/test/chunked-transfer-regression.test.ts` | regression unit test | `ReadableStream` mock → wisenetFetch → assert | `web/src/test/wisenet-client.test.ts` lines 72-330 (`vi.stubGlobal("fetch", …)` + Response mocking + env restore) | exact role match |
| `web/src/test/health-route.test.ts` | route-handler smoke test | mock subsystem probes, send Request, assert JSON shape + status code | `web/src/test/actions-route.test.ts` (route handler smoke pattern) | role-match (different deps mocked) |
| `web/src/test/dashboard-route.test.ts` (optional) | route-handler smoke test | mock service.ts, send Request, assert JSON | `web/src/test/actions-route.test.ts` | exact role match |
| `web/src/test/student-detail.test.tsx` (optional) | component render test | RTL render → assert link element | NO precedent — sets first component-test in repo | no analog (deferred) |

### Deletions

| File | Why | Downstream Impact |
|------|-----|-------------------|
| `web/src/lib/sheets/client.ts` | DELETE — googleapis JWT auth, replaced by Wisenet | nothing left importing `getSheetsClient()` after SVC-04 swap |
| `web/src/lib/sheets/source-loader.ts` | DELETE — Sheets read path | `lib/dashboard/build.ts` consumer must be deleted/migrated; `service.ts` now calls `buildDashboardSourcesFromWisenet()` instead |
| `web/src/lib/sheets/actions.ts` | DELETE — Sheets-write action helpers | `actions/route.ts` swap removes the `setStudentActionInSheets` import |
| `web/src/lib/sheets/inactive-students.ts` | DELETE — InactiveStudents tab read/write | `lib/dashboard/build.ts` (also deleted) was the only consumer |
| `web/src/lib/cache/memory-cache.ts` | DELETE — only consumers were `lib/sheets/*` | none (cascade with sheets/ deletion) |
| `web/src/lib/dashboard/snapshot-store.ts` | DELETE — per-process state, broken on serverless | `service.ts` rewrite passes `null` for prior snapshot (CONTEXT analyses tradeoff: deltas reset on cold starts is acceptable) |
| `web/src/lib/dashboard/build.ts` | DELETE — Sheets-only uncached path | `lib/dashboard/service.ts` absorbs the body inline with the directive |
| `web/scripts/compare-live.ts` | DELETE — Sheets↔Apps Script parity tool, no longer meaningful | `package.json` removes `"compare-live"` script entry |
| `web/scripts/ensure-action-sheets.ts` | DELETE — googleapis-dependent, Sheets tabs no longer the truth | `package.json` removes `"ensure-action-sheets"` script entry |
| `web/scripts/ensure-inactive-sheet.ts` | DELETE — googleapis-dependent | `package.json` removes `"ensure-inactive-sheet"` script entry |

---

## Pattern Assignments

### `web/next.config.ts` (config, build-time directive)

**Analog:** current `web/next.config.ts` (in-place edit)

**Current shape** (full file, 7 lines):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

**Pattern to apply** — add a sibling key (NOT nested):

```ts
const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,    // SVC-01 — Phase 3 enables Cache Components
};
```

Per CONTEXT §code_context "verify this is a sibling key, not nested." The `NextConfig` type already exposes `cacheComponents` in Next.js 16.0+ — no `@ts-expect-error` needed.

---

### `web/src/lib/dashboard/service.ts` (cache-tagged service, request-response)

**Primary analog:** `web/src/lib/dashboard/build.ts` (the body to absorb) + current `service.ts` (the wrapper to replace).

**Current `service.ts` (full file — what gets thrown away)** (`web/src/lib/dashboard/service.ts:1-23`):

```ts
import { revalidateTag, unstable_cache } from "next/cache";
import { buildDashboardPayloadUncached } from "@/lib/dashboard/build";
import { DASHBOARD_CACHE_REVALIDATE_SECONDS, DASHBOARD_CACHE_TAG } from "@/lib/dashboard/config";
import { recordCacheInvalidation } from "@/lib/dashboard/health-state";

const getCachedPayload = unstable_cache(buildDashboardPayloadUncached, [DASHBOARD_CACHE_TAG], {
  revalidate: DASHBOARD_CACHE_REVALIDATE_SECONDS,
  tags: [DASHBOARD_CACHE_TAG],
});

export async function getDashboardPayload() {
  return getCachedPayload();
}

export function invalidateDashboardPayloadCache() {
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
  recordCacheInvalidation(new Date().toISOString());
}
```

**Body to migrate from `web/src/lib/dashboard/build.ts:18-71`** (the orchestration that lives inside the new `getDashboardPayload`):

```ts
export async function buildDashboardPayloadUncached(now = new Date()) {
  const startedAt = Date.now();
  const today = getTodayDate(now);
  const sources = await loadDashboardSources();           // ← swap to buildDashboardSourcesFromWisenet(today)
  recordSheetsCheck(true, now.toISOString());

  const activeStudents = buildActiveStudentSet(sources.students);
  const excludedPackageReasons = buildExcludedPackageReasons(sources.studentsCourses);
  const adminOwnershipMap = buildStudentAdminOwnershipMap(sources.remainingCredits);
  const pendingDeductionContext = buildPendingDeductionContext(...);
  const upcomingSessionMap = buildUpcomingSessionMap(...);
  const students = buildDashboardStudents(...);
  const actionStates = await loadActionStates(today);     // ← swap to loadActionStateMap()
  attachActionStatesToStudents(students, today, actionStates);

  const inactiveKeys = await loadInactiveStudentKeys();   // ← swap to listInactive()
  // auto-reactivation block — keep semantics, swap delete-from-Sheets to clearInactive(...)
  ...
  const snapshotState = loadSnapshotState();              // ← REMOVE per SVC-05 deletion (pass null)
  const dashboardModel = buildDashboardModel(activeFilteredStudents, snapshotState, today, now);
  persistSnapshotState(dashboardModel.snapshotState);     // ← REMOVE
  recordPayloadBuild(Date.now() - startedAt, now.toISOString());
  return dashboardModel.payload;
}
```

**Final shape** (per RESEARCH §Code Examples Operation 1, lines 977-1059 of 03-RESEARCH.md):

```ts
import { cacheLife, cacheTag } from "next/cache";
import { buildDashboardSourcesFromWisenet } from "@/lib/wisenet/mappers";
import { bulkGetAdminOwnership, loadActionStateMap, listInactive } from "@/lib/db/queries";
// ... pure helpers from lib/dashboard/* unchanged
import { DASHBOARD_CACHE_TAG } from "@/lib/dashboard/config";
import { log } from "@/lib/runtime/logger";

export async function getDashboardPayload(now: Date = new Date()) {
  "use cache: remote";                                                  // RESEARCH §Pattern 1
  cacheTag(DASHBOARD_CACHE_TAG);                                        // RESEARCH §Pattern 4
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });                // RESEARCH §Pattern 3 — NOT { expire: 60 }

  const startedAt = Date.now();
  const today = getTodayDate(now);
  try {
    const sources = await buildDashboardSourcesFromWisenet(today);
    recordSheetsCheck(true, now.toISOString());                         // health-state.ts kept; record name kept
    // ... orchestration from build.ts ...
    const dashboardModel = buildDashboardModel(filteredStudents, null, today, now);  // null replaces snapshotStore
    recordPayloadBuild(Date.now() - startedAt, now.toISOString());

    const serialized = JSON.stringify(dashboardModel.payload);          // RESEARCH §Pattern 7 / Pitfall 3
    if (serialized.length > 1_800_000) {
      log("warn", "service.ts/getDashboardPayload",
          new Error("payload-size-near-limit"), { sizeBytes: serialized.length });
    }
    return dashboardModel.payload;
  } catch (error) {
    log("error", "service.ts/getDashboardPayload", error);
    throw error;
  }
}
```

**Critical placement rules** (RESEARCH §Pattern 1 lines 296-303):
1. `"use cache: remote"` is a string literal, FIRST statement inside the function body.
2. `cacheTag(...)` and `cacheLife(...)` calls come AFTER the directive but BEFORE any awaits.
3. Function MUST be `async`.
4. Args must be serializable (Date is OK, no class instances/functions).
5. NO `cookies()`/`headers()` inside the directive scope (RESEARCH §Anti-Patterns).

**`invalidateDashboardPayloadCache` export removed** — call sites move into `lib/dashboard/actions.ts` (the new `'use server'` facade).

---

### `web/src/lib/dashboard/actions.ts` (mutation facade, `'use server'`)

**Primary analog:** `web/src/lib/sheets/actions.ts:43-80` (the existing setStudentActionInSheets/clearStudentActionInSheets shape — what gets replaced) + `web/src/lib/db/queries.ts:69-99` (Drizzle write surface to wrap).

**Current `lib/dashboard/actions.ts`** (sanitization helpers — KEEP, do not delete):

```ts
// web/src/lib/dashboard/actions.ts:1-46 (KEEP unchanged)
const VALID_STATUSES: StudentActionStatus[] = ["contacted", "pending-callback", "resolved"];
export function normalizeStudentActionStatus(status: unknown) { /* ... */ }
export function sanitizeStudentActionState(actionState, today) { /* ... */ }
export function attachActionStatesToStudents(students, today, actionStatesByKey) { /* ... */ }
export function isActionStateToday(updatedAt: string, today: Date) { /* ... */ }
```

**Pattern to layer on top — `'use server'` mutation facade per RESEARCH §Pattern 11 lines 836-870:**

```ts
"use server";   // ← NEW: marks every export as a Server Action (file-level directive)

import { revalidateTag } from "next/cache";
import { upsertFollowUpState, appendFollowUpLog,
         markInactive as dbMarkInactive,
         clearInactive as dbClearInactive } from "@/lib/db/queries";
import { bulkSetStudentAction as dbBulkSetStudentAction } from "@/lib/db/bulk-queries";
import { DASHBOARD_CACHE_TAG } from "@/lib/dashboard/config";
import { recordCacheInvalidation } from "@/lib/dashboard/health-state";

export async function setStudentAction(input: { /* studentKey, studentName, parentName, status, updatedByEmail, updatedByName */ }) {
  // D-28: Postgres write FIRST, revalidateTag SECOND
  await upsertFollowUpState(input);
  await appendFollowUpLog({ ...input, actionType: "set" });
  revalidateTag(DASHBOARD_CACHE_TAG, "max");                 // RESEARCH §Pattern 5 — NOT updateTag
  recordCacheInvalidation(new Date().toISOString());
}

export async function clearStudentAction(input: { /* ... */ }) {
  // delete or null-status the row, then log + invalidate
  await appendFollowUpLog({ ...input, actionType: "clear", status: null });
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
  recordCacheInvalidation(new Date().toISOString());
}

export async function bulkSetAction(input: { updates, actorEmail, actorName }) {
  await dbBulkSetStudentAction(input);                      // single transaction per D-25
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
  recordCacheInvalidation(new Date().toISOString());
}

export async function markInactiveStudent(input: { /* ... */ }) {
  await dbMarkInactive(input);
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
  recordCacheInvalidation(new Date().toISOString());
}

export async function clearInactiveStudent(studentKey: string) {
  await dbClearInactive(studentKey);
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
  recordCacheInvalidation(new Date().toISOString());
}
```

**Closest mutation-flow analog** — `lib/sheets/actions.ts` shows the existing "write then return" shape; the facade preserves the contract but swaps the Sheet write for the Drizzle query and adds the cache invalidation.

**Type contract** — input shapes already match `FollowUpStateInsert` from `web/src/lib/db/schema.ts` (DB-06 enforces actor attribution at compile time per `db/queries.ts:5-8`).

**Caveat per RESEARCH §A7** — the `'use server'` directive establishes binding at file level, but `revalidateTag` works in BOTH server actions and route handlers (Next.js 16 docs). `updateTag` does NOT — that's why this file exists as a facade.

---

### `web/src/lib/dashboard/config.ts` (constants, additive)

**Analog:** existing `config.ts` (in-place edit; D-36).

**Pattern to follow** (alongside existing `DASHBOARD_CACHE_TAG = "dashboard-payload"` at `config.ts:10`):

```ts
// SVC-08 / D-36 — hardcoded URL to the pre-cutover DashboardActionsState tab.
// Phase 5 RETI-06 updates to immutable archive URL per RETI-03 snapshot.
export const ARCHIVE_ACTION_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit#gid=<TAB_GID>";
```

**Operator action** per D-36: Kevin confirms the exact URL during plan execution. Planner writes a TODO marker until provided.

---

### `web/src/components/dashboard/student-detail.tsx` (React client component, additive header element)

**Analog:** `student-detail.tsx:81-94` (sticky header block — the host site for the new affordance).

**Existing header shape** (`student-detail.tsx:81-94`):

```tsx
<section className="panel" style={{ position: "sticky", top: 0, zIndex: 5, padding: "8px 10px" }}>
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
    <div style={{ minWidth: 0 }}>
      <h2 style={{ fontSize: "1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{student.student}</h2>
      <div className="muted" style={{ fontSize: "0.75rem" }}>
        {student.parent || "No parent"} · {student.adminOwnerName || "Unassigned"}
      </div>
    </div>
    <div className="mini-pills" style={{ gap: 4, flexShrink: 0 }}>
      <span className={`status-pill tone-${worstStatus(student.packages)}`} style={{ padding: "2px 8px", fontSize: "0.72rem" }}>
        {statusLabel(worstStatus(student.packages))}
      </span>
    </div>
  </div>
```

**Pattern to add** (after the muted parent/admin div, per D-30 — subtle styling, not a CTA):

```tsx
<div className="muted" style={{ fontSize: "0.75rem" }}>
  {student.parent || "No parent"} · {student.adminOwnerName || "Unassigned"}
</div>
{/* TODO: remove in Phase 5 RETI-01 when Apps Script retires (D-30). */}
<a
  href={ARCHIVE_ACTION_SHEET_URL}
  target="_blank"
  rel="noopener noreferrer"
  aria-label="Open pre-cutover follow-up history in new tab"
  className="muted"
  style={{ fontSize: "0.72rem", textDecoration: "underline", marginTop: 2, display: "inline-block" }}
>
  View pre-cutover history →
</a>
```

**Conventions used in this file** (so the new element fits in):
- Inline `style` objects, no CSS modules.
- `className="muted"` for subtle tone (matches existing parent/admin line).
- Existing buttons use plain `<button type="button">`; here we use `<a>` because the click target is external.
- React 19 conventions, no extra deps.

**Import to add** at top of `student-detail.tsx`:

```ts
import { ARCHIVE_ACTION_SHEET_URL } from "@/lib/dashboard/config";
```

---

### `web/src/app/api/actions/route.ts` (route handler, mutation)

**Analog:** current `actions/route.ts:1-53` (full file — same skeleton, swap deps).

**Existing shape** (`actions/route.ts:1-52`, the pattern to preserve — auth gate, body parse, payload-lookup-for-rename, conditional set-or-clear, invalidate, error envelope):

```ts
import { requireSessionUser } from "@/lib/auth/session";
import { getDashboardPayload, invalidateDashboardPayloadCache } from "@/lib/dashboard/service";
import { normalizeStudentActionStatus } from "@/lib/dashboard/actions";
import { clearStudentActionInSheets, setStudentActionInSheets } from "@/lib/sheets/actions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = (await request.json()) as { studentKey?: string; status?: string | null };
    const studentKey = String(body.studentKey ?? "").trim();
    if (!studentKey) {
      return NextResponse.json({ error: "studentKey is required" }, { status: 400 });
    }
    const payload = await getDashboardPayload();
    const student = payload.students.find((item) => item.studentKey === studentKey);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    const normalizedStatus = normalizeStudentActionStatus(body.status);
    const result = normalizedStatus
      ? await setStudentActionInSheets({ /* ... */ })
      : await clearStudentActionInSheets({ /* ... */ });
    invalidateDashboardPayloadCache();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action request failed" },
      { status: 500 },
    );
  }
}
```

**Pattern to apply** (per RESEARCH §Code Examples Operation 1 + RESEARCH §Pattern 5 finding, lines 433-481):

```ts
import { requireSessionUser } from "@/lib/auth/session";
import { getDashboardPayload } from "@/lib/dashboard/service";
import { setStudentAction, clearStudentAction, normalizeStudentActionStatus } from "@/lib/dashboard/actions";
import { log } from "@/lib/runtime/logger";
import { NextResponse } from "next/server";

export const runtime = "nodejs";   // RESEARCH §user_constraints — REQUIRED on every route

export async function POST(request: Request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = (await request.json()) as { studentKey?: string; status?: string | null };
    const studentKey = String(body.studentKey ?? "").trim();
    if (!studentKey) {
      return NextResponse.json({ error: "studentKey is required" }, { status: 400 });
    }

    // Lookup student for rename pass-through (preserve existing 404 behavior + studentName/parentName threading)
    const payload = await getDashboardPayload();
    const student = payload.students.find((item) => item.studentKey === studentKey);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const normalized = normalizeStudentActionStatus(body.status);
    if (normalized) {
      await setStudentAction({
        studentKey, studentName: student.student, parentName: student.parent,
        status: normalized,
        updatedByEmail: sessionUser.email, updatedByName: sessionUser.name,
      });
    } else {
      await clearStudentAction({
        studentKey, studentName: student.student, parentName: student.parent,
        actorEmail: sessionUser.email, actorName: sessionUser.name,
      });
    }
    // No inline revalidateTag — the actions.ts facade owns single-source-of-truth invalidation.

    return NextResponse.json({ ok: true });   // matches existing client expectation
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log("error", "/api/actions", error);     // D-37 structured log — NEW
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action request failed" },
      { status: 500 },
    );
  }
}
```

---

### `web/src/app/api/dashboard/route.ts` (NEW route handler, read)

**Analog:** `web/src/app/api/actions/route.ts:1-52` (NextResponse + auth + try/catch shape) + RESEARCH §Code Examples Operation 2 (lines 1063-1087).

**Pattern to apply** (full file — boilerplate is short):

```ts
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { getDashboardPayload } from "@/lib/dashboard/service";
import { log } from "@/lib/runtime/logger";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireSessionUser();
    const payload = await getDashboardPayload();
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log("error", "/api/dashboard", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dashboard load failed" },
      { status: 500 });
  }
}
```

---

### `web/src/app/api/actions/bulk/route.ts` (NEW route handler, bulk mutation)

**Analog:** `web/src/app/api/actions/route.ts` (handler skeleton) + `web/src/lib/db/bulk-queries.ts:50-98` (the `bulkSetStudentAction` transaction that gets called via the actions.ts facade).

**Bulk transaction pattern from `bulk-queries.ts:50-98`** (already implemented in Phase 2 — wrapped in actions.ts):

```ts
export async function bulkSetStudentAction(input: BulkActionInput): Promise<void> {
  if (input.updates.length === 0) return;
  const bulkDb = getBulkDb();
  await bulkDb.transaction(async (tx) => {
    const stateValues: FollowUpStateInsert[] = input.updates.map((u) => ({ ... }));
    const logValues: FollowUpLogInsert[] = input.updates.map((u) => ({ ... }));
    await tx.insert(followUpState).values(stateValues).onConflictDoUpdate({...});
    await tx.insert(followUpLog).values(logValues);
  });
}
```

**Route handler shape** (route owns: parse + dedupe + actor lookup + payload lookup → call facade):

```ts
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { getDashboardPayload } from "@/lib/dashboard/service";
import { bulkSetAction, normalizeStudentActionStatus } from "@/lib/dashboard/actions";
import { log } from "@/lib/runtime/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = (await request.json()) as { studentKeys?: string[]; status?: string };
    const studentKeys = Array.from(new Set((body.studentKeys ?? []).map((k) => String(k).trim()).filter(Boolean)));
    const normalized = normalizeStudentActionStatus(body.status);
    if (!studentKeys.length || !normalized) {
      return NextResponse.json({ error: "studentKeys + valid status required" }, { status: 400 });
    }
    const payload = await getDashboardPayload();
    const updates = studentKeys
      .map((key) => payload.students.find((s) => s.studentKey === key))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ studentKey: s.studentKey, studentName: s.student, parentName: s.parent, status: normalized }));

    await bulkSetAction({
      updates,
      actorEmail: sessionUser.email,
      actorName: sessionUser.name,
    });
    return NextResponse.json({ updated: updates.map((u) => u.studentKey) });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log("error", "/api/actions/bulk", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk action failed" },
      { status: 500 });
  }
}
```

The "deduplicate then map" shape is preserved from `actions-route.test.ts:89-115` which exercised that contract on the Sheets-era code.

---

### `web/src/app/api/actions/history/route.ts` (NEW route handler, read)

**Analog:** `actions/route.ts` skeleton + `web/src/lib/db/queries.ts:153-169` (`readHistory`).

**`readHistory` Phase 2 contract** (`queries.ts:153-169`):

```ts
export async function readHistory(studentKey: string, sinceDays = 7): Promise<FollowUpLogRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  return db.select().from(followUpLog)
    .where(and(eq(followUpLog.studentKey, studentKey), gte(followUpLog.createdAt, since)))
    .orderBy(desc(followUpLog.createdAt));
}
```

**Route handler shape** (read-only — pluck `studentKey` from query string):

```ts
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { readHistory } from "@/lib/db/queries";
import { log } from "@/lib/runtime/logger";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireSessionUser();
    const url = new URL(request.url);
    const studentKey = String(url.searchParams.get("studentKey") ?? "").trim();
    if (!studentKey) {
      return NextResponse.json({ error: "studentKey is required" }, { status: 400 });
    }
    const rows = await readHistory(studentKey, 7);
    // Map to client-shape (mirrors existing ActionHistoryEntry shape consumed by student-detail.tsx)
    const history = rows.map((r) => ({
      status: r.status, updatedAt: r.createdAt.toISOString(),
      updatedByName: r.actorName, actionType: r.actionType,
    }));
    return NextResponse.json({ history });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log("error", "/api/actions/history", error);
    return NextResponse.json({ error: "History request failed" }, { status: 500 });
  }
}
```

---

### `web/src/app/api/inactive/route.ts` (NEW route handler, toggle mutation — POST + DELETE)

**Analog:** `actions/route.ts` skeleton + `web/src/lib/db/queries.ts:118-143` (`markInactive` / `clearInactive`).

**Dual-method route handler shape** (Next.js 16 supports `POST` + `DELETE` in the same `route.ts`):

```ts
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { markInactiveStudent, clearInactiveStudent } from "@/lib/dashboard/actions";
import { getDashboardPayload } from "@/lib/dashboard/service";
import { log } from "@/lib/runtime/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = (await request.json()) as { studentKey?: string };
    const studentKey = String(body.studentKey ?? "").trim();
    if (!studentKey) return NextResponse.json({ error: "studentKey is required" }, { status: 400 });

    const payload = await getDashboardPayload();
    const student = payload.students.find((s) => s.studentKey === studentKey);
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

    await markInactiveStudent({
      studentKey, studentName: student.student, parentName: student.parent,
      markedByEmail: sessionUser.email, markedByName: sessionUser.name,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorEnvelope("/api/inactive", error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSessionUser();
    const body = (await request.json()) as { studentKey?: string };
    const studentKey = String(body.studentKey ?? "").trim();
    if (!studentKey) return NextResponse.json({ error: "studentKey is required" }, { status: 400 });
    await clearInactiveStudent(studentKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorEnvelope("/api/inactive", error);
  }
}

function errorEnvelope(route: string, error: unknown) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  log("error", route, error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 });
}
```

---

### `web/src/app/api/health/route.ts` (NEW route handler, uncached probe)

**Analog:** `actions/route.ts:1-9` (NextResponse + `runtime = "nodejs"` skeleton) + `web/src/lib/wisenet/client.ts:70-93` (wisenetFetch shape) + `web/src/lib/db/client.ts:13-20` (Drizzle HTTP client).

**Pattern to apply** — full file from RESEARCH §Pattern 8 lines 549-635:

```ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { wisenetFetch } from "@/lib/wisenet/client";
import { getAuthEnv, getWisenetEnv } from "@/lib/runtime/env";

export const runtime = "nodejs";
// CRITICAL per D-32: NO 'use cache: remote' — health must probe live every call.
// CRITICAL: NO requireSessionUser — uptime monitors must reach this endpoint without auth.

interface SubsystemStatus { status: "ok" | "degraded" | "down"; latencyMs?: number; error?: string; }
interface AuthStatus { status: "ok" | "down"; error?: string; }

export async function GET() {
  const timestamp = new Date().toISOString();
  const [wisenet, postgres, auth] = await Promise.all([probeWisenet(), probePostgres(), probeAuth()]);
  const overall: "ok" | "degraded" | "down" =
    [wisenet, postgres].some((s) => s.status === "down") || auth.status === "down" ? "down"
    : [wisenet, postgres].some((s) => s.status === "degraded") ? "degraded"
    : "ok";
  const statusCode = overall === "down" ? 503 : 200;   // D-32: 503 only on down
  return NextResponse.json({
    status: overall, timestamp, subsystems: { wisenet, postgres, auth },
    deployedAt: process.env.VERCEL_DEPLOYMENT_ID,
  }, { status: statusCode });
}

async function probeWisenet(): Promise<SubsystemStatus> {
  const start = Date.now();
  try {
    const env = getWisenetEnv();
    await wisenetFetch(`/institutes/v3/${env.WISENET_CENTER_ID}/students?page_number=1&page_size=1`,
      z.object({ status: z.union([z.string(), z.number()]) }).passthrough(),
      { signal: AbortSignal.timeout(5_000) });   // tighter than client default 15s
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return { status: "down", latencyMs: Date.now() - start,
             error: error instanceof Error ? error.message : String(error) };
  }
}

async function probePostgres(): Promise<SubsystemStatus> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);            // D-32: HTTP driver, SELECT 1
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return { status: "down", latencyMs: Date.now() - start,
             error: error instanceof Error ? error.message : String(error) };
  }
}

function probeAuth(): AuthStatus {
  try { getAuthEnv(); return { status: "ok" }; }
  catch (error) {
    return { status: "down", error: error instanceof Error ? error.message : String(error) };
  }
}
```

**Security reminder per RESEARCH §Security Domain line 1220:** `WisenetError.message` is `Wisenet ${status} at ${path}` — pathname only, no creds. Safe to surface in unauthenticated `error` field.

---

### `web/src/lib/runtime/logger.ts` (NEW utility — D-37)

**No direct analog in repo** — this is the first observability helper. The closest sibling is `web/src/lib/runtime/env.ts`, which sets the directory convention.

**`env.ts` convention to follow** (`runtime/env.ts:1-7`):

```ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) { throw new Error(`Missing required environment variable: ${name}`); }
  return value;
}
// ... pure functions, no class instances, no side effects beyond throwing.
```

**Pattern to apply** (full file from CONTEXT D-37 lines 213-227 + RESEARCH §Operation 3 lines 1090-1113):

```ts
// web/src/lib/runtime/logger.ts (NEW per D-37)
// Vercel captures all console.* at the function level. JSON-line shape enables
// log search by route/level/error.message. Phase 4 DEPL-04 swaps console.error
// to Sentry.captureException — this helper is the swap point.

type LogLevel = "error" | "warn" | "info";

export function log(
  level: LogLevel,
  route: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    route,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : String(error),
    ...extra,
  };
  console.error(JSON.stringify(payload));    // even for warn/info — Vercel captures all console.*
}
```

**Conventions match `env.ts`:**
- No class.
- No external deps.
- Pure function (one side effect: `console.error`).
- `lib/runtime/` directory placement.
- TypeScript-strict, no `any`.

---

### `web/scripts/lint-no-revalidate-max.sh` (regex flip, in-place edit)

**Analog:** current script (in-place — same file, regex change per RESEARCH §Pitfall 5 line 947).

**Existing regex (lines 24-26)** — the Phase 2 anti-pattern guard:

```bash
# Pattern matches: revalidateTag(<anything>, "max")  OR  revalidateTag(<anything>, 'max')
PATTERN='revalidateTag\([^)]*,[[:space:]]*["'"'"']max["'"'"']\)'
```

**Pattern to apply (Path i per RESEARCH §Pitfall 5 — repurpose to forbid the deprecated single-arg form):**

```bash
# Pattern matches: revalidateTag(<single-arg>) — the Next.js 16 deprecated form.
# Two-arg form revalidateTag(tag, "max") is the recommended Next.js 16 invocation
# and is NOT matched by this regex.
PATTERN='revalidateTag\([^,)]+\)'
```

**Allowlist update** (lines 19-22):

```bash
# Allowlist: empty — no legitimate uses of the single-arg deprecated form remain.
ALLOWLIST=()
```

**Failure message (lines 70-77)** — update messaging to reflect the flipped semantics:

```bash
echo "The deprecated single-arg revalidateTag() form was found:"
echo ""
echo "$NON_ALLOWLISTED"
echo ""
echo "Next.js 16 deprecates revalidateTag(tag) without a profile."
echo "Use the two-arg form instead:"
echo "  revalidateTag(DASHBOARD_CACHE_TAG, \"max\")              # correct (Next.js 16)"
echo "  revalidateTag(DASHBOARD_CACHE_TAG)                        # WRONG — deprecated single-arg form"
echo ""
echo "See .planning/phases/03-service-cutover/03-RESEARCH.md §Pitfall 5."
exit 1
```

**Why path (i) over path (ii):** RESEARCH §Open Question 2 recommends repurposing — preserves "catch-revalidateTag-misuse" spirit while aligning with Next.js 16 best practice.

---

### `web/src/test/lint-no-revalidate-max.test.ts` (regression test, in-place edit)

**Analog:** current test (in-place — same file, flip the violation literal).

**Existing violation construction (lines 30-34)** — assembles `revalidateTag("foo", "max")` at runtime:

```ts
const FN = "revalidate" + "Tag";
const BAD_ARG = '"' + "max" + '"';
const VIOLATION_BODY =
  `import { ${FN} } from "next/cache";\n` +
  `export function bad() { ${FN}("foo", ${BAD_ARG}); }\n`;
```

**Pattern to apply** — flip to the deprecated single-arg form:

```ts
const FN = "revalidate" + "Tag";
const VIOLATION_BODY =
  `import { ${FN} } from "next/cache";\n` +
  `export function bad() { ${FN}("foo"); }\n`;   // single-arg = the new lint violation
```

The runtime-assembly pattern stays — its purpose (don't have THIS test file match the lint regex) is even more critical now that the regex matches the more common form.

**Other parts unchanged:** `runLint()` helper, `cleanupTempFile`, beforeAll/afterAll lifecycle, three-step positive→negative→positive cycle.

---

### `web/src/test/actions-route.test.ts` (in-place rewrite — Wave 0)

**Analog:** current `actions-route.test.ts:1-117` (the structure stays — only mocked module names + assertions change).

**Existing mock pattern (lines 1-22)** — module-scope mocks with named functions:

```ts
const requireSessionUser = vi.fn();
const getDashboardPayload = vi.fn();
const invalidateDashboardPayloadCache = vi.fn();
const setStudentActionInSheets = vi.fn();
const clearStudentActionInSheets = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireSessionUser }));
vi.mock("@/lib/dashboard/service", () => ({
  getDashboardPayload, invalidateDashboardPayloadCache,
}));
vi.mock("@/lib/sheets/actions", () => ({
  setStudentActionInSheets, clearStudentActionInSheets,
}));
```

**Pattern to apply** — swap mocked modules + assert the actions facade was invoked:

```ts
const requireSessionUser = vi.fn();
const getDashboardPayload = vi.fn();
const setStudentAction = vi.fn();
const clearStudentAction = vi.fn();
const bulkSetAction = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireSessionUser }));
vi.mock("@/lib/dashboard/service", () => ({ getDashboardPayload }));
vi.mock("@/lib/dashboard/actions", () => ({
  setStudentAction, clearStudentAction, bulkSetAction,
  // KEEP the real normalizeStudentActionStatus by spreading actual:
  ...(await vi.importActual("@/lib/dashboard/actions") as Record<string, unknown>),
}));
```

**Existing assertion to adapt (lines 78-86)** — was checking `setStudentActionInSheets` + `invalidateDashboardPayloadCache`:

```ts
expect(setStudentActionInSheets).toHaveBeenCalledWith(expect.objectContaining({...}));
expect(invalidateDashboardPayloadCache).toHaveBeenCalledTimes(1);
```

**Pattern to apply** — assert the new facade method:

```ts
expect(setStudentAction).toHaveBeenCalledWith(expect.objectContaining({
  studentKey: "jade lim::ivy lim",
  studentName: "Jade Lim", parentName: "Ivy Lim",
  status: "contacted",
  updatedByEmail: "palm@example.com", updatedByName: "Palm",
}));
// Cache invalidation lives inside the facade; tested separately at the actions.ts unit level.
```

**Bulk test pattern (lines 89-116)** — same dedupe assertion, mocked target swapped to `bulkSetAction`:

```ts
const { POST } = await import("@/app/api/actions/bulk/route");
// ... POST with 3 keys including duplicate ...
expect(bulkSetAction).toHaveBeenCalledTimes(1);
const call = bulkSetAction.mock.calls[0]?.[0] as { updates: Array<{ studentKey: string }> };
expect(call.updates.map((u) => u.studentKey)).toEqual(["jade lim::ivy lim", "gina ho::mira ho"]);
```

---

### `web/src/test/cache-invalidation.test.ts` (NEW — TEST-03, gated)

**Primary analog:** `web/src/test/db-queries.test.ts:14-66` (env-stubbed Drizzle pattern + dynamic-import) + `web/src/test/wisenet-client.test.ts:72-100` (env snapshot/restore lifecycle).

**Env-snapshot pattern from `db-queries.test.ts:14-34`:**

```ts
const ORIGINAL_ENV = { ...process.env };

describe("queries.ts", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.DATABASE_URL = "postgresql://user:pass@ep-test.neon.tech/dbname?sslmode=require";
    process.env.DATABASE_URL_UNPOOLED = "postgresql://user:pass@ep-test.neon.tech/dbname?sslmode=require";
    vi.resetModules();
  });
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/db/client");
    process.env = { ...ORIGINAL_ENV };
  });
  // ... vi.doMock + dynamic import per test
});
```

**Skip-gate pattern** (RESEARCH §Pattern 10 line 785; `describe.skipIf` is Vitest 3 native):

```ts
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DATABASE_URL)("cache invalidation regression (TEST-03)", () => {
  // ... seed → read → write → revalidateTag → read → assert
});
```

**Wisenet fetch mock** — reuse `wisenetFetch` mock pattern from `wisenet-client.test.ts:103-130` (`vi.stubGlobal("fetch", vi.fn(...))`). Fixtures already exist at `web/src/test/fixtures/wisenet/*.json` per D-04.

**Per RESEARCH §Pitfall 7** — the test exercises Postgres-side correctness; whether vitest reaches the Vercel Runtime Cache is uncovered. The 8-step shape per D-29 still proves the write→read flow.

---

### `web/src/test/chunked-transfer-regression.test.ts` (NEW — TEST-06)

**Primary analog:** `web/src/test/wisenet-client.test.ts:72-330` (full `vi.stubGlobal("fetch", ...)` pattern + env snapshot/restore + WisenetError assertion).

**`vi.stubGlobal` pattern from `wisenet-client.test.ts:75-100`:**

```ts
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  __resetAuthHeaderCacheForTest();
  envSnapshot = {
    WISENET_BASE_URL: process.env.WISENET_BASE_URL,
    WISENET_USER_ID: process.env.WISENET_USER_ID,
    WISENET_API_KEY: process.env.WISENET_API_KEY,
    WISENET_CENTER_ID: process.env.WISENET_CENTER_ID,
    WISENET_NAMESPACE: process.env.WISENET_NAMESPACE,
  };
  process.env.WISENET_BASE_URL = "https://api.wiseapp.live";
  // ... set test env values
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(envSnapshot)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
```

**Pattern to apply** (RESEARCH §Pattern 9 lines 644-712 — `ReadableStream` body for Response):

```ts
function makeChunkedJsonResponse(json: unknown): Response {
  const fullText = JSON.stringify(json);
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode(fullText.slice(0, Math.floor(fullText.length / 3))),
    encoder.encode(fullText.slice(Math.floor(fullText.length / 3), Math.floor(2 * fullText.length / 3))),
    encoder.encode(fullText.slice(Math.floor(2 * fullText.length / 3))),
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "application/json" } });
}
```

The wrapping describe + `vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(makeChunkedJsonResponse({...}))))` directly mirrors `wisenet-client.test.ts:103-130`.

---

### `web/src/test/health-route.test.ts` (NEW — Wave 0, D-32 shape)

**Primary analog:** `web/src/test/actions-route.test.ts:1-117` (route-handler smoke pattern).

**Mock setup pattern to apply** (mirrors `actions-route.test.ts:1-22`):

```ts
const wisenetFetch = vi.fn();
const dbExecute = vi.fn();
const getAuthEnv = vi.fn();

vi.mock("@/lib/wisenet/client", () => ({ wisenetFetch }));
vi.mock("@/lib/db/client", () => ({ db: { execute: dbExecute } }));
vi.mock("@/lib/runtime/env", () => ({ getAuthEnv, getWisenetEnv: () => ({ WISENET_CENTER_ID: "test" }) }));
```

**Test shapes** (D-32 status rollup matrix — 5 cases):

| Case | wisenet | postgres | auth | Expected `status` | Expected HTTP |
|------|---------|----------|------|------------------|---------------|
| 1 | ok | ok | ok | "ok" | 200 |
| 2 | ok | down | ok | "down" | 503 |
| 3 | down | ok | ok | "down" | 503 |
| 4 | ok | ok | down | "down" | 503 |
| 5 | (degraded variant if planner adds) | | | "degraded" | 200 |

Per D-32 lines 157-161, status rollup: any down→down, any degraded→degraded, all ok→ok. Status code: 200 for ok+degraded, 503 for down.

---

### `web/src/test/dashboard-route.test.ts` (OPTIONAL, Wave 0 — planner's call)

**Primary analog:** `web/src/test/actions-route.test.ts` (route-handler smoke pattern).

If included, follow the `actions-route.test.ts` shape exactly — mock `requireSessionUser` + `getDashboardPayload`, send a Request, assert NextResponse.

---

### `web/src/test/student-detail.test.tsx` (OPTIONAL — sets first component-test precedent)

**No analog in repo.** RESEARCH §Wave 0 line 1207: "current repo has no component test precedent." Planner's call.

If included, this requires:
- Adding `@testing-library/react` + `@testing-library/jest-dom` deps.
- Setting `vitest.config.ts` `environment: "jsdom"` (currently `"node"` — would need a per-file override).
- A render assertion that the new `<a>` tag exists with the correct `href`, `target`, `rel`, and `aria-label`.

CONTEXT line 246 + RESEARCH line 1207 both flag this as planner discretion — recommendation: defer to Phase 4 unless the affordance is judged high-risk.

---

## Shared Patterns

### Authentication (route handlers)

**Source:** `web/src/lib/auth/session.ts:1-14`
**Apply to:** `/api/dashboard`, `/api/actions`, `/api/actions/bulk`, `/api/actions/history`, `/api/inactive` (NOT `/api/health` — uptime monitors)

```ts
// Excerpt: web/src/lib/auth/session.ts (full file)
import { auth } from "@/auth";
import type { AppSessionUser } from "@/types/dashboard";

export async function requireSessionUser(): Promise<AppSessionUser> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  const name = session?.user?.name?.trim();
  if (!email || !name) { throw new Error("Unauthorized"); }
  return { email, name };
}
```

**Caller pattern (every protected route):**

```ts
try {
  const sessionUser = await requireSessionUser();
  // ...
} catch (error) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ... other error handling
}
```

---

### Error envelope (route handlers)

**Source:** `web/src/app/api/actions/route.ts:43-50`
**Apply to:** all 5 protected route handlers + `/api/health`

```ts
// 401 for Unauthorized, 500 for everything else, JSON envelope.
} catch (error) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  log("error", "/api/<route>", error);   // D-37 NEW per Phase 3
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "<route> request failed" },
    { status: 500 });
}
```

**Status codes used (existing convention preserved):**
- 200: success (read or write)
- 400: missing/invalid input (`studentKey is required`)
- 401: `Unauthorized`
- 404: student not found
- 500: server error
- 503: NEW — `/api/health` only, when `overall === "down"` (D-32)

---

### Node runtime declaration (route handlers)

**Source:** every existing `route.ts` (verified `actions/route.ts:7`).
**Apply to:** all 6 swapped route handlers — D-17/D-25 require Drizzle WebSocket Pool path; CLAUDE.md §Conventions requires it for Buffer auth header.

```ts
export const runtime = "nodejs";
```

Per RESEARCH line 92: "required for Drizzle WebSocket Pool path AND for Wisenet `Buffer.from(...).toString("base64")` auth header construction. Edge runtime is forbidden."

---

### Cache invalidation (post-write)

**Source:** RESEARCH §Pattern 5 line 471 (Path A — `revalidateTag(tag, "max")` from route handler/server action).
**Apply to:** every mutation site in `lib/dashboard/actions.ts` AFTER the Postgres write completes.

```ts
import { revalidateTag } from "next/cache";
import { DASHBOARD_CACHE_TAG } from "@/lib/dashboard/config";

// Inside each mutation (per D-28 — write FIRST, invalidate SECOND):
await upsertFollowUpState(input);
await appendFollowUpLog(...);
revalidateTag(DASHBOARD_CACHE_TAG, "max");   // synchronous, fires only if writes succeeded
```

**Critical override (RESEARCH §Pattern 5 lines 397-431):** D-28's `updateTag` becomes `revalidateTag(tag, "max")` because `updateTag` is Server-Actions-only and would throw at runtime when invoked from a route handler.

---

### Logger usage

**Source:** D-37 + RESEARCH §Operation 3.
**Apply to:** every `catch` block in route handlers + service.ts.

```ts
import { log } from "@/lib/runtime/logger";

// In a catch block:
log("error", "/api/<route>", error, { studentKey });   // route + extras enable Vercel log search
```

Phase 4 DEPL-04 swaps the `console.error(JSON.stringify(...))` body for `Sentry.captureException(...)`. Call sites stay the same.

---

### Vitest mocking (route handlers)

**Source:** `web/src/test/actions-route.test.ts:1-22` + `web/src/test/db-queries.test.ts:14-34`.
**Apply to:** every new route handler test.

**Module-scope mocks + dynamic import shape:**

```ts
const fooMock = vi.fn();
vi.mock("@/lib/foo", () => ({ foo: fooMock }));

it("does X", async () => {
  fooMock.mockResolvedValue(...);
  const { POST } = await import("@/app/api/<route>/route");   // dynamic import — required for mocks
  const response = await POST(new Request("http://localhost/...", { method: "POST", ... }));
  expect(response.status).toBe(200);
});
```

**Why dynamic import:** module-scope `vi.mock` works for static imports too, but the existing test pattern uses dynamic to defer module loading until after mocks are set up — Phase 3 should follow.

**ENV snapshot/restore** — used only when the test transitively imports `lib/runtime/env.ts` (Drizzle/Wisenet clients call `getDbEnv()` / `getWisenetEnv()` at module load). For pure-route tests that mock `lib/dashboard/service` etc., the env snapshot isn't needed.

---

### Vitest streaming-fetch mock

**Source:** RESEARCH §Pattern 9 + `wisenet-client.test.ts:75-330` (existing fetch-stub pattern).
**Apply to:** TEST-06 chunked-transfer regression.

```ts
vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(makeChunkedJsonResponse({...}))));
// ... at end of test or in afterEach:
vi.unstubAllGlobals();
```

The `ReadableStream`-bodied `Response` ensures `await response.json()` exercises chunk concatenation (per RESEARCH note at line 716).

---

### Constants placement

**Source:** `web/src/lib/dashboard/config.ts` — single co-located constants module.
**Apply to:** `ARCHIVE_ACTION_SHEET_URL` (D-36).

The file already exports `DASHBOARD_CACHE_TAG`, `DASHBOARD_CACHE_REVALIDATE_SECONDS`, sheet names, header tuples. Phase 3 adds one more `export const`. Don't introduce a new constants file.

---

## No Analog Found

| File | Role | Reason | Mitigation |
|------|------|--------|------------|
| `web/src/lib/runtime/logger.ts` | structured logger utility | First observability helper in repo. RESEARCH §Don't Hand-Roll line 895 explicitly recommends NOT using Pino/Winston for this. | Follow `runtime/env.ts` directory + pure-function convention; full body provided in CONTEXT D-37 + RESEARCH §Operation 3. |
| `web/src/test/student-detail.test.tsx` (optional) | React component render test | RESEARCH line 1207: no component test precedent in repo. Adding one requires `@testing-library/react` + jsdom config. | Planner discretion per CONTEXT line 246. Recommendation: defer to Phase 4; rely on D-35 step 4 manual QA. |

---

## Cross-File Consistency Constraints

These rules apply across multiple files in this phase:

1. **Every `route.ts` has `export const runtime = "nodejs"`** — mandatory per CLAUDE.md + RESEARCH line 92.
2. **Every protected `route.ts` calls `requireSessionUser()` first** — except `/api/health` (uncached, unauth).
3. **Every `route.ts` mutation calls a `lib/dashboard/actions.ts` facade method, not Drizzle queries directly** — per Claude's Discretion option (b) + RESEARCH §Open Q4.
4. **Every catch block in `route.ts` and `service.ts` calls `log("error", "<route>", error)`** — D-37 + RESEARCH §Operation 2.
5. **`'use cache: remote'` directive ONLY in `service.ts::getDashboardPayload`** — D-32 forbids it in `/api/health`; CONTEXT/RESEARCH don't require it elsewhere in Phase 3.
6. **`revalidateTag(DASHBOARD_CACHE_TAG, "max")` ONLY in `lib/dashboard/actions.ts`** — single source of truth (Path b).
7. **Buildable per-commit** — D-33 requires every commit leave `npm run build` passing. Order is additive→deletion: commits 1-7 don't break Sheets paths until commit 8 deletes them.
8. **`lib/sheets/*` and `lib/cache/memory-cache.ts` deleted ONLY in commit 8 (D-33)** — earlier commits keep them coexisting with the new code paths.
9. **`googleapis` removed in commit 9 (D-33)** — only after every `import` of it is gone.

---

## Metadata

**Analog search scope:** `web/src/`, `web/scripts/`, `web/src/test/`, `web/next.config.ts`, `web/package.json`
**Files scanned:** 60+ TypeScript files
**Pattern extraction date:** 2026-04-29
**Aligned with:** CONTEXT.md (17 locked decisions D-04..D-37) + RESEARCH.md (4 critical findings + 11 open patterns + 7 pitfalls)
