// ============================================================
// BUSINESS RULE HELPERS
// ============================================================

function buildActiveStudentSet(studentsSnapshot) {
  const activeStudents = new Set();

  studentsSnapshot.rows.forEach(function(row) {
    const studentName = readTrimmedCell(row, studentsSnapshot.cols, "student_name");
    const remainingCredits = readUpperCell(row, studentsSnapshot.cols, "Remaining Credits");

    if (!studentName) return;
    if (remainingCredits !== "N/A" && remainingCredits !== "") {
      activeStudents.add(studentName);
    }
  });

  return activeStudents;
}

function buildExcludedPackageReasons(studentsCoursesSnapshot) {
  const excludedPackageReasons = {};

  studentsCoursesSnapshot.rows.forEach(function(row) {
    const studentName = readTrimmedCell(row, studentsCoursesSnapshot.cols, "Student Name");
    const className = readTrimmedCell(row, studentsCoursesSnapshot.cols, "Class Name");
    const packageName = readTrimmedCell(row, studentsCoursesSnapshot.cols, "Class Subject");
    const exclusionReason = getPackageExclusionReason(className, packageName);

    if (!studentName || !packageName || !exclusionReason) return;

    excludedPackageReasons[buildStudentPackageKey(studentName, packageName)] = exclusionReason;
  });

  return excludedPackageReasons;
}

function getPackageExclusionReason(className, packageName) {
  const normalizedClassName = normalizeText(className);
  const normalizedPackageName = normalizeText(packageName);

  for (let i = 0; i < EXCLUDED_PACKAGE_KEYWORDS.length; i++) {
    const keyword = EXCLUDED_PACKAGE_KEYWORDS[i];
    if (
      normalizedClassName.indexOf(keyword) !== -1 ||
      normalizedPackageName.indexOf(keyword) !== -1
    ) {
      return keyword;
    }
  }

  return null;
}

function buildPendingDeductionMap(creditControlSnapshot, activeStudents, excludedPackageReasons, today) {
  const pendingDeductionMap = {};

  creditControlSnapshot.rows.forEach(function(row) {
    const studentName = readTrimmedCell(row, creditControlSnapshot.cols, "Student Name");
    const packageName = readTrimmedCell(row, creditControlSnapshot.cols, "Package/Program");
    const sessionDate = parseDate(row[creditControlSnapshot.cols["session_date"]]);

    if (!studentName || !packageName || !sessionDate) return;
    if (!activeStudents.has(studentName)) return;
    if (isExcludedPackage(studentName, packageName, excludedPackageReasons)) return;
    if (sessionDate > today) return;

    const finalStatus = readUpperCell(row, creditControlSnapshot.cols, "final_status");
    const teacherFeedback = readTrimmedCell(row, creditControlSnapshot.cols, "teacher_feedback");
    const creditsConsumed = parseNumber(row[creditControlSnapshot.cols["credits_consumed"]]);
    const sessionDuration = parseNumber(row[creditControlSnapshot.cols["session_duration"]], 60);

    if (!shouldCountAsPendingDeduction(finalStatus, teacherFeedback, creditsConsumed)) return;

    const key = buildStudentPackageKey(studentName, packageName);
    pendingDeductionMap[key] = roundToTenth(
      (pendingDeductionMap[key] || 0) + (sessionDuration / 60)
    );
  });

  return pendingDeductionMap;
}

function shouldCountAsPendingDeduction(finalStatus, teacherFeedback, creditsConsumed) {
  const normalizedStatus = normalizeText(finalStatus).toUpperCase();
  const normalizedFeedback = normalizeText(teacherFeedback);

  return normalizedStatus === "ENDED" &&
    (normalizedFeedback === "" || normalizedFeedback === "0") &&
    creditsConsumed === 0;
}

function buildUpcomingSessionMap(upcomingSnapshot, activeStudents, excludedPackageReasons, today) {
  const upcomingSessionMap = {};

  upcomingSnapshot.rows.forEach(function(row) {
    const studentName = readTrimmedCell(row, upcomingSnapshot.cols, "Student Name");
    const packageName = readTrimmedCell(row, upcomingSnapshot.cols, "Package/Program");
    const scheduledDate = parseDate(row[upcomingSnapshot.cols["Scheduled Date"]]);

    if (!studentName || !packageName || !scheduledDate) return;
    if (!activeStudents.has(studentName)) return;
    if (isExcludedPackage(studentName, packageName, excludedPackageReasons)) return;
    if (scheduledDate <= today) return;

    const sessionStatus = readUpperCell(row, upcomingSnapshot.cols, "Session Status");
    if (sessionStatus !== "UPCOMING") return;

    const sessionDuration = parseNumber(row[upcomingSnapshot.cols["Session Duration"]], 60);
    const key = buildStudentPackageKey(studentName, packageName);

    if (!upcomingSessionMap[key]) {
      upcomingSessionMap[key] = [];
    }

    upcomingSessionMap[key].push({
      date: scheduledDate,
      durationMin: sessionDuration,
    });
  });

  Object.keys(upcomingSessionMap).forEach(function(key) {
    upcomingSessionMap[key].sort(function(a, b) {
      return a.date - b.date;
    });
  });

  return upcomingSessionMap;
}

