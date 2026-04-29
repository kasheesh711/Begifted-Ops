#!/usr/bin/env tsx
// D-21 one-off cutover seed.
// Runs `clasp run buildStudentAdminOwnershipMap` against the live Apps Script project,
// validates the returned JSON against the admin-key allowlist, then bulk-inserts into
// student_admin_ownership via Drizzle. Idempotent on student_key (ON CONFLICT DO UPDATE).
//
// Fallback: on clasp-run failure OR malformed JSON OR invalid admin_key, writes the
// received-or-error JSON to .planning/research/admin-ownership-seed.json for manual
// review and exits non-zero. Nothing is inserted when fallback fires.
//
// Threat mitigations:
// - T-02-39: VALID_ADMIN_KEYS allowlist validation rejects any value outside the registry
// - T-02-41: onConflictDoUpdate on studentKey PK preserves uniqueness
// - T-02-43: fallback JSON contains clasp output — reviewer-only, never auto-inserted

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import { studentAdminOwnership } from "../src/lib/db/schema";
import {
  ADMIN_OWNER_REGISTRY,
  UNASSIGNED_ADMIN_KEY,
} from "../src/lib/dashboard/config";

// Fallback path relative to web/ cwd — resolves to repo-root/.planning/research/admin-ownership-seed.json
const FALLBACK_PATH = resolve("..", ".planning/research/admin-ownership-seed.json");
const SEED_ACTOR = process.env.SEED_ACTOR_EMAIL ?? "seed@begifted-ops.local";

// Allowlist derived from single sources of truth (6 named admins + unassigned fallback).
const VALID_ADMIN_KEYS = new Set<string>([
  ...ADMIN_OWNER_REGISTRY.map((a) => a.key),
  UNASSIGNED_ADMIN_KEY,
]);

type AdminKey =
  | "palm"
  | "kem"
  | "care"
  | "aya"
  | "petchy"
  | "muk"
  | "unassigned";

interface OwnershipJsonEntry {
  adminKey: string;
  source?: string;
}

type OwnershipJson = Record<string, OwnershipJsonEntry>;

function writeFallback(body: unknown): void {
  try {
    mkdirSync(dirname(FALLBACK_PATH), { recursive: true });
  } catch {
    /* best-effort; writeFileSync below surfaces the real error */
  }
  writeFileSync(FALLBACK_PATH, JSON.stringify(body, null, 2));
  console.error(
    `[seed-admin-ownership] ✗ Wrote fallback JSON to ${FALLBACK_PATH} — review before re-running`,
  );
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    console.error(
      "[seed-admin-ownership] DATABASE_URL_UNPOOLED is required — pull via `vercel env pull web/.env` or export in your shell",
    );
    process.exit(1);
  }

  // Step 1 — invoke Apps Script via clasp
  let claspOutput: string;
  try {
    console.log(
      "[seed-admin-ownership] Running `clasp run buildStudentAdminOwnershipMap` from repo root...",
    );
    claspOutput = execSync("clasp run buildStudentAdminOwnershipMap", {
      cwd: resolve(".."), // repo root where .clasp.json + .clasprc.local.json live
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    console.error(
      "[seed-admin-ownership] ✗ clasp run failed — is .clasprc.local.json present + authorized?",
    );
    writeFallback({ error: String(e), partial: null, timestamp: new Date().toISOString() });
    process.exit(1);
  }

  // Step 2 — parse JSON. clasp emits the function return value serialized; any parse
  // failure means the shape changed and a human needs to look at it.
  let ownership: OwnershipJson;
  try {
    ownership = JSON.parse(claspOutput) as OwnershipJson;
  } catch (e) {
    console.error(
      "[seed-admin-ownership] ✗ clasp output is not valid JSON",
    );
    writeFallback({ error: String(e), claspOutput, timestamp: new Date().toISOString() });
    process.exit(1);
  }

  if (!ownership || typeof ownership !== "object" || Object.keys(ownership).length === 0) {
    console.error(
      "[seed-admin-ownership] ✗ clasp returned empty ownership map — sanity-check Apps Script buildStudentAdminOwnershipMap",
    );
    writeFallback({ error: "empty-or-invalid-shape", ownership });
    process.exit(1);
  }

  // Step 3 — allowlist validation (T-02-39). Every admin_key must be in the registry.
  for (const [studentKey, entry] of Object.entries(ownership)) {
    if (!entry || typeof entry.adminKey !== "string") {
      console.error(
        `[seed-admin-ownership] ✗ Malformed entry for ${studentKey}: missing adminKey`,
      );
      writeFallback({ error: "malformed-entry", studentKey, entry, ownership });
      process.exit(1);
    }
    if (!VALID_ADMIN_KEYS.has(entry.adminKey)) {
      console.error(
        `[seed-admin-ownership] ✗ Invalid adminKey for ${studentKey}: ${entry.adminKey}`,
      );
      console.error(
        `  Allowed: ${[...VALID_ADMIN_KEYS].join(", ")}`,
      );
      writeFallback({ error: "invalid-admin-key", studentKey, entry, ownership });
      process.exit(1);
    }
  }

  console.log(
    `[seed-admin-ownership] ✓ Validated ${Object.keys(ownership).length} rows against allowlist`,
  );

  // Step 4 — bulk upsert via Drizzle (T-02-41). Chunks of 500 bound parameter count.
  const sqlClient = neon(url);
  const db = drizzle({ client: sqlClient });

  const values = Object.entries(ownership).map(([studentKey, entry]) => ({
    studentKey,
    adminKey: entry.adminKey as AdminKey,
    assignedByEmail: SEED_ACTOR,
  }));

  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < values.length; i += BATCH) {
    const chunk = values.slice(i, i + BATCH);
    await db
      .insert(studentAdminOwnership)
      .values(chunk)
      .onConflictDoUpdate({
        target: studentAdminOwnership.studentKey,
        set: {
          adminKey: sql`excluded.admin_key`,
          assignedByEmail: sql`excluded.assigned_by_email`,
          updatedAt: sql`now()`,
        },
      });
    upserted += chunk.length;
    console.log(
      `[seed-admin-ownership]   upserted ${upserted}/${values.length} rows`,
    );
  }

  console.log(
    `[seed-admin-ownership] ✓ Seeded ${upserted} admin-ownership rows`,
  );
}

main().catch((err) => {
  console.error("[seed-admin-ownership] ✗ seed failed:", err);
  process.exit(1);
});
