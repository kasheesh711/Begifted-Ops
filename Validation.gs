// ============================================================
// Validation suite for business-rule helpers.
// Run `runValidationSuite` in Apps Script to verify fixtures.
// ============================================================

function runValidationSuite() {
  const tests = [
    testTrialPackagesAreExcluded,
    testPretestPackagesAreExcluded,
    testPendingFeedbackCreatesPendingDeduction,
    testPendingDeductionUsesShouldCreditWhenAvailable,
    testPendingDeductionFallsBackToDurationWhenShouldCreditMissing,
    testConsumedCreditsDoNotDoubleDeduct,
    testNoUpcomingSessionsStayNoData,
    testAlertThresholdBoundaryAtExactlyTwoCredits,
    testWatchWindowBoundaryAtThirtyDays,
    testRecognizedAdminOwnershipResolvesCorrectly,
    testBlankAdminOwnershipFallsBackToUnassigned,
    testConflictingAdminOwnershipUsesCountThenFirstRow,
    testStudentsMissingOwnershipMapDefaultToUnassigned,
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
    testSetStudentActionPersistsAndClearsCache,
    testClearStudentActionKeepsHistoryButRemovesVisibleState,
    testBulkSetStudentActionUpdatesMultipleStudents,
    testStudentActionStateOnlySurfacesToday,
    testStudentActionActorFallsBackToNullForAllView,
    testStudentActionHistoryTrimsToLimit,
    testDashboardModelMergesStudentActionStateIntoStudentsAndQueue,
    testChunkedCacheRoundTripPreservesLargePayload,
    testDashboardTransferChunkedCacheHitSkipsPayloadLoad,
    testDashboardTransferManifestUsesChunkedMode,
    testDashboardTransferCacheMissReturnsChunkedAfterCaching,
    testDashboardTransferCacheMissFallsBackInlineWhenManifestMissing,
    testDashboardTransferChunkBatchReadsOrderedSlices,
    testDashboardTransferChunkBatchHandlesFinalPartialBatch,
    testDashboardTransferChunkBatchRejectsInvalidRange,
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

function inspectStudentPackageBalance(studentName, packageName) {
  const today = getTodayDate();
  const sources = loadDashboardSources();
  const expectedModel = buildAuditExpectedModel(sources, today);
  const actualPayload = buildAuditActualPayloadFromSources(sources, today);
  const key = buildStudentPackageKey(studentName, packageName);
  const actualPackage = findPackageByKey(actualPayload.students, key);
  const expectedPackage = expectedModel.packagesByKey[key] || null;
  const expectedStudent = expectedPackage
    ? expectedModel.students.find(function(student) {
        return student.student === expectedPackage.student;
      })
    : null;
  const activeStudents = expectedModel.metadata.activeStudents;
  const excludedReasons = expectedModel.metadata.excludedPackageReasons;

  return {
    studentName: studentName,
    packageName: packageName,
    key: key,
    today: formatDate(today),
    activeStudent: activeStudents.has(studentName),
    excludedReason: excludedReasons[key] || null,
    aggregationRows: collectAggregationInspectionRows(sources.aggregations, studentName, packageName),
    pendingRows: collectPendingInspectionRows(
      sources.creditControl,
      studentName,
      packageName,
      today,
      activeStudents,
      excludedReasons
    ),
    upcomingRows: collectUpcomingInspectionRows(
      sources.upcoming,
      studentName,
      packageName,
      today,
      activeStudents,
      excludedReasons
    ),
    expectedPackage: expectedPackage,
    actualPackage: actualPackage,
    arithmeticTrail: expectedPackage
      ? {
          systemBalance: expectedPackage.currentRemaining,
          pendingDeduction: expectedPackage.pendingDeduction,
          actualRemaining: expectedPackage.adjustedRemaining,
          pendingDeductionSources: expectedPackage.pendingDeductionDetails.map(function(detail) {
            return {
              rowNumber: detail.rowNumber,
              sessionDate: detail.sessionDate,
              deductionCredits: detail.deductionCredits,
              deductionSource: detail.deductionSource,
            };
          }),
          nextAlertDate: expectedPackage.alertDate,
          exhaustionDate: expectedPackage.exhaustDate,
        }
      : null,
    expectedStudent: expectedStudent,
  };
}

function runLiveAccuracyAudit() {
  const today = getTodayDate();
  const now = new Date();
  const sources = loadDashboardSources();
  const expectedModel = buildAuditExpectedModel(sources, today);
  const actualPayload = buildAuditActualPayloadFromSources(sources, today);
  const report = buildLiveAccuracyAuditReport(actualPayload, expectedModel, today, now);

  writeAuditReport(report);
  Logger.log(JSON.stringify(report.summary, null, 2));

  if (report.summary.failed > 0) {
    throw new Error(
      "Live accuracy audit failed with " + report.summary.failed +
      " mismatches. See the \"" + SHEET_AUDIT_REPORT + "\" sheet for details."
    );
  }

  return report.summary;
}

function buildAuditActualPayloadFromSources(sources, today) {
  const activeStudents = buildActiveStudentSet(sources.students);
  const excludedPackageReasons = buildExcludedPackageReasons(sources.studentsCourses);
  const adminOwnershipMap = buildStudentAdminOwnershipMap(sources.remainingCredits);
  const pendingDeductionContext = buildPendingDeductionContext(
    sources.creditControl,
    activeStudents,
    excludedPackageReasons,
    today
  );
  const upcomingSessionMap = buildUpcomingSessionMap(
    sources.upcoming,
    activeStudents,
    excludedPackageReasons,
    today
  );
  const students = buildDashboardPayload(
    sources.aggregations,
    activeStudents,
    excludedPackageReasons,
    pendingDeductionContext,
    upcomingSessionMap,
    today,
    adminOwnershipMap
  );

  return buildDashboardModel(
    students,
    { lastSnapshot: null, history: [] },
    today,
    new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0)
  ).payload;
}

function buildAuditExpectedModel(sources, today) {
  const activeStudents = buildAuditActiveStudentSet(sources.students);
  const excludedPackageReasons = buildAuditExcludedPackageReasons(sources.studentsCourses);
  const adminOwnershipMap = buildAuditAdminOwnershipMap(sources.remainingCredits);
  const pendingDeductionContext = buildAuditPendingDeductionContext(
    sources.creditControl,
    activeStudents,
    excludedPackageReasons,
    today
  );
  const upcomingSessionMap = buildAuditUpcomingSessionMap(
    sources.upcoming,
    activeStudents,
    excludedPackageReasons,
    today
  );
  const students = buildAuditExpectedStudents(
    sources.aggregations,
    pendingDeductionContext,
    upcomingSessionMap,
    activeStudents,
    excludedPackageReasons,
    today,
    adminOwnershipMap
  );
  const studentQueue = buildAuditExpectedStudentQueue(students);
  const summary = buildAuditExpectedSummary(students, studentQueue);
  const packagesByKey = {};
  const studentQueueByKey = {};

  students.forEach(function(student) {
    student.packages.forEach(function(pkg) {
      packagesByKey[pkg.key] = pkg;
    });
  });

  studentQueue.forEach(function(row) {
    studentQueueByKey[row.key] = row;
  });

  return {
    metadata: {
      activeStudents: activeStudents,
      excludedPackageReasons: excludedPackageReasons,
      pendingDeductionContext: pendingDeductionContext,
    },
    students: students,
    studentQueue: studentQueue,
    summary: summary,
    packagesByKey: packagesByKey,
    studentQueueByKey: studentQueueByKey,
  };
}

function buildAuditActiveStudentSet(studentsSnapshot) {
  const activeStudents = new Set();

  studentsSnapshot.rows.forEach(function(row) {
    const studentName = readTrimmedCell(row, studentsSnapshot.cols, "student_name");
    const remainingCredits = String(
      row[studentsSnapshot.cols["Remaining Credits"]] || ""
    ).trim().toUpperCase();

    if (!studentName) return;
    if (remainingCredits !== "" && remainingCredits !== "N/A") {
      activeStudents.add(studentName);
    }
  });

  return activeStudents;
}

function buildAuditExcludedPackageReasons(studentsCoursesSnapshot) {
  const excluded = {};

  studentsCoursesSnapshot.rows.forEach(function(row) {
    const studentName = readTrimmedCell(row, studentsCoursesSnapshot.cols, "Student Name");
    const className = readTrimmedCell(row, studentsCoursesSnapshot.cols, "Student Full Name");
    const packageName = readTrimmedCell(row, studentsCoursesSnapshot.cols, "Class Subject");
    const reason = getPackageExclusionReason(className, packageName);

    if (!studentName || !packageName || !reason) return;
    excluded[buildStudentPackageKey(studentName, packageName)] = reason;
  });

  return excluded;
}

function buildAuditAdminOwnershipMap(remainingCreditsSnapshot) {
  const ownershipStats = {};

  remainingCreditsSnapshot.rows.forEach(function(row, rowIndex) {
    const studentName = readTrimmedCell(row, remainingCreditsSnapshot.cols, "Student");
    const recognizedAdmin = getRecognizedAdminByName(
      readTrimmedCell(row, remainingCreditsSnapshot.cols, "Admin")
    );

    if (!studentName || !recognizedAdmin) return;

    if (!ownershipStats[studentName]) {
      ownershipStats[studentName] = {};
    }

    if (!ownershipStats[studentName][recognizedAdmin.key]) {
      ownershipStats[studentName][recognizedAdmin.key] = {
        count: 0,
        firstRowIndex: rowIndex,
        fullName: recognizedAdmin.fullName,
      };
    }

    ownershipStats[studentName][recognizedAdmin.key].count++;
  });

  return Object.keys(ownershipStats).reduce(function(map, studentName) {
    const winningKey = Object.keys(ownershipStats[studentName]).sort(function(keyA, keyB) {
      const countDelta = ownershipStats[studentName][keyB].count - ownershipStats[studentName][keyA].count;
      if (countDelta !== 0) return countDelta;
      return ownershipStats[studentName][keyA].firstRowIndex - ownershipStats[studentName][keyB].firstRowIndex;
    })[0];

    map[studentName] = winningKey
      ? {
          key: winningKey,
          name: ownershipStats[studentName][winningKey].fullName,
          source: "resolved",
        }
      : createUnassignedAdminOwnership();
    return map;
  }, {});
}

function buildAuditPendingDeductionContext(
  creditControlSnapshot,
  activeStudents,
  excludedPackageReasons,
  today
) {
  const amountsByKey = {};
  const detailsByKey = {};
  const fallbackKeys = {};
  const fallbackRows = [];

  creditControlSnapshot.rows.forEach(function(row, rowIndex) {
    const studentName = readTrimmedCell(row, creditControlSnapshot.cols, "Student Name");
    const packageName = readTrimmedCell(row, creditControlSnapshot.cols, "Package/Program");
    const sessionDate = parseDate(row[creditControlSnapshot.cols["session_date"]]);
    const key = buildStudentPackageKey(studentName, packageName);

    if (!studentName || !packageName || !sessionDate) return;
    if (!activeStudents.has(studentName)) return;
    if (excludedPackageReasons[key]) return;
    if (sessionDate > today) return;

    const finalStatus = normalizeText(readTrimmedCell(row, creditControlSnapshot.cols, "final_status")).toUpperCase();
    const teacherFeedback = normalizeText(readTrimmedCell(row, creditControlSnapshot.cols, "teacher_feedback"));
    const creditsConsumed = parseNumber(row[creditControlSnapshot.cols["credits_consumed"]]);

    if (!(finalStatus === "ENDED" && (teacherFeedback === "" || teacherFeedback === "0") && creditsConsumed === 0)) {
      return;
    }

    const detail = buildPendingDeductionDetail(
      creditControlSnapshot,
      row,
      rowIndex,
      studentName,
      packageName,
      sessionDate,
      parseNumber(row[creditControlSnapshot.cols["session_duration"]], 60)
    );

    amountsByKey[key] = roundToTenth((amountsByKey[key] || 0) + detail.deductionCredits);
    if (!detailsByKey[key]) {
      detailsByKey[key] = [];
    }
    detailsByKey[key].push(detail);

    if (detail.usingFallback) {
      fallbackKeys[key] = true;
      fallbackRows.push(detail);
    }
  });

  return {
    amountsByKey: amountsByKey,
    detailsByKey: detailsByKey,
    fallbackKeys: fallbackKeys,
    fallbackRows: fallbackRows,
  };
}

function buildAuditUpcomingSessionMap(upcomingSnapshot, activeStudents, excludedPackageReasons, today) {
  const upcomingSessionMap = {};

  upcomingSnapshot.rows.forEach(function(row) {
    const studentName = readTrimmedCell(row, upcomingSnapshot.cols, "Student Name");
    const packageName = readTrimmedCell(row, upcomingSnapshot.cols, "Package/Program");
    const sessionDate = parseDate(row[upcomingSnapshot.cols["Scheduled Date"]]);
    const key = buildStudentPackageKey(studentName, packageName);

    if (!studentName || !packageName || !sessionDate) return;
    if (!activeStudents.has(studentName)) return;
    if (excludedPackageReasons[key]) return;
    if (sessionDate <= today) return;
    if (readUpperCell(row, upcomingSnapshot.cols, "Session Status") !== "UPCOMING") return;

    if (!upcomingSessionMap[key]) {
      upcomingSessionMap[key] = [];
    }

    upcomingSessionMap[key].push({
      date: sessionDate,
      durationMin: parseNumber(row[upcomingSnapshot.cols["Session Duration"]], 60),
    });
  });

  Object.keys(upcomingSessionMap).forEach(function(key) {
    upcomingSessionMap[key].sort(function(a, b) {
      return a.date - b.date;
    });
  });

  return upcomingSessionMap;
}

function buildAuditExpectedStudents(
  aggregationsSnapshot,
  pendingDeductionContext,
  upcomingSessionMap,
  activeStudents,
  excludedPackageReasons,
  today,
  adminOwnershipMap
) {
  const studentMap = {};

  aggregationsSnapshot.rows.forEach(function(row, rowIndex) {
    const studentName = readTrimmedCell(row, aggregationsSnapshot.cols, "Student Name");
    const parentName = readTrimmedCell(row, aggregationsSnapshot.cols, "Parent Name");
    const packageName = readTrimmedCell(row, aggregationsSnapshot.cols, "Class Subject");
    const key = buildStudentPackageKey(studentName, packageName);

    if (!studentName || !packageName) return;
    if (!activeStudents.has(studentName)) return;
    if (excludedPackageReasons[key]) return;

    const currentRemaining = parseNumber(row[aggregationsSnapshot.cols["Current Remaining Credits"]]);
    const totalCredits = parseNumber(row[aggregationsSnapshot.cols["Current Total Credits"]]);
    const pendingDeduction = roundToTenth(pendingDeductionContext.amountsByKey[key] || 0);
    const sessions = upcomingSessionMap[key] || [];
    const adjustedRemaining = roundToTenth(Math.max(0, currentRemaining - pendingDeduction));
    const projection = computeProjection(adjustedRemaining, sessions, today);
    const cadence = computeSessionCadence(sessions);
    const packageRecord = {
      key: key,
      student: studentName,
      parent: parentName,
      name: packageName,
      subject: packageName,
      currentRemaining: currentRemaining,
      pendingDeduction: pendingDeduction,
      pendingDeductionDetails: pendingDeductionContext.detailsByKey[key] || [],
      pendingDeductionUsesFallback: !!pendingDeductionContext.fallbackKeys[key],
      adjustedRemaining: adjustedRemaining,
      totalCredits: totalCredits,
      alertDate: projection.alertDate,
      exhaustDate: projection.exhaustDate,
      daysUntilAlert: projection.daysUntilAlert,
      daysUntilExhaust: projection.daysUntilExhaust,
      status: projection.status,
      projection: projection.rows,
      upcomingSessions: sessions.map(function(session) {
        return {
          date: formatDate(session.date),
          durationMin: session.durationMin,
          deduct: roundToHundredth(session.durationMin / 60),
        };
      }),
      upcomingCount: sessions.length,
      nextSessionDate: sessions.length ? formatDate(sessions[0].date) : null,
      totalScheduledCredits: cadence.totalScheduledCredits,
      sessionCadencePerWeek: cadence.sessionCadencePerWeek,
      averageCreditsPerWeek: cadence.averageCreditsPerWeek,
      cadenceLabel: cadence.cadenceLabel,
      duplicateCount: 1,
      sourceRowNumbers: [(aggregationsSnapshot.dataRowStartIndex || 2) + rowIndex],
    };

    if (!studentMap[studentName]) {
      const adminOwnership = adminOwnershipMap[studentName] || createUnassignedAdminOwnership();
      studentMap[studentName] = {
        student: studentName,
        parent: parentName,
        packages: [],
        adminOwnerKey: adminOwnership.key,
        adminOwnerName: adminOwnership.name,
        adminOwnershipSource: adminOwnership.source,
      };
    }

    if (!studentMap[studentName].parent && parentName) {
      studentMap[studentName].parent = parentName;
    }

    const existingIndex = studentMap[studentName].packages.findIndex(function(existingPackage) {
      return existingPackage.name === packageName;
    });

    if (existingIndex === -1) {
      studentMap[studentName].packages.push(packageRecord);
      return;
    }

    const existingPackage = studentMap[studentName].packages[existingIndex];
    const duplicateCount = (existingPackage.duplicateCount || 1) + 1;
    const winner = packageRecord.totalCredits > existingPackage.totalCredits
      ? packageRecord
      : existingPackage;

    winner.duplicateCount = duplicateCount;
    winner.sourceRowNumbers = (existingPackage.sourceRowNumbers || []).concat(packageRecord.sourceRowNumbers || []);
    studentMap[studentName].packages[existingIndex] = winner;
  });

  return Object.keys(studentMap).sort().map(function(studentName) {
    const studentRecord = studentMap[studentName];
    studentRecord.dataQualityFlags = buildStudentDataQualityFlags(studentRecord);
    studentRecord.packages = studentRecord.packages
      .map(function(pkg) {
        const dataQualityFlags = buildPackageDataQualityFlags(pkg, studentRecord);
        return Object.assign({}, pkg, {
          dataQualityFlags: dataQualityFlags,
          recommendedAction: getRecommendedAction(pkg, dataQualityFlags),
          whyNow: getActionReason(pkg, dataQualityFlags),
        });
      })
      .sort(comparePackages);
    return studentRecord;
  });
}

function buildAuditExpectedStudentQueue(students) {
  return students
    .map(function(student) {
      const packages = student.packages || [];
      const totalCurrentRemaining = roundToTenth(packages.reduce(function(sum, pkg) {
        return sum + pkg.currentRemaining;
      }, 0));
      const totalAdjustedRemaining = roundToTenth(packages.reduce(function(sum, pkg) {
        return sum + pkg.adjustedRemaining;
      }, 0));
      const totalPendingDeduction = roundToTenth(packages.reduce(function(sum, pkg) {
        return sum + pkg.pendingDeduction;
      }, 0));
      const riskyPackages = packages.filter(function(pkg) {
        return pkg.status === "notify" || pkg.status === "watch";
      });
      const nextSession = findStudentNextSession(packages);
      const worst = worstStatus(packages);
      const noFutureSchedule = !nextSession;
      const pinned = noFutureSchedule && (
        totalAdjustedRemaining < ALERT_THRESHOLD || totalCurrentRemaining <= 0
      );

      return {
        key: student.student,
        student: student.student,
        totalCurrentRemaining: totalCurrentRemaining,
        totalAdjustedRemaining: totalAdjustedRemaining,
        totalPendingDeduction: totalPendingDeduction,
        packageCount: packages.length,
        riskyPackageCount: riskyPackages.length,
        nextSessionDate: nextSession ? nextSession.date : null,
        nextSessionPackageName: nextSession ? nextSession.packageName : null,
        worstStatus: worst,
        noFutureSchedule: noFutureSchedule,
        pinned: pinned,
        includeInQueue: pinned || riskyPackages.length > 0,
      };
    })
    .filter(function(row) {
      return row.includeInQueue;
    });
}

function buildAuditExpectedSummary(students, studentQueue) {
  const studentCounts = { total: students.length, notify: 0, watch: 0, ok: 0, nodata: 0 };
  const packageCounts = { total: 0, notify: 0, watch: 0, ok: 0, nodata: 0 };
  let exhaustedNow = 0;
  let risk7 = 0;
  let risk14 = 0;
  let risk30 = 0;
  let noSchedule = 0;
  let pendingDeductionBacklog = 0;
  let pendingDeductionPackages = 0;
  let lowBalanceNoSchedule = 0;
  let multiRiskStudents = 0;

  students.forEach(function(student) {
    studentCounts[worstStatus(student.packages)]++;
    const riskyPackages = student.packages.filter(function(pkg) {
      return pkg.status === "notify" || pkg.status === "watch";
    }).length;
    if (riskyPackages > 1) multiRiskStudents++;

    student.packages.forEach(function(pkg) {
      packageCounts.total++;
      packageCounts[pkg.status]++;
      if (pkg.adjustedRemaining <= 0) exhaustedNow++;
      if (pkg.daysUntilAlert !== null && pkg.daysUntilAlert <= 7) risk7++;
      if (pkg.daysUntilAlert !== null && pkg.daysUntilAlert <= 14) risk14++;
      if (pkg.daysUntilAlert !== null && pkg.daysUntilAlert <= 30) risk30++;
      if (pkg.dataQualityFlags.indexOf("no-upcoming-sessions") !== -1) noSchedule++;
      if (pkg.pendingDeduction > 0) {
        pendingDeductionBacklog += pkg.pendingDeduction;
        pendingDeductionPackages++;
      }
      if (pkg.dataQualityFlags.indexOf("low-balance-no-schedule") !== -1) {
        lowBalanceNoSchedule++;
      }
    });
  });

  return {
    students: studentCounts,
    packages: packageCounts,
    portfolio: {
      exhaustedNow: exhaustedNow,
      risk7: risk7,
      risk14: risk14,
      risk30: risk30,
      noSchedule: noSchedule,
      pendingDeductionBacklog: roundToTenth(pendingDeductionBacklog),
      pendingDeductionPackages: pendingDeductionPackages,
      lowBalanceNoSchedule: lowBalanceNoSchedule,
      multiRiskStudents: multiRiskStudents,
    },
    queue: {
      students: studentQueue.length,
      pinnedStudents: studentQueue.filter(function(row) { return row.pinned; }).length,
    },
  };
}

function buildLiveAccuracyAuditReport(actualPayload, expectedModel, today, now) {
  const findings = [];
  const actualPackages = flattenPackages(actualPayload.students);
  const actualPackageKeys = Object.keys(actualPackages);
  const expectedPackageKeys = Object.keys(expectedModel.packagesByKey);

  expectedPackageKeys.forEach(function(key) {
    const expected = expectedModel.packagesByKey[key];
    const actual = actualPackages[key];

    if (!actual) {
      findings.push(createAuditFinding("FAIL", "package", key, "present", "expected package", "missing", ""));
      return;
    }

    compareAuditField(findings, "package", key, "currentRemaining", expected.currentRemaining, actual.currentRemaining);
    compareAuditField(findings, "package", key, "totalCredits", expected.totalCredits, actual.totalCredits);
    compareAuditField(findings, "package", key, "pendingDeduction", expected.pendingDeduction, actual.pendingDeduction);
    compareAuditField(findings, "package", key, "adjustedRemaining", expected.adjustedRemaining, actual.adjustedRemaining);
    compareAuditField(findings, "package", key, "status", expected.status, actual.status);
    compareAuditField(findings, "package", key, "alertDate", expected.alertDate, actual.alertDate);
    compareAuditField(findings, "package", key, "exhaustDate", expected.exhaustDate, actual.exhaustDate);
    compareAuditField(findings, "package", key, "nextSessionDate", expected.nextSessionDate, actual.nextSessionDate);
    compareAuditField(findings, "package", key, "upcomingCount", expected.upcomingCount, actual.upcomingCount);
    compareAuditField(
      findings,
      "package",
      key,
      "pendingDeductionUsesFallback",
      !!expected.pendingDeductionUsesFallback,
      !!actual.pendingDeductionUsesFallback
    );
    compareAuditField(
      findings,
      "package",
      key,
      "dataQualityFlags",
      sortStrings(expected.dataQualityFlags).join("|"),
      sortStrings(actual.dataQualityFlags || []).join("|")
    );
    compareAuditField(
      findings,
      "package",
      key,
      "projection",
      JSON.stringify(expected.projection),
      JSON.stringify(actual.projection)
    );
  });

  actualPackageKeys.forEach(function(key) {
    if (!expectedModel.packagesByKey[key]) {
      findings.push(createAuditFinding("FAIL", "package", key, "unexpected", "not present", "extra package", ""));
    }
  });

  const actualQueueByKey = {};
  (actualPayload.studentQueue || []).forEach(function(row) {
    actualQueueByKey[row.key] = row;
  });

  Object.keys(expectedModel.studentQueueByKey).forEach(function(key) {
    const expected = expectedModel.studentQueueByKey[key];
    const actual = actualQueueByKey[key];

    if (!actual) {
      findings.push(createAuditFinding("FAIL", "queue", key, "present", "expected queue row", "missing", ""));
      return;
    }

    compareAuditField(findings, "queue", key, "totalCurrentRemaining", expected.totalCurrentRemaining, actual.totalCurrentRemaining);
    compareAuditField(findings, "queue", key, "totalAdjustedRemaining", expected.totalAdjustedRemaining, actual.totalAdjustedRemaining);
    compareAuditField(findings, "queue", key, "totalPendingDeduction", expected.totalPendingDeduction, actual.totalPendingDeduction);
    compareAuditField(findings, "queue", key, "packageCount", expected.packageCount, actual.packageCount);
    compareAuditField(findings, "queue", key, "riskyPackageCount", expected.riskyPackageCount, actual.riskyPackageCount);
    compareAuditField(findings, "queue", key, "nextSessionDate", expected.nextSessionDate, actual.nextSessionDate);
    compareAuditField(findings, "queue", key, "nextSessionPackageName", expected.nextSessionPackageName, actual.nextSessionPackageName);
    compareAuditField(findings, "queue", key, "worstStatus", expected.worstStatus, actual.worstStatus);
    compareAuditField(findings, "queue", key, "noFutureSchedule", expected.noFutureSchedule, actual.noFutureSchedule);
    compareAuditField(findings, "queue", key, "pinned", expected.pinned, actual.pinned);
  });

  Object.keys(actualQueueByKey).forEach(function(key) {
    if (!expectedModel.studentQueueByKey[key]) {
      findings.push(createAuditFinding("FAIL", "queue", key, "unexpected", "not present", "extra queue row", ""));
    }
  });

  compareAuditField(findings, "summary", "packages", "notify", expectedModel.summary.packages.notify, actualPayload.summary.packages.notify);
  compareAuditField(findings, "summary", "packages", "watch", expectedModel.summary.packages.watch, actualPayload.summary.packages.watch);
  compareAuditField(findings, "summary", "packages", "ok", expectedModel.summary.packages.ok, actualPayload.summary.packages.ok);
  compareAuditField(findings, "summary", "packages", "nodata", expectedModel.summary.packages.nodata, actualPayload.summary.packages.nodata);
  compareAuditField(findings, "summary", "portfolio", "exhaustedNow", expectedModel.summary.portfolio.exhaustedNow, actualPayload.summary.portfolio.exhaustedNow);
  compareAuditField(findings, "summary", "portfolio", "risk7", expectedModel.summary.portfolio.risk7, actualPayload.summary.portfolio.risk7);
  compareAuditField(findings, "summary", "portfolio", "risk14", expectedModel.summary.portfolio.risk14, actualPayload.summary.portfolio.risk14);
  compareAuditField(findings, "summary", "portfolio", "risk30", expectedModel.summary.portfolio.risk30, actualPayload.summary.portfolio.risk30);
  compareAuditField(findings, "summary", "portfolio", "noSchedule", expectedModel.summary.portfolio.noSchedule, actualPayload.summary.portfolio.noSchedule);
  compareAuditField(
    findings,
    "summary",
    "portfolio",
    "pendingDeductionBacklog",
    expectedModel.summary.portfolio.pendingDeductionBacklog,
    actualPayload.summary.portfolio.pendingDeductionBacklog
  );
  compareAuditField(
    findings,
    "summary",
    "portfolio",
    "pendingDeductionPackages",
    expectedModel.summary.portfolio.pendingDeductionPackages,
    actualPayload.summary.portfolio.pendingDeductionPackages
  );
  compareAuditField(findings, "summary", "queue", "students", expectedModel.summary.queue.students, actualPayload.summary.queue.students);
  compareAuditField(
    findings,
    "summary",
    "queue",
    "pinnedStudents",
    expectedModel.summary.queue.pinnedStudents,
    actualPayload.summary.queue.pinnedStudents
  );

  expectedModel.metadata.pendingDeductionContext.fallbackRows.forEach(function(detail) {
    findings.push(createAuditFinding(
      "WARN",
      "pending-deduction",
      detail.key,
      "fallback",
      "Should_Credit",
      "session_duration",
      "Row " + detail.rowNumber + " on " + detail.sessionDate
    ));
  });

  appendDeanAuditAssertion(findings, expectedModel, actualPayload, today);

  const failed = findings.filter(function(item) { return item.severity === "FAIL"; }).length;
  const warnings = findings.filter(function(item) { return item.severity === "WARN"; }).length;

  return {
    generatedAt: formatDateTime(now),
    findings: findings,
    summary: {
      status: failed > 0 ? "FAIL" : "PASS",
      failed: failed,
      warnings: warnings,
      packagesChecked: expectedPackageKeys.length,
      queueRowsChecked: Object.keys(expectedModel.studentQueueByKey).length,
      auditDate: formatDate(today),
    },
  };
}

function appendDeanAuditAssertion(findings, expectedModel, actualPayload, today) {
  const studentName = "Varis (Dean.Ka) Karuhadej";
  const packageName = "Y12-13 / G11-12 (Int.)";
  const key = buildStudentPackageKey(studentName, packageName);
  const expected = expectedModel.packagesByKey[key];
  const actual = findPackageByKey(actualPayload.students, key);

  if (!expected) {
    findings.push(createAuditFinding("FAIL", "dean-check", key, "package", "expected package", "missing", ""));
    return;
  }

  const source = expected.pendingDeductionDetails.map(function(detail) {
    return "row " + detail.rowNumber + ": " + detail.deductionCredits + " via " + detail.deductionSource;
  }).join("; ");

  if (expected.currentRemaining !== 1.5 || expected.pendingDeduction !== 1.5 || expected.adjustedRemaining !== 0) {
    findings.push(createAuditFinding(
      "FAIL",
      "dean-check",
      key,
      "expected-balance",
      "system=1.5, pending=1.5, actual=0.0",
      "system=" + expected.currentRemaining + ", pending=" + expected.pendingDeduction + ", actual=" + expected.adjustedRemaining,
      source
    ));
  }

  if (!actual) {
    findings.push(createAuditFinding("FAIL", "dean-check", key, "actual-package", "present", "missing", source));
    return;
  }

  if (actual.adjustedRemaining !== 0) {
    findings.push(createAuditFinding(
      "FAIL",
      "dean-check",
      key,
      "website-actual-remaining",
      0,
      actual.adjustedRemaining,
      source
    ));
  }
}

function writeAuditReport(report) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_ANALYTICS);
  const sheet = spreadsheet.getSheetByName(SHEET_AUDIT_REPORT) || spreadsheet.insertSheet(SHEET_AUDIT_REPORT);
  const rows = [
    ["Dashboard Accuracy Audit", "", "", "", "", "", ""],
    ["Generated At", report.generatedAt, "", "", "", "", ""],
    ["Status", report.summary.status, "", "", "", "", ""],
    ["Failures", report.summary.failed, "", "", "", "", ""],
    ["Warnings", report.summary.warnings, "", "", "", "", ""],
    ["Packages Checked", report.summary.packagesChecked, "", "", "", "", ""],
    ["Queue Rows Checked", report.summary.queueRowsChecked, "", "", "", "", ""],
    ["Audit Date", report.summary.auditDate, "", "", "", "", ""],
    ["Severity", "Scope", "Identifier", "Field", "Expected", "Actual", "Source"],
  ];

  if (report.findings.length) {
    report.findings.forEach(function(finding) {
      rows.push([
        finding.severity,
        finding.scope,
        finding.identifier,
        finding.field,
        formatAuditValue(finding.expected),
        formatAuditValue(finding.actual),
        formatAuditValue(finding.source),
      ]);
    });
  } else {
    rows.push(["INFO", "audit", "all", "status", "No mismatches", "", ""]);
  }

  sheet.clearContents();
  sheet.clearFormats();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.setFrozenRows(9);
  sheet.autoResizeColumns(1, rows[0].length);
}

