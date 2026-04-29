# Coding Conventions

**Analysis Date:** 2026-04-20

This codebase spans two runtimes:

- **Apps Script layer** at repo root — tracked `.gs` files deployed via `clasp` to a shared Apps Script project. ES5-style JavaScript constrained by the Apps Script runtime.
- **Next.js shadow app** at `web/` — TypeScript / Next.js 16 App Router / Vitest. Mirrors the Apps Script business logic for migration.

Conventions differ between the two. Always check which layer you are touching.

## Repo-Level Ownership Rules

Defined in `CLAUDE.md` and `AGENTS.md`.

**One issue, one branch, one PR:**
- Start from a GitHub Issue for non-trivial work (`CLAUDE.md:7`, `AGENTS.md:9`).
- Keep one branch and one PR per issue (`CLAUDE.md:9`).
- Prefer small composable PRs when file ownership overlaps (`AGENTS.md:12`).

**Apps Script slice ownership:**
- Never rebuild a monolithic `Code.gs` — backend logic stays split across the tracked `.gs` files (`CLAUDE.md:21`, `AGENTS.md:22`).
- Claim ownership by individual `.gs` slice, not "backend" broadly (`CLAUDE.md:13`, `AGENTS.md:13`).
- Treat `DashboardActions.gs` as its own stateful ownership slice whenever work touches student follow-up state (`CLAUDE.md:14`, `AGENTS.md:14`).

**Shadow app ownership:**
- Treat `web/` as an active ownership area for migration work, not a side project (`CLAUDE.md:15`, `AGENTS.md:15`).
- In handoffs that touch `web/`, report both Apps Script status and Next.js shadow status (`CLAUDE.md:29`, `AGENTS.md:30`).

**Credentials never committed:**
- `.clasprc.local.json` is git-ignored and must stay local-only (`CLAUDE.md:19`, `AGENTS.md:20`).
- `.clasp.json` and `appsscript.json` ARE part of the repo baseline.

## Apps Script Layer Conventions

### File Organization

`.gs` files are loaded in file-name order by Apps Script; no imports. All top-level functions share one global namespace.

Tracked slices (line counts from `wc -l`):

| File | Lines | Role |
|------|-------|------|
| `Code.gs` | 300 | Constants, `doGet`, `beginDashboardDataTransfer`, chunked cache entry points |
| `SharedHelpers.gs` | 107 | Generic helpers (`getSheetData`, `parseNumber`, `formatDate`, `parseJsonSafely`) |
| `DashboardDataLoading.gs` | 89 | Sheet loading (`loadDashboardSources`, `getSheetSnapshot`, column validation) |
| `DashboardPackages.gs` | 661 | Business rule helpers (`buildActiveStudentSet`, `buildPendingDeductionContext`, etc.) |
| `DashboardProjection.gs` | 86 | `computeProjection`, `worstStatus` |
| `DashboardAnalytics.gs` | 678 | View-model (`buildDashboardModel`, queue/summary/calendar rollups) |
| `DashboardActions.gs` | 244 | Student action state (set/clear/bulk, history trimming, actor resolution) |
| `DashboardState.gs` | 120 | Snapshot + chunked cache persistence |
| `Validation.gs` | 2411 | Test harness, fixtures, live accuracy audit |

**Rule:** when adding new backend logic, place it in the slice that already owns the concern. If a new concern is introduced, add a new `.gs` file rather than growing `Code.gs`.

### Naming

**Functions:** `camelCase`, verbs for mutators, nouns for reads. Examples from `SharedHelpers.gs`:
```
getSheetData, getColMap, readTrimmedCell, readUpperCell,
parseNumber, normalizeText, normalizeIdentityPart,
buildDashboardStudentKey, getTodayDate, parseDate,
roundToTenth, roundToHundredth, formatDate, formatDateTime, parseJsonSafely
```

**Test functions:** start with `test` — e.g., `testTrialPackagesAreExcluded`, `testPendingFeedbackCreatesPendingDeduction` (`Validation.gs:1035`, `Validation.gs:1073`).

