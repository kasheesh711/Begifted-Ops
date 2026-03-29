// ============================================================
// BeGifted Credit Control Command Center — Code.gs
// ============================================================

const SPREADSHEET_ID_CREDITS = "100bidSt63ynf_y7Iq-nRQUj3MMQoNpnltOQdSiwHN-0";
const SPREADSHEET_ID_ANALYTICS = "15XTOU1kYDib4stuiFzbTOT1MAeRlCw20maOXk5irfsc";

const SHEET_AGGREGATIONS = "Aggregations";
const SHEET_CREDIT_CONTROL = "Credit_Control";
const SHEET_UPCOMING = "Upcoming Sessions";
const SHEET_STUDENTS = "Students";
const SHEET_STUDENTS_COURSES = "Students & Courses";

const ALERT_THRESHOLD = 2;
const NOTIFY_WINDOW_DAYS = 30;

const EXCLUDED_PACKAGE_KEYWORDS = ["pretest", "trial"];
const STATUS_ORDER = { notify: 0, watch: 1, ok: 2, nodata: 3 };

const SNAPSHOT_STATE_KEY = "BG_DASHBOARD_SNAPSHOT_V2";
const HISTORY_STATE_KEY = "BG_DASHBOARD_HISTORY_V2";
const HISTORY_LIMIT = 12;
const TREND_POINT_LIMIT = 8;

const REQUIRED_COLUMNS = Object.freeze({
  aggregations: [
    "Student Name",
    "Parent Name",
    "Class Subject",
    "Current Remaining Credits",
    "Current Total Credits",
  ],
  creditControl: [
    "Student Name",
    "Package/Program",
    "final_status",
    "teacher_feedback",
    "credits_consumed",
    "session_duration",
    "session_date",
  ],
  upcoming: [
    "Student Name",
    "Package/Program",
    "Session Status",
    "Session Duration",
    "Scheduled Date",
  ],
  students: [
    "student_name",
    "Remaining Credits",
  ],
  studentsCourses: [
    "Student Name",
    "Class Name",
    "Class Subject",
  ],
});

// ============================================================
// ENTRY POINT
// ============================================================

