# Architecture Research — Wisenet + Neon Migration

**Domain:** Internal ops dashboard — data-source migration from Google Sheets to Wisenet REST + Neon Postgres on Vercel
**Researched:** 2026-04-20
**Confidence:** HIGH for Next.js 16 cache primitives and Vercel Runtime Cache (verified against official docs pulled at time of research); MEDIUM for Wisenet shape (training-data, vendor API not crawled); MEDIUM for Neon + Drizzle specifics (WebSearch blocked — flagged for validation in the Phase 0 research task).

## Standard Architecture

### System Overview (target state, after this milestone)

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                       Vercel Fluid Compute                           │
  │  (Node.js runtime, same-region function reuse, graceful shutdown)    │
  ├─────────────────────────────────────────────────────────────────────┤
  │  Next.js 16 App Router                                               │
  │  ┌──────────────────┐   ┌──────────────────────────────────────┐    │
  │  │ (protected)/     │   │ api/actions/*   api/inactive/*       │    │
  │  │   dashboard/     │   │ api/health      api/auth/[...]       │    │
  │  │   page.tsx (RSC) │   │ (Route Handlers, runtime = "nodejs") │    │
  │  └────────┬─────────┘   └──────────┬───────────────────────────┘    │
  │           │                        │                                 │
  ├───────────┴────────────────────────┴─────────────────────────────────┤
  │  Domain / Facade layer (lib/dashboard/)                              │
  │  ┌──────────────────────────────────────────────────────────────┐    │
  │  │ service.ts — single entry point into the domain:             │    │
  │  │   getDashboardPayload(now)  → composes reads                 │    │
  │  │   setStudentAction(...)     → composes writes                │    │
  │  │   invalidateDashboardPayloadCache() → tag fan-out            │    │
  │  │ build.ts, analytics.ts, packages.ts, projection.ts,          │    │
  │  │ actions.ts, helpers.ts                — UNCHANGED business   │    │
  │  │                                         rules (parity lock)  │    │
  │  └──────────────┬─────────────────────────────────┬─────────────┘    │
  │                 │                                 │                  │
  ├─────────────────┴─────────────────┬───────────────┴──────────────────┤
  │  Wisenet client (read path)       │   Postgres client (write path)   │
  │  lib/wisenet/                     │   lib/db/                        │
  │  ┌──────────────────┐             │   ┌──────────────────┐           │
  │  │ client.ts        │             │   │ client.ts        │           │
  │  │  fetch wrapper,  │             │   │  Neon serverless │           │
  │  │  auth header,    │             │   │  driver, pooled  │           │
  │  │  timeout, retry  │             │   │                  │           │
  │  │ endpoints.ts     │             │   │ schema.ts (drizzle)          │
  │  │  typed resources │             │   │ queries.ts       │           │
  │  │ types.ts         │             │   │ migrations/      │           │
  │  │ mappers.ts       │             │   └──────────────────┘           │
  │  └──────────────────┘             │                                  │
  ├─────────────────┬─────────────────┴──────────────────┬──────────────┤
  │  Caching layers │                                    │              │
  │  ┌──────────────┴────────────┐  ┌──────────────────┐│              │
  │  │ React cache() — per req   │  │ 'use cache:remote'│              │
  │  │ dedup (same request)      │  │ Vercel Runtime    │              │
  │  │                           │  │ Cache (regional   │              │
  │  │ 'use cache' — in-memory   │  │ KV, tag-invalidate)              │
  │  │ LRU per instance (warm)   │  │                   │              │
  │  └───────────────────────────┘  └──────────────────┘              │
  └─────────────────────────────────────────────────────────────────────┘
            │                                    │
            ▼                                    ▼
  ┌──────────────────────┐            ┌──────────────────────┐
  │  Wisenet REST API    │            │  Neon Postgres       │
  │  (vendor, center     │            │  (Vercel Marketplace)│
  │   API key)           │            │                      │
  └──────────────────────┘            └──────────────────────┘
```

Three things to notice in the diagram:

1. **`lib/dashboard/service.ts` stays as a facade.** The business-rule layer (`analytics.ts`, `packages.ts`, `projection.ts`, `actions.ts`, `helpers.ts`) does NOT change its public shape — it still consumes a `DashboardSources` object and a student action map. Only the *providers* of those inputs swap from Sheets to Wisenet + Postgres. This is the single most important architectural decision for keeping the migration low-risk: the 45+ validation fixtures in `Validation.gs` and the Vitest port in `web/src/test/dashboard-logic.test.ts` remain directly applicable.
2. **Two client packages, two cache strategies.** Wisenet reads are tag-cached at the function-call level. Postgres reads are uncached for writes-and-immediate-reads flows (the same-day follow-up state has to be instantly visible to the operator after they click "Contacted").
3. **`memory-cache.ts` is retired.** It is replaced by Next.js 16's `'use cache'` primitive (in-process LRU with proper key hashing) for the Wisenet fetch wrapper, and `'use cache: remote'` (Vercel Runtime Cache) for the dashboard payload aggregate.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `lib/wisenet/client.ts` | Authenticated fetch, headers, timeouts, error shape | Native `fetch` wrapped with the API key from env; no SDK — Wisenet has no published TS client |
| `lib/wisenet/endpoints.ts` | Typed request functions per resource (students, packages, sessions, credits) | One async function per endpoint, returns `Promise<T>`, no caching inside (caching is a layer above) |
| `lib/wisenet/types.ts` | TS types mirroring Wisenet's JSON shape | Hand-authored from Postman docs + one-time `curl` to the real API, NOT from training-data guesses |
| `lib/wisenet/mappers.ts` | Map Wisenet response → internal `DashboardSources` shape that `build.ts` expects | Pure functions, tested with fixtures |
| `lib/db/client.ts` | Neon Postgres connection (pooled via `@neondatabase/serverless` Pool) | Single module-scoped `sql` / `db` export, reused across requests via Fluid Compute instance reuse |
| `lib/db/schema.ts` | Drizzle schema (tables: `follow_up_state`, `follow_up_log`, `inactive_students`, optionally `snapshot_history`) | Recommended over raw SQL: schema file doubles as generator for migrations and as TS types |
| `lib/db/queries.ts` | Query functions (read state map, upsert state, append log row, list inactive) | One function per query; each is a transaction boundary |
| `lib/dashboard/service.ts` | Facade: orchestrates Wisenet read + Postgres read + business-rule build; exposes invalidation | Becomes the ONLY thing that knows about both backends |
| `lib/dashboard/build.ts` | Unchanged pipeline: active filter → exclusions → ownership → pending deductions → projection → model | Keeps consuming the same `DashboardSources` + `ActionStateMap` shapes |
| `lib/dashboard/action-state.ts` (NEW) | Action-state domain boundary — replaces the sheet-row sanitization logic in `lib/dashboard/actions.ts` + the sheet writer in `lib/sheets/actions.ts` | Reads/writes via `lib/db/queries.ts`; same-day visibility gate stays here |

## Recommended Project Structure

```
web/src/
├── lib/
│   ├── wisenet/                    # NEW — replaces lib/sheets/ for reads
│   │   ├── client.ts               # fetch wrapper, auth, retry, error mapping
│   │   ├── endpoints.ts            # one function per Wisenet resource
│   │   ├── mappers.ts              # Wisenet JSON → DashboardSources shape
│   │   ├── types.ts                # TS types for Wisenet responses
│   │   └── fixtures/               # recorded real responses for tests
│   │       └── *.json
│   ├── db/                         # NEW — replaces sheet-based action state
│   │   ├── client.ts               # Neon pool + drizzle instance
│   │   ├── schema.ts               # drizzle-orm schema definitions
│   │   ├── queries.ts              # typed query functions
│   │   └── migrations/             # drizzle-kit generated SQL
│   │       └── 0000_*.sql
│   ├── dashboard/                  # EXISTING — minimal surface change
│   │   ├── config.ts               # UNCHANGED business constants
│   │   ├── domain.ts               # UNCHANGED internal types
│   │   ├── helpers.ts              # UNCHANGED
│   │   ├── projection.ts           # UNCHANGED
│   │   ├── packages.ts             # UNCHANGED
│   │   ├── analytics.ts            # UNCHANGED
│   │   ├── action-state.ts         # REPLACES actions.ts behaviour; same contract
│   │   ├── build.ts                # UPDATED to take sources from Wisenet path
│   │   ├── service.ts              # UPDATED to compose Wisenet + Postgres
│   │   ├── snapshot-store.ts       # RETIRED (move to Postgres table or drop)
│   │   └── health-state.ts         # EITHER retire or move to Postgres
│   ├── sheets/                     # DELETED on cutover
│   └── cache/
│       └── memory-cache.ts         # DELETED — replaced by 'use cache'
├── app/
│   ├── (protected)/dashboard/      # UNCHANGED page.tsx
│   ├── api/
│   │   ├── dashboard/route.ts      # UNCHANGED handler; same JSON shape
│   │   ├── actions/                # UPDATED — writes to Postgres instead of Sheets
│   │   ├── inactive/route.ts       # UPDATED — writes to Postgres
│   │   ├── health/route.ts         # UPDATED — probes Wisenet + Postgres
│   │   └── auth/[...nextauth]/     # UNCHANGED
│   └── ...
├── types/
│   └── dashboard.ts                # UNCHANGED public payload contract
└── test/
    ├── dashboard-logic.test.ts     # UNCHANGED — works against fixture sources
    ├── actions-route.test.ts       # UPDATED to mock Postgres not Sheets
    ├── wisenet-mappers.test.ts     # NEW — recorded-fixture tests
    └── db-queries.test.ts          # NEW — uses drizzle test DB or pg-mem
```

### Structure Rationale

- **`lib/wisenet/` mirrors the shape of the retired `lib/sheets/`.** It owns external I/O only. The old mistake to avoid: leaking Sheets-specific column layouts into `lib/dashboard/*`. Same discipline for Wisenet — keep its field names inside `mappers.ts` and return the already-normalized `DashboardSources` shape.
- **`lib/db/` is new and small.** Three files: `client.ts`, `schema.ts`, `queries.ts`. Resist the urge to add a `repositories/` abstraction layer — this is one app, not a microservice grid. Drizzle's query builder already gives you typed queries and migration generation; layering a repo pattern on top is pure ceremony.
- **`lib/dashboard/service.ts` becomes the only place that composes both backends.** Route handlers and pages call into `service.ts`. `build.ts` receives already-composed inputs. This preserves the current "business logic is a pure function of sources + action state" shape.
- **`action-state.ts` replaces the two-file split (`lib/dashboard/actions.ts` + `lib/sheets/actions.ts`).** One file, one responsibility: "here is how the app thinks about follow-up state." The DB I/O lives in `lib/db/queries.ts`; this file owns the sanitization + same-day visibility gate that currently sits in `lib/dashboard/actions.ts`.

## Architectural Patterns

### Pattern 1: Facade over pluggable sources

**What:** `lib/dashboard/service.ts` remains the public entry point for the domain. Internally it calls `lib/wisenet/endpoints.ts` for source data, `lib/db/queries.ts` for action state, and hands both to `build.ts`. Route handlers never import either backend directly.

**When to use:** When you are swapping data providers but keeping business rules. This milestone is exactly that situation.

**Trade-offs:**
- Pro: 45+ existing fixture tests keep working; the build pipeline is a pure function of its inputs.
- Pro: Enables per-data-type cutover (see Pattern 4) without leaking to callers.
- Con: One extra function hop. Negligible at this scale.

**Example:**
```typescript
// lib/dashboard/service.ts
import { cacheTag, cacheLife } from 'next/cache';
import { loadWisenetSources } from '@/lib/wisenet/endpoints';
import { loadActionStateMap } from '@/lib/db/queries';
import { buildDashboardPayloadUncached } from './build';

export async function getDashboardPayload(now = new Date()) {
  'use cache: remote';
  cacheTag('dashboard-payload');
  cacheLife({ revalidate: 60, expire: 300 });

  const [sources, actionStateMap] = await Promise.all([
    loadWisenetSources(),          // cached independently, tag: 'wisenet-sources'
    loadActionStateMap(todayKey(now)),
  ]);

  return buildDashboardPayloadUncached(sources, actionStateMap, now);
}
```

### Pattern 2: Three-layer cache topology

**What:** Read performance on Wisenet relies on three stacked caches, each solving a different problem:

1. **React `cache()` — request-level dedup.** Inside a single Next.js request, if two RSCs both call `getStudentById(123)`, the second returns the promise from the first. Free in Next.js, no invalidation needed.
2. **`'use cache'` — in-memory LRU per Fluid Compute instance.** Warm-function cache. Survives across requests to the *same* instance. Regenerated on cold-start. Keyed by a hash of the function identity + args. Revalidates on time OR on `updateTag` call.
3. **`'use cache: remote'` — Vercel Runtime Cache.** Regional KV-style store. Survives across instances and deployments. Invalidated by `updateTag` / `revalidateTag` / `expireTag`. 2 MB per entry max, 64 tags per item max, 256 B per tag.

**When to use each:**
| Layer | Use for | Example in this app |
|-------|---------|---------------------|
| `cache()` | Idempotent reads called from multiple RSCs in one request | `getStudentById(id)` called from queue + detail panel |
| `'use cache'` | Warm-instance speedup; tolerable to rebuild after cold-start | Wisenet sub-endpoint fetches (students list, packages list) |
| `'use cache: remote'` | Cross-instance, cross-region state; regenerating from Wisenet is slow or rate-limited | The full composed dashboard payload (the `getDashboardPayload` facade above) |

**Trade-offs:**
- Pro: `'use cache: remote'` Vercel Runtime Cache absorbs most traffic without hitting Wisenet at all.
- Pro: `'use cache'` is free (no network round-trip), great for per-instance warmth.
- Con: Remote cache costs money per read/write (see Vercel pricing). Don't cache things that are cheap to recompute.
- Con: `use cache` requires `cacheComponents: true` flag, which is an opt-in for the whole app.

**Example:**
```typescript
// lib/wisenet/endpoints.ts
import { cacheTag, cacheLife } from 'next/cache';
import { cache } from 'react';
import { wisenetFetch } from './client';

// Request-level dedup. If called 5× in one RSC render, only one HTTP call.
export const getStudentById = cache(async (id: string) => {
  'use cache';                                      // warm-instance cache
  cacheTag(`wisenet:student:${id}`);
  cacheLife({ revalidate: 300, expire: 600 });      // 5m soft, 10m hard
  return wisenetFetch<Student>(`/students/${id}`);
});

export async function listAllStudents() {
  'use cache: remote';                              // Vercel Runtime Cache
  cacheTag('wisenet:students:all');
  cacheLife({ revalidate: 60, expire: 300 });       // 1m soft, 5m hard
  return wisenetFetch<Student[]>('/students');
}
```

### Pattern 3: Write-through invalidation via tag fan-out

**What:** Every Postgres write goes through `service.ts`-exposed mutations that call the right `updateTag` calls for both layers. You never invalidate from inside a route handler.

**When to use:** When the dashboard payload is a function of both Wisenet (rarely changes) and Postgres (operator writes change it in real time).

**Invalidation triggers:**
- **Operator clicks "Contacted" on a student** → `service.setStudentAction(...)` writes to Postgres, then calls `updateTag('dashboard-payload')`. Next dashboard read repopulates from Wisenet + fresh Postgres state.
- **Operator bulk-actions 20 students** → single transaction in Postgres, single `updateTag('dashboard-payload')`.
- **Operator marks inactive** → same pattern; also `updateTag('dashboard-inactive')` if we give inactive-students its own tag.
- **Time-based (Wisenet drift)** → `cacheLife({ revalidate: 60 })` on `getDashboardPayload` makes stale-while-revalidate automatic.
- **Manual admin "refresh from source"** → a `POST /api/admin/refresh` route calls `revalidateTag('wisenet:students:all')` + `updateTag('dashboard-payload')`.

**Trade-offs:**
- Pro: Writes complete in O(1) tag-invalidations, no scanning.
- Pro: `updateTag` (new in Next 16) invalidates downstream AND bumps the serving copy so the next reader rebuilds — no thundering herd of stale responses.
- Con: Forgetting to tag a cache function means invalidation silently fails. Convention: every `'use cache'` block must call `cacheTag` with at least one tag.

**Example:**
```typescript
// lib/dashboard/service.ts
import { updateTag } from 'next/cache';

export async function setStudentAction(input: {
  studentKey: string;
  status: StudentActionStatus;
  actorEmail: string;
  actorName: string;
}) {
  await db.transaction(async (tx) => {
    await upsertFollowUpState(tx, input);
    await appendFollowUpLog(tx, { ...input, eventId: crypto.randomUUID() });
  });
  // Fan out: the composed payload tag + the per-student tag if we had one
  updateTag('dashboard-payload');
}
```

### Pattern 4: Per-data-type cutover via module swap (NOT feature flags)

**What:** Since the milestone explicitly drops "parallel shadow-compare" (PROJECT.md line 44), you don't need runtime-togglable flags. You do need a safe cutover *mechanic* so you can land the Wisenet integration, the Postgres integration, and the route-handler rewires as separate PRs — each shippable without breaking the live app.

**Recommended mechanic:**
1. Add the new modules (`lib/wisenet/*`, `lib/db/*`) alongside the old (`lib/sheets/*`) without deleting anything. Both compile; `service.ts` still imports from the old path.
2. In one PR per data type, swap the imports in `service.ts` (or in `build.ts`) to point at the new modules. Verify with fixture tests + a manual operator smoke-test, then merge.
3. When all reads come from Wisenet and all writes go to Postgres, delete `lib/sheets/`, `lib/cache/memory-cache.ts`, `lib/dashboard/snapshot-store.ts` in a final PR.

**Why not feature flags:**
- This is an internal ops tool with ~6 admin users. A/B testing buys nothing.
- Feature flags introduce a combinatorial matrix (sheets-read × sheets-write, wisenet-read × sheets-write, etc.) that all need testing.
- The only flag you need is `NODE_ENV !== 'production'`, which branches you for Vercel Preview env vars vs Production env vars (see Pattern 6).

**Trade-offs:**
- Pro: Linear, reviewable PRs. Each one either compiles-and-passes-tests or doesn't.
- Pro: `git revert` is a valid rollback for any single step.
- Con: During the transition the old and new modules coexist. Root-cause CI with fixture tests must stay green on every PR.

### Pattern 5: Auth pass-through — app session != API credentials

**What:** There are three auth boundaries in this stack and they do NOT share credentials:

| Boundary | Auth mechanism | Scope |
|----------|---------------|-------|
| Browser → Next.js | NextAuth v5 Google OIDC; session cookie; `STAFF_ALLOWLIST` gate | Per user |
| Next.js → Wisenet | Server-only env var `WISENET_API_KEY` + center ID; no per-user creds | Whole center (one API key shared across all admin sessions) |
| Next.js → Neon Postgres | `DATABASE_URL` with embedded creds; `@neondatabase/serverless` Pool | Whole app |

**Key architecture rules:**
- Session info (`email`, `name`) travels INTO the Postgres layer as `actor_email` / `actor_name` audit columns — so follow-up log rows record who made each change.
- Session info does NOT leave the server. Neither Wisenet nor Postgres ever sees a user token.
- `requireSessionUser()` is called at the top of every mutating route handler and passes the actor info down to `service.setStudentAction({..., actorEmail, actorName})`.
- Wisenet API key is read via `process.env.WISENET_API_KEY` (behind a `getWisenetEnv()` validator in `lib/runtime/env.ts`, matching the existing `getAuthEnv()` / `getSheetsEnv()` split).
- Never put the Wisenet key in a Next.js client component; never reference it from a module that could land in a client bundle (Next.js enforces via `'use server'` and the server/client boundary, but pinning `runtime = 'nodejs'` on route handlers is the belt-and-braces).

**Example:**
```typescript
// lib/runtime/env.ts  (extension of existing pattern)
export function getWisenetEnv() {
  return {
    apiKey: required('WISENET_API_KEY'),
    userId: required('WISENET_USER_ID'),
    centerId: required('WISENET_CENTER_ID'),
    baseUrl: process.env.WISENET_BASE_URL
      ?? 'https://<wisenet-default-host>',          // confirm during Phase 0 research
  };
}

export function getDatabaseEnv() {
  return {
    url: required('DATABASE_URL'),
    // Neon auto-provisions DATABASE_URL on Vercel Marketplace integration.
  };
}
```

### Pattern 6: Environment-based preview isolation (the one "flag" you do need)

**What:** Vercel gives you three env-var scopes: Development, Preview, Production. Use this to let developers iterate against a non-production Wisenet/Neon pair while production keeps hitting the real one.

**Recommended setup:**
- **Production Vercel env:** real `WISENET_API_KEY` (center `begifted-education`), Neon production branch `DATABASE_URL`.
- **Preview Vercel env:** real Wisenet API (read-only ops; Wisenet has no sandbox per training-data; flag as MEDIUM confidence — Phase 0 should confirm), Neon *preview branch* `DATABASE_URL` so schema migrations can be tested without corrupting prod data.
- **Local dev:** `web/.env.local` with either a Neon dev branch or a local Postgres container; Wisenet same real API.

Neon's Vercel integration creates a database branch per Vercel preview deployment automatically — this is the specific feature that makes preview-env isolation cheap.

## Data Flow

### Request Flow (read — `GET /api/dashboard`)

```
[Operator opens /dashboard]
    ↓
[NextAuth middleware — session check]
    ↓
[/dashboard/page.tsx (RSC) — requireSessionUser()]
    ↓
[Client-side DashboardShell fetches GET /api/dashboard]
    ↓
[/api/dashboard/route.ts — auth() guard, then service.getDashboardPayload()]
    ↓
[service.ts — Vercel Runtime Cache check (tag: dashboard-payload)]
    ↓ MISS
[service.ts — Promise.all: Wisenet sources + Postgres action-state]
    ↓           ↓
    ↓      [lib/db/queries.ts — loadActionStateMap(today) — UNCACHED]
    ↓           ↓
    ↓      [@neondatabase/serverless Pool — 5–15ms same-region query]
    ↓
[lib/wisenet/endpoints.ts — multiple endpoint calls in parallel]
    ↓  (each: React cache + 'use cache' LRU + optionally 'use cache: remote')
[Wisenet REST API — center API key — 100–400ms typical]
    ↓
[lib/wisenet/mappers.ts — normalize to DashboardSources shape]
    ↓
[lib/dashboard/build.ts — UNCHANGED pipeline]
    ↓
[service.ts stores payload in Vercel Runtime Cache, tag dashboard-payload]
    ↓
[JSON response to client]
```

### Request Flow (write — `POST /api/actions`)

```
[Operator clicks "Contacted"]
    ↓
[Client DashboardShell — POST /api/actions { studentKey, status }]
    ↓
[/api/actions/route.ts — requireSessionUser() → { email, name }]
    ↓
[service.setStudentAction({ studentKey, status, actorEmail, actorName })]
    ↓
[lib/db/queries.ts — Drizzle transaction: upsert follow_up_state + append follow_up_log]
    ↓
[Neon Postgres — committed]
    ↓
[service.ts — updateTag('dashboard-payload')]
    ↓                ↓
    ↓     [Vercel Runtime Cache invalidated; next read rebuilds]
    ↓
[JSON response { ok: true, state } → client optimistically updates, then refetches dashboard]
```

### Key Data Flows

1. **Dashboard load (cold):** Wisenet read (4–8 parallel endpoint calls) + Postgres read (1 query) → business rule pipeline → Runtime Cache store → JSON. ~600–1500ms total end-to-end. The Runtime Cache entry then serves subsequent requests in any region at ~10ms.
2. **Dashboard load (warm):** Runtime Cache hit → JSON. ~20–50ms.
3. **Single action write:** Postgres transaction (20–60ms) → `updateTag` → response. ~80–120ms end-to-end.
4. **Bulk action write (50 students):** Single Postgres transaction with batched inserts (50–150ms regardless of count, because Neon + Drizzle can do one round-trip with `INSERT ... VALUES (...), (...), ...`) → `updateTag` → response. Replaces the current per-student sequential Sheets loop that is flagged MEDIUM-severity fragile in CONCERNS.md.
5. **Cache invalidation propagation:** `updateTag('dashboard-payload')` on any write → next `getDashboardPayload()` call across all regions rebuilds from Wisenet + Postgres. No polling.

## Postgres Schema Sketch (follow-up state)

Given the existing `DashboardActionsState` + `DashboardActionLog` sheet pair and the same-day visibility gate, the natural Postgres shape is:

```sql
-- Current state: one row per student_key (the dedup / upsert target)
CREATE TABLE follow_up_state (
  student_key        TEXT PRIMARY KEY,         -- <normalized-name>::<normalized-parent>
  student_name       TEXT NOT NULL,
  parent_name        TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('contacted','pending-callback','resolved')),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_email   TEXT NOT NULL,
  updated_by_name   TEXT NOT NULL
);
CREATE INDEX follow_up_state_updated_at_idx ON follow_up_state (updated_at DESC);

-- Append-only audit log — drives both history UI AND future reporting
CREATE TABLE follow_up_log (
  event_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_key        TEXT NOT NULL,
  student_name       TEXT NOT NULL,
  parent_name        TEXT NOT NULL,
  action_type        TEXT NOT NULL CHECK (action_type IN ('set','clear','bulk-set','bulk-clear')),
  status             TEXT,                     -- NULL when clearing
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_email        TEXT NOT NULL,
  actor_name         TEXT NOT NULL
);
CREATE INDEX follow_up_log_student_key_created_at_idx
  ON follow_up_log (student_key, created_at DESC);
CREATE INDEX follow_up_log_created_at_idx ON follow_up_log (created_at DESC);

-- Inactive-student soft-delete + auto-reactivation state
CREATE TABLE inactive_students (
  student_key        TEXT PRIMARY KEY,
  student_name       TEXT NOT NULL,
  parent_name        TEXT NOT NULL,
  marked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  marked_by_email    TEXT NOT NULL
);

-- OPTIONAL: snapshot history for summary deltas (currently broken in snapshot-store.ts)
CREATE TABLE snapshot_history (
  id                 BIGSERIAL PRIMARY KEY,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary_payload    JSONB NOT NULL           -- the full summary object, not individual columns
);
CREATE INDEX snapshot_history_captured_at_idx ON snapshot_history (captured_at DESC);
```

**Why this shape:**
- **`follow_up_state` is student-keyed, not action-keyed.** Matches how the dashboard thinks (one triage decision per student per day). Upsert is a single SQL statement: `INSERT ... ON CONFLICT (student_key) DO UPDATE SET ...`.
- **`follow_up_log` is append-only.** Matches the existing `DashboardActionLog` sheet's append-only semantics. Enables the 7-day history endpoint without touching the state table. Future reporting (weekly callback counts, operator volume) joins here.
- **Same-day visibility** stays in the domain layer (`lib/dashboard/action-state.ts::sanitizeActionStateMap()` reads `updated_at::date = today()`). Do NOT push this into the SQL WHERE clause — it's business policy, not data shape, and needs to match the `now()` the builder uses.
- **`snapshot_history` replaces `snapshot-store.ts`.** Fixes the MEDIUM-severity serverless-ephemeral concern in CONCERNS.md. Summary deltas now survive cold-starts because the "previous" row lives in Postgres.
- **No `created_at` on `follow_up_state`** (only `updated_at`). You never query for "when was this state first set?" — that's what the log is for.
- **Student name/parent name denormalized** into both tables. Wisenet is the source of truth for names but the log must survive name changes in Wisenet — an audit row from 6 months ago should render with the name that was current at write time.

**What NOT to do:**
- Don't add a `student_id` foreign key to an imaginary `students` table. Wisenet owns student records; mirroring them into Postgres creates a dual-sync problem. `student_key` (the existing `<name>::<parent>` composite) stays the contract.
- Don't try to import historical rows from the action sheets (PROJECT.md: explicitly out of scope).
- Don't add RLS policies yet. The app uses a single DB user; auth is at the Next.js layer.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 6 admins, ~500 students (today) | Single Neon DB (production branch), default Fluid Compute settings, default Runtime Cache limits. No tuning needed. |
| 20 admins, ~3K students | Add pgBouncer-style connection pooling via Neon pooled connection string (Neon provides `?sslmode=require&pgbouncer=true` out of the box). Add read replicas if reports emerge. |
| 100+ admins, 10K+ students | Introduce per-student Runtime Cache tags (`student:<key>`) so writes invalidate one student's view rather than the whole payload. Split dashboard payload into page-level cached slices. Consider Vercel Queues for async log writes. |

### Scaling Priorities

1. **First bottleneck: Wisenet rate limits.** Wisenet rate-limit shape is unknown (flag for Phase 0 confirmation — LOW confidence without direct API inspection). Mitigation is already built-in via Runtime Cache + `cacheLife`; worst case add a client-side token bucket.
2. **Second bottleneck: Postgres write latency on bulk actions.** If operators feel a 50-student bulk click is sluggish, batch inserts into one `INSERT ... VALUES (...), ...` statement. Drizzle `db.insert(table).values([...])` does this already.
3. **Third bottleneck (unlikely at this scale): cold-start.** Fluid Compute dramatically reduces cold-starts via instance reuse, but first-ever boot is still ~400ms. Mitigation is `'use cache: remote'` absorbing the expensive compose step so a cold instance just reads a cached JSON blob.

## Anti-Patterns

### Anti-Pattern 1: Dual writes to both Sheets and Postgres during transition

**What people do:** During cutover, write every action to BOTH the old Sheets tabs AND the new Postgres tables "to be safe".
**Why it's wrong:** You double the write latency, double the failure modes (now a write can partially fail in N ways), and you have no atomic rollback. Worse, you end up with drift between the two stores that you then have to reconcile.
**Do this instead:** Cut over writes in ONE PR. Old Sheets tabs become read-only archives per PROJECT.md ("start fresh"). If you ever need historical data, export Sheets to CSV once, don't live-sync.

### Anti-Pattern 2: Calling Wisenet from client components

**What people do:** Stuff the Wisenet API key into `NEXT_PUBLIC_WISENET_KEY` or fetch from a client-side effect.
**Why it's wrong:** API key is exposed to every browser that loads the app. `NEXT_PUBLIC_*` env vars are embedded in the client bundle.
**Do this instead:** Route ALL Wisenet calls through Next.js server components / route handlers. Never reference `WISENET_API_KEY` outside a file that imports from `'server-only'` or lives in `app/api/*`.

### Anti-Pattern 3: Caching per-user data in the Runtime Cache

**What people do:** `'use cache: remote'` on a function that returns data filtered by the logged-in user.
**Why it's wrong:** Runtime Cache is shared across users in the same region. User A's data leaks into User B's cache entry.
**Do this instead:** For THIS app, the dashboard payload is not per-user (all admins see the same queue). Safe to cache. IF that ever changes, use `'use cache: private'` (Next.js 16 has this variant for per-user runtime caches) or pass the user ID as an explicit argument so it becomes part of the cache key.

### Anti-Pattern 4: Bypassing `service.ts` for "small" changes

**What people do:** A route handler directly imports from `lib/wisenet/endpoints.ts` and `lib/db/queries.ts` because "it's just one read."
**Why it's wrong:** The invalidation fan-out lives in `service.ts`. If a write bypasses it, cache is stale and operators see ghost state.
**Do this instead:** Add a method to `service.ts` even for one-liner reads. Cost: 3 lines. Benefit: invariant preserved.

### Anti-Pattern 5: Keeping `memory-cache.ts` "just in case"

**What people do:** Migrate everything to `'use cache'` but leave `lib/cache/memory-cache.ts` around for unspecified future need.
**Why it's wrong:** It's the exact file flagged in CONCERNS.md for cold-start correctness issues. Two cache mechanisms cause double-invalidation logic.
**Do this instead:** Delete `memory-cache.ts` in the same PR that cuts over the last consumer. `'use cache'` has strictly better semantics (proper key hashing, LRU eviction, dev/prod parity).

### Anti-Pattern 6: Running migrations at app startup

**What people do:** Call `drizzle-kit push` from a `postbuild` script or from a Next.js `instrumentation.ts` hook.
**Why it's wrong:** Fluid Compute instances can start at any time; N of them will race to apply migrations. Also ties app-readiness to schema work.
**Do this instead:** Migrations run via a separate `npm run db:migrate` command, invoked (a) manually before deploy, or (b) as a Vercel pre-deploy hook. Neon's Vercel integration supports this cleanly.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Wisenet REST API | Server-only `fetch` wrapper; auth via `X-API-KEY` header (confirm header name in Phase 0); center ID + user ID as query or header params per Wisenet convention | Unknown: rate limits, pagination style, error shape, cursor or offset-based. Phase 0 must document these. |
| Neon Postgres (via Vercel Marketplace) | `@neondatabase/serverless` driver, Pool mode, pooled connection string from `DATABASE_URL`. Drizzle ORM on top for typed queries + migrations. | Neon's Vercel integration auto-provisions `DATABASE_URL` per environment (dev/preview/prod). Preview deployments get their own DB branch automatically. |
| Vercel Runtime Cache | `'use cache: remote'` + `cacheTag` + `cacheLife` + `updateTag`/`revalidateTag`. No manual SDK needed in Next.js path. | Requires `cacheComponents: true` in `next.config.ts`. Entry-level limits: 2 MB, 64 tags, 256 B per tag. |
| NextAuth v5 (existing) | Google OAuth provider, allowlist in `signIn` callback, `requireSessionUser()` guard | Unchanged. Still on pre-release beta.30 (CONCERNS.md flag). |
| Google Sheets API | — | DELETED on cutover per PROJECT.md. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Route handler ↔ `service.ts` | Direct async function call | Route handlers do auth + HTTP shape; `service.ts` owns domain orchestration. |
| `service.ts` ↔ `build.ts` | Direct call; build is a pure function of sources + action-state | No change from today. Preserves fixture test compatibility. |
| `service.ts` ↔ `lib/wisenet/*` | Direct call; Wisenet client exposes typed async functions | New boundary. Mappers turn Wisenet JSON into existing `DashboardSources` shape. |
| `service.ts` ↔ `lib/db/*` | Direct call; Drizzle-typed query functions | New boundary. |
| `lib/db/client.ts` ↔ Neon | `@neondatabase/serverless` `Pool` instance, module-scoped, one per Fluid Compute instance | Fluid Compute's instance reuse makes the connection pool a cold-start optimization, not a liability. |

## Build Order Implications (what has to exist before what)

This is the explicit phase-structure input for the roadmap. Listed as directed acyclic dependencies:

```
Phase 0: Wisenet field discovery + env setup
  ├─ Discover every field the current dashboard consumes (map against lib/dashboard/config.ts REQUIRED_COLUMNS + DashboardSources shape in domain.ts)
  ├─ For each field, document the Wisenet endpoint + field name that supplies it
  ├─ Identify gaps (fields with no Wisenet equivalent) and decide: derive client-side, drop, or block
  ├─ Confirm Wisenet auth shape, rate limits, pagination semantics by hitting the real API with curl
  └─ Wire .env.example entries for WISENET_*; wire Vercel Preview + Production env vars
       │
       ▼
Phase 1: Wisenet client package
  ├─ lib/wisenet/client.ts  (fetch wrapper, auth, timeout, error mapping)
  ├─ lib/wisenet/types.ts   (TS types from real responses, NOT guessed from training data)
  ├─ lib/wisenet/endpoints.ts (one function per resource; no caching yet)
  ├─ lib/wisenet/mappers.ts (Wisenet JSON → DashboardSources)
  ├─ test/wisenet-mappers.test.ts (recorded-fixture tests; the replacement parity gate)
  └─ Does NOT touch service.ts yet — old Sheets path still live
       │
       ▼
Phase 2: Neon + schema + action-state write path
  ├─ Install @neondatabase/serverless, drizzle-orm, drizzle-kit
  ├─ lib/db/schema.ts (tables above)
  ├─ lib/db/client.ts  (pool instance)
  ├─ lib/db/queries.ts (loadActionStateMap, upsertFollowUpState, appendFollowUpLog, listInactive, markInactive, clearInactive, readHistory)
  ├─ drizzle-kit migrate 0000 (via npm run db:migrate)
  ├─ test/db-queries.test.ts (against a Neon dev branch or pg-mem)
  └─ Still does NOT touch live service.ts
       │
       ▼
Phase 3: Service.ts cutover — reads from Wisenet, writes to Postgres
  ├─ Enable cacheComponents: true in next.config.ts
  ├─ Rewrite service.ts::getDashboardPayload to compose Wisenet + Postgres (Pattern 1 above)
  ├─ Rewrite service.ts::setStudentAction / clearStudentAction / bulk* to write Postgres + updateTag
  ├─ Rewrite inactive-student paths same way
  ├─ Update route handlers to call new service.ts methods (API shape unchanged to clients)
  ├─ Delete lib/sheets/, lib/cache/memory-cache.ts, lib/dashboard/snapshot-store.ts, lib/dashboard/actions.ts
  └─ Smoke-test; operator sign-off
       │
       ▼
Phase 4: Cleanup — Apps Script retirement + docs
  ├─ Decommission clasp deployment
  ├─ Archive .gs files
  ├─ Update README, docs/*
  └─ Remove googleapis dep from package.json
```

**The strict serial part:** Phase 0 → Phase 1 must be serial (can't build the client without the discovery). Phase 2 is parallelizable with Phase 1 if a second agent picks it up. Phase 3 depends on both. Phase 4 is pure cleanup.

**The validation gate between phases:** Phase 1 end-of-phase test must show that for a fixture `DashboardSources` produced by `lib/wisenet/mappers.ts` on a real Wisenet response, `buildDashboardPayloadUncached(fixture, actionMap, now)` still passes all 45+ existing Vitest cases. This is the de-facto parity gate that replaces the blocked `compare-live`.

## Sources

- Next.js 16.2.4 official docs: https://nextjs.org/docs/app/api-reference/directives/use-cache — pulled 2026-04-20 (authoritative; HIGH confidence on `use cache` / `cacheLife` / `cacheTag` / `updateTag` behaviour and the Cache Components opt-in)
- Vercel Runtime Cache official docs: https://vercel.com/docs/caching/runtime-cache — pulled 2026-04-20 (authoritative; HIGH confidence on regional scope, 2 MB / 64 tags / 256 B limits, `'use cache: remote'` as the Next.js 16 integration, LRU eviction)
- Vercel session-start knowledge bulletin (2026-02-27): Fluid Compute as default, Node.js 24 LTS, `@neondatabase/serverless` path, no Vercel KV (use Marketplace Neon/Redis instead) — HIGH confidence (orchestrator-injected)
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/INTEGRATIONS.md`, `.planning/codebase/STRUCTURE.md`, `.planning/PROJECT.md` — repo-local; MEDIUM-HIGH confidence for current-state facts, used as constraint sources
- Drizzle + Neon integration pattern, follow-up state schema, Wisenet REST semantics — training-data-only; MEDIUM-LOW confidence. Flagged for Phase 0 validation.

## Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Next.js 16 cache topology (`use cache` layers, tag fan-out) | HIGH | Verified against nextjs.org docs pulled this session |
| Vercel Runtime Cache semantics (regional, tag-invalidated, limits) | HIGH | Verified against vercel.com docs pulled this session |
| Fluid Compute instance-reuse implications for connection pooling | HIGH | Confirmed by session-start Vercel knowledge bulletin |
| Facade-over-pluggable-sources pattern for this migration | HIGH | Derived directly from current repo architecture; preserves fixture-test compatibility |
| Postgres schema for follow-up state | HIGH | Mirrors existing sheet-tab columns, which ARE the operational contract today |
| Neon + Drizzle specific API (e.g., serverless Pool config) | MEDIUM | WebSearch was blocked; training-data recall is strong here but not verified this session — should be confirmed with `drizzle-orm` + Neon docs in Phase 2 |
| Wisenet API shape (endpoints, auth header, pagination, rate limits) | LOW | Vendor API, not in training data, not crawled. PROJECT.md explicitly calls this out as the Phase 1 discovery task. |
| Cutover mechanic (module-swap PRs, no feature flags) | HIGH | Derived from PROJECT.md constraints (6 users, "just cut over", no parallel compare) |

## Open Questions for Phase 0

1. **Wisenet API base URL and auth header shape** — Postman docs exist per PROJECT.md but haven't been read. Needed before client.ts can be written.
2. **Wisenet pagination pattern** (offset, cursor, or page tokens) — determines whether `listAllStudents` is a single call or a loop.
3. **Wisenet rate limits** — determines whether `cacheLife.revalidate` should be 60s, 300s, or 600s, and whether to add client-side token bucketing.
4. **Wisenet field coverage gaps** — PROJECT.md active requirement: every current dashboard field must map to a Wisenet endpoint, gaps explicitly documented. Any gap becomes a Phase 3 UI decision (derive, drop, or block cutover).
5. **Neon integration path** — Vercel Marketplace install vs manual `vercel env add DATABASE_URL`. Affects env-var provisioning flow for preview branches.
6. **Whether `health-state.ts` gets a Postgres table or is retired** — currently cold-start-fragile (CONCERNS.md MEDIUM severity). Design choice: persist to `snapshot_history` JSONB, or accept the limitation and document.

---

*Architecture research for: Wisenet + Neon migration of BeGifted Ops dashboard*
*Researched: 2026-04-20*
