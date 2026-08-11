/**
 * Tests for what a group of reports actually corroborates.
 *
 * These exist because the thing they replaced could not be tested: a
 * "confidence" of `0.35 + members × 0.15` has no ground truth to check against,
 * which is a good sign that it was not measuring anything. Distance and elapsed
 * time do.
 *
 * Run with:  npm run test:shared
 */

import test from "node:test";
import assert from "node:assert/strict";

import { describeCorroboration, corroborationLabel } from "./reportGrouping.js";

const base = new Date("2026-08-12T01:00:00Z").toISOString();
const plus7min = new Date("2026-08-12T01:07:00Z").toISOString();
const plus3hours = new Date("2026-08-12T04:00:00Z").toISOString();

/* Roughly 100 m apart at Legazpi's latitude: 0.0009 degrees of latitude. */
const bitanoA = { lat: 13.1438, lng: 123.7448, created_at: base };
const bitanoB = { lat: 13.1447, lng: 123.7448, created_at: plus7min };
const farAway = { lat: 13.1610, lng: 123.7540, created_at: plus3hours };

test("a single report has no spread and no span", () => {
  const facts = describeCorroboration([bitanoA]);
  assert.equal(facts.count, 1);
  assert.equal(facts.spreadMeters, null);
  assert.equal(facts.spanMinutes, 0);
  assert.equal(corroborationLabel([bitanoA]), "1 report");
});

test("spread is the widest gap between any two reports, not the average", () => {
  const facts = describeCorroboration([bitanoA, bitanoB]);
  assert.ok(facts.spreadMeters >= 90 && facts.spreadMeters <= 110, `got ${facts.spreadMeters} m`);

  const wide = describeCorroboration([bitanoA, bitanoB, farAway]);
  assert.ok(wide.spreadMeters > 1500, `got ${wide.spreadMeters} m`);
});

test("span is the time between the first and last report", () => {
  assert.equal(describeCorroboration([bitanoA, bitanoB]).spanMinutes, 7);
  assert.equal(describeCorroboration([bitanoA, farAway]).spanMinutes, 180);
});

test("the label states the facts a dispatcher can weigh", () => {
  const label = corroborationLabel([bitanoA, bitanoB]);
  assert.match(label, /^2 reports/);
  assert.match(label, /within \d+ m/);
  assert.match(label, /over 7 min/);
});

test("distant groups switch to kilometres, long ones to hours", () => {
  const label = corroborationLabel([bitanoA, farAway]);
  assert.match(label, /within \d+\.\d km/);
  assert.match(label, /over 3 h/);
});

test("an empty group says so instead of inventing a number", () => {
  assert.equal(corroborationLabel([]), "No reports");
  assert.deepEqual(describeCorroboration(null), { count: 0, spreadMeters: null, spanMinutes: null });
});