function doGet() {
  return HtmlService
    .createTemplateFromFile("dashboard")
    .evaluate()
    .setTitle("BeGifted — Credit Control Command Center")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// MAIN DATA FUNCTION
// ============================================================

function getStudentData() {
  try {
    const today = getTodayDate();
    const now = new Date();
    const sources = loadDashboardSources();

    const activeStudents = buildActiveStudentSet(sources.students);
    const excludedPackageReasons = buildExcludedPackageReasons(sources.studentsCourses);
    const pendingDeductionMap = buildPendingDeductionMap(
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
      pendingDeductionMap,
      upcomingSessionMap,
      today
    );
    const snapshotState = loadSnapshotState();
    const dashboardModel = buildDashboardModel(students, snapshotState, today, now);

    persistSnapshotState(dashboardModel.snapshotState);
    return dashboardModel.payload;
  } catch (e) {
    Logger.log("getStudentData error: " + e.toString());
    throw new Error("ดึงข้อมูลไม่ได้: " + e.message);
  }
}

// ============================================================
// DATA LOADING
// ============================================================

function loadDashboardSources() {
  const ssCredits = SpreadsheetApp.openById(SPREADSHEET_ID_CREDITS);
  const ssAnalytics = SpreadsheetApp.openById(SPREADSHEET_ID_ANALYTICS);

  return {
    aggregations: getSheetSnapshot(
      ssCredits,
      SHEET_AGGREGATIONS,
      REQUIRED_COLUMNS.aggregations
    ),
    creditControl: getSheetSnapshot(
      ssAnalytics,
      SHEET_CREDIT_CONTROL,
      REQUIRED_COLUMNS.creditControl
    ),
    upcoming: getSheetSnapshot(
      ssAnalytics,
      SHEET_UPCOMING,
      REQUIRED_COLUMNS.upcoming
    ),
    students: getSheetSnapshot(
      ssAnalytics,
      SHEET_STUDENTS,
      REQUIRED_COLUMNS.students,
      { headerColumnName: "student_name" }
    ),
    studentsCourses: getSheetSnapshot(
      ssAnalytics,
      SHEET_STUDENTS_COURSES,
      REQUIRED_COLUMNS.studentsCourses
    ),
  };
}

function getSheetSnapshot(spreadsheet, sheetName, requiredColumns, options) {
  const rows = getSheetData(spreadsheet, sheetName);
  const headerRowIndex = options && options.headerColumnName
    ? findHeaderRowIndex(rows, options.headerColumnName)
    : 0;

  if (headerRowIndex === -1) {
    throw new Error(
      'Sheet "' + sheetName + '" is missing a header row containing "' +
      options.headerColumnName + '".'
    );
  }

  const headerRow = rows[headerRowIndex];
  const cols = getColMap(headerRow);
  validateRequiredColumns(sheetName, cols, requiredColumns);

  return {
    sheetName: sheetName,
    cols: cols,
    rows: rows.slice(headerRowIndex + 1),
  };
}

function findHeaderRowIndex(rows, headerColumnName) {
  const target = String(headerColumnName).trim().toLowerCase();
  return rows.findIndex(function(row) {
    return row.some(function(cell) {
      return String(cell).trim().toLowerCase() === target;
    });
  });
}

function validateRequiredColumns(sheetName, cols, requiredColumns) {
  const missing = requiredColumns.filter(function(columnName) {
    return !Object.prototype.hasOwnProperty.call(cols, columnName);
  });

  if (missing.length) {
    throw new Error(
      'Sheet "' + sheetName + '" is missing required columns: ' + missing.join(", ")
    );
  }
}

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

// ============================================================
// DASHBOARD VIEW MODEL
// ============================================================

function buildDashboardModel(students, snapshotState, today, now) {
  const previousSnapshot = snapshotState.lastSnapshot;
  const packageRows = buildPackageRows(students, previousSnapshot);
  const summary = buildSummary(students, packageRows, previousSnapshot);
  const segments = buildSegments(packageRows, students, today);
  const insights = buildInsights(packageRows, summary, previousSnapshot);
  const timeline = buildTimeline(snapshotState.history, summary, now);
  const snapshotForPersistence = buildSnapshotForPersistence(summary, packageRows, now);
  const nextHistory = updateHistory(snapshotState.history, summary, now);

  packageRows.forEach(function(row) {
    const student = students[row.studentIndex];
    if (student && student.packages[row.packageIndex]) {
      student.packages[row.packageIndex].priorityScore = row.priorityScore;
      student.packages[row.packageIndex].statusChange = row.statusChange;
      student.packages[row.packageIndex].balanceDelta = row.balanceDelta;
    }
  });

  return {
    payload: {
      lastUpdatedAt: formatDateTime(now),
      previousUpdatedAt: previousSnapshot ? previousSnapshot.generatedAt : null,
      summary: summary,
      insights: insights,
      segments: segments,
      timeline: timeline,
      actionQueue: packageRows,
      students: students,
    },
    snapshotState: {
      lastSnapshot: snapshotForPersistence,
      history: nextHistory,
    },
  };
}

function buildPackageRows(students, previousSnapshot) {
  const previousPackages = previousSnapshot && previousSnapshot.packages
    ? previousSnapshot.packages
    : {};
  const flatRows = [];
  const riskyCountByStudent = {};

  students.forEach(function(student, studentIndex) {
    student.packages.forEach(function(pkg, packageIndex) {
      const key = pkg.key;
      const previous = previousPackages[key] || null;
      const isRisky = pkg.status === "notify" || pkg.status === "watch";

      if (!riskyCountByStudent[student.student]) riskyCountByStudent[student.student] = 0;
      if (isRisky) riskyCountByStudent[student.student]++;

      flatRows.push({
        key: key,
        student: student.student,
        parent: student.parent || "Missing parent",
        packageName: pkg.name,
        subject: pkg.subject,
        status: pkg.status,
        currentRemaining: pkg.currentRemaining,
        adjustedRemaining: pkg.adjustedRemaining,
        pendingDeduction: pkg.pendingDeduction,
        totalCredits: pkg.totalCredits,
        alertDate: pkg.alertDate,
        exhaustDate: pkg.exhaustDate,
        daysUntilAlert: pkg.daysUntilAlert,
        daysUntilExhaust: pkg.daysUntilExhaust,
        nextSessionDate: pkg.nextSessionDate,
        upcomingCount: pkg.upcomingCount,
        sessionCadencePerWeek: pkg.sessionCadencePerWeek,
        averageCreditsPerWeek: pkg.averageCreditsPerWeek,
        cadenceLabel: pkg.cadenceLabel,
        dataQualityFlags: pkg.dataQualityFlags,
        recommendedAction: pkg.recommendedAction,
        whyNow: pkg.whyNow,
        previousStatus: previous ? previous.status : null,
        balanceDelta: previous
          ? roundToTenth(pkg.adjustedRemaining - previous.adjustedRemaining)
          : null,
        statusChange: getStatusChangeLabel(previous ? previous.status : null, pkg.status),
        studentIndex: studentIndex,
        packageIndex: packageIndex,
      });
    });
  });

  flatRows.forEach(function(row) {
    row.priorityScore = computePriorityScore(
      row,
      riskyCountByStudent[row.student] || 0,
      row.previousStatus,
      row.balanceDelta
    );
    row.changeSummary = describeChange(row);
  });

  flatRows.sort(compareQueueRows);
  return flatRows;
}

function computePriorityScore(row, riskyPackageCount, previousStatus, balanceDelta) {
  let score = 0;

  if (row.adjustedRemaining <= 0) score += 140;
  else if (row.status === "notify") score += 120;
  else if (row.status === "watch") score += 80;
  else if (row.status === "nodata") score += 28;

  if (row.daysUntilAlert !== null) {
    score += Math.max(0, 35 - Math.min(row.daysUntilAlert, 35));
  }
  if (row.daysUntilExhaust !== null) {
    score += Math.max(0, 45 - Math.min(row.daysUntilExhaust, 45));
  }
  if (row.pendingDeduction > 0) {
    score += Math.min(20, row.pendingDeduction * 4);
  }
  if (row.dataQualityFlags.indexOf("low-balance-no-schedule") !== -1) {
    score += 18;
  } else if (row.dataQualityFlags.indexOf("no-upcoming-sessions") !== -1) {
    score += 8;
  }
  if (row.dataQualityFlags.indexOf("duplicate-source-rows") !== -1) {
    score += 5;
  }
  if (previousStatus && isStatusWorse(row.status, previousStatus)) {
    score += 25;
  }
  if (balanceDelta !== null && balanceDelta < 0) {
    score += Math.min(20, Math.abs(balanceDelta) * 6);
  }
  if (riskyPackageCount > 1) {
    score += 10;
  }

  return roundToTenth(score);
}

function describeChange(row) {
  if (!row.previousStatus) {
    return "New to dashboard";
  }
  if (isStatusWorse(row.status, row.previousStatus)) {
    return "Worsened since last refresh";
  }
  if (isStatusWorse(row.previousStatus, row.status)) {
    return "Improved since last refresh";
  }
  if (row.balanceDelta !== null && row.balanceDelta < 0) {
    return "Down " + Math.abs(row.balanceDelta).toFixed(1) + " credits";
  }
  if (row.balanceDelta !== null && row.balanceDelta > 0) {
    return "Up " + row.balanceDelta.toFixed(1) + " credits";
  }
  return "Stable";
}

function compareQueueRows(a, b) {
  if (b.priorityScore !== a.priorityScore) {
    return b.priorityScore - a.priorityScore;
  }

  const statusDelta = getStatusSortValue(a.status) - getStatusSortValue(b.status);
  if (statusDelta !== 0) return statusDelta;

  const exhaustA = a.daysUntilExhaust === null ? Number.POSITIVE_INFINITY : a.daysUntilExhaust;
  const exhaustB = b.daysUntilExhaust === null ? Number.POSITIVE_INFINITY : b.daysUntilExhaust;
  if (exhaustA !== exhaustB) return exhaustA - exhaustB;

  const alertA = a.daysUntilAlert === null ? Number.POSITIVE_INFINITY : a.daysUntilAlert;
  const alertB = b.daysUntilAlert === null ? Number.POSITIVE_INFINITY : b.daysUntilAlert;
  if (alertA !== alertB) return alertA - alertB;

  return a.student.localeCompare(b.student);
}

function buildSummary(students, packageRows, previousSnapshot) {
  const studentCounts = { total: students.length, notify: 0, watch: 0, ok: 0, nodata: 0 };
  const packageCounts = { total: packageRows.length, notify: 0, watch: 0, ok: 0, nodata: 0 };
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
  });

  packageRows.forEach(function(row) {
    packageCounts[row.status]++;
    if (row.adjustedRemaining <= 0) exhaustedNow++;
    if (row.daysUntilAlert !== null && row.daysUntilAlert <= 7) risk7++;
    if (row.daysUntilAlert !== null && row.daysUntilAlert <= 14) risk14++;
    if (row.daysUntilAlert !== null && row.daysUntilAlert <= 30) risk30++;
    if (row.dataQualityFlags.indexOf("no-upcoming-sessions") !== -1) noSchedule++;
    if (row.pendingDeduction > 0) {
      pendingDeductionBacklog += row.pendingDeduction;
      pendingDeductionPackages++;
    }
    if (row.dataQualityFlags.indexOf("low-balance-no-schedule") !== -1) {
      lowBalanceNoSchedule++;
    }
  });

  const previousSummary = previousSnapshot && previousSnapshot.summary
    ? previousSnapshot.summary
    : null;

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
    deltas: buildSummaryDeltas(
      {
        packages: packageCounts,
        students: studentCounts,
        portfolio: {
          exhaustedNow: exhaustedNow,
          risk7: risk7,
          risk14: risk14,
          risk30: risk30,
          noSchedule: noSchedule,
          pendingDeductionBacklog: roundToTenth(pendingDeductionBacklog),
          lowBalanceNoSchedule: lowBalanceNoSchedule,
          multiRiskStudents: multiRiskStudents,
        },
      },
      previousSummary
    ),
  };
}

