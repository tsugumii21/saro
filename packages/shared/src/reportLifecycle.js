/**
 * Time-based visibility rules.
 *
 * Everything here is a pure function of a report (or a blackspot) and a clock.
 * Nothing writes, nothing deletes, nothing calls the network. A report that
 * stops rendering as an active pin is still in Postgres, unchanged and fully
 * readable by its tracking code; what expires is the claim that it describes
 * something happening *now*.
 *
 * The three durations that drive this live in constants.js, next to each other,
 * because they are judgement calls that will move once Legazpi has real data.
 * Every function here takes them as overridable options so a caller — a test, a
 * staff view with different needs — can ask a different question without the
 * defaults being touched.
 */

import {
  REPORT_ACTIVE_HOURS_EMERGENCY,
  REPORT_STALE_DAYS_INFRASTRUCTURE,
  ACCIDENT_ROLLING_WINDOW_MONTHS,
  MIN_INCIDENTS_FOR_ACCIDENT_AREA,
  EMERGENCY_VISIBILITY_CATEGORIES,
  INFRASTRUCTURE_STALE_CATEGORIES,
  DEFAULT_AUTO_ARCHIVE_HOURS,
  isArchivedReport,
} from "./constants.js";

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/* ── Small shared helpers ─────────────────────────────────────────────────── */

function categoryOf(report) {
  if (!report) return "";
  return report.category_id ?? report.category ?? "";
}

function parseTime(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isResolvedOrClosed(status) {
  return (
    status === "resolved" ||
    status === "closed_confirmed" ||
    status === "closed_unconfirmed"
  );
}

/** True when this report's hazard is one that expires on its own. */
export function isEmergencyVisibilityCategory(reportOrCategory) {
  const key =
    typeof reportOrCategory === "string" ? reportOrCategory : categoryOf(reportOrCategory);
  return EMERGENCY_VISIBILITY_CATEGORIES.includes(key);
}

/** True when this report is infrastructure work that can go stale waiting. */
export function isInfrastructureStaleCategory(reportOrCategory) {
  const key =
    typeof reportOrCategory === "string" ? reportOrCategory : categoryOf(reportOrCategory);
  return INFRASTRUCTURE_STALE_CATEGORIES.includes(key);
}

/* ── Report active visibility ─────────────────────────────────────────────── */

/**
 * Should this report still render as an active pin on the live map?
 *
 * Layered on top of the existing archive rule rather than replacing it, so
 * every category keeps the behaviour it already had and only the fast-moving
 * emergencies gain the shorter clock.
 *
 * For EMERGENCY_VISIBILITY_CATEGORIES the pin ends at whichever comes first:
 * an office marking it resolved, or REPORT_ACTIVE_HOURS_EMERGENCY since filing.
 * A reopened report is live again by definition and is never expired by status.
 *
 * @param {object} report
 * @param {object} [options]
 * @param {number} [options.now]              Clock override, ms since epoch.
 * @param {number} [options.emergencyHours]   Defaults to REPORT_ACTIVE_HOURS_EMERGENCY.
 * @param {number} [options.archiveHours]     Defaults to DEFAULT_AUTO_ARCHIVE_HOURS.
 * @returns {boolean}
 */
export function isReportActiveOnMap(report, options = {}) {
  if (!report) return false;

  const {
    now = Date.now(),
    emergencyHours = REPORT_ACTIVE_HOURS_EMERGENCY,
    archiveHours = DEFAULT_AUTO_ARCHIVE_HOURS,
  } = options;

  /* The long-standing rule still applies to everything: resolved and closed
     reports fall off the map once their grace period is up. */
  if (isArchivedReport(report, archiveHours)) return false;

  if (!isEmergencyVisibilityCategory(report)) return true;

  /* Whichever comes first — the office's word, or the clock. */
  if (isResolvedOrClosed(report.status)) return false;

  const filedAt = parseTime(report.created_at);
  if (filedAt === null) return true;   // undated: keep it rather than guess it away

  return now - filedAt <= emergencyHours * HOUR_MS;
}

/**
 * Whole-hours a report has been on the map. Useful for "expires in N hours".
 * Returns null when the report carries no usable filing timestamp.
 */
export function hoursSinceFiled(report, now = Date.now()) {
  const filedAt = parseTime(report?.created_at);
  if (filedAt === null) return null;
  return Math.floor((now - filedAt) / HOUR_MS);
}

/* ── Infrastructure staleness ─────────────────────────────────────────────── */

/**
 * Days since an office last moved this report.
 *
 * `updated_at` is the office's own footprint; `created_at` stands in when it is
 * absent. That fallback matters on the public map, whose RPC projection returns
 * no `updated_at` at all — there, a report reads as stale once it is old, which
 * is the conservative direction to be wrong in.
 *
 * @returns {number|null} null when the report has no usable timestamp.
 */
export function daysSinceStatusUpdate(report, now = Date.now()) {
  const touchedAt = parseTime(report?.updated_at) ?? parseTime(report?.created_at);
  if (touchedAt === null) return null;
  return Math.floor((now - touchedAt) / DAY_MS);
}

/**
 * Has this infrastructure report been waiting too long for an office to act?
 *
 * Never removes anything and never applies to a report that already reached
 * resolution — a closed pothole is finished, not neglected.
 *
 * @param {object} report
 * @param {object} [options]
 * @param {number} [options.now]        Clock override, ms since epoch.
 * @param {number} [options.staleDays]  Defaults to REPORT_STALE_DAYS_INFRASTRUCTURE.
 * @returns {boolean}
 */
export function isStaleReport(report, options = {}) {
  if (!report) return false;

  const { now = Date.now(), staleDays = REPORT_STALE_DAYS_INFRASTRUCTURE } = options;

  if (!isInfrastructureStaleCategory(report)) return false;
  if (isResolvedOrClosed(report.status)) return false;

  const waiting = daysSinceStatusUpdate(report, now);
  if (waiting === null) return false;

  return waiting > staleDays;
}

/* ── Accident rolling window ──────────────────────────────────────────────── */

/**
 * Start of the trailing window, as ms since epoch.
 *
 * Calendar months, not a fixed 30-day approximation, so "24 months" lands on
 * the same day of the month two years back and the boundary does not drift.
 */
export function rollingWindowStart(now = Date.now(), months = ACCIDENT_ROLLING_WINDOW_MONTHS) {
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);
  return start.getTime();
}

