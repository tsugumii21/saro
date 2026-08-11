/**
 * Tests for the time-based visibility rules.
 *
 * Every case pins the clock through the `now` option rather than relying on the
 * real one, so these stay deterministic and will not start failing at midnight
 * or two years from now.
 *
 * Run with:  npm run test:shared
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  isReportActiveOnMap,
  isStaleReport,
  daysSinceStatusUpdate,
  countIncidentsInWindow,
  evaluateAccidentArea,
  qualifiesAsAccidentArea,
  rollingWindowStart,
  isEmergencyVisibilityCategory,
  isInfrastructureStaleCategory,
} from "./reportLifecycle.js";

import {
  REPORT_ACTIVE_HOURS_EMERGENCY,
  REPORT_STALE_DAYS_INFRASTRUCTURE,
  ACCIDENT_ROLLING_WINDOW_MONTHS,
  MIN_INCIDENTS_FOR_ACCIDENT_AREA,
} from "./constants.js";

/** Fixed clock: 2026-08-11T00:00:00Z. */
const NOW = new Date("2026-08-11T00:00:00Z").getTime();
const HOUR = 3600000;
const DAY = 24 * HOUR;

const hoursAgo = (h) => new Date(NOW - h * HOUR).toISOString();
const daysAgo = (d) => new Date(NOW - d * DAY).toISOString();
const monthsAgo = (m) => {
  const d = new Date(NOW);
  d.setMonth(d.getMonth() - m);
  return d.toISOString();
};

/* ── Category sets ────────────────────────────────────────────────────────── */

test("emergency visibility set covers panic, gas leak, fire and flood", () => {
  for (const c of ["emergency_unspecified", "gas_leak", "fire", "flood"]) {
    assert.equal(isEmergencyVisibilityCategory(c), true, `${c} should be emergency`);
  }
  for (const c of ["pothole", "open_drain", "landslide", "bridge_damage"]) {
    assert.equal(isEmergencyVisibilityCategory(c), false, `${c} should not be emergency`);
  }
});

test("infrastructure stale set covers pothole, drainage and structural debris", () => {
  for (const c of ["pothole", "open_drain", "typhoon_debris"]) {
    assert.equal(isInfrastructureStaleCategory(c), true, `${c} should be infrastructure`);
  }
  // bridge_damage is dispatched as an emergency with a 12h SLA, not a backlog item.
  assert.equal(isInfrastructureStaleCategory("bridge_damage"), false);
});

/* ── Emergency active window ──────────────────────────────────────────────── */

test(`a fire stays active up to ${REPORT_ACTIVE_HOURS_EMERGENCY}h and drops after`, () => {
  const at = (h) => ({ category: "fire", status: "received", created_at: hoursAgo(h) });

  assert.equal(isReportActiveOnMap(at(1), { now: NOW }), true);
  assert.equal(isReportActiveOnMap(at(47), { now: NOW }), true);
  assert.equal(isReportActiveOnMap(at(48), { now: NOW }), true, "exactly at the limit still counts");
  assert.equal(isReportActiveOnMap(at(49), { now: NOW }), false);
  assert.equal(isReportActiveOnMap(at(100), { now: NOW }), false);
});

test("resolved ends an emergency pin immediately, before the timer", () => {
  const fresh = { category: "gas_leak", created_at: hoursAgo(2) };

  assert.equal(isReportActiveOnMap({ ...fresh, status: "in_progress" }, { now: NOW }), true);
  assert.equal(isReportActiveOnMap({ ...fresh, status: "resolved" }, { now: NOW }), false);
  assert.equal(isReportActiveOnMap({ ...fresh, status: "closed_confirmed" }, { now: NOW }), false);
});

test("a reopened emergency inside the window is active again", () => {
  const report = { category: "flood", status: "reopened", created_at: hoursAgo(5) };
  assert.equal(isReportActiveOnMap(report, { now: NOW }), true);
});

