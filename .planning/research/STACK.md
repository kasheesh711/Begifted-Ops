# Stack Research — Wisenet Migration Milestone

**Domain:** Next.js 16 App Router on Vercel (Fluid Compute), REST API integration (Wisenet) + owned Postgres state (Neon), replacing a Google Sheets data layer
**Researched:** 2026-04-20
**Confidence:** HIGH for Vercel/Next/Neon patterns (fetched from vercel.com/docs live); MEDIUM for ORM/library exact versions (can't hit npm.org — versions pinned defensively); **LOW for Wisenet auth scheme** (their Postman docs are a client-rendered SPA; WebFetch returns no body; see "Open research gaps")

> **Scope note** — This is an incremental milestone on an existing Next.js 16.2.1 / React 19.2.4 / next-auth 5.0.0-beta.30 / Vitest 3.2 codebase. We are ADDING a REST client, a Postgres store, a migration tool, and a caching strategy; and REMOVING `googleapis` 171.4.0 + `web/src/lib/sheets/*` + `web/src/lib/cache/memory-cache.ts`. Framework-level choices (Next, React, TypeScript, NextAuth, Vitest) are already made and NOT re-litigated here.

---

## Recommended Stack

### Core Additions

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@neondatabase/serverless` | `^1.0.0` (latest 1.x as of 2026-04) | Postgres driver for follow-up state | Vercel-native choice for Neon on the Marketplace. HTTP mode (`neon()`) works in any runtime and adds zero connection overhead per invocation, which matches Fluid Compute's reuse model. WebSocket mode (`Pool`/`Client`) is available when you need multi-statement transactions. See ["Driver mode" below](#driver-mode-http-vs-websocket). |
| `drizzle-orm` | `^0.38.x` | Typed SQL builder / lightweight ORM | (1) Works natively with both `neon-http` and `neon-serverless` drivers without a separate adapter — no schema-engine binary like Prisma. (2) Zero runtime dependencies on WASM/binaries, which keeps cold start + bundle size small on Vercel Fluid Compute. (3) Schema is plain TypeScript — diffable, testable, and co-located with the domain code the existing codebase style (`web/src/lib/...`). (4) Migration tooling (`drizzle-kit`) emits plain SQL files the team can review in PRs. |
| `drizzle-kit` | `^0.30.x` | Schema migrations | Generates SQL from TS schema (`drizzle-kit generate`), applies migrations in code (`migrate()` from `drizzle-orm/neon-http/migrator`) or via CLI (`drizzle-kit migrate`). No separate migration runtime needed in production; the migrator runs under Node and can be invoked in a `scripts/migrate.ts` tsx script — same pattern as the existing `ensure-action-sheets.ts`. |
| Wisenet REST client | **Custom**, fetch-based | HTTP access to Wisenet | No official npm SDK was discoverable from training data or accessible searches. The native `fetch` API in Node 22+ covers every feature we need (JSON, headers, AbortSignal for timeouts, streaming). A thin typed wrapper in `web/src/lib/wisenet/client.ts` is the standard pattern — matches the existing `web/src/lib/sheets/client.ts` shape. See ["Wisenet client" below](#wisenet-client). |
| `@vercel/functions` | `^3.x` | `attachDatabasePool` + `getCache` + `waitUntil` helpers | Required when using a pg `Pool` (or any persistent pool) under Fluid Compute — `attachDatabasePool(pool)` tells the Fluid runtime to release idle clients before suspending an instance. Not needed if you stay in pure HTTP mode with `neon()`. Also exposes `getCache()` — the framework-agnostic Runtime Cache API — as a fallback for cases where Next.js's `use cache: remote` doesn't fit (see Caching section). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | `^3.23.x` | Runtime validation for Wisenet responses and request bodies | Every Wisenet response should be parsed through a Zod schema at the edge of the Wisenet client. This replaces the current ad-hoc "trust the sheet headers" approach and gives the Phase 1 field-coverage discovery work a place to live as typed schemas. Also used for API route request bodies (`/api/actions`, etc.). |
| `pg` | `^8.13.x` | Optional — traditional Node Postgres driver | Only if you discover you need a feature the Neon HTTP driver can't express (e.g., LISTEN/NOTIFY, large streaming cursors, `COPY`). For the follow-up-state schema described in PROJECT.md (status, notes, timestamps, history), you do NOT need `pg`. |
| `@types/pg` | `^8.11.x` | Types for `pg` if used | Paired with `pg`. Not needed for Neon HTTP. |
| `dotenv-cli` | `^7.x` | Only for local `drizzle-kit` invocations | Wraps `drizzle-kit` so it reads `web/.env` the same way Next does. Alternative: put migration config inline using `process.env` + `vercel env pull` output. |

### Dev Tools (already in place — retained)

| Tool | Purpose | Notes |
|------|---------|-------|
| `vitest` 3.2.4 | Unit + route tests | Keep as-is. Patterns for mocking Wisenet + Postgres described in ["Testing" below](#testing). |
| `tsx` 4.20.3 | One-shot TS scripts | Repurpose for `scripts/migrate.ts`, `scripts/seed.ts`, `scripts/wisenet-probe.ts` (Phase 1 field-coverage tool). |
| `typescript` 5.9.3 | Types | No change. |

### Removals (this milestone)

| Removed | Reason |
|---------|--------|
| `googleapis` 171.4.0 | Sheets retires; service-account JWT auth is no longer needed. |
| `web/src/lib/sheets/*` | Replaced by `web/src/lib/wisenet/*` (read) and `web/src/lib/db/*` (write). |
| `web/src/lib/cache/memory-cache.ts` | Replaced by Next.js `use cache: remote` + `cacheTag` / `cacheLife`, which is region-local but *shared across invocations on the same Fluid Compute instance* and backed by Vercel's Runtime Cache store. No more per-Node-process `Map`. |
| `web/src/lib/dashboard/service.ts`'s `unstable_cache` + `revalidateTag(..., "max")` | Replace with `'use cache: remote'` directive + `cacheTag()` + `revalidateTag()`. The `"max"` second arg to `revalidateTag` was flagged in CONCERNS.md — the new API doesn't take it. |
| `SHEETS_*` env vars (4 of them) | Replaced by `DATABASE_URL` (Neon, Marketplace-injected) + `WISENET_*` (manual). |

---

## Installation

```bash
# From web/
npm install @neondatabase/serverless drizzle-orm zod @vercel/functions
npm install -D drizzle-kit @types/pg  # @types/pg only if you later add pg

# Remove
npm uninstall googleapis
```

---

## Driver mode: HTTP vs WebSocket

`@neondatabase/serverless` ships two transports in one package. The correct choice depends on what you're doing:

| Mode | Import | Best for | Why |
|------|--------|----------|-----|
| **HTTP (default recommendation)** | `import { neon } from '@neondatabase/serverless'` | All reads. Single-statement writes. Server Components. Route handlers that do one or two queries. | Uses a single HTTPS round-trip per query — no connection to reuse, so Fluid Compute's instance reuse doesn't help or hurt it. Zero pool management. Zero `attachDatabasePool` needed. Fastest cold-start. |
| **WebSocket (Pool / Client)** | `import { Pool, neonConfig } from '@neondatabase/serverless'` | Multi-statement `BEGIN ... COMMIT` transactions (e.g., "write action row + append to history log atomically"). `LISTEN/NOTIFY`. Anything `neon()` doesn't support. | Full pg wire protocol. Requires `attachDatabasePool(pool)` from `@vercel/functions` so Fluid Compute can drain idle clients before suspending the instance. |

**Rule of thumb for this project**: default to HTTP. For the "write action row + append to history log" path, either (a) do it as two HTTP queries accepting eventual consistency (simpler), or (b) open a WebSocket `Pool` *only* for that one write flow and wrap both statements in a transaction.

This is a deviation from the existing `src/lib/sheets/actions.ts` pattern which writes rows sequentially with no transactionality (flagged as Medium risk in CONCERNS.md) — Postgres with a single `BEGIN` per bulk action is a direct upgrade, not a side-grade.

**Sources:**
- Vercel Marketplace Storage docs confirm the Neon Marketplace integration is the sanctioned path and auto-injects credentials as env vars (`/docs/marketplace-storage`). Vercel Postgres itself was retired in Dec 2024 and migrated to Neon.
- `@neondatabase/serverless` capability split (HTTP vs WebSocket) comes from Neon's own docs. Version pin `^1.0.0` is defensive — the package was GA by mid-2024 and the 1.x line is the current stable. **Confirm exact latest version with `npm view @neondatabase/serverless version` at implementation time.**

---

## Wisenet client

**Strongly recommended: a fetch-based typed wrapper. No external client library.**

Rationale:
- Native `fetch` in Node 22+ (Vercel's default runtime) is fully featured: JSON, headers, AbortSignal, streaming. No need for `undici`, `ky`, `ofetch`, or `axios`. Adding a client library buys very little for a read-mostly REST API with ≤ ~10 endpoints.
- Keeping it custom means Wisenet responses are validated with `zod` at one chokepoint, giving Phase 1 ("field coverage discovery") a concrete place to accrete typed schemas as gaps are found.
- Matches the existing `web/src/lib/sheets/client.ts` shape — one module owns the client, auth, and retries; feature modules (`web/src/lib/wisenet/students.ts`, etc.) call into it.

Skeleton:

```ts
// web/src/lib/wisenet/client.ts
import { z } from "zod";

type WisenetEnv = {
  baseUrl: string;         // WISENET_BASE_URL
  namespace: string;       // WISENET_NAMESPACE = "begifted-education"
  userId: string;          // WISENET_USER_ID
  centerId: string;        // WISENET_CENTER_ID
  apiKey: string;          // WISENET_API_KEY
};

export async function wisenetFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  env: WisenetEnv = readWisenetEnv(),
): Promise<T> {
  const url = new URL(path, env.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        // ⚠️ AUTH HEADERS — confirm exact names/format from Wisenet's Postman
        // collection in Phase 1 before coding. See "Open research gaps".
        ...buildWisenetAuthHeaders(env),
        ...init.headers,
      },
    });
    if (!res.ok) throw new WisenetError(res.status, await res.text());
    const body = await res.json();
    return schema.parse(body);
  } finally {
    clearTimeout(timeout);
  }
}
```

### ⚠️ Open research gap — Wisenet auth scheme

**I could not confirm the Wisenet auth header names and token format from the Postman docs at `https://documenter.getpostman.com/view/17903053/2sA3XPChyE`.** That URL is a client-rendered Postman SPA — automated fetches return only `<h1>Wise APIs</h1>` with no endpoint details. I will not invent header names (the quality gate explicitly forbids it).

**Confidence: LOW.** This must be verified in Phase 1 by a human:
1. Open the Postman collection in a browser.
2. Look at any one example request. Note:
   - The **base URL** (likely includes the namespace `begifted-education`).
   - The exact header names used for auth. Candidates seen in similar student-management APIs: `X-API-Key`, `Authorization: Bearer <key>`, `apikey`, `X-User-ID`, `X-Center-ID`, `X-Namespace`, or a combined `Authorization` value. **Do not assume — read the collection.**
   - Whether credentials go in headers, query string, or body.
   - The expected `Content-Type` for writes (if any writes are needed — the project scope keeps Wisenet read-only).
3. Document the scheme in `web/.env.example` and in a short `docs/wisenet-api.md`.

Until confirmed, `buildWisenetAuthHeaders()` above is an empty function — do not commit guessed header names.

**Why this is low-risk to defer**: it's one Phase 1 lookup, not an architectural decision. The client skeleton is ready; only the auth block needs filling in.

---

## Caching Wisenet responses

**Recommendation: Next.js 16 `use cache: remote` + `cacheTag` + `cacheLife`, backed by Vercel Runtime Cache.** This is the direct replacement for both `unstable_cache` and `memory-cache.ts`.

### Why this combination

Verified from Vercel's live Runtime Cache docs (`/docs/runtime-cache`):

1. **Runtime Cache is the 2026 API** — Vercel's own compat table explicitly says "Next.js 16 and above → `use cache: remote` or `fetch` with `getCache`", and marks `unstable_cache` as the "Next.js 15" pattern.
2. **Regional, persistent, tag-invalidated.** The Runtime Cache is per-region, isolated per project × environment, persistent across deployments, and supports `cacheTag()` → `revalidateTag()` (or `getCache().expireTag()`). Tag invalidation propagates across regions within 300 ms.
3. **Storage shape fits our data.** The dashboard payload is comfortably under 2 MB (the per-item limit). Each cached item supports up to 64 tags (256 bytes each) — plenty for the `dashboard-payload` / `student-<key>` tag strategy.
4. **Drops `memory-cache.ts` entirely.** The per-Node-process `Map` in `web/src/lib/cache/memory-cache.ts` was flagged in CONCERNS.md (MEDIUM) as inconsistent across Vercel replicas. `use cache: remote` moves the cache *off* the process and into a shared regional store. No more "hit a different replica, cache miss" behavior.

### Implementation pattern

Enable `cacheComponents` in `next.config.ts`:

```ts
// web/next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
};

export default nextConfig;
```

Wrap Wisenet reads:

```ts
// web/src/lib/wisenet/students.ts
import { cacheLife, cacheTag } from "next/cache";
import { wisenetFetch } from "./client";

export async function getActiveStudents() {
  "use cache: remote";
  cacheTag("wisenet:students", "dashboard-payload");
  cacheLife({ expire: 60 }); // match today's 60s unstable_cache TTL

  return wisenetFetch("/students?state=active", ActiveStudentsSchema);
}
```

Invalidate on writes:

```ts
// web/src/app/api/actions/route.ts (after write to Postgres)
import { revalidateTag } from "next/cache";

revalidateTag("dashboard-payload");
```

### What NOT to do

| Anti-pattern | Why |
|--------------|-----|
| `revalidateTag(tag, "max")` — the current code in `web/src/lib/dashboard/service.ts:20` | CONCERNS.md flags this second arg as suspect. It is **not** part of the current `revalidateTag` signature. Drop it during migration. Confirmed: Vercel's Runtime Cache and Next.js cache docs show `revalidateTag(tag)` with a single argument. |
| Add Redis / Upstash for read-caching Wisenet | Overkill. Runtime Cache covers the exact use case (read-mostly REST responses, tag-invalidated on writes) and is built into Vercel. Only reach for Redis if you need cross-region coordination (sessions, rate limiting) — which this project does not. |
| Keep `memory-cache.ts` as "first layer" | CONCERNS.md explicitly calls out the two-layer cache as a correctness hazard. Collapse to one layer (Runtime Cache). |
| Use `unstable_cache` in new code | It's the Next.js-15-era API. Still works in 16, but `use cache: remote` is the forward path. Don't write new `unstable_cache` wrappers during this migration. |

### Fallback: `getCache()` from `@vercel/functions`

Only reach for the framework-agnostic `getCache()` API when `use cache: remote` doesn't fit (e.g., you need to cache across a library boundary that can't use directives, or you want manual key control). Not needed for dashboard data.

---

## Schema migrations

**Recommendation: `drizzle-kit generate` → commit SQL files → apply via a `scripts/migrate.ts` tsx script in deploys.**

### Why drizzle-kit over alternatives

| Candidate | Verdict | Reason |
|-----------|---------|--------|
| **`drizzle-kit`** | ✅ Use | Same ecosystem as `drizzle-orm`; emits raw `.sql` files for code review; migrator runs in pure Node; no schema engine binary; lets you re-generate from TS schema on every PR. |
| Prisma Migrate | ❌ Don't use | Requires the Prisma engine (Rust binary), which inflates bundle size and slows cold starts on Vercel. The engine's relationship with Neon's HTTP driver requires the `@prisma/adapter-neon` dance — an extra moving part. Only worth it if we also wanted Prisma's Client, which we don't. |
| `node-pg-migrate` | ❌ Don't use | Works, but decouples migrations from schema (hand-written up/down .sql or .js). No type-safety link to queries. If we're already using Drizzle for queries, using drizzle-kit keeps one source of truth. |
| Hand-rolled SQL + `psql` | ❌ Don't use | Fragile. No rollback semantics. No drift detection. |

### Layout

```
web/
  drizzle/
    0000_initial.sql           ← generated by drizzle-kit
    meta/
      _journal.json
  src/
    lib/
      db/
        schema.ts              ← TypeScript schema (single source of truth)
        client.ts              ← `drizzle(neon(env.DATABASE_URL))`
        queries/               ← typed query fns consumed by API routes
  scripts/
    migrate.ts                 ← tsx script: `migrate(db, { migrationsFolder: "./drizzle" })`
  drizzle.config.ts            ← paths + dialect=postgresql + driver config
```

Deploys: run `tsx scripts/migrate.ts` as a Vercel build step (before `next build`) or as a separate CI job. The migrator is idempotent — it tracks applied migrations in a `__drizzle_migrations` table.

---

## Env / secrets

### Env var plan

| Variable | Source | Notes |
|----------|--------|-------|
| `DATABASE_URL` | **Auto-injected** by Vercel Marketplace Neon integration | Pooled connection string (PgBouncer). Use this for `@neondatabase/serverless` HTTP mode. |
| `DATABASE_URL_UNPOOLED` (or similar — exact name varies; confirm after provisioning the Marketplace integration) | Auto-injected | Non-pooled direct connection for migrations and tools that don't play well with PgBouncer (some Drizzle operations). |
| `WISENET_BASE_URL` | Manual (Vercel env UI + `web/.env`) | e.g., `https://api.wisenet.co/` — **confirm from Postman in Phase 1** |
| `WISENET_NAMESPACE` | Manual | `begifted-education` per PROJECT.md |
| `WISENET_USER_ID` | Manual | Per PROJECT.md — Wisenet-issued |
| `WISENET_CENTER_ID` | Manual | Per PROJECT.md — Wisenet-issued |
| `WISENET_API_KEY` | Manual | Per PROJECT.md — Wisenet-issued. **SECRET.** |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, `STAFF_ALLOWLIST` | Existing | Unchanged. |
| `SHEETS_*` (4 vars) | **REMOVE** after cutover | No longer used. |

### Where env lives

- **Production & preview**: Vercel env vars, set via Vercel UI (or `vercel env add`).
- **Local**: `web/.env` (already gitignored per `web/.gitignore`). Developers run `vercel env pull` to sync.
- **Validation**: extend `web/src/lib/runtime/env.ts` with `getWisenetEnv()` and `getDbEnv()` — keep the existing throw-on-missing pattern. Kill the current dev-mode auth fallback strings (CONCERNS.md flagged as HIGH) in the same PR.

### `vercel.json` vs `@vercel/config.ts`

**Don't invent `@vercel/config.ts` — no such package exists in Vercel's docs as of 2026-04.** Vercel's config lives in `vercel.json` (JSON) at the project root. We only need `vercel.json` if we enable Fluid Compute programmatically or override function settings — default-on Fluid is already active for new projects (since April 23, 2025, per Vercel docs), so we likely need zero `vercel.json` entries for this migration.

If we decide to pin Node runtime or function region for the Neon-serving routes, a minimal `web/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "fluid": true,
  "functions": {
    "src/app/api/**/route.ts": { "maxDuration": 30 }
  }
}
```

---

## Testing

Keep Vitest. No new framework.

### Pattern 1 — Wisenet client: mock `fetch`

The Wisenet client is one module (`web/src/lib/wisenet/client.ts`) that only talks to `globalThis.fetch`. Mock it with `vi.stubGlobal`:

```ts
// web/src/test/wisenet-client.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveStudents } from "@/lib/wisenet/students";

