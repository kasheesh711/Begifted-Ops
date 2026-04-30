---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: "Plan 03-04 SVC-03 actions.ts use-server mutation facade complete (ff33a11): 5 async mutations (setStudentAction, clearStudentAction, bulkSetAction, markInactiveStudent, clearInactiveStudent) over the Drizzle query layer. Each writes to Postgres FIRST, then revalidateTag(DASHBOARD_CACHE_TAG, 'max') SECOND per D-28. Sync helpers split to co-located action-helpers.ts (Rule 3 — Next.js 16 SWC enforces async-only exports for 'use server' files at BUILD time, not just runtime; re-exports of sync functions also stripped); 9 caller files updated to import from new module. markInactive schema deviation: facade accepts markedByName for API symmetry but only threads markedByEmail into DB (no marked_by_name column). Build green, 164/164 tests, tsc clean, lint green with empty allowlist. Next: Plan 03-05 SVC-04 route handler swap."
last_updated: "2026-04-30T03:21:47.406Z"
last_activity: 2026-04-30
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 26
  completed_plans: 21
  percent: 81
---

# STATE: BeGifted Ops — Wisenet Migration

**Last updated:** 2026-04-30

## Project Reference

**Core Value:** Operators can trust the dashboard as a single source of truth for who to follow up with and what credit / package state each student is in — without any manual sheet syncing.

**Current Focus:** Phase 03 — service-cutover

## Current Position

Phase: 03 (service-cutover) — EXECUTING
Plan: 6 of 11 (03-00 + 03-01 + 03-02 + 03-03 + 03-04 complete; next: 03-05 SVC-04 route handler swap)
**Phase:** 3 — Service Cutover (EXECUTING)
**Status:** Ready to execute
**Last Activity:** 2026-04-30
**Progress:** [████████░░] 81%

### Phase Overview

| # | Phase | Requirements | Status |
|---|-------|--------------|--------|
| 1 | Wisenet Discovery | 6 (WISE-01..06) | Complete (5/5 plans, all 6 WISE-* requirements closed, 01-PHASE-SUMMARY.md shipped) |
| 2 | Data Layer | 19 (WCLI + DB + TEST subset) | Complete — all 10 plans shipped (Waves 0-4): Wave 0 scaffolding + Wave 1 Wisenet client core + Drizzle schema/driver lifecycle + Wave 2 Drizzle query layer + Wave 3 Wisenet→DashboardSources mappers + TEST-01 batch A/B + Wave 4 TEST-05 parametric coercion + TEST-03 deferral lint + 02-10 ops scripts (DB-08 + D-21 + D-22); 19/19 requirements closed: DB-01..DB-08 + WCLI-01..WCLI-07 + TEST-01 + TEST-02 + TEST-03 (deferral carve-out) + TEST-05 (WCLI-05 covered by TEST-05) |
| 3 | Service Cutover | 10 (SVC + TEST-04, TEST-06) | Executing — 5/11 plans complete (03-00 baseline reconciliation 2026-04-29: 7 routes restored + 97 Phase 1+2 source files + 72 .planning artifacts; 03-01 cacheComponents 2026-04-29: cdc2ebe one-line flag + forced compat — 6 route runtime drops + 3 auth-page Suspense wraps; 03-02 SVC-08 archive-link affordance 2026-04-30: 1fbd42a — ARCHIVE_ACTION_SHEET_URL constant + Student Detail header link; 03-03 SVC-02 service.ts rewrite 2026-04-30: 0ef5f73 — service.ts rewritten with 'use cache: remote' + cacheTag + explicit 3-arg cacheLife + Wisenet+Postgres composer + auto-reactivation + 1.8MB sanity warn + structured try/catch logging via D-37 logger.ts + 3 route-handler inline revalidateTag(_, "max") cascade + lint flipped (single-arg deprecated form forbidden; ALLOWLIST=()) + 4 D-35 baseline tsc fixes + db/client.ts Proxy lazy-init + p-limit serverExternalPackages + .gitignore *.tsbuildinfo; build green, 164/164 tests, tsc clean; 03-04 SVC-03 actions.ts use-server facade 2026-04-30: ff33a11 — 5 async mutations [setStudentAction, clearStudentAction, bulkSetAction, markInactiveStudent, clearInactiveStudent] writing-then-revalidateTag(tag, "max") per D-28; sync helpers split to co-located action-helpers.ts [Rule 3 — Next.js 16 SWC enforces async-only exports for 'use server' files at BUILD time, not just runtime; re-exports of sync functions also stripped]; 9 caller files updated to import from new module; markInactive schema deviation: facade accepts markedByName for API symmetry but only threads markedByEmail into DB; build green, 164/164 tests, tsc clean, lint green with empty allowlist); TEST-04 deferred to Phase 4 per D-34; next 03-05 SVC-04 route handler swap |
| 4 | Deploy Hardening | 6 (DEPL-01..06) | Not started |
| 5 | Apps Script Retirement | 6 (RETI-01..06) | Not started |

## Performance Metrics

**Requirements Coverage:** 47/47 v1 requirements mapped across 5 phases (0 orphans, 0 duplicates)

**Parallelization Targets:**

- Phase 2: WCLI-* and DB-* workstreams can run in parallel (ARCHITECTURE.md confirms independence)
- Phase 5: 30-day tail is asynchronous — work can continue on other projects during observation window