**Audit helpers:** start with `buildAudit` — e.g., `buildAuditActiveStudentSet`, `buildAuditPendingDeductionContext` (`Validation.gs:247`, `Validation.gs:325`). The parallel `build*` vs `buildAudit*` implementations are intentional — the audit variants are the reference implementation, the production variants must match.

**Constants:** `SCREAMING_SNAKE_CASE`, defined once in `Code.gs`:
```javascript
const SPREADSHEET_ID_CREDITS = "100bidSt63...";
const SHEET_AGGREGATIONS = "Aggregations";
const ALERT_THRESHOLD = 2;
const NOTIFY_WINDOW_DAYS = 30;
const STUDENT_ACTION_STATUSES = Object.freeze(["contacted", "pending-callback", "resolved"]);
const ADMIN_OWNER_REGISTRY = Object.freeze([...]);
```

**Sheet names** live next to spreadsheet IDs in `Code.gs:9-15`.

### Code Style

**Syntax:** ES5/ES2015 compatible — Apps Script V8 runtime. Uses:
- `const` and `let` freely
- `function() { ... }` expressions (NOT arrow functions) inside `.forEach`/`.map` callbacks — see `SharedHelpers.gs:9-13`
- No `async`/`await` (Apps Script is synchronous)
- No destructuring in function parameters
- No imports/exports — everything is global

**Indentation:** 2 spaces.

**String quoting:** double quotes (`"..."`) throughout.

**Section banners:** each file opens with an ASCII-art comment banner:
```javascript
// ============================================================
// GENERIC HELPERS
// ============================================================
```
Used in `SharedHelpers.gs:1-3`, `DashboardActions.gs:1-3`, `Code.gs:1-4`, etc.

### Error Handling

**Throw with user-facing Thai messages** when a sheet or column is missing:
```javascript
// SharedHelpers.gs:7
if (!sheet) throw new Error('ไม่พบ sheet "' + sheetName + '"');

// Code.gs:298
throw new Error("ดึงข้อมูลไม่ได้: " + e.message);
```

**Throw English messages** for programmer errors:
```javascript
// DashboardActions.gs:29
throw new Error("Student action requires a student key.");

// DashboardActions.gs:133
throw new Error("Unsupported student action status: " + status);
```

**Log and rethrow** in top-level dashboard build:
```javascript
// Code.gs:296-299
} catch (e) {
  Logger.log("buildAndPersistDashboardPayload error: " + e.toString());
  throw new Error("ดึงข้อมูลไม่ได้: " + e.message);
}
```

**Log and recover** in snapshot parse:
```javascript
// SharedHelpers.gs:101-106
try {
  return JSON.parse(value);
} catch (error) {
  Logger.log("Failed to parse snapshot JSON: " + error.message);
  return null;
}
```

### Cache / State Patterns

**Script-scoped cache + chunked writes** for payloads > 100KB. See `DashboardState.gs:63-77` (`writeChunkedCacheValue`) and `Code.gs:37-39`:
```javascript
const DASHBOARD_CACHE_KEY = "BG_DASHBOARD_PAYLOAD_V2";
const DASHBOARD_CACHE_TTL_SECONDS = 120;
const DASHBOARD_CACHE_CHUNK_SIZE = 90000;
```

**Script properties** back action-state history:
- Prefix: `BG_ACTION_V1::` + `studentKey` (`Code.gs:40`, `DashboardActions.gs:230-232`)
- History cap: `STUDENT_ACTION_HISTORY_LIMIT = 20` (`Code.gs:41`, `DashboardActions.gs:44`)
- Only same-day action state surfaces in the payload — see `sanitizeStudentActionState` (`DashboardActions.gs:157-173`).

**Cache invalidation on writes:** every mutator for student actions clears the cached payload (`DashboardActions.gs:48`).

### Options Objects

Functions that accept injectable dependencies (cache, properties, now, today) take a trailing `options` argument and fall back to real services when absent:
```javascript
// DashboardActions.gs:234-244
function getStudentActionProperties(options) {
  if (options && Object.prototype.hasOwnProperty.call(options, "properties")) {
    return options.properties;
  }
  if (typeof PropertiesService === "undefined") {
    return null;
  }
  return PropertiesService.getScriptProperties();
}
```

