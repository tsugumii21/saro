// Domain constants shared by resident-app and admin-app.
// Values here were lifted verbatim from the single-codebase prototype; nothing
// is new. If a value appears in only one app, it belongs in that app instead.

/* ── Status pipeline ─────────────────────────────────────────────────────── */

/** Ordered report lifecycle. Index position is the pipeline stage. */
export const STATUS_PIPELINE = ["received", "assigned", "in_progress", "resolved"];

/** Human labels for each pipeline stage. */
export const STATUS_LABELS = {
  received: "Received",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved"
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

// Residents are never authenticated — "guest" is a client-side label, not a
// value stored anywhere. The three real roles match the user_role enum.
export const ROLE_GUEST = "guest";
export const ROLE_ADMIN = "admin";
export const ROLE_OFFICE = "office";
export const ROLE_BARANGAY_OFFICIAL = "barangay_official";

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
  LANGUAGE: "saro_lang",
  OFFLINE_QUEUE: "saro_offline_queue",
  UNAUTH_VIEW: "saro_unauth_view",
  RESIDENT_LOGGED_OUT: "saro_resident_logged_out"
};
