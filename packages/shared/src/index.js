// @saro/shared — the only module either app may import across the /apps boundary.
//
// Contains: the Supabase data client, auth context, domain constants,
// validation schemas, i18n dictionaries, and JSDoc types. Design tokens ship as
// CSS at "@saro/shared/styles/tokens.css".

/* ── Supabase client ─────────────────────────────────────────────────────── */
export { supabase, REPORT_PHOTO_BUCKET } from "./supabase/client.js";

/* ── Data access ─────────────────────────────────────────────────────────── */
export {
  // reference data
  getOffices,
  getCategories,
  getBarangays,
  // resident reads (RPC only)
  getReportByTrackingCode,
  getStatusHistory,
  getReportsByDevice,
  getMyReports,
  getPublicMapReports,
  // staff reads (RLS scoped)
  getReports,
  getReportById,
  getReportHistory,
  getClusters,
  // writes
  createReport,
  updateReportStatus,
  markFalseReport,
  updateCategory,
  createRoutingRule,
  deleteRoutingRule,
  getRoutingChangelog,
  // clusters
  getClustersWithReports,
  splitFromCluster,
  // panic abuse review
  getPanicFlags,
  getReportsForDevice,
  // per-location evidence
  getReportsNearPoint,
  // photos
  uploadReportPhoto,
  addReportMedia,
  getReportMedia,
  // assistant gap log
  logAssistantQuestion,
  getAssistantLogs,
  addKnowledgeBaseEntry,
  resolveGapLogEntry,
  // panic
  registerPanicFlag,
  // resident closure actions
  confirmReport,
  disputeReport,
  // hazard overlays
  getHazardZones,
  getVolcanicAlert,
  setVolcanicAlert,
  getRainfall,
  // profiles
  getProfile,
} from "./api/index.js";

/* ── AI (gemini-proxy Edge Function) ─────────────────────────────────────────
 * One client, two modes. Describe's structuring call and the public assistant
 * share it rather than each holding their own integration.
 */
export { askAssistant, structureDescription } from "./api/proxy.js";

/* ── Emergency detection (runs in the browser, before any network call) ──── */
export {
  detectEmergencyInDescription,
  checkEmergencyTripwire,
  EMERGENCY_KEYWORDS,
} from "./emergency.js";

/* ── Offline queue and device-local report list ──────────────────────────── */
export {
  enqueueReport,
  listOutbox,
  outboxCount,
  removeFromOutbox,
  rememberReport,
  listRememberedReports,
  forgetReport,
  updateRememberedStatus,
  setSyncConfig,
} from "./offline/db.js";
export { flushOutbox, startOutboxSync, requestBackgroundSync } from "./offline/sync.js";

/* ── Web Push ────────────────────────────────────────────────────────────── */
export {
  pushSupported,
  pushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  currentPushSubscription,
} from "./push.js";

/* ── Realtime ────────────────────────────────────────────────────────────── */
export { saroEvents, REALTIME_EVENTS } from "./api/events.js";

/* ── Auth ────────────────────────────────────────────────────────────────── */
export { AuthProvider, useAuth } from "./auth/AuthContext.jsx";

/* ── Error messages ─────────────────────────────────────────────────────── */
export { humanizeError, humanizeThrown } from "./errors.js";

/* ── Constants, validation, i18n ─────────────────────────────────────────── */
export * from "./constants.js";
export * from "./validation.js";
export { DICTIONARIES, useTranslation } from "./i18n.js";
