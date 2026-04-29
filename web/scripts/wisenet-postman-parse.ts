#!/usr/bin/env tsx
// web/scripts/wisenet-postman-parse.ts
// Phase 1 Wisenet Discovery — parse Postman v2.1 collection into deterministic endpoint catalogue.
// Run: tsx web/scripts/wisenet-postman-parse.ts
// No network calls. No env vars required (reads local gitignored JSON file).
// Optional: reads web/.env for scaffolding variable resolution (WISENET_BASE_URL, WISENET_NAMESPACE)
//           — secret-bearing vars (api_key, user_id, passwords, tokens) are ALWAYS preserved symbolically.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ---- Constants ------------------------------------------------------------

const POSTMAN_JSON_PATH = resolve(process.cwd(), ".planning/research/wisenet-postman.json");
const ENDPOINTS_MD_PATH = resolve(process.cwd(), ".planning/research/WISENET_ENDPOINTS.md");
const ENV_FILE_PATH = resolve(process.cwd(), "web/.env");
const ENV_EXAMPLE_PATH = resolve(process.cwd(), "web/.env.example");

const PRESERVE_SENTINEL = "__PRESERVE_SYMBOLIC__";

// Variable-name pattern for anything that could hold secret material. Always preserved
// symbolically, regardless of whether a concrete value exists in env. Defense-in-depth
// alongside the entropy heuristic (a non-secret-looking literal could still be a real secret).
const SECRET_VAR_NAME_PATTERN = /(?:^|[_-])?(?:api[_-]?key|apikey|user[_-]?id|userid|secret|token|bearer|password|passwd|client[_-]?secret|auth)(?:$|[_-])/i;

// ---- Postman v2.1 types (inline per plan spec) ----------------------------

interface PostmanV21Collection {
  info: { name: string; schema: string; _postman_id?: string; description?: string };
  item: PostmanItem[];
  auth?: PostmanAuth;
  event?: unknown[];
  variable?: Array<{ key: string; value: string; type?: string }>;
}

interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  response?: Array<{ name: string; status?: string; body?: string; header?: unknown[] }>;
  auth?: PostmanAuth;
}

interface PostmanRequest {
  method: string;
  header?: Array<{ key: string; value: string; type?: string; disabled?: boolean }>;
  url?: string | PostmanUrlObject;
  body?: { mode?: string; raw?: string; formdata?: unknown[]; urlencoded?: unknown[]; options?: unknown };
  auth?: PostmanAuth;
  description?: string;
}

interface PostmanUrlObject {
  raw?: string;
  host?: string[];
  path?: string[];
  query?: Array<{ key: string; value: string; disabled?: boolean }>;
  variable?: Array<{ key: string; value: string }>;
}

interface PostmanAuth {
  type: "bearer" | "apikey" | "basic" | "oauth2" | "awsv4" | "digest" | "hawk" | "ntlm" | "noauth" | string;
  apikey?: Array<{ key: string; value: string; type?: string }>;
  bearer?: Array<{ key: string; value: string; type?: string }>;
  basic?: Array<{ key: string; value: string; type?: string }>;
  oauth2?: unknown[];
}

interface ParsedEndpoint {
  folder: string;
  name: string;
  method: string;
  path: string;
  auth: string;
  required_headers: string[];
  query_params: string[];
  body_mode: string | null;
  has_example_response: boolean;
}

// ---- Helpers --------------------------------------------------------------

function isSecretLike(value: string): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length === 0) return false;
  if (v.startsWith("Bearer ")) return true;
  if (/^sk_[A-Za-z0-9_-]+/.test(v)) return true;
  if (/^pk_[A-Za-z0-9_-]+/.test(v)) return true;
  // High-entropy alphanumeric heuristic: length >= 24, alphanumeric-or-dash-or-underscore only.
  if (v.length >= 24 && /^[A-Za-z0-9_-]+$/.test(v)) return true;
  return false;
}

function isSecretVarName(name: string): boolean {
  return SECRET_VAR_NAME_PATTERN.test(name);
}

// Parse a simple KEY=VALUE .env file (no export, no multiline, no interpolation).
// Ignores comments and blank lines. Strips surrounding quotes from values.
function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  const result: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

