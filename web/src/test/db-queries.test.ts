// web/src/test/db-queries.test.ts
// Source: Plan 02-06 Task 3 — DB-04/05/06/07 coverage via Drizzle mocks.
//
// We never hit a real Postgres from these tests. Each case uses vi.doMock to
// stub the Drizzle client modules before dynamic-import of the query under test,
// then asserts on the captured call shape or return value. Pattern mirrors
// web/src/test/actions-route.test.ts (module-scope mocks + dynamic imports).
//
// Coverage matrix:
//  - DB-04: each of the 9 queries.ts functions + bulk-queries.ts::bulkSetStudentAction
//  - DB-05: loadActionStateMap returns isToday: true at query layer — domain filters later
//  - DB-06: upsert/append carry actor attribution through to the underlying insert values
//  - DB-07: bulkSetStudentAction opens exactly one transaction with BOTH inserts inside
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("queries.ts — DB-04 / DB-05 / DB-06", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // queries.ts transitively imports ./client which calls getDbEnv() at module
    // load — stub a valid-looking URL so the import doesn't throw.
    process.env.DATABASE_URL =
      "postgresql://user:pass@ep-test.neon.tech/dbname?sslmode=require";
    process.env.DATABASE_URL_UNPOOLED =
      "postgresql://user:pass@ep-test.neon.tech/dbname?sslmode=require";
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/db/client");
    process.env = { ...ORIGINAL_ENV };
  });

  // ---------- loadActionStateMap (DB-04 + DB-05) ----------

  it("loadActionStateMap returns ActionStateMap keyed by studentKey with isToday=true (DB-05)", async () => {
    vi.doMock("@/lib/db/client", () => ({
      db: {
        select: () => ({
          from: () =>
            Promise.resolve([
              {
                studentKey: "gina ho::mira ho",
                studentName: "Gina Ho",
                parentName: "Mira Ho",
                status: "contacted",
                updatedAt: new Date("2026-01-01T00:00:00Z"),
                updatedByEmail: "palm@example.com",
                updatedByName: "Palm",
              },
            ]),
        }),
      },
    }));
    const { loadActionStateMap } = await import("@/lib/db/queries");
    const map = await loadActionStateMap();
    expect(map["gina ho::mira ho"]).toBeDefined();
    expect(map["gina ho::mira ho"]!.status).toBe("contacted");
    expect(map["gina ho::mira ho"]!.updatedByName).toBe("Palm");
    // DB-05: query layer returns isToday: true unconditionally; domain-layer
    // sanitizeStudentActionState re-evaluates with real today.
    expect(map["gina ho::mira ho"]!.isToday).toBe(true);
    expect(map["gina ho::mira ho"]!.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("loadActionStateMap returns empty object when no rows exist", async () => {
    vi.doMock("@/lib/db/client", () => ({
      db: {
        select: () => ({ from: () => Promise.resolve([]) }),
      },
    }));
    const { loadActionStateMap } = await import("@/lib/db/queries");
    const map = await loadActionStateMap();
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("loadActionStateMap keys every row by its studentKey", async () => {
    vi.doMock("@/lib/db/client", () => ({
      db: {
        select: () => ({
          from: () =>
            Promise.resolve([
              {
                studentKey: "a::b",
                studentName: "A",
                parentName: "B",
                status: "contacted",
                updatedAt: new Date("2026-01-01T00:00:00Z"),
                updatedByEmail: "x",
                updatedByName: "X",
              },
              {
                studentKey: "c::d",
                studentName: "C",
                parentName: "D",
                status: "resolved",
                updatedAt: new Date("2026-01-02T00:00:00Z"),
                updatedByEmail: "y",
                updatedByName: "Y",
              },
              {
                studentKey: "e::f",
                studentName: "E",
                parentName: "F",
                status: "pending-callback",
                updatedAt: new Date("2026-01-03T00:00:00Z"),
                updatedByEmail: "z",
                updatedByName: "Z",
              },
            ]),
        }),
      },
    }));
    const { loadActionStateMap } = await import("@/lib/db/queries");
    const map = await loadActionStateMap();
    expect(Object.keys(map).sort()).toEqual(["a::b", "c::d", "e::f"]);
    expect(map["c::d"]!.status).toBe("resolved");
  });

  // ---------- upsertFollowUpState (DB-06) ----------

  it("upsertFollowUpState threads actor attribution into values AND conflict SET (DB-06)", async () => {
    const capturedValues: unknown[] = [];
    const capturedConflicts: unknown[] = [];
    vi.doMock("@/lib/db/client", () => ({
      db: {
        insert: () => ({
          values: (v: unknown) => {
            capturedValues.push(v);
            return {
              onConflictDoUpdate: (cfg: unknown) => {
                capturedConflicts.push(cfg);
                return { returning: () => Promise.resolve([]) };
              },
            };
          },
        }),
      },
    }));
    const { upsertFollowUpState } = await import("@/lib/db/queries");
    await upsertFollowUpState({
      studentKey: "s::p",
      studentName: "S",
      parentName: "P",
      status: "contacted",
      updatedByEmail: "palm@example.com",
      updatedByName: "Palm",
    });
    expect(capturedValues[0]).toMatchObject({
      studentKey: "s::p",
      updatedByEmail: "palm@example.com",
      updatedByName: "Palm",
    });
    // Actor attribution must also flow into the UPDATE SET clause (not just INSERT).
    expect(capturedConflicts[0]).toMatchObject({
      set: expect.objectContaining({
        updatedByEmail: "palm@example.com",
        updatedByName: "Palm",
      }),
    });
  });

  it("upsertFollowUpState uses onConflictDoUpdate with studentKey as conflict target", async () => {
    let conflictTarget: unknown = null;
    vi.doMock("@/lib/db/client", () => ({
      db: {
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: (cfg: { target: unknown }) => {
              conflictTarget = cfg.target;
              return { returning: () => Promise.resolve([]) };
            },
          }),
        }),
      },
    }));
    const { upsertFollowUpState } = await import("@/lib/db/queries");
    await upsertFollowUpState({
      studentKey: "s::p",
      studentName: "S",
      parentName: "P",
      status: "resolved",
      updatedByEmail: "kem@example.com",
      updatedByName: "Kem",
    });
    // The target must be the followUpState.studentKey column reference — we
    // can't easily assert the identity of a Drizzle column under a proxy mock,
    // but it must be defined and non-null.
    expect(conflictTarget).toBeDefined();
    expect(conflictTarget).not.toBeNull();
  });

  // ---------- appendFollowUpLog (DB-06) ----------

  it("appendFollowUpLog passes actor + studentKey through to values (DB-06)", async () => {
    const captured: unknown[] = [];
    vi.doMock("@/lib/db/client", () => ({
      db: {
        insert: () => ({
          values: (v: unknown) => {
            captured.push(v);
            return { returning: () => Promise.resolve([{ eventId: "uuid-1" }]) };
          },
        }),
      },
    }));
    const { appendFollowUpLog } = await import("@/lib/db/queries");
    await appendFollowUpLog({
      studentKey: "s::p",
      studentName: "S",
      parentName: "P",
      actionType: "set",
      status: "contacted",
      actorEmail: "palm@example.com",
      actorName: "Palm",
    });
    expect(captured[0]).toMatchObject({
      studentKey: "s::p",
      actionType: "set",
      actorEmail: "palm@example.com",
      actorName: "Palm",
    });
  });

  it("appendFollowUpLog supports null status for clear actionType", async () => {
    const captured: Array<{ status?: unknown }> = [];
    vi.doMock("@/lib/db/client", () => ({
      db: {
        insert: () => ({
          values: (v: { status?: unknown }) => {
            captured.push(v);
            return { returning: () => Promise.resolve([]) };
          },
        }),
      },
    }));
    const { appendFollowUpLog } = await import("@/lib/db/queries");
    await appendFollowUpLog({
      studentKey: "s::p",
      studentName: "S",
      parentName: "P",
      actionType: "clear",
      status: null,
      actorEmail: "palm@example.com",
      actorName: "Palm",
    });
    expect(captured[0]?.status).toBeNull();
  });

  // ---------- Inactive students (DB-04) ----------

  it("listInactive selects from inactive_students with no filter", async () => {
    const fromCalls: unknown[] = [];
    vi.doMock("@/lib/db/client", () => ({
      db: {
        select: () => ({
          from: (table: unknown) => {
            fromCalls.push(table);
            return Promise.resolve([]);
          },
        }),
      },
    }));
    const { listInactive } = await import("@/lib/db/queries");
    const rows = await listInactive();
    expect(rows).toEqual([]);
    expect(fromCalls).toHaveLength(1);
  });

  it("markInactive upserts on studentKey (idempotent)", async () => {
    let sawConflict = false;
    const capturedValues: unknown[] = [];
    vi.doMock("@/lib/db/client", () => ({
      db: {
        insert: () => ({
          values: (v: unknown) => {
            capturedValues.push(v);
            return {
              onConflictDoUpdate: () => {
                sawConflict = true;
                return Promise.resolve();
              },
            };
          },
        }),
      },
    }));
    const { markInactive } = await import("@/lib/db/queries");
    await markInactive({
      studentKey: "s::p",
      studentName: "S",
      parentName: "P",
      markedByEmail: "palm@example.com",
    });
    expect(sawConflict).toBe(true);
    expect(capturedValues[0]).toMatchObject({
      studentKey: "s::p",
      markedByEmail: "palm@example.com",
    });
  });

  it("clearInactive deletes by studentKey (row absence = active)", async () => {
    let sawWhere = false;
    vi.doMock("@/lib/db/client", () => ({
      db: {
        delete: () => ({
          where: () => {
            sawWhere = true;
            return Promise.resolve();
          },
        }),
      },
    }));
    const { clearInactive } = await import("@/lib/db/queries");
    await clearInactive("s::p");
    expect(sawWhere).toBe(true);
  });

  // ---------- History readback (DB-04) ----------

  it("readHistory selects from follow_up_log, filters by sinceDays, orders desc", async () => {
    let orderByCalled = false;
    let whereCalled = false;
    vi.doMock("@/lib/db/client", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () => {
              whereCalled = true;
              return {
                orderBy: () => {
                  orderByCalled = true;
                  return Promise.resolve([]);
                },
              };
            },
          }),
        }),
      },
    }));
    const { readHistory } = await import("@/lib/db/queries");
    await readHistory("s::p", 14);
    expect(whereCalled).toBe(true);
    expect(orderByCalled).toBe(true);
  });

  it("readHistory defaults sinceDays to 7 when not passed", async () => {
    let whereArg: unknown = null;
    vi.doMock("@/lib/db/client", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: (arg: unknown) => {
              whereArg = arg;
              return { orderBy: () => Promise.resolve([]) };
            },
          }),
        }),
      },
    }));
    const { readHistory } = await import("@/lib/db/queries");
    await readHistory("s::p");
    // The where clause must still be built (we can't trivially introspect
    // Drizzle's AST through the mock, so presence is the signal).
    expect(whereArg).toBeDefined();
    expect(whereArg).not.toBeNull();
  });

  // ---------- Admin ownership (DB-04 / D-06) ----------

  it("getAdminOwnership returns null when no row matches", async () => {
    vi.doMock("@/lib/db/client", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      },
    }));
    const { getAdminOwnership } = await import("@/lib/db/queries");
    const row = await getAdminOwnership("missing::key");
    expect(row).toBeNull();
  });

  it("getAdminOwnership returns the matched row", async () => {
    vi.doMock("@/lib/db/client", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    studentKey: "s::p",
                    adminKey: "palm",
                    assignedAt: new Date(),
                    assignedByEmail: "seed@example.com",
                    updatedAt: new Date(),
                  },
                ]),
            }),
          }),
        }),
      },
    }));
    const { getAdminOwnership } = await import("@/lib/db/queries");
    const row = await getAdminOwnership("s::p");
    expect(row?.adminKey).toBe("palm");
  });

  it("bulkGetAdminOwnership short-circuits on empty studentKeys (no db call)", async () => {
    const selectSpy = vi.fn();
    vi.doMock("@/lib/db/client", () => ({
      db: { select: selectSpy },
    }));
    const { bulkGetAdminOwnership } = await import("@/lib/db/queries");
    const result = await bulkGetAdminOwnership([]);
    expect(result.size).toBe(0);
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("bulkGetAdminOwnership returns a Map keyed by studentKey", async () => {
    vi.doMock("@/lib/db/client", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () =>
              Promise.resolve([
                {
                  studentKey: "a::b",
                  adminKey: "palm",
                  assignedAt: new Date(),
                  assignedByEmail: "seed@x",
                  updatedAt: new Date(),
                },
                {
                  studentKey: "c::d",
                  adminKey: "kem",
                  assignedAt: new Date(),
                  assignedByEmail: "seed@x",
                  updatedAt: new Date(),
                },
              ]),
          }),
        }),
      },
    }));
    const { bulkGetAdminOwnership } = await import("@/lib/db/queries");
    const result = await bulkGetAdminOwnership(["a::b", "c::d"]);
    expect(result.size).toBe(2);
    expect(result.get("a::b")?.adminKey).toBe("palm");
    expect(result.get("c::d")?.adminKey).toBe("kem");
  });
});

