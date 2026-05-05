// ============================================================
// STUDENT ACTION STATE
// ============================================================

function setStudentAction(studentKey, status, actorAdminKey, options) {
  return writeStudentActionState(studentKey, status, actorAdminKey, options);
}

function bulkSetStudentAction(studentKeys, status, actorAdminKey, options) {
  const uniqueKeys = Array.from(new Set((studentKeys || []).filter(function(studentKey) {
    return !!String(studentKey || "").trim();
  })));
  const updates = uniqueKeys.map(function(studentKey) {
    return writeStudentActionState(studentKey, status, actorAdminKey, options);
  });

  return {
    updated: updates,
  };
}

function clearStudentAction(studentKey, actorAdminKey, options) {
  return writeStudentActionState(studentKey, null, actorAdminKey, options);
}

function writeStudentActionState(studentKey, status, actorAdminKey, options) {
  const normalizedStudentKey = String(studentKey || "").trim();
  if (!normalizedStudentKey) {
    throw new Error("Student action requires a student key.");
  }

  const settings = options || {};
  const properties = getStudentActionProperties(settings);
  const record = loadStudentActionRecord(normalizedStudentKey, {
    properties: properties,
  });
  const now = settings.now instanceof Date ? settings.now : new Date();
  const actor = resolveStudentActionActor(actorAdminKey);
  const nextEntry = status === null || status === undefined || status === ""
    ? createClearedStudentActionEntry(now, actor)
    : createStudentActionEntry(status, now, actor);

  record.history.unshift(nextEntry);
  record.history = record.history.slice(0, STUDENT_ACTION_HISTORY_LIMIT);
  record.latestAction = nextEntry.cleared ? null : cloneActionState(nextEntry);

  saveStudentActionRecord(normalizedStudentKey, record, properties);
  clearDashboardCache(settings.cache || getDashboardCache(), settings.cacheKey || DASHBOARD_CACHE_KEY);

  return {
    studentKey: normalizedStudentKey,
    actionState: sanitizeStudentActionState(record.latestAction, getReferenceToday(settings, now)),
  };
}

function attachActionStatesToStudents(students, today, options) {
  const studentList = Array.isArray(students) ? students : [];
  const actionStateByKey = loadStudentActionStatesByStudentKey(
    studentList.map(function(student) { return student.studentKey; }),
    today,
    options
  );

  studentList.forEach(function(student) {
    student.actionState = cloneActionState(actionStateByKey[student.studentKey] || null);
  });
}

function loadStudentActionStatesByStudentKey(studentKeys, today, options) {
  const normalizedKeys = Array.from(new Set((studentKeys || []).filter(function(studentKey) {
    return !!String(studentKey || "").trim();
  })));
  if (!normalizedKeys.length) {
    return {};
  }

  const properties = getStudentActionProperties(options || {});
  if (!properties || typeof properties.getProperties !== "function") {
    return {};
  }

  const propertyMap = properties.getProperties() || {};
  const actionStateByKey = {};

  normalizedKeys.forEach(function(studentKey) {
    const serialized = propertyMap[getStudentActionPropertyKey(studentKey)] || null;
    const record = parseJsonSafely(serialized) || {};
    actionStateByKey[studentKey] = sanitizeStudentActionState(
      record.latestAction || null,
      getReferenceToday(options || {}, null)
    );
  });

  return actionStateByKey;
}

function loadStudentActionRecord(studentKey, options) {
  const properties = getStudentActionProperties(options || {});
  if (!properties || typeof properties.getProperty !== "function") {
    return {
      studentKey: studentKey,
      latestAction: null,
      history: [],
    };
  }

  const storedRecord = parseJsonSafely(properties.getProperty(getStudentActionPropertyKey(studentKey))) || {};

  return {
    studentKey: studentKey,
    latestAction: storedRecord.latestAction || null,
    history: Array.isArray(storedRecord.history) ? storedRecord.history : [],
  };
}

function saveStudentActionRecord(studentKey, record, properties) {
  if (!properties || typeof properties.setProperty !== "function") {
    return;
  }

  properties.setProperty(
    getStudentActionPropertyKey(studentKey),
    JSON.stringify({
      studentKey: studentKey,
      latestAction: record.latestAction || null,
      history: record.history || [],
    })
  );
}

function createStudentActionEntry(status, now, actor) {
  const normalizedStatus = normalizeStudentActionStatus(status);
  if (!normalizedStatus) {
    throw new Error("Unsupported student action status: " + status);
  }

  return {
    status: normalizedStatus,
    updatedAt: formatDateTime(now),
    updatedByAdminKey: actor ? actor.key : null,
    updatedByAdminLabel: actor ? actor.label : null,
    isToday: true,
  };
}

function createClearedStudentActionEntry(now, actor) {
  return {
    status: null,
    cleared: true,
    updatedAt: formatDateTime(now),
    updatedByAdminKey: actor ? actor.key : null,
    updatedByAdminLabel: actor ? actor.label : null,
    isToday: true,
  };
}

function sanitizeStudentActionState(actionState, today) {
  if (!actionState || !actionState.status || !isStudentActionStatus(actionState.status)) {
    return null;
  }

  if (!isActionStateToday(actionState.updatedAt, today)) {
    return null;
  }

  return {
    status: actionState.status,
    updatedAt: actionState.updatedAt,
    updatedByAdminKey: actionState.updatedByAdminKey || null,
    updatedByAdminLabel: actionState.updatedByAdminLabel || null,
    isToday: true,
  };
}

function cloneActionState(actionState) {
  if (!actionState) return null;

  return {
    status: actionState.status,
    updatedAt: actionState.updatedAt,
    updatedByAdminKey: actionState.updatedByAdminKey || null,
    updatedByAdminLabel: actionState.updatedByAdminLabel || null,
    isToday: !!actionState.isToday,
  };
}

function normalizeStudentActionStatus(status) {
  const normalizedStatus = normalizeText(status);
  return isStudentActionStatus(normalizedStatus) ? normalizedStatus : null;
}

function isStudentActionStatus(status) {
  return STUDENT_ACTION_STATUSES.indexOf(status) !== -1;
}

function resolveStudentActionActor(actorAdminKey) {
  const normalizedKey = normalizeText(actorAdminKey);
  if (!normalizedKey || normalizedKey === "all" || normalizedKey === UNASSIGNED_ADMIN_KEY) {
    return null;
  }

  const match = ADMIN_OWNER_REGISTRY.find(function(admin) {
    return admin.key === normalizedKey;
  });

  return match ? { key: match.key, label: match.label } : null;
}

function isActionStateToday(updatedAt, today) {
  const parsed = parseDate(updatedAt);
  if (!parsed) {
    return false;
  }

  return formatDate(parsed) === formatDate(today || getTodayDate());
}

function getReferenceToday(options, fallbackNow) {
  if (options && options.today instanceof Date) {
    return options.today;
  }

  if (fallbackNow instanceof Date) {
    return parseDate(fallbackNow);
  }

  return getTodayDate();
}

function getStudentActionPropertyKey(studentKey) {
  return STUDENT_ACTION_PROPERTY_PREFIX + String(studentKey || "").trim();
}

function getStudentActionProperties(options) {
  if (options && Object.prototype.hasOwnProperty.call(options, "properties")) {
    return options.properties;
  }

  if (typeof PropertiesService === "undefined") {
    return null;
  }

  return PropertiesService.getScriptProperties();
}
