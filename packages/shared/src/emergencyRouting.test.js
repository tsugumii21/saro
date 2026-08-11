/**
 * Tests for emergency category -> responding agency -> hotline.
 *
 * Fixtures mirror the real routing_table and offices rows so a change to the
 * city's routing shows up here as a behaviour change rather than a silent one.
 *
 * Run with:  npm run test:shared
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  listEmergencyCategories,
  resolveEmergencyRouting,
  toDialableNumber,
} from "./emergencyRouting.js";
import { EMERGENCY_NUMBER, PANIC_CATEGORY } from "./constants.js";

/* Real ids and hotlines as seeded in the live project. */
const OFFICES = [
  { id: "bfp", short_name: "BFP Legazpi", full_name: "Bureau of Fire Protection - Legazpi Station", hotline: "(052) 480-6222" },
  { id: "cdrrmo", short_name: "CDRRMO", full_name: "City DRRM Office", hotline: "(052) 480-3333" },
  { id: "e911", short_name: "Legazpi 911", full_name: "Legazpi 911 Emergency Command Center", hotline: "911" },
  { id: "pnp", short_name: "PNP Legazpi", full_name: "Philippine National Police - Legazpi", hotline: "(052) 820-6144" },
  { id: "pcg", short_name: "Coast Guard Station", full_name: "Philippine Coast Guard", hotline: "(052) 480-1888" },
  { id: "eng", short_name: "City Engineering", full_name: "City Engineering Office", hotline: "(052) 742-0102" },
  { id: "nohotline", short_name: "Silent Office", full_name: "Office With No Line", hotline: null },
];

/* getCategories() aliases `category` -> `id` and `responsible_office_id` -> `office_id`. */
const CATEGORIES = [
  { id: "medical", label: "Medical Emergency & Injury", name: "Medical Emergency & Injury", is_emergency: true, office_id: "e911" },
  { id: "fire", label: "Fire Outbreak & Structural Fire", name: "Fire Outbreak & Structural Fire", is_emergency: true, office_id: "bfp" },
  { id: "accident", label: "Vehicular Collision & Road Crash", name: "Vehicular Collision & Road Crash", is_emergency: true, office_id: "e911" },
  { id: "crime", label: "Public Order & Crime Incident", name: "Public Order & Crime Incident", is_emergency: true, office_id: "pnp" },
  { id: "flood", label: "Flooding & Water Inundation", name: "Flooding & Water Inundation", is_emergency: true, office_id: "cdrrmo" },
  { id: "gas_leak", label: "Gas Leak & Chemical Spill", name: "Gas Leak & Chemical Spill", is_emergency: true, office_id: "bfp" },
  { id: "landslide", label: "Landslide & Soil Erosion", name: "Landslide & Soil Erosion", is_emergency: true, office_id: "cdrrmo" },
  { id: "coastal_hazard", label: "Coastal Storm Surge", name: "Coastal Storm Surge", is_emergency: true, office_id: "pcg" },
  { id: "bridge_damage", label: "Bridge & Seawall Damage", name: "Bridge & Seawall Damage", is_emergency: true, office_id: "eng" },
  { id: PANIC_CATEGORY, label: "Emergency — Panic Alert", name: "Emergency — Panic Alert", is_emergency: true, office_id: "e911" },
  // Non-emergency: must never appear in the S.O.S picker.
  { id: "pothole", label: "Road Pothole", name: "Road Pothole", is_emergency: false, office_id: "eng" },
  { id: "open_drain", label: "Uncovered Drain", name: "Uncovered Drain", is_emergency: false, office_id: "eng" },
];

const sources = { categories: CATEGORIES, offices: OFFICES };

/* ── Dialable numbers ─────────────────────────────────────────────────────── */

test("printed hotlines reduce to something tel: can dial", () => {
  assert.equal(toDialableNumber("(052) 480-6222"), "0524806222");
  assert.equal(toDialableNumber("911"), "911");
  assert.equal(toDialableNumber("+63 52 480 6222"), "+63524806222");
  assert.equal(toDialableNumber(""), "");
  assert.equal(toDialableNumber(null), "");
});

/* ── The picker ───────────────────────────────────────────────────────────── */

test("picker offers only emergency categories, never routine ones", () => {
  const ids = listEmergencyCategories(CATEGORIES).map((c) => c.id);
  assert.ok(!ids.includes("pothole"), "pothole must not appear");
  assert.ok(!ids.includes("open_drain"), "open_drain must not appear");
  for (const expected of ["medical", "fire", "accident", "crime", "flood"]) {
    assert.ok(ids.includes(expected), `${expected} should appear`);
  }
});

test("the generic panic category is excluded — it is the fallback, not a choice", () => {
  const ids = listEmergencyCategories(CATEGORIES).map((c) => c.id);
  assert.ok(!ids.includes(PANIC_CATEGORY));
});

