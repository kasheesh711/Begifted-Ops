// web/src/lib/db/client.ts
// Source: Plan 02-05 Task 3 + 02-RESEARCH.md §Pattern 3 + D-17
//
// Default Drizzle client — HTTP driver via @neondatabase/serverless::neon.
// Zero connection-pool overhead on Vercel Fluid Compute: each invocation
// issues a stateless HTTP request. Used by:
//  - All dashboard read paths (queue, calendar, history)
//  - Single-statement writes (set/clear action state, inactive toggle)
//
// NOT used for transactions — HTTP cannot span BEGIN...COMMIT. See bulk-client.ts
// for the WebSocket Pool variant that handles the one bulk-action transaction
// path (Phase 3 api/actions/bulk/route.ts).
//
// Phase 3 SVC-02 lazy-init note: Next.js 16 collects page data at build time by
// importing every route module — which would cascade into this file and call
// getDbEnv() with no DATABASE_URL set in the build runner. The Proxy below
// defers the neon() + drizzle() calls until the first actual db.select() /
// db.insert() / db.execute() call at request time, when the env var IS set.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getDbEnv } from "@/lib/runtime/env";
import * as schema from "./schema";

type Schema = typeof schema;
export type Database = NeonHttpDatabase<Schema>;

let cachedDb: Database | null = null;
let cachedSql: NeonQueryFunction<false, false> | null = null;

function getRealDb(): Database {
  if (cachedDb) return cachedDb;
  cachedSql = neon(getDbEnv().DATABASE_URL);
  cachedDb = drizzle({ client: cachedSql, schema });
  return cachedDb;
}

// Proxy: every property access goes through getRealDb(), which throws at
// request time if DATABASE_URL is missing — but does NOT throw at build/
// page-data-collection time when the route module is merely imported.
export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const real = getRealDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});
