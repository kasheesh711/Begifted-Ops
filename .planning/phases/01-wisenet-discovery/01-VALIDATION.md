---
phase: 1
slug: wisenet-discovery
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bash (POSIX) — grep/wc/jq assertions over markdown + JSON fixtures |
| **Config file** | `.planning/phases/01-wisenet-discovery/validate-phase1.sh` (Wave 0 creates) |
| **Quick run command** | `bash .planning/phases/01-wisenet-discovery/validate-phase1.sh --quick` |
| **Full suite command** | `bash .planning/phases/01-wisenet-discovery/validate-phase1.sh` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bash .planning/phases/01-wisenet-discovery/validate-phase1.sh --quick`
- **After every plan wave:** Run `bash .planning/phases/01-wisenet-discovery/validate-phase1.sh`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | WISE-01..06 | — | N/A (docs-only phase) | assertion | TBD (planner fills) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner MUST populate this table with one row per task, mapping each task to WISE-01..06, the grep/jq assertion that validates it, and which Wave 0 file the assertion runs against.*

---

## Wave 0 Requirements

- [ ] `.planning/phases/01-wisenet-discovery/validate-phase1.sh` — POSIX bash assertion script (25 REQUIRED_COLUMNS rows present, RED block structure, fixture-citation coverage, endpoint catalogue completeness)
- [ ] `.planning/research/fixtures/wisenet/.gitkeep` — fixture root directory
- [ ] `.planning/research/fixtures/wisenet/_errors/.gitkeep` — error capture directory per D-11
- [ ] `web/scripts/README-wisenet-probes.md` — README noting Phase 1 provenance per D-09 Claude's Discretion
- [ ] `web/.env.example` — add `WISENET_*` placeholders (no secrets)

*These Wave 0 files are required before any probe script runs — the validator must be in place before it has anything to validate against, so failures surface early.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fixture PII redaction | WISE-03 | No automated redaction validator exists; operator eyeballs before commit | Kevin reviews each fixture under `.planning/research/fixtures/wisenet/` pre-commit; checks no real student names, emails, DOBs, phone numbers survive |
| RED row decision rationale soundness | WISE-06 | Technical judgement call (derive-client vs postgres-sidecar) — grep can assert structure but not reasoning quality | Kevin reviews each RED block's Decision + Rationale before marking phase done |
| Off-hours probe timing | WISE-04 | Probe timestamps are operational evidence, not code-checkable | Kevin confirms probe invocations happened in AEST evening / early AM window per D-10 |
| Borderline UUID-shape strings in fixtures | WISE-03 | UUIDs may be internal IDs (benign) or shared secrets (sensitive) — automatic classifier unreliable | Kevin reviews each high-entropy-match flagged by probe validator; UUIDs that map to student/enrolment/session IDs are benign and retained, anything else is redacted or synthetic-replaced |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
