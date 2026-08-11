// @saro/shared — the only module either app may import across the /apps boundary.
//
// Contains: the Supabase data client, auth context, domain constants,
// validation schemas, and JSDoc types. Design tokens ship as
// CSS at "@saro/shared/styles/tokens.css".

/* ── Supabase client ─────────────────────────────────────────────────────── */
export { supabase, REPORT_PHOTO_BUCKET } from "./supabase/client.js";

/* ── Data access ─────────────────────────────────────────────────────────── */
export {
  // reference data
  getOffices,
  getCategories,
  getBarangays,
  CRITICAL_CATEGORIES,
  URGENT_CATEGORIES,
  getCategoryTier,
  isEmergencyCategory,
  // resident reads (RPC only)
  getReportByTrackingCode,
  getPublicReport,
  getPublicReportTimeline,
  getStatusHistory,
  getReportsByDevice,
  getMyReports,
  getPublicMapReports,
  getOriginalMapDemoReports,
  // staff reads (RLS scoped)
  getReports,
  getReportById,
  getReportHistory,
  getClusters,
  // writes
  createReport,
  updateSosReportDetails,
  updateReportStatus,
  reassignReport,
  endorseReport,
  deleteReport,
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
  MOCK_LIVE_VOLCANIC_ALERT,
  toggleMockVolcanoFeed,
  isMockVolcanoFeedActive,
  getRainfall,
  getEvacuationCenters,
  setEvacuationOccupancy,
  getAccidentBlackspots,
  getEvacuationRoute,
  // profiles
  getProfile,
  getProfiles,
  updateProfile,
  checkAccountHistory,
  deleteProfile,
  // resident accounts & audit logs
  getResidentAccounts,
  updateResidentProfile,
  deleteResidentAccount,
  getResidentDeletionLogs,
} from "./api/index.js";

/* ── AI (gemini-proxy Edge Function) ─────────────────────────────────────────
 * One client, two modes. Describe's structuring call and the public assistant
 * share it rather than each holding their own integration.
 */
export { askAssistant, polishText } from "./api/proxy.js";

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

/* ── Jurisdiction — the shared answer to "may this viewer see this report?" ── */
export {
  NO_SCOPE,
  BARANGAY_LOCAL_DISPATCH_ENABLED,
  makeViewerScope,
  canViewReport,
  canDispatchReport,
  canEndorseReport,
  canReassignReport,
  scopeReports,
  applyReportScopeToQuery,
  describeScope,
} from "./scope.js";

/* ── Error messages ─────────────────────────────────────────────────────── */
export { humanizeError, humanizeThrown } from "./errors.js";

/* ── Constants and validation ────────────────────────────────────────────── */
export * from "./constants.js";
export * from "./validation.js";

/* ── Emergency routing — category to responding agency to hotline ────────── */
export {
  listEmergencyCategories,
  resolveEmergencyRouting,
  toDialableNumber,
} from "./emergencyRouting.js";

/* ── Time-based visibility — what still counts as "active" or "recent" ───── */
export {
  isReportActiveOnMap,
  isStaleReport,
  daysSinceStatusUpdate,
  hoursSinceFiled,
  isEmergencyVisibilityCategory,
  isInfrastructureStaleCategory,
  countIncidentsInWindow,
  rollingWindowStart,
  evaluateAccidentArea,
  qualifiesAsAccidentArea,
} from "./reportLifecycle.js";

/* ── Map pin grouping — the single source of every "how many reports" number */
export {
  groupReportsIntoPins,
  groupPinsByLocation,
  countReportsByStatus,
  describeCorroboration,
  corroborationLabel,
  getDistanceMeters,
  reportKey,
  assignReportKeys,
} from "./reportGrouping.js";