test("non-emergency categories keep the old archive behaviour", () => {
  // 100h old pothole, still open: the 48h emergency clock must not touch it.
  const pothole = { category: "pothole", status: "assigned", created_at: hoursAgo(100) };
  assert.equal(isReportActiveOnMap(pothole, { now: NOW }), true);

  // Landslide is critical to answer but its hazard persists — not on the 48h clock.
  const landslide = { category: "landslide", status: "in_progress", created_at: hoursAgo(100) };
  assert.equal(isReportActiveOnMap(landslide, { now: NOW }), true);

  // Resolved long ago: the pre-existing 72h archive rule still removes it.
  const done = { category: "pothole", status: "resolved", resolved_at: hoursAgo(100) };
  assert.equal(isReportActiveOnMap(done, { now: NOW }), false);
});

test("the emergency duration is overridable without touching the default", () => {
  const report = { category: "fire", status: "received", created_at: hoursAgo(60) };
  assert.equal(isReportActiveOnMap(report, { now: NOW }), false);
  assert.equal(isReportActiveOnMap(report, { now: NOW, emergencyHours: 72 }), true);
});

test("an undated report is kept rather than guessed away", () => {
  assert.equal(isReportActiveOnMap({ category: "fire", status: "received" }, { now: NOW }), true);
  assert.equal(isReportActiveOnMap(null, { now: NOW }), false);
});

/* ── Infrastructure staleness ─────────────────────────────────────────────── */

test(`infrastructure goes stale after ${REPORT_STALE_DAYS_INFRASTRUCTURE} days untouched`, () => {
  const at = (d) => ({ category: "pothole", status: "assigned", updated_at: daysAgo(d) });

  assert.equal(isStaleReport(at(89), { now: NOW }), false);
  assert.equal(isStaleReport(at(90), { now: NOW }), false, "exactly at the limit is not yet stale");
  assert.equal(isStaleReport(at(91), { now: NOW }), true);
});

test("staleness flags but never removes — the report is still an active pin", () => {
  const report = { category: "open_drain", status: "received", updated_at: daysAgo(200) };
  assert.equal(isStaleReport(report, { now: NOW }), true);
  assert.equal(isReportActiveOnMap(report, { now: NOW }), true, "still on the map");
});

test("an office update resets the stale clock", () => {
  const report = {
    category: "pothole",
    status: "in_progress",
    created_at: daysAgo(300),
    updated_at: daysAgo(10),
  };
  assert.equal(isStaleReport(report, { now: NOW }), false);
});

test("created_at stands in when the projection carries no updated_at", () => {
  const report = { category: "pothole", status: "received", created_at: daysAgo(120) };
  assert.equal(daysSinceStatusUpdate(report, NOW), 120);
  assert.equal(isStaleReport(report, { now: NOW }), true);
});

test("resolved infrastructure is finished, not neglected", () => {
  const report = { category: "pothole", status: "resolved", updated_at: daysAgo(200) };
  assert.equal(isStaleReport(report, { now: NOW }), false);
});

test("emergency categories are never marked stale", () => {
  const report = { category: "fire", status: "received", updated_at: daysAgo(400) };
  assert.equal(isStaleReport(report, { now: NOW }), false);
});

/* ── Accident rolling window ──────────────────────────────────────────────── */

test(`rolling window start is ${ACCIDENT_ROLLING_WINDOW_MONTHS} calendar months back`, () => {
  const start = rollingWindowStart(NOW);
  assert.equal(new Date(start).toISOString().slice(0, 10), "2024-08-11");
});

test("only in-window incidents are counted", () => {
  const incidents = [
    { occurred_at: monthsAgo(1) },
    { occurred_at: monthsAgo(12) },
    { occurred_at: monthsAgo(23) },
    { occurred_at: monthsAgo(25) },   // outside
    { occurred_at: monthsAgo(60) },   // outside
  ];
  assert.equal(countIncidentsInWindow(incidents, { now: NOW }), 3);
});

