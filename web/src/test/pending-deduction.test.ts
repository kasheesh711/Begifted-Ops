// web/src/test/pending-deduction.test.ts
// TEST-01 port — pending-deduction domain (batch A of Validation.gs port).
//
// D-05 policy: Should_Credit column is dropped entirely from the dashboard. All
// pending-deduction assertions now exercise the session_duration fallback branch;
// tests that existed solely to validate Should_Credit priority are DROPPED or
// REWRITTEN (see inline comments for each).
//
// ------------------------------------------------------------
// 17 Apps Script-specific assertions NOT ported (per D-20 + VALIDATION.md
// §Not-Ported Apps Script Infrastructure). These stay in Validation.gs until
// Phase 5 archive because they exercise Apps Script primitives with no Next.js
// analogue (CacheService chunked manifests, PropertiesService prefix-scoped
// reads, HtmlService rendering, chunked transfer protocol, etc.):
//
//   1.  testDashboardCacheHitReusesPayloadWithoutRebuild
//   2.  testSetStudentActionPersistsAndClearsCache
//   3.  testClearStudentActionKeepsHistoryButRemovesVisibleState
//   4.  testBulkSetStudentActionUpdatesMultipleStudents
//   5.  testStudentActionActorFallsBackToNullForAllView
//   6.  testStudentActionHistoryTrimsToLimit
//   7.  testChunkedCacheRoundTripPreservesLargePayload
//   8.  testDashboardTransferChunkedCacheHitSkipsPayloadLoad
//   9.  testDashboardTransferManifestUsesChunkedMode
//   10. testDashboardTransferCacheMissReturnsChunkedAfterCaching
//   11. testDashboardTransferCacheMissFallsBackInlineWhenManifestMissing
//   12. testDashboardTransferChunkBatchReadsOrderedSlices
//   13. testDashboardTransferChunkBatchHandlesFinalPartialBatch
//   14. testDashboardTransferChunkBatchRecoversWhenManifestMissing
//   15. testDashboardTransferChunkBatchRecoversWhenPartMissing
//   16. testDashboardTransferChunkBatchRejectsInvalidRange
//   17. testDashboardTransferChunkReadsStoredChunk
//
// These cover: chunked cache manifest reads/writes (BG_DASHBOARD_PAYLOAD_V2::meta,
// ::part::<N>); PropertiesService-backed student action state persistence with
// BG_ACTION_V1::<studentKey> prefix scoping; Session.getScriptTimeZone() semantics;
// beginDashboardDataTransfer / fetchDashboardDataChunkBatch chunked flow.
// ------------------------------------------------------------
//
// DROPPED per D-05 (Should_Credit priority branch was the entire purpose):
//   - testPendingDeductionUsesShouldCreditWhenAvailable (Validation.gs:1113)
//     Dropped because the Should_Credit column is entirely removed from the
//     dashboard; the priority branch no longer exists to test. See
//     .planning/phases/02-data-layer/02-CONTEXT.md §D-05.

import { describe, expect, it } from "vitest";

import type { SheetSnapshot } from "@/lib/dashboard/domain";
import { buildPendingDeductionContext } from "@/lib/dashboard/packages";
import { sanitizeStudentActionState } from "@/lib/dashboard/actions";
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

const PENDING_CC_HEADERS = [
  "Student Name",
  "Package/Program",
  "final_status",
  "teacher_feedback",
  "credits_consumed",
  "session_duration",
  "session_date",
  "Should_Credit",
];

// ============================================================
// D-08 rule (parity gate): ENDED + empty feedback + credits_consumed=0
// ============================================================

describe("pending-deduction — D-08 rule (parity gate)", () => {
  it("ENDED session with empty teacher_feedback and no consumed credits counts as pending", () => {
    // Port of testPendingFeedbackCreatesPendingDeduction (Validation.gs:1073).
    // Apps Script expected 1.5 credits from a 90-min session (90/60 = 1.5).
    const today = new Date(2026, 2, 29);
    const activeStudents = new Set(["Cara Lim"]);
    const creditControl = snapshot("Credit_Control", PENDING_CC_HEADERS, [
      ["Cara Lim", "Math Pack", "ENDED", "", 0, 90, "2026-03-28", ""],
    ]);

    const pendingContext = buildPendingDeductionContext(
      creditControl,
      activeStudents,
      {},
      today,
    );

    const key = buildStudentPackageKey("Cara Lim", "Math Pack");
    expect(pendingContext.amountsByKey[key]).toBe(1.5);
  });
});

