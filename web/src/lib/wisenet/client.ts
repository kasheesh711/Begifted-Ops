// web/src/lib/wisenet/client.ts
// Single fetch chokepoint for all Wisenet reads. Composes auth headers +
// 15s timeout + 429 retry + Zod parse at boundary. Throws WisenetError with
// PII-redacted body on non-ok responses.
//
// Auth variant 1 (Phase 1 _auth-fingerprint.json): HTTP Basic user:apiKey +
// x-api-key + x-wise-namespace. Base URL via getWisenetEnv().
//
// Threat mitigations:
//  T-02-06 Spoofing: new URL(path, base) — no string concatenation.
//  T-02-07 PII disclosure: redactBody scrubs 6 PII keys before attach.
//  T-02-08 Timeout: AbortSignal.timeout(15_000) bounds every fetch.
//  T-02-10 DoS: retryOn429 bounds retries to 4 attempts (1s+2s+4s+8s = 15s).
//  T-02-11 EoP: __resetAuthHeaderCacheForTest clears memoized Basic header.

import type { z } from "zod";
import { getWisenetEnv, type WisenetEnv } from "@/lib/runtime/env";
import { retryOn429 } from "./retry";

const USER_AGENT = "begifted-ops-wisenet/1.0";
const TIMEOUT_MS = 15_000;

let cachedAuthHeader: string | null = null;

export class WisenetError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly redactedBody: string,
  ) {
    super(`Wisenet ${status} at ${path}`);
    this.name = "WisenetError";
  }
}

function buildAuthHeader(env: WisenetEnv): string {
  if (cachedAuthHeader) return cachedAuthHeader;
  const creds = `${env.WISENET_USER_ID}:${env.WISENET_API_KEY}`;
  cachedAuthHeader = `Basic ${Buffer.from(creds, "utf-8").toString("base64")}`;
  return cachedAuthHeader;
}

function buildHeaders(env: WisenetEnv, override?: HeadersInit): Headers {
  const headers = new Headers({
    Authorization: buildAuthHeader(env),
    "x-api-key": env.WISENET_API_KEY,
    "x-wise-namespace": env.WISENET_NAMESPACE,
    "Content-Type": "application/json",
    Accept: "application/json",
    "user-agent": USER_AGENT,
  });
  if (override) {
    new Headers(override).forEach((v, k) => headers.set(k, v));
  }
  return headers;
}

// Key-based redaction of PII fields in 4xx/5xx bodies before attaching to
// WisenetError. Covers 6 keys from 02-CONTEXT.md §Claude's Discretion:
// email, phone, loginPin, displayIdentifier, answer, notes.
const REDACT_KEYS =
  /"(email|phone|loginPin|displayIdentifier|answer|notes)"\s*:\s*"[^"]*"/g;

function redactBody(raw: string): string {
  return raw
    .replace(REDACT_KEYS, (_match, key) => `"${key}":"<REDACTED>"`)
    .slice(0, 500);
}

export async function wisenetFetch<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  init: RequestInit = {},
): Promise<T> {
  const env = getWisenetEnv();
  const url = new URL(path, env.WISENET_BASE_URL);

  const response = await retryOn429(() =>
    fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: buildHeaders(env, init.headers),
    }),
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new WisenetError(response.status, path, redactBody(body));
  }

  const json = await response.json();
  return schema.parse(json);
}

// Test helper — resets memoized auth header between tests so env swaps take
// effect. Not part of public API.
export function __resetAuthHeaderCacheForTest(): void {
  cachedAuthHeader = null;
}