function collectAggregationInspectionRows(aggregationsSnapshot, studentName, packageName) {
  return aggregationsSnapshot.rows.reduce(function(rows, row, rowIndex) {
    if (
      readTrimmedCell(row, aggregationsSnapshot.cols, "Student Name") === studentName &&
      readTrimmedCell(row, aggregationsSnapshot.cols, "Class Subject") === packageName
    ) {
      rows.push({
        rowNumber: (aggregationsSnapshot.dataRowStartIndex || 2) + rowIndex,
        parentName: readTrimmedCell(row, aggregationsSnapshot.cols, "Parent Name"),
        currentRemaining: parseNumber(row[aggregationsSnapshot.cols["Current Remaining Credits"]]),
        totalCredits: parseNumber(row[aggregationsSnapshot.cols["Current Total Credits"]]),
      });
    }
    return rows;
  }, []);
}

function collectPendingInspectionRows(
  creditControlSnapshot,
  studentName,
  packageName,
  today,
  activeStudents,
  excludedPackageReasons
) {
  const key = buildStudentPackageKey(studentName, packageName);

  return creditControlSnapshot.rows.reduce(function(rows, row, rowIndex) {
    if (
      readTrimmedCell(row, creditControlSnapshot.cols, "Student Name") !== studentName ||
      readTrimmedCell(row, creditControlSnapshot.cols, "Package/Program") !== packageName
    ) {
      return rows;
    }

    const sessionDate = parseDate(row[creditControlSnapshot.cols["session_date"]]);
    const finalStatus = readTrimmedCell(row, creditControlSnapshot.cols, "final_status");
    const teacherFeedback = readTrimmedCell(row, creditControlSnapshot.cols, "teacher_feedback");
    const creditsConsumed = parseNumber(row[creditControlSnapshot.cols["credits_consumed"]]);
    const eligible = !!sessionDate &&
      activeStudents.has(studentName) &&
      !excludedPackageReasons[key] &&
      sessionDate <= today &&
      normalizeText(finalStatus).toUpperCase() === "ENDED" &&
      (normalizeText(teacherFeedback) === "" || normalizeText(teacherFeedback) === "0") &&
      creditsConsumed === 0;
    const detail = eligible
      ? buildPendingDeductionDetail(
          creditControlSnapshot,
          row,
          rowIndex,
          studentName,
          packageName,
          sessionDate,
          parseNumber(row[creditControlSnapshot.cols["session_duration"]], 60)
        )
      : null;

    rows.push({
      rowNumber: (creditControlSnapshot.dataRowStartIndex || 2) + rowIndex,
      sessionDate: sessionDate ? formatDate(sessionDate) : null,
      finalStatus: finalStatus,
      teacherFeedback: teacherFeedback,
      creditsConsumed: creditsConsumed,
      shouldCredit: Object.prototype.hasOwnProperty.call(creditControlSnapshot.cols, "Should_Credit")
        ? row[creditControlSnapshot.cols["Should_Credit"]]
        : null,
      sessionDuration: parseNumber(row[creditControlSnapshot.cols["session_duration"]], 60),
      eligibleForPending: eligible,
      deductionCredits: detail ? detail.deductionCredits : 0,
      deductionSource: detail ? detail.deductionSource : null,
    });

    return rows;
  }, []);
}