// ============================================================
// REWRITTEN per D-05: Should_Credit removed from fixture inputs
// ============================================================

describe("pending-deduction — REWRITTEN (D-05: Should_Credit dropped)", () => {
  it("uses session_duration as the primary branch when Should_Credit is empty", () => {
    // REWRITE of testPendingDeductionFallsBackToDurationWhenShouldCreditMissing
    // (Validation.gs:1163). Original intent: prove that when Should_Credit is
    // empty, buildPendingDeductionContext falls back to session_duration. Post-D-05,
    // session_duration is the ONLY branch (Should_Credit column is gone), so this
    // test exercises the now-primary path. Apps Script expected 1.3 credits from
    // a 78-min session (roundToTenth(78/60) = 1.3).
    const today = new Date(2026, 2, 29);
    const activeStudents = new Set(["Cara Lim"]);
    const creditControl = snapshot("Credit_Control", PENDING_CC_HEADERS, [
      ["Cara Lim", "Math Pack", "ENDED", "", 0, 78, "2026-03-28", ""],
    ]);

    const pendingContext = buildPendingDeductionContext(
      creditControl,
      activeStudents,
      {},
      today,
    );

    const key = buildStudentPackageKey("Cara Lim", "Math Pack");
    expect(pendingContext.amountsByKey[key]).toBe(1.3);
    expect(pendingContext.detailsByKey[key][0].deductionSource).toBe("session_duration");
    expect(pendingContext.detailsByKey[key][0].usingFallback).toBe(true);
  });

  it("does not double-deduct when credits are already consumed on a later row", () => {
    // REWRITE of testConsumedCreditsDoNotDoubleDeduct (Validation.gs:1213).
    // Original fixture included Should_Credit=1 on both rows; post-D-05 the
    // Should_Credit column is ignored. The D-08 rule `credits_consumed === 0`
    // is the sole guard — only the first row (credits_consumed=0) counts;
    // the second row (credits_consumed=1) is skipped. Total pending = 1 credit.
    const today = new Date(2026, 2, 29);
    const activeStudents = new Set(["Dylan Ng"]);
    const creditControl = snapshot("Credit_Control", PENDING_CC_HEADERS, [
      ["Dylan Ng", "Science Pack", "ENDED", "", 0, 60, "2026-03-20", ""],
      ["Dylan Ng", "Science Pack", "ENDED", "", 1, 60, "2026-03-21", ""],
    ]);

    const pendingContext = buildPendingDeductionContext(
      creditControl,
      activeStudents,
      {},
      today,
    );

    const key = buildStudentPackageKey("Dylan Ng", "Science Pack");
    // 60-min session / 60 = 1 credit. The row with credits_consumed=1 is excluded
    // by shouldCountAsPendingDeduction; no double-counting.
    expect(pendingContext.amountsByKey[key]).toBe(1);
    expect(pendingContext.detailsByKey[key]).toHaveLength(1);
  });
});

// ============================================================
// DB-05 parity gate: same-day visibility for student action state
// ============================================================

describe("same-day visibility (DB-05 parity gate)", () => {
  it("sanitizeStudentActionState drops action rows whose updatedAt is not today", () => {
    // Port of testStudentActionStateOnlySurfacesToday (Validation.gs:1921).
    // Parity gate: DB-05 requires the query layer (Plan 02-06) to surface only
    // today's action rows. The TS sanitizer enforces this via date-part comparison.
    const today = new Date(2026, 2, 31); // 2026-03-31

    const sameDay = sanitizeStudentActionState(
      {
        status: "contacted",
        updatedAt: "2026-03-31T09:00:00+07:00",
        updatedByName: "Palm",
        isToday: true,
      },
      today,
    );
    expect(sameDay).not.toBeNull();
    expect(sameDay?.isToday).toBe(true);

    const yesterday = sanitizeStudentActionState(
      {
        status: "contacted",
        updatedAt: "2026-03-30T09:00:00+07:00",
        updatedByName: "Palm",
        isToday: true, // claim doesn't matter — sanitizer re-validates via date compare
      },
      today,
    );
    expect(yesterday).toBeNull();
  });
});
