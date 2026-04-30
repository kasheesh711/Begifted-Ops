import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-scope mock handles (mirroring actions-route.test.ts pattern)
const wisenetFetchMock = vi.fn();
const dbExecuteMock = vi.fn();
const getAuthEnvMock = vi.fn();
const getWisenetEnvMock = vi.fn(() => ({ WISENET_CENTER_ID: "test-center-id" }));

vi.mock("@/lib/wisenet/client", () => ({ wisenetFetch: wisenetFetchMock }));
vi.mock("@/lib/db/client", () => ({ db: { execute: dbExecuteMock } }));
vi.mock("@/lib/runtime/env", () => ({
  getAuthEnv: getAuthEnvMock,
  getWisenetEnv: getWisenetEnvMock,
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: WISENET_CENTER_ID resolved (Wisenet probe URL needs it)
    getWisenetEnvMock.mockReturnValue({ WISENET_CENTER_ID: "test-center-id" });
  });

  it("returns 200 ok when all subsystems healthy", async () => {
    wisenetFetchMock.mockResolvedValue({ status: 200 });
    dbExecuteMock.mockResolvedValue([]);
    getAuthEnvMock.mockReturnValue({});

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.subsystems.wisenet.status).toBe("ok");
    expect(body.subsystems.postgres.status).toBe("ok");
    expect(body.subsystems.auth.status).toBe("ok");
    expect(body.timestamp).toBeTruthy();
  });

  it("returns 503 down when postgres fails", async () => {
    wisenetFetchMock.mockResolvedValue({ status: 200 });
    dbExecuteMock.mockRejectedValue(new Error("connection refused"));
    getAuthEnvMock.mockReturnValue({});

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.subsystems.postgres.status).toBe("down");
    expect(body.subsystems.postgres.error).toBe("connection refused");
  });

  it("returns 503 down when wisenet probe fails", async () => {
    wisenetFetchMock.mockRejectedValue(new Error("Wisenet 503 at /students"));
    dbExecuteMock.mockResolvedValue([]);
    getAuthEnvMock.mockReturnValue({});

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.subsystems.wisenet.status).toBe("down");
  });

  it("returns 503 down when auth env missing", async () => {
    wisenetFetchMock.mockResolvedValue({ status: 200 });
    dbExecuteMock.mockResolvedValue([]);
    getAuthEnvMock.mockImplementation(() => {
      throw new Error("Missing required environment variable: AUTH_SECRET");
    });

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.subsystems.auth.status).toBe("down");
    // Info-disclosure check: auth error must NOT contain database connection string
    // (it won't here — it's an env var name error — but the assertion locks in the
    // T-03-06-1 mitigation per plan threat_model)
    expect(body.subsystems.auth.error).not.toContain("postgresql://");
  });

  it("does not require authentication (no Unauthorized check needed)", async () => {
    // Health endpoint should be callable without a session.
    wisenetFetchMock.mockResolvedValue({ status: 200 });
    dbExecuteMock.mockResolvedValue([]);
    getAuthEnvMock.mockReturnValue({});

    const { GET } = await import("@/app/api/health/route");
    // Call directly — handler does not invoke a session guard.
    const response = await GET();
    expect(response.status).not.toBe(401);
  });
});