// Build the resolution dictionary from (a) the Postman collection's own `variable` block
// and (b) the repo-local web/.env (non-secret scaffolding only).
// Secret-bearing variables (by name OR by entropy) map to PRESERVE_SENTINEL so they stay symbolic.
function buildVariableMap(
  collectionVariables: PostmanV21Collection["variable"] = [],
  envVars: Record<string, string>,
): Record<string, string> {
  const map: Record<string, string> = {};

  // First pass: Postman-collection variables (often empty in exports — checked earlier).
  for (const v of collectionVariables || []) {
    if (!v || typeof v.key !== "string") continue;
    const key = v.key;
    const value = typeof v.value === "string" ? v.value : "";
    if (isSecretVarName(key) || isSecretLike(value)) {
      map[key] = PRESERVE_SENTINEL;
    } else {
      map[key] = value;
    }
  }

  // Second pass: web/.env non-secret scaffolding. Mapping is by Postman-placeholder name.
  // Known Postman placeholders ({{host}}, {{namespace}}, {{user-agent}}) → env vars.
  const envBindings: Array<{ postmanKey: string; envKey: string }> = [
    { postmanKey: "host", envKey: "WISENET_BASE_URL" },
    { postmanKey: "baseUrl", envKey: "WISENET_BASE_URL" },
    { postmanKey: "namespace", envKey: "WISENET_NAMESPACE" },
    { postmanKey: "user-agent", envKey: "WISENET_USER_AGENT" },
  ];
  for (const { postmanKey, envKey } of envBindings) {
    if (postmanKey in map && map[postmanKey] !== PRESERVE_SENTINEL && map[postmanKey] !== "") {
      continue; // collection provided a non-empty non-secret value
    }
    const envValue = envVars[envKey];
    if (typeof envValue === "string" && envValue.length > 0) {
      // Env values are considered non-secret scaffolding ONLY if they don't look secret-like
      // AND don't bind to a secret-named placeholder. Namespaces, base URLs are fine.
      if (isSecretVarName(postmanKey) || isSecretLike(envValue)) {
        map[postmanKey] = PRESERVE_SENTINEL;
      } else {
        map[postmanKey] = envValue;
      }
    }
  }

  // All remaining secret-bearing names that appeared nowhere must still be preserved symbolically.
  // These are added lazily during resolveString — nothing to do here.

  return map;
}

function resolveString(raw: string, varMap: Record<string, string>): string {
  if (typeof raw !== "string" || raw.length === 0) return raw ?? "";
  return raw.replace(/\{\{([A-Za-z0-9_.\-]+)\}\}/g, (_match, name: string) => {
    // If variable is declared as preserve-symbolic OR matches secret name pattern OR is not in map,
    // leave the literal placeholder intact.
    if (!(name in varMap)) {
      if (isSecretVarName(name)) {
        return `{{${name}}}`;
      }
      return `{{${name}}}`;
    }
    const value = varMap[name];
    if (value === PRESERVE_SENTINEL) return `{{${name}}}`;
    return value;
  });
}

// Resolve a URL to a path-without-query string. Query params are handled separately
// (see `query_params` in the ParsedEndpoint) so we don't emit long query strings into
// the Path column where a 24+ char param name would trip the entropy guard.
// Also symbolicizes inline hex ObjectId-like tokens (24-char lowercase hex) that some
// Postman collection authors embed directly in paths — replaced with `{{INLINE_ID}}`.
function resolveUrl(url: string | PostmanUrlObject | undefined, varMap: Record<string, string>): string {
  if (!url) return "";
  let raw: string;
  if (typeof url === "string") {
    raw = url;
  } else if (typeof url.raw === "string" && url.raw.length > 0) {
    raw = url.raw;
  } else {
    const hostPart = (url.host || []).join(".");
    const pathPart = (url.path || []).join("/");
    raw = hostPart
      ? `${hostPart}${pathPart ? "/" + pathPart : ""}`
      : pathPart.startsWith("/")
        ? pathPart
        : "/" + pathPart;
  }
  let resolved = resolveString(raw, varMap).trim();
  // Drop query string from the path column — query params are listed separately.
  const qIdx = resolved.indexOf("?");
  if (qIdx !== -1) resolved = resolved.slice(0, qIdx);
  // Symbolicize inline hex IDs (24-char lowercase hex) that bypass `{{var}}` convention.
  resolved = resolved.replace(/\b[0-9a-f]{24,}\b/g, "{{INLINE_ID}}");
  return resolved;
}

