import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSessionUser = vi.fn();
const getDashboardPayload = vi.fn();
const setStudentActionInSheets = vi.fn();
const clearStudentActionInSheets = vi.fn();
const revalidateTag = vi.fn();
const recordCacheInvalidation = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireSessionUser,
}));

vi.mock("@/lib/dashboard/service", () => ({
  getDashboardPayload,
}));

vi.mock("@/lib/sheets/actions", () => ({
  setStudentActionInSheets,
  clearStudentActionInSheets,
}));

vi.mock("next/cache", () => ({
  revalidateTag,
}));

vi.mock("@/lib/dashboard/health-state", () => ({
  recordCacheInvalidation,
}));

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

  it("writes a student action and invalidates the cache", async () => {
    setStudentActionInSheets.mockResolvedValue({
      studentKey: "jade lim::ivy lim",
      actionState: {
        status: "contacted",
        updatedAt: "2026-03-31T10:00:00+07:00",
        updatedByName: "Palm",
        isToday: true,
      },
    });

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
    expect(setStudentActionInSheets).toHaveBeenCalledWith(
      expect.objectContaining({
        studentKey: "jade lim::ivy lim",
        studentName: "Jade Lim",
        parentName: "Ivy Lim",
      }),
    );
    expect(revalidateTag).toHaveBeenCalledWith("dashboard-payload", "max");
    expect(recordCacheInvalidation).toHaveBeenCalledTimes(1);
    expect(body.actionState.status).toBe("contacted");
  });

  it("deduplicates bulk student keys before writing", async () => {
    setStudentActionInSheets.mockResolvedValue({
      studentKey: "jade lim::ivy lim",
      actionState: {
        status: "resolved",
        updatedAt: "2026-03-31T10:00:00+07:00",
        updatedByName: "Palm",
        isToday: true,
      },
    });

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
    expect(setStudentActionInSheets).toHaveBeenCalledTimes(2);
    expect(body.updated).toHaveLength(2);
  });
});
