# Phase 1: Wisenet Discovery - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 01-wisenet-discovery
**Areas discussed:** Wisenet access method, 4 gap-question pre-answers, Empirical probe strategy, Field-map structure & RED-row decision format

---

## Wisenet access method

### Q1: How do you want to supply Wisenet truth so discovery can actually produce a field map?

| Option | Description | Selected |
|--------|-------------|----------|
| Postman JSON export + live key | Export the Postman collection as JSON to `.planning/research/wisenet-postman.json`; the Wisenet API key lives in `web/.env`. Claude parses the collection and runs targeted probes. Highest fidelity. | ✓ |
| Postman export only, no probes | Collection JSON gives endpoints + param schemas; rate-limits / pagination / real response shapes stay hypothesis. Safer (zero production calls). | |
| Live key + pasted samples, no Postman export | Skip the collection export, hit live endpoints with the key, and paste sample responses. | |
| Sandbox / test namespace | Request a non-production Wisenet tenant for probes. Zero risk but vendor-coordination delay. | |

**User's choice:** Postman JSON export + live key
**Notes:** Matches the existing pattern and unblocks the primary research blocker that stopped FEATURES.md.

### Q2: Where should the Wisenet credentials live during Phase 1 discovery?

| Option | Description | Selected |
|--------|-------------|----------|
| `web/.env` only | Credentials in gitignored `web/.env`; probe scripts run from `web/` via tsx and read `process.env`. | ✓ |
| Vercel env + local `web/.env` | Provision in Vercel production/preview too, not just locally. | |
| Separate `.planning/.wisenet.env` | Isolate Phase 1 probe creds from the Next.js app entirely. | |

**User's choice:** `web/.env` only
**Notes:** Matches existing `getAuthEnv` / `getSheetsEnv` pattern, requires no new infrastructure.

### Q3: Who runs probes against Wisenet during Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Claude via tsx scripts in `web/scripts` | Claude writes probe scripts under `web/scripts/wisenet-probe-*.ts`; Kevin runs them locally with env vars set. Output captured into `.planning/research/fixtures/`. | ✓ |
| User manually via Postman | Kevin hits each endpoint interactively, pastes responses. | |
| Both — scripts for bulk, Postman for ad-hoc | Scripts for systematic sweep + rate-limit probes; Postman for one-off shape inspection. | |

**User's choice:** Claude via tsx scripts in `web/scripts`
**Notes:** Leverages existing tsx script pattern (`compare-live.ts`, `ensure-action-sheets.ts`).

### Q4: How should Postman collection parsing produce a canonical endpoint catalogue?

| Option | Description | Selected |
|--------|-------------|----------|
| Parse to `.planning/research/WISENET_ENDPOINTS.md` | Tsx script reads Postman JSON and emits a human-readable catalogue. Becomes the reference Phase 2 writes `lib/wisenet/endpoints.ts` against. | ✓ |
| Fold endpoints into `WISENET_FIELD_MAP.md` | One combined doc. Fewer files, but field map gets very long. | |
| Skip catalogue — only document endpoints actually used | Lean output; risks missing an endpoint Phase 2 discovers it needs. | |

**User's choice:** Parse to `.planning/research/WISENET_ENDPOINTS.md`
**Notes:** Clean separation of endpoint contract from field mapping.

---

## 4 gap-question pre-answers

### Q1: Should_Credit manual override — how should per-session credit overrides survive migration?

| Option | Description | Selected |
|--------|-------------|----------|
| Move to Postgres, keyed by session_id (Recommended) | Override lives in an overrides table keyed by Wisenet session_id. | |
| Drop the override entirely | Accept the loss, rely on session_duration fallback. Simplest. | ✓ |
| Request a Wisenet custom field | Ask vendor to expose a writable custom field; introduces vendor coordination + write-back path. | |

**User's choice:** Drop the override entirely
**Notes:** Ripples into Phase 2 TEST-01 — any `Validation.gs` assertions exercising Should_Credit priority over session_duration must be dropped or rewritten.