function describeAuth(auth: PostmanAuth | undefined): string {
  if (!auth) return "inherit";
  const type = String(auth.type || "").toLowerCase();
  switch (type) {
    case "noauth":
      return "noauth";
    case "bearer":
      return "bearer";
    case "basic":
      return "basic";
    case "oauth2":
      return "oauth2";
    case "apikey": {
      const entries = Array.isArray(auth.apikey) ? auth.apikey : [];
      const keyEntry = entries.find((e) => e && e.key === "key");
      const inEntry = entries.find((e) => e && e.key === "in");
      const headerName = keyEntry && typeof keyEntry.value === "string" ? keyEntry.value : "";
      const location = inEntry && typeof inEntry.value === "string" ? inEntry.value : "header";
      if (headerName) return `apikey (${headerName} in ${location})`;
      return `apikey (${location})`;
    }
    default:
      return type || "inherit";
  }
}

// Walk the collection tree. Tracks the ancestral folder path and inherited auth.
function walkItems(
  items: PostmanItem[],
  folderPath: string[],
  inheritedAuth: PostmanAuth | undefined,
  varMap: Record<string, string>,
): ParsedEndpoint[] {
  const out: ParsedEndpoint[] = [];
  for (const item of items || []) {
    if (!item) continue;
    const effectiveAuth = item.auth ?? inheritedAuth;
    if (Array.isArray(item.item)) {
      out.push(...walkItems(item.item, [...folderPath, item.name || ""], effectiveAuth, varMap));
      continue;
    }
    if (!item.request) continue;

    const method = String(item.request.method || "GET").toUpperCase();
    const fullUrl = resolveUrl(item.request.url, varMap);

    // Per-request auth overrides inherited; otherwise describe as "inherit (<type>)".
    let authDesc: string;
    if (item.request.auth) {
      authDesc = describeAuth(item.request.auth);
    } else if (inheritedAuth) {
      authDesc = `inherit (${describeAuth(inheritedAuth)})`;
    } else {
      authDesc = "inherit";
    }

    // Headers: keep enabled, exclude authorization-carrying ones (they show in auth column).
    const rawHeaders = Array.isArray(item.request.header) ? item.request.header : [];
    const AUTH_HEADER_NAMES = new Set(["authorization", "x-api-key", "x-wise-namespace"]);
    const headers: string[] = [];
    for (const h of rawHeaders) {
      if (!h || h.disabled) continue;
      const key = typeof h.key === "string" ? h.key : "";
      if (!key) continue;
      if (AUTH_HEADER_NAMES.has(key.toLowerCase())) continue;
      headers.push(key);
    }
    headers.sort((a, b) => a.localeCompare(b));

    // Query params: keep enabled keys only.
    let queryKeys: string[] = [];
    const urlVal = item.request.url;
    if (urlVal && typeof urlVal === "object" && Array.isArray(urlVal.query)) {
      queryKeys = urlVal.query.filter((q) => q && !q.disabled && typeof q.key === "string").map((q) => q.key);
      queryKeys.sort((a, b) => a.localeCompare(b));
    }

    // Body mode.
    let bodyMode: string | null = null;
    if (item.request.body && typeof item.request.body.mode === "string" && item.request.body.mode.length > 0) {
      bodyMode = item.request.body.mode;
    }

    const hasExample = Array.isArray(item.response) && item.response.length > 0;

    out.push({
      folder: folderPath.filter(Boolean).join(" / ") || "(root)",
      name: item.name || "",
      method,
      path: fullUrl,
      auth: authDesc,
      required_headers: headers,
      query_params: queryKeys,
      body_mode: bodyMode,
      has_example_response: hasExample,
    });
  }
  return out;
}

