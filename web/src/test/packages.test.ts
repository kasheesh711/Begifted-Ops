// web/src/test/packages.test.ts
// TEST-01 port — packages domain (batch A of Validation.gs port).
// Ports 9 of 41 Validation.gs assertions into Vitest:
//   1. testTrialPackagesAreExcluded           (Validation.gs:1035)
//   2. testPretestPackagesAreExcluded         (Validation.gs:1054)
//   3. testRecognizedAdminOwnershipResolvesCorrectly (Validation.gs:1303)
//   4. testBlankAdminOwnershipFallsBackToUnassigned  (Validation.gs:1322)
//   5. testConflictingAdminOwnershipUsesCountThenFirstRow (Validation.gs:1340)
//   6. testStudentsMissingOwnershipMapDefaultToUnassigned (Validation.gs:1379)
//   7. testDuplicatePackagesKeepLargestTotalCredits  (Validation.gs:1414)
//   8. testLowBalanceWithoutScheduleGetsDataQualityFlag (Validation.gs:1457)
//   9. testNoUpcomingSessionsStayNoData        (Validation.gs:1263 — projection helper, exercised here via package status)
//
// Fixture bodies ported verbatim from Validation.gs's buildFixture* idiom using an
// inline snapshot() helper copied from dashboard-logic.test.ts (D-20 pattern).

import { describe, expect, it } from "vitest";

import type { SheetSnapshot } from "@/lib/dashboard/domain";
import {
  buildDashboardStudents,
  buildExcludedPackageReasons,
  buildStudentAdminOwnershipMap,
} from "@/lib/dashboard/packages";
import { UNASSIGNED_ADMIN_KEY } from "@/lib/dashboard/config";
import { buildStudentPackageKey } from "@/lib/dashboard/helpers";

function snapshot(
  sheetName: string,
  header: string[],
  rows: unknown[][],
  headerRowIndex = 0,
): SheetSnapshot {
  const cols = header.reduce<Record<string, number>>((map, value, index) => {
    map[value] = index;
    return map;
  }, {});

  return {
    sheetName,
    headerRowIndex,
    dataRowStartIndex: headerRowIndex + 2,
    cols,
    rows,
  };
}

// ============================================================
// Exclusion keywords (parity gate — EXCLUDED_PACKAGE_KEYWORDS)
// ============================================================

describe("packages — exclusion keywords (parity gate)", () => {
  it("excludes packages with 'trial' in Class Subject", () => {
    // Port of testTrialPackagesAreExcluded (Validation.gs:1035)
    const excluded = buildExcludedPackageReasons(
      snapshot(
        "Students & Courses",
        ["Student Name", "Student Full Name", "Class Subject"],
        [["Alice Smith", "Mathematics", "English Trial"]],
      ),
    );

    expect(excluded[buildStudentPackageKey("Alice Smith", "English Trial")]).toBe("trial");
  });

  it("excludes packages with 'pretest' in Student Full Name", () => {
    // Port of testPretestPackagesAreExcluded (Validation.gs:1054)
    const excluded = buildExcludedPackageReasons(
      snapshot(
        "Students & Courses",
        ["Student Name", "Student Full Name", "Class Subject"],
        [["Bob Tan", "Science Pretest", "Science Package"]],
      ),
    );

    expect(excluded[buildStudentPackageKey("Bob Tan", "Science Package")]).toBe("pretest");
  });
});

// ============================================================
// Admin ownership (parity gate — majority vote + first-row precedence)
// ============================================================

