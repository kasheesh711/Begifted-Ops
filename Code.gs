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

const ALERT_THRESHOLD = 2;
const NOTIFY_WINDOW_DAYS = 30;

const EXCLUDED_PACKAGE_KEYWORDS = ["pretest", "trial"];
const STATUS_ORDER = { notify: 0, watch: 1, ok: 2, nodata: 3 };

const SNAPSHOT_STATE_KEY = "BG_DASHBOARD_SNAPSHOT_V2";
const HISTORY_STATE_KEY = "BG_DASHBOARD_HISTORY_V2";
const HISTORY_LIMIT = 12;
const TREND_POINT_LIMIT = 8;
const DASHBOARD_CACHE_KEY = "BG_DASHBOARD_PAYLOAD_V1";
const DASHBOARD_CACHE_TTL_SECONDS = 120;
const DASHBOARD_CACHE_CHUNK_SIZE = 90000;

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
  const payload = payloadLoader();
  const manifest = readChunkedCacheManifest(cache, cacheKey);

  if (!manifest) {
    return {
      mode: "inline",
      payload: payload,
    };
  }

  return {
    mode: "chunked",
    parts: manifest.parts,
  };
}

function fetchDashboardDataChunk(index, options) {
  const settings = options || {};
  const cache = Object.prototype.hasOwnProperty.call(settings, "cache")
    ? settings.cache
    : getDashboardCache();
  const cacheKey = settings.cacheKey || DASHBOARD_CACHE_KEY;

  if (!cache) {
    throw new Error("Dashboard cache unavailable. Retry the load.");
  }

  const chunk = cache.get(getDashboardCachePartKey(cacheKey, index));
  if (typeof chunk !== "string") {
    throw new Error("Dashboard payload chunk unavailable. Retry the load.");
  }

  return chunk;
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
    Logger.log("buildAndPersistDashboardPayload error: " + e.toString());
    throw new Error("ดึงข้อมูลไม่ได้: " + e.message);
  }
}
