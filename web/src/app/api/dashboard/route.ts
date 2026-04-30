// SVC-04 — Phase 3 dashboard read endpoint.
//
// Reads from the new Wisenet + Postgres composer (service.ts SVC-02). The
// composer is wrapped in 'use cache: remote' upstream, so this handler is
// intentionally thin: auth gate + delegation + error envelope.
//
// External JSON shape preserved: returns the full DashboardPayload exactly as
// the React client expects. No client-side changes required.
//
// NOTE per Plan 03-01: `export const runtime = "nodejs"` is forbidden when
// nextConfig.cacheComponents is true (Next.js 16 makes Node.js the default
// route runtime under that flag and rejects the redundant segment config).
// Route still executes on Node.js — Drizzle HTTP + WebSocket Pool require it.
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { getDashboardPayload } from "@/lib/dashboard/service";
import { log } from "@/lib/runtime/logger";

export async function GET() {
  try {
    await requireSessionUser();
    const payload = await getDashboardPayload();
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log("error", "/api/dashboard", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dashboard load failed" },
      { status: 500 },
    );
  }
}
