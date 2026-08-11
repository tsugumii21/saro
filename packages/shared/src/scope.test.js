/**
 * Tests for jurisdiction.
 *
 * These pin the rules that decide whether one staff account may read one
 * report. Postgres RLS enforces the same rules on live data, but demo rows
 * never reach Postgres, so on the pilot these functions are the only thing
 * between Brgy. Bitano and Brgy. Bonot's reports — which is exactly how the
 * leak this file guards against happened.
 *
 * Run with:  npm run test:shared
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  makeViewerScope,
  canViewReport,
  canDispatchReport,
  canEndorseReport,
  canReassignReport,
  scopeReports,
  describeScope,
  BARANGAY_LOCAL_DISPATCH_ENABLED,
  NO_SCOPE,
} from "./scope.js";

const bitanoOfficial = makeViewerScope({
  role: "barangay_official",
  barangay_id: "brgy-bitano",
  barangay_name: "Bitano",
});

const engineering = makeViewerScope({
  role: "office",
  office_id: "office-engineering",
  office_name: "City Engineering",
});

const cdrrmo = makeViewerScope({
  role: "office",
  office_id: "office-cdrrmo",
  office_name: "CDRRMO",
  is_coordinator: true,
});

const admin = makeViewerScope({ role: "admin" });

const bitanoPothole = {
  id: "r1",
  category: "pothole",
  barangay_id: "brgy-bitano",
  assigned_office_id: "office-engineering",
};

const bonotPothole = {
  id: "r2",
  category: "pothole",
  barangay_id: "brgy-bonot",
  assigned_office_id: "office-engineering",
};

const bonotFire = {
  id: "r3",
  category: "fire",
  barangay_id: "brgy-bonot",
  assigned_office_id: "office-bfp",
};

test("a barangay official sees their own barangay and no other", () => {
  assert.equal(canViewReport(bitanoOfficial, bitanoPothole), true);
  assert.equal(canViewReport(bitanoOfficial, bonotPothole), false);
  assert.equal(canViewReport(bitanoOfficial, bonotFire), false);
});

test("a barangay profile carrying a name but no id sees nothing", () => {
  // The original bug: demo profiles had barangay_name and a null barangay_id,
  // so id comparisons failed and the screens fell through to the whole city.
  // Failing closed is the only acceptable direction for that mistake.
  const nameOnly = makeViewerScope({
    role: "barangay_official",
    barangay_id: null,
    barangay_name: "Bitano",
  });
  assert.equal(canViewReport(nameOnly, bitanoPothole), false);
});

test("an office sees its own queue regardless of barangay", () => {
  assert.equal(canViewReport(engineering, bitanoPothole), true);
  assert.equal(canViewReport(engineering, bonotPothole), true);
  assert.equal(canViewReport(engineering, bonotFire), false);
});

test("a coordinator reads other offices' emergencies but not their routine work", () => {
  // CDRRMO holds neither of these tickets.
  assert.equal(canViewReport(cdrrmo, bonotFire), true, "fire is an emergency tier");
  assert.equal(canViewReport(cdrrmo, bonotPothole), false, "a pothole is not a coordination problem");
});

test("routing_table.is_emergency wins over the fallback tier lists", () => {
  // Postgres decides emergency membership from routing_table, so a row that
  // carries that flag must be trusted ahead of the client's category lists.
  const reclassified = { ...bonotPothole, routing_table: { is_emergency: true } };
  assert.equal(canViewReport(cdrrmo, reclassified), true);

  const downgradedFire = { ...bonotFire, routing_table: { is_emergency: false } };
  assert.equal(canViewReport(cdrrmo, downgradedFire), false);
});

test("an admin sees everything", () => {
  for (const report of [bitanoPothole, bonotPothole, bonotFire]) {
    assert.equal(canViewReport(admin, report), true);
  }
});

test("a viewer with no role sees no report", () => {
  assert.equal(canViewReport(NO_SCOPE, bitanoPothole), false);
  assert.equal(canViewReport(null, bitanoPothole), false);
});

test("scopeReports filters a list, and an absent scope leaves it alone", () => {
  const all = [bitanoPothole, bonotPothole, bonotFire];
  assert.deepEqual(scopeReports(bitanoOfficial, all).map((r) => r.id), ["r1"]);
  assert.deepEqual(scopeReports(engineering, all).map((r) => r.id), ["r1", "r2"]);
  assert.deepEqual(scopeReports(cdrrmo, all).map((r) => r.id), ["r3"]);
  assert.deepEqual(scopeReports(admin, all).map((r) => r.id), ["r1", "r2", "r3"]);
  // Public and resident paths pass no scope and are governed by RLS instead.
  assert.deepEqual(scopeReports(undefined, all).map((r) => r.id), ["r1", "r2", "r3"]);
});

test("legacy office_id naming on demo rows is still matched", () => {
  const demoRow = { id: "r4", category: "open_drain", office_id: "office-engineering" };
  assert.equal(canViewReport(engineering, demoRow), true);
});

/* ── Who may act, as opposed to who may look ─────────────────────────────── */

test("an admin sees every report and dispatches none of them", () => {
  // Governance, not operations. Postgres still permits an admin write as a
  // break-glass and records it; this is the rule the interface follows.
  assert.equal(canViewReport(admin, bonotFire), true);
  assert.equal(canDispatchReport(admin, bonotFire), false);
  assert.equal(canReassignReport(admin), true);
});

test("an office dispatches its own queue only", () => {
  assert.equal(canDispatchReport(engineering, bitanoPothole), true);
  assert.equal(canDispatchReport(engineering, bonotFire), false);
  assert.equal(canReassignReport(engineering), false);
});

test("a coordinator's extra sight carries no extra write", () => {
  // CDRRMO can read BFP's fire to coordinate the response, and cannot close it.
  assert.equal(canViewReport(cdrrmo, bonotFire), true);
  assert.equal(canDispatchReport(cdrrmo, bonotFire), false);
});

test("a barangay official endorses, and does not dispatch during the pilot", () => {
  assert.equal(canEndorseReport(bitanoOfficial, bitanoPothole), true);
  assert.equal(canEndorseReport(bitanoOfficial, bonotPothole), false, "not their barangay");
  assert.equal(
    canDispatchReport(bitanoOfficial, bitanoPothole),
    BARANGAY_LOCAL_DISPATCH_ENABLED,
    "endorse-only until local dispatch is unlocked"
  );
});

test("unlocking local dispatch would never reach critical hazards", () => {
  // The flag is off during the pilot, so assert the rule rather than the flag:
  // a fire is not routine, so no setting of the switch admits it.
  const fireInBitano = { ...bonotFire, barangay_id: "brgy-bitano" };
  assert.equal(canDispatchReport(bitanoOfficial, fireInBitano), false);
});

test("only staff may endorse or dispatch anything", () => {
  assert.equal(canEndorseReport(NO_SCOPE, bitanoPothole), false);
  assert.equal(canDispatchReport(null, bitanoPothole), false);
  assert.equal(canReassignReport(NO_SCOPE), false);
});

test("describeScope names the jurisdiction a printed export was made under", () => {
  assert.equal(describeScope(admin), "City-wide");
  assert.equal(describeScope(bitanoOfficial, { barangayName: "Bitano" }), "Brgy. Bitano");
  assert.equal(describeScope(engineering, { officeName: "City Engineering" }), "City Engineering");
  assert.equal(describeScope(cdrrmo, { officeName: "CDRRMO" }), "CDRRMO · city-wide emergencies");
});
