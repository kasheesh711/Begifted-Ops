// web/src/test/wisenet-endpoints.test.ts
// WCLI-03 coverage: URL construction + pagination iteration + path-typo fix.
// Mocks fetch at the network boundary and inspects the URL wisenetFetch built.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAuthHeaderCacheForTest } from "@/lib/wisenet/client";

describe("wisenet endpoints — URL construction + pagination", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    __resetAuthHeaderCacheForTest();
    envSnapshot = {
      WISENET_BASE_URL: process.env.WISENET_BASE_URL,
      WISENET_USER_ID: process.env.WISENET_USER_ID,
      WISENET_API_KEY: process.env.WISENET_API_KEY,
      WISENET_CENTER_ID: process.env.WISENET_CENTER_ID,
      WISENET_NAMESPACE: process.env.WISENET_NAMESPACE,
    };
    process.env.WISENET_BASE_URL = "https://api.wiseapp.live";
    process.env.WISENET_USER_ID = "u1";
    process.env.WISENET_API_KEY = "k1";
    process.env.WISENET_CENTER_ID = "center-XYZ";
    process.env.WISENET_NAMESPACE = "begifted-education";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function mockResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  function envelope(items: Record<string, unknown>) {
    return { status: 200, message: "ok", data: items };
  }

  function studentRow(id: string, name: string) {
    return { _id: id, name, uuid: `u-${id}`, activated: true };
  }

  function sessionRow(id: string) {
    return {
      _id: id,
      classId: { _id: "c1", name: "Math", subject: "Mathematics" },
      userId: { _id: "t1", name: "Teacher" },
      scheduledStartTime: "2026-04-21T09:00:00Z",
      meetingStatus: "ENDED",
      duration: 3_600_000,
      students: ["s1"],
    };
  }

  function fetchUrl(callIndex: number): URL {
    const arg = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[callIndex][0];
    // wisenetFetch passes a URL object directly; URL constructor accepts URL | string.
    return new URL(arg as URL | string);
  }

  it("getStudents hits the v3 path with encoded center ID and page params", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(envelope({ students: [studentRow("s1", "Alice")], count: 1 })),
    );
    const { getStudents } = await import("@/lib/wisenet/endpoints");
    const students = await getStudents();
    expect(students).toHaveLength(1);
    const url = fetchUrl(0);
    expect(url.pathname).toBe("/institutes/v3/center-XYZ/students");
    expect(url.searchParams.get("page_number")).toBe("1");
    expect(url.searchParams.get("page_size")).toBe("50");
    // Path-typo negative check — no trailing `s` on center ID segment.
    expect(url.pathname).not.toContain("center-XYZs/students");
  });

  it("getStudents iterates pages until short-page termination", async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => studentRow(`s${i}`, `A${i}`));
    const shortPage = [
      studentRow("s50", "LAST"),
      studentRow("s51", "X"),
      studentRow("s52", "Y"),
    ];
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockResponse(envelope({ students: fullPage, count: 50 })))
      .mockResolvedValueOnce(mockResponse(envelope({ students: shortPage, count: 3 })));

    const { getStudents } = await import("@/lib/wisenet/endpoints");
    const students = await getStudents();
    expect(students).toHaveLength(53);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    const secondUrl = fetchUrl(1);
    expect(secondUrl.searchParams.get("page_number")).toBe("2");
  });

  it("getStudents terminates after first page when it's already short", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(envelope({ students: [studentRow("s1", "Only")], count: 1 })),
    );
    const { getStudents } = await import("@/lib/wisenet/endpoints");
    const students = await getStudents();
    expect(students).toHaveLength(1);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("getStudent hits /institutes/<center>/participants/<id>?showRegistrationData=true with encoded id", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(envelope({ user: { _id: "s1", name: "A", parentIds: [] } })),
    );
    const { getStudent } = await import("@/lib/wisenet/endpoints");
    await getStudent("student-id-with-slash/ok");
    const url = fetchUrl(0);
    expect(url.pathname).toBe(
      `/institutes/center-XYZ/participants/${encodeURIComponent("student-id-with-slash/ok")}`,
    );
    expect(url.searchParams.get("showRegistrationData")).toBe("true");
  });

  it("getParents with empty array short-circuits without fetching", async () => {
    const { getParents } = await import("@/lib/wisenet/endpoints");
    const result = await getParents([]);
    expect(result.size).toBe(0);
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("getParents de-duplicates IDs in the query csv", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(envelope({ parents: [{ _id: "p1", name: "Alice" }, { _id: "p2", name: "Bob" }] })),
    );
    const { getParents } = await import("@/lib/wisenet/endpoints");
    await getParents(["p1", "p1", "p2", "p2", "p1"]);
    const url = fetchUrl(0);
    const idsRaw = url.searchParams.get("ids") ?? "";
    const ids = idsRaw.split(",");
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(new Set(ids)).toEqual(new Set(["p1", "p2"]));
  });

  it("getPastSessions sends ISO date window + status=PAST&paginateBy=DATE", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(envelope({ sessions: [sessionRow("se1")], count: 1 })),
    );
    const { getPastSessions } = await import("@/lib/wisenet/endpoints");
    await getPastSessions(
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-04-21T00:00:00Z"),
    );
    const url = fetchUrl(0);
    expect(url.pathname).toBe("/institutes/center-XYZ/sessions");
    expect(url.searchParams.get("status")).toBe("PAST");
    expect(url.searchParams.get("paginateBy")).toBe("DATE");
    expect(url.searchParams.get("startDate")).toBe("2026-01-01");
    expect(url.searchParams.get("endDate")).toBe("2026-04-21");
  });

  it("getUpcomingSessions uses status=FUTURE (not PAST)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(envelope({ sessions: [], count: 0 })),
    );
    const { getUpcomingSessions } = await import("@/lib/wisenet/endpoints");
    await getUpcomingSessions(
      new Date("2026-04-21T00:00:00Z"),
      new Date("2026-05-21T00:00:00Z"),
    );
    const url = fetchUrl(0);
    expect(url.searchParams.get("status")).toBe("FUTURE");
    expect(url.searchParams.get("paginateBy")).toBe("DATE");
  });

  it("getSessionCredits path and query match the sessionCredits contract", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(envelope({ total: 10, remaining: 5, consumed: 5 })),
    );
    const { getSessionCredits } = await import("@/lib/wisenet/endpoints");
    await getSessionCredits("class-1", "resolved-s1");
    const url = fetchUrl(0);
    expect(url.pathname).toBe(
      "/institutes/center-XYZ/classes/class-1/students/resolved-s1/sessionCredits",
    );
    expect(url.searchParams.get("fetchHistory")).toBe("true");
  });

  it("getClass path uses /user/v2/classes/<id>?full=true", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(envelope({ _id: "c1", name: "Math", subject: "Mathematics" })),
    );
    const { getClass } = await import("@/lib/wisenet/endpoints");
    await getClass("c1");
    const url = fetchUrl(0);
    expect(url.pathname).toBe("/user/v2/classes/c1");
    expect(url.searchParams.get("full")).toBe("true");
  });
});
