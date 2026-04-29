#!/usr/bin/env tsx
// DB-08 migration runner per D-22.
// Invoked by: GH Actions CI workflow (push-to-main) or manually via `npm run db:migrate`.
// Uses DATABASE_URL_UNPOOLED (direct Neon URL) — PgBouncer is incompatible with
// advisory locks and some CREATE TABLE metadata ops (see .planning/research/PITFALLS.md
// §Pitfall 3). Runtime HTTP/WebSocket clients use the pooled DATABASE_URL — different
// concern. This script is operator-invoked (CI or local); never runs inside
// instrumentation.ts or next build per DB-08 explicit exclusion.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    console.error(
      "[db-migrate] DATABASE_URL_UNPOOLED is required. Vercel Marketplace Neon integration auto-injects this in prod/preview; for local runs, pull via `vercel env pull web/.env`.",
    );
    process.exit(1);
  }

  // Redact password/key segment for log safety (T-02-40 mitigation).
  // Pattern: protocol://user:PASSWORD@host/... — replace PASSWORD with <REDACTED>.
  const redactedUrl = url.replace(/:[^:@]*@/, ":<REDACTED>@");
  console.log(`[db-migrate] → Running migrations against ${redactedUrl}`);

  const sqlClient = neon(url);
  const db = drizzle({ client: sqlClient });

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[db-migrate] ✓ migrations applied successfully");
  } catch (err) {
    console.error("[db-migrate] ✗ migration failed:", err);
    process.exit(1);
  }
}

main();
