# Project Research Summary

**Project:** BeGifted Ops — Wisenet Migration Milestone
**Domain:** Data-source migration (Google Sheets → Wisenet SMS + Neon Postgres) on an existing Next.js 16 / Vercel Fluid Compute shadow app, with simultaneous Apps Script retirement
**Researched:** 2026-04-20
**Confidence:** MEDIUM — HIGH on Vercel/Next/Neon patterns and current codebase, LOW on the Wisenet API itself (Postman docs SPA was unreachable; unblocking is a Phase 0 human task)

---

## TL;DR

1. **Shape:** 6 phases, Phase 0 is mandatory pre-work (secrets rotation, branch hygiene, compliance, Wisenet auth discovery). Phases 1-5 deliver field discovery → data layer → UI → deploy hardening → Apps Script retirement with a 30-day tail.
2. **Stack verdict:** Drizzle + `@neondatabase/serverless` (HTTP mode, pooled URL) for Postgres; fetch + Zod for Wisenet (no SDK); Next.js 16 `'use cache: remote'` + `cacheTag` backed by Vercel Runtime Cache — replaces both `unstable_cache` and the per-process `memory-cache.ts`.
3. **Architecture:** Facade-over-pluggable-sources. `lib/dashboard/service.ts` stays as the single domain entry point; `lib/wisenet/*` swaps in for `lib/sheets/*` on reads; `lib/db/*` handles writes. Three-layer cache topology (React `cache()` → `'use cache'` → `'use cache: remote'`) with write-through tag invalidation.
4. **Biggest risk:** Cutover without a parity safety net. The top-3 silent-failure modes are Wisenet field gap discovered post-cutover, silent type coercion on Wisenet responses, and Neon connection-pool exhaustion under Fluid burst scaling. Mitigated by a Phase 1 field-map matrix, Zod-at-the-boundary, and `max: 3` pooled singleton.
5. **Blocker right now:** Wisenet Postman docs are a client-rendered SPA; FEATURES.md could not confirm auth scheme, pagination, rate limits, or field shape. This is a Phase 0 human unblock — none of the coding phases can start in good faith until a human opens the collection and records these facts.

---

## Recommended Stack

Summary of STACK.md (HIGH confidence on everything except the Wisenet auth scheme, which is flagged LOW):

- **`@neondatabase/serverless` `^1.0.0`** — default to HTTP mode (`neon()`), WebSocket `Pool` only for multi-statement transactions. Works with Vercel Marketplace Neon integration (auto-injects `DATABASE_URL`).
- **`drizzle-orm` `^0.38.x` + `drizzle-kit` `^0.30.x`** — TS schema as single source of truth, SQL-file migrations reviewable in PRs. Zero engine binary (no Prisma cold-start cost).
- **Wisenet client: custom fetch + Zod, no SDK** — ~100-line typed wrapper in `lib/wisenet/client.ts` mirroring the existing `lib/sheets/client.ts` shape. `zod@^3.23.x` validates every response at the chokepoint.
- **`@vercel/functions` `^3.x`** — only if WebSocket pool is used (`attachDatabasePool`); also exposes `getCache()` as a fallback.
- **Next.js 16 `'use cache: remote'` + `cacheTag` + `cacheLife`** — backed by Vercel Runtime Cache, regional, tag-invalidates in ≤300 ms, 2 MB/64 tags per entry. Drops `unstable_cache` and `memory-cache.ts` entirely.
- **Removals:** `googleapis@171.4.0`, `web/src/lib/sheets/*`, `web/src/lib/cache/memory-cache.ts`, `web/src/lib/dashboard/snapshot-store.ts`, `revalidateTag(..., "max")` (second arg is not part of the API).
- **Keep as-is:** Next 16.2.1, React 19.2.4, `next-auth@5.0.0-beta.30` (pin exact, no minor bumps without E2E test), Vitest 3.2.4, `tsx`, TypeScript strict.
- **Env vars:** `DATABASE_URL` + `DATABASE_URL_UNPOOLED` (auto-injected by Marketplace Neon), `WISENET_BASE_URL`, `WISENET_NAMESPACE=begifted-education`, `WISENET_USER_ID`, `WISENET_CENTER_ID`, `WISENET_API_KEY`. Existing `GOOGLE_*` / `AUTH_SECRET` / `STAFF_ALLOWLIST` unchanged. `SHEETS_*` retire.
- **Runtime:** Keep `export const runtime = "nodejs"` on all route handlers (not Edge). Set `TZ=Australia/Sydney` in Vercel env — Wisenet is Australian, calendar day math is TZ-sensitive.
- **Testing:** Keep Vitest. Mock `fetch` with `vi.stubGlobal` for Wisenet tests (fixtures in `web/src/test/fixtures/wisenet/*.json`). Two tiers for Postgres: mock Drizzle client for unit tests, real Neon branch for integration tests.

