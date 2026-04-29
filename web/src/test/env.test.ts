import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("env-loader", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  describe("getWisenetEnv", () => {
    const ALL_VARS = [
      "WISENET_BASE_URL",
      "WISENET_USER_ID",
      "WISENET_API_KEY",
      "WISENET_CENTER_ID",
      "WISENET_NAMESPACE",
    ] as const;

    it.each(ALL_VARS)("throws when %s missing", async (missing) => {
      ALL_VARS.forEach((v) => {
        process.env[v] = "x";
      });
      delete process.env[missing];
      const { getWisenetEnv } = await import("@/lib/runtime/env");
      expect(() => getWisenetEnv()).toThrow(
        `Missing required environment variable: ${missing}`,
      );
    });

    it("returns all 5 values when set", async () => {
      process.env.WISENET_BASE_URL = "https://api.wiseapp.live";
      process.env.WISENET_USER_ID = "u1";
      process.env.WISENET_API_KEY = "k1";
      process.env.WISENET_CENTER_ID = "c1";
      process.env.WISENET_NAMESPACE = "begifted-education";
      const { getWisenetEnv } = await import("@/lib/runtime/env");
      expect(getWisenetEnv()).toEqual({
        WISENET_BASE_URL: "https://api.wiseapp.live",
        WISENET_USER_ID: "u1",
        WISENET_API_KEY: "k1",
        WISENET_CENTER_ID: "c1",
        WISENET_NAMESPACE: "begifted-education",
      });
    });
  });

  describe("getDbEnv", () => {
    it.each(["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const)(
      "throws when %s missing",
      async (missing) => {
        process.env.DATABASE_URL = "pooled";
        process.env.DATABASE_URL_UNPOOLED = "direct";
        delete process.env[missing];
        const { getDbEnv } = await import("@/lib/runtime/env");
        expect(() => getDbEnv()).toThrow(
          `Missing required environment variable: ${missing}`,
        );
      },
    );

    it("returns both URLs when set", async () => {
      process.env.DATABASE_URL = "postgresql://pooled";
      process.env.DATABASE_URL_UNPOOLED = "postgresql://direct";
      const { getDbEnv } = await import("@/lib/runtime/env");
      expect(getDbEnv()).toEqual({
        DATABASE_URL: "postgresql://pooled",
        DATABASE_URL_UNPOOLED: "postgresql://direct",
      });
    });
  });
});
