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
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getDbEnv } from "@/lib/runtime/env";
import * as schema from "./schema";

const sql = neon(getDbEnv().DATABASE_URL);

export const db = drizzle({ client: sql, schema });

export type Database = typeof db;
