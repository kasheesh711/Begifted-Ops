// web/src/test/lint-no-revalidate-max.test.ts
// TEST-03 deferral lint carve-out — automated positive + negative coverage.
//
// Resolves plan-check FLAG-3: the lint script is only useful if it actually
// detects violations. This test shells out to the script in 3 scenarios:
//   1. Clean tree (only the allowlisted service.ts occurrence) - exit 0
//   2. Temp file outside allowlist introduces the anti-pattern        - exit 1
//   3. Cleanup restores exit 0
//
// The violating payload is concatenated from pieces at runtime so the literal
// anti-pattern shape never appears in this source file. Without that
// precaution THIS test file would match the lint regex and the clean-tree
// check would always report exit 1. All comments + identifiers in this file
// avoid the exact anti-pattern shape for the same reason.
//
// afterAll + cleanup guarantees we never leave a stray violation file behind
// (T-02-37 mitigation — allowlist silently grows).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const LINT_CMD = "bash scripts/lint-no-revalidate-max.sh";
const TEMP_FILE = join(REPO_ROOT, "src", "lib", "__lint_test_violation.ts");

// Assemble the anti-pattern literal at runtime so this source file itself
// does not match the lint regex. The pieces are harmless on their own.
const FN = "revalidate" + "Tag";
const BAD_ARG = '"' + "max" + '"';
const VIOLATION_BODY =
  `import { ${FN} } from "next/cache";\n` +
  `export function bad() { ${FN}("foo", ${BAD_ARG}); }\n`;

function runLint(): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(LINT_CMD, { cwd: REPO_ROOT, stdio: "pipe" }).toString();
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: e.status ?? -1,
      stdout: (e.stdout ?? Buffer.from("")).toString(),
      stderr: (e.stderr ?? Buffer.from("")).toString(),
    };
  }
}

function cleanupTempFile(): void {
  if (existsSync(TEMP_FILE)) {
    try {
      unlinkSync(TEMP_FILE);
    } catch {
      // ignore — test runner will flag subsequent failures
    }
  }
}

describe("TEST-03 deferral lint (lint-no-revalidate-max.sh) — FLAG-3 negative coverage", () => {
  // Run as ONE serialized it() so the temp-file state is deterministic across
  // phases (vitest otherwise parallelizes test cases and they race).
  beforeAll(cleanupTempFile);
  afterAll(cleanupTempFile);

  it("positive (clean) -> negative (violation) -> positive (cleanup) cycle", () => {
    // 1. Clean tree — only allowlisted service.ts occurrence exists.
    expect(existsSync(TEMP_FILE)).toBe(false);
    const clean1 = runLint();
    expect(clean1.status).toBe(0);
    expect(clean1.stdout).toContain("OK");

    // 2. Plant a violation outside the allowlist -> lint must exit 1.
    writeFileSync(TEMP_FILE, VIOLATION_BODY);
    const violating = runLint();
    expect(violating.status).toBe(1);
    expect(violating.stdout).toContain("FAIL");
    expect(violating.stdout).toContain("__lint_test_violation.ts");

    // 3. Remove the violation -> lint back to exit 0.
    cleanupTempFile();
    expect(existsSync(TEMP_FILE)).toBe(false);
    const clean2 = runLint();
    expect(clean2.status).toBe(0);
    expect(clean2.stdout).toContain("OK");
  });
});