function buildSummaryDeltas(currentSummary, previousSummary) {
  if (!previousSummary) {
    return {
      packagesNotify: null,
      packagesWatch: null,
      risk7: null,
      risk30: null,
      pendingDeductionBacklog: null,
      noSchedule: null,
    };
  }

  return {
    packagesNotify: currentSummary.packages.notify - previousSummary.packages.notify,
    packagesWatch: currentSummary.packages.watch - previousSummary.packages.watch,
    risk7: currentSummary.portfolio.risk7 - previousSummary.portfolio.risk7,
    risk30: currentSummary.portfolio.risk30 - previousSummary.portfolio.risk30,
    pendingDeductionBacklog: roundToTenth(
      currentSummary.portfolio.pendingDeductionBacklog -
      previousSummary.portfolio.pendingDeductionBacklog
    ),
    noSchedule: currentSummary.portfolio.noSchedule - previousSummary.portfolio.noSchedule,
  };
}

function buildSegments(packageRows, students, today) {
  return {
    packageNames: aggregatePackageSegments(packageRows),
    parents: aggregateParentSegments(packageRows),
    cadence: aggregateCadenceSegments(packageRows),
    drivers: buildDriverSegments(packageRows),
    distribution: buildDistributionBuckets(packageRows),
    outreachByWeek: buildWeeklyBuckets(packageRows, "alertDate", today, 6),
    exhaustionByWeek: buildWeeklyBuckets(packageRows, "exhaustDate", today, 6),
    exhaustionHeatmap: buildDailyHeatmap(packageRows, "exhaustDate", today, 42),
  };
}