This is the seam for tests — fixture fakes live in `Validation.gs:2335-2385` (`createFakeCache`, `createFakeProperties`).

## Next.js / TypeScript Layer Conventions (`web/`)

### Directory Structure

```
web/src/
├── app/
│   ├── (protected)/dashboard/page.tsx  # Auth-gated dashboard entry
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── dashboard/route.ts
│   │   ├── actions/route.ts
│   │   ├── actions/bulk/route.ts
│   │   ├── actions/history/route.ts
│   │   ├── health/route.ts
│   │   └── inactive/route.ts
│   ├── signin/page.tsx
│   ├── layout.tsx
│   ├── page.tsx                        # Root redirect
│   └── globals.css
├── auth.ts                             # NextAuth config (exports handlers/auth/signIn/signOut)
├── components/dashboard/
│   ├── dashboard-shell.tsx             # Client shell (state owner)
│   ├── queue-panel.tsx
│   ├── calendar-panel.tsx
│   ├── student-detail.tsx
│   ├── bulk-action-bar.tsx
│   ├── filter-toolbar.tsx
│   ├── summary-bar.tsx
│   ├── line-preview-modal.tsx
│   └── toast-notification.tsx
├── hooks/
│   ├── use-keyboard-shortcuts.ts
│   ├── use-resizable-split.ts
│   └── use-theme.ts
├── lib/
│   ├── auth/session.ts                 # requireSessionUser
│   ├── cache/memory-cache.ts           # Process-local TTL cache
│   ├── dashboard/                      # Ported business logic
│   │   ├── actions.ts
│   │   ├── analytics.ts
│   │   ├── build.ts
│   │   ├── config.ts
│   │   ├── domain.ts
│   │   ├── health-state.ts
│   │   ├── helpers.ts
│   │   ├── packages.ts
│   │   ├── projection.ts
│   │   ├── service.ts                  # unstable_cache wrapper
│   │   ├── snapshot-store.ts
│   │   └── ui-helpers.ts
│   ├── runtime/env.ts                  # Required-env accessors
│   └── sheets/
│       ├── actions.ts
│       ├── client.ts                   # JWT-authenticated googleapis client
│       ├── inactive-students.ts
│       └── source-loader.ts
├── test/
│   ├── actions-route.test.ts
│   └── dashboard-logic.test.ts
└── types/
    ├── dashboard.ts                    # Shared domain types
    └── next-auth.d.ts                  # Session augmentation
```

### TypeScript Config

From `web/tsconfig.json`:
- `strict: true` (no exceptions)
- `target: ES2022`, `module: ESNext`, `moduleResolution: "Bundler"`
- Path alias `@/*` → `./src/*`
- `allowJs: false` — TypeScript only, no JS escape hatch

### Naming

**Files:** kebab-case for everything.
- Components: `dashboard-shell.tsx`, `queue-panel.tsx`, `line-preview-modal.tsx`
- Hooks: `use-*.ts` — `use-theme.ts`, `use-keyboard-shortcuts.ts`, `use-resizable-split.ts`
- Lib modules: `memory-cache.ts`, `source-loader.ts`, `health-state.ts`
- Route handlers: `route.ts` (Next.js App Router convention)
- Pages: `page.tsx`, `layout.tsx`

**Identifiers:**
- Functions, variables: `camelCase` (`loadDashboardSources`, `getSheetsClient`, `sanitizeStudentActionState`)
- React components: `PascalCase` (`DashboardShell`, `QueuePanel`, `CalendarPanel`)
- Hooks: `useCamelCase` prefix (`useTheme`, `useKeyboardShortcuts`, `useResizableSplit`)
- Types/interfaces: `PascalCase` (`DashboardPayload`, `StudentRecord`, `ActionState`, `AppSessionUser`)
- Constants: `SCREAMING_SNAKE_CASE` exported from `lib/dashboard/config.ts` (`DASHBOARD_CACHE_TAG`, `ALERT_THRESHOLD`, `SHEETS_IN_MEMORY_TTL_MS`, `ADMIN_OWNER_REGISTRY`)
- String-literal union types preferred over enums: `PackageStatus = "notify" | "watch" | "ok" | "nodata"` (`web/src/types/dashboard.ts:1`)

