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
  createReportOnBehalf,
  updateReportStatus,
  markFalseReport,
  updateCategory,
  getRoutingChangelog,
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
  // profiles
  getProfile,
} from "./api/index.js";

/* ── Assistant (gemini-proxy Edge Function) ──────────────────────────────── */
export { askAssistant, structureDescription } from "./api/assistant.js";

/* ── Realtime ────────────────────────────────────────────────────────────── */
export { saroEvents, REALTIME_EVENTS } from "./api/events.js";

/* ── Auth ────────────────────────────────────────────────────────────────── */
export { AuthProvider, useAuth } from "./auth/AuthContext.jsx";

/* ── Constants, validation, i18n ─────────────────────────────────────────── */
export * from "./constants.js";
export * from "./validation.js";
export { DICTIONARIES, useTranslation } from "./i18n.js";