function aggregatePackageSegments(packageRows) {
  const segmentMap = {};

  packageRows.forEach(function(row) {
    if (!segmentMap[row.packageName]) {
      segmentMap[row.packageName] = {
        name: row.packageName,
        totalPackages: 0,
        riskyPackages: 0,
        notifyPackages: 0,
        pendingDeduction: 0,
        averageRemainingAccumulator: 0,
      };
    }

    const segment = segmentMap[row.packageName];
    segment.totalPackages++;
    if (row.status === "notify" || row.status === "watch") segment.riskyPackages++;
    if (row.status === "notify") segment.notifyPackages++;
    segment.pendingDeduction += row.pendingDeduction;
    segment.averageRemainingAccumulator += row.adjustedRemaining;
  });

  return Object.keys(segmentMap).map(function(name) {
    const segment = segmentMap[name];
    return {
      name: segment.name,
      totalPackages: segment.totalPackages,
      riskyPackages: segment.riskyPackages,
      notifyPackages: segment.notifyPackages,
      pendingDeduction: roundToTenth(segment.pendingDeduction),
      averageRemaining: roundToTenth(
        segment.averageRemainingAccumulator / segment.totalPackages
      ),
    };
  }).sort(function(a, b) {
    if (b.riskyPackages !== a.riskyPackages) return b.riskyPackages - a.riskyPackages;
    return a.averageRemaining - b.averageRemaining;
  }).slice(0, 8);
}

