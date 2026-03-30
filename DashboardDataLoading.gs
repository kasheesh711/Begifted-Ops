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
