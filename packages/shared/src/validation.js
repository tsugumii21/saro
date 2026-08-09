// Validation schemas shared by resident-app and admin-app.
//
// Every rule and every message here was lifted verbatim from the prototype's
// inline checks — see ReportFormScreen.validate() and the tracking-code
// normalisation inside getReportByTrackingCode(). Nothing new is enforced.
//
// Validators return a plain `{ field: message }` object. Empty object = valid.

import {
  TRACKING_CODE_ALPHABET,
  TRACKING_CODE_LENGTH,
  TRACKING_CODE_PREFIX,
  STATUS_PIPELINE
} from "./constants.js";

/* ── Tracking codes ──────────────────────────────────────────────────────── */

/** Canonical form used for lookups: trimmed and upper-cased. */
export function normalizeTrackingCode(code) {
  if (typeof code !== "string") return "";
  return code.trim().toUpperCase();
}

const TRACKING_CODE_PATTERN = new RegExp(
  `^${TRACKING_CODE_PREFIX}[${TRACKING_CODE_ALPHABET}]{${TRACKING_CODE_LENGTH}}$`
);

/** True when `code` is shaped like a SARO tracking code (e.g. "SR-8F2K"). */
export function isValidTrackingCode(code) {
  return TRACKING_CODE_PATTERN.test(normalizeTrackingCode(code));
}

/* ── Report drafts ───────────────────────────────────────────────────────── */

/**
 * Validate a report before submission.
 *
 * @param {Object} draft
 * @param {string} [draft.categoryId]
 * @param {{lat:number,lng:number}|null} [draft.coords]
 * @param {string} [draft.description]
 * @returns {Record<string,string>} field -> message; empty when valid.
 */
export function validateReportDraft({
  categoryId,
  coords,
  description,
} = {}) {
  const errors = {};
  if (!categoryId) errors.category = "Please select a hazard category.";
  if (!coords) errors.coords = "Please set the location on the map.";
  if (!description || !description.trim()) errors.description = "Please describe what happened.";
  return errors;
}

/* ── Status transitions ──────────────────────────────────────────────────── */

/** True when `status` is one of the four pipeline stages. */
export function isValidStatus(status) {
  return STATUS_PIPELINE.includes(status);
}
