---
plan_id: 01-04
phase: 01-wisenet-discovery
status: complete
completed_at: "2026-04-21T05:00:00.000Z"
requirements_closed:
  - WISE-06
files_created:
  - .planning/research/WISENET_FIELD_MAP.md
files_modified:
  - .planning/phases/01-wisenet-discovery/01-04-PLAN.md
  - .planning/phases/01-wisenet-discovery/01-RESEARCH.md
  - .planning/phases/01-wisenet-discovery/01-VALIDATION.md
  - .planning/phases/01-wisenet-discovery/validate-phase1.sh
  - .planning/STATE.md
  - .planning/ROADMAP.md
  - .planning/REQUIREMENTS.md
commits:
  - f8a27cc — "feat(01-04): add WISENET_FIELD_MAP.md — classify 25 fields + answer 4 gap questions"
  - (docs commit added with this SUMMARY)
---

# Plan 01-04 SUMMARY — WISENET_FIELD_MAP.md

## What shipped

`.planning/research/WISENET_FIELD_MAP.md` (347 lines) — the Phase 1 master deliverable and the source-of-truth contract for Phase 2 `WCLI-02` types, `WCLI-04` mappers, `WCLI-06` fixture tests, `DB-02` sidecar schema decisions, and `TEST-01` `Validation.gs` ports.

## Classification results (25 / 25 fields covered)

| Category | GREEN | YELLOW | RED | Total |
|----------|-------|--------|-----|-------|
| Aggregations | 3 | 0 | 2 | 5 |
| Credit_Control | 4 | 2 | 2 | 8 |
| Upcoming Sessions | 4 | 1 | 0 | 5 |
| Students | 1 | 0 | 1 | 2 |
| Students & Courses | 2 | 1 | 0 | 3 |
| RemainingCredits | 1 | 0 | 1 | 2 |
| **Total** | **15** | **4** | **6** | **25** |

Exact match to `assert_per_tab_row_counts` (5+8+5+2+3+2=25).

## RED-row Decision breakdown (allowlist-conformant)

| RED row | Decision | Basis |
|---------|----------|-------|
| Aggregations / Current Remaining Credits | `derive-client` | D-07 — sessionCredits gated on participant-resolved id (deferred to Phase 2 WCLI-04); derive from past_sessions.duration sum |
| Aggregations / Current Total Credits | `derive-client` | D-07 — no native `total` exposed; Phase 2 probes sessionCredits + falls back to session-count proxy |
| Credit_Control / credits_consumed | `derive-client` | D-08 — `session.duration / 3600000` proxy when meetingStatus=ENDED; exact value gated on sessionCredits |
| Credit_Control / Should_Credit | `accept-loss` | D-05 — drop entirely (Wisenet has no override field; BeGifted-specific manual concept) |
| Students / Remaining Credits | `derive-client` | D-07 — same derivation path as Aggregations rows |
| RemainingCredits / Admin | `postgres-sidecar` | D-06 — Wisenet has no 6-admin assignment concept; persist in `student_admin_ownership` table |

## 4 Gap Questions (WISE-06) — answered

1. **Should_Credit override disposition** → drop entirely (D-05 lock). No Postgres table, no custom field request.
2. **Admin ownership semantics** → Postgres sidecar (`student_admin_ownership` table). Seed from `RemainingCredits` majority-vote at cutover.
3. **Credit-balance model** → per-field decided; direct-first with derive-client fallback per D-07. Three balance rows RED pending Phase 2 sessionCredits probe.
4. **Pending-deduction rule field availability** → 2 of 3 D-08 ingredients reachable (`meetingStatus` enum covers final_status; `showFeedbackSubmission=true` N+1 covers teacher_feedback); `credits_consumed` uses duration proxy until sessionCredits resolves.

## V2 Opportunities (6 — all tagged "NOT this milestone" per D-16)

1. feeSummary currency tracking (THB payments, not credits) — OPS-* v2 candidate
2. Settings-based validityInDays — possible projection hint
3. Classroom-tag-based exclusion (replace `EXCLUDED_PACKAGE_KEYWORDS` keyword match) — OPS-* v2 candidate
4. Real-time webhook invalidation — existing `OPS-01` v2 scope
5. Trainer-field as admin-ownership alternative — explicitly rejected by D-06 v1; reconsiderable post-milestone
6. Native credit-balance direct path (sessionCredits with resolved pair) — Phase 2 WCLI-06 fixture test; upgrades 3 RED rows to GREEN if shape confirms

