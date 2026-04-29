// web/src/lib/db/bulk-client.ts
// Source: Plan 02-05 Task 3 + 02-CONTEXT.md §D-25 + 02-RESEARCH.md §Pattern 3
//
// Lazy-initialized WebSocket Pool client. Used ONLY by api/actions/bulk/route.ts
// (Phase 3 wires this) — transactions span multiple statements, which the HTTP
// driver cannot support.
//
// D-25 config contract:
//  - max: 3 (one pool per Fluid Compute instance; max 3 concurrent connections)
//  - idleTimeoutMillis: 30_000 (release idle clients after 30s)
//  - Singleton via globalThis.__bgBulkPool — survives across invocations within
//    the same Fluid instance so we don't reconnect per-request
//  - attachDatabasePool(pool) tells Fluid Compute to drain idle clients before
//    suspending the instance (prevents connection-pool exhaustion on burst)
//  - neonConfig.webSocketConstructor = ws set BEFORE Pool() construction;
//    required for Node runtime per @neondatabase/serverless docs
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { attachDatabasePool } from "@vercel/functions";
import ws from "ws";
import { getDbEnv } from "@/lib/runtime/env";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __bgBulkPool: Pool | undefined;
}

function getBulkPool(): Pool {
  if (globalThis.__bgBulkPool) return globalThis.__bgBulkPool;
  // ws constructor must be set BEFORE Pool() per @neondatabase/serverless docs
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({
    connectionString: getDbEnv().DATABASE_URL, // pooled URL is fine for WebSocket Pool
    max: 3,
    idleTimeoutMillis: 30_000,
  });
  attachDatabasePool(pool);
  globalThis.__bgBulkPool = pool;
  return pool;
}

export function getBulkDb() {
  return drizzle({ client: getBulkPool(), schema });
}

// Test-only helper — resets singleton. Production code must NEVER call this.
export function __resetBulkPoolForTest(): void {
  if (globalThis.__bgBulkPool) {
    void globalThis.__bgBulkPool.end();
    globalThis.__bgBulkPool = undefined;
  }
}

// Test accessor — returns the underlying Pool (for Pool-config assertions).
export function __getBulkPoolForTest(): Pool | undefined {
  return globalThis.__bgBulkPool;
}
