import { getCategoryTier } from "./categoryTiers.js";

/**
 * Jurisdiction — who is allowed to see which reports.
 *
 * Postgres is the boundary. Row Level Security in
 * `20260807000500_rls_policies.sql` already scopes `reports` by role: an office
 * sees rows assigned to it, a barangay official sees rows inside their
 * barangay, an admin sees everything. Nothing here can widen that, and nothing
 * here should be trusted to narrow it either.
 *
 * This module exists for two reasons that RLS cannot cover:
 *
 *   1. Demo data never reaches Postgres. `getReports()` falls back to rows held
 *      in the browser when a live query returns nothing, and those rows arrive
 *      unfiltered because no policy ever ran. During the pilot that fallback is
 *      what a barangay captain actually sees, so it has to be scoped here or it
 *      is not scoped at all.
 *
 *   2. Screens forgot. Dispatch filtered by hand; Evidence, Analytics and the
 *      Live Map read the same rows and did not. One shared filter that every
 *      screen passes through is harder to forget than a rule each screen has to
 *      remember.
 *
 * So: RLS is the lock, this is the label on the door. Both, always.
 */

/** No profile, no scope. A viewer with no role sees no report. */
export const NO_SCOPE = Object.freeze({
  role: null,
  officeId: null,
  barangayId: null,
  isCoordinator: false,
});

/**
 * Build a viewer's scope from their profile.
 *
 * @param {object|null} profile A row from `profiles_with_scope`.
 */
export function makeViewerScope(profile) {
  if (!profile?.role) return NO_SCOPE;
  return {
    role: profile.role,
    officeId: profile.office_id ?? null,
    barangayId: profile.barangay_id ?? null,
    /* CDRRMO coordinates a citywide response, so it reads every emergency-tier
       hazard even when the ticket belongs to BFP or PNP. Read only: coordinating
       is not the same as closing somebody else's job. */
    isCoordinator: Boolean(profile.is_coordinator),
  };
}

/**
 * Is this report an emergency, by the same test Postgres uses?
 *
 * `routing_table.is_emergency` is the authority — the RLS policy for
 * coordinators reads exactly that column, so re-classifying a category in the
 * routing table re-scopes both sides at once. The tier lists are the fallback
 * for rows that arrive without their routing join (demo data, map projections).
 */
function isEmergencyReport(report) {
  const flagged = report?.routing_table?.is_emergency ?? report?.is_emergency;
  if (typeof flagged === "boolean") return flagged;
  return ["critical", "urgent"].includes(getCategoryTier(report?.category_id || report?.category));
}

/** Can this viewer see this one report? The single rule every screen shares. */
export function canViewReport(scope, report) {
  if (!scope?.role || !report) return false;

  switch (scope.role) {
    case "admin":
      return true;

    case "office": {
      const assigned =
        report.assigned_office_id ??
        report.office_id ??
        report.offices?.id ??
        null;
      if (assigned && String(assigned) === String(scope.officeId)) return true;
      /* The coordinator's extra sight, and its limit: emergency hazards only. A
         pothole in another office's queue is not a coordination problem. */
      return Boolean(scope.isCoordinator && isEmergencyReport(report));
    }

    case "barangay_official": {
      const reportBarangay =
        report.barangay_id ?? report.barangays?.id ?? null;
      /* Matching on id, never on name. The demo profiles carried a barangay
         name and a null id, so every id comparison came out false and the
         screens fell through to showing the whole city. */
      if (!scope.barangayId || !reportBarangay) return false;
      return String(reportBarangay) === String(scope.barangayId);
    }

    default:
      return false;
  }
}

/**
 * The same rule over a list. Use this instead of writing the filter again.
 *
 * One deliberate asymmetry: a scope with no role does not filter. Public and
 * resident screens read some of the same helpers with nobody signed in, and
 * those paths are governed by RLS and by the public RPCs, not by this file.
 * A staff screen therefore has to pass `viewerScope` for the filter to bite —
 * which is why the admin screens all pass it explicitly.
 */
