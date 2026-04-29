# Wisenet Probe Scripts (Phase 1 Discovery Provenance)

## What These Are

The scripts named `wisenet-postman-parse.ts` and `wisenet-probe-*.ts` in this
directory (when they land in Phase 1 Plans 02-04) are **Phase 1 research
artifacts**, not Phase 2 production code. They exist to parse the Wisenet
Postman collection, fingerprint auth / pagination / rate-limit behavior, and
record real Wisenet responses as JSON fixtures under
`.planning/research/fixtures/wisenet/`.

Phase 2's production Wisenet client lives at `web/src/lib/wisenet/*` and is
**separate from these scripts**. The scripts are never imported by anything
under `web/src/**`; they run standalone via `tsx`.

> **Plan 01-01 note:** Plan 01 creates this README and the fixture directory
> scaffolding *before* the probe scripts exist. That is intentional — per
> D-16 Claude's-discretion recommendation ("lean toward leave with a README
> noting Phase 1 provenance"), the README is in place so that when Plans
> 02-04 add `wisenet-postman-parse.ts`, `wisenet-probe-auth.ts`,
> `wisenet-probe-pagination.ts`, `wisenet-probe-rate-limit.ts`, and
> `wisenet-probe-field-shape.ts`, there is immediately a provenance note
> explaining why they are here.

## How To Run

Each probe script follows the same invocation pattern:

```bash
cd web
# Required env vars must be set in web/.env (gitignored) or exported first:
#   WISENET_BASE_URL    — e.g. https://api.wisenet.co/v1/ (resolved in Plan 02)
#   WISENET_API_KEY     — bearer or x-api-key credential
#   WISENET_USER_ID     — audit attribution / HMAC signing input
#   WISENET_CENTER_ID   — center scope for begifted-education
#   WISENET_NAMESPACE=begifted-education (locked by D-01)

npx tsx scripts/wisenet-postman-parse.ts
npx tsx scripts/wisenet-probe-auth.ts
npx tsx scripts/wisenet-probe-pagination.ts
npx tsx scripts/wisenet-probe-rate-limit.ts
npx tsx scripts/wisenet-probe-field-shape.ts
```

The env vars themselves are documented (with empty values, no secrets) in
`web/.env.example`. Real values live only in `web/.env` which is gitignored.

## Phase 1 Outputs

These scripts are the tooling that produces the Phase 1 durable artifacts:

- `.planning/research/WISENET_ENDPOINTS.md` — endpoint catalogue parsed from
  `wisenet-postman.json` and verified against live probe responses
- `.planning/research/WISENET_FIELD_MAP.md` — master field matrix (6 tabs,
  25 required rows) with GREEN/YELLOW/RED classification, confidence, and
  Postman/Fixture citations
- `.planning/research/fixtures/wisenet/*.json` — raw recorded Wisenet
  responses used as evidence in `WISENET_FIELD_MAP.md`
- `.planning/research/fixtures/wisenet/_rate-limit-fingerprint.json` and
  `_pagination-fingerprint.json` — synthesized rate-limit and pagination
  shape documents

## Off-Hours AEST Window (D-10)

The rate-limit probe (`wisenet-probe-rate-limit.ts`) and field-shape probe
(`wisenet-probe-field-shape.ts`) **must be run during the off-hours window**
— AEST evening / early AM local time per D-10. Tutoring centers are
low-traffic outside teaching hours; minimizes operator visibility and reduces
any chance of vendor alarm.

The auth probe and Postman parse are low-traffic and can run at any time.

## Safety Rules (D-11, D-12)

These scripts are **read-only GET probes**. Zero writes, zero mutations,
regardless of vendor risk posture.

- **Exponential backoff:** 1s / 2s / 4s with 3 retries max per D-11.
  Persistent failure after retries halts the script and captures response
  body + headers to `.planning/research/fixtures/wisenet/_errors/`.
- **Auth failure halts immediately:** any 401/403 halts the script with
  `process.exitCode = 2` per D-12. Credentials are treated as sensitive; any
  401/403 means Kevin is notified to check for key rotation / revocation.
- **No writes regardless of risk posture:** zero `PUT`, `POST`, `PATCH`,
  `DELETE` against Wisenet. Probes use `GET` only per D-12.
- **Creds from env only:** probe scripts read `WISENET_*` from
  `process.env` — never accept creds as CLI args, never paste into logs,
  never write creds to fixtures.

## Lifecycle

- **During Phase 1:** Run locally by Kevin to capture fixtures and generate
  the endpoint + field-map markdown.
- **During Phase 2:** Probe scripts may be re-run for ad-hoc debugging while
  `web/src/lib/wisenet/*` is wired up. They are **not imported** by
  `web/src/**` and do not ship to production.
- **After Phase 2 cutover:** Scripts can be archived to `docs/archive/` or
  deleted entirely if Kevin prefers. The durable artifacts are the
  `.planning/research/` markdown + fixtures, not the scripts themselves.