Detail: STACK.md

---

## Table Stakes — Field Mapping (every current dashboard field must map, or the migration is blocked)

**VERIFIED by Phase 1.** See `.planning/research/WISENET_FIELD_MAP.md` for the full matrix with GREEN/YELLOW/RED classifications, fixture evidence, and RED decisions (15 GREEN / 4 YELLOW / 6 RED across 25 REQUIRED_COLUMNS fields). The table below is preserved for comparison but superseded by the field map.

Summary of FEATURES.md. Current-dashboard inventory is HIGH confidence (read directly from `web/src/lib/dashboard/*` + `web/src/lib/sheets/*`). Wisenet side is LOW confidence and tagged `[DIRECT?] / [DERIVED?] / [GAP?] / [TBD]`.

| Dashboard field (Sheet tab.column) | Role | Likely Wisenet source | Gap risk |
|---|---|---|---|
| `Aggregations.Student Name`, `Parent Name` | Identity / `studentKey` | `[DIRECT?]` student firstName/lastName + linked guardian | Low — any SMS exposes this |
| `Aggregations.Class Subject` | Package name / join key | `[DIRECT?]` course / subject resource | Low |
| `Aggregations.Current Remaining Credits` | Alert threshold + exhaust projection | `[DIRECT? / DERIVED?]` enrolment balance OR total−consumed | **High** — Wisenet may be competency-based not credit-based |
| `Aggregations.Current Total Credits` | Detail view / deltas | `[DIRECT? / DERIVED?]` same as above | **High** |
| `Credit_Control.session_date / final_status / teacher_feedback / credits_consumed / session_duration / Should_Credit / session_id` | Pending-deduction rule (final_status=ENDED ∧ teacher_feedback empty ∧ credits_consumed=0 → pending) | `[DIRECT?]` attendance/session endpoint | **High** — 6-field alignment required; `Should_Credit` is likely `[GAP?]` (manual override) |
| `Upcoming Sessions.Scheduled Date / Session Status / Session Duration` | Calendar + credit-per-week projection | `[DIRECT?]` timetable/scheduled-class resource | Medium |
| `Students.Remaining Credits != "N/A"` | Active-student filter | `[DIRECT?]` enrolment status field — migration upgrade from null-check hack | Low |
| `Students & Courses.Class Name / Class Subject` (for `pretest`/`trial` keyword exclusion) | Exclusion signal | `[DIRECT?]` class name string OR (cleaner) Wisenet tags | Low |
| `RemainingCredits.Admin` (majority-vote owner among 6 named admins) | Queue admin filter | **`[GAP?]`** likely — Wisenet models teacher-per-class, not admin-per-student | **Probable gap** — store in Postgres as BeGifted metadata |
| Follow-up state (contacted/pending-callback/resolved), action log, inactive-students | Operator workflow | **N/A — stays in Postgres** per PROJECT.md | — |

**Explicit gaps for Kevin to decide before requirements freeze:**