describe("wisenet client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("parses an active-students response", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ students: [/* fixture */] }), { status: 200 }),
    );
    const result = await getActiveStudents();
    expect(result.students).toHaveLength(/* ... */);
  });

  it("throws on 4xx", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("bad", { status: 401 }));
    await expect(getActiveStudents()).rejects.toMatchObject({ status: 401 });
  });
});
```

This is a direct upgrade of the existing `web/src/test/actions-route.test.ts` style — `vi.mock` for feature modules, `vi.stubGlobal` at the network boundary.

### Pattern 2 — Postgres store: two tiers

**Tier A (unit, most tests): mock the Drizzle client.** The existing route-test style from `actions-route.test.ts` maps cleanly:

```ts
vi.mock("@/lib/db/client", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }) }),
    select: vi.fn(/* ... */),
  },
}));
```

**Tier B (integration, a handful of tests): real Postgres via Neon branch.** Neon supports instant database branching — each PR/test run can target a fresh branch and tear it down. Run migrations via `tsx scripts/migrate.ts` at the start of the test, exercise the real query functions, teardown. Use an env var `TEST_DATABASE_URL` so these tests are opt-in (skip by default in `npm test`, run in a CI matrix job).

Alternative for Tier B if Neon branching is overkill: `pg-mem` (in-memory Postgres) gated to the Drizzle schemas used. Lower fidelity, but fast and deterministic.

### Pattern 3 — Cache invalidation contract test

CONCERNS.md flagged the "read → write → re-read" test as missing (MEDIUM). Add it in this milestone:

```ts
// web/src/test/cache-invalidation.test.ts
// 1. GET /api/dashboard, assert payload shape
// 2. POST /api/actions (triggers revalidateTag("dashboard-payload"))
// 3. GET /api/dashboard, assert the action state reflects the write
```

### What NOT to do

- Don't mock `@neondatabase/serverless` at the driver level — too low-level, brittle. Mock the Drizzle client or the repository layer (`web/src/lib/db/queries/*`) instead.
- Don't try to hit live Wisenet from Vitest. Use fixtures captured once from Postman, stored at `web/src/test/fixtures/wisenet/*.json`, and loaded by tests.
- Don't rely on MSW unless the project already uses it (it doesn't). `vi.stubGlobal("fetch", ...)` is simpler for this surface area.

---

## Alternatives Considered

| Recommended | Alternative | When Alternative Wins |
|-------------|-------------|------------------------|
| `@neondatabase/serverless` (HTTP) | `pg` + `attachDatabasePool` | If you end up needing LISTEN/NOTIFY, large cursor streams, or multi-round-trip transactions everywhere. For this project's follow-up-state scope, the HTTP driver is enough. |
| `drizzle-orm` | `Kysely` | Kysely is a pure type-safe SQL builder (no ORM semantics). Comparable DX; slightly lower ceiling than Drizzle (no schema-first codegen, no studio). Drizzle's schema-as-TS + `drizzle-kit` migration flow is the bigger win for a small team. |
| `drizzle-orm` | Prisma | Prisma wins when you want the Studio UI + Admin tooling + `@prisma/client` relation traversal out of the box, and you don't mind the engine binary. For a serverless, small-surface app like this, the engine overhead is pure cost. |
| `drizzle-orm` | Raw SQL via `@neondatabase/serverless`'s `sql` tag | Valid for ~5-query apps. This project will have ≥10 typed queries once history + notes land; having a schema file pay off. |
| `drizzle-kit` | `node-pg-migrate` | If you wanted hand-written migrations and no ORM. Not our case. |
| Custom fetch client | `ky` / `ofetch` / `axios` | If Wisenet has unusual retry semantics (e.g., 429 with `Retry-After`) and we want a library to implement backoff. For a handful of endpoints, custom with a tiny retry wrapper is simpler and auditable. |
| `use cache: remote` | Redis (Upstash) | When you need pub/sub, rate limiting, leaderboards, or cross-region session storage. None of those apply here. |
| `use cache: remote` | `unstable_cache` | Don't — it's the older API. Only retain if we stay on Next 15. |
| Zod | Valibot / ArkType | Zod has deepest ecosystem + familiarity. Valibot has smaller bundle. Not a meaningful bundle win here because validation runs server-side. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@vercel/postgres` | **Deprecated.** Vercel retired Vercel Postgres in December 2024 and migrated existing databases to Neon. Vercel's own docs redirect storage seekers to the Marketplace. | `@neondatabase/serverless` |
| Prisma (for this project) | Engine binary + cold-start cost + extra adapter (`@prisma/adapter-neon`) layer. Payoff requires using Prisma Studio / Client, which we don't need. | `drizzle-orm` + `drizzle-kit` |
| `axios` | Adds ~30KB and a Node-specific transport path. Native `fetch` is better-integrated with Next.js caching semantics (e.g., `fetch` inside `'use cache: remote'` participates in request dedup). | Native `fetch` (or `ofetch` if you really want a library) |
| `knex` | Migrations + query builder, but last-generation DX. No first-class TypeScript. | `drizzle-orm` + `drizzle-kit` |
| Redis for dashboard read-cache | Unnecessary external service. Vercel Runtime Cache is native, already billed as part of Fluid, and tag-invalidates in ≤300ms globally. | `'use cache: remote'` + `cacheTag` |
| `revalidateTag(tag, "max")` | The second arg is not in the current Next.js API. CONCERNS.md already flags this as a bug in the current code. | `revalidateTag(tag)` — single argument |
| Per-process in-memory caches (new ones) | Flagged in CONCERNS.md: inconsistent across Vercel replicas. `memory-cache.ts`, `snapshot-store.ts`, and `health-state.ts` all have this class of bug. Don't introduce new instances. | Runtime Cache for shareable read-cache; Neon Postgres for state that must survive cold starts |
| Edge runtime for data routes | `@neondatabase/serverless` HTTP mode works on Edge, but existing code already declares `export const runtime = "nodejs"` on every API route (for `googleapis`). Keeping Node also keeps Fluid Compute's in-function concurrency, `attachDatabasePool`, and after() semantics. No reason to flip. | `export const runtime = "nodejs"` — unchanged |
| `@vercel/config.ts` | Not a real package. `vercel.json` is the config file. | `vercel.json` (only if you need non-default function config) |

---

## Stack Patterns by Variant

**If Phase 1 discovers Wisenet auth is a simple API-key header:**
- Client is ~100 lines. No refresh-token machinery. Proceed with the `wisenetFetch` skeleton above.

**If Phase 1 discovers Wisenet uses OAuth or session tokens that expire:**
- Add a tiny in-memory token cache keyed on `userId:centerId`, guarded by a per-Fluid-instance async lock. `attachDatabasePool`-style: token refresh done once per instance lifetime.
- Token itself should still be derived from static env-var credentials, not persisted in Postgres (write path isn't Postgres's job).

**If the follow-up-state schema grows past ~5 tables with relationships:**
- Drizzle's `relations` helper + `db.query.* findFirst/findMany` API still covers it. No need to swap ORMs.

**If we need multi-region read replicas for the dashboard:**
- Out of scope this milestone. Neon supports read replicas per region; the Vercel Marketplace Neon integration can be configured per-region. Revisit if latency becomes a concern.

**If a bulk-action ever needs true atomicity (all-or-nothing across N students):**
- Switch that one code path to the WebSocket driver (`Pool` + `attachDatabasePool`) wrapped in `BEGIN...COMMIT`. Keep everything else on HTTP.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@neondatabase/serverless@^1.0.0` | `drizzle-orm@^0.38` | Drizzle ships a `neon-http` driver (`drizzle-orm/neon-http`) and a `neon-serverless` driver (`drizzle-orm/neon-serverless`). Both use `@neondatabase/serverless` under the hood. |
| `drizzle-orm` + `drizzle-kit` | Must be same major | Mismatched versions cause schema-diff drift. Pin `drizzle-orm` and `drizzle-kit` to the same release cycle. |
| `next@16.2.1` | `cacheComponents: true` | Required for `'use cache: remote'` to route to Vercel Runtime Cache. Confirmed from Vercel Runtime Cache docs (`/docs/runtime-cache`). |
| `next@16.2.1` | `@vercel/functions@^3` | `attachDatabasePool` and `getCache` require the @vercel/functions package; they are not re-exported from `next`. |
| `next-auth@5.0.0-beta.30` | Everything else | Already in use. CONCERNS.md flags the beta instability — unchanged by this migration but re-verify session flow still works after the Next 16 cache API swap. |
| Vercel Node runtime | Node 22+ | `@types/node@^22` is already pinned; `@neondatabase/serverless`, `drizzle-orm`, and `@vercel/functions` all support Node 20+ fine. |
| Fluid Compute | `attachDatabasePool` (if using pg Pool) | Without `attachDatabasePool`, idle pool clients can block Fluid's suspend step, causing warm-instance resource leaks. Required for any persistent pool. |

---

## Sources

**High confidence (fetched live from vercel.com/docs during this research, 2026-04-20):**
- `https://vercel.com/docs/runtime-cache` — confirms Next.js 16 `use cache: remote`, `cacheTag`, `cacheLife`, `revalidateTag`, 300ms global propagation, 2MB item / 64 tags / 256-byte tag limits.
- `https://vercel.com/docs/caching/runtime-cache/data-cache` — confirms Data Cache is Next 14-and-below pattern, Runtime Cache is the 2026 successor.
- `https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package` — confirms `@vercel/functions` exports `attachDatabasePool` (for pg Pool under Fluid), `getCache` (RuntimeCache API), `waitUntil`, `invalidateByTag`, `addCacheTag`. Confirms Next 15.1+ should use `after()` from `next/server` instead of `waitUntil()`.
- `https://vercel.com/docs/fluid-compute` — confirms Fluid is default-on as of April 23, 2025; supports Node.js/Python runtimes; shares instance across invocations; bytecode caching on Node 20+.
- `https://vercel.com/docs/functions/runtimes/node-js` — confirms Node runtime is the default and works with Fluid.
- `https://vercel.com/docs/marketplace-storage` — confirms Neon is the Postgres path; Marketplace auto-injects env vars; Vercel Postgres retired Dec 2024 and migrated to Neon.
- `https://vercel.com/docs/postgres` — "Vercel Postgres is no longer available" notice; use Marketplace Neon.
- `https://vercel.com/docs/environment-variables/system-environment-variables` — confirms Vercel-injected system env vars; specific Neon var names (`DATABASE_URL_UNPOOLED` etc.) should be read from the actual Marketplace provisioning output.

**Medium confidence (informed by training data + the fetched Vercel docs, not directly verified against the packages' live docs this session):**
- `@neondatabase/serverless` HTTP vs WebSocket split and version pin (^1.0.0). Verify current npm version before locking.
- `drizzle-orm` / `drizzle-kit` version pins (^0.38.x / ^0.30.x). Verify current npm versions before locking.
- Drizzle ↔ Neon adapter naming (`drizzle-orm/neon-http`, `drizzle-orm/neon-serverless`).
- `zod` version pin.

**LOW confidence (flagged for Phase 1 verification):**
- **Wisenet auth scheme.** `https://documenter.getpostman.com/view/17903053/2sA3XPChyE` is a client-rendered Postman SPA — the static HTML served to WebFetch contains only `<h1>Wise APIs</h1>`. Automated scraping of the collection requires either the Postman API (authenticated) or a human opening the collection in a browser. **Phase 1 must confirm the exact auth headers and base URL — do not proceed with a guessed scheme.**

**Existing codebase context (read directly):**
- `.planning/PROJECT.md` — milestone scope, Wisenet credentials list, Neon decision, out-of-scope items.
- `.planning/codebase/STACK.md` — current versions (Next 16.2.1, React 19.2.4, next-auth 5.0.0-beta.30, googleapis 171.4.0, Vitest 3.2.4).
- `.planning/codebase/INTEGRATIONS.md` — what `googleapis` does today, cache layers, env var layout.
- `.planning/codebase/CONCERNS.md` — dev-mode auth fallback strings (HIGH), `revalidateTag(..., "max")` flag, two-layer cache hazard, `snapshot-store`/`health-state` serverless-ephemeral bugs, no bulk-transactionality in writes.
- `web/package.json` — current deps, scripts.
- `web/src/test/actions-route.test.ts` — existing Vitest mocking pattern (`vi.mock` for feature modules).
- `web/vitest.config.ts` — Vitest node environment + `@` alias.

---
*Stack research for: Wisenet migration — REST client + Neon Postgres + Runtime Cache on Next.js 16 / Vercel Fluid Compute*
*Researched: 2026-04-20*