function buildDashboardPayload(
  aggregationsSnapshot,
  activeStudents,
  excludedPackageReasons,
  pendingDeductionMap,
  upcomingSessionMap,
  today
) {
  const studentMap = {};

  aggregationsSnapshot.rows.forEach(function(row) {
    const studentName = readTrimmedCell(row, aggregationsSnapshot.cols, "Student Name");
    const parentName = readTrimmedCell(row, aggregationsSnapshot.cols, "Parent Name");
    const packageName = readTrimmedCell(row, aggregationsSnapshot.cols, "Class Subject");

    if (!studentName || !packageName) return;
    if (!activeStudents.has(studentName)) return;
    if (isExcludedPackage(studentName, packageName, excludedPackageReasons)) return;

    const currentRemaining = parseNumber(
      row[aggregationsSnapshot.cols["Current Remaining Credits"]]
    );
    const totalCredits = parseNumber(
      row[aggregationsSnapshot.cols["Current Total Credits"]]
    );
    const key = buildStudentPackageKey(studentName, packageName);
    const pendingDeduction = roundToTenth(pendingDeductionMap[key] || 0);
    const adjustedRemaining = roundToTenth(Math.max(0, currentRemaining - pendingDeduction));
    const sessions = upcomingSessionMap[key] || [];
    const projection = computeProjection(adjustedRemaining, sessions, today);

    const packageRecord = createPackageRecord(
      studentName,
      parentName,
      packageName,
      currentRemaining,
      pendingDeduction,
      adjustedRemaining,
      totalCredits,
      sessions,
      projection
    );

    upsertPackageRecord(studentMap, studentName, parentName, packageRecord);
  });

  return Object.values(studentMap)
    .map(function(studentRecord) {
      studentRecord.dataQualityFlags = buildStudentDataQualityFlags(studentRecord);
      studentRecord.packages = studentRecord.packages
        .map(function(pkg) {
          return finalizePackageRecord(pkg, studentRecord);
        })
        .sort(comparePackages);
      return studentRecord;
    })
    .sort(compareStudents);
}

function createPackageRecord(
  studentName,
  parentName,
  packageName,
  currentRemaining,
  pendingDeduction,
  adjustedRemaining,
  totalCredits,
  sessions,
  projection
) {
  const cadence = computeSessionCadence(sessions);

  return {
    key: buildStudentPackageKey(studentName, packageName),
    student: studentName,
    parent: parentName,
    name: packageName,
    subject: packageName,
    currentRemaining: currentRemaining,
    pendingDeduction: pendingDeduction,
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
    priorityScore: 0,
    recommendedAction: "",
    whyNow: "",
    statusChange: "new",
    balanceDelta: null,
    dataQualityFlags: [],
    ruleContext: {
      included: true,
      exclusionReason: null,
      pendingDeductionApplied: pendingDeduction > 0,
      projectionStatus: projection.status,
    },
  };
}

function finalizePackageRecord(packageRecord, studentRecord) {
  const dataQualityFlags = buildPackageDataQualityFlags(packageRecord, studentRecord);

  return Object.assign({}, packageRecord, {
    dataQualityFlags: dataQualityFlags,
    recommendedAction: getRecommendedAction(packageRecord, dataQualityFlags),
    whyNow: getActionReason(packageRecord, dataQualityFlags),
  });
}

function buildStudentDataQualityFlags(studentRecord) {
  const flags = [];

  if (!studentRecord.parent) {
    flags.push("missing-parent");
  }

  if (studentRecord.packages.some(function(pkg) { return pkg.duplicateCount > 1; })) {
    flags.push("duplicate-source-rows");
  }

  return flags;
}

function buildPackageDataQualityFlags(packageRecord, studentRecord) {
  const flags = [];

  if (!studentRecord.parent) flags.push("missing-parent");
  if (!packageRecord.upcomingCount) flags.push("no-upcoming-sessions");
  if (packageRecord.pendingDeduction > 0) flags.push("pending-deduction");
  if (packageRecord.duplicateCount > 1) flags.push("duplicate-source-rows");
  if (
    packageRecord.adjustedRemaining < ALERT_THRESHOLD &&
    !packageRecord.upcomingCount
  ) {
    flags.push("low-balance-no-schedule");
  }
  if (packageRecord.adjustedRemaining <= 0) {
    flags.push("exhausted-now");
  }

  return flags;
}