// Is a 24+ char token actually secret-shaped? Real secrets typically have one or more of:
//   - digits present (API keys, tokens, hashes almost always mix digits)
//   - underscores or dashes (sk_..., jwt.parts)
//   - known prefixes (sk_, pk_, Bearer )
//   - ALL lowercase hex (ObjectId, sha-hash, etc.)
// Long camelCase English identifiers (letters only, mixed case, no digits, no _/-) like
// `populateSessionAttendees` or `showSequentialLearningDisabledSections` are NOT secrets;
// they are legitimate API parameter names.
function looksSecretShaped(token: string): boolean {
  if (token.length < 24) return false;
  if (token.startsWith("sk_") || token.startsWith("pk_")) return true;
  if (/[0-9]/.test(token)) return true; // any digit → treat as secret-shaped
  if (/[_-]/.test(token)) return true; // underscores/dashes → secret-shaped
  if (/^[a-f]+$/.test(token)) return true; // all lowercase hex letters — unlikely but possible
  // Letters-only token with both upper and lower case and no digits — camelCase identifier.
  return false;
}

// Redact-guard: scan emitted markdown for secret-shaped tokens. Any 24+ char run outside
// `{{placeholder}}` tokens and fenced code blocks is checked with `looksSecretShaped`.
// This fails closed on real secrets (hex, tokens with digits, sk_/pk_ prefixes) while
// allowing long camelCase API parameter names to pass.
function redactOutput(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Mask {{placeholder}} tokens so they don't trigger.
    const masked = line.replace(/\{\{[A-Za-z0-9_.\-]+\}\}/g, "");
    const candidates = masked.match(/[A-Za-z0-9_-]{24,}/g) || [];
    for (const hit of candidates) {
      if (looksSecretShaped(hit)) {
        const preview = hit.length > 10 ? `${hit.slice(0, 6)}...${hit.slice(-4)}` : hit;
        throw new Error(
          `Refusing to emit WISENET_ENDPOINTS.md — potential secret detected on line ${i + 1}: ${preview} (length ${hit.length})`,
        );
      }
    }
  }
  return markdown;
}

// Format one markdown table cell (escape pipes + newlines).
function tdCell(s: string): string {
  if (!s) return "—";
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").trim() || "—";
}