function collectUpcomingInspectionRows(
  upcomingSnapshot,
  studentName,
  packageName,
  today,
  activeStudents,
  excludedPackageReasons
) {
  const key = buildStudentPackageKey(studentName, packageName);

  return upcomingSnapshot.rows.reduce(function(rows, row, rowIndex) {
    if (
      readTrimmedCell(row, upcomingSnapshot.cols, "Student Name") !== studentName ||
      readTrimmedCell(row, upcomingSnapshot.cols, "Package/Program") !== packageName
    ) {
      return rows;
    }

    const scheduledDate = parseDate(row[upcomingSnapshot.cols["Scheduled Date"]]);
    const counted = !!scheduledDate &&
      activeStudents.has(studentName) &&
      !excludedPackageReasons[key] &&
      scheduledDate > today &&
      readUpperCell(row, upcomingSnapshot.cols, "Session Status") === "UPCOMING";

    rows.push({
      rowNumber: (upcomingSnapshot.dataRowStartIndex || 2) + rowIndex,
      scheduledDate: scheduledDate ? formatDate(scheduledDate) : null,
      sessionDuration: parseNumber(row[upcomingSnapshot.cols["Session Duration"]], 60),
      sessionStatus: readTrimmedCell(row, upcomingSnapshot.cols, "Session Status"),
      countedInProjection: counted,
    });

    return rows;
  }, []);
}

