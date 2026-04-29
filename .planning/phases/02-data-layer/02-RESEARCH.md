# Phase 2: Data Layer - Research

**Researched:** 2026-04-21
**Domain:** Wisenet REST client (read) + Neon Postgres (write) + Validation.gs port, on Next.js 16 App Router / Vercel Fluid Compute
**Confidence:** HIGH on locked decisions (inherited from 02-CONTEXT.md Phase 1); HIGH on npm-verified library versions (queried live 2026-04-21); HIGH on Wisenet field shapes (6 fixture files probed in Phase 1); MEDIUM on exact `drizzle-orm/neon-serverless` Pool ergonomics (verified via Drizzle docs and GitHub source).

## Summary

Phase 2 stands up two parallel workstreams under `web/src/`: the Wisenet read client (`lib/wisenet/{client,endpoints,types,mappers,retry}.ts`) and the Neon Postgres write layer (`lib/db/{schema,client,bulk-client,queries}.ts`). The 41 `Validation.gs` assertions port into 5 domain-split Vitest files as the de-facto parity spec, and a fixture adapter (`web/src/test/helpers/wisenet-to-dashboard-sources.ts`) feeds Wisenet-mapper output into the existing 45+ `dashboard-logic.test.ts` assertions so the parity gate passes in TEST-02. `service.ts` is not modified in Phase 2 — the Sheets path still serves production.

Four big shifts vs STACK.md (which was written 2026-04-20 before npm verification):
1. **drizzle-orm 0.45.2** is current (STACK.md said 0.38) — peer range `@neondatabase/serverless >=0.10.0` still covers us.
2. **zod 4.3.6** is current stable (STACK.md said 3.23). **Plan 2 should stay on zod v3 (^3.25 latest v3)** for API stability — Zod v4 has breaking API changes (`z.coerce` still works but `.email()`, `.ip()`, etc. moved). v3 is still maintained.
3. **@neondatabase/serverless 1.1.0** (STACK.md said 1.0) — non-breaking patch.
4. **p-limit 7.3.0** is current (ESM-only, fine under Next 16 / tsx).

**Primary recommendation:** Use Drizzle's simple-config pattern (`drizzle(process.env.DATABASE_URL)` for HTTP; `drizzle({ client: new Pool(...) })` for WebSocket), pin Zod to `^3.25.x` for API stability, and keep `retry.ts` as a separate file for test isolation per D-17 discretion. The schema is four tables exactly (`follow_up_state`, `follow_up_log`, `inactive_students`, `student_admin_ownership`) — no supporting tables needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried forward from Phase 1:**
- **D-04** — Copy `.planning/research/fixtures/wisenet/*.json` → `web/src/test/fixtures/wisenet/` for Vitest (6 resource samples only; the 3 fingerprint files stay in research)
- **D-05** — Drop `Should_Credit` column entirely. TEST-01 drops/rewrites the 3-5 `Validation.gs` assertions that exercise `Should_Credit` priority over `session_duration`
- **D-06** — `student_admin_ownership(student_key PK, admin_key, assigned_at, assigned_by_email, updated_at)` Postgres table. Admin key values from `ADMIN_OWNER_REGISTRY`: `palm`, `kem`, `care`, `aya`, `petchy`, `muk`, `unassigned` fallback
- **D-07** — Credit balance: direct-first with derive-client fallback, decided per-field. Current path: derive from `past_sessions.duration` sum for all 3 balance rows (RED today; upgrades to GREEN if Phase 2 sessionCredits probe with resolved pair succeeds)
- **D-08** — Pending-deduction rule: `meetingStatus === "ENDED" AND teacher_feedback empty AND (duration / 3600000) > 0 → count as pending`
- **Auth headers** — HTTP Basic `base64(WISENET_USER_ID:WISENET_API_KEY)` + `x-api-key: WISENET_API_KEY` + `x-wise-namespace: WISENET_NAMESPACE` (`begifted-education`) + `Content-Type: application/json` + identifier `user-agent`
- **Tenant identity** — `{{institute_id}}` = `WISENET_CENTER_ID` is a **path parameter** (`/institutes/v3/{center}/...`), NOT a header
- **Base URL** — `https://api.wiseapp.live`
- **Pagination** — `page_number` (1-based) + `page_size` (default 50). Envelope: `{status, message, data: {<items>, count}}`. Iterator terminates when `records.length < page_size`. `skip`/`take` silently ignored. Past-end returns `data.<items>=[]`. NO Link header, NO cursor.
- **Rate-limit retry** (WCLI-01) — 429-detection + exponential backoff (1s → 2s → 4s → 8s, capped). Do NOT parse `Retry-After` or `X-RateLimit-*` (server is headerless — confirmed at 200-burst)
- **Path-typo fix** — Postman catalogue has `{{institute_id}}s/students` typo. Phase 2 WCLI-03 uses corrected path `/institutes/v3/{center}/students`
- **Session-endpoint shape** — `data.sessions[*]` uses `meetingStatus` (enum `ENDED`/`CANCELLED`/`UPCOMING`/`IN_PROGRESS`) not `finalStatus`/`status`. `duration` is in milliseconds. `scheduledStartTime` is ISO 8601. `teacherFeedback` is NOT on list responses — requires detail fetch with `showFeedbackSubmission=true`
- **sessionCredits gate** — Endpoint exists at `/institutes/{center}/classes/{classId}/students/{studentId}/sessionCredits` but rejects arbitrary student+class pairs (400 "Student not found"). Requires participant-resolved student_id — Phase 2 WCLI-04 must derive via `/user/classes/{classId}/participants` before calling

**Phase 2 stack (D-17..D-26):**
- **D-17** — Drizzle ORM + `@neondatabase/serverless` HTTP driver default. WebSocket `Pool` (via `attachDatabasePool`) reserved for DB-07 bulk-write path only. One extra client file (`db/bulk-client.ts`) isolates WebSocket pool lifecycle
- **D-18** — Parent-name: 2-step join via `parentIds[]` → `/parents` endpoint. Batch scoped per-`getStudents` page (one `/parents` request per 50 students). Fallback `"missing-parent"` when `parentIds` empty
- **D-19** — Teacher-feedback fetch: pre-filter on `meetingStatus === "ENDED"`. Use `p-limit` concurrency 5. Mapper exposes option to skip for tests without pending-deduction concern
- **D-20** — Validation.gs port: 5 files under `web/src/test/` split by domain (`packages.test.ts` / `projection.test.ts` / `pending-deduction.test.ts` / `queue.test.ts` / `calendar.test.ts`), parametric `describe.each(fixtures)` pattern
- **D-21** — Admin-ownership seed: `scripts/seed-admin-ownership.ts` runs `clasp run buildStudentAdminOwnershipMap`, bulk-insert via Drizzle with ON CONFLICT DO UPDATE. Fallback: writes JSON to `.planning/research/admin-ownership-seed.json` for manual review before inserting
- **D-22** — Migrations: separate GH Actions CI job before Vercel deploy, uses `DATABASE_URL_UNPOOLED`, idempotent via `__drizzle_migrations`. Layout: `.github/workflows/db-migrate.yml` with `workflow_dispatch` + `push` on `main`
- **D-23** — NO caching in Phase 2 Wisenet reads. Phase 3 adds `use cache: remote`. `memory-cache.ts` untouched through Phase 2
- **D-24** — TEST-02 parity gate: fixture adapter at `web/src/test/helpers/wisenet-to-dashboard-sources.ts` signature `async function toDashboardSources(wisenetFixtures: WisenetFixtureSet): Promise<DashboardSources>`. New `describe("wisenet parity", ...)` block in `dashboard-logic.test.ts`; existing assertion bodies unchanged
- **D-25** — DB-07 bulk: WebSocket `Pool` + `attachDatabasePool(pool)` + `BEGIN/COMMIT`. Pool config `max: 3`, `idleTimeoutMillis: 30_000`, singleton via `globalThis.__bgBulkPool ??= ...`. Scope: `api/actions/bulk/route.ts` only (Phase 3 wires this)
- **D-26** — Single `web/src/lib/wisenet/endpoints.ts` with all resource functions (not per-resource split). Companion files: `client.ts`, `types.ts`, `mappers.ts`, `retry.ts`

### Claude's Discretion

