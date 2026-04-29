import { auth } from "@/auth";
import { getHealthState } from "@/lib/dashboard/health-state";
import { loadDashboardSources } from "@/lib/sheets/source-loader";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const health = getHealthState();
  let sheetsOk = false;
  let sheetsError = "";

  try {
    await loadDashboardSources();
    sheetsOk = true;
  } catch (error) {
    sheetsError = error instanceof Error ? error.message : "Sheets probe failed";
  }

  return NextResponse.json({
    authenticated: !!session?.user?.email,
    user: session?.user?.email ?? null,
    sheetsOk,
    sheetsError: sheetsOk ? null : sheetsError,
    cache: {
      tag: "dashboard-payload",
      lastPayloadBuiltAt: health.lastPayloadBuiltAt,
      lastPayloadBuildDurationMs: health.lastPayloadBuildDurationMs,
      lastCacheInvalidatedAt: health.lastCacheInvalidatedAt,
    },
  });
}