### Imports

**Order observed** (not enforced by lint — be consistent manually):
1. Node built-ins (`import { randomUUID } from "node:crypto";` — `lib/sheets/actions.ts:1`)
2. Third-party packages (`import { google } from "googleapis";`, `import NextAuth from "next-auth";`)
3. Blank line
4. Internal absolute imports via `@/*` alias
5. Blank line
6. Relative imports (`./queue-panel`, `./student-detail`)

Example from `components/dashboard/dashboard-shell.tsx:1-51`:
```typescript
"use client";

import { startTransition, useCallback, ... } from "react";

import { formatShortTimestamp } from "@/lib/dashboard/helpers";
import type { AppSessionUser, ... } from "@/types/dashboard";
import type { CalendarView, ... } from "@/lib/dashboard/ui-helpers";
import { actionStatusLabel, ... } from "@/lib/dashboard/ui-helpers";

import { BulkActionBar } from "./bulk-action-bar";
import { CalendarPanel } from "./calendar-panel";
// ...
```

**Type-only imports** use `import type` (see `dashboard-shell.tsx:6-17`).

### App Router Conventions

**Route segments:**
- `app/(protected)/dashboard/page.tsx` — route group `(protected)` for auth-gated pages (not in URL)
- `app/api/**/route.ts` — Route Handlers (Node.js runtime, `export const runtime = "nodejs"` on every one)
- `app/api/auth/[...nextauth]/route.ts` — catch-all for NextAuth

**Server-first:** root `app/page.tsx`, `signin/page.tsx`, and `(protected)/dashboard/page.tsx` are all `async` server components that call `await auth()` and `redirect()`. Only `dashboard-shell.tsx` and its subcomponents are `"use client"`.

**Server Actions** inlined in JSX via `async () => { "use server"; ... }` — see `signin/page.tsx:19-23`.

### Error Handling

**Route handler pattern** — every `POST`/`GET`/`DELETE` in `app/api/**/route.ts`:
```typescript
export async function POST(request: Request) {
  try {
    const sessionUser = await requireSessionUser();
    // ...
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

Observed in: `api/actions/route.ts:43-51`, `api/actions/bulk/route.ts:51-58`, `api/actions/history/route.ts:53-61`, `api/inactive/route.ts:33-42`.

**Unauthorized is a thrown Error** — `requireSessionUser()` throws `new Error("Unauthorized")` (`lib/auth/session.ts:10`) and catch blocks check `error.message === "Unauthorized"` to map to 401. Keep this contract.

**Environment validation eager-throws** — `lib/runtime/env.ts:1-7` uses a `required(name)` helper that throws immediately; consumers assume env vars are strings.

**Input validation:**
- Normalize with `String(body.x ?? "").trim()` before checking `!studentKey`.
- Return 400 with `{ error: "studentKey is required" }` for missing input.
- Return 404 with `{ error: "Student not found" }` when a studentKey doesn't match the payload.

### Cache / Data Patterns

Two-tier caching (`web/`):

**Tier 1 — `next/cache` `unstable_cache`** for the dashboard payload (`lib/dashboard/service.ts:10-17`):
```typescript
const getCachedPayload = unstable_cache(buildDashboardPayloadUncached, [DASHBOARD_CACHE_TAG], {
  revalidate: DASHBOARD_CACHE_REVALIDATE_SECONDS, // 60 seconds
  tags: [DASHBOARD_CACHE_TAG],                    // "dashboard-payload"
});
```
Invalidated via `revalidateTag(DASHBOARD_CACHE_TAG, "max")` after any write.

**Tier 2 — process-local `Map`** in `lib/cache/memory-cache.ts` with a 15 000 ms TTL (`SHEETS_IN_MEMORY_TTL_MS`), used to dedupe Sheets API calls inside a single request.

**Always invalidate after writes** — every mutating route handler calls `invalidateDashboardPayloadCache()` before returning (`api/actions/route.ts:41`, `api/actions/bulk/route.ts:49`, `api/inactive/route.ts:32,58`). Same-file helpers like `writeStudentActionState` also call `clearMemoryCache("sheets:action-state")` (`lib/sheets/actions.ts:142`).

**Sheet data access pattern:**
- Always go through `getSheetsClient()` in `lib/sheets/client.ts` — it memoizes the JWT auth.
- Multi-sheet loads use `spreadsheets.values.batchGet` (`lib/sheets/source-loader.ts:27-42`).
- Row reads sit behind `getOrSetMemoryCache("sheets:<name>", ...)` (`lib/sheets/actions.ts:159`, `lib/sheets/source-loader.ts:24`).

### Logging

**`web/` has zero `console.log`/`console.error`** calls outside `web/scripts/*`. Errors flow back as HTTP responses; health state lives in `lib/dashboard/health-state.ts` (in-memory counters).

**Apps Script uses `Logger.log`** for operational notes (`Code.gs:297`, `SharedHelpers.gs:104`, `Validation.gs:66`).

### Comments

**Sparse.** Comment where domain context is non-obvious, not what the code does.

**JSDoc-lite:** single-line `/** ... */` above non-trivial sheet helpers — see `lib/sheets/inactive-students.ts:22` and `api/inactive/route.ts:8`:
```typescript
/** Mark a student as inactive (no longer taking classes). */
export async function POST(request: Request) { ... }
```

**Section comments in large React components** (`// ---`) mark state vs data-loading vs effects — see `dashboard-shell.tsx:54-56`.

