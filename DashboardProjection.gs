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
