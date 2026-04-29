# Phase 1: Wisenet Discovery - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Docs-only research phase. Produce the Wisenet field-map matrix, answer the 4 known gap questions in writing, and document Wisenet auth/pagination/rate-limit behavior from the Postman collection + empirical probes. Zero code commits to `web/` — outputs live under `.planning/research/`.

In scope:
- `.planning/research/WISENET_FIELD_MAP.md` — master field-to-endpoint matrix
- `.planning/research/WISENET_ENDPOINTS.md` — parsed endpoint catalogue from the Postman export
- `.planning/research/fixtures/wisenet/*.json` — recorded real Wisenet responses used as evidence
- Updates to `SUMMARY.md` / `FEATURES.md` to replace LOW-confidence Wisenet rows with verified rows
- Temporary tsx probe script(s) under `web/scripts/` for rate-limit / pagination fingerprinting (may be kept or discarded after Phase 1 — Phase 2 decision)

Out of scope (belongs in Phase 2 or later):
- `lib/wisenet/*.ts` client, types, endpoints, mappers
- Any change to `lib/sheets/`, `lib/dashboard/service.ts`, or route handlers
- Any Neon Postgres provisioning or schema work
- Any write to Wisenet (read-only probes only)
- `Validation.gs` port to Vitest (Phase 2 TEST-01)

</domain>

<decisions>
## Implementation Decisions

### Wisenet access method
- **D-01:** Kevin exports the Wisenet Postman collection as JSON to `.planning/research/wisenet-postman.json`; the live Wisenet API key lives in `web/.env` as `WISENET_API_KEY` (plus `WISENET_USER_ID`, `WISENET_CENTER_ID`, `WISENET_NAMESPACE=begifted-education`, `WISENET_BASE_URL`).
- **D-02:** Claude parses the Postman JSON and runs targeted tsx probes from `web/scripts/wisenet-probe-*.ts` — Kevin invokes them locally with env vars set. No Wisenet creds ever written to tracked files.
- **D-03:** Parsed endpoint catalogue lives at `.planning/research/WISENET_ENDPOINTS.md` (separate from the field map) — method, path, headers, query params, body schema, auth per endpoint. Becomes the reference Phase 2's `lib/wisenet/endpoints.ts` is written against.
- **D-04:** Recorded real responses land in `.planning/research/fixtures/wisenet/*.json` (e.g. `students_list_page1.json`, `enrolment_detail_<id>.json`). Phase 2 copies relevant ones into `web/src/test/fixtures/wisenet/` for Vitest — keeps research evidence separate from test inputs.

### Gap-question pre-answers (WISE-06)
- **D-05: Should_Credit manual override — DROP entirely.** Accept the small loss of the per-session override column. Pending-deduction math uses `session_duration` fallback only. No Postgres overrides table, no Wisenet custom-field request, no migration of historical override values.
  - **Ripple:** Phase 2 TEST-01 must drop or adapt any `Validation.gs` assertions that exercise `Should_Credit` priority over `session_duration`. Fixture inputs in dashboard-logic tests that use `Should_Credit` need review.
- **D-06: Admin ownership — Postgres sidecar as BeGifted metadata.** Store admin ownership in a Postgres table keyed by `student_key` with `admin_key` column. Phase 2 seeds it from the current `RemainingCredits` majority-vote rollup at cutover time. Future feature: operators edit ownership via dashboard (v2). Wisenet's trainer/coordinator field is not used even if available.
- **D-07: Credit-balance model — Direct-first, derived fallback, decided per-field.** If Wisenet exposes a native balance matching our semantics (number of sessions/hours), use it. If missing or semantically wrong, derive from session history (`total − consumed`). Phase 1 must document the per-field decision for `Current Remaining Credits` and `Current Total Credits` in `WISENET_FIELD_MAP.md` based on the actual Wisenet probe.
- **D-08: Pending-deduction rule — Replicate 1:1, document RED if fields missing.** Keep the existing rule `final_status = "ENDED" AND teacher_feedback empty AND credits_consumed = 0 → count as pending`. Each of the three field ingredients gets its own row in `WISENET_FIELD_MAP.md`; any missing one is RED with a block-cutover or derivation plan. Preserves `Validation.gs` parity (minus the Should_Credit-related assertions from D-05).

