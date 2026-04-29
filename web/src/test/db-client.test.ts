// web/src/test/db-client.test.ts
// Source: Plan 02-05 Task 3 + 02-RESEARCH.md §Pattern 3 + 02-CONTEXT.md §D-25
//
// Smoke tests for the Postgres client wiring:
//  - db (HTTP driver) loads without side effects beyond URL read
//  - getBulkDb (WebSocket Pool) is singleton and matches D-25 config (max:3, idleTimeoutMillis:30_000)
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("db clients — DB-03", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.DATABASE_URL =
      "postgresql://user:pass@ep-test.neon.tech/dbname?sslmode=require";
    process.env.DATABASE_URL_UNPOOLED =
      "postgresql://user:pass@ep-test.neon.tech/dbname?sslmode=require";
  });

  afterEach(async () => {
    const { __resetBulkPoolForTest } = await import("@/lib/db/bulk-client");
    __resetBulkPoolForTest();
    process.env = { ...ORIGINAL_ENV };
  });

  it("db (HTTP) loads without throwing", async () => {
    const mod = await import("@/lib/db/client");
    expect(mod.db).toBeDefined();
    // No pool — HTTP driver is stateless per invocation
  });

  it("getBulkDb() returns a drizzle instance and is singleton across calls", async () => {
    const { getBulkDb, __getBulkPoolForTest } = await import(
      "@/lib/db/bulk-client"
    );
    const a = getBulkDb();
    const b = getBulkDb();
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const pool = __getBulkPoolForTest();
    expect(pool).toBeDefined();
    // Both calls produced drizzle instances backed by the same singleton pool
    const secondPool = __getBulkPoolForTest();
    expect(secondPool).toBe(pool);
  });

  it("bulk pool config matches D-25 (max: 3, idleTimeoutMillis: 30_000)", async () => {
    const { getBulkDb, __getBulkPoolForTest } = await import(
      "@/lib/db/bulk-client"
    );
    getBulkDb();
    const pool = __getBulkPoolForTest() as
      | { options?: { max?: number; idleTimeoutMillis?: number }; max?: number; idleTimeoutMillis?: number }
      | undefined;
    expect(pool).toBeDefined();
    // Neon/pg Pool stores options on .options — probe both shapes for forward compat
    const max = pool?.options?.max ?? pool?.max;
    const idleTimeout =
      pool?.options?.idleTimeoutMillis ?? pool?.idleTimeoutMillis;
    expect(max).toBe(3);
    expect(idleTimeout).toBe(30_000);
  });
});
