// Shared domain types for SARO, expressed as JSDoc typedefs.
//
// The codebase is plain JavaScript, so these are the contract of record for
// both apps and for the Supabase schema that will replace the mock layer.
// Editors pick them up via `checkJs` in jsconfig.json; nothing is emitted.
//
// This file has no runtime exports on purpose — import it for types only:
//   /** @type {import('@saro/shared/types').Report} */

/**
 * A municipal office that reports can be routed to.
 * @typedef {Object} Office
 * @property {string} id
 * @property {string} short_name          Acronym shown in dense staff tables (e.g. "CDRRMO").
 * @property {string} full_name
 * @property {string[]} category_ids      Categories this office owns.
 */

/**
 * A hazard category. Doubles as the routing table row: `office_id` and
 * `sla_hours` are the two fields the admin routing editor writes.
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name
 * @property {string} name_bikol
 * @property {string} name_tagalog
 * @property {string} office_id           Office reports in this category route to.
 * @property {boolean} is_emergency       Emergency categories bypass the guest account gate.
 * @property {number} sla_hours           Target hours to resolution; drives SLA/aging views.
 */

/**
 * A Legazpi City barangay.
 * @typedef {Object} Barangay
 * @property {string} id
 * @property {string} name
 * @property {boolean} is_coastal
 * @property {GeoJSON.Polygon|Object} geo_bounds  Polygon used for point-in-polygon barangay inference.
 */

/**
 * A user account. Guests have no Profile row at all.
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} full_name
 * @property {string} [mobile_number]
 * @property {ProfileRole} role
 * @property {string|null} office_id      Set for responders; null for residents.
 * @property {boolean} is_coordinator     Responder + is_coordinator = admin (city-wide scope).
 * @property {string} created_at          ISO 8601.
 */

/**
 * @typedef {"resident"|"responder"} ProfileRole
 */

/**
 * Effective role used for authorization decisions in the UI. "guest" is derived
 * (no profile), not stored.
 * @typedef {"guest"|"resident"|"responder"} EffectiveRole
 */

/* ── Status pipeline ─────────────────────────────────────────────────────── */

/**
 * The four-stage report lifecycle. Ordered; see STATUS_PIPELINE in constants.js.
 *
 * received   report accepted, not yet owned by an office
 * assigned   routed to an office, not yet acted on
 * in_progress a team is working it
 * resolved   closed — requires an attached resolution photo
 *
 * @typedef {"received"|"assigned"|"in_progress"|"resolved"} ReportStatus
 */

/**
 * One transition in a report's audit trail. Written automatically on every
 * status change and on false-report flagging.
 * @typedef {Object} StatusHistoryEntry
 * @property {string} id
 * @property {string} report_id
 * @property {ReportStatus} from_status
 * @property {ReportStatus} to_status
 * @property {string} [changed_by]        Acting Profile id.
 * @property {string} note
 * @property {string} created_at          ISO 8601.
 */

/* ── Reports ─────────────────────────────────────────────────────────────── */

/**
 * A civic hazard report — the central record of the system.
 * @typedef {Object} Report
 * @property {string} id
 * @property {string} tracking_code       Public lookup handle, e.g. "SR-8F2K".
 * @property {string} category_id
 * @property {string} office_id           Resolved at creation from the category's routing row.
 * @property {string} description
 * @property {number} lat
 * @property {number} lng
 * @property {string|null} barangay_id
 * @property {ReportStatus} status
 * @property {string|null} reporter_id    Profile id, or null for anonymous/guest reports.
 * @property {string|null} callback_number
 * @property {string} device_fingerprint  Local device id; "dev_anon" when unavailable.
 * @property {boolean} is_proxy_report    A resident filed this for a neighbour
 *                                        from their own phone. Forces a callback
 *                                        number. Not the removed admin-side
 *                                        File on Behalf feature.
 * @property {string|null} cluster_id     Set when this report joined a duplicate cluster.
 * @property {number} confidence_score    Member count of the cluster; 1 when unclustered.
 * @property {boolean} is_false_report
 * @property {string} created_at          ISO 8601.
 * @property {string|null} resolved_at    ISO 8601, set when status becomes "resolved".
 */

/**
 * Payload accepted by createReport(). Server-assigned fields are absent.
 * @typedef {Object} ReportDraft
 * @property {string} category_id
 * @property {string} description
 * @property {number|string} lat
 * @property {number|string} lng
 * @property {string|null} [barangay_id]
 * @property {string|null} [reporter_id]
 * @property {string|null} [callback_number]
 * @property {string} [device_fingerprint]
 * @property {boolean} [is_proxy_report]
 * @property {string} [office_id]         Overrides category-based routing.
 */

/**
 * A photo attached to a report.
 * @typedef {Object} ReportMedia
 * @property {string} id
 * @property {string} report_id
 * @property {string} data_url            Base64 JPEG (mock layer); becomes a Storage URL under Supabase.
 * @property {"evidence"|"resolution"} kind
 */

/* ── Clusters ────────────────────────────────────────────────────────────── */

/**
 * A group of near-duplicate reports: same category, within
 * CLUSTER_RADIUS_METERS, within CLUSTER_WINDOW_MINUTES.
 *
 * Not a stored table in the mock layer — it is projected from the `cluster_id`
 * and `confidence_score` columns on Report. Modelled here because both apps
 * reason about it and Supabase will materialise it.
 *
 * @typedef {Object} Cluster
 * @property {string} id                  Matches Report.cluster_id.
 * @property {string} category_id         All members share one category.
 * @property {Report[]} members
 * @property {number} confidence_score    Member count — higher means more corroboration.
 * @property {string} first_reported_at   ISO 8601, earliest member.
 */

/* ── Assistant ───────────────────────────────────────────────────────────── */

/**
 * One question put to the SARO Assistant. Unanswered entries are what the
 * admin "gap log" reads.
 * @typedef {Object} AssistantLog
 * @property {string} id
 * @property {string} question
 * @property {boolean} was_answered
 * @property {string|null} matched_doc     Knowledge base entry id that answered it.
 * @property {string} created_at           ISO 8601.
 */

/**
 * A knowledge base entry backing the Assistant's retrieval.
 * @typedef {Object} KnowledgeBaseEntry
 * @property {string} id
 * @property {string} question
 * @property {string} answer
 * @property {string} category
 * @property {string} [source]
 */

/* ── Devices ─────────────────────────────────────────────────────────────── */

/**
 * Per-device submission counter used for abuse rate limiting.
 * @typedef {Object} Device
 * @property {string} id
 * @property {string} fingerprint
 * @property {number} report_count_24h
 * @property {boolean} flagged
 * @property {string} created_at          ISO 8601.
 */

/* ── API envelope ────────────────────────────────────────────────────────── */

/**
 * Every data-access function returns this shape, matching supabase-js.
 * Exactly one of `data` / `error` is non-null.
 * @template T
 * @typedef {Object} ApiResult
 * @property {T|null} data
 * @property {string|null} error
 */

export {};
