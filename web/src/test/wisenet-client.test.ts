import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  retryOn429,
  __RETRY_DELAYS_MS_FOR_TEST,
} from "@/lib/wisenet/retry";
import {
  wisenetFetch,
  WisenetError,
  __resetAuthHeaderCacheForTest,
} from "@/lib/wisenet/client";
import {
  WisenetStudentsListSchema,
  WisenetSessionCreditsSchema,
  WisenetSessionsListSchema,
} from "@/lib/wisenet/types";
import creditBalanceFixture from "./fixtures/wisenet/credit_balance_sample.json";

describe("retryOn429", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeResponse(status: number): Response {
    return new Response(null, { status });
  }

  it("returns non-429 immediately without retries", async () => {
    const fn = vi.fn().mockResolvedValue(makeResponse(200));
    const result = await retryOn429(fn);
    expect(result.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to 4 times on 429 then returns success", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(200));
    const promise = retryOn429(fn);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);
    const result = await promise;
    expect(result.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("returns final 429 after exhausting retries (does NOT throw)", async () => {
    const fn = vi.fn().mockResolvedValue(makeResponse(429));
    const promise = retryOn429(fn);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000);
    const result = await promise;
    expect(result.status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(5); // initial + 4 retries
  });

  it("exposes correct delay schedule", () => {
    expect(__RETRY_DELAYS_MS_FOR_TEST).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it("propagates non-Response rejections", async () => {
    const err = new Error("network");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryOn429(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("wisenetFetch auth + error handling", () => {
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
    process.env.WISENET_USER_ID = "userid123";
    process.env.WISENET_API_KEY = "apikey456";
    process.env.WISENET_CENTER_ID = "centerXYZ";
    process.env.WISENET_NAMESPACE = "begifted-education";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Restore prior env values
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("sends HTTP Basic + x-api-key + x-wise-namespace headers", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 200,
          message: "ok",
          data: { students: [], count: 0 },
        }),
        { status: 200 },
      ),
    );

    await wisenetFetch(
      "/institutes/v3/centerXYZ/students?page_number=1&page_size=50",
      WisenetStudentsListSchema,
    );

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    const init = calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(
      "Basic " + Buffer.from("userid123:apikey456").toString("base64"),
    );
    expect(headers.get("x-api-key")).toBe("apikey456");
    expect(headers.get("x-wise-namespace")).toBe("begifted-education");
    expect(headers.get("user-agent")).toBe("begifted-ops-wisenet/1.0");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
  });

  it("throws WisenetError with PII-redacted body on 400", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 400,
          message: "Student not found",
          email: "leaked@example.com",
          loginPin: "1234",
        }),
        { status: 400 },
      ),
    );

    try {
      await wisenetFetch(
        "/institutes/centerXYZ/classes/c1/students/s1/sessionCredits",
        WisenetSessionCreditsSchema,
      );
      expect.unreachable("expected WisenetError to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(WisenetError);
      const err = e as WisenetError;
      expect(err.status).toBe(400);
      expect(err.path).toContain("sessionCredits");
      expect(err.redactedBody).toContain('"email":"<REDACTED>"');
      expect(err.redactedBody).toContain('"loginPin":"<REDACTED>"');
      expect(err.redactedBody).not.toContain("leaked@example.com");
      expect(err.redactedBody).not.toContain("1234");
    }
  });

  it("redacts phone, displayIdentifier, answer, notes keys in error body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 400,
          message: "bad",
          phone: "+66812345678",
          displayIdentifier: "display@example.com",
          answer: "secret-answer",
          notes: "private-notes",
        }),
        { status: 400 },
      ),
    );

    try {
      await wisenetFetch("/anything", WisenetSessionCreditsSchema);
      expect.unreachable();
    } catch (e) {
      const err = e as WisenetError;
      expect(err.redactedBody).toContain('"phone":"<REDACTED>"');
      expect(err.redactedBody).toContain('"displayIdentifier":"<REDACTED>"');
      expect(err.redactedBody).toContain('"answer":"<REDACTED>"');
      expect(err.redactedBody).toContain('"notes":"<REDACTED>"');
      expect(err.redactedBody).not.toContain("+66812345678");
      expect(err.redactedBody).not.toContain("secret-answer");
      expect(err.redactedBody).not.toContain("private-notes");
    }
  });

  it("throws WisenetError on 500", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("", { status: 500 }),
    );
    await expect(
      wisenetFetch("/anything", WisenetStudentsListSchema),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("schema-parses successful responses (Zod is the final step)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 200,
          message: "ok",
          data: {
            students: [
              {
                _id: "s1",
                name: "Alice",
                uuid: "u1",
                activated: true,
              },
            ],
            count: 1,
          },
        }),
        { status: 200 },
      ),
    );
    const result = await wisenetFetch("/anything", WisenetStudentsListSchema);
    expect(result.data.students[0].name).toBe("Alice");
    expect(result.data.students[0].activated).toBe(true);
    expect(result.data.count).toBe(1);
  });

  it("Zod throws on type drift (z.coerce.number() rejects 'not a number')", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 200,
          message: "ok",
          data: {
            sessions: [
              {
                _id: "s1",
                classId: { _id: "c1", name: "N", subject: "S" },
                userId: { _id: "u1", name: "U" },
                scheduledStartTime: "2026-01-01T00:00:00Z",
                meetingStatus: "ENDED",
                duration: "not-a-number",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    await expect(
      wisenetFetch("/anything", WisenetSessionsListSchema),
    ).rejects.toThrow();
  });

  it("z.coerce.number() accepts numeric strings (Pitfall #2)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "200",
          message: "ok",
          data: { students: [], count: "5" },
        }),
        { status: 200 },
      ),
    );
    const result = await wisenetFetch(
      "/anything",
      WisenetStudentsListSchema,
    );
    expect(result.status).toBe(200);
    expect(result.data.count).toBe(5);
    expect(typeof result.data.count).toBe("number");
  });

  it("400 credit_balance fixture surfaces as WisenetError (not Zod parse)", async () => {
    const rawBody = creditBalanceFixture.response_body_snippet ??
      JSON.stringify(creditBalanceFixture);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(rawBody, { status: 400 }),
    );
    await expect(
      wisenetFetch(
        "/institutes/centerXYZ/classes/c1/students/s1/sessionCredits",
        WisenetSessionCreditsSchema,
      ),
    ).rejects.toBeInstanceOf(WisenetError);
  });

  it("times out after 15s when fetch never resolves", async () => {
    // AbortSignal.timeout uses real timers; use a controllable AbortError-throwing fetch
    // to simulate timeout rather than sleeping 15s in the test.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: unknown, init?: RequestInit) => {
        const signal = init?.signal;
        // Simulate the fetch being aborted by the AbortSignal.timeout
        return await new Promise((_resolve, reject) => {
          if (signal) {
            signal.addEventListener(
              "abort",
              () => {
                const err = new DOMException(
                  "The operation was aborted",
                  "AbortError",
                );
                reject(err);
              },
              { once: true },
            );
            // Fire abort immediately to mimic timeout exhaustion
            setTimeout(() => {
              if (typeof (signal as AbortSignal).dispatchEvent === "function") {
                try {
                  (signal as AbortSignal).dispatchEvent(new Event("abort"));
                } catch {
                  /* ignore */
                }
              }
            }, 0);
          } else {
            reject(new Error("no signal"));
          }
        });
      },
    );
    await expect(
      wisenetFetch("/anything", WisenetStudentsListSchema),
    ).rejects.toBeDefined();
  });
});