test("most time-critical types are offered first", () => {
  const ids = listEmergencyCategories(CATEGORIES).map((c) => c.id);
  assert.deepEqual(ids.slice(0, 5), ["medical", "fire", "accident", "crime", "flood"]);
});

test("a new emergency category surfaces without editing the picker", () => {
  const withNew = [
    ...CATEGORIES,
    { id: "aircraft_incident", name: "Aircraft Incident", is_emergency: true, office_id: "e911" },
  ];
  const ids = listEmergencyCategories(withNew).map((c) => c.id);
  assert.ok(ids.includes("aircraft_incident"), "appears from routing_table alone");
});

/* ── Routing ──────────────────────────────────────────────────────────────── */

test("each emergency reaches the agency the routing table names", () => {
  const expected = {
    fire: ["BFP Legazpi", "0524806222"],
    gas_leak: ["BFP Legazpi", "0524806222"],
    crime: ["PNP Legazpi", "0528206144"],
    flood: ["CDRRMO", "0524803333"],
    landslide: ["CDRRMO", "0524803333"],
    coastal_hazard: ["Coast Guard Station", "0524801888"],
    medical: ["Legazpi 911", "911"],
    accident: ["Legazpi 911", "911"],
    bridge_damage: ["City Engineering", "0527420102"],
  };

  for (const [categoryId, [agency, dial]] of Object.entries(expected)) {
    const r = resolveEmergencyRouting(categoryId, sources);
    assert.equal(r.agencyName, agency, `${categoryId} -> ${agency}`);
    assert.equal(r.dial, dial, `${categoryId} dials ${dial}`);
    assert.equal(r.isFallback, false);
  }
});

test("fire and crime do not share a number — the whole point of the change", () => {
  const fire = resolveEmergencyRouting("fire", sources);
  const crime = resolveEmergencyRouting("crime", sources);
  assert.notEqual(fire.dial, crime.dial);
  assert.notEqual(fire.agencyName, crime.agencyName);
});

test("the resolved label is the category's own label", () => {
  assert.equal(
    resolveEmergencyRouting("fire", sources).categoryLabel,
    "Fire Outbreak & Structural Fire"
  );
});

/* ── Failure directions ───────────────────────────────────────────────────── */

test("an unknown category still reaches somebody", () => {
  const r = resolveEmergencyRouting("no_such_category", sources);
  assert.equal(r.dial, EMERGENCY_NUMBER);
  assert.equal(r.isFallback, true);
});

test("a category whose office has no recorded hotline falls back to 911", () => {
  const cats = [...CATEGORIES, { id: "quiet", name: "Quiet", is_emergency: true, office_id: "nohotline" }];
  const r = resolveEmergencyRouting("quiet", { categories: cats, offices: OFFICES });
  assert.equal(r.dial, EMERGENCY_NUMBER);
  assert.equal(r.isFallback, true);
});

test("a category pointing at a missing office falls back to 911", () => {
  const cats = [...CATEGORIES, { id: "orphan", name: "Orphan", is_emergency: true, office_id: "deleted" }];
  const r = resolveEmergencyRouting("orphan", { categories: cats, offices: OFFICES });
  assert.equal(r.dial, EMERGENCY_NUMBER);
  assert.equal(r.isFallback, true);
});

test("no data at all still yields a dialable number", () => {
  const r = resolveEmergencyRouting("fire", {});
  assert.equal(r.dial, EMERGENCY_NUMBER);
  assert.equal(r.isFallback, true);
  assert.equal(listEmergencyCategories(undefined).length, 0);
});

test("the 'not sure' fallback routes to the emergency command centre", () => {
  const r = resolveEmergencyRouting(PANIC_CATEGORY, sources);
  assert.equal(r.agencyName, "Legazpi 911");
  assert.equal(r.dial, "911");
});

/* ── Config-not-code ──────────────────────────────────────────────────────── */

test("changing a hotline is data-only — no code path knows the number", () => {
  const rekeyed = OFFICES.map((o) =>
    o.id === "bfp" ? { ...o, hotline: "(052) 999-0000" } : o
  );
  const r = resolveEmergencyRouting("fire", { categories: CATEGORIES, offices: rekeyed });
  assert.equal(r.dial, "0529990000");
  assert.equal(r.agencyName, "BFP Legazpi");
});

test("moving a category to another agency is data-only too", () => {
  const rerouted = CATEGORIES.map((c) =>
    c.id === "medical" ? { ...c, office_id: "cdrrmo" } : c
  );
  const r = resolveEmergencyRouting("medical", { categories: rerouted, offices: OFFICES });
  assert.equal(r.agencyName, "CDRRMO");
  assert.equal(r.dial, "0524803333");
});