test("bare timestamps are accepted alongside objects", () => {
  const incidents = [monthsAgo(2), new Date(NOW - 30 * DAY), { occurred_at: monthsAgo(30) }];
  assert.equal(countIncidentsInWindow(incidents, { now: NOW }), 2);
});

/*
 * The case specified with the feature request.
 */
test("SPEC: 2 incidents over 24 months old + 2 this month does NOT trigger", () => {
  const spot = {
    id: "spec-a",
    name: "Older pair plus recent pair",
    incidents: [
      { occurred_at: monthsAgo(30) },   // outside the window
      { occurred_at: monthsAgo(26) },   // outside the window
      { occurred_at: daysAgo(3) },      // in window
      { occurred_at: daysAgo(9) },      // in window
    ],
  };

  const result = evaluateAccidentArea(spot, { now: NOW });

  assert.equal(result.windowed, true);
  assert.equal(result.inWindowCount, 2, "only the two recent incidents are in window");
  assert.equal(result.inWindowCount < MIN_INCIDENTS_FOR_ACCIDENT_AREA, true);
  assert.equal(result.qualifies, false, "2 in-window incidents must NOT trigger");
  assert.equal(qualifiesAsAccidentArea(spot, { now: NOW }), false);

  // The old incidents are excluded from the count, not removed from the data.
  assert.equal(spot.incidents.length, 4, "source data left untouched");
});

test("SPEC: 3 incidents this month DOES trigger immediately", () => {
  const spot = {
    id: "spec-b",
    name: "Three this month",
    incidents: [
      { occurred_at: daysAgo(2) },
      { occurred_at: daysAgo(6) },
      { occurred_at: daysAgo(11) },
    ],
  };

  const result = evaluateAccidentArea(spot, { now: NOW });

  assert.equal(result.windowed, true);
  assert.equal(result.inWindowCount, 3);
  assert.equal(result.qualifies, true, "3 in-window incidents must trigger");
  assert.equal(qualifiesAsAccidentArea(spot, { now: NOW }), true);
});

test("a site that has gone quiet for two years stops qualifying", () => {
  const spot = {
    id: "quiet",
    incidents: [monthsAgo(25), monthsAgo(28), monthsAgo(31), monthsAgo(40)],
  };
  const result = evaluateAccidentArea(spot, { now: NOW });

  assert.equal(result.inWindowCount, 0);
  assert.equal(result.qualifies, false);
  assert.equal(spot.incidents.length, 4, "history retained in full");
});

test("widening the window brings excluded history straight back", () => {
  const spot = { id: "wide", incidents: [monthsAgo(25), monthsAgo(28), monthsAgo(31)] };

  assert.equal(evaluateAccidentArea(spot, { now: NOW }).qualifies, false);
  assert.equal(
    evaluateAccidentArea(spot, { now: NOW, windowMonths: 36 }).qualifies,
    true,
    "same untouched rows, longer window"
  );
});

test("a server-side windowed count is trusted as already filtered", () => {
  const spot = { id: "rpc", incident_count: 40, recent_incident_count: 2 };
  const result = evaluateAccidentArea(spot, { now: NOW });

  assert.equal(result.windowed, true);
  assert.equal(result.inWindowCount, 2, "the all-time 40 is ignored");
  assert.equal(result.qualifies, false);
});

test("a scalar-only blackspot reports honestly that it was not windowed", () => {
  const spot = { id: "legacy", incident_count: 14 };
  const result = evaluateAccidentArea(spot, { now: NOW });

  assert.equal(result.windowed, false, "no dates available to filter on");
  assert.equal(result.inWindowCount, 14);
  assert.equal(result.qualifies, true);
});

test("the threshold and window are independently overridable", () => {
  const spot = { id: "opts", incidents: [daysAgo(1), daysAgo(2)] };

  assert.equal(evaluateAccidentArea(spot, { now: NOW }).qualifies, false);
  assert.equal(evaluateAccidentArea(spot, { now: NOW, minIncidents: 2 }).qualifies, true);
});
