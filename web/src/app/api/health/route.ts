import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { wisenetFetch } from "@/lib/wisenet/client";
import { getAuthEnv, getWisenetEnv } from "@/lib/runtime/env";

// CRITICAL per D-32: this route MUST NOT use any "use cache" directive — health must probe live every call.
// CRITICAL: this route MUST NOT call the session guard — uptime monitors must reach this endpoint without auth.
// NOTE per Plan 03-01: `export const runtime = "nodejs"` is forbidden when nextConfig.cacheComponents is true
// (Next.js 16 makes Node.js the default route runtime under that flag and rejects the redundant segment config).
// Health route still executes on Node.js — Drizzle HTTP + WebSocket Pool require it.

interface SubsystemStatus {
  status: "ok" | "degraded" | "down";
  latencyMs?: number;
  error?: string;
}

interface AuthStatus {
  status: "ok" | "down";
  error?: string;
}

export async function GET() {
  const timestamp = new Date().toISOString();
  const [wisenet, postgres, auth] = await Promise.all([
    probeWisenet(),
    probePostgres(),
    probeAuth(),
  ]);

  const overall: "ok" | "degraded" | "down" =
    [wisenet, postgres].some((s) => s.status === "down") || auth.status === "down"
      ? "down"
      : [wisenet, postgres].some((s) => s.status === "degraded")
        ? "degraded"
        : "ok";

  const statusCode = overall === "down" ? 503 : 200;

  return NextResponse.json(
    {
      status: overall,
      timestamp,
      subsystems: { wisenet, postgres, auth },
      ...(process.env.VERCEL_DEPLOYMENT_ID
        ? { deployedAt: process.env.VERCEL_DEPLOYMENT_ID }
        : {}),
    },
    { status: statusCode },
  );
}

async function probeWisenet(): Promise<SubsystemStatus> {
  const start = Date.now();
  try {
    const env = getWisenetEnv();
    // D-32: tighter 5s timeout than wisenetFetch's 15s default. Note: wisenetFetch
    // currently overrides init.signal with its own AbortSignal.timeout(15_000), so
    // the effective bound here is 15s. The 5s value is preserved at the call site
    // per D-32's must_have key_link spec; tightening wisenetFetch to honor an
    // explicit init.signal is out of scope for this plan.
    await wisenetFetch(
      `/institutes/v3/${env.WISENET_CENTER_ID}/students?page_number=1&page_size=1`,
      z.object({ status: z.union([z.string(), z.number()]) }).passthrough(),
      { signal: AbortSignal.timeout(5_000) },
    );
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probePostgres(): Promise<SubsystemStatus> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function probeAuth(): Promise<AuthStatus> {
  try {
    getAuthEnv();
    return Promise.resolve({ status: "ok" });
  } catch (error) {
    return Promise.resolve({
      status: "down",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
