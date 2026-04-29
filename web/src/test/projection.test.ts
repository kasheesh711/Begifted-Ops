// web/src/test/projection.test.ts
// TEST-01 port — projection + analytics domain (batch A of Validation.gs port).
// Ports 4 of 41 Validation.gs assertions into Vitest:
//   1. testAlertThresholdBoundaryAtExactlyTwoCredits (Validation.gs:1273)
//   2. testWatchWindowBoundaryAtThirtyDays           (Validation.gs:1283)
//   3. testPriorityScoreRanksNotifyAheadOfHealthy    (Validation.gs:1491)
//   4. testWeeklyBucketsGroupProjectedAlerts         (Validation.gs:1774)
//
// Validates critical parity gates from VALIDATION.md:
//   - ALERT_THRESHOLD = 2 is strict-below (`< 2`, not `<= 2`)
//   - NOTIFY_WINDOW_DAYS = 30 is inclusive at-or-below (`<= 30`)
//   - Priority score ranks notify above ok
//   - buildWeeklyBuckets groups alertDate values into W1/W2/W3 buckets

import { describe, expect, it } from "vitest";

import { computeProjection } from "@/lib/dashboard/projection";
import { buildWeeklyBuckets, computePriorityScore } from "@/lib/dashboard/analytics";
import type { PackageRow } from "@/lib/dashboard/domain";

// Minimal PackageRow fixture builder — mirrors Validation.gs buildFixture* style.
function buildPackageRow(overrides: Partial<PackageRow>): PackageRow {
  return {
    key: "student|||package",
    student: "Student",
    parent: "Parent",
    packageName: "Package",
    subject: "Subject",
    status: "ok",
    currentRemaining: 10,
    adjustedRemaining: 10,
    pendingDeduction: 0,
    totalCredits: 10,
    alertDate: null,
    exhaustDate: null,
    daysUntilAlert: null,
    daysUntilExhaust: null,
    nextSessionDate: null,
    upcomingCount: 0,
    sessionCadencePerWeek: 0,
    averageCreditsPerWeek: 0,
    cadenceLabel: "Steady",
    dataQualityFlags: [],
    recommendedAction: "",
    whyNow: "",
    previousStatus: null,
    balanceDelta: null,
    statusChange: "new",
    studentIndex: 0,
    packageIndex: 0,
    priorityScore: 0,
    ...overrides,
  };
}

// ============================================================
// ALERT_THRESHOLD boundary (parity gate)
// ============================================================

describe("projection — ALERT_THRESHOLD boundary (parity gate)", () => {
  it("exactly two credits + no upcoming sessions stays nodata", () => {
    // Port of testAlertThresholdBoundaryAtExactlyTwoCredits (Validation.gs:1273).
    // The threshold is STRICT-BELOW (`< ALERT_THRESHOLD`), so balance == 2 does NOT trigger notify.
    const projection = computeProjection(2, [], new Date(2026, 2, 29));

    expect(projection.status).toBe("nodata");
    expect(projection.alertDate).toBeNull();
    expect(projection.exhaustDate).toBeNull();
  });
});

// ============================================================
// NOTIFY_WINDOW_DAYS boundary (parity gate)
// ============================================================

describe("projection — NOTIFY_WINDOW_DAYS boundary (parity gate)", () => {
  it("crossing threshold exactly 30 days out remains watch", () => {
    // Port of testWatchWindowBoundaryAtThirtyDays (Validation.gs:1283).
    // Balance 2.5, one 60-min session on 2026-04-28 (30 days past 2026-03-29).
    // After session: 2.5 - 1 = 1.5, which falls below the alert threshold.
    // daysUntilAlert = 30 (inclusive boundary → status = "watch", NOT "ok").
    const today = new Date(2026, 2, 29);
    const projection = computeProjection(
      2.5,
      [{ date: new Date(2026, 3, 28), durationMin: 60 }],
      today,
    );

    expect(projection.status).toBe("watch");
    expect(projection.daysUntilAlert).toBe(30);
  });
});

// ============================================================
// Priority score ordering (parity gate)
// ============================================================

describe("projection — priority score ordering (parity gate)", () => {
  it("notify packages score higher than ok packages", () => {
    // Port of testPriorityScoreRanksNotifyAheadOfHealthy (Validation.gs:1491).
    // Adapted: the TS computePriorityScore takes (PackageRow, riskyCount, prevStatus, balanceDelta)
    // while the Apps Script version derives similar inputs from PackageRecord. We exercise
    // the same "notify > ok" ordering directly on the TS function.
    const notifyRow = buildPackageRow({
      status: "notify",
      adjustedRemaining: 1.5,
      daysUntilAlert: 0,
      alertDate: "2026-03-29",
    });
    const okRow = buildPackageRow({
      status: "ok",
      adjustedRemaining: 6,
      daysUntilAlert: 60,
      alertDate: "2026-05-28",
    });

    const notifyScore = computePriorityScore(notifyRow, 1, null, null);
    const okScore = computePriorityScore(okRow, 0, null, null);

    expect(notifyScore).toBeGreaterThan(okScore);
  });
});

// ============================================================
// Weekly bucket grouping (parity gate)
// ============================================================

describe("projection — weekly bucket grouping", () => {
  it("groups alertDate values into weekly buckets starting from today", () => {
    // Port of testWeeklyBucketsGroupProjectedAlerts (Validation.gs:1774).
    // Fixture: 3 packages with alertDate, 1 without. today=2026-03-29, 3 weeks.
    // Bucket 0: 2026-03-29..04-04 (includes 03-30 + 04-01 = 2)
    // Bucket 1: 2026-04-05..04-11 (includes 04-09 = 1)
    // Bucket 2: 2026-04-12..04-18 (empty)
    const buckets = buildWeeklyBuckets(
      [
        { alertDate: "2026-03-30" },
        { alertDate: "2026-04-01" },
        { alertDate: "2026-04-09" },
        { alertDate: null },
      ],
      "alertDate",
      new Date(2026, 2, 29),
      3,
    );

    expect(buckets).toHaveLength(3);
    expect(buckets[0].count).toBe(2);
    expect(buckets[1].count).toBe(1);
    expect(buckets[2].count).toBe(0);
  });
});
