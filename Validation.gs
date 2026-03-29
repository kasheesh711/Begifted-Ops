// ============================================================
// Validation suite for business-rule helpers.
// Run `runValidationSuite` in Apps Script to verify fixtures.
// ============================================================

function runValidationSuite() {
  const tests = [
    testTrialPackagesAreExcluded,
    testPretestPackagesAreExcluded,
    testPendingFeedbackCreatesPendingDeduction,
    testConsumedCreditsDoNotDoubleDeduct,
    testNoUpcomingSessionsStayNoData,
    testAlertThresholdBoundaryAtExactlyTwoCredits,
    testWatchWindowBoundaryAtThirtyDays,
    testDuplicatePackagesKeepLargestTotalCredits,
    testLowBalanceWithoutScheduleGetsDataQualityFlag,
    testPriorityScoreRanksNotifyAheadOfHealthy,
    testSummaryDeltasCompareAgainstPreviousSnapshot,
    testWeeklyBucketsGroupProjectedAlerts,
  ];

  const failures = [];

  tests.forEach(function(testFn) {
    try {
      testFn();
    } catch (error) {
      failures.push(testFn.name + ": " + error.message);
    }
  });

  const summary = {
    total: tests.length,
    passed: tests.length - failures.length,
    failed: failures.length,
    failures: failures,
  };

  Logger.log(JSON.stringify(summary, null, 2));

  if (failures.length) {
    throw new Error("Validation suite failed:\n" + failures.join("\n"));
  }

  return summary;
}

function testTrialPackagesAreExcluded() {
  const excluded = buildExcludedPackageReasons(createSnapshot(
    ["Student Name", "Class Name", "Class Subject"],
    [
      {
        "Student Name": "Alice Smith",
        "Class Name": "Mathematics",
        "Class Subject": "English Trial",
      },
    ]
  ));

  assertEqual(
    excluded[buildStudentPackageKey("Alice Smith", "English Trial")],
    "trial",
    "Trial packages should be excluded."
  );
}

function testPretestPackagesAreExcluded() {
  const excluded = buildExcludedPackageReasons(createSnapshot(
    ["Student Name", "Class Name", "Class Subject"],
    [
      {
        "Student Name": "Bob Tan",
        "Class Name": "Science Pretest",
        "Class Subject": "Science Package",
      },
    ]
  ));

  assertEqual(
    excluded[buildStudentPackageKey("Bob Tan", "Science Package")],
    "pretest",
    "Pretest packages should be excluded."
  );
}

function testPendingFeedbackCreatesPendingDeduction() {
  const today = new Date(2026, 2, 29);
  const activeStudents = new Set(["Cara Lim"]);
  const pendingMap = buildPendingDeductionMap(
    createSnapshot(
      [
        "Student Name",
        "Package/Program",
        "final_status",
        "teacher_feedback",
        "credits_consumed",
        "session_duration",
        "session_date",
      ],
      [
        {
          "Student Name": "Cara Lim",
          "Package/Program": "Math Pack",
          "final_status": "ENDED",
          "teacher_feedback": "",
          "credits_consumed": 0,
          "session_duration": 90,
          "session_date": "2026-03-28",
        },
      ]
    ),
    activeStudents,
    {},
    today
  );

  assertEqual(
    pendingMap[buildStudentPackageKey("Cara Lim", "Math Pack")],
    1.5,
    "Ended sessions with pending feedback should deduct based on duration."
  );
}

