// ============================================================
// BeGifted Credit Control Command Center — Bootstrap
// Shared constants and web-app entrypoints live here.
// ============================================================

const SPREADSHEET_ID_CREDITS = "100bidSt63ynf_y7Iq-nRQUj3MMQoNpnltOQdSiwHN-0";
const SPREADSHEET_ID_ANALYTICS = "15XTOU1kYDib4stuiFzbTOT1MAeRlCw20maOXk5irfsc";

const SHEET_AGGREGATIONS = "Aggregations";
const SHEET_CREDIT_CONTROL = "Credit_Control";
const SHEET_UPCOMING = "Upcoming Sessions";
const SHEET_STUDENTS = "Students";
const SHEET_STUDENTS_COURSES = "Students & Courses";
const SHEET_REMAINING_CREDITS = "RemainingCredits";
const SHEET_AUDIT_REPORT = "Dashboard Accuracy Audit";

const ALERT_THRESHOLD = 2;
const NOTIFY_WINDOW_DAYS = 30;

const EXCLUDED_PACKAGE_KEYWORDS = ["pretest", "trial"];
const STATUS_ORDER = { notify: 0, watch: 1, ok: 2, nodata: 3 };
const UNASSIGNED_ADMIN_KEY = "unassigned";
const UNASSIGNED_ADMIN_NAME = "Unassigned";
const ADMIN_OWNER_REGISTRY = Object.freeze([
  { key: "palm", label: "Palm", fullName: "Chiraya (Palm) Takornkulwut" },
  { key: "kem", label: "Kem", fullName: "Kemjira (Kem) Waritpariya" },
  { key: "care", label: "Care", fullName: "Kittiya (Care) Taweesinprasarn" },
  { key: "aya", label: "Aya", fullName: "Pakwalan (Aya) Singkhorn" },
  { key: "petchy", label: "Petchy", fullName: "Panida (Petchy) Wiya" },
  { key: "muk", label: "Muk", fullName: "Suphitsara (Muk) Manosamrit" },
]);

const SNAPSHOT_STATE_KEY = "BG_DASHBOARD_SNAPSHOT_V2";
const HISTORY_STATE_KEY = "BG_DASHBOARD_HISTORY_V2";
const HISTORY_LIMIT = 12;
const TREND_POINT_LIMIT = 8;
const DASHBOARD_CACHE_KEY = "BG_DASHBOARD_PAYLOAD_V2";
const DASHBOARD_CACHE_TTL_SECONDS = 120;
const DASHBOARD_CACHE_CHUNK_SIZE = 90000;
const STUDENT_ACTION_PROPERTY_PREFIX = "BG_ACTION_V1::";
const STUDENT_ACTION_HISTORY_LIMIT = 20;
const STUDENT_ACTION_STATUSES = Object.freeze([
  "contacted",
  "pending-callback",
  "resolved",
]);

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
    "Should_Credit",
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
    "Student Full Name",
    "Class Subject",
  ],
  remainingCredits: [
    "Student",
    "Admin",
  ],
});

function getAdminViewOptions() {
  return [{ key: "all", label: "All" }]
    .concat(ADMIN_OWNER_REGISTRY.map(function(admin) {
      return { key: admin.key, label: admin.label };
    }))
    .concat([{ key: UNASSIGNED_ADMIN_KEY, label: "Unassigned" }]);
}

// ============================================================
// ENTRY POINT
// ============================================================

