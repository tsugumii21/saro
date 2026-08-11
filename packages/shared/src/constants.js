// Domain constants shared by resident-app and admin-app.
// Values here were lifted verbatim from the single-codebase prototype; nothing
// is new. If a value appears in only one app, it belongs in that app instead.

/* ── Status pipeline ─────────────────────────────────────────────────────── */

/** Ordered report lifecycle. Index position is the pipeline stage. */
export const STATUS_PIPELINE = ["received", "assigned", "in_progress", "resolved"];

/**
 * Human labels for every status, pipeline and terminal alike.
 *
 * The two closed labels are written out in full rather than both shortened to
 * "Closed". A resident who confirmed the work and a resident who never replied
 * are different outcomes, and the label is where that difference is visible to
 * the person it happened to.
 */
export const STATUS_LABELS = {
  received: "Received",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed_confirmed: "Closed (Confirmed)",
  closed_unconfirmed: "Closed (Unconfirmed)",
  reopened: "Reopened"
};

/** CSS class suffix used by the `.saro-pill-status-*` rules in tokens.css. */
export const STATUS_PILL_CLASS = {
  received: "saro-pill-status-received",
  assigned: "saro-pill-status-assigned",
  in_progress: "saro-pill-status-in_progress",
  resolved: "saro-pill-status-resolved"
};

/** Status that a newly created report always starts in. */
export const INITIAL_STATUS = "received";

/** Status that requires an attached resolution photo before it can be set. */
export const RESOLUTION_MEDIA_REQUIRED_STATUS = "resolved";

/* ── Auto-Archiving ──────────────────────────────────────────────────────── */

/**
 * Resolved and Closed reports stop rendering as active map pins after this many hours.
 * Default: 72 hours (3 days). Adjust here to change city-wide threshold.
 */
export const DEFAULT_AUTO_ARCHIVE_HOURS = 72;

/**
 * Evaluates whether a report should be hidden from active live map views.
 *
 * Rules:
 * - Status must be 'resolved', 'closed_confirmed', or 'closed_unconfirmed'.
 * - Age since resolution (resolved_at, updated_at, or created_at) must exceed maxAgeHours.
 * - 'reopened', 'received', 'assigned', and 'in_progress' reports are NEVER archived.
 *
 * @param {object} report
 * @param {number} maxAgeHours Default 72 hours
 * @returns {boolean}
 */
export function isArchivedReport(report, maxAgeHours = DEFAULT_AUTO_ARCHIVE_HOURS) {
  if (!report) return false;
  const status = report.status;
  const isResolvedOrClosed =
    status === "resolved" ||
    status === "closed_confirmed" ||
    status === "closed_unconfirmed";

  if (!isResolvedOrClosed) return false;

  const timestamp = report.resolved_at || report.updated_at || report.created_at;
  if (!timestamp) return false;

  const ageMs = Date.now() - new Date(timestamp).getTime();
  const thresholdMs = maxAgeHours * 3600000;
  return ageMs > thresholdMs;
}

/* ── Time-based visibility ───────────────────────────────────────────────────
 *
 * These are judgement calls, not facts, and they are expected to move once the
 * city has real data to argue from. They live together here so changing one is
 * a single edit in a single file, and so nobody has to grep a component tree to
 * discover why a pin disappeared.
 *
 * None of them delete anything. They govern what the live map treats as
 * *currently* active and what the dashboard flags as needing attention; every
 * report stays in Postgres exactly as filed.
 */

/**
 * Hours a fast-moving emergency stays on the live map as an active pin.
 *
 * Panic alerts, gas leaks, fires and active flooding describe a situation that
 * is either handled or gone within a couple of days — a 60-hour-old "fire here"
 * pin is not information, it is clutter that makes the map harder to trust.
 * Whichever comes first, this timer or an office marking it resolved, ends the
 * pin. Applies to EMERGENCY_VISIBILITY_CATEGORIES.
 */
export const REPORT_ACTIVE_HOURS_EMERGENCY = 48;

/**
 * Days a non-emergency infrastructure report may sit without an office status
 * update before it is flagged as stale.
 *
 * A pothole does not stop existing because nobody looked at it, so this never
 * removes the report — it marks it, so an unattended backlog becomes visible
 * instead of quietly ageing. Applies to INFRASTRUCTURE_STALE_CATEGORIES.
 */
export const REPORT_STALE_DAYS_INFRASTRUCTURE = 90;

/**
 * Categories governed by REPORT_ACTIVE_HOURS_EMERGENCY.
 *
 * Deliberately narrower than CRITICAL_CATEGORIES: this is the set whose *hazard
 * itself* expires quickly, not the set that is urgent to answer. A landslide or
 * a damaged seawall is critical to respond to but the hazard persists, so those
 * keep the ordinary archive rule.
 */