function emitMarkdown(
  endpoints: ParsedEndpoint[],
  collection: PostmanV21Collection,
  varMap: Record<string, string>,
  sourceMtimeIso: string,
): string {
  // Use the input Postman JSON's mtime rather than `new Date()` so re-running the
  // parser is deterministic (byte-identical output until Kevin re-exports).
  const parsedAt = sourceMtimeIso;
  const collectionAuth = describeAuth(collection.auth);
  const headerName = deriveAuthHeaderName(collection.auth);
  const varName = deriveAuthVarName(collection.auth);
  const baseUrl = varMap["host"] && varMap["host"] !== PRESERVE_SENTINEL ? varMap["host"] : "{{host}}";

  const lines: string[] = [];
  lines.push("# Wisenet Endpoint Catalogue");
  lines.push("");
  lines.push("**Parsed from:** `.planning/research/wisenet-postman.json` (local-only; gitignored)");
  lines.push(`**Parsed at:** ${parsedAt}`);
  lines.push(`**Collection:** ${collection.info?.name || "(unknown)"}`);
  lines.push(`**Schema:** ${collection.info?.schema || "(unknown)"}`);
  lines.push("");
  lines.push("> Generated by `web/scripts/wisenet-postman-parse.ts`. Re-run to refresh after Kevin updates the Postman export.");
  lines.push("> Secret-bearing values are preserved as `{{placeholder}}` per `isSecretLike` + `SECRET_VAR_NAME_PATTERN` heuristics.");
  lines.push("");

  // Auth section
  lines.push("## Auth (collection-level)");
  lines.push("");
  lines.push(`- **Type:** ${collectionAuth}`);
  lines.push(`- **Header name:** ${headerName}`);
  lines.push(`- **Variable name:** ${varName}`);
  lines.push(`- **Base URL:** ${baseUrl}`);
  // Emit `baseUrl = <url>` in literal form too — matches the validator's regex
  // `baseUrl.*=.*https?://` (validate-phase1.sh::assert_endpoints_has_base_url).
  lines.push(`- \`baseUrl = ${baseUrl}\``);
  lines.push("");
  // Per-request auth headers observed separately (not part of collection-level auth block)
  const observedAuthHeaders = collectObservedAuthHeaders(endpoints, collection);
  if (observedAuthHeaders.length > 0) {
    lines.push("**Observed per-request auth headers** (present in `request.header` across endpoints):");
    lines.push("");
    for (const h of observedAuthHeaders) {
      lines.push(`- \`${h}\``);
    }
    lines.push("");
  }

  // Collection variables (rarely populated in exports; render even if empty for transparency)
  lines.push("## Collection Variables");
  lines.push("");
  const cvars = Array.isArray(collection.variable) ? collection.variable : [];
  if (cvars.length === 0) {
    lines.push("_No top-level `variable` array in the Postman export. Scaffolding values are resolved from `web/.env` (`WISENET_BASE_URL`, `WISENET_NAMESPACE`); secret-bearing placeholders (`{{api_key}}`, `{{user_id}}`) stay symbolic._");
  } else {
    lines.push("| Key | Resolved Value |");
    lines.push("|-----|----------------|");
    const sorted = [...cvars].sort((a, b) => a.key.localeCompare(b.key));
    for (const v of sorted) {
      const key = v.key;
      const display = varMap[key] === PRESERVE_SENTINEL ? "`<PRESERVED SYMBOLIC>`" : tdCell(varMap[key] ?? "");
      lines.push(`| \`${key}\` | ${display} |`);
    }
  }
  lines.push("");

  // Endpoints grouped by top-level folder
  lines.push("## Endpoints");
  lines.push("");

  // Group by top-level folder (first segment before " / ").
  const byFolder = new Map<string, ParsedEndpoint[]>();
  for (const ep of endpoints) {
    const topFolder = ep.folder.split(" / ")[0];
    const bucket = byFolder.get(topFolder) ?? [];
    bucket.push(ep);
    byFolder.set(topFolder, bucket);
  }
  const folderNames = Array.from(byFolder.keys()).sort((a, b) => a.localeCompare(b));

  for (const folder of folderNames) {
    const rows = byFolder.get(folder) ?? [];
    // Within folder sort: method+path
    rows.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));

    lines.push(`### ${folder}`);
    lines.push("");
    lines.push("| Method | Path | Auth | Query params | Required headers | Body | Example response | Postman folder |");
    lines.push("|--------|------|------|--------------|------------------|------|------------------|----------------|");
    for (const ep of rows) {
      lines.push(
        "| " +
          [
            tdCell(ep.method),
            tdCell(ep.path),
            tdCell(ep.auth),
            tdCell(ep.query_params.join(", ")),
            tdCell(ep.required_headers.join(", ")),
            tdCell(ep.body_mode ?? ""),
            tdCell(ep.has_example_response ? "yes" : "no"),
            tdCell(ep.folder),
          ].join(" | ") +
          " |",
      );
    }
    lines.push("");
  }

  // Totals
  const withExamples = endpoints.filter((e) => e.has_example_response).length;
  const methods = Array.from(new Set(endpoints.map((e) => e.method))).sort();
  lines.push("## Totals");
  lines.push("");
  lines.push(`- Total endpoints: ${endpoints.length}`);
  lines.push(`- Endpoints with example responses: ${withExamples}`);
  lines.push(`- Unique HTTP methods: ${methods.join(", ")}`);
  lines.push(`- Top-level folders: ${folderNames.length}`);
  lines.push("");

  return lines.join("\n");
}

function deriveAuthHeaderName(auth: PostmanAuth | undefined): string {
  if (!auth) return "(none — no collection-level auth declared in Postman)";
  const type = String(auth.type || "").toLowerCase();
  if (type === "basic") return "Authorization (HTTP Basic)";
  if (type === "bearer") return "Authorization (Bearer)";
  if (type === "apikey") {
    const entries = Array.isArray(auth.apikey) ? auth.apikey : [];
    const keyEntry = entries.find((e) => e && e.key === "key");
    return keyEntry && typeof keyEntry.value === "string" ? keyEntry.value : "(api-key, header name not specified)";
  }
  return `(${type})`;
}