1. **`Should_Credit` manual override** — drop, move to Postgres keyed by Wisenet session ID, or ask Wisenet for a custom field
2. **Admin ownership semantics** — store in Postgres as BeGifted metadata vs derive from Wisenet trainer field
3. **Credit-balance model** — direct vs derived-from-sessions (affects cache strategy significantly)
4. **Pending-deduction rule ingredients** — whether Wisenet exposes all three of status + feedback + consumed fields

Detail: FEATURES.md (see Research Blocker section — this is why the matrix is hypothesis-framed)

---

## Watch Out For — Top Pitfalls

Summary of PITFALLS.md. All are CRITICAL or HIGH severity given "no parity safety net" (user chose `just cut over`). Phase mapping shows where prevention lands.

1. **Wisenet field gap discovered post-cutover** (Phase 1) — operators flip, UI renders with missing fields, priority scoring breaks silently, no rollback. Prevent: `WISENET_FIELD_MAP.md` matrix with every `REQUIRED_COLUMNS` row classified GREEN/YELLOW/RED before Phase 2 starts.
2. **Silent type coercion (`"2"` vs `2`)** (Phase 2) — REST APIs stringify numbers; `credits < ALERT_THRESHOLD` lexicographically mis-sorts; tests use number literals so pass-in-prod-break. Prevent: Zod `z.coerce.number/boolean/date` at every Wisenet boundary; port the 41 `Validation.gs` assertions into Vitest.
3. **Neon connection-pool exhaustion under Fluid burst** (Phase 2) — morning bulk login × N instances × `max: 10` default = `sorry, too many clients already` at the worst moment. Prevent: pooled connection string only (`-pooler.<region>.aws.neon.tech`), `globalThis.__bgPgPool ??= new Pool({ max: 3 })` singleton, load test 50 concurrent `/api/actions`.
4. **Timezone mismatch (AEST vs Vercel UTC vs browser)** (Phase 2 + 3) — calendar day drifts, same-day action state appears/disappears around 10-14:00 local. Prevent: `TZ=Australia/Sydney` env var, Temporal or `date-fns-tz` for every date, no raw `new Date(string)`.
5. **NextAuth 5 beta minor-version bump breaks sign-in silently** (Phase 4) — Dependabot flips `beta.30 → beta.31`, auth breaks, no fallback URL after Apps Script retires. Prevent: pin exact `=5.0.0-beta.30`, Dependabot ignore, Playwright E2E sign-in test as post-deploy smoke.
6. **Apps Script retired too early** (Phase 5) — an operator at a remote center hits the old URL Monday, gets a dead page; `Validation.gs` assertions are lost if not ported first. Prevent: ports-first, snapshot-second, moved-page-third, 30-day-wait-fourth checklist. Port all 41 tests before Phase 5 starts.
7. **Secret leak — Wisenet creds pasted in chat are already compromised** (Phase 0) — rotate immediately. Harden root `.gitignore` (currently does NOT cover `.env` at repo root, only `web/.env`). Add `gitleaks` or `trufflehog` CI check.

Detail: PITFALLS.md — 12 pitfalls total, plus "Looks Done But Isn't" checklist, recovery strategies, and phase mapping.

---

## Suggested Phase Structure

Derived from ARCHITECTURE.md's build order and PITFALLS.md's Phase 0 recommendation. Each phase is one-sentence goal + what gates the next.

### Phase 0 — Pre-work (mandatory, not cosmetic)

**Goal:** Unblock the coding phases — rotate the Wisenet credentials pasted in chat, harden root `.gitignore`, add secret scanner, confirm Wisenet auth scheme / pagination / rate limits by a human opening the Postman collection, decide audit-trail retention policy, explicitly enumerate-then-discard the `codex/dashboard-load-performance` branch.

**Gates:** Phase 1 cannot start until Wisenet auth + base URL are documented and secrets are rotated.

### Phase 1 — Wisenet Discovery & Field Map

**Goal:** Produce `.planning/research/WISENET_FIELD_MAP.md` classifying every `REQUIRED_COLUMNS` row GREEN/YELLOW/RED, empirically fingerprint rate limits + pagination on real data, decide the 4 gap questions (`Should_Credit`, admin ownership, credit model, pending-deduction).