function testConsumedCreditsDoNotDoubleDeduct() {
  const today = new Date(2026, 2, 29);
  const activeStudents = new Set(["Dylan Ng"]);
  const pendingMap = buildPendingDeductionMap(
    createSnapshot(
      [
        "Student Name",
        "Package/Program",
        "final_status",
        "teacher_feedback",
        "credits_consumed",
        "session_duration",
        "session_date",
      ],
      [
        {
          "Student Name": "Dylan Ng",
          "Package/Program": "Science Pack",
          "final_status": "ENDED",
          "teacher_feedback": "",
          "credits_consumed": 0,
          "session_duration": 60,
          "session_date": "2026-03-20",
        },
        {
          "Student Name": "Dylan Ng",
          "Package/Program": "Science Pack",
          "final_status": "ENDED",
          "teacher_feedback": "",
          "credits_consumed": 1,
          "session_duration": 60,
          "session_date": "2026-03-21",
        },
      ]
    ),
    activeStudents,
    {},
    today
  );

  assertEqual(
    pendingMap[buildStudentPackageKey("Dylan Ng", "Science Pack")],
    1,
    "Sessions with consumed credits should not be counted as pending deductions."
  );
}

function testNoUpcomingSessionsStayNoData() {
  const projection = computeProjection(5, [], new Date(2026, 2, 29));

  assertEqual(
    projection.status,
    "nodata",
    "Packages without upcoming sessions should remain in nodata."
  );
}

function testAlertThresholdBoundaryAtExactlyTwoCredits() {
  const projection = computeProjection(2, [], new Date(2026, 2, 29));

  assertEqual(
    projection.status,
    "nodata",
    "Exactly two credits should not trigger notify."
  );
}

function testWatchWindowBoundaryAtThirtyDays() {
  const today = new Date(2026, 2, 29);
  const projection = computeProjection(
    2.5,
    [{ date: new Date(2026, 3, 28), durationMin: 60 }],
    today
  );

  assertEqual(
    projection.status,
    "watch",
    "Crossing the threshold exactly 30 days out should remain watch."
  );
  assertEqual(
    projection.daysUntilAlert,
    30,
    "Days until alert should preserve the 30-day boundary."
  );
}

function testDuplicatePackagesKeepLargestTotalCredits() {
  const payload = buildDashboardPayload(
    createSnapshot(
      [
        "Student Name",
        "Parent Name",
        "Class Subject",
        "Current Remaining Credits",
        "Current Total Credits",
      ],
      [
        {
          "Student Name": "Ella Wong",
          "Parent Name": "Maria Wong",
          "Class Subject": "English Pack",
          "Current Remaining Credits": 4,
          "Current Total Credits": 8,
        },
        {
          "Student Name": "Ella Wong",
          "Parent Name": "Maria Wong",
          "Class Subject": "English Pack",
          "Current Remaining Credits": 6,
          "Current Total Credits": 12,
        },
      ]
    ),
    new Set(["Ella Wong"]),
    {},
    {},
    {},
    new Date(2026, 2, 29)
  );

  assertEqual(payload.length, 1, "Expected one student in the payload.");
  assertEqual(payload[0].packages.length, 1, "Expected package duplicates to be deduplicated.");
  assertEqual(
    payload[0].packages[0].totalCredits,
    12,
    "Expected the package row with the larger total credits to win."
  );
}

function testLowBalanceWithoutScheduleGetsDataQualityFlag() {
  const payload = buildDashboardPayload(
    createSnapshot(
      [
        "Student Name",
        "Parent Name",
        "Class Subject",
        "Current Remaining Credits",
        "Current Total Credits",
      ],
      [
        {
          "Student Name": "Faye Ong",
          "Parent Name": "Ben Ong",
          "Class Subject": "Math Pack",
          "Current Remaining Credits": 1.5,
          "Current Total Credits": 10,
        },
      ]
    ),
    new Set(["Faye Ong"]),
    {},
    {},
    {},
    new Date(2026, 2, 29)
  );

  assertEqual(payload[0].packages[0].status, "notify", "Expected low-balance package to be notify.");
  assertTrue(
    payload[0].packages[0].dataQualityFlags.indexOf("low-balance-no-schedule") !== -1,
    "Expected low-balance package without sessions to be flagged."
  );
}

