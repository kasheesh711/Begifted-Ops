// web/src/lib/runtime/logger.ts
// Vercel captures all console.* at the function level. JSON-line shape enables
// log search by route/level/error.message in Vercel log explorer.
// Phase 4 DEPL-04 swaps console.error to Sentry.captureException — this helper is the swap point.

type LogLevel = "error" | "warn" | "info";

export function log(
  level: LogLevel,
  route: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    route,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : String(error),
    ...extra,
  };
  // console.error even for warn/info — Vercel captures all console.* at function level
  console.error(JSON.stringify(payload));
}