function flattenPackages(students) {
  return (students || []).reduce(function(map, student) {
    (student.packages || []).forEach(function(pkg) {
      map[pkg.key] = pkg;
    });
    return map;
  }, {});
}

function findPackageByKey(students, key) {
  const packages = flattenPackages(students);
  return packages[key] || null;
}

function compareAuditField(findings, scope, identifier, field, expected, actual, source) {
  if (expected === actual) return;
  findings.push(createAuditFinding("FAIL", scope, identifier, field, expected, actual, source || ""));
}

function createAuditFinding(severity, scope, identifier, field, expected, actual, source) {
  return {
    severity: severity,
    scope: scope,
    identifier: identifier,
    field: field,
    expected: expected,
    actual: actual,
    source: source || "",
  };
}

function formatAuditValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;

  const serialized = JSON.stringify(value);
  return serialized && serialized.length > 500
    ? serialized.slice(0, 497) + "..."
    : serialized;
}

function sortStrings(values) {
  return (values || []).slice().sort();
}

function testTrialPackagesAreExcluded() {
  const excluded = buildExcludedPackageReasons(createSnapshot(
    ["Student Name", "Student Full Name", "Class Subject"],
    [
      {
        "Student Name": "Alice Smith",
        "Student Full Name": "Mathematics",
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
    ["Student Name", "Student Full Name", "Class Subject"],
    [
      {
        "Student Name": "Bob Tan",
        "Student Full Name": "Science Pretest",
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
        "Should_Credit",
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
          "Should_Credit": "",
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

function testPendingDeductionUsesShouldCreditWhenAvailable() {
  const today = new Date(2026, 2, 29);
  const activeStudents = new Set(["Cara Lim"]);
  const pendingContext = buildPendingDeductionContext(
    createSnapshot(
      [
        "Student Name",
        "Package/Program",
        "final_status",
        "teacher_feedback",
        "credits_consumed",
        "session_duration",
        "session_date",
        "Should_Credit",
      ],
      [
        {
          "Student Name": "Cara Lim",
          "Package/Program": "Math Pack",
          "final_status": "ENDED",
          "teacher_feedback": "",
          "credits_consumed": 0,
          "session_duration": 78,
          "session_date": "2026-03-28",
          "Should_Credit": 1.5,
        },
      ]
    ),
    activeStudents,
    {},
    today
  );

  const key = buildStudentPackageKey("Cara Lim", "Math Pack");
  assertEqual(
    pendingContext.amountsByKey[key],
    1.5,
    "Expected pending deductions to use Should_Credit when it is available."
  );
  assertEqual(
    pendingContext.detailsByKey[key][0].deductionSource,
    "Should_Credit",
    "Expected pending deduction detail to record the canonical source."
  );
  assertTrue(
    !pendingContext.detailsByKey[key][0].usingFallback,
    "Expected Should_Credit-backed deductions not to be flagged as fallback."
  );
}

function testPendingDeductionFallsBackToDurationWhenShouldCreditMissing() {
  const today = new Date(2026, 2, 29);
  const activeStudents = new Set(["Cara Lim"]);
  const pendingContext = buildPendingDeductionContext(
    createSnapshot(
      [
        "Student Name",
        "Package/Program",
        "final_status",
        "teacher_feedback",
        "credits_consumed",
        "session_duration",
        "session_date",
        "Should_Credit",
      ],
      [
        {
          "Student Name": "Cara Lim",
          "Package/Program": "Math Pack",
          "final_status": "ENDED",
          "teacher_feedback": "",
          "credits_consumed": 0,
          "session_duration": 78,
          "session_date": "2026-03-28",
          "Should_Credit": "",
        },
      ]
    ),
    activeStudents,
    {},
    today
  );

  const key = buildStudentPackageKey("Cara Lim", "Math Pack");
  assertEqual(
    pendingContext.amountsByKey[key],
    1.3,
    "Expected missing Should_Credit values to fall back to the duration-based deduction."
  );
  assertEqual(
    pendingContext.detailsByKey[key][0].deductionSource,
    "session_duration",
    "Expected fallback deductions to record the duration source."
  );
  assertTrue(
    pendingContext.detailsByKey[key][0].usingFallback,
    "Expected fallback deductions to be explicitly flagged."
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
        "Should_Credit",
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
          "Should_Credit": 1,
        },
        {
          "Student Name": "Dylan Ng",
          "Package/Program": "Science Pack",
          "final_status": "ENDED",
          "teacher_feedback": "",
          "credits_consumed": 1,
          "session_duration": 60,
          "session_date": "2026-03-21",
          "Should_Credit": 1,
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

function testRecognizedAdminOwnershipResolvesCorrectly() {
  const ownershipMap = buildStudentAdminOwnershipMap(createSnapshot(
    ["Student", "Admin"],
    [
      {
        "Student": "Palm Student",
        "Admin": "Chiraya (Palm) Takornkulwut",
      },
      {
        "Student": "Muk Student",
        "Admin": "Suphitsara (Muk) Manosamrit",
      },
    ]
  ));

  assertEqual(ownershipMap["Palm Student"].key, "palm", "Expected Palm student to resolve to the Palm admin key.");
  assertEqual(ownershipMap["Muk Student"].key, "muk", "Expected Muk student to resolve to the Muk admin key.");
}

function testBlankAdminOwnershipFallsBackToUnassigned() {
  const ownershipMap = buildStudentAdminOwnershipMap(createSnapshot(
    ["Student", "Admin"],
    [
      {
        "Student": "Unassigned Student",
        "Admin": "",
      },
    ]
  ));

  assertEqual(
    ownershipMap["Unassigned Student"].key,
    UNASSIGNED_ADMIN_KEY,
    "Expected blank admin rows to resolve to unassigned."
  );
}

function testConflictingAdminOwnershipUsesCountThenFirstRow() {
  const ownershipMap = buildStudentAdminOwnershipMap(createSnapshot(
    ["Student", "Admin"],
    [
      {
        "Student": "Shared Student",
        "Admin": "Panida (Petchy) Wiya",
      },
      {
        "Student": "Shared Student",
        "Admin": "Chiraya (Palm) Takornkulwut",
      },
      {
        "Student": "Shared Student",
        "Admin": "Panida (Petchy) Wiya",
      },
      {
        "Student": "Tie Student",
        "Admin": "Kittiya (Care) Taweesinprasarn",
      },
      {
        "Student": "Tie Student",
        "Admin": "Suphitsara (Muk) Manosamrit",
      },
    ]
  ));

  assertEqual(
    ownershipMap["Shared Student"].key,
    "petchy",
    "Expected the most frequent admin to win ownership resolution."
  );
  assertEqual(
    ownershipMap["Tie Student"].key,
    "care",
    "Expected ties to use the earliest recognized RemainingCredits row."
  );
}

function testStudentsMissingOwnershipMapDefaultToUnassigned() {
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
          "Student Name": "Missing Owner",
          "Parent Name": "Parent One",
          "Class Subject": "English Pack",
          "Current Remaining Credits": 4,
          "Current Total Credits": 8,
        },
      ]
    ),
    new Set(["Missing Owner"]),
    {},
    {},
    {},
    new Date(2026, 2, 29),
    {}
  );

  assertEqual(
    payload[0].adminOwnerKey,
    UNASSIGNED_ADMIN_KEY,
    "Expected students without a RemainingCredits ownership row to default to unassigned."
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

  const gina = dashboard.payload.students.find(function(student) {
    return student.student === "Gina Ho";
  });
  const harry = dashboard.payload.students.find(function(student) {
    return student.student === "Harry Lim";
  });

  assertEqual(dashboard.payload.studentQueue[0].student, "Gina Ho", "Expected notify student to rank first.");
  assertTrue(
    gina.packages[0].priorityScore > harry.packages[0].priorityScore,
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
      queue: {
        students: 8,
        pinnedStudents: 3,
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
      queue: {
        students: 6,
        pinnedStudents: 2,
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

function testSetStudentActionPersistsAndClearsCache() {
  const properties = createFakeProperties();
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T02:00:00Z");
  payload.notes = "x".repeat(DASHBOARD_CACHE_CHUNK_SIZE + 25);

  writeChunkedCacheValue(cache, "fixture-action-cache", payload, 120);

  const result = setStudentAction(
    "jane doe::parent doe",
    "contacted",
    "palm",
    {
      properties: properties,
      cache: cache,
      cacheKey: "fixture-action-cache",
      now: new Date(2026, 2, 31, 9, 30, 0),
      today: new Date(2026, 2, 31),
    }
  );
  const stored = loadStudentActionRecord("jane doe::parent doe", {
    properties: properties,
  });

  assertEqual(result.actionState.status, "contacted", "Expected setStudentAction to return the saved status.");
  assertEqual(result.actionState.updatedByAdminLabel, "Palm", "Expected named admin views to persist the actor label.");
  assertEqual(stored.history.length, 1, "Expected setStudentAction to append one history entry.");
  assertEqual(stored.latestAction.status, "contacted", "Expected latest action to match the saved status.");
  assertEqual(
    cache.get(getDashboardCacheMetaKey("fixture-action-cache")),
    null,
    "Expected student action writes to invalidate the cached dashboard payload."
  );
}

function testClearStudentActionKeepsHistoryButRemovesVisibleState() {
  const properties = createFakeProperties();

  setStudentAction("jane doe::parent doe", "contacted", "palm", {
    properties: properties,
    now: new Date(2026, 2, 31, 9, 0, 0),
    today: new Date(2026, 2, 31),
  });

  const result = clearStudentAction("jane doe::parent doe", "palm", {
    properties: properties,
    now: new Date(2026, 2, 31, 10, 0, 0),
    today: new Date(2026, 2, 31),
  });
  const stored = loadStudentActionRecord("jane doe::parent doe", {
    properties: properties,
  });

  assertEqual(result.actionState, null, "Expected clearStudentAction to return no visible action state.");
  assertEqual(stored.latestAction, null, "Expected clearStudentAction to remove the latest visible action.");
  assertEqual(stored.history.length, 2, "Expected clearStudentAction to retain prior history entries.");
  assertTrue(!!stored.history[0].cleared, "Expected the newest history entry to record the clear operation.");
}

function testBulkSetStudentActionUpdatesMultipleStudents() {
  const properties = createFakeProperties();
  const result = bulkSetStudentAction(
    ["alpha::parent", "beta::parent", "alpha::parent"],
    "resolved",
    "care",
    {
      properties: properties,
      now: new Date(2026, 2, 31, 11, 15, 0),
      today: new Date(2026, 2, 31),
    }
  );

  assertEqual(result.updated.length, 2, "Expected bulkSetStudentAction to deduplicate student keys.");
  assertEqual(
    loadStudentActionRecord("alpha::parent", { properties: properties }).latestAction.updatedByAdminLabel,
    "Care",
    "Expected bulkSetStudentAction to persist the actor on each updated student."
  );
}

function testStudentActionStateOnlySurfacesToday() {
  const properties = createFakeProperties();
  const student = createActionTestStudentFixture("Nina Tan", "Pim Tan", new Date(2026, 2, 31));

  properties.setProperty(
    getStudentActionPropertyKey(student.studentKey),
    JSON.stringify({
      studentKey: student.studentKey,
      latestAction: {
        status: "contacted",
        updatedAt: "2026-03-30T09:00:00+07:00",
        updatedByAdminKey: "palm",
        updatedByAdminLabel: "Palm",
      },
      history: [],
    })
  );

  attachActionStatesToStudents([student], new Date(2026, 2, 31), {
    properties: properties,
  });

  assertEqual(student.actionState, null, "Expected only same-day student actions to surface in the payload.");
}

function testStudentActionActorFallsBackToNullForAllView() {
  const properties = createFakeProperties();
  const result = setStudentAction("jane doe::parent doe", "pending-callback", "all", {
    properties: properties,
    now: new Date(2026, 2, 31, 12, 0, 0),
    today: new Date(2026, 2, 31),
  });

  assertEqual(result.actionState.updatedByAdminKey, null, "Expected actions saved from the All view to omit actor attribution.");
  assertEqual(result.actionState.updatedByAdminLabel, null, "Expected actions saved from the All view to omit actor labels.");
}

function testStudentActionHistoryTrimsToLimit() {
  const properties = createFakeProperties();

  for (let index = 0; index < STUDENT_ACTION_HISTORY_LIMIT + 5; index++) {
    setStudentAction("jane doe::parent doe", "contacted", "palm", {
      properties: properties,
      now: new Date(2026, 2, 1 + index, 9, 0, 0),
      today: new Date(2026, 2, 1 + index),
    });
  }

  const stored = loadStudentActionRecord("jane doe::parent doe", {
    properties: properties,
  });

  assertEqual(
    stored.history.length,
    STUDENT_ACTION_HISTORY_LIMIT,
    "Expected student action history to cap at the configured retention limit."
  );
}

function testDashboardModelMergesStudentActionStateIntoStudentsAndQueue() {
  const today = new Date(2026, 2, 31);
  const properties = createFakeProperties();
  const student = createActionTestStudentFixture("Nina Tan", "Pim Tan", today);

  setStudentAction(student.studentKey, "contacted", "palm", {
    properties: properties,
    now: new Date(2026, 2, 31, 13, 15, 0),
    today: today,
  });

  const dashboard = buildDashboardModel(
    [student],
    { lastSnapshot: null, history: [] },
    today,
    new Date(2026, 2, 31, 13, 30, 0),
    { actionProperties: properties }
  );

  assertEqual(
    dashboard.payload.students[0].actionState.status,
    "contacted",
    "Expected buildDashboardModel to merge visible action state onto student records."
  );
  assertEqual(
    dashboard.payload.studentQueue[0].studentKey,
    student.studentKey,
    "Expected queue rows to expose the stable student key."
  );
  assertEqual(
    dashboard.payload.studentQueue[0].actionState.status,
    "contacted",
    "Expected buildDashboardModel to merge visible action state onto queue rows."
  );
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

function testDashboardTransferChunkedCacheHitSkipsPayloadLoad() {
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T03:30:00Z");
  payload.notes = "x".repeat(DASHBOARD_CACHE_CHUNK_SIZE + 25);
  let payloadLoadCount = 0;

  writeChunkedCacheValue(cache, "fixture-transfer-lazy-hit", payload, 120);

  const manifest = beginDashboardDataTransfer({
    cache: cache,
    cacheKey: "fixture-transfer-lazy-hit",
    payloadLoader: function() {
      payloadLoadCount++;
      return payload;
    },
  });

  assertEqual(payloadLoadCount, 0, "Expected dashboard transfer to skip payload loading when chunk metadata already exists.");
  assertEqual(manifest.mode, "chunked", "Expected dashboard transfer to keep using chunked mode on cache hits.");
  assertTrue(manifest.parts > 1, "Expected chunked cache hit to expose multiple payload parts.");
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

function testDashboardTransferCacheMissReturnsChunkedAfterCaching() {
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T04:30:00Z");
  payload.notes = "x".repeat(DASHBOARD_CACHE_CHUNK_SIZE + 25);
  let payloadLoadCount = 0;

  const manifest = beginDashboardDataTransfer({
    cache: cache,
    cacheKey: "fixture-transfer-cold-cache",
    payloadLoader: function() {
      payloadLoadCount++;
      writeChunkedCacheValue(cache, "fixture-transfer-cold-cache", payload, 120);
      return payload;
    },
  });

  assertEqual(payloadLoadCount, 1, "Expected dashboard transfer cache miss to load the payload exactly once.");
  assertEqual(manifest.mode, "chunked", "Expected dashboard transfer to switch to chunked mode after caching a fresh payload.");
  assertTrue(manifest.parts > 1, "Expected freshly cached payload to expose chunk metadata.");
}

function testDashboardTransferCacheMissFallsBackInlineWhenManifestMissing() {
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T04:45:00Z");
  let payloadLoadCount = 0;

  const transfer = beginDashboardDataTransfer({
    cache: cache,
    cacheKey: "fixture-transfer-inline-fallback",
    payloadLoader: function() {
      payloadLoadCount++;
      return payload;
    },
  });

  assertEqual(payloadLoadCount, 1, "Expected dashboard transfer inline fallback to load the payload exactly once.");
  assertEqual(transfer.mode, "inline", "Expected dashboard transfer to preserve inline fallback when chunk metadata is still missing.");
  assertEqual(transfer.payload.lastUpdatedAt, payload.lastUpdatedAt, "Expected inline fallback to return the loaded payload.");
}

function testDashboardTransferChunkBatchReadsOrderedSlices() {
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T04:50:00Z");
  payload.notes = "x".repeat((DASHBOARD_CACHE_CHUNK_SIZE * 2) + 25);

  writeChunkedCacheValue(cache, "fixture-transfer-batch", payload, 120);

  const serialized = JSON.stringify(payload);
  const batch = fetchDashboardDataChunkBatch(0, 2, {
    cache: cache,
    cacheKey: "fixture-transfer-batch",
  });

  assertEqual(batch.length, 2, "Expected batch chunk reader to return the requested number of available slices.");
  assertEqual(batch[0], serialized.slice(0, DASHBOARD_CACHE_CHUNK_SIZE), "Expected batch chunk reader to preserve the first chunk in order.");
  assertEqual(batch[1], serialized.slice(DASHBOARD_CACHE_CHUNK_SIZE, DASHBOARD_CACHE_CHUNK_SIZE * 2), "Expected batch chunk reader to preserve the second chunk in order.");
}

function testDashboardTransferChunkBatchHandlesFinalPartialBatch() {
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T04:55:00Z");
  payload.notes = "x".repeat((DASHBOARD_CACHE_CHUNK_SIZE * 2) + 25);

  writeChunkedCacheValue(cache, "fixture-transfer-final-batch", payload, 120);

  const serialized = JSON.stringify(payload);
  const batch = fetchDashboardDataChunkBatch(2, 5, {
    cache: cache,
    cacheKey: "fixture-transfer-final-batch",
  });

  assertEqual(batch.length, 1, "Expected final partial batch to return only the remaining chunk slices.");
  assertEqual(batch[0], serialized.slice(DASHBOARD_CACHE_CHUNK_SIZE * 2), "Expected final partial batch to return the trailing payload chunk.");
}

function testDashboardTransferChunkBatchRecoversWhenManifestMissing() {
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T04:56:00Z");
  payload.notes = "x".repeat((DASHBOARD_CACHE_CHUNK_SIZE * 2) + 25);

  writeChunkedCacheValue(cache, "fixture-transfer-batch-recover-meta", payload, 120);
  delete cache.store[getDashboardCacheMetaKey("fixture-transfer-batch-recover-meta")];

  const serialized = JSON.stringify(payload);
  const batch = fetchDashboardDataChunkBatch(0, 2, {
    cache: cache,
    cacheKey: "fixture-transfer-batch-recover-meta",
    payloadLoader: function() {
      return payload;
    },
  });

  assertEqual(batch.length, 2, "Expected missing chunk metadata to recover by rebuilding payload slices.");
  assertEqual(batch[0], serialized.slice(0, DASHBOARD_CACHE_CHUNK_SIZE), "Expected recovered chunk batches to preserve the first chunk.");
  assertEqual(batch[1], serialized.slice(DASHBOARD_CACHE_CHUNK_SIZE, DASHBOARD_CACHE_CHUNK_SIZE * 2), "Expected recovered chunk batches to preserve the second chunk.");
}

function testDashboardTransferChunkBatchRecoversWhenPartMissing() {
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T04:56:30Z");
  payload.notes = "x".repeat((DASHBOARD_CACHE_CHUNK_SIZE * 2) + 25);

  writeChunkedCacheValue(cache, "fixture-transfer-batch-recover-part", payload, 120);
  delete cache.store[getDashboardCachePartKey("fixture-transfer-batch-recover-part", 1)];

  const serialized = JSON.stringify(payload);
  const batch = fetchDashboardDataChunkBatch(0, 2, {
    cache: cache,
    cacheKey: "fixture-transfer-batch-recover-part",
    payloadLoader: function() {
      return payload;
    },
  });

  assertEqual(batch.length, 2, "Expected missing chunk parts to recover by rebuilding payload slices.");
  assertEqual(batch[0], serialized.slice(0, DASHBOARD_CACHE_CHUNK_SIZE), "Expected recovered missing-part batches to preserve the first chunk.");
  assertEqual(batch[1], serialized.slice(DASHBOARD_CACHE_CHUNK_SIZE, DASHBOARD_CACHE_CHUNK_SIZE * 2), "Expected recovered missing-part batches to preserve the second chunk.");
}

function testDashboardTransferChunkBatchRejectsInvalidRange() {
  const cache = createFakeCache();
  const payload = createDashboardPayloadFixture("2026-03-30T04:57:00Z");
  payload.notes = "x".repeat(DASHBOARD_CACHE_CHUNK_SIZE + 25);

  writeChunkedCacheValue(cache, "fixture-transfer-batch-errors", payload, 120);

  assertThrows(function() {
    fetchDashboardDataChunkBatch(-1, 5, {
      cache: cache,
      cacheKey: "fixture-transfer-batch-errors",
    });
  }, "start index", "Expected negative batch start indexes to fail.");

  assertThrows(function() {
    fetchDashboardDataChunkBatch(0, 0, {
      cache: cache,
      cacheKey: "fixture-transfer-batch-errors",
    });
  }, "batch size", "Expected non-positive batch sizes to fail.");

  assertThrows(function() {
    fetchDashboardDataChunkBatch(10, 5, {
      cache: cache,
      cacheKey: "fixture-transfer-batch-errors",
    });
  }, "out of range", "Expected out-of-range batch reads to fail.");
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
    headerRowIndex: 0,
    dataRowStartIndex: 2,
    cols: cols,
    rows: rowObjects.map(function(rowObject) {
      return columnNames.map(function(columnName) {
        return rowObject[columnName];
      });
    }),
  };
}

function createActionTestStudentFixture(studentName, parentName, today) {
  const session = { date: new Date(2026, 3, 2), durationMin: 60 };

  return {
    student: studentName,
    parent: parentName,
    studentKey: buildDashboardStudentKey(studentName, parentName),
    dataQualityFlags: [],
    adminOwnerKey: "palm",
    adminOwnerName: "Palm",
    packages: [
      finalizePackageRecord(
        createPackageRecord(
          studentName,
          parentName,
          "English Pack",
          1.5,
          0,
          1.5,
          10,
          [session],
          computeProjection(1.5, [session], today)
        ),
        {
          parent: parentName,
          packages: [],
          dataQualityFlags: [],
        }
      ),
    ],
  };
}

function createDashboardPayloadFixture(lastUpdatedAt, previousUpdatedAt) {
  return {
    adminViews: getAdminViewOptions(),
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
    remove: function(key) {
      delete store[key];
    },
    removeAll: function(keys) {
      keys.forEach(function(key) {
        delete store[key];
      });
    },
  };
}

function createFakeProperties() {
  const store = {};

  return {
    store: store,
    getProperty: function(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setProperty: function(key, value) {
      store[key] = value;
    },
    getProperties: function() {
      return Object.assign({}, store);
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

function assertThrows(fn, expectedMessageFragment, message) {
  try {
    fn();
  } catch (error) {
    const actualMessage = error && error.message ? error.message : String(error || "");
    if (expectedMessageFragment && actualMessage.indexOf(expectedMessageFragment) === -1) {
      throw new Error(message + " Expected error containing \"" + expectedMessageFragment + "\" but received \"" + actualMessage + "\".");
    }
    return;
  }

  throw new Error(message + " Expected function to throw.");
}