function testPriorityScoreRanksNotifyAheadOfHealthy() {
  const students = [
    {
      student: "Gina Ho",
      parent: "Mina Ho",
      dataQualityFlags: [],
      packages: [
        finalizePackageRecord(
          createPackageRecord(
            "Gina Ho",
            "Mina Ho",
            "English Pack",
            1.5,
            0,
            1.5,
            10,
            [],
            computeProjection(1.5, [], new Date(2026, 2, 29))
          ),
          { parent: "Mina Ho" }
        ),
      ],
    },
    {
      student: "Harry Lim",
      parent: "Sora Lim",
      dataQualityFlags: [],
      packages: [
        finalizePackageRecord(
          createPackageRecord(
            "Harry Lim",
            "Sora Lim",
            "Science Pack",
            6,
            0,
            6,
            10,
            [{ date: new Date(2026, 3, 30), durationMin: 60 }],
            computeProjection(6, [{ date: new Date(2026, 3, 30), durationMin: 60 }], new Date(2026, 2, 29))
          ),
          { parent: "Sora Lim" }
        ),
      ],
    },
  ];

  const dashboard = buildDashboardModel(
    students,
    { lastSnapshot: null, history: [] },
    new Date(2026, 2, 29),
    new Date(2026, 2, 29)
  );

  assertEqual(dashboard.payload.actionQueue[0].student, "Gina Ho", "Expected notify package to rank first.");
  assertTrue(
    dashboard.payload.actionQueue[0].priorityScore > dashboard.payload.actionQueue[1].priorityScore,
    "Expected notify package to have a higher priority score."
  );
}

function testSummaryDeltasCompareAgainstPreviousSnapshot() {
  const deltas = buildSummaryDeltas(
    {
      packages: { notify: 4, watch: 6, ok: 12, nodata: 1 },
      students: { notify: 3, watch: 5, ok: 10, nodata: 1, total: 19 },
      portfolio: {
        exhaustedNow: 2,
        risk7: 5,
        risk14: 8,
        risk30: 11,
        noSchedule: 3,
        pendingDeductionBacklog: 9.5,
        lowBalanceNoSchedule: 2,
        multiRiskStudents: 1,
      },
    },
    {
      packages: { notify: 2, watch: 7, ok: 11, nodata: 1 },
      students: { notify: 2, watch: 5, ok: 10, nodata: 1, total: 18 },
      portfolio: {
        exhaustedNow: 1,
        risk7: 3,
        risk14: 7,
        risk30: 10,
        noSchedule: 4,
        pendingDeductionBacklog: 7,
        lowBalanceNoSchedule: 1,
        multiRiskStudents: 1,
      },
    }
  );

  assertEqual(deltas.packagesNotify, 2, "Expected notify delta to compare against previous snapshot.");
  assertEqual(deltas.packagesWatch, -1, "Expected watch delta to compare against previous snapshot.");
  assertEqual(deltas.pendingDeductionBacklog, 2.5, "Expected pending backlog delta to preserve decimals.");
}

function testWeeklyBucketsGroupProjectedAlerts() {
  const buckets = buildWeeklyBuckets(
    [
      { alertDate: "2026-03-30" },
      { alertDate: "2026-04-01" },
      { alertDate: "2026-04-09" },
      { alertDate: null },
    ],
    "alertDate",
    new Date(2026, 2, 29),
    3
  );

  assertEqual(buckets[0].count, 2, "Expected first weekly bucket to include same-week alerts.");
  assertEqual(buckets[1].count, 1, "Expected second weekly bucket to include next-week alerts.");
}

function createSnapshot(columnNames, rowObjects) {
  const cols = {};

  columnNames.forEach(function(columnName, index) {
    cols[columnName] = index;
  });

  return {
    sheetName: "fixture",
    cols: cols,
    rows: rowObjects.map(function(rowObject) {
      return columnNames.map(function(columnName) {
        return rowObject[columnName];
      });
    }),
  };
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + " Expected " + expected + " but received " + actual + ".");
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