### React / Component Patterns

**Client-side persistence** uses `localStorage` with try/catch for quota:
```typescript
try { localStorage.setItem(STORAGE_KEY, next); } catch { /* quota */ }
```
Pattern in `hooks/use-theme.ts:24-27`, `hooks/use-resizable-split.ts:22-26`, `dashboard-shell.tsx:66`.

**`React.memo` + `forwardRef` + `useImperativeHandle`** for panels that need imperative scroll control — see `components/dashboard/queue-panel.tsx:19-90`.

**Optimistic state** tracked in a `Set<string>` (`DashboardShell` uses `optimisticKeys`), merged with server response on success.

**Keyboard shortcuts** live in `hooks/use-keyboard-shortcuts.ts` with an exported `SHORTCUT_LIST` constant for the help overlay.

## Validation Run Rules

From `CLAUDE.md:24-27` and `AGENTS.md:25-28` — these are mandatory before merging certain changes:

| When changing... | Run |
|------------------|-----|
| Balance logic or source-sheet rules | `clasp run runValidationSuite` |
| Student action-state persistence or same-day visibility | `clasp run runValidationSuite` |
| Async bootstrap / chunked transfer | Extend `Validation.gs` with warm-cache and cold-cache coverage — no manual-smoke-test-only changes |
| Live sheet parity or diagnostics | `clasp run runLiveAccuracyAudit` (requires Google Sheets authorization on the shared script) |
| `web/` shadow parity | `npm run compare-live` from `web/` (`web/scripts/compare-live.ts`) |

**Authorization failure on `SpreadsheetApp.openById`** is a documented handoff blocker, not a code failure (`CLAUDE.md:28`, `AGENTS.md:29`).

## Deployment Discipline

- `.clasp.json` and `appsscript.json` stay in sync with the shared Apps Script project (`CLAUDE.md:18`, `AGENTS.md:19`).
- Distinguish **source push** from **versioned deployment** — both get called out in PRs (`CLAUDE.md:22`, `AGENTS.md:23`).
- `HTTP -1` and chunk-transfer errors are deploy-state symptoms first, not source-state bugs (`CLAUDE.md:23`, `AGENTS.md:24`).
- Deployment impact recorded in every substantial PR or handoff, even when no deploy happens (`AGENTS.md:21`).

## PR / Review Standards

From `CLAUDE.md:36-40` and `AGENTS.md`:

- Small PRs with a clear issue link
- Validation evidence included, even when manual
- Docs updated in the same PR when the change affects setup, deployment, workflow, command-center behavior (queue filters, follow-up state, calendar, triage), or migration tooling
- Auth, env, service-account, and Vercel-linking blockers are first-class handoff items
- Handoff format lives in `docs/WORKFLOW.md`

---

*Convention analysis: 2026-04-20*