export const EMERGENCY_VISIBILITY_CATEGORIES = [
  "emergency_unspecified",  // Panic alerts — same value as PANIC_CATEGORY
  "gas_leak",
  "fire",
  "flood",
];

/**
 * Categories governed by REPORT_STALE_DAYS_INFRASTRUCTURE.
 *
 * `bridge_damage` is deliberately absent: the routing table marks it emergency
 * with a 12-hour SLA, so treating it as a 90-day backlog item would contradict
 * how it is dispatched.
 */
export const INFRASTRUCTURE_STALE_CATEGORIES = [
  "pothole",
  "open_drain",         // Uncovered drain & broken manhole
  "typhoon_debris",     // Typhoon debris & structural damage
];

/** Shown next to a report that has gone past REPORT_STALE_DAYS_INFRASTRUCTURE. */
export const STALE_REPORT_LABEL = "Stale — needs status update";

/* ── Roles ───────────────────────────────────────────────────────────────── */

// "guest" is a client-side label for nobody being signed in — it is not a value
// stored anywhere. The four real roles match the user_role enum.
export const ROLE_GUEST = "guest";
export const ROLE_RESIDENT = "resident";
export const ROLE_ADMIN = "admin";
export const ROLE_OFFICE = "office";
export const ROLE_BARANGAY_OFFICIAL = "barangay_official";

/** Roles that may sign in to admin-app. Deliberately excludes resident. */
export const STAFF_ROLES = [ROLE_ADMIN, ROLE_OFFICE, ROLE_BARANGAY_OFFICIAL];

/* ── Clustering (Turf.js duplicate detection) ────────────────────────────── */

/** Two reports cluster only if within this many metres of each other. */
export const CLUSTER_RADIUS_METERS = 150;

/** ...and only if submitted within this many minutes of each other. */
export const CLUSTER_WINDOW_MINUTES = 60;

/* ── Accident-prone areas ────────────────────────────────────────────────── */

/**
 * Distinct incidents a location needs before SARO draws it as accident-prone.
 *
 * The unit here is *incidents*, not reports. A cluster is four neighbours
 * phoning in the same crash within the hour — corroboration of one event, not
 * evidence that a road is dangerous. Marking a stretch of Rizal Avenue as
 * accident-prone is a claim about recurrence, so it is counted from
 * `incident_count`: separate crashes at the same place over time.
 *
 * Three is the conventional floor in road-safety practice — a site qualifies as
 * a blackspot at roughly three injury accidents in three years, and below that
 * two events at one spot are not distinguishable from coincidence. Raise it to
 * 5 to flag only the worst sites once the city has a few years of data.
 */
export const MIN_INCIDENTS_FOR_ACCIDENT_AREA = 3;

/**
 * Trailing window the incident count is measured over.
 *
 * MIN_INCIDENTS_FOR_ACCIDENT_AREA answers "how many", this answers "since when",
 * and without it the threshold is an all-time tally that can only ever grow. A
 * junction fixed with a new signal in 2023 would stay branded accident-prone
 * forever on the strength of crashes that its redesign already solved, and the
 * map would slowly fill with places that used to be dangerous.
 *
 * Twenty-four months is long enough to gather three incidents at a genuinely
 * bad site, and short enough that a completed remediation shows up as the
 * marking clearing within two years. Incidents older than this are excluded
 * from the count but are never deleted — they stay in the database in full, and
 * widening the window brings them straight back into consideration.
 */
export const ACCIDENT_ROLLING_WINDOW_MONTHS = 24;

/* ── Tracking codes ──────────────────────────────────────────────────────── */

export const TRACKING_CODE_PREFIX = "SR-";
export const TRACKING_CODE_LENGTH = 4;

/** Ambiguous glyphs (0/O/1/I) deliberately excluded — codes get read aloud. */
export const TRACKING_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/* ── Media ───────────────────────────────────────────────────────────────── */

export const MEDIA_KIND_EVIDENCE = "evidence";
export const MEDIA_KIND_RESOLUTION = "resolution";

/* ── Geography ───────────────────────────────────────────────────────────── */

/** Legazpi City map centre. Shared by every Leaflet surface in both apps. */
export const LEGAZPI_CENTER = [13.1391, 123.7438];

/* ── Fallback routing ────────────────────────────────────────────────────── */

/** Office a report falls back to when its category has no office_id. */
export const DEFAULT_OFFICE_ID = "off1_cdrrmo";

/* ── localStorage / sessionStorage keys ──────────────────────────────────── */