### Q2: Admin ownership — how do we keep the majority-vote admin-per-student feature?

| Option | Description | Selected |
|--------|-------------|----------|
| Postgres sidecar as BeGifted metadata (Recommended) | Store admin ownership in a Postgres table (`student_key` → `admin_key`). Decouples from Wisenet's teacher-per-class model. Phase 1 seeds from current RemainingCredits majority-vote. | ✓ |
| Derive from Wisenet trainer/coordinator field | Map Wisenet's trainer/coordinator on enrolment to our 6-admin registry via name match. | |
| Hybrid — Postgres canonical, Wisenet as seed | Postgres canonical; initial population uses Wisenet trainer when it maps, majority-vote otherwise. | |

**User's choice:** Postgres sidecar as BeGifted metadata (Recommended)
**Notes:** Gives future flexibility (operator-edit ownership UI as v2 feature).

### Q3: Credit-balance model — how do Current Remaining Credits / Current Total Credits flow post-migration?

| Option | Description | Selected |
|--------|-------------|----------|
| Direct-first, derived fallback (Recommended) | Use Wisenet's native balance field if it exists AND matches semantics. If not, compute total − consumed from session history. Decision per-field after Phase 1 probe. | ✓ |
| Always derive from session history | Ignore any native balance field, always compute. Predictable but more expensive. | |
| Only direct — block cutover if Wisenet lacks native balance | Strict dependency on Wisenet exposing the field. | |

**User's choice:** Direct-first, derived fallback (Recommended)
**Notes:** Flexibility preserved — the field map will record the per-field decision with evidence.

### Q4: Pending-deduction rule — current rule needs 3 fields. Plan if Wisenet exposes fewer?

| Option | Description | Selected |
|--------|-------------|----------|
| Replicate 1:1, document RED if fields missing (Recommended) | Keep the current rule intact. Missing field → RED with block-cutover or derivation plan. Preserves Validation.gs parity. | ✓ |
| Adapt rule to whatever Wisenet exposes as 'unscored' | Accept Wisenet's native session-state model. Parity tests update to match new semantics. | |
| Drop pending-deduction entirely | Show balances only as-is. | |

**User's choice:** Replicate 1:1, document RED if fields missing (Recommended)
**Notes:** Behavioral parity with Validation.gs is the cutover safety net.

---

## Empirical probe strategy

### Q1: What probe volume is acceptable against live Wisenet?

| Option | Description | Selected |
|--------|-------------|----------|
| Cautious: ~50 total requests, sequential (Recommended) | Read-only GETs across endpoints, spaced 200ms. Enough for pagination + rate-limit header shape without vendor alarm. | |
| Aggressive: burst of ~200 req for rate-limit fingerprint | Explicitly try to hit the rate limit to learn its threshold and retry behavior. | ✓ |
| Minimal: shape-only, no rate-limit probe | One GET per resource type. Rate-limit undocumented. | |

**User's choice:** Aggressive: burst of ~200 req for rate-limit fingerprint
**Notes:** Kevin prioritizes real empirical data over vendor-safety; Phase 2 retry logic will be written against actual Wisenet rate-limit behavior, not guessed defaults.

### Q2: When should probes run?

| Option | Description | Selected |
|--------|-------------|----------|
| Off-hours (evening AEST / early AM local) (Recommended) | Centers are low-traffic outside teaching hours. | ✓ |
| Anytime during Phase 1 | No time restriction. Fastest elapsed time. | |
| Coordinate with Wisenet vendor first | Email support that probes will run in window X. Day or two delay. | |

**User's choice:** Off-hours (evening AEST / early AM local) (Recommended)

### Q3: What happens when a probe fails?

| Option | Description | Selected |
|--------|-------------|----------|
| Log + stop + flag in field map (Recommended) | First failure halts script, captures body/headers, flags RED. | |
| Exponential backoff + retry 3x then stop | Script retries up to 3 times (1s, 2s, 4s). More likely to complete on transient errors. | ✓ |
| Fail-fast: single attempt, no retry | Any non-2xx captures and exits. | |