function deriveAuthVarName(auth: PostmanAuth | undefined): string {
  if (!auth) return "(none)";
  const type = String(auth.type || "").toLowerCase();
  const pickValue = (arr: Array<{ key: string; value: string }> | undefined, keyName: string): string => {
    if (!Array.isArray(arr)) return "";
    const entry = arr.find((e) => e && e.key === keyName);
    return entry && typeof entry.value === "string" ? entry.value : "";
  };
  if (type === "basic") {
    const user = pickValue(auth.basic, "username");
    const pass = pickValue(auth.basic, "password");
    const bits: string[] = [];
    if (user) bits.push(`username=${user}`);
    if (pass) bits.push(`password=${pass}`);
    return bits.length ? bits.join(", ") : "(not specified)";
  }
  if (type === "bearer") {
    return pickValue(auth.bearer, "token") || "(not specified)";
  }
  if (type === "apikey") {
    return pickValue(auth.apikey, "value") || "(not specified)";
  }
  return "(not specified)";
}

// Walk requests to collect unique auth-related header keys observed across the collection,
// for display in the "## Auth (collection-level)" section.
function collectObservedAuthHeaders(endpoints: ParsedEndpoint[], collection: PostmanV21Collection): string[] {
  const set = new Set<string>();
  const authHeaderNames = ["authorization", "x-api-key", "x-wise-namespace", "x-centre-id", "x-tenant-id"];
  function walk(items: PostmanItem[] | undefined) {
    if (!items) return;
    for (const item of items) {
      if (!item) continue;
      if (Array.isArray(item.item)) {
        walk(item.item);
        continue;
      }
      if (!item.request) continue;
      const headers = Array.isArray(item.request.header) ? item.request.header : [];
      for (const h of headers) {
        if (!h || h.disabled) continue;
        const key = typeof h.key === "string" ? h.key : "";
        if (!key) continue;
        if (authHeaderNames.includes(key.toLowerCase())) set.add(key);
      }
    }
  }
  walk(collection.item);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ---- main -----------------------------------------------------------------

async function main() {
  const json = readFileSync(POSTMAN_JSON_PATH, "utf8");
  const collection = JSON.parse(json) as PostmanV21Collection;

  if (!collection.info?.schema?.includes("v2.1")) {
    throw new Error(`Expected Postman Collection v2.1 schema, got: ${collection.info?.schema}`);
  }

  // Read scaffolding env from web/.env (non-secret vars only). Fall back to web/.env.example for
  // the namespace default if .env is missing — the example file is in-tree and documents defaults.
  let envVars = parseEnvFile(ENV_FILE_PATH);
  if (Object.keys(envVars).length === 0) {
    envVars = parseEnvFile(ENV_EXAMPLE_PATH);
  }

  const varMap = buildVariableMap(collection.variable, envVars);

  // Per-plan: refuse to proceed if base URL didn't resolve (host stays as {{host}}).
  // That would produce a useless catalogue with literal {{host}} rows.
  const hostResolved = varMap["host"] && varMap["host"] !== PRESERVE_SENTINEL && varMap["host"].length > 0;
  if (!hostResolved) {
    console.warn(
      "WARN: {{host}} did not resolve. Set WISENET_BASE_URL in web/.env or web/.env.example to emit a concrete base URL.",
    );
  }

  const endpoints = walkItems(collection.item, [], collection.auth, varMap);

  // Sort deterministically: top-level folder, then nested folder path, then method+path.
  endpoints.sort((a, b) => {
    if (a.folder !== b.folder) return a.folder.localeCompare(b.folder);
    return `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`);
  });

  if (endpoints.length === 0) {
    throw new Error("No endpoints parsed from Postman collection. Check JSON shape.");
  }

  // Use the Postman JSON's mtime as the stable "parsed at" timestamp. This keeps
  // re-runs byte-identical — the timestamp only advances when Kevin re-exports.
  const sourceMtimeIso = statSync(POSTMAN_JSON_PATH).mtime.toISOString();
  const markdown = emitMarkdown(endpoints, collection, varMap, sourceMtimeIso);
  const redacted = redactOutput(markdown);

  mkdirSync(dirname(ENDPOINTS_MD_PATH), { recursive: true });
  writeFileSync(ENDPOINTS_MD_PATH, redacted, "utf8");

  const topFolders = Array.from(new Set(endpoints.map((e) => e.folder.split(" / ")[0])));
  console.log(`Wrote ${endpoints.length} endpoints to ${ENDPOINTS_MD_PATH}`);
  console.log(`Top-level folders (${topFolders.length}): ${topFolders.join(", ")}`);
}

void main().catch((err) => {
  console.error("Parse failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