export function scopeReports(scope, reports) {
  if (!Array.isArray(reports)) return [];
  if (!scope?.role) return reports;
  if (scope.role === "admin") return reports;
  return reports.filter((report) => canViewReport(scope, report));
}

/**
 * Narrow a Supabase query before it leaves the browser.
 *
 * Redundant with RLS by design: the server would drop these rows anyway, but
 * asking for less means a misconfigured policy cannot quietly hand a barangay
 * official the whole city, and the request itself records what was intended.
 *
 * A coordinator is deliberately not narrowed here — their emergency-tier
 * widening is easier to express as a filter over the result, and RLS still
 * decides what they may have.
 */
export function applyReportScopeToQuery(query, scope) {
  if (!query || !scope?.role) return query;
  if (scope.role === "office" && scope.officeId && !scope.isCoordinator) {
    return query.eq("assigned_office_id", scope.officeId);
  }
  if (scope.role === "barangay_official" && scope.barangayId) {
    return query.eq("barangay_id", scope.barangayId);
  }
  return query;
}

/**
 * Pilot switch for barangay-led dispatch.
 *
 * The agreed sequence: everyone starts at endorse-only, and routine hazards a
 * barangay can genuinely fix — a pothole, a blocked drain, a fallen branch —
 * unlock once the endorsement workflow has proven out in Bitano. Critical and
 * urgent tiers never unlock: a fire or a landslide needs the office with the
 * trucks, and "the barangay marked it resolved" is not the same sentence.
 *
 * Flipping this to true is the whole change. The rule below already knows what
 * to do with it.
 */
export const BARANGAY_LOCAL_DISPATCH_ENABLED = false;

/**
 * May this viewer move this report along the pipeline?
 *
 * Separate from `canViewReport` on purpose: reading and acting are different
 * permissions, and the roles differ in exactly that gap. An admin sees every
 * report and dispatches none of them; a coordinator reads another office's
 * emergency and cannot touch it.
 */
export function canDispatchReport(scope, report) {
  if (!scope?.role || !report) return false;
  if (!canViewReport(scope, report)) return false;

  switch (scope.role) {
    /* Governance, not operations. The city administrator reassigns a misrouted
       report and reads everything; the status belongs to whoever is doing the
       work. Postgres still permits an admin write as a break-glass, and records
       it — this is the rule the interface follows, not a claim about the DB. */
    case "admin":
      return false;

    /* An office dispatches its own queue and only its own. A coordinator's
       extra sight over other offices' emergencies is read-only. */
    case "office": {
      const assigned = report.assigned_office_id ?? report.office_id ?? report.offices?.id ?? null;
      return Boolean(assigned && String(assigned) === String(scope.officeId));
    }

    case "barangay_official":
      return (
        BARANGAY_LOCAL_DISPATCH_ENABLED &&
        getCategoryTier(report.category_id || report.category) === "routine"
      );

    default:
      return false;
  }
}

/** May this viewer add a signed local note to this report? */
export function canEndorseReport(scope, report) {
  if (scope?.role !== "barangay_official") return false;
  return canViewReport(scope, report);
}

/** May this viewer move this report to a different office? */
export function canReassignReport(scope) {
  return scope?.role === "admin";
}

/** What to print above a scoped list, so nobody mistakes a slice for the city. */
export function describeScope(scope, { officeName, barangayName } = {}) {
  if (!scope?.role) return "No access";
  if (scope.role === "admin") return "City-wide";
  if (scope.role === "office") {
    const base = officeName || "Your office";
    return scope.isCoordinator ? `${base} · city-wide emergencies` : base;
  }
  if (scope.role === "barangay_official") {
    return barangayName ? `Brgy. ${barangayName}` : "Your barangay";
  }
  return "No access";
}
