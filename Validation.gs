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
    testStudentQueueRollsUpPackagesIntoOneRow,
    testPinnedStudentsSortAheadOfOtherRisk,
    testCalendarGroupsStudentSessionsByDay,
    testSummaryDeltasCompareAgainstPreviousSnapshot,
    testWeeklyBucketsGroupProjectedAlerts,
    testDashboardCacheMissBuildsAndCachesPayload,
    testDashboardCacheHitReusesPayloadWithoutRebuild,
    testChunkedCacheRoundTripPreservesLargePayload,
    testDashboardTransferManifestUsesChunkedMode,
    testDashboardTransferChunkReadsStoredChunk,
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

  assertEqual(dashboard.payload.studentQueue[0].student, "Gina Ho", "Expected notify student to rank first.");
  assertTrue(
    dashboard.payload.studentQueue[0].priorityScore > dashboard.payload.studentQueue[1].priorityScore,
    "Expected notify student to have a higher priority score."
  );
}

function testStudentQueueRollsUpPackagesIntoOneRow() {
  const today = new Date(2026, 2, 29);
  const sessionA = { date: new Date(2026, 3, 2), durationMin: 60 };
  const sessionB = { date: new Date(2026, 3, 5), durationMin: 90 };
  const students = [
    {
      student: "Iris Tan",
      parent: "Pim Tan",
      dataQualityFlags: [],
      packages: [
        finalizePackageRecord(
          createPackageRecord(
            "Iris Tan",
            "Pim Tan",
            "English Pack",
            3,
            0,
            3,
            10,
            [sessionB],
            computeProjection(3, [sessionB], today)
          ),
          { parent: "Pim Tan" }
        ),
        finalizePackageRecord(
          createPackageRecord(
            "Iris Tan",
            "Pim Tan",
            "Math Pack",
            1.5,
            0.5,
            1,
            8,
            [sessionA],
            computeProjection(1, [sessionA], today)
          ),
          { parent: "Pim Tan" }
        ),
      ],
    },
  ];

  const dashboard = buildDashboardModel(
    students,
    { lastSnapshot: null, history: [] },
    today,
    today
  );

  assertEqual(dashboard.payload.studentQueue.length, 1, "Expected one rolled-up student queue row.");
  assertEqual(dashboard.payload.studentQueue[0].totalAdjustedRemaining, 4, "Expected student actual balance to be summed across packages.");
  assertEqual(dashboard.payload.studentQueue[0].totalCurrentRemaining, 4.5, "Expected student system balance to be summed across packages.");
  assertEqual(dashboard.payload.studentQueue[0].nextSessionDate, "2026-04-02", "Expected next session to use the earliest scheduled package session.");
}

function testPinnedStudentsSortAheadOfOtherRisk() {
  const today = new Date(2026, 2, 29);
  const students = [
    {
      student: "Jade Lim",
      parent: "May Lim",
      dataQualityFlags: [],
      packages: [
        finalizePackageRecord(
          createPackageRecord(
            "Jade Lim",
            "May Lim",
            "Science Pack",
            1.5,
            0,
            1.5,
            10,
            [],
            computeProjection(1.5, [], today)
          ),
          { parent: "May Lim" }
        ),
      ],
    },
    {
      student: "Kai Tan",
      parent: "Nita Tan",
      dataQualityFlags: [],
      packages: [
        finalizePackageRecord(
          createPackageRecord(
            "Kai Tan",
            "Nita Tan",
            "Reading Pack",
            2.5,
            0,
            2.5,
            10,
            [{ date: new Date(2026, 3, 1), durationMin: 60 }],
            computeProjection(2.5, [{ date: new Date(2026, 3, 1), durationMin: 60 }], today)
          ),
          { parent: "Nita Tan" }
        ),
      ],
    },
  ];

  const dashboard = buildDashboardModel(
    students,
    { lastSnapshot: null, history: [] },
    today,
    today
  );

  assertEqual(dashboard.payload.studentQueue[0].student, "Jade Lim", "Expected low-balance no-schedule student to be pinned first.");
  assertTrue(dashboard.payload.studentQueue[0].pinned, "Expected first student to be marked pinned.");
}

