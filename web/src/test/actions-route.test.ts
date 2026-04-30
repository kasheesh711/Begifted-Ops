import { beforeEach, describe, expect, it, vi } from "vitest";

// Module-scope mock handles for the new actions.ts facade (SVC-03/04 swap).
// The Sheets-era mocks (setStudentActionInSheets, clearStudentActionInSheets,
// invalidateDashboardPayloadCache) are gone — route handlers now call
// setStudentAction / clearStudentAction / bulkSetAction from the facade,
// which owns the revalidateTag call internally (D-28). Tests therefore mock
// only the facade methods; cache invalidation is verified at the facade
// unit-test level, not here.
const requireSessionUser = vi.fn();
const getDashboardPayload = vi.fn();
const setStudentAction = vi.fn();
const clearStudentAction = vi.fn();
const bulkSetAction = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireSessionUser,
}));

vi.mock("@/lib/dashboard/service", () => ({
  getDashboardPayload,
}));

// Spread vi.importActual so the real normalizeStudentActionStatus stays
// available to the route handlers (which import it from the same module).
// The 5 mutation methods get replaced by the mocks above.
vi.mock("@/lib/dashboard/actions", async () => {
  const actual = (await vi.importActual("@/lib/dashboard/actions")) as Record<string, unknown>;
  return {
    ...actual,
    setStudentAction,
    clearStudentAction,
    bulkSetAction,
  };
});

describe("action routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireSessionUser.mockResolvedValue({ email: "palm@example.com", name: "Palm" });
    getDashboardPayload.mockResolvedValue({
      students: [
        {
          studentKey: "jade lim::ivy lim",
          student: "Jade Lim",
          parent: "Ivy Lim",
        },
        {
          studentKey: "gina ho::mira ho",
          student: "Gina Ho",
          parent: "Mira Ho",
        },
      ],
    });
  });

  it("returns 400 when studentKey is missing", async () => {
    const { POST } = await import("@/app/api/actions/route");
    const response = await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        body: JSON.stringify({ status: "contacted" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("writes a student action via the facade and returns ok", async () => {
    setStudentAction.mockResolvedValue(undefined);

    const { POST } = await import("@/app/api/actions/route");
    const response = await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        body: JSON.stringify({ studentKey: "jade lim::ivy lim", status: "contacted" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(setStudentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        studentKey: "jade lim::ivy lim",
        studentName: "Jade Lim",
        parentName: "Ivy Lim",
        status: "contacted",
        updatedByEmail: "palm@example.com",
        updatedByName: "Palm",
      }),
    );
    expect(clearStudentAction).not.toHaveBeenCalled();
    expect(body).toEqual({ ok: true });
  });

  it("clears a student action via the facade when status is null", async () => {
    clearStudentAction.mockResolvedValue(undefined);

    const { POST } = await import("@/app/api/actions/route");
    const response = await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        body: JSON.stringify({ studentKey: "jade lim::ivy lim", status: null }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(clearStudentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        studentKey: "jade lim::ivy lim",
        studentName: "Jade Lim",
        parentName: "Ivy Lim",
        actorEmail: "palm@example.com",
        actorName: "Palm",
      }),
    );
    expect(setStudentAction).not.toHaveBeenCalled();
    expect(body).toEqual({ ok: true });
  });

  it("deduplicates bulk student keys before invoking the facade", async () => {
    bulkSetAction.mockResolvedValue(undefined);

    const { POST } = await import("@/app/api/actions/bulk/route");
    const response = await POST(
      new Request("http://localhost/api/actions/bulk", {
        method: "POST",
        body: JSON.stringify({
          studentKeys: ["jade lim::ivy lim", "jade lim::ivy lim", "gina ho::mira ho"],
          status: "resolved",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    // Single facade call (single transaction) — not per-student loop like the Sheets-era version.
    expect(bulkSetAction).toHaveBeenCalledTimes(1);
    const call = bulkSetAction.mock.calls[0]?.[0] as {
      updates: Array<{ studentKey: string }>;
      actorEmail: string;
      actorName: string;
    };
    expect(call.updates.map((u) => u.studentKey)).toEqual([
      "jade lim::ivy lim",
      "gina ho::mira ho",
    ]);
    expect(call.actorEmail).toBe("palm@example.com");
    expect(call.actorName).toBe("Palm");
    expect(body.updated).toEqual(["jade lim::ivy lim", "gina ho::mira ho"]);
  });
});
