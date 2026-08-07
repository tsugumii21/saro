// @saro/shared — the only module either app may import across the /apps boundary.
//
// Contains: the data-access client, auth context, domain constants, validation
// schemas, i18n dictionaries, and JSDoc types. Design tokens ship as CSS at
// "@saro/shared/styles/tokens.css".

/* ── Data access client (mock layer; Supabase-shaped) ────────────────────── */
export {
  resetMockData,
  getOffices,
  getCategories,
  getBarangays,
  getProfile,
  getReports,
  getReportByTrackingCode,
  createReport,
  updateReportStatus,
  logAssistantQuestion,
  getStatusHistory,
  addReportMedia,
  getReportMedia,
  updateCategory,
  markFalseReport,
  getAssistantLogs,
  authenticateProfile,
  getReportsByReporter,
  addKnowledgeBaseEntry
} from "./api/index.js";

export { mockEvents } from "./api/events.js";

/* ── Seed datasets ───────────────────────────────────────────────────────── */
export {
  SEED_OFFICES,
  SEED_CATEGORIES,
  SEED_BARANGAYS,
  SEED_PROFILES,
  SEED_REPORTS,
  SEED_REPORT_MEDIA,
  SEED_STATUS_HISTORY,
  SEED_ASSISTANT_LOGS,
  SEED_DEVICES,
  SEED_KNOWLEDGE_BASE
} from "./api/data.js";

/* ── Auth ────────────────────────────────────────────────────────────────── */
export { AuthProvider, useAuth } from "./auth/AuthContext.jsx";

/* ── Constants, validation, i18n ─────────────────────────────────────────── */
export * from "./constants.js";
export * from "./validation.js";
export { DICTIONARIES, useTranslation } from "./i18n.js";