function doGet() {
  return HtmlService
    .createHtmlOutputFromFile("dashboard")
    .setTitle("BeGifted — Credit Control Command Center")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// MAIN DATA FUNCTION
// ============================================================

function getStudentData() {
  return fetchDashboardData();
}

function beginDashboardDataTransfer(options) {
  const settings = options || {};
  const cache = Object.prototype.hasOwnProperty.call(settings, "cache")
    ? settings.cache
    : getDashboardCache();
  const cacheKey = settings.cacheKey || DASHBOARD_CACHE_KEY;
  const payloadLoader = settings.payloadLoader || fetchDashboardData;
  const manifest = readChunkedCacheManifest(cache, cacheKey);

  if (manifest && manifest.parts > 0) {
    return {
      mode: "chunked",
      parts: manifest.parts,
    };
  }

  const payload = payloadLoader();
  const refreshedManifest = readChunkedCacheManifest(cache, cacheKey);

  if (refreshedManifest && refreshedManifest.parts > 0) {
    return {
      mode: "chunked",
      parts: refreshedManifest.parts,
    };
  }

  return {
    mode: "inline",
    payload: payload,
  };
}

function buildDashboardTransferChunks(payload) {
  return chunkString(JSON.stringify(payload), DASHBOARD_CACHE_CHUNK_SIZE);
}

function fetchDashboardDataChunk(index, options) {
  const settings = options || {};
  const cache = Object.prototype.hasOwnProperty.call(settings, "cache")
    ? settings.cache
    : getDashboardCache();
  const cacheKey = settings.cacheKey || DASHBOARD_CACHE_KEY;
  const payloadLoader = settings.payloadLoader || fetchDashboardData;

  if (!cache) {
    throw new Error("Dashboard cache unavailable. Retry the load.");
  }

  const chunk = cache.get(getDashboardCachePartKey(cacheKey, index));
  if (typeof chunk === "string") {
    return chunk;
  }

  const recoveredChunks = buildDashboardTransferChunks(payloadLoader());
  if (index >= recoveredChunks.length) {
    throw new Error("Dashboard payload chunk unavailable. Retry the load.");
  }

  return recoveredChunks[index];
}

function fetchDashboardDataChunkBatch(startIndex, batchSize, options) {
  const settings = options || {};
  const cache = Object.prototype.hasOwnProperty.call(settings, "cache")
    ? settings.cache
    : getDashboardCache();
  const cacheKey = settings.cacheKey || DASHBOARD_CACHE_KEY;
  const payloadLoader = settings.payloadLoader || fetchDashboardData;

  if (!cache) {
    throw new Error("Dashboard cache unavailable. Retry the load.");
  }

  if (!Number.isInteger(startIndex) || startIndex < 0) {
    throw new Error("Dashboard payload chunk batch start index is invalid.");
  }

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("Dashboard payload chunk batch size is invalid.");
  }

  const manifest = readChunkedCacheManifest(cache, cacheKey);
  let recoveredChunks = null;
  let totalParts = manifest && manifest.parts ? manifest.parts : 0;

  if (totalParts < 1) {
    recoveredChunks = buildDashboardTransferChunks(payloadLoader());
    totalParts = recoveredChunks.length;
  }

  if (startIndex >= totalParts) {
    throw new Error("Dashboard payload chunk batch out of range. Retry the load.");
  }

  if (recoveredChunks) {
    return recoveredChunks.slice(startIndex, Math.min(startIndex + batchSize, totalParts));
  }

  const endIndex = Math.min(startIndex + batchSize, totalParts);
  const partKeys = [];

  for (let index = startIndex; index < endIndex; index++) {
    partKeys.push(getDashboardCachePartKey(cacheKey, index));
  }

  const parts = cache.getAll(partKeys);
  const hasMissingPart = partKeys.some(function(partKey) {
    return typeof parts[partKey] !== "string";
  });

  if (hasMissingPart) {
    recoveredChunks = buildDashboardTransferChunks(payloadLoader());
    if (startIndex >= recoveredChunks.length) {
      throw new Error("Dashboard payload chunk batch out of range. Retry the load.");
    }
    return recoveredChunks.slice(startIndex, Math.min(startIndex + batchSize, recoveredChunks.length));
  }

  return partKeys.map(function(partKey) {
    return parts[partKey];
  });
}

function fetchDashboardData() {
  return getCachedDashboardPayload();
}

function getCachedDashboardPayload(options) {
  const settings = options || {};
  const cache = Object.prototype.hasOwnProperty.call(settings, "cache")
    ? settings.cache
    : getDashboardCache();
  const payloadBuilder = settings.payloadBuilder || buildAndPersistDashboardPayload;
  const cacheKey = settings.cacheKey || DASHBOARD_CACHE_KEY;
  const ttlSeconds = settings.ttlSeconds || DASHBOARD_CACHE_TTL_SECONDS;
  const cachedPayload = readChunkedCacheValue(cache, cacheKey);

  if (cachedPayload) {
    return cachedPayload;
  }

  const payload = payloadBuilder();
  writeChunkedCacheValue(cache, cacheKey, payload, ttlSeconds);
  return payload;
}

function buildAndPersistDashboardPayload() {
  try {
    const today = getTodayDate();
    const now = new Date();
    const sources = loadDashboardSources();

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
    const snapshotState = loadSnapshotState();
    const dashboardModel = buildDashboardModel(students, snapshotState, today, now);

    persistSnapshotState(dashboardModel.snapshotState);
    return dashboardModel.payload;
  } catch (e) {
    Logger.log("buildAndPersistDashboardPayload error: " + e.toString());
    throw new Error("ดึงข้อมูลไม่ได้: " + e.message);
  }
}