function aggregateParentSegments(packageRows) {
  const parentMap = {};

  packageRows.forEach(function(row) {
    if (!parentMap[row.parent]) {
      parentMap[row.parent] = {
        name: row.parent,
        riskyPackages: 0,
        notifyPackages: 0,
        students: {},
      };
    }

    const segment = parentMap[row.parent];
    segment.students[row.student] = true;
    if (row.status === "notify" || row.status === "watch") segment.riskyPackages++;
    if (row.status === "notify") segment.notifyPackages++;
  });

  return Object.keys(parentMap).map(function(name) {
    const segment = parentMap[name];
    return {
      name: name,
      riskyPackages: segment.riskyPackages,
      notifyPackages: segment.notifyPackages,
      students: Object.keys(segment.students).length,
    };
  }).sort(function(a, b) {
    if (b.riskyPackages !== a.riskyPackages) return b.riskyPackages - a.riskyPackages;
    return b.students - a.students;
  }).slice(0, 6);
}

function aggregateCadenceSegments(packageRows) {
  const buckets = {};

  packageRows.forEach(function(row) {
    if (!buckets[row.cadenceLabel]) {
      buckets[row.cadenceLabel] = {
        name: row.cadenceLabel,
        totalPackages: 0,
        riskyPackages: 0,
        averageRemainingAccumulator: 0,
      };
    }

    buckets[row.cadenceLabel].totalPackages++;
    if (row.status === "notify" || row.status === "watch") {
      buckets[row.cadenceLabel].riskyPackages++;
    }
    buckets[row.cadenceLabel].averageRemainingAccumulator += row.adjustedRemaining;
  });

  return Object.keys(buckets).map(function(name) {
    const bucket = buckets[name];
    return {
      name: name,
      totalPackages: bucket.totalPackages,
      riskyPackages: bucket.riskyPackages,
      averageRemaining: roundToTenth(
        bucket.averageRemainingAccumulator / bucket.totalPackages
      ),
    };
  }).sort(function(a, b) {
    return getCadenceSortValue(a.name) - getCadenceSortValue(b.name);
  });
}

function getCadenceSortValue(label) {
  return {
    "No schedule": 0,
    Light: 1,
    Steady: 2,
    Intense: 3,
  }[label] || 9;
}