**User's choice:** Exponential backoff + retry 3x then stop
**Notes:** Consistent with aggressive probe volume — transient errors during a burst are expected and should not abort the fingerprint.

### Q4: Where do fixture captures land?

| Option | Description | Selected |
|--------|-------------|----------|
| `.planning/research/fixtures/wisenet/*.json` (Recommended) | Raw JSON responses per endpoint. Phase 2 copies relevant ones into `web/src/test/fixtures/wisenet/`. | ✓ |
| Directly to `web/src/test/fixtures/wisenet/*.json` | Skips copy step but couples docs-only Phase 1 to code path. | |
| Inline in `WISENET_FIELD_MAP.md` | Short JSON snippets embedded in markdown. | |

**User's choice:** `.planning/research/fixtures/wisenet/*.json` (Recommended)

---

## Field-map structure & RED-row decision format

### Q1: How should WISENET_FIELD_MAP.md be structured?

| Option | Description | Selected |
|--------|-------------|----------|
| One master matrix, grouped by Sheet tab (Recommended) | Single table with 6 sections. Fast scan for Phase 2. | ✓ |
| Per-tab sections with narrative + mini-matrix | Each tab has narrative + its own table. More context, longer doc. | |
| Matrix + per-field deep-dive for REDs only | Master matrix on top; each RED links to a detailed subsection. | |

**User's choice:** One master matrix, grouped by Sheet tab (Recommended)

### Q2: What defines GREEN / YELLOW / RED classification?

| Option | Description | Selected |
|--------|-------------|----------|
| GREEN=direct 1:1, YELLOW=derived confident, RED=gap or low confidence (Recommended) | Matches FEATURES.md framing; low-ambiguity bar. | ✓ |
| Strict: GREEN only if exact name+type+nullability match | Pushes more rows into YELLOW/RED. | |
| Loose: GREEN if derivable at all | Risks burying coercion bugs. | |

**User's choice:** GREEN=direct 1:1, YELLOW=derived confident, RED=gap or low confidence (Recommended)

### Q3: What's the format of each RED-row decision?

| Option | Description | Selected |
|--------|-------------|----------|
| Structured block per RED (Recommended) | Fixed shape: Problem / Options considered / Decision / Rationale / Affects. Planner extracts structured requirements. | ✓ |
| One-liner decision per RED | Terse `Decision: postgres-sidecar`. Loses rationale. | |
| Prose paragraph per RED | Free-form narrative. Readable but inconsistent. | |

**User's choice:** Structured block per RED (Recommended)

### Q4: Should the field map also capture differentiator/parking-lot opportunities?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, in a separate Opportunities section (Recommended) | Captured at bottom of field map, flagged for v2 backlog. | ✓ |
| No, strict table-stakes only | Opportunities stay in FEATURES.md. | |
| Yes, in a sibling `.planning/research/WISENET_OPPORTUNITIES.md` | Separate document. | |

**User's choice:** Yes, in a separate Opportunities section (Recommended)

---

## Claude's Discretion

- Exact probe endpoint set (TBD from Postman parse; must cover students, enrolment, past sessions, upcoming sessions, any balance/credit endpoint)
- Exact tsx probe script layout and CLI flags
- Formatting inside RED structured blocks (four required fields must be present)
- Specific fixture filenames (consistent `{resource}_{shape}_{qualifier}.json` pattern)
- Whether probe scripts remain in `web/scripts/` after Phase 1 (lean toward keeping with README)

## Deferred Ideas

- Invoice/payment, attendance-rate, notes/tags, webhooks → Opportunities section in WISENET_FIELD_MAP.md (v2 backlog)
- Sandbox/test namespace → only if production account is flagged
- Historical Should_Credit values → not preserved anywhere (action sheets remain as archive)
- Vendor coordination before probes → accepted as vendor risk
- Endpoint catalogue covers all endpoints, probes only cover dashboard-relevant subset