describe("packages — admin ownership (parity gate)", () => {
  it("resolves recognized admin labels to their registry keys", () => {
    // Port of testRecognizedAdminOwnershipResolvesCorrectly (Validation.gs:1303)
    const ownershipMap = buildStudentAdminOwnershipMap(
      snapshot(
        "RemainingCredits",
        ["Student", "Admin"],
        [
          ["Palm Student", "Chiraya (Palm) Takornkulwut"],
          ["Muk Student", "Suphitsara (Muk) Manosamrit"],
        ],
      ),
    );

    expect(ownershipMap["Palm Student"].key).toBe("palm");
    expect(ownershipMap["Muk Student"].key).toBe("muk");
  });

  it("falls back to UNASSIGNED_ADMIN_KEY when admin cell is blank", () => {
    // Port of testBlankAdminOwnershipFallsBackToUnassigned (Validation.gs:1322)
    const ownershipMap = buildStudentAdminOwnershipMap(
      snapshot("RemainingCredits", ["Student", "Admin"], [["Unassigned Student", ""]]),
    );

    expect(ownershipMap["Unassigned Student"].key).toBe(UNASSIGNED_ADMIN_KEY);
  });

  it("resolves conflicts by majority vote, then first-row precedence on ties", () => {
    // Port of testConflictingAdminOwnershipUsesCountThenFirstRow (Validation.gs:1340)
    const ownershipMap = buildStudentAdminOwnershipMap(
      snapshot(
        "RemainingCredits",
        ["Student", "Admin"],
        [
          ["Shared Student", "Panida (Petchy) Wiya"],
          ["Shared Student", "Chiraya (Palm) Takornkulwut"],
          ["Shared Student", "Panida (Petchy) Wiya"],
          ["Tie Student", "Kittiya (Care) Taweesinprasarn"],
          ["Tie Student", "Suphitsara (Muk) Manosamrit"],
        ],
      ),
    );

    // 2-1 majority for Petchy
    expect(ownershipMap["Shared Student"].key).toBe("petchy");
    // 1-1 tie for Tie Student → earliest recognized row wins (Care came before Muk)
    expect(ownershipMap["Tie Student"].key).toBe("care");
  });

  it("defaults students absent from ownership map to UNASSIGNED_ADMIN_KEY at payload build time", () => {
    // Port of testStudentsMissingOwnershipMapDefaultToUnassigned (Validation.gs:1379)
    const today = new Date(2026, 2, 29);
    const aggregations = snapshot(
      "Aggregations",
      [
        "Student Name",
        "Parent Name",
        "Class Subject",
        "Current Remaining Credits",
        "Current Total Credits",
      ],
      [["Missing Owner", "Parent One", "English Pack", 4, 8]],
    );

    const studentRecords = buildDashboardStudents(
      aggregations,
      new Set(["Missing Owner"]),
      {}, // no exclusions
      null, // no pending deductions
      {}, // no upcoming sessions
      today,
      {}, // EMPTY ownership map — this is the parity assertion
    );

    expect(studentRecords).toHaveLength(1);
    expect(studentRecords[0].adminOwnerKey).toBe(UNASSIGNED_ADMIN_KEY);
  });
});

// ============================================================
// Duplicate merge + data-quality flags
// ============================================================

describe("packages — duplicate merge + data-quality flags", () => {
  it("keeps the largest totalCredits when upserting duplicate package rows", () => {
    // Port of testDuplicatePackagesKeepLargestTotalCredits (Validation.gs:1414)
    const today = new Date(2026, 2, 29);
    const aggregations = snapshot(
      "Aggregations",
      [
        "Student Name",
        "Parent Name",
        "Class Subject",
        "Current Remaining Credits",
        "Current Total Credits",
      ],
      [
        ["Ella Wong", "Maria Wong", "English Pack", 4, 8],
        ["Ella Wong", "Maria Wong", "English Pack", 6, 12],
      ],
    );

    const studentRecords = buildDashboardStudents(
      aggregations,
      new Set(["Ella Wong"]),
      {},
      null,
      {},
      today,
      {},
    );

    expect(studentRecords).toHaveLength(1);
    expect(studentRecords[0].packages).toHaveLength(1);
    // The duplicate with totalCredits=12 must win over totalCredits=8
    expect(studentRecords[0].packages[0].totalCredits).toBe(12);
    expect(studentRecords[0].packages[0].duplicateCount).toBe(2);
  });

  it("flags low-balance packages without a schedule as 'low-balance-no-schedule'", () => {
    // Port of testLowBalanceWithoutScheduleGetsDataQualityFlag (Validation.gs:1457)
    const today = new Date(2026, 2, 29);
    const aggregations = snapshot(
      "Aggregations",
      [
        "Student Name",
        "Parent Name",
        "Class Subject",
        "Current Remaining Credits",
        "Current Total Credits",
      ],
      [["Faye Ong", "Ben Ong", "Math Pack", 1.5, 10]],
    );

    const studentRecords = buildDashboardStudents(
      aggregations,
      new Set(["Faye Ong"]),
      {},
      null,
      {}, // NO upcoming sessions
      today,
      {},
    );

    expect(studentRecords[0].packages[0].status).toBe("notify");
    expect(studentRecords[0].packages[0].dataQualityFlags).toContain("low-balance-no-schedule");
  });

  it("stays in nodata when a package has adequate balance but no upcoming sessions", () => {
    // Port of testNoUpcomingSessionsStayNoData (Validation.gs:1263 — exercised here end-to-end
    // via buildDashboardStudents to prove package status respects the projection.status "nodata"
    // signal). computeProjection is unit-tested separately in projection.test.ts.
    const today = new Date(2026, 2, 29);
    const aggregations = snapshot(
      "Aggregations",
      [
        "Student Name",
        "Parent Name",
        "Class Subject",
        "Current Remaining Credits",
        "Current Total Credits",
      ],
      [["Greta Ho", "Ami Ho", "Art Pack", 5, 10]],
    );

    const studentRecords = buildDashboardStudents(
      aggregations,
      new Set(["Greta Ho"]),
      {},
      null,
      {}, // NO upcoming sessions — projection.status = "nodata"
      today,
      {},
    );

    expect(studentRecords[0].packages[0].status).toBe("nodata");
  });
});