## Accumulated Context

### Key Decisions (from PROJECT.md + user constraints)

| Decision | Rationale |
|----------|-----------|
| Wisenet swap first, then retire Apps Script | Proves Wisenet parity inside the shadow before removing the legacy fallback |
| Neon Postgres for follow-up state | Relational queries, audit history, future reporting; Wisenet stays read-only |
| Start follow-up history fresh | Action sheets remain as archive; cutover speed > historical continuity |
| Apps Script fully retired at milestone end | Single source of truth for operators; no dual mental model |
| No nightly parity-diff safety net | User prioritizes cutover speed; tests + operator QA cover correctness |
| No Phase 0 housekeeping in roadmap | User handles secret rotation, `.gitignore` hardening, branch triage manually |
| Validation.gs port is mandatory in Phase 2 | The 41 assertions ARE the parity spec — cannot be deferred |
| 30-day Moved page (not immediate decommission) | Operator tail coverage; avoids HTTP -1 confusion from deployed-stopped Apps Script |
| Module-swap PRs as cutover mechanic | 6 admins; A/B flags buy nothing; one atomic PR per data type |
| Wave-tolerant Phase 1 validator (SKIP-not-FAIL) | Lets `validate-phase1.sh` stay green during Waves 1-3 as downstream plans incrementally land target files |
| `assert_per_tab_row_counts` (5/8/5/2/3/2) | Binding per-tab check that closes B-2 gap where Student Name in 4 tabs masked missing rows under whole-document grep |
| `!.env.example` negation in `web/.gitignore` | Keeps documented env template tracked while real `.env` / `.env.local` stay ignored (Rule 3 blocking fix during 01-01) |
| Wisenet auth is HTTP Basic (username={{user_id}}, password={{api_key}}) + `x-api-key` + `x-wise-namespace` headers (01-02) | Parsed from Postman collection-level auth block; resolves WISE-04 and RESEARCH.md Open Question #2 / H1-H4 |
| Wisenet base URL is `https://api.wiseapp.live` (01-02) | Resolved from `web/.env WISENET_BASE_URL`; Postman uses `{{host}}` placeholder. Feeds Phase 2 `getWisenetEnv()` |
| Tenant/centre ID is a PATH parameter (`{{institute_id}}`), not a header (01-02) | Postman parse shows no `x-centre-id` header; all multi-tenant endpoints use `/institutes/<id>/...` path segments. Corrects H2 hypothesis |
| Shape-aware secret redaction (digits OR underscore/dash OR hex OR sk_/pk_ prefix) (01-02) | Distinguishes real secrets from legitimate camelCase API identifiers like `populateSessionAttendees` so the plan's strict `[A-Za-z0-9_-]{24,}` regex didn't produce catalogue-breaking false positives |
| Source-mtime as "Parsed at" timestamp (01-02) | Keeps parser re-runs byte-identical (determinism) — timestamp only advances when Kevin re-exports |
| Wisenet auth live-confirmed variant 1 — Basic(userId:apiKey) + x-api-key + x-wise-namespace (01-03) | First variant returned 200 against `/institutes/v3/<centerId>/students` on first request; variants 2-6 tested as negative controls |
| Pagination is page_number/page_size with data.students/data.count envelope (01-03) | 5-request probe confirmed; default page_size=50, skip/take silently ignored, past-end returns empty array — Phase 2 WCLI-03 iterates via page_number+=1 until records.length < page_size |
| Wisenet exposes NO rate-limit-remaining headers; 200-burst saw zero 429s (01-03) | Phase 2 WCLI-01 retry wrapper must rely on 429 detection + exponential backoff, NOT header parsing. Vendor 1000/24h ceiling (if applicable) wasn't triggered at 200 serial requests |
| Postman catalogue path typo — `{{institute_id}}s/students` should be `{{institute_id}}/students` (01-03) | Server treats `<24-hex-id>s` as a 25-char instituteId, returns 400 "must be 24 hex". Fixed inline in probes; catalogue cleanup deferred to 01-04 or Phase 2 |
| /sessions endpoint requires startDate+endDate when paginateBy=DATE; status enum is PAST/FUTURE (01-03) | Empirical deviation from Postman catalogue — catalogue doesn't document the enum values or the date-window requirement. Phase 2 WCLI-04 must pass startDate/endDate as ISO dates |
| sessionCredits endpoint rejects arbitrary student+class pairs as 400 "Student not found" (01-03) | Endpoint exists but wants a participant-resolved student_id distinct from the session `userId._id`. Tried both arbitrary institute-student and session-derived pair; both failed. Phase 2 WCLI-04 must derive via `/user/classes/{classId}/participants` or equivalent. Credit balance row will be RED in field map |
| Multi-layer PII redaction — key-based + value-based + env-value final pass (01-03) | Single-pass key-based redaction missed `displayIdentifier` and `answer` fields that echoed real emails; value-based EMAIL_VALUE_REGEX fallback catches PII stored under unexpected keys. Every commit was grep-clean of all 4 WISENET_* env values + real emails + real phone numbers before staging |
| WISENET_FIELD_MAP.md classification: 15 GREEN / 4 YELLOW / 6 RED across 25 REQUIRED_COLUMNS fields (01-04) | Satisfies WISE-01 (mapping), WISE-02 (classification), WISE-03 (RED allowlist). 6 RED rows: 4 × derive-client, 1 × accept-loss (Should_Credit per D-05), 1 × postgres-sidecar (Admin per D-06). Zero block-cutover means Phase 2 has no hard gates from Phase 1. |
| Hypothesis reconciliation: H1 confirmed+expanded, H2/H3/H4 corrected, H5 verified-as-absent (01-05) | research/FEATURES.md's original guesses that "center ID goes in header" and "namespace is subdomain" disconfirmed — both path param / header respectively. HMAC signing disconfirmed. Rate-limit headers confirmed absent (headerless enforcement) |
| Additive-only edits to research/SUMMARY.md and research/FEATURES.md (01-05) | T-4-01 threat mitigation: preserve original hypothesis content for future milestone revisits. SUMMARY.md 166 → 170 (+4 lines), FEATURES.md 300 → 320 (+20 lines). No deletions. |
| Full validator run as Phase 1 close-out gate (01-05) | 15 passed / 0 failed / 0 skipped + 1 WARN (pre-existing no_secret_like_strings_in_tracked_research — 1181 high-entropy matches, all benign — Kevin-eyeball-review per VALIDATION.md manual checks) |
| Two-client Drizzle split: `db` (HTTP via neon-http) + `bulkDb` (WebSocket Pool via neon-serverless) (02-05) | HTTP driver is stateless per invocation — zero cold-start cost, correct default for reads + single-statement writes. WebSocket Pool is isolated to the one transactional bulk-action path (Phase 3 api/actions/bulk/route.ts) because HTTP cannot span BEGIN...COMMIT. |
| Pool singleton guarded by `globalThis.__bgBulkPool` + `attachDatabasePool` for Fluid Compute (02-05) | D-25 contract: max:3, idleTimeoutMillis:30_000. `attachDatabasePool(pool)` tells Fluid Compute to drain idle clients before suspending the instance — prevents connection-pool exhaustion under burst traffic (T-02-21 mitigation). |
| `ws` added as explicit runtime dep (Rule 3 auto-fix, 02-05) | Vite/vitest resolver rejects bare imports of transitive deps even when hoisted in node_modules. `@neondatabase/serverless` pulls `ws@^8.12.1` transitively but bulk-client.ts's `import ws from "ws"` failed until `ws@^8.20.0` + `@types/ws@^8.18.1` were added explicitly to `web/package.json`. |
| Drizzle-kit 0000 initial migration generated with placeholder DATABASE_URL (02-05) | drizzle-kit generate with no existing meta/snapshot does not dial the DB — it only uses the URL for config parsing. Placeholder satisfies the `!` non-null assertion in drizzle.config.ts without requiring a live Neon instance at plan-time. Plan 02-09 will run this SQL against the real DB via GH Actions. |
| No foreign keys between the 4 Postgres tables (02-05) | D-06 explicitly treats student_admin_ownership as a sidecar seeded independently from RemainingCredits majority vote. follow_up_state / follow_up_log / inactive_students / student_admin_ownership all key on `studentKey` (or event_id for log) but join in TS, not SQL. Denormalizing student_name+parent_name into every table is the tradeoff — avoids joins on the read path, accepts minor drift risk on operator-driven renames. |
| `buildWeeklyBuckets` ported inline during 02-07 (Rule 2 deviation) | 20-line utility from `DashboardAnalytics.gs:612` mirrored into `web/src/lib/dashboard/analytics.ts` with a `WeeklyBucket` TypeScript interface. Required to satisfy the 4th projection parity test (`testWeeklyBucketsGroupProjectedAlerts` from Validation.gs:1774) without substituting a different assertion. Keeps TS analytics layer 1:1 with Apps Script semantics. |
| D-05 Should_Credit-drop policy fully realized in TEST-01 batch A (02-07) | 1 DROP (`testPendingDeductionUsesShouldCreditWhenAvailable` — Should_Credit priority branch no longer exists), 2 REWRITE (`testPendingDeductionFallsBackToDurationWhenShouldCreditMissing` + `testConsumedCreditsDoNotDoubleDeduct` — Should_Credit removed from fixture inputs, D-08 `credits_consumed === 0` guard is the sole pending-deduction filter), 14 straight PORTs. 17 Apps Script-specific assertions enumerated verbatim in `pending-deduction.test.ts` header as NOT ported (stay in Validation.gs until Phase 5 archive). |
| Bulk upsert ON CONFLICT SET uses Drizzle `sql\`excluded.*\`` template (02-06) | Multi-row upsert needs each row to take its own inbound values rather than the first row's. `sql\`excluded.status\`` / `sql\`excluded.updated_by_email\`` / etc. reads from Postgres' EXCLUDED pseudo-table — a keyword reference, not user input, so zero injection surface. `sql\`now()\`` for updatedAt keeps the DB clock authoritative inside the transaction. |
| clearInactive is DELETE, not UPDATE autoReactivated (02-06) | Plan 02-05's schema.ts models inactive status as row presence, not a column value. clearInactive therefore issues `db.delete(inactiveStudents).where(eq(studentKey, x))` — consistent with listInactive reading all rows unconditionally. markInactive returns void because the upsert call sites never need the row back. |
| DB-06 actor attribution enforced at compile time via $inferInsert types (02-06) | The follow_up_state / follow_up_log / inactive_students tables all use `.notNull()` on updatedByEmail / updatedByName / actorEmail / actorName / markedByEmail. Drizzle's `$inferInsert` propagates `notNull` to the insert TypeScript shape — callers that omit actor fields fail tsc. No runtime default fallback; no silent attribution loss. |
| DB-05 isToday:true marker at query layer (02-06) | `loadActionStateMap` returns every follow-up-state row with isToday:true unconditionally. The domain-layer `sanitizeStudentActionState` re-evaluates same-day visibility with real "today" after merging against dashboard state. Preserves Sheets-layer semantics so Phase 3 service.ts is a drop-in swap; also means the query layer doesn't need a time-of-day parameter. |
| TEST-01 port closed via Plan 02-08 (02-08) | 24 Validation.gs assertions ported across 5 Vitest files (packages 9 + projection 4 + pending-deduction 4 + queue 4 + calendar 3) matching the Validation.gs parity count minus D-05's 1 drop + 2 rewrites. 17 Apps Script-specific assertions (chunked cache manifests, PropertiesService prefix reads, HtmlService, chunked transfer) stay in .gs until Phase 5 archive — enumerated verbatim in pending-deduction.test.ts header. Full suite 86/86 green; tsc clean. |
| D-23 cache-miss carve-out applied in calendar.test.ts (02-08) | Validation.gs's `testDashboardCacheMissBuildsAndCachesPayload` adapted to assert BUILD path only (fresh payload top-level fields + emitted `snapshotState.lastSnapshot`) because no cache surface exists in Phase 2. Phase 3 TEST-03 ports the cache-mutation half against the new `use cache: remote` + `cacheTag('dashboard-payload', ...)` surface. Inline 9-line comment block in the test references `.planning/phases/02-data-layer/02-CONTEXT.md §D-23` so future readers don't mistake the carve-out for test gap. |
| Pipeline-driven fixtures over hand-constructed StudentRecord objects (02-08) | `createPackageRecord` and `finalizePackageRecord` aren't exported from the TS `packages.ts` module (Apps Script's primary fixture hooks), so queue/calendar tests thread `SheetSnapshot` fixtures through the real `buildActiveStudentSet` → `buildExcludedPackageReasons` → `buildStudentAdminOwnershipMap` → `buildPendingDeductionContext` → `buildUpcomingSessionMap` → `buildDashboardStudents` chain via a co-located `runPipeline(fixtures, today)` helper. Catches any pipeline contract drift that hand-constructed records would mask; matches `dashboard-logic.test.ts` idiom. |
| T-02-35 null-prior guard added beyond plan ports (02-08) | Plan acceptance criteria required ≥ 3 calendar tests; shipped 4. The 4th is `buildSummaryDeltas(current, null)` — a first-run cold-start case not in Validation.gs (Apps Script always passes a populated previous summary from its in-process fixture). Added to cover Phase 3 cold-start behavior before any snapshot lands; proves every delta field returns null rather than throwing. |
| TEST-05 closed via parametric drift-axis tables (02-09) | `it.each` over 8 accept + 3 reject + 3 pinned-surprising numeric cases proves `"2" === 2` at `WisenetSessionsListSchema` boundary; end-to-end assertion feeds raw Wisenet envelope with string `"3600000"` through `composeDashboardSourcesFromData` producing numeric Aggregations rows. MeetingStatusSchema strict enum asserted with 6 rejection cases (lowercase, trimmed, typo, empty) so any future case-insensitive schema regression trips loudly. Documented surprising coercions (`[]` → 0, `"  "` → 0, `null` → 0) pinned as Zod-library-upgrade guardrails rather than asserted as rejections — matches actual JS `Number()` semantics. |
| TEST-03 deferred via static grep lint + allowlist (02-09) | Phase 2 has no cache infrastructure per D-23, so the real runtime regression test lands in Phase 3 SVC-02 against `use cache: remote`. Phase 2 ships `web/scripts/lint-no-revalidate-max.sh` with a single-entry allowlist (`src/lib/dashboard/service.ts`) to stop new code paths from reintroducing the `revalidateTag(tag, "max")` anti-pattern. Automated FLAG-3 negative test in `web/src/test/lint-no-revalidate-max.test.ts` uses runtime string assembly (`"revalidate" + "Tag"`) to avoid the test file self-matching the lint regex. Phase 3 SVC-02 must remove both `service.ts:20` AND the allowlist entry in one PR. |
| DB-08 migration runner + CI workflow shipped with path-filtered push-to-main trigger (02-10) | `.github/workflows/db-migrate.yml` only runs when `web/drizzle/**` / `web/src/lib/db/schema.ts` / `web/scripts/db-migrate.ts` change. Keeps unrelated PRs off the CI migrate path. Node 22 + `npm ci` + `npx tsx scripts/db-migrate.ts` with `secrets.DATABASE_URL_UNPOOLED`. Verify-env step surfaces missing-secret errors before dependency install. CI migrate runs BEFORE Vercel deploy promotes the corresponding commit — blocks deploy of schema-dependent code if migration fails. |
| URL redaction in db-migrate.ts logs (T-02-40 belt-and-suspenders) (02-10) | Regex `:[^:@]*@` → `:<REDACTED>@` runs in-script before any `console.log` of the DATABASE_URL_UNPOOLED value. GH Actions auto-masks `secrets.*` references in logs too, but local runs (terminal scrollback, screencasts, Vercel log scrapers) don't get that. Two-layer mitigation covers both code-path and CI-runner channels. |
| D-21 seed-admin-ownership.ts with fallback-JSON on any failure path (02-10) | Every failure — clasp run fails, JSON parse fails, empty/invalid ownership map, malformed entry, allowlist-reject — writes the suspicious payload to `.planning/research/admin-ownership-seed.json` with error context and exits 1 without inserting. Fallback content varies per failure type (clasp-fail writes error+timestamp; parse-fail writes raw claspOutput; allowlist-reject writes offending entry + full ownership). Never insert half-baked data. |
| VALID_ADMIN_KEYS allowlist built from single sources of truth (02-10) | `new Set<string>([...ADMIN_OWNER_REGISTRY.map(a => a.key), UNASSIGNED_ADMIN_KEY])` — no hardcoded duplication. If the registry changes, allowlist tracks automatically. 500-row batching on the onConflictDoUpdate insert bounds parameter count well under PostgreSQL's 65535 limit (500 * 3 params = 1500; hundreds of students = one batch in practice). |
| RESEARCH.md Q3 + Q4 open questions addressed in README-db-ops.md (02-10) | Q3 (Neon preview-branch migration ordering): Vercel Marketplace Neon creates a branch per preview; `__drizzle_migrations` table inherits from parent so preview migrations are idempotent. Preview deploy blocks on migration failure same as main. Q4 (seed idempotency vs future edit UI): re-running the seed post-cutover WILL OVERWRITE dashboard-edited ownership. Mitigation = run once at cutover only (Phase 3 checklist entry) + Phase 3+ guard refusing to run if `updated_at > assigned_at` for any row. Phase 5 retires the sheet; seed marked deprecated then. |
| Three atomic commits in additive-then-deletion order honored D-33 (03-00) | Plan 03-00 chose chore(03-00) → feat(02-retroactive) → docs(planning) ordering. First commit restored 7 Sheets-era route handler files verbatim from `../Begifted-Ops-prod-snapshot/web/src/app/`; second committed 97 Phase 1+2 source files (wisenet client, drizzle layer, dashboard logic ports, tests, scripts, CI workflow, configs); third committed 72 .planning artifacts (PROJECT.md, REQUIREMENTS.md, codebase/, research/ minus gitignored postman dump, phase 01/02 dirs). Each commit individually buildable. |
| Sub-task 2 consolidated to single commit instead of optional A/B/C split (03-00) | Plan offered a 3-way split (wisenet / db / remaining); chose single commit for atomic readability since pre-Plan-03-00 history has no Phase 2 source at all (anyone bisecting Phase 2 work would land on this single commit's contents anyway). Explicit per-path `git add` enforced the same security gates the split would have provided. |
| D-41 invariant verified post-copy in Plan 03-00 | After cp batch from prod-snapshot, re-grepped `web/src/lib/runtime/env.ts` for `getWisenetEnv|getDbEnv` — present, confirming env.ts (Phase 2-aware) was NOT clobbered by prod-snapshot's older Sheets-era version. Same applies to analytics.ts and dashboard-logic.test.ts (those paths were never in the cp scope). |
| `cacheComponents: true` forces drop of `export const runtime = "nodejs"` from all 6 route handlers (03-01) | Next.js 16 errors with "Route segment config 'runtime' is not compatible with `nextConfig.cacheComponents`" because Node.js becomes the default route runtime under the flag. Removing the redundant segment is the documented migration step (`docs/01-app/02-guides/migrating-to-cache-components.mdx`). Routes still execute on Node.js — confirmed by build output classifying them as `ƒ (Dynamic)`. Drizzle HTTP + WebSocket Pool unaffected. |
| `cacheComponents: true` requires `<Suspense>` around `await auth()` page bodies (03-01) | The plan's threat-register T-03-01-1 assumed auth-gated pages "are dynamic anyway" but Next.js 16 rejects uncached I/O at the page-component top with "Uncached data was accessed outside of <Suspense>". Pattern fix: lift the auth-dependent body into an async sub-component and wrap it in `<Suspense fallback={null}>`. Build now classifies `/`, `/signin`, `/dashboard` as `◐ (Partial Prerender)` — static shell prerenders, auth streams in per request. Behavior unchanged. `HomeRedirect()` needed an explicit `return null` after `redirect()` because tsc cannot prove control-flow termination through the `redirect()` throw. |
| ARCHIVE_ACTION_SHEET_URL TODO placeholder branch taken; D-30 archive link wired with `&rarr;` HTML entity, no icon (03-02) | Plan branched on whether the operator provided the real URL. Auto-mode active + no operator prompt path → TODO placeholder branch chosen (`https://docs.google.com/spreadsheets/d/TODO_REPLACE_WITH_REAL_SHEET_ID/edit#gid=TODO_REPLACE_WITH_TAB_GID`). Plan 03-10 Pre-Merge Gate now carries 2 operator actions: D-31 admin-ownership seed + replace this placeholder URL with the real DashboardActionsState tab URL. Archive link uses `&rarr;` HTML entity (byte-stable in source diffs vs literal Unicode arrow). No external-link icon added — repo has no icon library dep and Claude's Discretion in plan permits omission. No React component test added — repo has no component-test precedent. T-03-02-2 mitigated via `rel="noopener noreferrer"`. |
| Explicit 3-arg cacheLife({ stale:60, revalidate:60, expire:300 }) — never the { expire:60 } shorthand (03-03) | RESEARCH §Pitfall 4: the { expire: 60 } single-key form silently inherits a 15-minute revalidate from Next.js' "default" profile. Every Phase 3 use cache: remote site MUST pass all 3 keys. Plan-acceptance verification regex: `cacheLife.*stale.*60.*revalidate.*60.*expire.*300`. |
| Postgres sidecar admin-ownership applied as post-build mutation pass over StudentRecord, not by re-running buildDashboardStudents (03-03) | D-06 sidecar override mutates `adminOwnerKey`/`Name`/`Source` after `buildDashboardStudents` completes. ADMIN_REGISTRY_BY_KEY lookup translates the 7-value adminKey enum to display label. Sets `adminOwnershipSource = "postgres-sidecar"` so traceability survives. Re-running the builder would have been more invasive and slower (full O(N*P) recomposition vs O(N) field write). |
| Inline revalidateTag(DASHBOARD_CACHE_TAG, "max") + recordCacheInvalidation in 3 route handlers as Plan 03-04 transition (03-03) | The plan removed `invalidateDashboardPayloadCache` from service.ts (must_have). 3 route handlers (api/actions, api/actions/bulk, api/inactive) still imported it — Rule 3 cascade. Per CONTEXT D-28 / Claude's Discretion option (b), Plan 03-04 will own a 'use server' actions.ts facade. Until then, inlining the two-arg form satisfies the new lint regex (which forbids only the deprecated single-arg form) and keeps the cache invalidation contract intact for the React client. |
| db/client.ts lazy-init via Proxy (Rule 1, surfaced by Phase 3 wiring) (03-03) | Phase 2's `const sql = neon(getDbEnv().DATABASE_URL)` ran at module load; no production code path imported db/client.ts in Phase 2 (Sheets-era routes used lib/sheets/* only). Phase 3 service.ts now imports db/queries.ts → db/client.ts, and Next.js 16's "Collecting page data" step imports every route module — which cascaded into the env throw at build time. Proxy defers `neon()`/`drizzle()` to first property access (request time). Preserves `import { db }` ergonomics across all callers; no refactor of 19+ call sites required. |
| serverExternalPackages: ['p-limit'] in next.config.ts (Rule 3, Turbopack #async_hooks) (03-03) | p-limit@5.0.0 uses Node's `imports` field (`#async_hooks` mapped to `node:async_hooks` for Node, fallback stub otherwise). Turbopack does not resolve the `imports` field when bundling, so the build failed at compile time with "Module not found: Can't resolve '#async_hooks'". `serverExternalPackages` delegates module resolution for that package to Node at runtime where the conditional resolution works. Future packages with the same `imports` idiom will need the same opt-out. |
| Empty ALLOWLIST=() requires bash set-u guard via ${ALLOWLIST[@]+...} (03-03) | The lint script's `set -euo pipefail` makes any unbound expansion fatal. Phase 2's array always had at least one entry (`src/lib/dashboard/service.ts`); flipping to empty for Phase 3 broke the `for a in "${ALLOWLIST[@]}"` expansion. Fixed via the POSIX "alternate value" pattern: `${ALLOWLIST[@]+"${ALLOWLIST[@]}"}` expands to nothing when the array is empty/unset. |
| 4 D-35 baseline tsc errors cleared in 03-03 (Rule 1, parent-objective directed) (03-03) | dashboard-logic.test.ts:141 widened "palm" to string instead of AdminViewKey — fix: `as const`. wisenet-mappers.test.ts:35-46 had explicit `_id`/`name` redundant with the trailing spread of overrides — fix: drop the explicit lines. Both are pure type-narrowing; behavior unchanged. Parent objective explicitly directed clearing them per D-35 ("4 pre-existing tsc errors should be cleared as part of this plan"). |
| actions.ts 'use server' facade + co-located action-helpers.ts split (03-04) | Plan must_have #1 ('use server' on line 1) + must_have #4 (preserve sync helpers normalizeStudentActionStatus / sanitizeStudentActionState / attachActionStatesToStudents / isActionStateToday) created a hard architectural conflict: Next.js 16's SWC compiler enforces async-only exports for 'use server' files at BUILD time (not just runtime as the docs suggest — `Server Actions must be async functions` SWC error), and re-exports of sync functions via `export { ... } from "./action-helpers"` are also stripped (`The module has no exports at all` build error). Resolution: helpers moved to a co-located action-helpers.ts module; 9 caller files (service.ts, build.ts, sheets/actions.ts, 2 route handlers, 4 tests) updated to import from the new path. Pure import-path migration with zero behavior change. Preserves 'use server' directive on actions.ts line 1, the 5 async mutations, and all original helper API contracts. |
| markInactive schema deviation in actions.ts facade (Rule 1, 03-04) | Plan template specified `markInactiveStudent({ ..., markedByEmail, markedByName })` and `dbMarkInactive(input)`. But db schema's `inactive_students` table only has `markedByEmail` (no `markedByName` column). Facade signature accepts `markedByName` for API symmetry with the other 4 mutations (each takes `*Email + *Name` actor pair) but only threads `markedByEmail` into the DB call. Out-of-band schema migration could add `marked_by_name` column if needed; out of scope for this plan. |
| D-28 ordering preserved at every facade method (03-04) | Each mutation: Postgres write awaited FIRST, revalidateTag(DASHBOARD_CACHE_TAG, "max") + recordCacheInvalidation SECOND. If the write throws, revalidateTag never runs — cache stays consistent with the pre-write database state. revalidateTag uses the two-arg form because route handlers in Plan 03-05 will call these methods (updateTag would throw from route handlers per RESEARCH §Critical Finding #1). |

**Performance metrics:**

| Phase/Plan | Duration | Tasks | Files |
|------------|----------|-------|-------|
| Phase 01 P01 | 15min | 2 tasks | 6 files |
| Phase 01 P02 | 8min  | 2 tasks (1 pre-resolved) | 3 files |
| Phase 01 P03 | 24min | 5 tasks | 14 files |
| Phase 01 P04 | ~45min | 1 task | 1 file (WISENET_FIELD_MAP.md) + validator patches |
| Phase 01 P05 | ~20min | 1 task | 2 created (01-PHASE-SUMMARY.md, 01-05-SUMMARY.md) + 5 modified |
| Phase 02 P02 | 11min | 3 tasks | 4 files |
| Phase 02 P05 | 5min | 3 tasks | 7 files |
| Phase 02 P07 | 12min | 3 tasks | 4 files |
| Phase 02 P03 | 16min | 2 tasks | 2 files |
| Phase 02 P06 | 4min | 3 tasks | 3 files |
| Phase 02 P08 | 4min | 2 tasks | 2 files |
| Phase 02 P04 | 10min | 3 tasks | 4 files |
| Phase 02 P09 | 8min | 2 tasks | 4 files |
| Phase 02 P10 | 13min | 3 tasks | 4 files |
| Phase 03 P00 | 3min | 3 sub-tasks | 176 files (7 + 97 + 72) |
| Phase 03 P01 | 5min | 1 task (+2 Rule-3 cascades) | 10 files (1 config + 6 routes + 3 pages) |
| Phase 03 P02 | 2min | 2 tasks (combined commit) | 2 files (config + student-detail) |
| Phase 03 P03 | 11min | 3 tasks (+8 deviations: 3 Rule-3 + 4 Rule-1 + 1 Rule-2) | 13 files (1 service rewrite + 1 logger create + 1 lint flip + 1 lint test + 3 route handlers + 1 actions-route test + 2 D-35 tsc fixes + 1 db client lazy + 1 next.config + 1 .gitignore) |
| Phase 03 P04 | 8min | 1 tasks | 11 files |

### Active Todos

None yet — will populate when `/gsd-plan-phase 1` decomposes Phase 1 into executable plans.

### Open Blockers

**Phase 1 unblocks:**

- Wisenet Postman collection must be opened by a human to confirm auth header names, base URL, pagination, rate limits (research/FEATURES.md could not reach the SPA)
- 4 gap questions need explicit decisions: `Should_Credit` manual override, admin ownership semantics, credit-balance model (direct vs derived), pending-deduction rule field availability

### Known Risks (from research/PITFALLS.md, ranked)

1. **Wisenet field gap discovered post-cutover** — Phase 1 field-map matrix mitigates
2. **Silent type coercion (`"2"` vs `2`)** — Phase 2 Zod boundary + TEST-05
3. **Neon connection-pool exhaustion under Fluid burst** — DB-03 singleton `max: 3` + TEST-04 load test
4. **Timezone mismatch (AEST vs UTC vs browser)** — DEPL-01 `TZ=Australia/Sydney`
5. **NextAuth 5 beta minor-version bump breaks sign-in silently** — DEPL-02 pin + DEPL-03 E2E
6. **Apps Script retired too early** — RETI-02 30-day tail, TEST-01 ports-first sequence

## Session Continuity

### Files Created

- `.planning/PROJECT.md` (project scope, 2026-04-20)
- `.planning/REQUIREMENTS.md` (47 v1 requirements, 2026-04-20)
- `.planning/research/SUMMARY.md` (6-phase suggestion, 2026-04-20)
- `.planning/research/STACK.md` (Drizzle + Neon + Runtime Cache verdict, 2026-04-20)
- `.planning/research/FEATURES.md` (field mapping, blocked on Postman SPA, 2026-04-20)
- `.planning/research/ARCHITECTURE.md` (facade pattern, 3-layer cache, Postgres schema, 2026-04-20)
- `.planning/research/PITFALLS.md` (12 pitfalls, phase mapping, 2026-04-20)
- `.planning/ROADMAP.md` (5 phases, 2026-04-20)
- `.planning/STATE.md` (this file, 2026-04-20)
- `.planning/phases/01-wisenet-discovery/validate-phase1.sh` (Phase 1 validator, 2026-04-21)
- `.planning/research/fixtures/wisenet/.gitkeep` + `_errors/.gitkeep` (fixture scaffolding, 2026-04-21)
- `web/scripts/README-wisenet-probes.md` (Phase 1 provenance, 2026-04-21)
- `web/.env.example` (WISENET_* placeholders, 2026-04-21)
- `.planning/phases/01-wisenet-discovery/01-01-SUMMARY.md` (Plan 01-01 summary, 2026-04-21)
- `web/scripts/wisenet-postman-parse.ts` (Postman v2.1 parser, 2026-04-21)
- `.planning/research/WISENET_ENDPOINTS.md` (120-endpoint catalogue, 2026-04-21)
- `.planning/phases/01-wisenet-discovery/01-02-SUMMARY.md` (Plan 01-02 summary, 2026-04-21)
- `web/scripts/wisenet-probe-auth.ts` (auth variant probe, 2026-04-21)
- `web/scripts/wisenet-probe-pagination.ts` (5-request pagination probe, 2026-04-21)
- `web/scripts/wisenet-probe-rate-limit.ts` (200-burst rate-limit probe, 2026-04-21)
- `web/scripts/wisenet-probe-field-shape.ts` (6-resource field-shape probe with PII redaction, 2026-04-21)
- `.planning/research/fixtures/wisenet/_auth-fingerprint.json` (variant 1 confirmed, 2026-04-21)
- `.planning/research/fixtures/wisenet/_pagination-fingerprint.json` (page-number pattern, 2026-04-21)
- `.planning/research/fixtures/wisenet/_rate-limit-fingerprint.json` (200-burst, no 429, 2026-04-21)
- `.planning/research/fixtures/wisenet/_rate-limit-budget-used.json` (daily budget tracker, 2026-04-21)
- `.planning/research/fixtures/wisenet/students_list_page1.json` (resource sample, 2026-04-21)
- `.planning/research/fixtures/wisenet/student_detail_sample.json` (resource sample, 2026-04-21)
- `.planning/research/fixtures/wisenet/enrolment_detail_sample.json` (class detail sample, 2026-04-21)
- `.planning/research/fixtures/wisenet/past_sessions_sample.json` (past sessions, 2026-04-21)
- `.planning/research/fixtures/wisenet/upcoming_sessions_sample.json` (upcoming sessions, 2026-04-21)
- `.planning/research/fixtures/wisenet/credit_balance_sample.json` (400 state, endpoint-exists-needs-enrolled-pair, 2026-04-21)
- `.planning/phases/01-wisenet-discovery/01-03-SUMMARY.md` (Plan 01-03 summary, 2026-04-21)

### Next Actions

1. **Phase 2 operator setup (out-of-band before Phase 3 cutover):**
   - Provision Neon via Vercel Marketplace (auto-injects `DATABASE_URL` + `DATABASE_URL_UNPOOLED`)
   - Copy `DATABASE_URL_UNPOOLED` into GitHub repo Settings → Secrets → Actions
   - Local: `vercel env pull web/.env` after Neon is provisioned
   - Verify `.clasprc.local.json` still authenticated (needed by seed-admin-ownership.ts)
   - Full details: `web/scripts/README-db-ops.md §Setup`
2. Run `/gsd-plan-phase 3` to decompose Phase 3 (Service Cutover) — 10 requirements: SVC-01..10 + TEST-04 + TEST-06. Waves 1-3 of Phase 2 landed the Wisenet client + Drizzle queries + mappers; Phase 3 rewires `service.ts` + API routes to the new data layer and lands the runtime cache-invalidation test (TEST-03 PR must remove `service.ts:20` `revalidateTag(_, "max")` AND the `lint-no-revalidate-max.sh` allowlist entry in one PR).
3. Kevin reviews manual-only verifications checklist in `.planning/phases/01-wisenet-discovery/01-PHASE-SUMMARY.md` (5 items): RED-block soundness, fixture PII eyeball, AEST probe window, rate-limit budget acceptance, secret-warn eyeball.

**Last session:** 2026-04-30T03:21:47.399Z
**Stopped at:** Plan 03-04 SVC-03 actions.ts use-server mutation facade complete (ff33a11): 5 async mutations (setStudentAction, clearStudentAction, bulkSetAction, markInactiveStudent, clearInactiveStudent) over the Drizzle query layer. Each writes to Postgres FIRST, then revalidateTag(DASHBOARD_CACHE_TAG, 'max') SECOND per D-28. Sync helpers split to co-located action-helpers.ts (Rule 3 — Next.js 16 SWC enforces async-only exports for 'use server' files at BUILD time, not just runtime; re-exports of sync functions also stripped); 9 caller files updated to import from new module. markInactive schema deviation: facade accepts markedByName for API symmetry but only threads markedByEmail into DB (no marked_by_name column). Build green, 164/164 tests, tsc clean, lint green with empty allowlist. Next: Plan 03-05 SVC-04 route handler swap.

---
*State initialized: 2026-04-20 after roadmap creation*

**Planned Phase:** 03 (service-cutover) — 11 plans — 2026-04-29T15:23:42.222Z

**Executing Phase:** 03 (service-cutover) — Plan 03-00 complete 2026-04-29T15:46:25Z (3min, 3 sub-tasks, 176 files); Plan 03-01 complete 2026-04-29T15:56:45Z (5min, 1 task + 2 forced cascades, 10 files, commit cdc2ebe); Plan 03-02 complete 2026-04-30T02:46:00Z (2min, 2 tasks combined, 2 files, commit 1fbd42a); Plan 03-03 complete 2026-04-30T03:00:30Z (11min, 3 tasks + 8 deviations [3 Rule-3 + 4 Rule-1 + 1 Rule-2], 13 files, commit 0ef5f73); Plan 03-04 complete 2026-04-30T03:18:18Z (8min, 1 task + 1 architectural cascade [Rule-3 SWC async-only enforcement at build time + Rule-1 schema deviation], 11 files, commit ff33a11)