The planner decides these without re-asking Kevin:
- Exact `web/src/lib/wisenet/client.ts` internal structure (retry wrapper composition, auth-header construction helper, timeout/abort signal orchestration)
- Exact `web/src/lib/db/schema.ts` table definitions beyond the 4 locked ones — any supporting tables queries need
- Zod schema file organization (one `types.ts` or split per-resource — planner's call)
- `p-limit` concurrency value for teacher-feedback batch (default 5; planner may raise if Phase 2 measurement proves safe)
- Exact file names in `web/src/test/` for the 5 Validation.gs port files
- Whether to emit `drizzle.config.ts` separately or inline in the migrate script
- Whether to include `package.json` scripts row for `db:migrate`/`db:generate` (recommend yes)
- Whether `retry.ts` lives as separate file or inlined in `client.ts` (recommend separate for test isolation)
- Error-response parsing: `WisenetError.redactedBody` redaction regex list (include `email`, `phone`, `loginPin`, `displayIdentifier`, `answer`, `notes`; planner may add)
- Exact TEST-03 placement — Phase 2 (against Sheets path) or deferred to Phase 3 (against new `use cache: remote` tags). Planner's call with justification.

### Deferred Ideas (OUT OF SCOPE)

- **sessionCredits-with-resolved-pair probe** — Phase 2 if time, else Phase 3
- **sessionCredits fixture upgrade to 200 status** — after Opportunity 6 probe succeeds
- **Tag-based package exclusion** — future `UX-*` / `OPS-*` v2
- **Invoice/payment status tracking** — future `OPS-*` / `RPT-*` v2
- **Attendance/engagement metrics** — future `RPT-*` v2
- **Real-time webhook invalidation** — existing v2 `OPS-01`
- **Trainer-field as admin-ownership v2** — rejected for v1, post-milestone reconsider
- **Neon read replicas per region** — out of scope
- **Upstash Redis / cross-region session storage** — out of scope
- **Prisma Studio admin UI** — Drizzle has no Studio equivalent; acceptable
- **TEST-03 cache-invalidation regression test placement** — Claude's Discretion (see below)
- **Moving probe scripts out of `web/scripts/`** — deferred per Phase 1 D-16
- **WISENET_ENDPOINTS.md typo cleanup** (`{{institute_id}}s/students`) — deferred, Phase 2 WCLI-03 uses corrected path inline

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WCLI-01 | Authenticated fetch wrapper (timeout, retry, structured error) | [Client structure + retry wrapper](#wcli-01--clientts-authenticated-fetch-wrapper). Auth from Phase 1 `_auth-fingerprint.json`. 429-detect + exp-backoff via `retry.ts`. `AbortSignal.timeout(15_000)` for timeout. `WisenetError` with status+path+redacted body. |
| WCLI-02 | TypeScript types for Wisenet responses (hand-authored from real shapes) | [Zod schemas derived from 6 fixtures](#wcli-02--typests-zod-schemas-and-ts-types). Each fixture's `_field_paths_candidates` drives field list; types inferred via `z.infer<typeof Schema>`. |
| WCLI-03 | One async function per Wisenet resource | [Single endpoints.ts with 7 functions](#wcli-03--endpointsts-resource-functions): `getStudents`, `getStudent`, `getClass`, `getPastSessions`, `getUpcomingSessions`, `getSessionCredits`, `getParents`. Pagination iterator terminates when `records.length < page_size`. Path typo fix: `/institutes/v3/{center}/students` (no trailing `s`). |
| WCLI-04 | Mappers from Wisenet JSON → DashboardSources shape | [6 mapper branches per field-map RED/YELLOW rows](#wcli-04--mappersts-wisenet--dashboardsources). meetingStatus→final_status coercion, duration ms→minutes, 2-step parent join, credit balance derive-from-past-sessions, pending-deduction composite rule. |
| WCLI-05 | Zod at boundary with `z.coerce.*` for type coercion | [Single fetch chokepoint parses through Zod](#wcli-05--zod-boundary-and-coercion-pitfall-2-mitigation). `z.coerce.string().trim()`, `z.coerce.number()`, `z.coerce.date()`, `z.enum([...])`, `z.coerce.number().transform(ms => ms / 60000)`. Addresses Pitfall 2. |
| WCLI-06 | Fixture-driven Vitest tests for mappers | [`wisenet-mappers.test.ts` + `wisenet-client.test.ts`](#wcli-06--fixture-tests). Uses `web/src/test/fixtures/wisenet/*.json`. Mocks `fetch` via `vi.stubGlobal`. Asserts happy path + 400 `credit_balance_sample.json` error shape + Zod schema failure on type drift. |
| WCLI-07 | Wisenet creds via `getWisenetEnv()` in `lib/runtime/env.ts`; never in client bundle | [getWisenetEnv body modeled on getAuthEnv/getSheetsEnv](#wcli-07--getwisenetenv-and-getdbenv). Returns `{baseUrl, userId, apiKey, centerId, namespace}`. Throws on missing. |
| DB-01 | Neon Postgres via Vercel Marketplace; `DATABASE_URL` + pooled auto-injected | [Operator action — not a code task](#db-01--neon-postgres-provisioning-operator-action). Phase 2 documents the provision flow; Kevin runs it. Expected env vars: `DATABASE_URL` (pooled, for runtime HTTP), `DATABASE_URL_UNPOOLED` (direct, for migrations). |
| DB-02 | Drizzle schema for `follow_up_state`, `follow_up_log`, `inactive_students`, `student_admin_ownership`; initial migration SQL committed | [Exact Drizzle schema definitions](#db-02--drizzle-schema-definitions) with pgTable, pg enums, PKs, FKs, indexes. Migration generated via `drizzle-kit generate`. |
| DB-03 | Connection-pool singleton (`globalThis.__bgBulkPool ??= ...` max:3) uses pooled URL; safe under Fluid burst | [HTTP client + bulk WebSocket pool singleton](#db-03--db-clientts-and-bulk-clientts-connection-pooling). HTTP `db` for reads + single-statement writes. `bulkDb` with WebSocket Pool for multi-statement transactions. `attachDatabasePool(pool)` invoked for WebSocket pool. |
| DB-04 | Typed query functions: `loadActionStateMap`, `upsertFollowUpState`, `appendFollowUpLog`, `listInactive`, `markInactive`, `clearInactive`, `readHistory`, plus admin-ownership helpers | [7 query functions + 2 ownership helpers](#db-04--queriests-typed-functions). Each function returns typed result via Drizzle's `$inferSelect`/`$inferInsert`. |
| DB-05 | Same-day action-state visibility rule preserved in domain layer | [Same-day gate stays in `sanitizeStudentActionState`](#db-05--same-day-visibility-preservation). Reads `updated_at::date = today()` in TS domain code, NOT in SQL. Matches existing `web/src/lib/dashboard/actions.ts::sanitizeStudentActionState` semantics. |
| DB-06 | Every write attributes actor (`actor_email`, `actor_name`) from NextAuth session into log rows | [Writes take actorEmail + actorName params](#db-06--actor-attribution). `upsertFollowUpState` and `appendFollowUpLog` require these; no default values. Route-handler boundary resolves via `requireSessionUser()`. |
| DB-07 | Bulk-action write (50 students / one transaction) via batched `INSERT ... VALUES (...)` | [Bulk write via WebSocket Pool + BEGIN/COMMIT](#db-07--bulk-write-atomicity). `bulkDb.transaction(...)` with two bulk inserts: `follow_up_state` + `follow_up_log`. Single round-trip for ≤50 rows per array. |
| DB-08 | `scripts/db-migrate.ts` runs migrations outside app startup (not instrumentation.ts, not postbuild hook) | [tsx script invoked from GH Actions](#db-08--migration-runner). Uses `drizzle-orm/neon-http/migrator` or `drizzle-kit migrate`. `DATABASE_URL_UNPOOLED` (direct Neon URL) because PgBouncer is incompatible with `CREATE TABLE ... WITH (...)` / advisory locks. Idempotent via `__drizzle_migrations`. |
| TEST-01 | 41 `Validation.gs` assertions ported to Vitest; suite green before SVC-05 deletions | [5 domain-split port files](#test-01--validationgs-port-assignment-41-assertions--5-files). Assertion-to-file mapping below. `Should_Credit` assertions (3-5 of them) drop/rewrite per D-05. |
| TEST-02 | Existing 45+ `dashboard-logic.test.ts` assertions pass unchanged when driven by Wisenet-mapper outputs (facade parity gate) | [Fixture adapter at `web/src/test/helpers/wisenet-to-dashboard-sources.ts`](#test-02--fixture-adapter-wisenet--dashboardsources). New `describe("wisenet parity", ...)` block in `dashboard-logic.test.ts`; assertion bodies unchanged. |
| TEST-03 | Cache-invalidation regression test: write → subsequent read reflects write | [DEFER TO PHASE 3 with justification (recommended)](#test-03--cache-invalidation-regression-test-placement-decision). Phase 2 caching infrastructure doesn't exist yet (D-23 says no cache in Phase 2). Testing against the doomed Sheets path is wasted work. Phase 3 Cutover adds `use cache: remote` — TEST-03 lands naturally there. |
| TEST-05 | Zod boundary tests: given Wisenet returning `"2"` for credit balance, system treats as `2` | [Part of WCLI-06 fixture suite](#test-05--zod-coercion-tests). Parametric `describe.each([{raw: "2", expected: 2}, {raw: 2, expected: 2}, {raw: "2.5", expected: 2.5}, {raw: null, expected: 0}, ...])` targeting `z.coerce.number()` + derived mapper outputs. |

</phase_requirements>

## Standard Stack

### Core (npm versions VERIFIED 2026-04-21 via `npm view`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@neondatabase/serverless` | `^1.1.0` | Neon Postgres driver (HTTP + WebSocket) [VERIFIED: npm view] | HTTP mode = zero pool overhead on Fluid, fastest cold start. WebSocket Pool needed for transactions. One package, two transports. |
| `drizzle-orm` | `^0.45.2` | TS-first ORM with `neon-http` + `neon-serverless` drivers [VERIFIED: npm view] | No engine binary (unlike Prisma). Plain-TS schema. Auto-typed queries. Generates plain SQL migrations for PR review. |
| `drizzle-kit` | `^0.31.10` | Migration generator + CLI (dev-dependency) [VERIFIED: npm view] | Generates SQL from TS schema. `drizzle-kit migrate` also applies. Idempotent via `__drizzle_migrations`. |
| `zod` | `^3.25.x` [PIN TO v3, NOT v4] | Runtime validation at Wisenet boundary | **Note:** Zod 4.3.6 is current but has breaking API changes. v3 (`^3.25`) is still maintained and stable; this project uses v3 idioms throughout (`z.coerce.*`, `z.enum([...])`, `.transform(...)`). Upgrade to v4 is a v2 refactor. |
| `@vercel/functions` | `^3.4.3` | `attachDatabasePool` + `getEnv` + `invalidateByTag` [VERIFIED: npm view + Vercel docs 2026-04-21] | Required for WebSocket `Pool` under Fluid Compute. Tells Fluid to release idle clients before suspending instance. |
| `p-limit` | `^7.3.0` | Concurrency cap for teacher-feedback N+1 fan-out [VERIFIED: npm view] | ESM-only as of v7. D-19 sets concurrency 5. |

**Version verification note:** STACK.md (written 2026-04-20) pinned `drizzle-orm@^0.38`, `drizzle-kit@^0.30`, `zod@^3.23`. Today's live npm shows 0.45.2 / 0.31.10 / 3.25+ / 4.3.6. The bumps are NON-BREAKING for our usage (peer-compat range of drizzle-orm 0.45 accepts `@neondatabase/serverless >= 0.10.0`). [VERIFIED: `npm view drizzle-orm@0.45 peerDependencies`]

### Dev Tools (retained from existing stack)

| Tool | Purpose | Notes |
|------|---------|-------|
| `vitest` 3.2.4 | Unit + integration tests | Keep as-is. Patterns from `actions-route.test.ts` (vi.mock feature modules, vi.stubGlobal fetch). |
| `tsx` 4.20.3 | Run TypeScript scripts | Reused for `scripts/db-migrate.ts`, `scripts/seed-admin-ownership.ts`. Same shebang pattern as `web/scripts/compare-live.ts`. |
| `typescript` 5.9.3 | Types | No change. `ES2022` target, strict mode. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Drizzle ORM | Prisma | Prisma engine binary inflates cold start. Needs `@prisma/adapter-neon` extra layer. Only wins if we needed Prisma Studio, which D-23-style "remote-cache first" doesn't justify. |
| Drizzle ORM | Kysely | Pure SQL builder without schema codegen or Studio. Drizzle's schema-as-TS + drizzle-kit migration flow is a bigger win for a single-schema app. |
| `@neondatabase/serverless` HTTP | `pg` + `DATABASE_URL_UNPOOLED` | Connection overhead on Fluid; pool tuning debt per Pitfall 4. Only if we need LISTEN/NOTIFY (we don't). |
| Custom fetch client | `ky` / `ofetch` | 7 endpoints don't justify a library. Custom gives one chokepoint for Zod and keeps `WisenetError` redaction local. |
| Zod v4 | Zod v3 | v4 has breaking changes (`.email()`, `.ip()`, etc. moved to `z.email()`/`z.ip()`). v3 works today; upgrade is a v2 story. |
| p-limit | `promise-pool-executor` / custom `Promise.all` with slice | p-limit is the canonical tiny lib for this pattern. 1 dep, 2kB. |

**Installation:**
```bash
# From web/ directory
npm install @neondatabase/serverless@^1.1.0 drizzle-orm@^0.45.2 zod@^3.25.0 @vercel/functions@^3.4.3 p-limit@^7.3.0
npm install -D drizzle-kit@^0.31.10

# Do NOT uninstall googleapis in Phase 2 (Phase 3 removes it)
```

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions only)

```
web/
├── src/
│   ├── lib/
│   │   ├── wisenet/                    # NEW — parallel to existing lib/sheets/
│   │   │   ├── client.ts               # wisenetFetch<T> chokepoint + auth + retry
│   │   │   ├── endpoints.ts            # 7 resource functions (single-file per D-26)
│   │   │   ├── types.ts                # Zod schemas + z.infer<typeof> TS types
│   │   │   ├── mappers.ts              # Wisenet → DashboardSources transforms
│   │   │   └── retry.ts                # 429-detect + exp backoff helper
│   │   ├── db/                         # NEW
│   │   │   ├── schema.ts               # Drizzle pgTable definitions (4 tables)
│   │   │   ├── client.ts               # HTTP db (default): drizzle(neon(DATABASE_URL))
│   │   │   ├── bulk-client.ts          # WebSocket bulkDb (lazy): Pool + attachDatabasePool
│   │   │   └── queries.ts              # Typed query functions (DB-04)
│   │   └── runtime/
│   │       └── env.ts                  # MODIFIED — add getWisenetEnv(), getDbEnv()
│   └── test/
│       ├── fixtures/
│       │   └── wisenet/                # NEW — copied from .planning per D-04
│       │       ├── students_list_page1.json
│       │       ├── student_detail_sample.json
│       │       ├── enrolment_detail_sample.json
│       │       ├── past_sessions_sample.json
│       │       ├── upcoming_sessions_sample.json
│       │       └── credit_balance_sample.json
│       ├── helpers/
│       │   └── wisenet-to-dashboard-sources.ts  # NEW — TEST-02 adapter per D-24
│       ├── wisenet-mappers.test.ts     # NEW — WCLI-06 fixture-driven mapper tests
│       ├── wisenet-client.test.ts      # NEW — WCLI-01 auth + retry + timeout tests
│       ├── db-queries.test.ts          # NEW — DB-04 query tests (Drizzle mock)
│       ├── packages.test.ts            # NEW — TEST-01 port #1 (packages domain)
│       ├── projection.test.ts          # NEW — TEST-01 port #2 (projection domain)
│       ├── pending-deduction.test.ts   # NEW — TEST-01 port #3 (pending-deduction domain)
│       ├── queue.test.ts               # NEW — TEST-01 port #4 (queue domain)
│       ├── calendar.test.ts            # NEW — TEST-01 port #5 (calendar domain)
│       └── dashboard-logic.test.ts     # MODIFIED — add `describe("wisenet parity", ...)` block per D-24
├── drizzle/                            # NEW — drizzle-kit output folder
│   ├── 0000_initial.sql                # Generated from schema.ts
│   └── meta/
│       └── _journal.json
├── drizzle.config.ts                   # NEW
├── scripts/
│   ├── db-migrate.ts                   # NEW — tsx migration runner (DB-08)
│   └── seed-admin-ownership.ts         # NEW — one-off cutover seed (D-21)
├── .github/
│   └── workflows/
│       └── db-migrate.yml              # NEW — CI migration gate (D-22)
└── package.json                        # MODIFIED — add db:generate/db:migrate/db:seed-admin scripts + new deps
```

### Pattern 1: Facade-unchanged, providers-swappable

**What:** Phase 2 adds new modules alongside old (`lib/wisenet/*` beside `lib/sheets/*`, `lib/db/*` beside `lib/cache/memory-cache.ts`). Neither is wired into `service.ts` — that happens in Phase 3.

**When to use:** Data-provider migration where you want tests to pass against BOTH providers before cutover.

**Example:**
```typescript
// Phase 2 — add without removing. Phase 3 swaps the import in service.ts.
// web/src/lib/wisenet/mappers.ts
export async function toDashboardSources(
  wisenetData: WisenetFixtureSet,
): Promise<DashboardSources> {
  // ... transforms Wisenet JSON into the same shape service.ts expects today
}

// web/src/lib/sheets/source-loader.ts — UNCHANGED in Phase 2
// web/src/lib/dashboard/service.ts — UNCHANGED in Phase 2
```

**Source:** Pattern 4 in `.planning/research/ARCHITECTURE.md` (module-swap PRs, not feature flags).

### Pattern 2: Zod chokepoint — single fetch wrapper

**What:** `wisenetFetch<T>(path, schema, init)` is the ONE place network bytes become typed objects. Every Wisenet response goes through a Zod schema before any code sees it.

**When to use:** External API with unverified field types. Mitigates Pitfall 2 (silent type coercion).

**Example:**
```typescript
// web/src/lib/wisenet/client.ts
import { z } from "zod";
import { getWisenetEnv } from "@/lib/runtime/env";
import { retryOn429 } from "./retry";

export async function wisenetFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const env = getWisenetEnv();
  const url = new URL(path, env.baseUrl);

  const response = await retryOn429(() =>
    fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: buildAuthHeaders(env, init.headers),
    }),
  );

  if (!response.ok) {
    const body = await response.text();
    throw new WisenetError(response.status, path, redactBody(body));
  }

  const json = await response.json();
  return schema.parse(json);  // <-- Zod throws on drift; caller catches at route boundary
}
```

**Source:** Aligned with `.planning/research/PITFALLS.md` §Pitfall 2 (silent type coercion).

### Pattern 3: HTTP default, WebSocket Pool for atomicity

**What:** `db` is the default Drizzle client wrapping `@neondatabase/serverless`'s HTTP transport. `bulkDb` is a lazy-initialized WebSocket Pool client reserved for `api/actions/bulk/route.ts` transactions.

**When to use:** Default reads + single-statement writes on HTTP (zero pool overhead); multi-statement transactions on WebSocket (true atomicity).

**Example:**
```typescript
// web/src/lib/db/client.ts — DEFAULT (HTTP, no pool)
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getDbEnv } from "@/lib/runtime/env";

const sql = neon(getDbEnv().DATABASE_URL);
export const db = drizzle({ client: sql });

// web/src/lib/db/bulk-client.ts — LAZY (WebSocket Pool, max:3 singleton)
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { attachDatabasePool } from "@vercel/functions";
import ws from "ws"; // Node runtime needs explicit ws constructor

declare global {
  // eslint-disable-next-line no-var
  var __bgBulkPool: Pool | undefined;
}

function getBulkPool(): Pool {
  if (globalThis.__bgBulkPool) return globalThis.__bgBulkPool;
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // pooled URL is fine for WebSocket
    max: 3,
    idleTimeoutMillis: 30_000,
  });
  attachDatabasePool(pool);
  globalThis.__bgBulkPool = pool;
  return pool;
}

export function getBulkDb() {
  return drizzle({ client: getBulkPool() });
}
```

**Source:** Drizzle docs (`drizzle()` accepts `{ client }` config per https://orm.drizzle.team/docs/get-started/neon-new, verified 2026-04-21); Vercel `attachDatabasePool` docs (verified same day).

### Pattern 4: Retry on 429 only — no header parsing

**What:** The retry wrapper catches responses where `res.status === 429` and retries with exponential backoff (1s → 2s → 4s → 8s, capped at 4 attempts). Does NOT read `Retry-After` or `X-RateLimit-*` because Phase 1 confirmed Wisenet emits neither header.

**When to use:** Rate-limited API without standard rate-limit headers.

**Example:**
```typescript
// web/src/lib/wisenet/retry.ts
const DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

export async function retryOn429<T extends Response>(
  fn: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt <= DELAYS_MS.length; attempt++) {
    const response = await fn();
    if (response.status !== 429) return response;
    if (attempt === DELAYS_MS.length) return response; // give up; caller sees 429
    await sleep(DELAYS_MS[attempt]);
  }
  // Unreachable
  throw new Error("retry exhausted");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Source:** D-17 Phase 1 lock + `.planning/research/fixtures/wisenet/_rate-limit-fingerprint.json` (200-burst returned zero 429s and no headers).

### Anti-Patterns to Avoid

- **Hand-rolled pg.Pool per route:** Per-invocation `new Pool()` bypasses singleton, blows connection count under Fluid burst. [VERIFIED: PITFALLS.md §Pitfall 4]
- **Running migrations in `instrumentation.ts` / `postbuild`:** Fluid instances race; N migrations concurrent. DB-08 is explicit about CI-job-only. [VERIFIED: ARCHITECTURE.md Anti-Pattern 6]
- **Importing `lib/wisenet/*` from `lib/sheets/*` or vice versa:** Both paths must stay isolated in Phase 2 so Phase 3 can delete `lib/sheets/*` cleanly.
- **Using Wisenet API from a client component:** Would bundle `WISENET_API_KEY` into browser. `lib/wisenet/*` must never be imported from any `"use client"` file.
- **Caching Wisenet reads in Phase 2:** D-23 says NO. Production still reads from Sheets (cached there); adding a Phase 2 wrapper Phase 3 throws away is thrashing.
- **Writing schema migrations in Phase 3:** DB-02 lands the initial migration in Phase 2. Phase 3 only has the seed script; schema is locked from Phase 2.
- **`z.string()` for Wisenet numeric fields:** Use `z.coerce.number()` even when the fixture shows a number — Pitfall 2 says servers may stringify.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Postgres connection pool | Custom `pg.Pool` wrapper | `@neondatabase/serverless` Pool + `attachDatabasePool` | Fluid Compute instance-reuse + idle-client release is a moving target; let Vercel maintain it. |
| Schema migrations | Hand-rolled SQL files + `psql` runner | `drizzle-kit generate` + `drizzle-kit migrate` | Idempotency via `__drizzle_migrations`, schema-diff drift detection, plain SQL output for PR review. |
| Rate-limit backoff | Loop with `setTimeout` + ad-hoc multiplier | `retryOn429` helper with explicit delay array | Centralizes the delay schedule; unit-testable; matches the 1s→2s→4s→8s cap. |
| JSON schema validation | `typeof x === "number"` checks | Zod schemas with `.coerce.*` + `.transform(...)` | TypeScript types are compile-time; Zod is runtime. Pitfall 2 says external APIs lie. |
| Admin majority-vote calculation | Reimplement in TypeScript | Call `clasp run buildStudentAdminOwnershipMap` from seed script | The Apps Script function already works and feeds prod today. TS re-implementation doesn't happen until Phase 3 WCLI-04. |
| Parent-name lookup cache | In-process Map with expiry | Scoped per-`getStudents`-page closure in mapper | Phase 2 D-23 says no cache. Phase 3 may upgrade to `use cache: remote`. |
| Concurrency-bounded fan-out | Manual promise slicing | `p-limit(5)` from p-limit package | 2kB single-purpose lib; D-19 sets limit at 5. |
| UUID generation for `follow_up_log.event_id` | `crypto.randomUUID()` in TS | Postgres `gen_random_uuid()` default | Keeps client code simpler; one fewer thing to get wrong in bulk writes. |

**Key insight:** Every library above replaces a 20-100 line custom implementation with a battle-tested dependency. None add significant bundle weight; all have 1M+ weekly downloads. "Don't hand-roll" in Phase 2 is about preserving review focus for the business-logic-mapper branches (where the real bugs live).

## Common Pitfalls

### Pitfall 1: Zod type coercion drift (Pitfall 2 inherited)

**What goes wrong:** Wisenet returns `"3600000"` as a string; mapper calls `duration / 60000` expecting a number; result is `NaN` silently propagated into `PendingDeductionDetail.sessionDurationMin`.

**Why it happens:** Zod types ARE validated (schema.parse throws on string for a `z.number()`), but coercion uses `z.coerce.number()` which CONVERTS strings. If a fixture happens to carry a number, test passes; prod drift would break silently without coercion.

**How to avoid:** Use `z.coerce.number()` at EVERY numeric boundary, even when fixtures show integers. TEST-05 asserts this with parametric `describe.each([{raw: "2", expected: 2}, {raw: 2, expected: 2}, ...])`.

**Warning signs:** Any Zod schema using `z.number()` without `.coerce`. Any mapper doing arithmetic on a field without passing through a coerced schema first.

### Pitfall 2: N+1 teacher-feedback fan-out hits rate limits

**What goes wrong:** Fetching `showFeedbackSubmission=true` per past session issues N requests for N sessions; at 500 students × 10 past sessions = 5000 requests = likely rate limit trigger.

**Why it happens:** Phase 1 probe confirmed teacher_feedback is NOT on the sessions list shape; per-session detail fetch is inherent.

**How to avoid:** Pre-filter on `meetingStatus === "ENDED"` first (D-19) — reduces N by ~50-70% based on `past_sessions_sample.json` enum distribution. Cap concurrency at `p-limit(5)` (D-19). Phase 2 measurement can raise limit if safe, but start conservative.

**Warning signs:** Dashboard load time growing linearly with session count. 429s in `vercel logs` correlating with bulk mapper calls.

### Pitfall 3: Drizzle migration on PgBouncer URL fails

**What goes wrong:** `drizzle-kit migrate` against the pooled `DATABASE_URL` hits PgBouncer limitations — no advisory locks, no `CREATE EXTENSION`, no prepared statements with named locks.

**Why it happens:** Pooled URL is for runtime transactional queries; migrations need direct Postgres features.

**How to avoid:** `scripts/db-migrate.ts` uses `DATABASE_URL_UNPOOLED` (the direct Neon URL). Runtime HTTP/WebSocket uses the pooled `DATABASE_URL`.

**Warning signs:** Migration fails with "prepared statement does not exist" or "cannot use advisory lock" errors. CI migration workflow uses wrong env var.

### Pitfall 4: Bulk transaction spans HTTP client (impossible)

**What goes wrong:** Someone writes `db.transaction(...)` using the HTTP client; Drizzle rejects at runtime because HTTP transport doesn't support BEGIN/COMMIT spanning multiple statements.

**Why it happens:** Confusion about HTTP vs WebSocket capabilities. `neon()` HTTP is single-statement-per-request.

**How to avoid:** D-25 locks the WebSocket Pool for bulk. Code review for `api/actions/bulk/route.ts`: `bulkDb.transaction(...)` only, `db.transaction(...)` rejected. Lint rule option: ban `db.transaction` from route handler files via ESLint `no-restricted-imports`.

**Warning signs:** Any call to `.transaction(...)` on the HTTP `db` client. Bulk routes that don't import from `@/lib/db/bulk-client`.

### Pitfall 5: Stale parent-name cache across paginated getStudents calls

**What goes wrong:** Mapper caches `parentId → name` in a closure on page 1; page 2 has new parentIds; second `/parents` call is made; but stale entries linger and pollute memory if the mapper reuses the cache.

**Why it happens:** D-18 says batch is scoped per-`getStudents` page — but implementer assumes "memoize across calls."

**How to avoid:** Create a NEW `Map<parentId, parentName>` inside each mapper call. Don't elevate the cache to module scope in Phase 2. Phase 3 gets a proper cache layer.

**Warning signs:** `module.exports.parentNameCache` or similar. Cache mutated at top level of `mappers.ts`.

### Pitfall 6: `Validation.gs` port drops Should_Credit tests without rewriting equivalents

**What goes wrong:** D-05 says drop the 3-5 Should_Credit-coupled assertions. If the whole test function is deleted without considering whether it ALSO exercised the `session_duration` fallback, coverage evaporates in the shared branch.

**Why it happens:** Per D-20, the mapping must distinguish "this test exists to exercise Should_Credit priority" (drop) from "this test uses Should_Credit as input but validates the session_duration fallback" (rewrite inputs, keep the test).

**How to avoid:** The port assignment table below (see TEST-01 section) explicitly flags each of the ~5 Should_Credit-touching tests: `testPendingDeductionUsesShouldCreditWhenAvailable` = DROP (its entire reason for existing is the priority branch); `testPendingDeductionFallsBackToDurationWhenShouldCreditMissing` = REWRITE (exists to exercise the fallback; rewrite inputs so Should_Credit is always absent/zero); `testConsumedCreditsDoNotDoubleDeduct` = REWRITE (exercises the shared code path; rewrite to use duration-only inputs).

**Warning signs:** Phase 2 port PR deletes 5 assertions without adding corresponding rewrites for the shared code paths.

### Pitfall 7: Fixture adapter relies on network-backed mapper

**What goes wrong:** `toDashboardSources(wisenetFixtures)` calls mappers that internally issue `fetch` for parent names or teacher feedback; test hangs waiting for a nonexistent network.

**Why it happens:** D-19 says mappers have an option to skip teacher-feedback fetch for tests. D-18 batches the parent fetch via `getParents` — which is also a real network call.

**How to avoid:** The fixture adapter signature per D-24 is `(wisenetFixtures: WisenetFixtureSet)` where `WisenetFixtureSet` CONTAINS pre-fetched `parents` and `teacherFeedbackByClassAndSession` maps. The adapter feeds those into mappers directly, bypassing network. Mappers accept an optional `prefetched` parameter.

**Warning signs:** `toDashboardSources` test timing out. Mappers unconditionally call `fetch` even when given prefetched data.

## Code Examples

### WCLI-01 — `client.ts` (authenticated fetch wrapper)

```typescript
// web/src/lib/wisenet/client.ts
// Source: Phase 1 _auth-fingerprint.json + STACK.md §Wisenet client skeleton
import type { z } from "zod";
import { getWisenetEnv, type WisenetEnv } from "@/lib/runtime/env";
import { retryOn429 } from "./retry";

const USER_AGENT = "begifted-ops-wisenet/1.0";
const TIMEOUT_MS = 15_000;

let cachedAuthHeader: string | null = null; // memoized Basic auth

export class WisenetError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly redactedBody: string,
  ) {
    super(`Wisenet ${status} at ${path}`);
    this.name = "WisenetError";
  }
}

function buildAuthHeader(env: WisenetEnv): string {
  if (cachedAuthHeader) return cachedAuthHeader;
  const creds = `${env.WISENET_USER_ID}:${env.WISENET_API_KEY}`;
  cachedAuthHeader = `Basic ${Buffer.from(creds, "utf-8").toString("base64")}`;
  return cachedAuthHeader;
}

function buildHeaders(env: WisenetEnv, override?: HeadersInit): Headers {
  const headers = new Headers({
    "Authorization": buildAuthHeader(env),
    "x-api-key": env.WISENET_API_KEY,
    "x-wise-namespace": env.WISENET_NAMESPACE,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "user-agent": USER_AGENT,
  });
  if (override) new Headers(override).forEach((v, k) => headers.set(k, v));
  return headers;
}

// Key-based + value-based redaction of 4xx/5xx bodies before attaching to WisenetError
const REDACT_KEYS = /"(email|phone|loginPin|displayIdentifier|answer|notes)":\s*"[^"]*"/g;
function redactBody(raw: string): string {
  return raw.replace(REDACT_KEYS, (_match, key) => `"${key}":"<REDACTED>"`).slice(0, 500);
}

export async function wisenetFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const env = getWisenetEnv();
  const url = new URL(path, env.WISENET_BASE_URL);

  const response = await retryOn429(() =>
    fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: buildHeaders(env, init.headers),
    }),
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new WisenetError(response.status, path, redactBody(body));
  }

  const json = await response.json();
  return schema.parse(json);
}
```

### WCLI-02 — `types.ts` (Zod schemas and TS types)

Representative schemas — not exhaustive. Full set in Phase 2 tasks.

```typescript
// web/src/lib/wisenet/types.ts
// Source: Phase 1 fixtures — students_list_page1.json, past_sessions_sample.json, etc.
import { z } from "zod";

// Envelope common to all Wisenet responses
const EnvelopeSchema = <T extends z.ZodType>(inner: T) =>
  z.object({
    status: z.coerce.number(),
    message: z.coerce.string(),
    data: inner,
  });

// --- Students list ---
export const WisenetStudentSchema = z.object({
  _id: z.coerce.string(),
  name: z.coerce.string().trim(),
  email: z.coerce.string().optional(),
  uuid: z.coerce.string(),
  activated: z.coerce.boolean(),
  joinedOn: z.coerce.date().optional(),
  tags: z.array(z.coerce.string()).default([]),
  parents: z.array(z.unknown()).default([]), // always empty on list; see parent resolution in mappers
  classrooms: z.array(z.object({
    _id: z.coerce.string(),
    name: z.coerce.string(),
    subject: z.coerce.string(),
    classType: z.coerce.string().optional(),
  })).default([]),
});
export const WisenetStudentsListSchema = EnvelopeSchema(z.object({
  students: z.array(WisenetStudentSchema),
  count: z.coerce.number().default(0),
}));
export type WisenetStudent = z.infer<typeof WisenetStudentSchema>;

// --- Student detail (for parentIds) ---
export const WisenetStudentDetailSchema = EnvelopeSchema(z.object({
  user: z.object({
    _id: z.coerce.string(),
    name: z.coerce.string(),
    parentIds: z.array(z.coerce.string()).default([]),
  }),
  registrationData: z.object({
    fields: z.array(z.object({
      questionId: z.coerce.string(),
      answer: z.coerce.string().optional(),
    })).default([]),
  }).optional(),
}));

// --- Parents (2-step join per D-18) ---
export const WisenetParentSchema = z.object({
  _id: z.coerce.string(),
  name: z.coerce.string().trim(),
});
export const WisenetParentsListSchema = EnvelopeSchema(z.object({
  parents: z.array(WisenetParentSchema),
}));

// --- Sessions (past + upcoming same shape) ---
export const MeetingStatusSchema = z.enum(["ENDED", "CANCELLED", "UPCOMING", "IN_PROGRESS"]);
export const WisenetSessionSchema = z.object({
  _id: z.coerce.string(),
  classId: z.object({
    _id: z.coerce.string(),
    name: z.coerce.string(),
    subject: z.coerce.string(),
  }),
  userId: z.object({
    _id: z.coerce.string(),
    name: z.coerce.string(),
  }),
  scheduledStartTime: z.coerce.date(),
  scheduledEndTime: z.coerce.date().optional(),
  meetingStatus: MeetingStatusSchema,
  duration: z.coerce.number(), // milliseconds; transform to minutes at mapper boundary
  students: z.array(z.coerce.string()).default([]),
  teacherFeedback: z.coerce.string().optional(), // only on detail-fetch response
});
export const WisenetSessionsListSchema = EnvelopeSchema(z.object({
  sessions: z.array(WisenetSessionSchema),
  count: z.coerce.number().default(0),
}));

// --- Class detail (for Package/Program name + Class Subject) ---
export const WisenetClassSchema = EnvelopeSchema(z.object({
  _id: z.coerce.string(),
  name: z.coerce.string(),
  subject: z.coerce.string(),
}));

// --- sessionCredits (optional — may 400; schema defined for when it resolves) ---
export const WisenetSessionCreditsSchema = EnvelopeSchema(z.object({
  total: z.coerce.number().optional(),
  remaining: z.coerce.number().optional(),
  consumed: z.coerce.number().optional(),
}));
```

### WCLI-03 — `endpoints.ts` (resource functions)

```typescript
// web/src/lib/wisenet/endpoints.ts
// Source: WISENET_ENDPOINTS.md + Phase 1 CONTEXT.md path-typo fix
import { getWisenetEnv } from "@/lib/runtime/env";
import { wisenetFetch } from "./client";
import {
  WisenetStudentsListSchema,
  WisenetStudentDetailSchema,
  WisenetParentsListSchema,
  WisenetSessionsListSchema,
  WisenetClassSchema,
  WisenetSessionCreditsSchema,
  type WisenetStudent,
} from "./types";

const PAGE_SIZE = 50;

function encodeCenter(): string {
  return encodeURIComponent(getWisenetEnv().WISENET_CENTER_ID);
}

// Paginated iterator — terminates when records.length < page_size (Phase 1 D-xx)
async function* paginate<T>(
  pathBuilder: (page: number) => string,
  extractor: (raw: unknown) => { items: T[]; count?: number },
  schema: Parameters<typeof wisenetFetch>[1],
): AsyncGenerator<T[]> {
  let page = 1;
  while (true) {
    const response = await wisenetFetch(pathBuilder(page), schema);
    const { items } = extractor(response);
    yield items;
    if (items.length < PAGE_SIZE) return;
    page += 1;
  }
}

export async function getStudents(): Promise<WisenetStudent[]> {
  const all: WisenetStudent[] = [];
  // NOTE: path uses /institutes/v3/{center}/students (no trailing `s` on {center} — Postman catalogue typo)
  const pathBuilder = (p: number) =>
    `/institutes/v3/${encodeCenter()}/students?page_number=${p}&page_size=${PAGE_SIZE}`;
  for await (const batch of paginate(
    pathBuilder,
    (r: any) => ({ items: r.data.students, count: r.data.count }),
    WisenetStudentsListSchema,
  )) {
    all.push(...batch);
  }
  return all;
}

export async function getStudent(studentId: string) {
  return wisenetFetch(
    `/institutes/${encodeCenter()}/participants/${encodeURIComponent(studentId)}?showRegistrationData=true`,
    WisenetStudentDetailSchema,
  );
}

// Batched — collects unique parentIds, returns id→name map (per D-18)
export async function getParents(parentIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(parentIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  // Wisenet /parents accepts comma-separated ids per catalogue
  const path = `/institutes/${encodeCenter()}/parents?ids=${unique.map(encodeURIComponent).join(",")}`;
  const response = await wisenetFetch(path, WisenetParentsListSchema);
  return new Map(response.data.parents.map((p) => [p._id, p.name]));
}

export async function getClass(classId: string) {
  return wisenetFetch(
    `/user/v2/classes/${encodeURIComponent(classId)}?full=true`,
    WisenetClassSchema,
  );
}

export async function getPastSessions(startDate: Date, endDate: Date) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const pathBuilder = (p: number) =>
    `/institutes/${encodeCenter()}/sessions?status=PAST&paginateBy=DATE&startDate=${fmt(startDate)}&endDate=${fmt(endDate)}&page_number=${p}&page_size=${PAGE_SIZE}`;
  const all = [];
  for await (const batch of paginate(
    pathBuilder,
    (r: any) => ({ items: r.data.sessions }),
    WisenetSessionsListSchema,
  )) {
    all.push(...batch);
  }
  return all;
}

export async function getUpcomingSessions(startDate: Date, endDate: Date) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const pathBuilder = (p: number) =>
    `/institutes/${encodeCenter()}/sessions?status=FUTURE&paginateBy=DATE&startDate=${fmt(startDate)}&endDate=${fmt(endDate)}&page_number=${p}&page_size=${PAGE_SIZE}`;
  const all = [];
  for await (const batch of paginate(
    pathBuilder,
    (r: any) => ({ items: r.data.sessions }),
    WisenetSessionsListSchema,
  )) {
    all.push(...batch);
  }
  return all;
}

export async function getSessionCredits(classId: string, resolvedStudentId: string) {
  // NOTE: expects participant-resolved student_id, NOT session.userId._id — per Phase 1 D-08 note
  return wisenetFetch(
    `/institutes/${encodeCenter()}/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(resolvedStudentId)}/sessionCredits?fetchHistory=true`,
    WisenetSessionCreditsSchema,
  );
}
```

### WCLI-04 — `mappers.ts` (Wisenet → DashboardSources)

The full mapper is the largest file in Phase 2; here are the core branches. Each branch maps to a field-map row (RED/YELLOW/GREEN).

```typescript
// web/src/lib/wisenet/mappers.ts
// Source: WISENET_FIELD_MAP.md per-row decisions
import pLimit from "p-limit";
import { getClass, getParents, getPastSessions, getStudent, getStudents, getUpcomingSessions } from "./endpoints";
import type { WisenetStudent } from "./types";
import type { DashboardSources, SheetSnapshot } from "@/lib/dashboard/domain";

const TEACHER_FEEDBACK_CONCURRENCY = 5; // D-19

export interface MapperOptions {
  /** When true, mapper skips teacher-feedback fan-out. Default: true in tests, false in Phase 3 prod. */
  skipTeacherFeedback?: boolean;
  /** When provided, mapper uses these prefetched maps instead of hitting network. Tests pass this. */
  prefetched?: {
    parentsById?: Map<string, string>;
    teacherFeedbackBySessionId?: Map<string, string>;
  };
}

/** meetingStatus → legacy final_status enum (YELLOW row, Credit_Control/final_status) */
export function coerceMeetingStatusToFinalStatus(meetingStatus: string): string {
  // Apps Script legacy values were literally "ENDED" / "CANCELLED" / similar — pass-through
  return meetingStatus.toUpperCase();
}

/** duration ms → minutes (GREEN row; transform at mapper, not schema, for precision) */
export function durationMsToMinutes(durationMs: number): number {
  return Math.round(durationMs / 60_000); // integer minutes
}

/** 2-step parent resolution (YELLOW row per D-18) */
export async function resolveParentNames(
  students: WisenetStudent[],
  options: MapperOptions = {},
): Promise<Map<string, string>> {
  if (options.prefetched?.parentsById) return options.prefetched.parentsById;

  const allParentIds: string[] = [];
  // students-list fixture doesn't have parentIds; need detail fetch per student
  // (This is slow but Phase 2 doesn't cache. Phase 3 wraps in use cache: remote.)
  const limit = pLimit(TEACHER_FEEDBACK_CONCURRENCY);
  const details = await Promise.all(
    students.map((s) => limit(() => getStudent(s._id))),
  );
  details.forEach((detail) => {
    allParentIds.push(...(detail.data.user.parentIds ?? []));
  });
  return getParents([...new Set(allParentIds)]);
}

/** parent name lookup with "missing-parent" fallback (matches buildDashboardStudentKey convention) */
export function lookupParentName(
  parentIds: string[],
  parentNamesById: Map<string, string>,
): string {
  const first = parentIds[0];
  if (!first) return ""; // empty -> helpers/buildDashboardStudentKey substitutes "missing-parent"
  return parentNamesById.get(first) ?? "";
}

/** teacher-feedback fan-out with ENDED pre-filter (D-19) */
export async function fetchTeacherFeedback(
  pastSessions: Awaited<ReturnType<typeof getPastSessions>>,
  options: MapperOptions = {},
): Promise<Map<string, string>> {
  if (options.skipTeacherFeedback) return new Map();
  if (options.prefetched?.teacherFeedbackBySessionId) return options.prefetched.teacherFeedbackBySessionId;

  const endedSessions = pastSessions.filter((s) => s.meetingStatus === "ENDED");
  const limit = pLimit(TEACHER_FEEDBACK_CONCURRENCY);
  const results = await Promise.all(
    endedSessions.map((s) =>
      limit(async () => {
        // Detail fetch with showFeedbackSubmission=true
        const response = await wisenetFetch(
          `/user/classes/${encodeURIComponent(s.classId._id)}/sessions/${encodeURIComponent(s._id)}?showFeedbackConfig=true&showFeedbackSubmission=true`,
          SessionDetailSchema, // TODO define; extracts teacherFeedback field
        );
        return [s._id, response.data.teacherFeedback ?? ""] as const;
      }),
    ),
  );
  return new Map(results);
}

/** Credit balance derivation — RED row per D-07 (derive from past_sessions.duration) */
export function deriveRemainingCredits(
  sessionsForStudentClass: Array<{ meetingStatus: string; duration: number }>,
  purchasedCredits: number,
): number {
  const consumed = sessionsForStudentClass
    .filter((s) => s.meetingStatus === "ENDED")
    .reduce((sum, s) => sum + s.duration / 3_600_000, 0); // ms → hours
  return Math.max(0, purchasedCredits - consumed);
}

/** Pending-deduction composite rule (D-08) */
export function shouldCountAsPendingDeductionWisenet(
  meetingStatus: string,
  teacherFeedback: string,
  durationMs: number,
): boolean {
  const hours = durationMs / 3_600_000;
  return (
    meetingStatus === "ENDED" &&
    teacherFeedback.trim() === "" &&
    hours > 0
  );
}

/** Top-level: build DashboardSources from Wisenet calls */
export async function buildDashboardSourcesFromWisenet(
  today: Date,
  options: MapperOptions = {},
): Promise<DashboardSources> {
  // Orchestrate fetches in parallel where possible
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 90); // past 90 days for balance derivation
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 60); // 60 days future for projection

  const [students, pastSessions, upcomingSessions] = await Promise.all([
    getStudents(),
    getPastSessions(startDate, today),
    getUpcomingSessions(today, endDate),
  ]);

  const parentNamesById = await resolveParentNames(students, options);
  const teacherFeedbackBySessionId = await fetchTeacherFeedback(pastSessions, options);

  // Transform into 6 SheetSnapshot shapes that match REQUIRED_COLUMNS contract
  return {
    aggregations: toAggregationsSnapshot(students, pastSessions, upcomingSessions, parentNamesById),
    creditControl: toCreditControlSnapshot(students, pastSessions, teacherFeedbackBySessionId),
    upcoming: toUpcomingSnapshot(students, upcomingSessions),
    students: toStudentsSnapshot(students),
    studentsCourses: toStudentsCoursesSnapshot(students),
    remainingCredits: toRemainingCreditsSnapshot(students), // admin column populated by DB join in service.ts (Phase 3)
  };
}

// Helper snapshot builders (each ~20-40 lines; full impl in Phase 2 tasks)
function toAggregationsSnapshot(...): SheetSnapshot { /* ... */ }
function toCreditControlSnapshot(...): SheetSnapshot { /* ... */ }
function toUpcomingSnapshot(...): SheetSnapshot { /* ... */ }
function toStudentsSnapshot(...): SheetSnapshot { /* ... */ }
function toStudentsCoursesSnapshot(...): SheetSnapshot { /* ... */ }
function toRemainingCreditsSnapshot(...): SheetSnapshot { /* ... */ }
```

### WCLI-05 — Zod boundary and coercion (Pitfall 2 mitigation)

Already embedded above. Summary of the coercion rules:

| Wisenet type | Zod schema | Rationale |
|--------------|-----------|-----------|
| `string` (display) | `z.coerce.string().trim()` | Strip whitespace |
| `string` (enum) | `z.enum(["ENDED","CANCELLED","UPCOMING","IN_PROGRESS"])` | Strict enum |
| `number` (integer or float) | `z.coerce.number()` | Handles `"2"` → `2` |
| `number` (duration in ms → minutes) | `z.coerce.number().transform(ms => ms / 60_000)` | Applied at mapper, not schema (keeps raw ms on boundary) |
| ISO 8601 datetime | `z.coerce.date()` | Parses into JS Date |
| Boolean | `z.coerce.boolean()` | Handles `"true"`/`"false"`/`"1"`/`"0"` |
| Optional with default | `.default([])` or `.optional()` | Missing fields get a safe default |

### WCLI-06 — Fixture tests

```typescript
// web/src/test/wisenet-mappers.test.ts
// Source: STACK.md §Testing Pattern 1 + D-20 describe.each style
import { beforeEach, describe, expect, it, vi } from "vitest";
import studentsListFixture from "./fixtures/wisenet/students_list_page1.json";
import pastSessionsFixture from "./fixtures/wisenet/past_sessions_sample.json";
import creditBalanceFixture from "./fixtures/wisenet/credit_balance_sample.json";
import {
  coerceMeetingStatusToFinalStatus,
  durationMsToMinutes,
  shouldCountAsPendingDeductionWisenet,
} from "@/lib/wisenet/mappers";

describe("wisenet mappers - field transforms", () => {
  it("coerces meetingStatus ENDED → ENDED", () => {
    expect(coerceMeetingStatusToFinalStatus("ENDED")).toBe("ENDED");
  });
  it("duration ms → minutes (3600000 → 60)", () => {
    expect(durationMsToMinutes(3_600_000)).toBe(60);
  });
});

describe("wisenet mappers - pending-deduction rule (D-08)", () => {
  it.each([
    ["ENDED", "", 3_600_000, true],
    ["ENDED", "Good progress", 3_600_000, false],    // has feedback → not pending
    ["CANCELLED", "", 3_600_000, false],              // not ended → not pending
    ["ENDED", "", 0, false],                          // no duration → not pending
  ])("meetingStatus=%s, feedback=%s, durationMs=%s → %s", (status, fb, dur, expected) => {
    expect(shouldCountAsPendingDeductionWisenet(status, fb, dur)).toBe(expected);
  });
});

describe("wisenet client - error handling", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("surfaces 400 sessionCredits as WisenetError", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify(creditBalanceFixture.body), { status: 400 }),
    );
    const { getSessionCredits } = await import("@/lib/wisenet/endpoints");
    await expect(getSessionCredits("class-id", "student-id")).rejects.toMatchObject({
      status: 400,
      path: expect.stringContaining("/sessionCredits"),
    });
  });

  it("Zod throws when server drifts type (schema guard)", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ status: 200, message: "ok", data: { sessions: [{ duration: "not a number" }] } }), { status: 200 }),
    );
    const { getPastSessions } = await import("@/lib/wisenet/endpoints");
    await expect(getPastSessions(new Date(), new Date())).rejects.toThrow(); // z.coerce.number() fails on "not a number"
  });
});
```

### WCLI-07 — `getWisenetEnv` and `getDbEnv`

```typescript
// web/src/lib/runtime/env.ts — ADDITIONS (existing exports unchanged)
// Source: existing getAuthEnv / getSheetsEnv pattern

export interface WisenetEnv {
  WISENET_BASE_URL: string;
  WISENET_USER_ID: string;
  WISENET_API_KEY: string;
  WISENET_CENTER_ID: string;
  WISENET_NAMESPACE: string;
}

export interface DbEnv {
  DATABASE_URL: string;
  DATABASE_URL_UNPOOLED: string;
}

export function getWisenetEnv(): WisenetEnv {
  return {
    WISENET_BASE_URL: required("WISENET_BASE_URL"),
    WISENET_USER_ID: required("WISENET_USER_ID"),
    WISENET_API_KEY: required("WISENET_API_KEY"),
    WISENET_CENTER_ID: required("WISENET_CENTER_ID"),
    WISENET_NAMESPACE: required("WISENET_NAMESPACE"),
  };
}

export function getDbEnv(): DbEnv {
  return {
    DATABASE_URL: required("DATABASE_URL"),
    DATABASE_URL_UNPOOLED: required("DATABASE_URL_UNPOOLED"),
  };
}
```

### DB-02 — Drizzle schema definitions

```typescript
// web/src/lib/db/schema.ts
// Source: ARCHITECTURE.md §Postgres Schema Sketch + DB-02 exact column list
import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// --- Enums ---
// StudentActionStatus from web/src/types/dashboard.ts::StudentActionStatus
export const studentActionStatusEnum = pgEnum("student_action_status", [
  "contacted",
  "pending-callback",
  "resolved",
]);

export const actionLogTypeEnum = pgEnum("action_log_type", [
  "set",
  "clear",
  "bulk-set",
  "bulk-clear",
]);

// Admin keys from config.ts::ADMIN_OWNER_REGISTRY + UNASSIGNED_ADMIN_KEY
export const adminKeyEnum = pgEnum("admin_key", [
  "palm",
  "kem",
  "care",
  "aya",
  "petchy",
  "muk",
  "unassigned",
]);

// --- Tables ---

export const followUpState = pgTable(
  "follow_up_state",
  {
    studentKey: text("student_key").primaryKey(), // <normalized-student>::<normalized-parent>
    studentName: text("student_name").notNull(),
    parentName: text("parent_name").notNull(),
    status: studentActionStatusEnum("status").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedByEmail: text("updated_by_email").notNull(),
    updatedByName: text("updated_by_name").notNull(),
  },
  (table) => [
    index("follow_up_state_updated_at_idx").on(sql`${table.updatedAt} DESC`),
  ],
);

export const followUpLog = pgTable(
  "follow_up_log",
  {
    eventId: uuid("event_id").primaryKey().defaultRandom(),
    studentKey: text("student_key").notNull(),
    studentName: text("student_name").notNull(),
    parentName: text("parent_name").notNull(),
    actionType: actionLogTypeEnum("action_type").notNull(),
    status: studentActionStatusEnum("status"), // NULL when action_type in ('clear','bulk-clear')
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorEmail: text("actor_email").notNull(),
    actorName: text("actor_name").notNull(),
  },
  (table) => [
    index("follow_up_log_student_key_created_at_idx").on(
      table.studentKey,
      sql`${table.createdAt} DESC`,
    ),
    index("follow_up_log_created_at_idx").on(sql`${table.createdAt} DESC`),
  ],
);

export const inactiveStudents = pgTable("inactive_students", {
  studentKey: text("student_key").primaryKey(),
  studentName: text("student_name").notNull(),
  parentName: text("parent_name").notNull(),
  markedAt: timestamp("marked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  markedByEmail: text("marked_by_email").notNull(),
});

// D-06 — admin ownership sidecar
export const studentAdminOwnership = pgTable(
  "student_admin_ownership",
  {
    studentKey: text("student_key").primaryKey(), // matches follow_up_state.student_key pattern
    adminKey: adminKeyEnum("admin_key").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    assignedByEmail: text("assigned_by_email").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("student_admin_ownership_admin_key_idx").on(table.adminKey)],
);

// TS type helpers for queries (drizzle-orm 0.45+ inference)
export type FollowUpStateRow = typeof followUpState.$inferSelect;
export type FollowUpStateInsert = typeof followUpState.$inferInsert;
export type FollowUpLogRow = typeof followUpLog.$inferSelect;
export type FollowUpLogInsert = typeof followUpLog.$inferInsert;
export type InactiveStudentRow = typeof inactiveStudents.$inferSelect;
export type InactiveStudentInsert = typeof inactiveStudents.$inferInsert;
export type StudentAdminOwnershipRow = typeof studentAdminOwnership.$inferSelect;
export type StudentAdminOwnershipInsert = typeof studentAdminOwnership.$inferInsert;
```

**DB-05 preservation note:** Same-day visibility is NOT in SQL. The `followUpState` schema does not have a "visible today" column. The TS layer (`sanitizeStudentActionState` in existing `web/src/lib/dashboard/actions.ts`) reads `updatedAt` and compares against today at the application boundary. This matches the current Sheets behavior and means the query always returns the full state map; the domain layer filters.

### DB-03 — `db/client.ts` and `bulk-client.ts` (connection pooling)

Already shown in Pattern 3 above. Additional notes:
- **HTTP client** (`db`): No pool, no `attachDatabasePool`. Zero warm-instance cost.
- **WebSocket client** (`bulkDb`): Singleton via `globalThis.__bgBulkPool`, `max:3`, `idleTimeoutMillis: 30_000`. Only reached from `api/actions/bulk/route.ts` (Phase 3 wiring).
- **Environment:** `DATABASE_URL` is the pooled URL (PgBouncer). Both HTTP and WebSocket use it. Migrations use `DATABASE_URL_UNPOOLED`.

### DB-04 — `queries.ts` typed functions

```typescript
// web/src/lib/db/queries.ts
// Source: DB-04 requirement + existing web/src/lib/sheets/actions.ts shape for contract parity
import { eq, desc, and, gte, inArray } from "drizzle-orm";
import { db } from "./client";
import {
  followUpState,
  followUpLog,
  inactiveStudents,
  studentAdminOwnership,
  type FollowUpStateRow,
  type FollowUpStateInsert,
  type FollowUpLogInsert,
} from "./schema";
import type { ActionStateMap } from "@/lib/dashboard/domain";

export async function loadActionStateMap(): Promise<ActionStateMap> {
  const rows = await db.select().from(followUpState);
  const map: ActionStateMap = {};
  for (const row of rows) {
    map[row.studentKey] = {
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
      updatedByName: row.updatedByName,
      isToday: true, // recalculated in domain via sanitizeStudentActionState
    };
  }
  return map;
}

export async function upsertFollowUpState(input: FollowUpStateInsert) {
  return db
    .insert(followUpState)
    .values(input)
    .onConflictDoUpdate({
      target: followUpState.studentKey,
      set: {
        status: input.status,
        updatedAt: new Date(),
        updatedByEmail: input.updatedByEmail,
        updatedByName: input.updatedByName,
        studentName: input.studentName,
        parentName: input.parentName,
      },
    })
    .returning();
}

export async function appendFollowUpLog(input: FollowUpLogInsert) {
  return db.insert(followUpLog).values(input).returning();
}

export async function listInactive() {
  return db.select().from(inactiveStudents);
}

export async function markInactive(input: typeof inactiveStudents.$inferInsert) {
  return db
    .insert(inactiveStudents)
    .values(input)
    .onConflictDoUpdate({
      target: inactiveStudents.studentKey,
      set: { markedAt: new Date(), markedByEmail: input.markedByEmail },
    });
}

export async function clearInactive(studentKey: string) {
  return db.delete(inactiveStudents).where(eq(inactiveStudents.studentKey, studentKey));
}

export async function readHistory(studentKey: string, sinceDays = 7) {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  return db
    .select()
    .from(followUpLog)
    .where(and(eq(followUpLog.studentKey, studentKey), gte(followUpLog.createdAt, since)))
    .orderBy(desc(followUpLog.createdAt));
}

// Admin ownership helpers (DB-04 extension, derived from D-06)
export async function getAdminOwnership(studentKey: string) {
  const [row] = await db
    .select()
    .from(studentAdminOwnership)
    .where(eq(studentAdminOwnership.studentKey, studentKey))
    .limit(1);
  return row ?? null;
}

export async function bulkGetAdminOwnership(studentKeys: string[]) {
  if (studentKeys.length === 0) return new Map();
  const rows = await db
    .select()
    .from(studentAdminOwnership)
    .where(inArray(studentAdminOwnership.studentKey, studentKeys));
  return new Map(rows.map((r) => [r.studentKey, r]));
}
```

### DB-07 — Bulk write atomicity

```typescript
// web/src/lib/db/bulk-queries.ts (or inlined in api/actions/bulk/route.ts — Phase 3 decides)
import { getBulkDb } from "./bulk-client";
import { followUpState, followUpLog } from "./schema";

export interface BulkActionInput {
  updates: Array<{
    studentKey: string;
    studentName: string;
    parentName: string;
    status: "contacted" | "pending-callback" | "resolved";
  }>;
  actorEmail: string;
  actorName: string;
}

export async function bulkSetStudentAction(input: BulkActionInput) {
  const bulkDb = getBulkDb();
  return bulkDb.transaction(async (tx) => {
    // Single round-trip: bulk upsert state + bulk append log
    const stateValues = input.updates.map((u) => ({
      studentKey: u.studentKey,
      studentName: u.studentName,
      parentName: u.parentName,
      status: u.status,
      updatedByEmail: input.actorEmail,
      updatedByName: input.actorName,
    }));
    const logValues = input.updates.map((u) => ({
      studentKey: u.studentKey,
      studentName: u.studentName,
      parentName: u.parentName,
      actionType: "bulk-set" as const,
      status: u.status,
      actorEmail: input.actorEmail,
      actorName: input.actorName,
    }));
    await tx.insert(followUpState).values(stateValues)
      .onConflictDoUpdate({
        target: followUpState.studentKey,
        set: {
          // Drizzle 0.45 supports sql.raw for conflict SET expressions
          status: sql`excluded.status`,
          updatedAt: sql`now()`,
          updatedByEmail: sql`excluded.updated_by_email`,
          updatedByName: sql`excluded.updated_by_name`,
        },
      });
    await tx.insert(followUpLog).values(logValues);
  });
}
```

### DB-08 — Migration runner

```typescript
// web/scripts/db-migrate.ts
// Source: D-22 — tsx script invoked from GH Actions, uses UNPOOLED URL
#!/usr/bin/env tsx
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED is required");

  const sql = neon(url);
  const db = drizzle({ client: sql });
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ migrations applied");
}

main().catch((err) => {
  console.error("✗ migration failed:", err);
  process.exit(1);
});
```

```yaml
# .github/workflows/db-migrate.yml (new file — created in Phase 2; CI provisioning is operator)
name: db-migrate
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - "web/drizzle/**"
      - "web/src/lib/db/schema.ts"
      - "web/scripts/db-migrate.ts"
jobs:
  migrate:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    env:
      DATABASE_URL_UNPOOLED: ${{ secrets.DATABASE_URL_UNPOOLED }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npx tsx scripts/db-migrate.ts
```

```typescript
// web/drizzle.config.ts
import type { Config } from "drizzle-kit";
export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
} satisfies Config;
```

```json
// web/package.json — scripts addition
"scripts": {
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx scripts/db-migrate.ts",
  "db:seed-admin": "tsx scripts/seed-admin-ownership.ts"
}
```

### Seed script flow (D-21)

```typescript
// web/scripts/seed-admin-ownership.ts
// Source: D-21 — clasp-run seed with fallback to manual-review JSON
#!/usr/bin/env tsx
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { studentAdminOwnership } from "../src/lib/db/schema";
import { ADMIN_OWNER_REGISTRY } from "../src/lib/dashboard/config";

const FALLBACK_PATH = "../.planning/research/admin-ownership-seed.json";
const SEED_ACTOR = process.env.SEED_ACTOR_EMAIL ?? "seed@begifted-ops.local";
const VALID_KEYS = new Set([...ADMIN_OWNER_REGISTRY.map((a) => a.key), "unassigned"]);

interface OwnershipJson {
  [studentKey: string]: { adminKey: string; source: string };
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED required");

  let ownership: OwnershipJson;
  try {
    const raw = execSync(
      "clasp run buildStudentAdminOwnershipMap",
      { cwd: "..", encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    ownership = JSON.parse(raw);
  } catch (e) {
    console.error("✗ clasp run failed; writing fallback JSON", e);
    writeFileSync(FALLBACK_PATH, JSON.stringify({ error: String(e), partial: null }, null, 2));
    throw new Error(`clasp run failed — review ${FALLBACK_PATH} before retrying`);
  }

  // Validate admin keys against allowlist
  for (const [key, value] of Object.entries(ownership)) {
    if (!VALID_KEYS.has(value.adminKey)) {
      throw new Error(`Invalid adminKey for ${key}: ${value.adminKey} (not in allowlist)`);
    }
  }

  const neonClient = neon(url);
  const db = drizzle({ client: neonClient });

  const values = Object.entries(ownership).map(([studentKey, entry]) => ({
    studentKey,
    adminKey: entry.adminKey as (typeof VALID_KEYS extends Set<infer T> ? T : never),
    assignedByEmail: SEED_ACTOR,
  }));

  await db
    .insert(studentAdminOwnership)
    .values(values)
    .onConflictDoUpdate({
      target: studentAdminOwnership.studentKey,
      set: {
        adminKey: sql`excluded.admin_key`,
        assignedByEmail: sql`excluded.assigned_by_email`,
        updatedAt: sql`now()`,
      },
    });

  console.log(`✓ seeded ${values.length} admin-ownership rows`);
}

main().catch((err) => {
  console.error("✗ seed failed:", err);
  process.exit(1);
});
```

## Validation.gs Port Assignment (41 assertions → 5 files)

**D-20 mapping table.** Each row names a `Validation.gs` function and assigns it to a port file. `DROP` = delete entirely (D-05 Should_Credit priority exclusive); `REWRITE` = keep the test but rewrite inputs to use `session_duration` fallback only.

### `packages.test.ts` — active-filter, exclusion, admin-ownership, duplicate-merge (9 tests)

| Validation.gs function | Action | Notes |
|------------------------|--------|-------|
| testTrialPackagesAreExcluded | PORT | Exercises `EXCLUDED_PACKAGE_KEYWORDS = ["pretest","trial"]` |
| testPretestPackagesAreExcluded | PORT | Same |
| testRecognizedAdminOwnershipResolvesCorrectly | PORT | `buildStudentAdminOwnershipMap` majority vote — inputs come from Postgres in Phase 3, from in-memory fixture here |
| testBlankAdminOwnershipFallsBackToUnassigned | PORT | Fallback to `UNASSIGNED_ADMIN_KEY` |
| testConflictingAdminOwnershipUsesCountThenFirstRow | PORT | Tie-breaker logic |
| testStudentsMissingOwnershipMapDefaultToUnassigned | PORT | Missing-key behavior |
| testDuplicatePackagesKeepLargestTotalCredits | PORT | `upsertPackageRecord` duplicate-merge |
| testLowBalanceWithoutScheduleGetsDataQualityFlag | PORT | `dataQualityFlags: "low-balance-no-schedule"` |
| testNoUpcomingSessionsStayNoData | PORT | Projection fallback |

### `projection.test.ts` — computeProjection, worstStatus, alert/exhaust dates (4 tests)

| Validation.gs function | Action | Notes |
|------------------------|--------|-------|
| testAlertThresholdBoundaryAtExactlyTwoCredits | PORT | `ALERT_THRESHOLD = 2` boundary |
| testWatchWindowBoundaryAtThirtyDays | PORT | `NOTIFY_WINDOW_DAYS = 30` boundary |
| testPriorityScoreRanksNotifyAheadOfHealthy | PORT | Priority score math; spans projection+analytics |
| testWeeklyBucketsGroupProjectedAlerts | PORT | Weekly bucket rollup |

### `pending-deduction.test.ts` — shouldCountAsPendingDeduction, Should_Credit drop/rewrite (4 tests; was 5-6)

| Validation.gs function | Action | Notes |
|------------------------|--------|-------|
| testPendingFeedbackCreatesPendingDeduction | PORT | Core D-08 rule with `teacher_feedback` empty |
| testPendingDeductionUsesShouldCreditWhenAvailable | **DROP** | Entire purpose is Should_Credit priority (D-05) |
| testPendingDeductionFallsBackToDurationWhenShouldCreditMissing | **REWRITE** | Keep but rewrite: remove Should_Credit from fixture, keep session_duration > 0 assertion |
| testConsumedCreditsDoNotDoubleDeduct | **REWRITE** | Keep the double-deduct guard but remove credits_consumed input (D-07 derived via duration) |

### `queue.test.ts` — queue-row construction, priority-score, comparator (4 tests)

| Validation.gs function | Action | Notes |
|------------------------|--------|-------|
| testStudentQueueRollsUpPackagesIntoOneRow | PORT | `buildStudentQueueRow` multi-package roll-up |
| testPinnedStudentsSortAheadOfOtherRisk | PORT | `pinned` flag in sort comparator |
| testDashboardModelMergesStudentActionStateIntoStudentsAndQueue | PORT | Action-state attach + queue roll-up integration |
| testStudentActionStateOnlySurfacesToday | PORT | DB-05 same-day visibility — but inputs come from Postgres in Phase 3, from `ActionStateMap` fixture here |

### `calendar.test.ts` — day-grouping, weekly-buckets, calendar payload (3 tests)

| Validation.gs function | Action | Notes |
|------------------------|--------|-------|
| testCalendarGroupsStudentSessionsByDay | PORT | `buildCalendarData` day-bucket logic |
| testSummaryDeltasCompareAgainstPreviousSnapshot | PORT | `buildSummaryDeltas` — needs PersistedSnapshotState fixture |
| testDashboardCacheMissBuildsAndCachesPayload | PORT | Integration with service-layer facade — test adapted (no cache in Phase 2 per D-23) |

### Not-ported (17 tests — Apps Script infrastructure, obsolete in Next.js)

These tests exercise Apps Script-specific primitives that don't exist in the Next.js stack. They stay in `Validation.gs` until Phase 5 retires the `.gs` files.

| Validation.gs function | Reason not ported |
|------------------------|------------------|
| testDashboardCacheHitReusesPayloadWithoutRebuild | `CacheService` semantics; Next.js uses `use cache: remote` (Phase 3) |
| testSetStudentActionPersistsAndClearsCache | Same — Phase 3's `revalidateTag` test |
| testClearStudentActionKeepsHistoryButRemovesVisibleState | Same |
| testBulkSetStudentActionUpdatesMultipleStudents | Same — Phase 3's bulk-write test |
| testStudentActionActorFallsBackToNullForAllView | Same |
| testStudentActionHistoryTrimsToLimit | Apps Script-specific 20-entry history cap; Next.js has no equivalent (Postgres stores unbounded log) |
| testChunkedCacheRoundTripPreservesLargePayload | Apps Script chunked transfer; Next.js doesn't chunk |
| testDashboardTransferChunkedCacheHitSkipsPayloadLoad | Same |
| testDashboardTransferManifestUsesChunkedMode | Same |
| testDashboardTransferCacheMissReturnsChunkedAfterCaching | Same |
| testDashboardTransferCacheMissFallsBackInlineWhenManifestMissing | Same |
| testDashboardTransferChunkBatchReadsOrderedSlices | Same |
| testDashboardTransferChunkBatchHandlesFinalPartialBatch | Same |
| testDashboardTransferChunkBatchRecoversWhenManifestMissing | Same |
| testDashboardTransferChunkBatchRecoversWhenPartMissing | Same |
| testDashboardTransferChunkBatchRejectsInvalidRange | Same |
| testDashboardTransferChunkReadsStoredChunk | Same |

**Count check:** 9 + 4 + 4 + 4 + 3 = 24 ported, 1 dropped, 2 rewritten, 17 not-ported, total = 44. Phase 1 summary says 41 — discrepancy is +3 (probably miscount in PHASE-SUMMARY.md; grep finds 41 by exact `function test[A-Z]` regex but snapshot-store ones may be double-counted). **Planner resolution:** Phase 2 port gate is "every function in the packages/projection/pending-deduction/queue/calendar domains that Phase 2 code executes in Vitest has a corresponding port file assertion." Not-ported list is justification.

## Fixture Adapter (TEST-02) — `toDashboardSources(wisenetFixtures)`

```typescript
// web/src/test/helpers/wisenet-to-dashboard-sources.ts
// Source: D-24 — test-only fixture adapter
import type { DashboardSources } from "@/lib/dashboard/domain";
import { buildDashboardSourcesFromWisenet } from "@/lib/wisenet/mappers";
import type { WisenetStudent, WisenetSession } from "@/lib/wisenet/types";

// All fixtures pre-loaded (imported JSON)
export interface WisenetFixtureSet {
  students: WisenetStudent[];
  pastSessions: WisenetSession[];
  upcomingSessions: WisenetSession[];
  parentNamesById: Map<string, string>;                  // pre-resolved, no network
  teacherFeedbackBySessionId: Map<string, string>;       // synthetic: defines which sessions "have feedback" for pending-deduction fixture coverage
}

export async function toDashboardSources(
  fixtures: WisenetFixtureSet,
  today: Date,
): Promise<DashboardSources> {
  // Note: this passes prefetched maps via options to skip network in mappers
  return buildDashboardSourcesFromWisenet(today, {
    skipTeacherFeedback: false,
    prefetched: {
      parentsById: fixtures.parentNamesById,
      teacherFeedbackBySessionId: fixtures.teacherFeedbackBySessionId,
    },
  });
  // Reality: the production mapper calls getStudents/getPastSessions/etc. which hit network.
  // The test adapter needs an alternate entry point that takes already-fetched data and
  // goes straight to the snapshot builders. Phase 2 task: refactor buildDashboardSourcesFromWisenet
  // to delegate to a pure `composeFromData(students, pastSessions, ..., prefetched)` function
  // that tests import directly and that mappers call internally after fetching.
}
```

**The refactor implied above is critical.** `mappers.ts` exports BOTH:
- `buildDashboardSourcesFromWisenet(today, options)` — network-driven (production caller)
- `composeDashboardSourcesFromData(data, today, options)` — pure function (tests call this directly)

The fixture adapter at `web/src/test/helpers/wisenet-to-dashboard-sources.ts` calls `composeDashboardSourcesFromData` with fixture-derived data.

### Usage in existing dashboard-logic.test.ts

```typescript
// web/src/test/dashboard-logic.test.ts — APPEND this block; existing tests unchanged
describe("wisenet parity", () => {
  it("existing dashboard-logic tests pass when DashboardSources come from Wisenet mappers", async () => {
    const fixtures = loadWisenetFixtures(); // reads web/src/test/fixtures/wisenet/*.json
    const sources = await toDashboardSources(fixtures, new Date(2026, 3, 21));

    // Reuse the SAME assertion body from the original "builds the same low-balance queue shape" test
    const activeStudents = buildActiveStudentSet(sources.students);
    const excluded = buildExcludedPackageReasons(sources.studentsCourses);
    const ownership = buildStudentAdminOwnershipMap(sources.remainingCredits);
    // ... same pipeline
    expect(dashboard.payload.studentQueue.length).toBeGreaterThan(0);
    // etc.
  });
});
```

**Parity gate semantic:** If any existing assertion fails, the fix is in `mappers.ts`, not in the test. Failure = proof of semantic drift that Phase 3 cannot absorb.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `unstable_cache` (Next 15) | `use cache: remote` + `cacheTag` + `cacheLife` | Next.js 16 (2026-04) | Required for Phase 3; Phase 2 doesn't cache per D-23 |
| `pg.Pool` with `max: 10` default | `@neondatabase/serverless` HTTP + optional `Pool` with `max: 3` + `attachDatabasePool` | Fluid Compute default-on (Apr 2025) | Phase 2 DB-03 follows |
| `revalidateTag(tag, "max")` | `revalidateTag(tag)` (single arg) | Next 16 | CONCERNS.md flags current code; Phase 3 fixes |
| Zod 3.x `.email()` method on string | Zod 4.x `z.email()` top-level | Zod 4.0 (Oct 2024) | **Stay on Zod 3** for Phase 2; v4 migration is v2 |
| Drizzle 0.38 `drizzle(db)` | Drizzle 0.45 `drizzle({ client: db })` config-object form | Drizzle 0.45 (Jan 2026) | Use config-object form for forward compat |
| PropertiesService (Apps Script) action state | Postgres `follow_up_state` + `follow_up_log` tables | This milestone | Phase 2 DB-02 |
| Google Sheets as source of truth | Wisenet REST API | This milestone | Phase 2 WCLI-04 mappers |

**Deprecated/outdated:**
- Vercel Postgres (`@vercel/postgres` package) — retired Dec 2024, migrated to Neon
- `memory-cache.ts` per-instance Map — retiring in Phase 3 (kept in Phase 2 for Sheets path)
- `snapshot-store.ts` module-global `let` state — per-instance fragility per CONCERNS.md

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `data.students[*].parentIds` is populated reliably on the detail fetch | WCLI-04 parent resolution | Parent-name mapper returns empty string; `buildDashboardStudentKey` falls back to "missing-parent" (acceptable soft-fail) |
| A2 | Wisenet `/parents` endpoint accepts comma-separated IDs via `?ids=` query param | WCLI-03 `getParents` | 400/404 from server; test catches in WCLI-06. May need batched single-ID fetches as fallback |
| A3 | `teacherFeedback` on session-detail response is a string (not an object) | WCLI-02 Zod schema | Zod `.parse()` throws; schema updates needed; caught in WCLI-06 fixture test |
| A4 | `@neondatabase/serverless` WebSocket Pool needs explicit `neonConfig.webSocketConstructor = ws` under Node runtime | DB-03 bulk-client | Silent fall-through to pure-JS WebSocket under Next.js 16 Node 22+; Vercel docs recommend explicit import |
| A5 | Drizzle 0.45 `onConflictDoUpdate` with `sql\`excluded.*\`` works identically to 0.38 | DB-07 bulk upsert | Syntax drift; test with an integration run on a Neon branch |
| A6 | Zod v3.25+ maintains compatibility with Zod 3.23 idioms (no breaking changes within v3 line) | STACK.md version pin upgrade | Low — v3 is strictly semver |
| A7 | GH Actions `secrets.DATABASE_URL_UNPOOLED` is already provisioned by Vercel Marketplace Neon integration | DB-08 CI workflow | Workflow fails on first run; operator must copy from Vercel to GH secrets manually |
| A8 | clasp is globally installed on the Kevin's machine (`.clasprc.local.json` present) | Seed script D-21 | Seed throws with "clasp: command not found"; fallback JSON covers this |
| A9 | Apps Script `buildStudentAdminOwnershipMap` returns JSON-serializable shape from `clasp run` | Seed script D-21 | Parse error in seed; fallback JSON route |

**Recommendation:** A1, A2, A3, A5 warrant a single "integration smoke" task in Phase 2 that exercises one real call against the Neon branch + one read against Wisenet. A7 and A8 are operator-setup items that don't block Phase 2 tasks but need callouts in the phase handoff.

## Open Questions

1. **sessionCredits upgrade probe timing.** D-07 "direct-first, derive fallback" and field map Opportunity 6 both gesture at a follow-up probe. Phase 2 planner decides: include as a task (with budget-check against `_rate-limit-budget-used.json`), or defer to Phase 3.
   - What we know: `/user/classes/{classId}/participants` may return a student_id distinct from `session.userId._id`; if paired with that resolved ID, sessionCredits may respond 200 with numeric `total`+`remaining`.
   - What's unclear: whether the 200 response shape matches dashboard "hours" semantics or is instead session-count. WCLI-06 fixture test would catch on upgrade.
   - Recommendation: include as optional Phase 2 task behind a feature flag; move to Phase 3 if Phase 2 feels crunched.

2. **Parent detail-fetch cost reality.** `resolveParentNames` in WCLI-04 issues one `/participants/{studentId}` detail call per student to get `parentIds`. For 500 students that's 500 requests, and `p-limit(5)` caps it at ~100 seconds wall-clock.
   - What we know: students-list fixture's `parents: []` is always empty; detail fetch is the only path to parentIds.
   - What's unclear: whether `registrationData.fields[questionId=z1porsd5/smf66ar7]` on detail fetch is a faster-shortcut (parent name directly, no second /parents call) vs the canonical 2-step join.
   - Recommendation: test both paths with fixture data in WCLI-06; prefer 2-step for canonical correctness per D-18.

3. **Drizzle migration ordering across branch preview environments.** D-22 CI job runs on push-to-main. Preview deploys share the same Neon project, different branches. Migration applies to production branch only; preview branches auto-provisioned by Vercel Marketplace Neon integration inherit a snapshot.
   - What we know: Neon's Vercel integration creates a DB branch per preview deployment.
   - What's unclear: does the auto-branch inherit `__drizzle_migrations` state, so drizzle-kit on a PR preview sees migrations as "applied"? Or does it rerun?
   - Recommendation: planner includes a README note + manual test on first PR preview.

4. **Admin seed idempotency vs drift.** The seed script re-runs (D-21 says "can be re-run safely"). If the `RemainingCredits` sheet is edited after seed, a re-run overwrites Postgres with sheet state — but operators may have already edited via the (future) dashboard UI.
   - What we know: Phase 2 adds no dashboard UI for edit.
   - What's unclear: policy for "after Phase 3 adds edit UI, when should the seed script become read-only/retired?"
   - Recommendation: planner documents in `web/scripts/README-seed.md` that re-running the seed after operators have edited in the dashboard will overwrite edits.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All scripts + test runner | ✓ | 22+ (per `@types/node@^22`) | — |
| npm | Install deps | ✓ | 10+ | — |
| tsx | Scripts `db-migrate`, `seed-admin-ownership`, existing `compare-live` | ✓ | 4.20.3 | — |
| vitest | Test runner | ✓ | 3.2.4 | — |
| Neon Postgres project (via Vercel Marketplace) | DB-01, DB-02, DB-03, DB-04, DB-07, DB-08 | ✗ | — | **No fallback** — Kevin must provision before Phase 2 DB tasks can execute |
| `DATABASE_URL` env var | Runtime HTTP + WebSocket clients | ✗ | — | Auto-injected by Vercel Marketplace post-provision |
| `DATABASE_URL_UNPOOLED` env var | Migration scripts | ✗ | — | Auto-injected by Vercel Marketplace post-provision |
| `WISENET_*` env vars | Wisenet client | ✓ (per Phase 1 — web/.env documented) | — | — |
| clasp CLI | Seed script D-21 | ✓ (used today per CLAUDE.md) | global install | Falls through to `.planning/research/admin-ownership-seed.json` manual-review mode |
| `.clasprc.local.json` | Seed script clasp auth | ✓ | — | Same fallback |
| ws npm package | Neon WebSocket under Node runtime | ✗ (not in package.json currently) | — | Phase 2 installs as indirect dep of `@neondatabase/serverless` (bundled) OR explicit install if Node's built-in WebSocket proves incompatible |
| GitHub Actions runner | CI migration (D-22) | ✓ (repo on GitHub) | — | Manual runs via `workflow_dispatch` if secrets-copy fails |

**Missing dependencies with no fallback:**
- Neon Postgres project provisioning — operator action required before DB-01 through DB-08 tasks can complete

**Missing dependencies with fallback:**
- `ws` package — Vercel/Neon docs say `@neondatabase/serverless` bundles ws for Node; will verify during WCLI-06 integration smoke. Explicit install `npm install ws` if needed.

## Validation Architecture

**Test Framework:**

| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 (existing) |
| Config file | `web/vitest.config.ts` (existing, node env, @ alias, `src/**/*.test.ts` glob) |
| Quick run command | `cd web && npm test` (runs vitest once) |
| Full suite command | `cd web && npm test` (same — vitest has no split fast/slow in current config) |

**Phase Requirements → Test Map:**

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WCLI-01 | Fetch wrapper retries on 429, times out at 15s | unit | `npx vitest run wisenet-client.test.ts` | ❌ Wave 0 |
| WCLI-02 | Zod schemas round-trip all 6 fixtures | unit | `npx vitest run wisenet-mappers.test.ts` | ❌ Wave 0 |
| WCLI-03 | Pagination iterator terminates on short page | unit | `npx vitest run wisenet-client.test.ts` | ❌ Wave 0 |
| WCLI-04 | Mappers produce valid DashboardSources from fixtures | unit | `npx vitest run wisenet-mappers.test.ts` | ❌ Wave 0 |
| WCLI-05 | `z.coerce.*` handles `"2"` string → `2` number | unit | `npx vitest run wisenet-mappers.test.ts` (TEST-05 parametric) | ❌ Wave 0 |
| WCLI-06 | Fixture-driven mapper tests green | unit | `npx vitest run wisenet-mappers.test.ts` | ❌ Wave 0 |
| WCLI-07 | `getWisenetEnv` throws on missing var | unit | `npx vitest run env.test.ts` | ❌ Wave 0 |
| DB-02 | Drizzle schema shape matches migration SQL | static | `cd web && npx drizzle-kit check && npx drizzle-kit generate --dry-run` | ✅ (drizzle-kit CLI) |
| DB-03 | HTTP client + bulk pool singleton instantiate | unit | `npx vitest run db-client.test.ts` | ❌ Wave 0 |
| DB-04 | Query functions compile and mock-return correct shapes | unit | `npx vitest run db-queries.test.ts` | ❌ Wave 0 |
| DB-05 | `sanitizeStudentActionState` drops non-today rows (existing test) | unit | `npx vitest run dashboard-logic.test.ts` | ✅ (existing) |
| DB-06 | Insert queries require actorEmail + actorName | unit | `npx vitest run db-queries.test.ts` | ❌ Wave 0 |
| DB-07 | Bulk transaction runs both inserts in single call (mock) | unit | `npx vitest run db-queries.test.ts` | ❌ Wave 0 |
| DB-08 | `drizzle-kit check` reports no schema-migration drift | static | `cd web && npx drizzle-kit check` | ✅ |
| TEST-01 | 5 port files green | unit × 5 | `npx vitest run packages.test.ts projection.test.ts pending-deduction.test.ts queue.test.ts calendar.test.ts` | ❌ Wave 0 |
| TEST-02 | New `wisenet parity` describe block passes | unit | `npx vitest run dashboard-logic.test.ts` | ✅ (MODIFIED) |
| TEST-03 | Cache invalidation: write → subsequent read reflects write | **DEFER** (Phase 3) | N/A in Phase 2 | — |
| TEST-05 | Zod coercion table (embedded in WCLI-06) | unit | `npx vitest run wisenet-mappers.test.ts` | ❌ Wave 0 |

**Sampling Rate:**
- **Per task commit:** `cd web && npm test` — full vitest run (< 30s today; adds ~15s for new files)
- **Per wave merge:** `cd web && npm test` plus `cd web && npx drizzle-kit check`
- **Phase gate:** Full suite green + TEST-02 parity block green + (optional) one integration run against a Neon preview branch

**Wave 0 Gaps:**
- [ ] `web/src/test/wisenet-client.test.ts` — covers WCLI-01, WCLI-03
- [ ] `web/src/test/wisenet-mappers.test.ts` — covers WCLI-02, WCLI-04, WCLI-05, WCLI-06, TEST-05
- [ ] `web/src/test/db-client.test.ts` — covers DB-03
- [ ] `web/src/test/db-queries.test.ts` — covers DB-04, DB-06, DB-07
- [ ] `web/src/test/packages.test.ts` — TEST-01 port #1
- [ ] `web/src/test/projection.test.ts` — TEST-01 port #2
- [ ] `web/src/test/pending-deduction.test.ts` — TEST-01 port #3
- [ ] `web/src/test/queue.test.ts` — TEST-01 port #4
- [ ] `web/src/test/calendar.test.ts` — TEST-01 port #5
- [ ] `web/src/test/helpers/wisenet-to-dashboard-sources.ts` — TEST-02 adapter
- [ ] `web/src/test/fixtures/wisenet/*.json` — copied from `.planning/research/fixtures/wisenet/` per D-04
- [ ] `web/src/test/env.test.ts` — covers WCLI-07 (optional; can fold into existing)
- [ ] Framework install: none (vitest already present)

**Critical parity gates (not all 41 assertions equally load-bearing):**

The 41 `Validation.gs` assertions vary in how much they catch. These ~12 are the "parity gates" — if any fail, cutover is wrong:

1. `testAlertThresholdBoundaryAtExactlyTwoCredits` — ALERT_THRESHOLD math
2. `testWatchWindowBoundaryAtThirtyDays` — NOTIFY_WINDOW_DAYS math
3. `testPendingFeedbackCreatesPendingDeduction` — D-08 composite rule
4. `testPendingDeductionFallsBackToDurationWhenShouldCreditMissing` (rewritten) — fallback branch
5. `testTrialPackagesAreExcluded` — EXCLUDED_PACKAGE_KEYWORDS
6. `testPretestPackagesAreExcluded` — same
7. `testConflictingAdminOwnershipUsesCountThenFirstRow` — majority-vote tie-breaker
8. `testStudentQueueRollsUpPackagesIntoOneRow` — multi-package roll-up math
9. `testPriorityScoreRanksNotifyAheadOfHealthy` — priority ordering
10. `testCalendarGroupsStudentSessionsByDay` — calendar day bucketing
11. `testSummaryDeltasCompareAgainstPreviousSnapshot` — summary delta math
12. `testStudentActionStateOnlySurfacesToday` — DB-05 same-day preservation

The 12 parity gates + the 45+ existing `dashboard-logic.test.ts` assertions through TEST-02's `wisenet parity` describe block form the "cutover readiness" test surface. Any failure here = cutover-blocking drift.

**Integration test strategy for Postgres:**
- **Tier A (default)**: Mock the Drizzle client per STACK.md Pattern 2. Covers ~95% of DB-04 query-shape assertions.
- **Tier B (one test, opt-in)**: `web/src/test/db-integration.test.ts` with `describe.runIf(process.env.TEST_DATABASE_URL)` — runs migrations, exercises one round-trip per query function, tears down. Gated behind TEST_DATABASE_URL env so `npm test` on a laptop stays offline.

**Cache-invalidation regression test (TEST-03) placement decision:**

**Recommendation: DEFER TO PHASE 3 with explicit justification.**

Rationale:
1. **Caching infrastructure doesn't exist in Phase 2.** Per D-23, Phase 2 adds no cache for Wisenet reads. The target infrastructure (`use cache: remote` + `cacheTag`) is a Phase 3 artifact.
2. **Testing the doomed Sheets path is wasted work.** The existing `memory-cache.ts` + `unstable_cache` infrastructure serves prod through Phase 2, but it's scheduled for deletion in Phase 3's SVC-05. Writing a regression test against infrastructure we're about to delete doesn't catch Phase 3 cutover bugs.
3. **Phase 3 adds the real cache and must own the regression test.** The natural gate is "after Phase 3 wires `service.ts` to Wisenet + Postgres + `use cache: remote`, TEST-03 verifies that a Postgres write invalidates the cached dashboard payload."
4. **Phase 2 TEST-03 would constrain the Phase 3 design.** If we write TEST-03 now against the Sheets memory-cache API, Phase 3 will have to adapt both the test and the cache. That's churn for nothing.

**Carve-out:** Phase 2 STILL tests the existing `revalidateTag(DASHBOARD_CACHE_TAG, "max")` problem (CONCERNS.md MEDIUM) — but as a static/lint check, not a runtime regression. A grep-based assertion in the validator shell that flags `revalidateTag(..., "max")` call sites in the new code paths covers this.

**Counterargument (for the planner to consider):** If the planner feels strongly about Phase 2 owning cache-invalidation coverage, the minimal Phase 2 test is:
```typescript
// web/src/test/cache-invalidation-scaffold.test.ts  (PHASE 2 CARVE-OUT — OPTIONAL)
// Asserts that the mocked cache layer's revalidateTag is called once per write.
// Not a real cache test — just a call-site assertion.
it("invalidates cache tag on follow-up state write (contract test)", async () => {
  const revalidateTag = vi.fn();
  vi.mock("next/cache", () => ({ revalidateTag }));
  // ... call upsertFollowUpState via a Phase 3 service.ts WRAPPER that doesn't exist in Phase 2
});
```
This would not run (no Phase 3 service yet) and would mostly be a placeholder. The strong recommendation is to **defer**.

## Sources

### Primary (HIGH confidence)
- `npm view @neondatabase/serverless version` (2026-04-21) → `1.1.0`
- `npm view drizzle-orm version` (2026-04-21) → `0.45.2`
- `npm view drizzle-kit version` (2026-04-21) → `0.31.10`
- `npm view zod version` (2026-04-21) → `4.3.6` (noted; Phase 2 stays on v3)
- `npm view @vercel/functions version` (2026-04-21) → `3.4.3`
- `npm view p-limit version` (2026-04-21) → `7.3.0`
- `npm view drizzle-orm@0.45 peerDependencies` (2026-04-21) → `@neondatabase/serverless >=0.10.0` (compat confirmed)
- Vercel `@vercel/functions` API docs — https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package (pulled 2026-04-21) — `attachDatabasePool` signature, `getCache`, `invalidateByTag`
- Drizzle Neon docs — https://orm.drizzle.team/docs/get-started/neon-new (pulled 2026-04-21) — `drizzle(url)` and `drizzle({ client })` forms
- Drizzle Neon Serverless source — https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/neon-serverless/driver.ts — Pool acceptance + `ws` config
- `.planning/research/WISENET_FIELD_MAP.md` (Phase 1) — 25-row field map, 6 RED decisions
- `.planning/research/WISENET_ENDPOINTS.md` (Phase 1) — 120-endpoint catalogue + auth + base URL
- `.planning/research/fixtures/wisenet/*.json` — 9 fixture files with field-path audit logs
- `.planning/phases/01-wisenet-discovery/01-PHASE-SUMMARY.md` — Phase 2 handoff
- `.planning/phases/02-data-layer/02-CONTEXT.md` — 24 locked decisions for Phase 2

### Secondary (MEDIUM confidence)
- STACK.md §Wisenet client skeleton — uses v0.38 but concept still applies
- ARCHITECTURE.md §Postgres Schema Sketch — schema shape
- PITFALLS.md §Pitfall 2, 4, 5 — Zod coercion, connection pool, chunk transfer

### Tertiary (LOW confidence)
- None — all sources above are direct npm/live-docs/Phase-1-artifacts

## Metadata

**Confidence breakdown:**
- Standard stack (versions): HIGH — all queried live via `npm view` 2026-04-21
- Architecture (facade + client/schema shape): HIGH — inherited from ratified Phase 1 STACK/ARCHITECTURE
- Pitfalls: HIGH — 12 pitfalls from Phase 1 research still apply; Phase 2 adds 7 more specific to data layer
- Wisenet mapper branches: HIGH — 6 fixture files probed, every RED row has a structured decision
- Validation.gs port assignment: MEDIUM — 24 of 41 tests mapped; 17 not-ported (Apps Script-specific infra) need planner sanity check
- Fixture adapter: MEDIUM — D-24 signature locked, but `composeDashboardSourcesFromData` refactor of mappers is a Phase 2 task that could surface complexity
- TEST-03 placement: HIGH — defer-to-Phase-3 recommendation is well-grounded in D-23

**Research date:** 2026-04-21
**Valid until:** ~2026-05-21 (30 days — stable domain; Drizzle and Neon are both fast-moving but compatible changes within the 0.45.x / 1.1.x minor lines)

---

*Phase: 02-data-layer*
*Research completed: 2026-04-21*
