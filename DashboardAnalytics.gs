// ============================================================
// DASHBOARD VIEW MODEL
// ============================================================

function buildDashboardModel(students, snapshotState, today, now) {
  const settings = arguments.length > 4 && arguments[4] ? arguments[4] : {};
  attachActionStatesToStudents(students, today, {
    properties: settings.actionProperties,
  });

  const previousSnapshot = snapshotState.lastSnapshot;
  const packageRows = buildPackageRows(students, previousSnapshot);

  packageRows.forEach(function(row) {
    const student = students[row.studentIndex];
    if (student && student.packages[row.packageIndex]) {
      student.packages[row.packageIndex].priorityScore = row.priorityScore;
      student.packages[row.packageIndex].statusChange = row.statusChange;
      student.packages[row.packageIndex].balanceDelta = row.balanceDelta;
    }
  });

  const studentQueue = buildStudentQueue(students);
  const summary = buildSummary(students, packageRows, previousSnapshot, studentQueue);
  const calendar = buildCalendarData(students, studentQueue, today);
  const snapshotForPersistence = buildSnapshotForPersistence(summary, packageRows, now);
  const nextHistory = updateHistory(snapshotState.history, summary, now);

  return {
    payload: {
      adminViews: getAdminViewOptions(),
      lastUpdatedAt: formatDateTime(now),
      previousUpdatedAt: previousSnapshot ? previousSnapshot.generatedAt : null,
      summary: summary,
      studentQueue: studentQueue,
      calendar: calendar,
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

function buildStudentQueue(students) {
  return students
    .map(function(student, studentIndex) {
      return buildStudentQueueRow(student, studentIndex);
    })
    .filter(function(row) {
      return row.includeInQueue;
    })
    .sort(compareStudentQueueRows);
}

function buildStudentQueueRow(student, studentIndex) {
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
  const totalCredits = roundToTenth(packages.reduce(function(sum, pkg) {
    return sum + pkg.totalCredits;
  }, 0));
  const riskyPackages = packages.filter(function(pkg) {
    return pkg.status === "notify" || pkg.status === "watch";
  });
  const nextSession = findStudentNextSession(packages);
  const nextAlert = findEarliestPackageDate(packages, "alertDate");
  const nextExhaust = findEarliestPackageDate(packages, "exhaustDate");
  const daysUntilAlert = findMinimumPackageNumber(packages, "daysUntilAlert");
  const daysUntilExhaust = findMinimumPackageNumber(packages, "daysUntilExhaust");
  const worst = worstStatus(packages);
  const noFutureSchedule = !nextSession;
  const hasLowOrNegativeBalance = totalAdjustedRemaining < ALERT_THRESHOLD || totalCurrentRemaining <= 0;
  const pinned = noFutureSchedule && hasLowOrNegativeBalance;
  const includeInQueue = pinned || riskyPackages.length > 0;
  const maxPackagePriority = packages.reduce(function(maxScore, pkg) {
    return Math.max(maxScore, pkg.priorityScore || 0);
  }, 0);
  const priorityScore = roundToTenth(
    maxPackagePriority +
    (pinned ? 90 : 0) +
    (noFutureSchedule ? 18 : 0) +
    (totalCurrentRemaining <= 0 ? 22 : 0) +
    Math.min(18, riskyPackages.length * 6) +
    Math.min(12, totalPendingDeduction * 2)
  );
  const packageNames = packages.map(function(pkg) { return pkg.name; }).sort();

  return {
    key: student.student,
    studentKey: student.studentKey || buildDashboardStudentKey(student.student, student.parent),
    student: student.student,
    parent: student.parent || "Missing parent",
    studentIndex: studentIndex,
    adminOwnerKey: student.adminOwnerKey || UNASSIGNED_ADMIN_KEY,
    adminOwnerName: student.adminOwnerName || UNASSIGNED_ADMIN_NAME,
    actionState: cloneActionState(student.actionState),
    worstStatus: worst,
    packageCount: packages.length,
    riskyPackageCount: riskyPackages.length,
    totalCurrentRemaining: totalCurrentRemaining,
    totalAdjustedRemaining: totalAdjustedRemaining,
    totalPendingDeduction: totalPendingDeduction,
    totalCredits: totalCredits,
    packageNames: packageNames,
    nextSessionDate: nextSession ? nextSession.date : null,
    nextSessionPackageName: nextSession ? nextSession.packageName : null,
    nextSessionCount: packages.reduce(function(sum, pkg) {
      return sum + (pkg.upcomingCount || 0);
    }, 0),
    nextAlertDate: nextAlert,
    nextExhaustDate: nextExhaust,
    daysUntilAlert: daysUntilAlert,
    daysUntilExhaust: daysUntilExhaust,
    noFutureSchedule: noFutureSchedule,
    pinned: pinned,
    includeInQueue: includeInQueue,
    priorityScore: priorityScore,
    recommendedAction: getStudentRecommendedAction(
      worst,
      pinned,
      noFutureSchedule,
      totalAdjustedRemaining,
      totalCurrentRemaining
    ),
    whyNow: getStudentActionReason(
      worst,
      pinned,
      noFutureSchedule,
      totalAdjustedRemaining,
      totalCurrentRemaining,
      nextAlert,
      nextSession
    ),
    searchText: [
      student.student,
      student.parent || "",
      packageNames.join(" "),
    ].join(" ").toLowerCase(),
  };
}

function compareStudentQueueRows(a, b) {
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }
  if (b.priorityScore !== a.priorityScore) {
    return b.priorityScore - a.priorityScore;
  }

  const statusDelta = getStatusSortValue(a.worstStatus) - getStatusSortValue(b.worstStatus);
  if (statusDelta !== 0) return statusDelta;

  if (a.totalAdjustedRemaining !== b.totalAdjustedRemaining) {
    return a.totalAdjustedRemaining - b.totalAdjustedRemaining;
  }

  const nextSessionDelta = compareIsoDateValues(a.nextSessionDate, b.nextSessionDate);
  if (nextSessionDelta !== 0) return nextSessionDelta;

  return a.student.localeCompare(b.student);
}

function buildCalendarData(students, studentQueue, today) {
  const queueByStudent = {};
  const dayMap = {};
  let minDate = formatDate(today);
  let maxDate = formatDate(today);

  studentQueue.forEach(function(row) {
    queueByStudent[row.student] = row;
  });

  students.forEach(function(student, studentIndex) {
    const queueRow = queueByStudent[student.student];
    const dayStudentMap = {};

    student.packages.forEach(function(pkg) {
      (pkg.upcomingSessions || []).forEach(function(session) {
        const date = session.date;
        if (!date) return;

        if (date < minDate) minDate = date;
        if (date > maxDate) maxDate = date;

        if (!dayMap[date]) {
          dayMap[date] = {
            date: date,
            studentMap: {},
          };
        }

        if (!dayMap[date].studentMap[student.student]) {
          dayMap[date].studentMap[student.student] = {
            key: student.student + "::" + date,
            student: student.student,
            parent: student.parent || "Missing parent",
            studentIndex: studentIndex,
            adminOwnerKey: student.adminOwnerKey || UNASSIGNED_ADMIN_KEY,
            adminOwnerName: student.adminOwnerName || UNASSIGNED_ADMIN_NAME,
            worstStatus: queueRow ? queueRow.worstStatus : worstStatus(student.packages),
            totalAdjustedRemaining: queueRow
              ? queueRow.totalAdjustedRemaining
              : roundToTenth(student.packages.reduce(function(sum, item) { return sum + item.adjustedRemaining; }, 0)),
            totalCurrentRemaining: queueRow
              ? queueRow.totalCurrentRemaining
              : roundToTenth(student.packages.reduce(function(sum, item) { return sum + item.currentRemaining; }, 0)),
            priorityScore: queueRow ? queueRow.priorityScore : 0,
            pinned: queueRow ? queueRow.pinned : false,
            nextSessionDate: queueRow ? queueRow.nextSessionDate : null,
            packageCount: student.packages.length,
            recommendedAction: queueRow ? queueRow.recommendedAction : "Monitor",
            whyNow: queueRow ? queueRow.whyNow : "Upcoming sessions scheduled.",
            searchText: [
              student.student,
              student.parent || "",
              student.packages.map(function(item) { return item.name; }).join(" "),
            ].join(" ").toLowerCase(),
            sessions: [],
          };
        }

        dayMap[date].studentMap[student.student].sessions.push({
          packageName: pkg.name,
          durationMin: session.durationMin,
          deduct: session.deduct,
        });
      });
    });
  });

  const days = Object.keys(dayMap).sort().map(function(date) {
    const studentsForDay = Object.keys(dayMap[date].studentMap).map(function(studentName) {
      const studentEntry = dayMap[date].studentMap[studentName];
      studentEntry.sessions.sort(function(a, b) {
        return a.packageName.localeCompare(b.packageName);
      });
      studentEntry.sessionCount = studentEntry.sessions.length;
      studentEntry.totalMinutes = studentEntry.sessions.reduce(function(sum, session) {
        return sum + session.durationMin;
      }, 0);
      studentEntry.totalDeduction = roundToTenth(studentEntry.sessions.reduce(function(sum, session) {
        return sum + session.deduct;
      }, 0));
      studentEntry.isNextSessionDay = studentEntry.nextSessionDate === date;
      return studentEntry;
    }).sort(compareCalendarStudents);

    return {
      date: date,
      totalStudents: studentsForDay.length,
      urgentStudents: studentsForDay.filter(function(item) {
        return item.pinned || item.worstStatus === "notify";
      }).length,
      watchStudents: studentsForDay.filter(function(item) {
        return item.worstStatus === "watch";
      }).length,
      students: studentsForDay,
    };
  });

  return {
    availableStart: minDate,
    availableEnd: maxDate,
    days: days,
  };
}

function compareCalendarStudents(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  if (a.isNextSessionDay !== b.isNextSessionDay) return a.isNextSessionDay ? -1 : 1;
  return a.student.localeCompare(b.student);
}

function findStudentNextSession(packages) {
  const sessions = [];

  packages.forEach(function(pkg) {
    (pkg.upcomingSessions || []).forEach(function(session) {
      sessions.push({
        date: session.date,
        packageName: pkg.name,
      });
    });
  });

  sessions.sort(function(a, b) {
    return compareIsoDateValues(a.date, b.date);
  });

  return sessions.length ? sessions[0] : null;
}

function findEarliestPackageDate(packages, fieldName) {
  const values = packages
    .map(function(pkg) { return pkg[fieldName]; })
    .filter(function(value) { return !!value; })
    .sort(compareIsoDateValues);

  return values.length ? values[0] : null;
}

function findMinimumPackageNumber(packages, fieldName) {
  const values = packages
    .map(function(pkg) { return pkg[fieldName]; })
    .filter(function(value) { return value !== null && value !== undefined; });

  return values.length ? Math.min.apply(null, values) : null;
}

function compareIsoDateValues(valueA, valueB) {
  const normalizedA = valueA ? parseDate(valueA).getTime() : Number.POSITIVE_INFINITY;
  const normalizedB = valueB ? parseDate(valueB).getTime() : Number.POSITIVE_INFINITY;
  return normalizedA - normalizedB;
}

function getStudentRecommendedAction(
  worstStatusValue,
  pinned,
  noFutureSchedule,
  totalAdjustedRemaining,
  totalCurrentRemaining
) {
  if (pinned && totalCurrentRemaining <= 0) {
    return "Contact parent immediately";
  }
  if (pinned || (noFutureSchedule && totalAdjustedRemaining < ALERT_THRESHOLD)) {
    return "Review schedule and renew";
  }
  if (worstStatusValue === "notify") {
    return "Contact parent today";
  }
  if (worstStatusValue === "watch") {
    return "Prepare outreach";
  }
  return "Monitor";
}

function getStudentActionReason(
  worstStatusValue,
  pinned,
  noFutureSchedule,
  totalAdjustedRemaining,
  totalCurrentRemaining,
  nextAlert,
  nextSession
) {
  if (pinned && totalCurrentRemaining <= 0) {
    return "No future schedule is on file and the rolled-up system balance is already zero or negative.";
  }
  if (pinned) {
    return "No future schedule is on file and the rolled-up balance is already below the alert threshold.";
  }
  if (worstStatusValue === "notify") {
    return "At least one active package is already below the two-credit alert threshold.";
  }
  if (worstStatusValue === "watch" && nextAlert) {
    return "An active package is projected to fall below two credits on " + nextAlert + ".";
  }
  if (noFutureSchedule) {
    return "No future schedule is on file, so operations should confirm the next class plan.";
  }
  if (nextSession) {
    return "The next scheduled session is on " + nextSession.date + ".";
  }
  return "The student remains in monitoring with no immediate action.";
}

function buildSummary(students, packageRows, previousSnapshot, studentQueue) {
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

  const currentSummary = {
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

  currentSummary.deltas = buildSummaryDeltas(
    currentSummary,
    previousSnapshot && previousSnapshot.summary ? previousSnapshot.summary : null
  );

  return currentSummary;
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
      queueStudents: null,
      pinnedStudents: null,
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
    queueStudents: currentSummary.queue.students - ((previousSummary.queue && previousSummary.queue.students) || 0),
    pinnedStudents: currentSummary.queue.pinnedStudents - ((previousSummary.queue && previousSummary.queue.pinnedStudents) || 0),
  };
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