**Gates:** Phase 2 cannot start until every RED row has an explicit decision (accept-loss / derive / Postgres-sidecar / block-cutover).

### Phase 2 — Data Layer (Wisenet client + Postgres schema + ported tests)

**Goal:** Build `lib/wisenet/{client,endpoints,types,mappers,fixtures}` with Zod schemas and fetch+retry; build `lib/db/{client,schema,queries}` with Drizzle + pooled singleton; run `drizzle-kit` migration 0000; port 41 `Validation.gs` assertions into Vitest; write the `read→write→read` cache-invalidation regression test. Do NOT touch `service.ts` yet.

**Gates:** Phase 3 cannot start until fixture-driven Wisenet mappers produce valid `DashboardSources` AND the existing 45+ dashboard-logic tests pass against those mappers.

### Phase 3 — Service Cutover (reads from Wisenet, writes to Postgres)

**Goal:** Enable `cacheComponents: true`, rewrite `service.ts::getDashboardPayload` to compose Wisenet + Postgres with `'use cache: remote'` + `cacheTag`, rewrite `setStudentAction` / `clearStudentAction` / `bulk*` / inactive paths to write Postgres + `updateTag`, update route handlers (API shape unchanged). Add Day-1 archive-link affordance to Student Detail. Delete `lib/sheets/`, `lib/cache/memory-cache.ts`, `lib/dashboard/snapshot-store.ts`, `lib/dashboard/actions.ts`.

**Gates:** Phase 4 cannot start until operator smoke-test passes and `/api/dashboard` round-trip shows real Wisenet + Postgres data.

### Phase 4 — Deploy Hardening

**Goal:** Set `TZ=Australia/Sydney`; add `X-BG-Deploy-Id` header on every `/api/*` response for incident triage; add error tracking (Sentry/Vercel Agent); add Playwright E2E sign-in test running post-deploy; pin `next-auth` exact version + Dependabot ignore; fix the dev-mode auth fallback (`"local-dev-secret"` must throw in `NODE_ENV=production`).

**Gates:** Phase 5 cannot start until E2E sign-in passes on Vercel preview AND 41 `Validation.gs` ports are green.

### Phase 5 — Apps Script Retirement (30-day tail)

**Goal:** Snapshot `DashboardActionLog` / `DashboardActionsState` / `InactiveStudents` to CSV in immutable storage; write `docs/ARCHIVE_2026-04.md` manifest (spreadsheet IDs, owners, schemas, retention); flip Apps Script web app to a "Moved" page (NOT `deployed stopped` — that gives `HTTP -1`); wait 30 days with zero legacy traffic; archive `.gs` sources to `docs/archive/apps-script-2026-04/`; remove `googleapis` dep.

**Gates:** Milestone complete when 30-day tail expires with no operator reports AND archive manifest is checked in.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Vercel Runtime Cache / Fluid Compute / Neon Marketplace docs pulled live 2026-04-20. Exact Drizzle / `@neondatabase/serverless` version pins are MEDIUM — verify with `npm view` at implementation time. |
| Features — current dashboard | HIGH | Read directly from `web/src/lib/dashboard/config.ts` REQUIRED_COLUMNS + `lib/sheets/*` + `lib/dashboard/packages.ts`. |
| Features — Wisenet side | **LOW** | Postman docs are a client-rendered SPA; WebFetch / WebSearch / Bash network were all denied. Every Wisenet row is a hypothesis. |
| Architecture | HIGH | Facade pattern preserves 45+ fixture tests; Next 16 cache primitives verified against nextjs.org + vercel.com docs. |
| Pitfalls | HIGH | 12 pitfalls each anchored in repo files (`CONCERNS.md`, `CLAUDE.md`, `INTEGRATIONS.md`, `TESTING.md`) plus 2026-02-27 Vercel knowledge bulletin. |

