---
phase: 3
slug: service-cutover
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-29
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source of truth: `03-RESEARCH.md` § Validation Architecture (committed `56540ad`).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 (Node env) |
| **Config file** | `web/vitest.config.ts` |
| **Quick run command** | `cd web && npm test -- --run` |
| **Full suite command** | `cd web && npm test -- --run` (vitest doesn't have a quick/full split today) |
| **TypeScript check** | `cd web && npx tsc --noEmit` |
| **Build check** | `cd web && npm run build` |
| **Anti-pattern lint** | `cd web && npm run lint:no-revalidate-max` (semantics flip per Pitfall 5 — see Wave 0) |
| **Estimated runtime** | ~30s (Phase 2 baseline: 164 tests in <30s) |

---

## Sampling Rate

- **After every task commit:** Run `cd web && npm test -- --run` (full suite — vitest is fast, no need to subset)
- **After every plan wave:** Run `cd web && npm test -- --run && cd web && npx tsc --noEmit && cd web && npm run lint:no-revalidate-max`
- **Before `/gsd-verify-work`:** All four D-35 gates must be green:
  1. Suite green + tsc clean + build OK + lint OK
  2. `.github/workflows/db-migrate.yml` green on PR preview's Neon branch
  3. `npm run db:seed-admin` succeeded against prod Neon (operator action per D-31)
  4. Manual operator QA on Vercel preview URL (per D-35)
- **Max feedback latency:** ~30s for unit/smoke; ~3-5min for build; CI db-migrate ~2-3min

---

## Per-Task Verification Map

> Tasks are placeholder until `gsd-planner` produces the PLAN.md files. Each plan's tasks will be filled in during execution. The mapping below is the requirement-level commitment.

| Req ID | Plan (expected) | Wave | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|-----------------|------|----------|-----------|-------------------|-------------|--------|
| SVC-01 | 03-01 | 1 | `cacheComponents: true` enabled in `web/next.config.ts` | build-time check | `cd web && npm run build` | ✅ existing | ⬜ pending |
| SVC-02 | 03-03 | 2 | service.ts wraps `getDashboardPayload` with `'use cache: remote'` + `cacheTag('dashboard-payload')` + `cacheLife({ stale: 60, revalidate: 60, expire: 300 })` (per Research Pattern 3 — overrides D-28 shorthand) | unit + grep | `grep -n "use cache: remote" web/src/lib/dashboard/service.ts` + suite green | ❌ W0 (grep can run today; full coverage needs cache-invalidation test below) | ⬜ pending |
| SVC-03 | 03-04 | 3 | Mutation surface (5 sites) calls `revalidateTag('dashboard-payload', 'max')` after Postgres write — **NOT `updateTag`** (Research Critical Finding: Server Actions only). Recommendation: place inside `'use server'` actions.ts facade per Research Open Question 4 path (b). | integration (TEST-03) | `cd web && TEST_DATABASE_URL=... npm test -- --run cache-invalidation` | ❌ W0 | ⬜ pending |
| SVC-04 | 03-05 | 3 | 6 route handlers swap to new service methods; public JSON shapes unchanged | smoke (per route) + integration (full payload) | `cd web && npm test -- --run` | Partial — `actions-route.test.ts` exists but mocks `lib/sheets/actions` (must rewrite to mock `lib/db/queries`); 5 new route smoke tests are W0 (planner can collapse) | ⬜ pending |
| SVC-05 | 03-08 | 5 | `lib/sheets/`, `memory-cache.ts`, `snapshot-store.ts`, legacy `actions.ts`, `compare-live.ts` deleted | grep + build | `! grep -r "lib/sheets" web/src/` + `cd web && npm run build` | ✅ existing | ⬜ pending |
| SVC-06 | 03-09 | 5 | `googleapis` removed from `web/package.json` + `ensure-action-sheets`/`ensure-inactive-sheet` scripts gone | grep | `! grep '\"googleapis\"' web/package.json && ! grep ensure-action-sheets web/package.json` | ✅ existing | ⬜ pending |
| SVC-07 | 03-06 | 3 | `/api/health` returns D-32 shape (per-subsystem status, 200 ok/degraded, 503 down) | smoke | `cd web && npm test -- --run health-route` | ❌ W0 | ⬜ pending |
| SVC-08 | 03-02 | 1 | Student Detail header renders archive-link with copy "View pre-cutover history →" + `target="_blank"` + `aria-label`; opens `ARCHIVE_ACTION_SHEET_URL` constant | unit (component, optional) OR manual QA per D-35 | `cd web && npm test -- --run student-detail` (if planner adds component test) OR D-35 manual gate 4 | Planner discretion (W0 if component test chosen) | ⬜ pending |
| TEST-04 | DEFERRED | — | Load test 50-concurrent p95 < 500ms | DEFERRED to Phase 4 DEPL-04 per D-34 | — | — | ⏭️ deferred |
| TEST-06 | 03-07 | 4 | Chunked-transfer regression — `ReadableStream` mock through `wisenetFetch` → mapper → service pipeline renders payload | unit | `cd web && npm test -- --run chunked-transfer-regression` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · ⏭️ deferred*

---

## Wave 0 Requirements

> Wave 0 = preparatory test/lint scaffolding that must exist before later waves can verify their work. Per `03-RESEARCH.md` § Wave 0 Gaps.

- [ ] **`web/src/test/cache-invalidation.test.ts`** — covers TEST-03 (gated on `TEST_DATABASE_URL`). Implementation: Postgres-correctness unit test per Research Open Question 3 recommendation (Vitest may not reach Vercel Runtime Cache backend). Tests: `setStudentAction` → `loadActionStateMap` reflects write; `bulkSetStudentAction` → all 50 keys reflected; `markInactive` → `listInactive` includes; `clearInactive` → `listInactive` excludes. Mocks: Wisenet fixture + real Neon branch.
- [ ] **`web/src/test/chunked-transfer-regression.test.ts`** — covers TEST-06. Implementation: `vi.stubGlobal("fetch", ...)` returning a `Response` with `ReadableStream` body that yields 3 chunks; assert `getDashboardPayload()` resolves with valid `DashboardPayload`. Use deliberate 3-chunk split (per A5) so the assertion exercises chunk concatenation.
- [ ] **`web/src/test/health-route.test.ts`** — covers SVC-07/D-32 shape. Tests: each subsystem status (ok/degraded/down) maps to correct rollup; 200 vs 503 status codes; `error.message` does not leak credentials (Wisenet error message format already SAFE per research § Security Domain).
- [ ] **`web/src/test/dashboard-route.test.ts`** (optional, planner's call) — covers SVC-04 GET shape. Tests: response JSON keys match `DashboardPayload` type; `requireSessionUser` failure → 401.
- [ ] **`web/src/test/student-detail.test.tsx`** (optional, planner's call) — covers SVC-08 archive-link render. Sets the precedent for component tests in this codebase (currently zero); planner weighs in 03-02-PLAN.md.
- [ ] **Update `web/src/test/actions-route.test.ts`** — current tests mock `lib/sheets/actions`; rewrite to mock `lib/db/queries` + `lib/db/bulk-queries` and assert `revalidateTag('dashboard-payload', 'max')` was called.
- [ ] **Reconcile `web/scripts/lint-no-revalidate-max.sh`** per Research Pitfall 5 (path (i) repurpose vs path (ii) re-allowlist). Recommendation: Path (i) — repurpose the regex to forbid the *deprecated single-arg* `revalidateTag(tag)` form; the lint stays useful and aligned with Next.js 16 best practice. Update `web/src/test/lint-no-revalidate-max.test.ts` accordingly.

*(Test framework infrastructure exists — Vitest 3 + Node env + 16 test files at 164/164 green per Phase 2 verification. No new framework install needed.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pre-merge admin-ownership seed | D-31 | Requires clasp auth (local-only per security policy) | `cd web && vercel env pull .env && cd web && npm run db:seed-admin` — expect `[seed-admin-ownership] Parsed N entries. OK — inserted/updated N rows.` Document N in PR description. |
| Operator dashboard QA on Vercel preview | D-35 #4 | End-to-end UX verification (not automatable as part of cutover scope) | Click through preview URL: dashboard loads → filter by admin → set action → bulk action (5 students) → mark inactive → open student detail → verify "View pre-cutover history →" link renders → click → opens archive sheet in new tab → /api/health returns structured response with all `ok` |
| `cacheComponents: true` × `next-auth@5.0.0-beta.30` compatibility | A3 from Research Assumptions | Empirical only — verified by Vercel preview build success (Research lists as LOW confidence) | `cd web && npm run build` locally + Vercel preview build green = compatibility proven |
| Vercel rollback drill | D-27 | Verifies the rollback path before relying on it post-cutover | Before merging cutover PR: confirm prior production deployment (`dpl_9dvQvrEe6RB1ZaEE9MN1ooCx2REV`) is reachable in Vercel dashboard's Deployments tab and "Promote Deployment" is one click away |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (planner enforces during 03-XX-PLAN.md generation)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (planner enforces per Nyquist Dimension 8)
- [ ] Wave 0 covers all MISSING references (7 items above must be explicit Wave 0 tasks in the planner's output)
- [ ] No watch-mode flags (`vitest run`, never `vitest watch` — confirmed in 02-09 lint-test pattern)
- [ ] Feedback latency < 30s (vitest baseline)
- [ ] `nyquist_compliant: true` set in frontmatter after gsd-plan-checker passes

**Approval:** pending (will be flipped to `approved YYYY-MM-DD` once gsd-plan-checker passes Stage 8)