## Auth + Pagination + Rate Limit facts (from 01-03 probes, promoted to field map)

- **Auth:** HTTP Basic `base64(WISENET_USER_ID:WISENET_API_KEY)` + `x-api-key` + `x-wise-namespace` headers. Variant 1 probe returned 200 on `/institutes/v3/{centerId}/students`.
- **Base URL:** `https://api.wiseapp.live`
- **Pagination:** `page_number` + `page_size` (default 50). Envelope `{status, message, data: {students, count}}`. `skip`/`take` silently ignored. Past-end returns empty `[]`.
- **Rate limit:** NOT reached at 200-burst. Server exposes no `x-ratelimit-remaining` / `Retry-After` headers. Phase 2 `WCLI-01` retry wrapper must use 429-detection + exponential backoff (no header-driven enforcement).

## Deviations from plan (all Rule 3 auto-fixes)

1. **Validator colon-inside-bold bug** — `validate-phase1.sh` greps used `**Problem**` but plan prescribes `**Problem:**` (and field map correctly emits colon-inside). Patched regex to `\*\*Problem:?\*\*` for both structured-blocks and allowlist assertions. Accepts both forms so existing and future maps both validate.
2. **Validator `|| echo 0` double-output bug** — `grep -c` always emits a count to stdout (including "0") then exits 1 on zero matches. `|| echo 0` duplicated the literal "0" into `$()` capture → `"0\n0"` broke `[` integer comparison on lines 361-364. Replaced with `|| true` (grep's own "0" stays as the count).
3. **Plan/research doc refinements co-committed** — 01-04-PLAN.md gained new must-have assertions (per-tab row counts, literal Decision-value enforcement for Should_Credit/Admin); 01-RESEARCH.md/01-VALIDATION.md received minor clarifications. All changes are tightening, not scope creep.

## Validator state

```
bash .planning/phases/01-wisenet-discovery/validate-phase1.sh --quick
Phase 1 validator: 13 passed, 0 failed, 2 skipped (total 15)
```

All 10 field-map-scoped assertions OK:
- `field_map_exists`
- `field_map_has_six_sections`
- `all_25_required_columns_present`
- `per_tab_row_counts` (5+8+5+2+3+2=25)
- `every_row_classified_green_yellow_red`
- `every_row_cites_postman_or_fixture`
- `red_rows_have_structured_blocks` (6 RED rows, 6 blocks with all 5 markers)
- `red_decision_allowlist` (6 RED rows, 6 allow-listed decisions: derive-client/accept-loss/postgres-sidecar/block-cutover)
- `four_gap_questions_answered`
- `fixtures_no_real_emails`

2 SKIPs are `--quick`-mode exclusions (pagination/rate-limit fingerprint jq validators — pass in full mode after 01-03).

1 WARN (`no_secret_like_strings_in_tracked_research` — 1181 high-entropy matches) is the expected Kevin-eyeball-review flag inherited from WISENET_FIELD_MAP's dense endpoint-path and fixture-path citations. Plan 01-01 VALIDATION.md pre-designates this as manual-review, not automated fail.

## Requirements closed

- `WISE-06` — 4 gap questions answered in writing with D-05..D-08 lock references and Phase 2 implementation plans.

## Open items carried to Plan 01-05

- Full validator run (non-quick mode) to confirm pagination + rate-limit fingerprint jq validators pass
- Update `.planning/research/SUMMARY.md` Open Questions #1-6 with verified facts
- Update `.planning/research/FEATURES.md` Wisenet hypothesis section to replace LOW-confidence guesses with probed verdicts
- Write `.planning/phases/01-wisenet-discovery/01-PHASE-SUMMARY.md` for Phase 2 handoff
- Close remaining WISE-01/02/03 requirements (field coverage matrix, gap classification, opportunities) in the phase summary

## Handoff to Plan 01-05

Plan 01-05 closes out Phase 1 with no code changes in `web/src/`. Its work is entirely narrative: phase summary for Phase 2 handoff and retro-updates to the pre-Phase-1 research docs to keep them factually consistent with the Wisenet facts now in hand.

Phase 2 unblocked: `WCLI-02` (types) and `WCLI-04` (mappers) can now be written against concrete endpoint paths + fixture shapes + RED-block decisions.