function computeSessionCadence(sessions) {
  if (!sessions.length) {
    return {
      totalScheduledCredits: 0,
      sessionCadencePerWeek: 0,
      averageCreditsPerWeek: 0,
      cadenceLabel: "No schedule",
    };
  }

  const totalScheduledCredits = roundToTenth(sessions.reduce(function(sum, session) {
    return sum + (session.durationMin / 60);
  }, 0));
  const firstDate = sessions[0].date;
  const lastDate = sessions[sessions.length - 1].date;
  const spanDays = Math.max(7, Math.round((lastDate - firstDate) / DAY_MS) + 7);
  const spanWeeks = spanDays / 7;
  const sessionsPerWeek = roundToTenth(sessions.length / spanWeeks);
  const creditsPerWeek = roundToTenth(totalScheduledCredits / spanWeeks);

  return {
    totalScheduledCredits: totalScheduledCredits,
    sessionCadencePerWeek: sessionsPerWeek,
    averageCreditsPerWeek: creditsPerWeek,
    cadenceLabel: getCadenceLabel(sessionsPerWeek),
  };
}

function getCadenceLabel(sessionsPerWeek) {
  if (sessionsPerWeek <= 0) return "No schedule";
  if (sessionsPerWeek < 1) return "Light";
  if (sessionsPerWeek < 2) return "Steady";
  return "Intense";
}

function getRecommendedAction(packageRecord, dataQualityFlags) {
  if (packageRecord.adjustedRemaining <= 0) {
    return "Renew immediately";
  }
  if (packageRecord.status === "notify") {
    return "Contact parent today";
  }
  if (packageRecord.status === "watch" && packageRecord.daysUntilAlert !== null && packageRecord.daysUntilAlert <= 7) {
    return "Prepare outreach this week";
  }
  if (dataQualityFlags.indexOf("low-balance-no-schedule") !== -1) {
    return "Check schedule before outreach";
  }
  if (packageRecord.pendingDeduction > 0) {
    return "Confirm pending teacher feedback";
  }
  if (packageRecord.status === "watch") {
    return "Queue renewal follow-up";
  }
  if (packageRecord.status === "nodata") {
    return "Verify future sessions";
  }
  return "Monitor";
}

function getActionReason(packageRecord, dataQualityFlags) {
  if (packageRecord.adjustedRemaining <= 0) {
    return "The package has no credits left after pending deductions.";
  }
  if (packageRecord.status === "notify") {
    return "Actual balance is already below the two-credit alert threshold.";
  }
  if (packageRecord.status === "watch" && packageRecord.alertDate) {
    return "Projection drops below two credits on " + packageRecord.alertDate + ".";
  }
  if (dataQualityFlags.indexOf("low-balance-no-schedule") !== -1) {
    return "Balance is already low, but the student has no upcoming sessions to project from.";
  }
  if (packageRecord.pendingDeduction > 0) {
    return "Pending deductions mean the source balance is currently understated.";
  }
  if (!packageRecord.upcomingCount) {
    return "No upcoming sessions are scheduled, so projected depletion is uncertain.";
  }
  return "Balance is healthy for now, but still visible in the monitoring queue.";
}

function upsertPackageRecord(studentMap, studentName, parentName, packageRecord) {
  if (!studentMap[studentName]) {
    studentMap[studentName] = {
      student: studentName,
      parent: parentName,
      packages: [],
      dataQualityFlags: [],
    };
  }

  if (!studentMap[studentName].parent && parentName) {
    studentMap[studentName].parent = parentName;
  }

  const existingIndex = studentMap[studentName].packages.findIndex(function(existingPackage) {
    return existingPackage.name === packageRecord.name;
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
  studentMap[studentName].packages[existingIndex] = winner;
}

function compareStudents(a, b) {
  return getStatusSortValue(worstStatus(a.packages)) - getStatusSortValue(worstStatus(b.packages));
}

function comparePackages(a, b) {
  const statusDelta = getStatusSortValue(a.status) - getStatusSortValue(b.status);
  if (statusDelta !== 0) return statusDelta;

  const scoreDelta = (b.priorityScore || 0) - (a.priorityScore || 0);
  if (scoreDelta !== 0) return scoreDelta;

  const dayA = a.daysUntilAlert === null ? Number.POSITIVE_INFINITY : a.daysUntilAlert;
  const dayB = b.daysUntilAlert === null ? Number.POSITIVE_INFINITY : b.daysUntilAlert;
  if (dayA !== dayB) return dayA - dayB;

  return a.name.localeCompare(b.name);
}

function getStatusSortValue(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_ORDER, status)
    ? STATUS_ORDER[status]
    : 9;
}

function isExcludedPackage(studentName, packageName, excludedPackageReasons) {
  return Object.prototype.hasOwnProperty.call(
    excludedPackageReasons,
    buildStudentPackageKey(studentName, packageName)
  );
}

function buildStudentPackageKey(studentName, packageName) {
  return String(studentName).trim() + "|||" + String(packageName).trim();
}
