// web/src/lib/wisenet/retry.ts
// Per 02-CONTEXT.md §Rate-limit retry (D-17) — server is headerless; no header parsing.
// Returns the final 429 response when retries exhaust; caller converts to WisenetError.
//
// Schedule: initial attempt + up to 4 retries at 1s -> 2s -> 4s -> 8s (5 total fetches).
// Phase 1 _rate-limit-fingerprint.json confirmed Wisenet emits no rate-limit headers
// at the 200-burst ceiling; we rely on 429 status detection alone.

const DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

export async function retryOn429<T extends Response>(
  fn: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt <= DELAYS_MS.length; attempt++) {
    const response = await fn();
    if (response.status !== 429) return response;
    if (attempt === DELAYS_MS.length) return response;
    await sleep(DELAYS_MS[attempt]);
  }
  // Unreachable — the for-loop always returns or sleeps
  throw new Error("retry logic unreachable state");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exported for test access only — not part of public API
export const __RETRY_DELAYS_MS_FOR_TEST = DELAYS_MS;