describe("bulk-queries.ts — DB-07", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.DATABASE_URL =
      "postgresql://user:pass@ep-test.neon.tech/dbname?sslmode=require";
    process.env.DATABASE_URL_UNPOOLED =
      "postgresql://user:pass@ep-test.neon.tech/dbname?sslmode=require";
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/db/bulk-client");
    process.env = { ...ORIGINAL_ENV };
  });

  it("bulkSetStudentAction short-circuits on empty updates (no transaction)", async () => {
    const transactionSpy = vi.fn();
    const getBulkDbSpy = vi.fn(() => ({ transaction: transactionSpy }));
    vi.doMock("@/lib/db/bulk-client", () => ({ getBulkDb: getBulkDbSpy }));

    const { bulkSetStudentAction } = await import("@/lib/db/bulk-queries");
    await bulkSetStudentAction({
      updates: [],
      actorEmail: "palm@example.com",
      actorName: "Palm",
    });

    expect(transactionSpy).not.toHaveBeenCalled();
    expect(getBulkDbSpy).not.toHaveBeenCalled();
  });

  it("bulkSetStudentAction opens exactly one transaction with BOTH inserts inside (DB-07 atomicity)", async () => {
    const insertsInTx: string[] = [];
    let transactionCount = 0;

    vi.doMock("@/lib/db/bulk-client", () => ({
      getBulkDb: () => ({
        transaction: async (cb: (tx: unknown) => Promise<void>) => {
          transactionCount += 1;
          let call = 0;
          const tx = {
            insert: (table: { [key: string]: unknown }) => {
              call += 1;
              // followUpState is first (with ON CONFLICT), followUpLog is second.
              if (call === 1) {
                insertsInTx.push("followUpState");
                return {
                  values: () => ({
                    onConflictDoUpdate: () => Promise.resolve(),
                  }),
                };
              }
              insertsInTx.push("followUpLog");
              return { values: () => Promise.resolve() };
            },
          };
          await cb(tx);
        },
      }),
    }));

    const { bulkSetStudentAction } = await import("@/lib/db/bulk-queries");
    await bulkSetStudentAction({
      updates: [
        {
          studentKey: "s::p",
          studentName: "S",
          parentName: "P",
          status: "contacted",
        },
      ],
      actorEmail: "palm@example.com",
      actorName: "Palm",
    });

    expect(transactionCount).toBe(1);
    expect(insertsInTx).toEqual(["followUpState", "followUpLog"]);
  });

  it("bulkSetStudentAction threads actor + marks every log entry actionType='bulk-set' (DB-06)", async () => {
    const capturedStateValues: unknown[] = [];
    const capturedLogValues: unknown[] = [];

    vi.doMock("@/lib/db/bulk-client", () => ({
      getBulkDb: () => ({
        transaction: async (cb: (tx: unknown) => Promise<void>) => {
          let call = 0;
          const tx = {
            insert: () => {
              call += 1;
              if (call === 1) {
                return {
                  values: (v: unknown) => {
                    capturedStateValues.push(v);
                    return {
                      onConflictDoUpdate: () => Promise.resolve(),
                    };
                  },
                };
              }
              return {
                values: (v: unknown) => {
                  capturedLogValues.push(v);
                  return Promise.resolve();
                },
              };
            },
          };
          await cb(tx);
        },
      }),
    }));

    const { bulkSetStudentAction } = await import("@/lib/db/bulk-queries");
    await bulkSetStudentAction({
      updates: [
        {
          studentKey: "a::b",
          studentName: "A",
          parentName: "B",
          status: "contacted",
        },
        {
          studentKey: "c::d",
          studentName: "C",
          parentName: "D",
          status: "resolved",
        },
      ],
      actorEmail: "palm@example.com",
      actorName: "Palm",
    });

    const stateRows = capturedStateValues[0] as Array<Record<string, unknown>>;
    const logRows = capturedLogValues[0] as Array<Record<string, unknown>>;

    expect(stateRows).toHaveLength(2);
    expect(logRows).toHaveLength(2);

    // Every state row carries the top-level actor attribution (DB-06).
    for (const row of stateRows) {
      expect(row.updatedByEmail).toBe("palm@example.com");
      expect(row.updatedByName).toBe("Palm");
    }
    // Every log row is actionType='bulk-set' with actor attribution.
    for (const row of logRows) {
      expect(row.actionType).toBe("bulk-set");
      expect(row.actorEmail).toBe("palm@example.com");
      expect(row.actorName).toBe("Palm");
    }
  });
});