### Empirical probe strategy
- **D-09:** Aggressive rate-limit fingerprint — deliberate burst of ~200 read-only GETs against a low-cardinality endpoint (e.g. students list page 1 repeatedly) to observe rate-limit threshold and response headers (`Retry-After`, `X-RateLimit-*`). Captures threshold + recovery behavior — Phase 2's WCLI-01 retry logic is written against this evidence.
- **D-10:** Probe window — off-hours AEST (evening AEST / early AM local). Tutoring centers are low-traffic outside teaching hours; minimizes operator visibility and reduces any chance of vendor alarm.
- **D-11:** Failure handling — exponential backoff with retry up to 3× (1s / 2s / 4s), then stop. Transient failures during the burst are expected; persistent failure halts the script and captures response body + headers to `.planning/research/fixtures/wisenet/_errors/`. Affected rows flagged RED in the field map.
- **D-12:** Probes are read-only GETs only. Zero writes, zero mutations, regardless of vendor risk posture. Creds are treated as sensitive; any 401/403 halts the script immediately and Kevin is notified.

### Field-map structure & RED-row decision format
- **D-13:** `WISENET_FIELD_MAP.md` is one master matrix grouped by current Sheet tab (6 sections — Aggregations, Credit_Control, Upcoming Sessions, Students, Students & Courses, RemainingCredits). Columns: `dashboard_field | consumer | wisenet_endpoint | wisenet_field | classification | confidence | notes`.
- **D-14:** Classification thresholds: **GREEN** = direct 1:1 mapping with matching semantics and type. **YELLOW** = derivable with confidence (inputs exist, logic is straightforward, no ambiguity). **RED** = gap, missing input, or unclear semantics. Confidence column is HIGH/MEDIUM/LOW, orthogonal to GREEN/YELLOW/RED.
- **D-15:** Each RED row gets a structured block immediately below the matrix: **Problem** (what's missing), **Options considered** (3-4 alternatives), **Decision** (exactly one of: `derive-client` / `accept-loss` / `postgres-sidecar` / `block-cutover`), **Rationale** (2-3 sentences), **Affects** (which WCLI/DB/TEST requirements in REQUIREMENTS.md). Planner extracts structured requirements from these blocks.
- **D-16:** After the matrix and RED blocks, a **Opportunities** section captures differentiator/parking-lot items Phase 1 discovers — invoice/payment, attendance-rate, notes, tags, webhook support — with explicit "NOT this milestone" labels. Folds back into v2 `OPS-*` / `RPT-*` / `UX-*` when a future milestone opens.

### Claude's Discretion
- Exact probe endpoint set (TBD from Postman parse, but must cover: students list, student detail, enrolment detail, past sessions, upcoming sessions, and any balance/credit endpoint if one exists)
- Exact tsx probe script layout and CLI flags
- Formatting details within the RED structured blocks (as long as the four required fields are present)
- Which specific fixture filenames to use (consistent pattern: `{resource}_{shape}_{qualifier}.json`)
- Whether to delete the probe scripts at end of Phase 1 or leave them in `web/scripts/` for later ad-hoc use (lean toward leave with a README noting Phase 1 provenance)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope and constraints
- `.planning/PROJECT.md` — Core value, in-scope/out-of-scope decisions, constraints (Wisenet read-only, Postgres for follow-up state, no parity-diff, Apps Script retirement)
- `.planning/REQUIREMENTS.md` §v1 Requirements / Wisenet Discovery — WISE-01 through WISE-06 (the 6 Phase 1 requirements)
- `.planning/ROADMAP.md` §Phase 1 Wisenet Discovery — goal, success criteria, phase dependencies

### Research baseline (what Phase 1 replaces and extends)
- `.planning/research/FEATURES.md` — Current dashboard field inventory (HIGH confidence, read directly from code). Phase 1 verifies every row in the "Wisenet API — Field Mapping" section against the real Postman collection.
- `.planning/research/FEATURES.md` §Research Blocker — explains why the original research couldn't reach the Postman SPA and what unblocks Phase 1
- `.planning/research/SUMMARY.md` §Table Stakes / Field Mapping — cross-references every dashboard field with its gap risk
- `.planning/research/SUMMARY.md` §Open Questions for Phase 0 #1-6 — the Wisenet-specific unknowns Phase 1 resolves (auth header, base URL, pagination, rate-limit headers, User ID semantics, webhook availability)
- `.planning/research/PITFALLS.md` §Pitfall 1 (field gap post-cutover) and §Pitfall 2 (silent type coercion) — the risks the field-map matrix and classification rules exist to mitigate
- `.planning/research/ARCHITECTURE.md` §Facade pattern — the target shape Phase 2's mappers must produce; informs which Wisenet fields are "essential" vs "derivable"
- `.planning/research/STACK.md` §Wisenet client — decision to use custom fetch + Zod (no SDK); shapes what probe scripts need to prove

### Code source of truth (what every dashboard field must resolve against)
- `web/src/lib/dashboard/config.ts` — `REQUIRED_COLUMNS` constant is the canonical list of fields every Wisenet row must map to. If Phase 1 adds a row not in REQUIRED_COLUMNS, flag it.
- `web/src/types/dashboard.ts` — `PackageRecord`, `StudentRecord`, `StudentQueueRow`, `CalendarPayload`, `SummaryPayload` — downstream payload types the mapped fields feed into
- `web/src/lib/dashboard/packages.ts` — Business-rule consumers (active filter, exclusion keywords, admin ownership, pending deduction, projection); each Wisenet field must survive these unchanged
- `web/src/lib/dashboard/analytics.ts` — Queue / calendar / summary aggregation; a second consumer layer to keep in mind when classifying fields
- `web/src/lib/sheets/source-loader.ts` + `web/src/lib/sheets/client.ts` — Current Sheets read layer; pattern for how the Wisenet client will be shaped in Phase 2 (WCLI-01)
- `web/scripts/compare-live.ts` — Existing tsx script pattern to model probe scripts on (env-driven, node shebang, emits to stdout/files)

### Operational / security
- `CLAUDE.md` / `AGENTS.md` §Security — credential handling rules (never commit `.env`, never paste secrets in chat; if pasted, rotate); `.clasprc.local.json` pattern for gitignored credentials
- `web/src/lib/runtime/env.ts` — Existing env-loader pattern (`required()`, `getAuthEnv()`, `getSheetsEnv()`); Phase 2 adds `getWisenetEnv()` modelled on this. Phase 1 probe scripts may read env inline but must not write env-reading patterns Phase 2 then rewrites.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `web/scripts/*.ts` + `tsx` runner — established one-shot TS script pattern (see `compare-live.ts`, `ensure-action-sheets.ts`, `ensure-inactive-sheet.ts`). Phase 1 probe scripts follow this exact pattern: `#!/usr/bin/env tsx`, read env via `process.env.WISENET_*`, emit JSON fixtures to disk.
- `web/src/lib/runtime/env.ts::required()` — validator pattern for env-var reading. Probe scripts should use the same `required(name, value)` helper (inlined or imported) to fail fast on missing creds.
- `web/.env.example` — Phase 1 updates this file (documentation only, no secrets) to declare `WISENET_*` env var names alongside existing `GOOGLE_*` / `AUTH_SECRET` / `STAFF_ALLOWLIST`.
- `web/.gitignore` — Already ignores `.env`, `.env.*`, `.env.local`. Probe scripts write fixtures to `.planning/research/fixtures/wisenet/` which is a tracked location — Phase 1 must verify recorded fixtures contain no PII/credentials before committing.

### Established Patterns
- **Memoized client pattern** (`web/src/lib/sheets/client.ts::getSheetsClient`) — Phase 2's Wisenet client will mirror this shape; Phase 1's probe scripts are lightweight enough to inline creds + fetch without needing a memoized wrapper, but the resulting endpoint catalogue should describe any per-request auth state Phase 2's memoized client needs to carry.
- **Env-var naming convention** — `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SPREADSHEET_ID`, `AUTH_SECRET`, etc. Phase 1 establishes `WISENET_*` pattern: `WISENET_BASE_URL`, `WISENET_NAMESPACE`, `WISENET_USER_ID`, `WISENET_CENTER_ID`, `WISENET_API_KEY`. Kevin confirms this matches his preference.
- **Fixture-driven testing** — `web/src/test/dashboard-logic.test.ts` drives 45+ assertions off fixture inputs. Phase 2 will add Wisenet-mapper tests following this pattern; Phase 1's `.planning/research/fixtures/wisenet/*.json` recordings are the raw material those tests will consume.

### Integration Points
- N/A — Phase 1 commits nothing to the production code path. Probe scripts live temporarily in `web/scripts/` and may be removed or kept depending on Phase 2 preference. The `.planning/research/` output is the sole durable artifact.

</code_context>

<specifics>
## Specific Ideas

- Kevin chose **aggressive rate-limit fingerprinting (~200 request burst)** over cautious probing. Rationale: wants real empirical data on Wisenet's rate-limit threshold and `Retry-After` behavior so Phase 2's WCLI-01 retry logic is written against facts, not assumptions. Accepts the vendor-visibility risk.
- Kevin chose to **drop `Should_Credit` entirely** instead of preserving it in Postgres. Rationale (implicit from selection): the override column was a manual Sheet hack whose ongoing value doesn't justify the Postgres-sidecar complexity. Ripples into Phase 2 TEST-01 — any `Validation.gs` assertion exercising `Should_Credit` must be dropped or rewritten.
- Kevin accepted **credit-balance model is decided per-field in Phase 1**, not up-front. This means the field map may produce `Current Remaining Credits = GREEN / direct` and `Current Total Credits = YELLOW / derived` (or any other combination). The flexibility is explicit.
- **Every Wisenet claim in the final deliverables must cite evidence** — either a Postman-collection quote or a captured fixture filename. No more LOW-confidence hypothesis rows survive Phase 1. This is the quality bar FEATURES.md failed to meet.
- **Probe creds are treated as compromised if pasted to chat.** Kevin handles rotation manually (no Phase 0). Phase 1 probe scripts must read from `web/.env` or environment only — never accept creds as CLI args.

</specifics>

<deferred>
## Deferred Ideas

- **Opportunities captured during Phase 1 discovery** land in a dedicated section of `WISENET_FIELD_MAP.md` with explicit "NOT this milestone" labels. Expected topics: invoice/payment status (potential new `OPS-*` / `RPT-*` requirement), attendance-rate / engagement metrics, Wisenet notes/tags as a tag-based replacement for keyword exclusion (`pretest`/`trial`), real-time webhook invalidation (mapped to existing v2 `OPS-01`).
- **Sandbox / test namespace for probes** — not pursued this phase. If Wisenet flags the production account during aggressive probing, Phase 1 pauses and Kevin requests a sandbox before resuming.
- **Historical `Should_Credit` override values** — not preserved anywhere. Action sheets remain as read-only archive per PROJECT.md, including any historical `Should_Credit` column data.
- **Vendor coordination before probes** — not pursued; accepted as acceptable vendor risk. If reconsidered, probe start is delayed until vendor response.
- **Endpoint catalogue for endpoints the dashboard does not touch** — Phase 1 still catalogues them in `WISENET_ENDPOINTS.md` (from the Postman parse — cheap) but does not probe them. Future milestones can reach in.
- **Moving probe scripts out of `web/scripts/`** after Phase 1 — deferred. Leaves them in place with a README noting Phase 1 provenance so they're discoverable but clearly labelled as research.

</deferred>

---

*Phase: 01-wisenet-discovery*
*Context gathered: 2026-04-21*