/** Keys owned by the mock data layer (future Supabase tables). */
export const STORAGE_KEYS = {
  OFFICES: "saro_mock_offices",
  CATEGORIES: "saro_mock_categories",
  BARANGAYS: "saro_mock_barangays",
  PROFILES: "saro_mock_profiles",
  REPORTS: "saro_mock_reports",
  REPORT_MEDIA: "saro_mock_media",
  STATUS_HISTORY: "saro_mock_status_history",
  ASSISTANT_LOGS: "saro_mock_assistant_logs",
  DEVICES: "saro_mock_devices"
};

/** Keys owned by the client apps rather than the data layer. */
export const CLIENT_STORAGE_KEYS = {
  AUTH_PROFILE: "saro_auth_profile",
  DEVICE_FINGERPRINT: "saro_device_fp",
  OFFLINE_QUEUE: "saro_offline_queue",
  UNAUTH_VIEW: "saro_unauth_view",
  RESIDENT_LOGGED_OUT: "saro_resident_logged_out",
  /** Version of the RA 10173 notice this device has acknowledged. */
  CONSENT_ACK: "saro_consent_ack",
  /** Timestamp of the last Panic press, for the local 15-minute repeat check. */
  PANIC_LAST_AT: "saro_panic_last_at",
  PERMISSION_PRIMING_DONE: "saro_perm_priming_done",
  PERMISSIONS_STATE: "saro_permissions_state"
};

/* ── Data privacy notice ─────────────────────────────────────────────────── */

/**
 * Bump when the notice's substance changes — what is collected, why, how long
 * it is kept, or who receives it. Everyone re-acknowledges. Do not bump for
 * wording or layout: retraining people to dismiss a notice without reading it
 * is worse than a stale acknowledgement of an unchanged fact.
 */
export const CONSENT_VERSION = 1;

/* ── Emergency SOS ───────────────────────────────────────────────────────────
 *
 * The button residents press is called Emergency SOS. It was called Panic, and
 * the database still is — `panic_flags`, `register_panic_flag` — because
 * renaming live RPCs and their grants is a migration with real risk and no user
 * benefit. Code and copy use SOS; the storage layer keeps its old names, and
 * this comment is the map between them.
 */

/** National emergency number. Legazpi's 911 Emergency Action Center answers it. */
export const EMERGENCY_NUMBER = "911";

/**
 * A second SOS inside this window is surfaced for review. It never blocks.
 *
 * The usual meaning of a rapid repeat is that the first alert brought nobody —
 * so it is read as an unanswered call, not as suspicion of the caller.
 */
export const SOS_REPEAT_WINDOW_MS = 15 * 60 * 1000;

/** Old name. Kept so nothing importing it breaks mid-rename. */
export const PANIC_REPEAT_WINDOW_MS = SOS_REPEAT_WINDOW_MS;

/** Category every SOS press files under. Routed to Legazpi 911, 1-hour SLA. */
export const SOS_CATEGORY = "emergency_unspecified";

/** Old name, same value. */
export const PANIC_CATEGORY = SOS_CATEGORY;

/* ── Closure states ──────────────────────────────────────────────────────── */

/**
 * The four pipeline stages a report moves through while it is live. Closure
 * states are deliberately NOT in this list: they are outcomes, not steps, and
 * rendering them as a fifth dot would suggest "closed" is progress rather than
 * an ending that may have been good or bad.
 */
export const CLOSED_STATUSES = ["closed_confirmed", "closed_unconfirmed"];

/** Every terminal or post-resolution state. */
export const POST_RESOLUTION_STATUSES = [...CLOSED_STATUSES, "reopened"];

/** Days a resolved report waits for the resident before closing unconfirmed. */
export const AUTO_CLOSE_DAYS = 7;

/* ── Closure proof ───────────────────────────────────────────────────────── */

/**
 * Why a non-photographable report was closed.
 *
 * Mirrors the `resolution_reason` enum in migration 16. These exist so closures
 * are countable across offices — "how many medical calls ended in
 * 'could not locate' last quarter?" is a question the city should be able to
 * answer, and free text can never answer it. A reference note is required
 * alongside the code, because a code alone loses every specific.
 */
export const RESOLUTION_REASONS = [
  { value: "turned_over_to_unit", label: "Turned over to responding unit" },
  { value: "referred_to_office", label: "Referred to another office" },
  { value: "patient_transported", label: "Patient transported" },
  { value: "attended_no_action", label: "Attended, no further action needed" },
  { value: "could_not_locate", label: "Could not locate / no one at scene" },
  { value: "false_alarm", label: "False alarm — nothing found" },
  { value: "duplicate", label: "Duplicate of another report" },
];

export const RESOLUTION_REASON_LABELS = Object.fromEntries(
  RESOLUTION_REASONS.map((r) => [r.value, r.label])
);

/** Statuses an official may set. The rest belong to the resident and the timer. */
export const OFFICIAL_SETTABLE_STATUSES = ["received", "assigned", "in_progress", "resolved"];