function buildDriverSegments(packageRows) {
  return [
    {
      name: "Low balance now",
      count: packageRows.filter(function(row) { return row.status === "notify"; }).length,
      tone: "critical",
    },
    {
      name: "No future schedule",
      count: packageRows.filter(function(row) {
        return row.dataQualityFlags.indexOf("no-upcoming-sessions") !== -1;
      }).length,
      tone: "warning",
    },
    {
      name: "Pending deductions",
      count: packageRows.filter(function(row) {
        return row.dataQualityFlags.indexOf("pending-deduction") !== -1;
      }).length,
      tone: "attention",
    },
    {
      name: "Exhausts within 14 days",
      count: packageRows.filter(function(row) {
        return row.daysUntilExhaust !== null && row.daysUntilExhaust <= 14;
      }).length,
      tone: "critical",
    },
    {
      name: "Recently worsened",
      count: packageRows.filter(function(row) {
        return row.previousStatus && isStatusWorse(row.status, row.previousStatus);
      }).length,
      tone: "info",
    },
  ];
}

function buildDistributionBuckets(packageRows) {
  const buckets = [
    { label: "≤ 0", min: Number.NEGATIVE_INFINITY, max: 0, count: 0 },
    { label: "0–2", min: 0.0001, max: 2, count: 0 },
    { label: "2–4", min: 2.0001, max: 4, count: 0 },
    { label: "4–8", min: 4.0001, max: 8, count: 0 },
    { label: "8+", min: 8.0001, max: Number.POSITIVE_INFINITY, count: 0 },
  ];

  packageRows.forEach(function(row) {
    const bucket = buckets.find(function(item) {
      return row.adjustedRemaining >= item.min && row.adjustedRemaining <= item.max;
    });
    if (bucket) bucket.count++;
  });

  return buckets;
}

function buildWeeklyBuckets(packageRows, dateField, today, numberOfWeeks) {
  const buckets = [];

  for (let weekIndex = 0; weekIndex < numberOfWeeks; weekIndex++) {
    const bucketStart = new Date(today.getTime() + (weekIndex * 7 * DAY_MS));
    const bucketEnd = new Date(bucketStart.getTime() + (7 * DAY_MS));

    buckets.push({
      label: "W" + (weekIndex + 1),
      start: formatDate(bucketStart),
      end: formatDate(new Date(bucketEnd.getTime() - DAY_MS)),
      count: packageRows.filter(function(row) {
        if (!row[dateField]) return false;
        const bucketDate = parseDate(row[dateField]);
        return bucketDate >= bucketStart && bucketDate < bucketEnd;
      }).length,
    });
  }

  return buckets;
}

function buildDailyHeatmap(packageRows, dateField, today, numberOfDays) {
  const heatmap = [];

  for (let offset = 0; offset < numberOfDays; offset++) {
    const currentDate = new Date(today.getTime() + (offset * DAY_MS));
    const dayLabel = formatDate(currentDate);

    heatmap.push({
      date: dayLabel,
      dayIndex: currentDate.getDay(),
      weekIndex: Math.floor(offset / 7),
      count: packageRows.filter(function(row) {
        return row[dateField] === dayLabel;
      }).length,
    });
  }

  return heatmap;
}

