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

function normalizeIdentityPart(value, fallback) {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  return normalized || String(fallback || "");
}

function buildDashboardStudentKey(studentName, parentName) {
  return [
    normalizeIdentityPart(studentName, "unknown-student"),
    normalizeIdentityPart(parentName, "missing-parent"),
  ].join("::");
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
