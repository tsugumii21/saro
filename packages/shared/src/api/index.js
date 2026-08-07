// Single Data Access Surface for SARO Mock Data Layer

import { distance, point } from "@turf/turf";
import {
  SEED_OFFICES,
  SEED_CATEGORIES,
  SEED_BARANGAYS,
  SEED_PROFILES,
  SEED_REPORTS,
  SEED_REPORT_MEDIA,
  SEED_STATUS_HISTORY,
  SEED_ASSISTANT_LOGS,
  SEED_DEVICES
} from "./data.js";
import { mockEvents } from "./events.js";
import {
  STORAGE_KEYS,
  CLUSTER_RADIUS_METERS,
  CLUSTER_WINDOW_MINUTES,
  TRACKING_CODE_ALPHABET,
  TRACKING_CODE_LENGTH,
  TRACKING_CODE_PREFIX,
  INITIAL_STATUS,
  RESOLUTION_MEDIA_REQUIRED_STATUS,
  MEDIA_KIND_EVIDENCE,
  MEDIA_KIND_RESOLUTION,
  DEFAULT_OFFICE_ID
} from "../constants.js";
import { normalizeTrackingCode } from "../validation.js";

// Storage Helpers
function readStorage(key, seedDefault) {
  if (typeof localStorage === "undefined") return seedDefault;
  const raw = localStorage.getItem(key);
  if (!raw) {
    localStorage.setItem(key, JSON.stringify(seedDefault));
    return seedDefault;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${key} from storage:`, err);
    return seedDefault;
  }
}

function writeStorage(key, data) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(key, JSON.stringify(data));
  }
}

// Reset Storage to Seed Data
export async function resetMockData() {
  try {
    writeStorage(STORAGE_KEYS.OFFICES, SEED_OFFICES);
    writeStorage(STORAGE_KEYS.CATEGORIES, SEED_CATEGORIES);
    writeStorage(STORAGE_KEYS.BARANGAYS, SEED_BARANGAYS);
    writeStorage(STORAGE_KEYS.PROFILES, SEED_PROFILES);
    writeStorage(STORAGE_KEYS.REPORTS, SEED_REPORTS);
    writeStorage(STORAGE_KEYS.REPORT_MEDIA, SEED_REPORT_MEDIA);
    writeStorage(STORAGE_KEYS.STATUS_HISTORY, SEED_STATUS_HISTORY);
    writeStorage(STORAGE_KEYS.ASSISTANT_LOGS, SEED_ASSISTANT_LOGS);
    writeStorage(STORAGE_KEYS.DEVICES, SEED_DEVICES);
    return { data: { success: true }, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// Generate Unique Tracking Code e.g. "SR-8F2K"
function generateTrackingCode(existingReports = []) {
  const chars = TRACKING_CODE_ALPHABET; // ambiguous chars already excluded
  let code = "";
  let isUnique = false;

  while (!isUnique) {
    let rand = "";
    for (let i = 0; i < TRACKING_CODE_LENGTH; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code = `${TRACKING_CODE_PREFIX}${rand}`;
    isUnique = !existingReports.some((r) => r.tracking_code === code);
  }
  return code;
}

/* =========================================================================
 * DATA ACCESS API FUNCTIONS (All return { data, error })
 * ========================================================================= */

// 1. Get Offices
export async function getOffices() {
  try {
    const offices = readStorage(STORAGE_KEYS.OFFICES, SEED_OFFICES);
    return { data: offices, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 2. Get Categories
export async function getCategories() {
  try {
    const categories = readStorage(STORAGE_KEYS.CATEGORIES, SEED_CATEGORIES);
    return { data: categories, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 3. Get Barangays
export async function getBarangays() {
  try {
    const barangays = readStorage(STORAGE_KEYS.BARANGAYS, SEED_BARANGAYS);
    return { data: barangays, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 4. Get Profile by ID
export async function getProfile(userId) {
  try {
    const profiles = readStorage(STORAGE_KEYS.PROFILES, SEED_PROFILES);
    const profile = profiles.find((p) => p.id === userId) || null;
    if (!profile) {
      return { data: null, error: `Profile not found for ID: ${userId}` };
    }
    return { data: profile, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 5. Get Reports with optional officeId and status filtering
export async function getReports({ officeId, status } = {}) {
  try {
    let reports = readStorage(STORAGE_KEYS.REPORTS, SEED_REPORTS);

    if (officeId) {
      reports = reports.filter((r) => r.office_id === officeId);
    }
    if (status) {
      reports = reports.filter((r) => r.status === status);
    }

    return { data: reports, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 6. Get Report by Tracking Code
export async function getReportByTrackingCode(code) {
  try {
    if (!code) {
      return { data: null, error: "Tracking code is required" };
    }
    const reports = readStorage(STORAGE_KEYS.REPORTS, SEED_REPORTS);
    const formattedCode = normalizeTrackingCode(code);
    const report = reports.find((r) => r.tracking_code === formattedCode);

    if (!report) {
      return { data: null, error: `No report found matching tracking code "${code}"` };
    }
    return { data: report, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 7. Create New Report (with Turf.js Clustering & Device Upsert)
export async function createReport(payload) {
  try {
    const reports = readStorage(STORAGE_KEYS.REPORTS, SEED_REPORTS);
    const categories = readStorage(STORAGE_KEYS.CATEGORIES, SEED_CATEGORIES);
    const devices = readStorage(STORAGE_KEYS.DEVICES, SEED_DEVICES);

    const now = new Date();
    const timestamp = now.toISOString();

    // Determine target office from category
    const category = categories.find((c) => c.id === payload.category_id);
    const office_id = payload.office_id || category?.office_id || DEFAULT_OFFICE_ID;

    const newReportId = `rep_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const trackingCode = generateTrackingCode(reports);

    const newLat = parseFloat(payload.lat);
    const newLng = parseFloat(payload.lng);

    // --- Turf.js Clustering Logic ---
    // Reports within CLUSTER_RADIUS_METERS, same category_id, inside CLUSTER_WINDOW_MINUTES
    let clusterId = null;
    let confidenceScore = 1;
    const newPt = point([newLng, newLat]);

    const matchingClusterCandidates = reports.filter((r) => {
      if (r.category_id !== payload.category_id) return false;
      const reportTime = new Date(r.created_at).getTime();
      const timeDiffMinutes = Math.abs(now.getTime() - reportTime) / (1000 * 60);
      if (timeDiffMinutes > CLUSTER_WINDOW_MINUTES) return false;

      const existingPt = point([r.lng, r.lat]);
      const distMeters = distance(newPt, existingPt, { units: "meters" });
      return distMeters <= CLUSTER_RADIUS_METERS;
    });

    if (matchingClusterCandidates.length > 0) {
      // Reuse existing cluster_id if available, or create new one
      const existingCluster = matchingClusterCandidates.find((c) => c.cluster_id);
      clusterId = existingCluster ? existingCluster.cluster_id : `cluster_${Date.now()}`;
      confidenceScore = matchingClusterCandidates.length + 1;

      // Update ALL existing reports in storage sharing that cluster_id or candidate set with new confidence_score & cluster_id
      const updatedClusterMembers = [];
      reports.forEach((r) => {
        if ((r.cluster_id && r.cluster_id === clusterId) || matchingClusterCandidates.some((c) => c.id === r.id)) {
          r.cluster_id = clusterId;
          r.confidence_score = confidenceScore;
          updatedClusterMembers.push(r);
        }
      });

      // Write updated reports back to localStorage immediately
      writeStorage(STORAGE_KEYS.REPORTS, reports);

      // Emit report:updated for EVERY member of the cluster so all UI & open tabs refresh
      updatedClusterMembers.forEach((r) => {
        mockEvents.emit("report:updated", { report: r });
      });
    }

    const newReport = {
      id: newReportId,
      tracking_code: trackingCode,
      category_id: payload.category_id,
      office_id: office_id,
      description: payload.description || "",
      lat: newLat,
      lng: newLng,
      barangay_id: payload.barangay_id || null,
      status: INITIAL_STATUS,
      reporter_id: payload.reporter_id || null,
      callback_number: payload.callback_number || null,
      device_fingerprint: payload.device_fingerprint || "dev_anon",
      is_proxy_report: Boolean(payload.is_proxy_report),
      cluster_id: clusterId,
      confidence_score: confidenceScore,
      is_false_report: false,
      created_at: timestamp,
      resolved_at: null
    };

    reports.unshift(newReport);
    writeStorage(STORAGE_KEYS.REPORTS, reports);

    // --- Upsert Device Table ---
    const devFp = newReport.device_fingerprint;
    const devIndex = devices.findIndex((d) => d.fingerprint === devFp);
    if (devIndex >= 0) {
      devices[devIndex].report_count_24h = (devices[devIndex].report_count_24h || 0) + 1;
    } else {
      devices.push({
        id: `dev_${Date.now()}`,
        fingerprint: devFp,
        report_count_24h: 1,
        flagged: false,
        created_at: timestamp
      });
    }
    writeStorage(STORAGE_KEYS.DEVICES, devices);

    // Emit event
    mockEvents.emit("report:created", { report: newReport });

    return { data: newReport, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 8. Update Report Status (With RLS Policy Enforcement, Resolution Photo Check & History Entry)
export async function updateReportStatus(reportId, newStatus, note, actingProfileId) {
  try {
    const reports = readStorage(STORAGE_KEYS.REPORTS, SEED_REPORTS);
    const profiles = readStorage(STORAGE_KEYS.PROFILES, SEED_PROFILES);
    const history = readStorage(STORAGE_KEYS.STATUS_HISTORY, SEED_STATUS_HISTORY);

    // 1. Fetch acting profile
    const actingProfile = profiles.find((p) => p.id === actingProfileId);
    if (!actingProfile) {
      return { data: null, error: "Unauthorized: Invalid or missing acting profile ID." };
    }

    // 2. Fetch target report
    const targetReport = reports.find((r) => r.id === reportId);
    if (!targetReport) {
      return { data: null, error: `Report not found: ${reportId}` };
    }

    // 3. RLS Policy Enforcement
    const isOfficeMatch = actingProfile.office_id === targetReport.office_id;
    const isCoordinator = Boolean(actingProfile.is_coordinator);

    if (!isOfficeMatch && !isCoordinator) {
      return {
        data: null,
        error: `Permission Denied (RLS Violation): Responder profile "${actingProfile.full_name}" from office "${actingProfile.office_id}" cannot modify reports assigned to office "${targetReport.office_id}".`
      };
    }

    // 4. FIX 4: Resolution Photo Requirement Check
    if (newStatus === RESOLUTION_MEDIA_REQUIRED_STATUS) {
      const media = readStorage(STORAGE_KEYS.REPORT_MEDIA, SEED_REPORT_MEDIA);
      const hasResolutionMedia = media.some((m) => m.report_id === reportId && m.kind === MEDIA_KIND_RESOLUTION);
      if (!hasResolutionMedia) {
        return {
          data: null,
          error: `Resolution photo required: Cannot update report "${reportId}" to status "resolved" without an attached resolution photo.`
        };
      }
    }

    const timestamp = new Date().toISOString();
    const fromStatus = targetReport.status;

    // Apply status update
    targetReport.status = newStatus;
    if (newStatus === "resolved") {
      targetReport.resolved_at = timestamp;
    }

    writeStorage(STORAGE_KEYS.REPORTS, reports);

    // Automatically write report_status_history entry
    const historyEntry = {
      id: `hist_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      report_id: reportId,
      from_status: fromStatus,
      to_status: newStatus,
      changed_by: actingProfileId,
      note: note || `Status changed from ${fromStatus} to ${newStatus}.`,
      created_at: timestamp
    };

    history.push(historyEntry);
    writeStorage(STORAGE_KEYS.STATUS_HISTORY, history);

    // Emit event
    mockEvents.emit("report:updated", { report: targetReport, history: historyEntry });

    return { data: targetReport, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 9. Log Assistant Question
export async function logAssistantQuestion(question, wasAnswered, matchedDoc) {
  try {
    const logs = readStorage(STORAGE_KEYS.ASSISTANT_LOGS, SEED_ASSISTANT_LOGS);
    const timestamp = new Date().toISOString();

    const newLog = {
      id: `log_${Date.now()}`,
      question: question || "",
      was_answered: Boolean(wasAnswered),
      matched_doc: matchedDoc || null,
      created_at: timestamp
    };

    logs.push(newLog);
    writeStorage(STORAGE_KEYS.ASSISTANT_LOGS, logs);

    return { data: newLog, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 10. Get Status History for a Report
export async function getStatusHistory(reportId) {
  try {
    const history = readStorage(STORAGE_KEYS.STATUS_HISTORY, SEED_STATUS_HISTORY);
    let entries = history
      .filter((h) => h.report_id === reportId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Fallback: If no history recorded yet for seeded report, synthesize steps
    if (entries.length === 0) {
      const reports = readStorage(STORAGE_KEYS.REPORTS, SEED_REPORTS);
      const offices = readStorage(STORAGE_KEYS.OFFICES, SEED_OFFICES);
      const rep = reports.find((r) => r.id === reportId);
      if (rep) {
        const createdMs = new Date(rep.created_at).getTime();
        const officeName = offices.find((o) => o.id === rep.office_id)?.short_name || "Assigned Department";
        
        entries = [
          {
            id: `synth_${rep.id}_1`,
            report_id: rep.id,
            from_status: "received",
            to_status: "received",
            note: "Report submitted via SARO Civic Portal.",
            created_at: new Date(createdMs).toISOString()
          }
        ];

        if (rep.status === "assigned" || rep.status === "in_progress" || rep.status === "resolved") {
          entries.push({
            id: `synth_${rep.id}_2`,
            report_id: rep.id,
            from_status: "received",
            to_status: "assigned",
            note: `Auto-routed to ${officeName} based on hazard classification.`,
            created_at: new Date(createdMs + 1000 * 60 * 5).toISOString()
          });
        }

        if (rep.status === "in_progress" || rep.status === "resolved") {
          entries.push({
            id: `synth_${rep.id}_3`,
            report_id: rep.id,
            from_status: "assigned",
            to_status: "in_progress",
            note: `Dispatch team from ${officeName} deployed to location.`,
            created_at: new Date(createdMs + 1000 * 60 * 18).toISOString()
          });
        }

        if (rep.status === "resolved") {
          entries.push({
            id: `synth_${rep.id}_4`,
            report_id: rep.id,
            from_status: "in_progress",
            to_status: "resolved",
            note: "Incident resolved and verified with photographic evidence.",
            created_at: rep.resolved_at || new Date(createdMs + 1000 * 60 * 45).toISOString()
          });
        }
      }
    }

    return { data: entries, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 11. Add Report Media (evidence or resolution photo)
export async function addReportMedia(reportId, dataUrl, kind = MEDIA_KIND_EVIDENCE) {
  try {
    const media = readStorage(STORAGE_KEYS.REPORT_MEDIA, SEED_REPORT_MEDIA);
    const entry = {
      id: `media_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      report_id: reportId,
      data_url: dataUrl,
      kind: kind
    };
    media.push(entry);
    writeStorage(STORAGE_KEYS.REPORT_MEDIA, media);
    return { data: entry, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 12. Get Report Media
export async function getReportMedia(reportId) {
  try {
    const media = readStorage(STORAGE_KEYS.REPORT_MEDIA, SEED_REPORT_MEDIA);
    const entries = media.filter((m) => m.report_id === reportId);
    return { data: entries, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 13. Update Category (Routing Table: office_id and sla_hours)
export async function updateCategory(categoryId, updates) {
  try {
    const categories = readStorage(STORAGE_KEYS.CATEGORIES, SEED_CATEGORIES);
    const target = categories.find((c) => c.id === categoryId);
    if (!target) {
      return { data: null, error: `Category not found: ${categoryId}` };
    }
    if (updates.office_id !== undefined) target.office_id = updates.office_id;
    if (updates.sla_hours !== undefined) target.sla_hours = Number(updates.sla_hours);
    writeStorage(STORAGE_KEYS.CATEGORIES, categories);
    mockEvents.emit("category:updated", { category: target });
    return { data: target, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 14. FIX 3: Mark Report as False Report (With RLS & History Entry)
export async function markFalseReport(reportId, actingProfileId, isFalse = true) {
  try {
    const reports = readStorage(STORAGE_KEYS.REPORTS, SEED_REPORTS);
    const profiles = readStorage(STORAGE_KEYS.PROFILES, SEED_PROFILES);
    const history = readStorage(STORAGE_KEYS.STATUS_HISTORY, SEED_STATUS_HISTORY);

    // 1. Fetch acting profile
    const actingProfile = profiles.find((p) => p.id === actingProfileId);
    if (!actingProfile) {
      return { data: null, error: "Unauthorized: Invalid or missing acting profile ID." };
    }

    // 2. Fetch target report
    const targetReport = reports.find((r) => r.id === reportId);
    if (!targetReport) {
      return { data: null, error: `Report not found: ${reportId}` };
    }

    // 3. RLS Check: acting profile's office_id must match OR profile is coordinator
    const isOfficeMatch = actingProfile.office_id === targetReport.office_id;
    const isCoordinator = Boolean(actingProfile.is_coordinator);

    if (!isOfficeMatch && !isCoordinator) {
      return {
        data: null,
        error: `Permission Denied (RLS Violation): Responder profile "${actingProfile.full_name}" from office "${actingProfile.office_id}" cannot modify reports assigned to office "${targetReport.office_id}".`
      };
    }

    targetReport.is_false_report = Boolean(isFalse);
    writeStorage(STORAGE_KEYS.REPORTS, reports);

    // Audit trail in report_status_history
    const timestamp = new Date().toISOString();
    const historyEntry = {
      id: `hist_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      report_id: reportId,
      from_status: targetReport.status,
      to_status: targetReport.status,
      changed_by: actingProfileId,
      note: isFalse ? "Report marked as verified false report." : "Report unflagged as false report.",
      created_at: timestamp
    };

    history.push(historyEntry);
    writeStorage(STORAGE_KEYS.STATUS_HISTORY, history);

    mockEvents.emit("report:updated", { report: targetReport, history: historyEntry });

    return { data: targetReport, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 15. Get Assistant Logs (for Admin unanswered-questions panel)
export async function getAssistantLogs() {
  try {
    const logs = readStorage(STORAGE_KEYS.ASSISTANT_LOGS, SEED_ASSISTANT_LOGS);
    return { data: logs, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 16. Authenticate Profile (Instant demo authentication)
export async function authenticateProfile(profileId, password) {
  try {
    const profiles = readStorage(STORAGE_KEYS.PROFILES, SEED_PROFILES);
    let profile = profiles.find((p) => p.id === profileId);
    if (!profile) {
      profile = SEED_PROFILES.find((p) => p.id === profileId) || SEED_PROFILES[0];
    }
    const { password: _pw, ...safeProfile } = profile;
    return { data: safeProfile, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 17. Get Reports by Reporter ID (for Track screen recent reports)
export async function getReportsByReporter(reporterId) {
  try {
    if (!reporterId) return { data: [], error: null };
    const reports = readStorage(STORAGE_KEYS.REPORTS, SEED_REPORTS);
    const filtered = reports
      .filter((r) => r.reporter_id === reporterId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { data: filtered, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// 18. Add Knowledge Base Entry (for Admin unanswered questions panel)
export async function addKnowledgeBaseEntry(question, answer, category) {
  try {
    // In a real implementation this would update the knowledge-base.json or a DB table
    // For the mock layer we just log the addition
    const logs = readStorage(STORAGE_KEYS.ASSISTANT_LOGS, SEED_ASSISTANT_LOGS);
    // Mark matching unanswered logs as answered
    let updated = 0;
    logs.forEach((log) => {
      if (!log.was_answered) {
        const qLower = log.question.toLowerCase();
        const words = question.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const overlap = words.filter((w) => qLower.includes(w)).length;
        if (overlap >= 2) {
          log.was_answered = true;
          log.matched_doc = `kb_manual_${Date.now()}`;
          updated++;
        }
      }
    });
    writeStorage(STORAGE_KEYS.ASSISTANT_LOGS, logs);
    mockEvents.emit("report:updated", {}); // trigger UI refresh
    return { data: { updated, question, answer, category }, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}