function buildInsights(packageRows, summary, previousSnapshot) {
  const previousPackages = previousSnapshot && previousSnapshot.packages
    ? previousSnapshot.packages
    : {};
  const worsened = packageRows.filter(function(row) {
    return row.previousStatus && isStatusWorse(row.status, row.previousStatus);
  });
  const improved = packageRows.filter(function(row) {
    return row.previousStatus && isStatusWorse(row.previousStatus, row.status);
  });
  const newNotify = packageRows.filter(function(row) {
    return row.status === "notify" && previousPackages[row.key] && previousPackages[row.key].status !== "notify";
  });
  const biggestDrop = packageRows
    .filter(function(row) { return row.balanceDelta !== null && row.balanceDelta < 0; })
    .sort(function(a, b) { return a.balanceDelta - b.balanceDelta; })[0];

  if (!previousSnapshot) {
    return [
      {
        title: "Baseline snapshot created",
        value: summary.packages.total,
        tone: "info",
        detail: "The first refresh establishes the comparison baseline for future changes.",
      },
      {
        title: "Pending deduction backlog",
        value: summary.portfolio.pendingDeductionBacklog,
        tone: "attention",
        detail: "Credits still waiting on teacher-feedback updates.",
      },
      {
        title: "Low balance without schedule",
        value: summary.portfolio.lowBalanceNoSchedule,
        tone: "warning",
        detail: "Packages are already near threshold with no upcoming sessions to project from.",
      },
    ];
  }

  return [
    {
      title: "New packages in notify",
      value: newNotify.length,
      tone: newNotify.length ? "critical" : "info",
      detail: "Packages that crossed into immediate outreach since the prior refresh.",
    },
    {
      title: "Recently worsened",
      value: worsened.length,
      tone: worsened.length ? "warning" : "info",
      detail: "Packages whose status deteriorated since the last stored snapshot.",
    },
    {
      title: "Resolved risk",
      value: improved.length,
      tone: improved.length ? "positive" : "info",
      detail: "Packages that improved their risk status since the previous refresh.",
    },
    {
      title: "Pending deduction backlog",
      value: summary.portfolio.pendingDeductionBacklog,
      tone: "attention",
      detail: "Credits still missing from the source balance because of pending feedback.",
    },
    biggestDrop
      ? {
        title: "Biggest deterioration",
        value: Math.abs(biggestDrop.balanceDelta).toFixed(1) + " cr",
        tone: "warning",
        detail: biggestDrop.student + " — " + biggestDrop.packageName,
      }
      : {
        title: "Biggest deterioration",
        value: "Stable",
        tone: "info",
        detail: "No package lost additional credits versus the prior refresh.",
      },
  ];
}

function buildTimeline(history, summary, now) {
  const currentPoint = buildHistoryPoint(summary, now);
  const combined = (history || []).concat([currentPoint]).slice(-TREND_POINT_LIMIT);

  return combined.map(function(point) {
    return {
      label: formatShortTimestamp(point.generatedAt),
      generatedAt: point.generatedAt,
      notify: point.notify,
      watch: point.watch,
      ok: point.ok,
      nodata: point.nodata,
      exhaustedNow: point.exhaustedNow,
      risk7: point.risk7,
      risk30: point.risk30,
    };
  });
}

function buildHistoryPoint(summary, now) {
  return {
    generatedAt: formatDateTime(now),
    notify: summary.packages.notify,
    watch: summary.packages.watch,
    ok: summary.packages.ok,
    nodata: summary.packages.nodata,
    exhaustedNow: summary.portfolio.exhaustedNow,
    risk7: summary.portfolio.risk7,
    risk30: summary.portfolio.risk30,
  };
}

function updateHistory(history, summary, now) {
  return (history || []).concat([buildHistoryPoint(summary, now)]).slice(-HISTORY_LIMIT);
}

function buildSnapshotForPersistence(summary, packageRows, now) {
  const packages = {};

  packageRows.forEach(function(row) {
    packages[row.key] = {
      status: row.status,
      adjustedRemaining: row.adjustedRemaining,
      priorityScore: row.priorityScore,
    };
  });

  return {
    generatedAt: formatDateTime(now),
    summary: summary,
    packages: packages,
  };
}

function getStatusChangeLabel(previousStatus, currentStatus) {
  if (!previousStatus) return "new";
  if (isStatusWorse(currentStatus, previousStatus)) return "worsened";
  if (isStatusWorse(previousStatus, currentStatus)) return "improved";
  return "stable";
}

function isStatusWorse(currentStatus, previousStatus) {
  return getStatusSortValue(currentStatus) < getStatusSortValue(previousStatus);
}

// ============================================================
// SNAPSHOT STORAGE
// ============================================================

function loadSnapshotState() {
  if (typeof PropertiesService === "undefined") {
    return { lastSnapshot: null, history: [] };
  }

  const properties = PropertiesService.getScriptProperties();

  return {
    lastSnapshot: parseJsonSafely(properties.getProperty(SNAPSHOT_STATE_KEY)),
    history: parseJsonSafely(properties.getProperty(HISTORY_STATE_KEY)) || [],
  };
}

function persistSnapshotState(snapshotState) {
  if (typeof PropertiesService === "undefined") return;

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(SNAPSHOT_STATE_KEY, JSON.stringify(snapshotState.lastSnapshot));
  properties.setProperty(HISTORY_STATE_KEY, JSON.stringify(snapshotState.history));
}