/** Pull a usable timestamp off an incident, whatever shape it arrived in. */
function incidentTime(incident) {
  if (incident === null || incident === undefined) return null;
  if (typeof incident === "string" || incident instanceof Date) return parseTime(incident);
  return (
    parseTime(incident.occurred_at) ??
    parseTime(incident.created_at) ??
    parseTime(incident.reported_at) ??
    parseTime(incident.last_reported_at)
  );
}

/**
 * How many of these incidents fall inside the trailing window.
 *
 * Anything older is excluded from the count and left completely untouched.
 *
 * @param {Array} incidents  Timestamps, or objects carrying one.
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {number} [options.windowMonths] Defaults to ACCIDENT_ROLLING_WINDOW_MONTHS.
 * @returns {number}
 */
export function countIncidentsInWindow(incidents, options = {}) {
  const { now = Date.now(), windowMonths = ACCIDENT_ROLLING_WINDOW_MONTHS } = options;
  const cutoff = rollingWindowStart(now, windowMonths);

  let count = 0;
  for (const incident of incidents ?? []) {
    const at = incidentTime(incident);
    if (at === null) continue;
    /* Future-dated rows are counted: a clock skew of a few minutes should not
       silently drop a crash that was just filed. */
    if (at >= cutoff) count += 1;
  }
  return count;
}

/**
 * Decide whether a location currently reads as accident-prone.
 *
 * Prefers incident-level dates so the window can actually be applied. When a
 * blackspot arrives carrying only an all-time scalar — an older row, or the
 * offline fallback — there is nothing to filter on, and that is reported
 * honestly through `windowed: false` rather than passing an all-time tally off
 * as a windowed one.
 *
 * @param {object} spot
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {number} [options.windowMonths]  Defaults to ACCIDENT_ROLLING_WINDOW_MONTHS.
 * @param {number} [options.minIncidents]  Defaults to MIN_INCIDENTS_FOR_ACCIDENT_AREA.
 * @returns {{inWindowCount: number, qualifies: boolean, windowed: boolean}}
 */
export function evaluateAccidentArea(spot, options = {}) {
  const {
    now = Date.now(),
    windowMonths = ACCIDENT_ROLLING_WINDOW_MONTHS,
    minIncidents = MIN_INCIDENTS_FOR_ACCIDENT_AREA,
  } = options;

  if (!spot) return { inWindowCount: 0, qualifies: false, windowed: false };

  const incidents = spot.incidents ?? spot.incident_dates ?? null;

  if (Array.isArray(incidents)) {
    const inWindowCount = countIncidentsInWindow(incidents, { now, windowMonths });
    return { inWindowCount, qualifies: inWindowCount >= minIncidents, windowed: true };
  }

  /* Server-side windowing already done — get_accident_blackspots_windowed
     returns the trailing count under this name. */
  if (Number.isFinite(Number(spot.recent_incident_count))) {
    const inWindowCount = Number(spot.recent_incident_count);
    return { inWindowCount, qualifies: inWindowCount >= minIncidents, windowed: true };
  }

  const allTime = Number(spot.incident_count ?? 0);
  return {
    inWindowCount: allTime,
    qualifies: allTime >= minIncidents,
    windowed: false,
  };
}

/**
 * Convenience wrapper for callers that only need the yes/no.
 * @returns {boolean}
 */
export function qualifiesAsAccidentArea(spot, options = {}) {
  return evaluateAccidentArea(spot, options).qualifies;
}