**Overall:** MEDIUM. The Wisenet LOW is the single weakest link; everything else is HIGH. Until Phase 0 unblocks the Wisenet side, the Phase 1 discovery work IS the research, not implementation.

---

## Open Questions for Phase 0

**Wisenet unknowns #1-6: ANSWERED by Phase 1.** See `.planning/phases/01-wisenet-discovery/01-PHASE-SUMMARY.md` §Technical Findings for auth, pagination, rate-limit evidence. See `.planning/research/WISENET_FIELD_MAP.md` §Gap Questions for the 4 gap-question resolutions. The original numbered items below are preserved for historical context but are no longer open — they're marked ~~struck-through~~ with a pointer to the verified answer.

Research couldn't resolve these; they need human attention before Phase 1 starts.

**Wisenet unknowns (ANSWERED by Phase 1 — see `.planning/phases/01-wisenet-discovery/01-PHASE-SUMMARY.md` §Technical Findings):**
1. ~~Exact auth header names and value format~~ — ANSWERED. HTTP Basic (`Authorization: Basic base64({{WISENET_USER_ID}}:{{WISENET_API_KEY}})`) + `x-api-key: {{WISENET_API_KEY}}` + `x-wise-namespace: {{WISENET_NAMESPACE}}` stack. See `WISENET_FIELD_MAP.md` §Auth and `_auth-fingerprint.json` (variant 1 confirmed with 200 response).
2. ~~Base URL~~ — ANSWERED. `https://api.wiseapp.live`. See `WISENET_ENDPOINTS.md` §Auth (collection-level).
3. ~~Pagination style~~ — ANSWERED. Page-number (`page_number` + `page_size`, default 50). Envelope `{status, message, data: {<items>, count}}`. No Link header, no cursor, skip/take silently ignored. See `_pagination-fingerprint.json`.
4. ~~Rate-limit headers~~ — ANSWERED. NONE. 200-burst yielded zero 429s; server emits NO `x-ratelimit-*` / `Retry-After` headers. Phase 2 WCLI-01 must use 429-detection + exponential backoff (headerless enforcement). See `_rate-limit-fingerprint.json`.
5. ~~Does User ID imply HMAC signing?~~ — ANSWERED. NO. User ID is the HTTP Basic username half (`username={{user_id}}, password={{api_key}}`); no HMAC or request signing observed. See `_auth-fingerprint.json` → variant 1.
6. ~~Does Wisenet have webhooks?~~ — ANSWERED. NO webhook-management endpoints in the 120-endpoint Postman catalogue. Push model (if any) is not discoverable via Postman; Kevin would need to ask the vendor directly. Phase 2 uses 60s `cacheLife` revalidation instead. Captured as v2 `OPS-01`.

**Compliance / retention (require Kevin's decision):**
7. Action-log retention policy — how many years of follow-up history must be preserved? Is this regulated under AU privacy / student-records duty-of-care, or purely operational?
8. Archive ownership — who owns the analytics spreadsheet after the deploying user is unavailable? Must be a BeGifted Workspace account, not a personal Google account.

**Vercel env-var names (require Kevin + Vercel dashboard):**
9. After provisioning Neon via Vercel Marketplace: confirm the exact auto-injected var names (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, or Marketplace-specific like `POSTGRES_PRISMA_URL`). The integration provisions whatever shape the Marketplace is using on 2026-04-20.
10. Confirm Wisenet env-var naming convention — `WISENET_*` (per STACK.md proposal) vs an existing pattern Kevin prefers.

**Codebase hygiene:**
11. `codex/dashboard-load-performance` branch — enumerate the diff (file-list + +/- lines per file), decide keep/drop explicitly per change, file in `.planning/NOTES_CODEX_BRANCH.md` BEFORE Phase 0 ends.
12. Rotate the Wisenet credentials that were pasted in chat. The session transcript may be logged; treat them as compromised.

---

*Research completed: 2026-04-20*
*Ready for roadmap: yes, with Phase 0 as explicit blocker*