// ============================================================
// PROJECTION HELPERS
// ============================================================

const DAY_MS = 1000 * 60 * 60 * 24;

function computeProjection(startBalance, sessions, today) {
  if (!sessions.length) {
    if (startBalance < ALERT_THRESHOLD) {
      return {
        alertDate: formatDate(today),
        exhaustDate: startBalance <= 0 ? formatDate(today) : null,
        daysUntilAlert: 0,
        daysUntilExhaust: startBalance <= 0 ? 0 : null,
        status: "notify",
        rows: [],
      };
    }

    return {
      alertDate: null,
      exhaustDate: null,
      daysUntilAlert: null,
      daysUntilExhaust: null,
      status: "nodata",
      rows: [],
    };
  }

  let balance = startBalance;
  let alertDate = null;
  let exhaustDate = null;
  const rows = [];

  sessions.forEach(function(session) {
    const deductedCredits = roundToHundredth(session.durationMin / 60);
    balance = roundToHundredth(balance - deductedCredits);

    const flags = [];
    if (!alertDate && balance < ALERT_THRESHOLD) {
      alertDate = session.date;
      flags.push("alert");
    }
    if (!exhaustDate && balance <= 0) {
      exhaustDate = session.date;
      flags.push("exhaust");
    }

    rows.push({
      date: formatDate(session.date),
      dur: session.durationMin,
      deduct: deductedCredits,
      bal: balance,
      flag: flags.join(" "),
    });
  });

  const daysUntilAlert = alertDate
    ? Math.round((alertDate - today) / DAY_MS)
    : null;
  const daysUntilExhaust = exhaustDate
    ? Math.round((exhaustDate - today) / DAY_MS)
    : null;

  const status = startBalance < ALERT_THRESHOLD
    ? "notify"
    : alertDate && daysUntilAlert <= NOTIFY_WINDOW_DAYS
      ? "watch"
      : "ok";

  return {
    alertDate: alertDate ? formatDate(alertDate) : null,
    exhaustDate: exhaustDate ? formatDate(exhaustDate) : null,
    daysUntilAlert: daysUntilAlert,
    daysUntilExhaust: daysUntilExhaust,
    status: status,
    rows: rows,
  };
}

function worstStatus(packages) {
  if (packages.some(function(pkg) { return pkg.status === "notify"; })) return "notify";
  if (packages.some(function(pkg) { return pkg.status === "watch"; })) return "watch";
  if (packages.some(function(pkg) { return pkg.status === "ok"; })) return "ok";
  return "nodata";
}

// ============================================================
// GENERIC HELPERS
// ============================================================

function getSheetData(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('ไม่พบ sheet "' + sheetName + '"');

  return sheet.getDataRange().getValues().filter(function(row) {
    return row.some(function(cell) {
      return cell !== "" && cell !== null;
    });
  });
}

function getColMap(headerRow) {
  const map = {};
  headerRow.forEach(function(header, index) {
    if (header !== "" && header !== null) {
      map[String(header).trim()] = index;
    }
  });
  return map;
}

function readTrimmedCell(row, cols, columnName) {
  return String(row[cols[columnName]] || "").trim();
}

function readUpperCell(row, cols, columnName) {
  return readTrimmedCell(row, cols, columnName).toUpperCase();
}

function parseNumber(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : (fallback || 0);
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function getTodayDate() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const parsedDate = new Date(value);
  return isNaN(parsedDate)
    ? null
    : new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function roundToHundredth(value) {
  return Math.round(value * 100) / 100;
}

function formatDate(date) {
  return date
    ? Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd")
    : null;
}

function formatDateTime(date) {
  return date
    ? Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX")
    : null;
}

function formatShortTimestamp(isoValue) {
  const parsed = new Date(isoValue);
  return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "dd MMM HH:mm");
}

function parseJsonSafely(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (error) {
    Logger.log("Failed to parse snapshot JSON: " + error.message);
    return null;
  }
}
