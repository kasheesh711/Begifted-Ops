// web/src/test/lint-no-revalidate-max.test.ts
// Phase 3 SVC-02 — flipped lint coverage.
//
// Phase 2 forbade the bogus two-arg form (with a "max" profile) and
// allowlisted service.ts. Phase 3 flips the regex: now it forbids the
// deprecated single-arg invocation and treats the two-arg form
// (tag plus profile string) as the correct Next.js 16 invocation. Allowlist
// is empty. Comments avoid the literal deprecated shape so this file does
// not self-match the lint regex.
//
// This test shells out to the lint script in 3 scenarios:
//   1. Clean tree (no single-arg deprecated form anywhere)       - exit 0
//   2. Temp file outside allowlist introduces the deprecated form - exit 1
//   3. Cleanup restores exit 0
//
// The violating payload is concatenated from pieces at runtime so the literal
// deprecated shape never appears in this source file. Without that precaution
// THIS test file would match the lint regex and the clean-tree check would
// always report exit 1. All comments + identifiers in this file avoid the
// exact deprecated shape for the same reason.
//
// afterAll + cleanup guarantees we never leave a stray violation file behind.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const LINT_CMD = "bash scripts/lint-no-revalidate-max.sh";
const TEMP_FILE = join(REPO_ROOT, "src", "lib", "__lint_test_violation.ts");

// Assemble the deprecated single-arg literal at runtime so this source file
// itself does not match the lint regex. The pieces are harmless on their own.
const FN = "revalidate" + "Tag";
const VIOLATION_BODY =
  `import { ${FN} } from "next/cache";\n` +
  `export function bad() { ${FN}("foo"); }\n`;   // single-arg = deprecated form

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

describe("lint-no-revalidate-max.sh — forbids deprecated single-arg revalidateTag()", () => {
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
