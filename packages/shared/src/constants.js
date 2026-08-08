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
  PANIC_LAST_AT: "saro_panic_last_at"
};

/* ── Data privacy notice ─────────────────────────────────────────────────── */

/**
 * Bump when the notice's substance changes — what is collected, why, how long
 * it is kept, or who receives it. Everyone re-acknowledges. Do not bump for
 * wording or layout: retraining people to dismiss a notice without reading it
 * is worse than a stale acknowledgement of an unchanged fact.
 */
export const CONSENT_VERSION = 1;

/* ── Panic ───────────────────────────────────────────────────────────────── */

/** National emergency number. Legazpi's 911 Emergency Action Center answers it. */
export const EMERGENCY_NUMBER = "911";

/** A second press inside this window is flagged for dispatchers. Never blocks. */
export const PANIC_REPEAT_WINDOW_MS = 15 * 60 * 1000;

/** Category every Panic press files under. Routed to Legazpi 911, 1-hour SLA. */
export const PANIC_CATEGORY = "emergency_unspecified";

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