function testCalendarGroupsStudentSessionsByDay() {
  const today = new Date(2026, 2, 29);
  const sameDayA = { date: new Date(2026, 3, 4), durationMin: 60 };
  const sameDayB = { date: new Date(2026, 3, 4), durationMin: 90 };
  const students = [
    {
      student: "Lila Wong",
      parent: "June Wong",
      dataQualityFlags: [],
      packages: [
        finalizePackageRecord(
          createPackageRecord(
            "Lila Wong",
            "June Wong",
            "Math Pack",
            4,
            0,
            4,
            10,
            [sameDayA],
            computeProjection(4, [sameDayA], today)
          ),
          { parent: "June Wong" }
        ),
        finalizePackageRecord(
          createPackageRecord(
            "Lila Wong",
            "June Wong",
            "English Pack",
            3,
            0,
            3,
            10,
            [sameDayB],
            computeProjection(3, [sameDayB], today)
          ),
          { parent: "June Wong" }
        ),
      ],
    },
  ];

  const dashboard = buildDashboardModel(
    students,
    { lastSnapshot: null, history: [] },
    today,
    today
  );

  const day = dashboard.payload.calendar.days.find(function(item) {
    return item.date === "2026-04-04";
  });

  assertTrue(!!day, "Expected the scheduled date to appear in the calendar payload.");
  assertEqual(day.totalStudents, 1, "Expected the calendar day summary to group the student once.");
  assertEqual(day.students[0].sessions.length, 2, "Expected same-day package sessions to be grouped under the same student.");
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

function testDashboardCacheMissBuildsAndCachesPayload() {
  const cache = createFakeCache();
  let buildCount = 0;
  const payload = getCachedDashboardPayload({
    cache: cache,
    cacheKey: "fixture-cache-miss",
    ttlSeconds: 120,
    payloadBuilder: function() {
      buildCount++;
      return createDashboardPayloadFixture("2026-03-30T01:00:00Z");
    },
  });

  assertEqual(buildCount, 1, "Expected cache miss to build the payload exactly once.");
  assertTrue(Array.isArray(payload.studentQueue), "Expected cached wrapper to return the student queue payload shape.");
  assertTrue(
    !!cache.store[getDashboardCacheMetaKey("fixture-cache-miss")],
    "Expected cache miss to write cache metadata."
  );
}

function testDashboardCacheHitReusesPayloadWithoutRebuild() {
  const cache = createFakeCache();
  let buildCount = 0;
  let persistCount = 0;
  const payloadBuilder = function() {
    buildCount++;
    persistCount++;
    return createDashboardPayloadFixture("2026-03-30T02:00:00Z", "2026-03-29T02:00:00Z");
  };

  const first = getCachedDashboardPayload({
    cache: cache,
    cacheKey: "fixture-cache-hit",
    ttlSeconds: 120,
    payloadBuilder: payloadBuilder,
  });
  const second = getCachedDashboardPayload({
    cache: cache,
    cacheKey: "fixture-cache-hit",
    ttlSeconds: 120,
    payloadBuilder: payloadBuilder,
  });

  assertEqual(buildCount, 1, "Expected cache hit to avoid rebuilding the payload.");
  assertEqual(persistCount, 1, "Expected snapshot-side effects to run only on fresh recompute.");
  assertEqual(second.lastUpdatedAt, first.lastUpdatedAt, "Expected cache hit to preserve payload generation time.");
  assertEqual(second.previousUpdatedAt, first.previousUpdatedAt, "Expected cache hit to preserve comparison timestamp.");
}

function testChunkedCacheRoundTripPreservesLargePayload() {
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T03:00:00Z");
  payload.notes = "x".repeat(DASHBOARD_CACHE_CHUNK_SIZE + 25);

  writeChunkedCacheValue(cache, "fixture-cache-chunks", payload, 120);
  const restored = readChunkedCacheValue(cache, "fixture-cache-chunks");

  assertEqual(restored.notes.length, payload.notes.length, "Expected chunked cache round trip to preserve large payloads.");
  assertEqual(restored.lastUpdatedAt, payload.lastUpdatedAt, "Expected chunked cache round trip to preserve timestamps.");
}

function testDashboardTransferManifestUsesChunkedMode() {
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T04:00:00Z");
  payload.notes = "x".repeat(DASHBOARD_CACHE_CHUNK_SIZE + 25);

  writeChunkedCacheValue(cache, "fixture-transfer", payload, 120);

  const manifest = beginDashboardDataTransfer({
    cache: cache,
    cacheKey: "fixture-transfer",
    payloadLoader: function() {
      return payload;
    },
  });

  assertEqual(manifest.mode, "chunked", "Expected dashboard transfer to use chunked mode when cache metadata is present.");
  assertTrue(manifest.parts > 1, "Expected chunked transfer manifest to expose multiple payload parts.");
}

function testDashboardTransferChunkReadsStoredChunk() {
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T05:00:00Z");
  payload.notes = "x".repeat(DASHBOARD_CACHE_CHUNK_SIZE + 25);

  writeChunkedCacheValue(cache, "fixture-transfer-chunk", payload, 120);

  const manifest = readChunkedCacheManifest(cache, "fixture-transfer-chunk");
  const restored = [];

  for (let index = 0; index < manifest.parts; index++) {
    restored.push(fetchDashboardDataChunk(index, {
      cache: cache,
      cacheKey: "fixture-transfer-chunk",
    }));
  }

  const parsed = JSON.parse(restored.join(""));
  assertEqual(parsed.notes.length, payload.notes.length, "Expected dashboard transfer chunks to rebuild the serialized payload.");
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

function createDashboardPayloadFixture(lastUpdatedAt, previousUpdatedAt) {
  return {
    lastUpdatedAt: lastUpdatedAt,
    previousUpdatedAt: previousUpdatedAt || null,
    summary: {
      students: { total: 1, notify: 0, watch: 0, ok: 1, nodata: 0 },
      packages: { total: 1, notify: 0, watch: 0, ok: 1, nodata: 0 },
      portfolio: {
        exhaustedNow: 0,
        risk7: 0,
        risk14: 0,
        risk30: 0,
        noSchedule: 0,
        pendingDeductionBacklog: 0,
        pendingDeductionPackages: 0,
        lowBalanceNoSchedule: 0,
        multiRiskStudents: 0,
      },
      queue: {
        students: 1,
        pinnedStudents: 0,
      },
      deltas: {
        packagesNotify: null,
        packagesWatch: null,
        risk7: null,
        risk30: null,
        pendingDeductionBacklog: null,
        noSchedule: null,
        queueStudents: null,
        pinnedStudents: null,
      },
    },
    studentQueue: [{ key: "fixture-student", student: "Fixture Student", searchText: "fixture student" }],
    calendar: {
      availableStart: "2026-03-30",
      availableEnd: "2026-03-30",
      days: [],
    },
    students: [],
  };
}

function createFakeCache() {
  const store = {};

  return {
    store: store,
    get: function(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    getAll: function(keys) {
      const values = {};

      keys.forEach(function(key) {
        if (Object.prototype.hasOwnProperty.call(store, key)) {
          values[key] = store[key];
        }
      });

      return values;
    },
    putAll: function(values) {
      Object.keys(values).forEach(function(key) {
        store[key] = values[key];
      });
    },
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
