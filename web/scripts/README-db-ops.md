# DB Operations

Two scripts live under `web/scripts/`. Both are invoked via `tsx` and read env vars.

## scripts/db-migrate.ts (DB-08)

Applies pending Drizzle migrations from `web/drizzle/` against the target database.

### Env vars

- `DATABASE_URL_UNPOOLED` — direct Neon URL (unpooled). The Vercel Marketplace Neon integration auto-injects this across prod/preview/dev. For local runs, pull via:
  ```bash
  vercel env pull web/.env
  ```

### Invocation

- **Locally:** `cd web && npm run db:migrate`
- **CI:** GitHub Actions workflow `.github/workflows/db-migrate.yml` runs on push-to-main when `web/drizzle/**`, `web/src/lib/db/schema.ts`, or `web/scripts/db-migrate.ts` change. Also triggerable via `workflow_dispatch` (manual trigger via GitHub UI).

### Setup (one-time)

1. Operator provisions Neon Postgres via Vercel Marketplace:
   - Vercel dashboard → Project → Storage → Browse Marketplace → Neon → Connect
   - Marketplace auto-injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) to prod/preview/dev envs.
2. Set GitHub Actions secret `DATABASE_URL_UNPOOLED`:
   - Repo Settings → Secrets and variables → Actions → New repository secret
   - Value: copy from Vercel env (use `vercel env pull web/.env` locally to check). If Vercel Marketplace Neon integration syncs secrets at repo level, GitHub will sync automatically — otherwise copy manually.
3. Local sync: `vercel env pull web/.env` populates `DATABASE_URL_UNPOOLED` in `web/.env`.

### Generating new migrations

After editing `web/src/lib/db/schema.ts`:
```bash
cd web && npm run db:generate -- --name=<short-name>
```
Drizzle-kit writes a new `web/drizzle/NNNN_<name>.sql` file plus meta updates. Commit the new SQL + `meta/_journal.json` + `meta/<N>_snapshot.json` in the same PR as the schema change. The CI workflow picks it up on merge.

### Why unpooled?

PgBouncer (pooled `DATABASE_URL`) is incompatible with advisory locks + some CREATE TABLE metadata ops (see `.planning/research/PITFALLS.md` §Pitfall 3). Migrations need the direct URL. Runtime HTTP + WebSocket clients use the pooled URL for different concerns.

### Q3: Neon preview branches

- Vercel Marketplace Neon integration creates a branch per preview deploy automatically.
- Drizzle's `__drizzle_migrations` table DOES inherit from parent on branch creation, so preview-side migrations are idempotent.
- If a migration fails on preview, Vercel blocks the preview URL from going live — same safety model as main.
- First preview PR after Neon is provisioned should verify this behavior empirically; document any drift here.

## scripts/seed-admin-ownership.ts (D-21)

One-off cutover seed. Runs at Phase 3 cutover day to populate `student_admin_ownership` from the live Apps Script `buildStudentAdminOwnershipMap` function (which aggregates the current `RemainingCredits` sheet via majority vote).

### Env vars

- `DATABASE_URL_UNPOOLED` (same as db-migrate)
- `SEED_ACTOR_EMAIL` (optional) — stamped into `assigned_by_email` column. Defaults to `seed@begifted-ops.local`.

### Prerequisites

- `.clasprc.local.json` present at repo root (gitignored per security policy; your local clasp auth)
- Global `clasp` binary installed (same baseline as existing Apps Script dev flow — `clasp run runValidationSuite` already uses it)
- Apps Script project `1kAv9ICE5DQqE17JWynXJoV2Lu2bgs7pjzAfDzLNZ-1aMjhq_yKky1MQ6` authorized for Google Sheets access

### Invocation

```bash
cd web && npm run db:seed-admin
```

### Expected output

```
[seed-admin-ownership] Running `clasp run buildStudentAdminOwnershipMap` from repo root...
[seed-admin-ownership] ✓ Validated <N> rows against allowlist
[seed-admin-ownership]   upserted <N>/<N> rows
[seed-admin-ownership] ✓ Seeded <N> admin-ownership rows
```

### What happens

1. `clasp run buildStudentAdminOwnershipMap` against the live Apps Script project (executed with repo-root cwd so clasp finds `.clasp.json` + `.clasprc.local.json`)
2. Parse returned JSON (expected shape: `{ [studentKey]: { adminKey, source } }`)
3. Validate every `adminKey` against the allowlist (palm/kem/care/aya/petchy/muk/unassigned) — fails loudly on any invalid value
4. Drizzle `INSERT ... ON CONFLICT (student_key) DO UPDATE` in batches of 500 — idempotent; re-running reconciles Sheet → Postgres drift

### Fallback

If `clasp run` fails (auth drift, Apps Script offline, invalid response), the script writes the error + partial output to `.planning/research/admin-ownership-seed.json` for manual review and exits with code 1. Nothing is inserted. Same behavior if the JSON is malformed or any `adminKey` is outside the allowlist — the suspicious payload is preserved so a human can decide what to do.

### Q4: Idempotency vs future dashboard edit UI

- This script uses `ON CONFLICT (student_key) DO UPDATE SET admin_key = EXCLUDED.admin_key, updated_at = NOW()`.
- **Consequence:** re-running this script AFTER operators edit ownership via a dashboard UI (future Phase 3+) would OVERWRITE their edits with the Sheet's majority vote.
- **Mitigation:** only run this script once, at Phase 3 cutover. Document in the Phase 3 cutover checklist. When the future "edit admin ownership" UI lands, either remove this script or add a guard that refuses to run if `student_admin_ownership.updated_at > student_admin_ownership.assigned_at` for any row (indicating a manual edit happened).
- Phase 5 retires the `RemainingCredits` sheet source; at that point this script should be marked deprecated.

### Troubleshooting

- `clasp run` fails → check `.clasprc.local.json` exists, re-authenticate via `clasp login` if needed.
- `DATABASE_URL_UNPOOLED is required` → run `vercel env pull web/.env` or export in your shell.
- Script halts with "Invalid adminKey" → a Sheet row has an admin outside the allowlist; inspect the fallback `.planning/research/admin-ownership-seed.json` and correct the Sheet before re-running.

## CI workflow: .github/workflows/db-migrate.yml (DB-08)

Runs on:
- `push` to `main` when paths match the schema/migration glob (`web/drizzle/**`, `web/src/lib/db/schema.ts`, `web/scripts/db-migrate.ts`)
- `workflow_dispatch` (manual trigger via GitHub UI)

Requires `DATABASE_URL_UNPOOLED` as a GitHub repo secret. If the Vercel Marketplace Neon integration is configured at repo level, GitHub should sync the secret automatically; otherwise copy manually from `vercel env ls` into GitHub repo Settings → Secrets.

Deploy sequencing: CI-job migration runs BEFORE Vercel deploy promotes new code. If the migration fails, the Vercel deploy should not ship the new schema-dependent code — runtime schema stays consistent.
