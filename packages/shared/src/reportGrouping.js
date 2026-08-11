/**
 * One definition of "how many reports is this pin".
 *
 * Every map surface used to group reports its own way, so the same underlying
 * rows produced different numbers depending on which screen you were looking at.
 * The worst of them merged anything within ~550 m regardless of category, which
 * turned four separate server-side clusters and a handful of unrelated singles
 * into a single pin claiming "16 Reports in this Area".
 *
 * The authority on what belongs together is Postgres: `assign_cluster` groups a
 * report with its neighbours when they share a category, sit within
 * CLUSTER_RADIUS_METERS, and arrive within CLUSTER_WINDOW_MINUTES. This module
 * applies exactly that rule client-side, and defers to the server's `cluster_id`
 * whenever one is present.
 *
 * The invariant every caller can rely on: `pin.count === pin.members.length`.
 * Nothing here inflates a count from a separate score column, so a pin's
 * headline can never disagree with the list of reports behind it.
 */

import { CLUSTER_RADIUS_METERS, CLUSTER_WINDOW_MINUTES } from "./constants.js";

const EARTH_RADIUS_M = 6371000;

/** Haversine distance in metres. */
export function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function coord(value) {
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function categoryOf(report) {
  return report.category_id ?? report.category ?? "";
}

function timeOf(report) {
  const t = new Date(report.created_at).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * A stable identity for a report row.
 *
 * The public map RPC returns a deliberately narrow projection with no id and no
 * tracking code, so rows coming from it have nothing to key on. Falling back to
 * `undefined` collapsed every React key to the same value and left pin popups
 * unable to tell their members apart, so a coordinate/time fingerprint stands in.
 */
export function reportKey(report) {
  if (!report) return "";
  if (report.id) return String(report.id);
  if (report.tracking_code) return String(report.tracking_code);
  return `pub:${categoryOf(report)}:${report.lat},${report.lng}:${report.created_at ?? ""}`;
}

/**
 * Stamp a unique `id` on every row that lacks one.
 *
 * Coordinates are rounded to ~110 m and timestamps are shared across seeded
 * rows, so two genuinely distinct reports can be byte-identical in the public
 * projection. When that happens the fingerprint alone is not enough and a
 * positional suffix separates them, which keeps ids unique without making
 * unaffected rows depend on their position in the array.
 */
export function assignReportKeys(rows) {
  const used = new Map();
  return (rows ?? []).map((row) => {
    if (!row || row.id) return row;
    const base = reportKey(row);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return { ...row, id: seen === 0 ? base : `${base}#${seen}` };
  });
}

/**
 * Group reports into map pins using the server's clustering rule.
 *
 * @param {Array<object>} reports
 * @param {object}   [options]
 * @param {number}   [options.radiusMeters=CLUSTER_RADIUS_METERS]
 * @param {number}   [options.windowMinutes=CLUSTER_WINDOW_MINUTES]
 * @param {boolean}  [options.requireSameCategory=true]
 * @returns {Array<{id: string, report: object, members: object[], count: number}>}
 */
export function groupReportsIntoPins(reports, options = {}) {
  const {
    radiusMeters = CLUSTER_RADIUS_METERS,
    windowMinutes = CLUSTER_WINDOW_MINUTES,
    requireSameCategory = true,
  } = options;

  const placeable = (reports ?? []).filter(
    (r) => r && coord(r.lat) !== null && coord(r.lng) !== null
  );

  /* Server-assigned clusters are authoritative: they were computed from exact
     coordinates before the public RPC rounded them, so they beat any distance
     test we could redo here on the rounded values. */
  const byClusterId = new Map();
  const loose = [];
  for (const report of placeable) {
    if (report.cluster_id) {
      if (!byClusterId.has(report.cluster_id)) byClusterId.set(report.cluster_id, []);
      byClusterId.get(report.cluster_id).push(report);
    } else {
      loose.push(report);
    }
  }

  const pins = [];

  for (const [clusterId, members] of byClusterId) {
    pins.push({ id: `cluster:${clusterId}`, report: members[0], members, count: members.length });
  }

  /* Everything the server left unclustered gets the same rule applied locally,
     so a pin still means "reports of one kind, in one place, at one time". */
  const taken = new Set();
  for (let i = 0; i < loose.length; i++) {
    if (taken.has(i)) continue;
    const seed = loose[i];
    const members = [seed];
    taken.add(i);

    const seedLat = coord(seed.lat);
    const seedLng = coord(seed.lng);
    const seedTime = timeOf(seed);
    const seedCategory = categoryOf(seed);

    for (let j = i + 1; j < loose.length; j++) {
      if (taken.has(j)) continue;
      const candidate = loose[j];

      if (requireSameCategory && categoryOf(candidate) !== seedCategory) continue;

      const dist = getDistanceMeters(seedLat, seedLng, coord(candidate.lat), coord(candidate.lng));
      if (dist > radiusMeters) continue;

      const candidateTime = timeOf(candidate);
      if (seedTime !== null && candidateTime !== null) {
        if (Math.abs(seedTime - candidateTime) / 60000 > windowMinutes) continue;
      }

      members.push(candidate);
      taken.add(j);
    }

    pins.push({ id: reportKey(seed), report: seed, members, count: members.length });
  }

  /* Busiest pins first so the map's most significant markers are added last and
     end up on top, and so list feeds lead with the biggest incidents. */
  return pins.sort((a, b) => b.count - a.count);
}

const TIER_RANK = { critical: 3, urgent: 2, routine: 1 };

/**
 * Collapse pins that share a map point into one pin per location.
 *
 * The public map rounds coordinates to three decimals (~110 m), so reports that
 * have nothing to do with each other land on the same lattice point and draw as
 * markers stacked exactly on top of one another. Whatever was rendered last won
 * the click, which is how the map and the incident list came to disagree about
 * which report a pin was.
 *
 * A location pin is honest about that: one marker, a count of everything filed
 * there, and a popup that lists the reports grouped by category. `groups` keeps
 * each category's own members, so the popup can offer a row per kind of hazard
 * rather than a flat list of near-identical lines.
 *
 * The invariant from groupReportsIntoPins still holds: `count === members.length`.
 *
 * @param {Array<{id: string, report: object, members: object[], count: number}>} pins
 * @param {object}   [options]
 * @param {number}   [options.precision=3]  decimals the coordinates are keyed on
 * @param {(report: object) => string} [options.tierOf]  category tier lookup
 * @returns {Array<{id, report, members, count, groups, isLocation}>}
 */
export function groupPinsByLocation(pins, options = {}) {
  const { precision = 3, tierOf } = options;

  const byPoint = new Map();
  for (const pin of pins ?? []) {
    const lat = coord(pin?.report?.lat);
    const lng = coord(pin?.report?.lng);
    if (lat === null || lng === null) continue;
    const key = `${lat.toFixed(precision)},${lng.toFixed(precision)}`;
    if (!byPoint.has(key)) byPoint.set(key, []);
    byPoint.get(key).push(pin);
  }

  const located = [];
  for (const [key, group] of byPoint) {
    if (group.length === 1) {
      located.push({ ...group[0], groups: [toGroup(group[0])], isLocation: false });
      continue;
    }

    const members = group.flatMap((pin) => pin.members);

    /* The pin wears the most serious thing filed here, then the most recent —
       a routine pothole must not decide the colour of a point that also has a
       fire on it. */
    const lead = [...group].sort((a, b) => {
      const tierDelta =
        (TIER_RANK[tierOf?.(b.report) ?? "routine"] ?? 1) -
        (TIER_RANK[tierOf?.(a.report) ?? "routine"] ?? 1);
      if (tierDelta !== 0) return tierDelta;
      return (timeOf(b.report) ?? 0) - (timeOf(a.report) ?? 0);
    })[0];

    located.push({
      id: `loc:${key}`,
      report: lead.report,
      members,
      count: members.length,
      groups: group.map(toGroup).sort((a, b) => b.count - a.count),
      isLocation: true,
    });
  }

  return located.sort((a, b) => b.count - a.count);
}

function toGroup(pin) {
  return {
    id: pin.id,
    report: pin.report,
    members: pin.members,
    count: pin.count,
  };
}

/**
 * What actually corroborates a group of reports.
 *
 * This replaces a "confidence" percentage that was arithmetic on a count
 * (`0.35 + members × 0.15`, capped at 98%) presented to dispatchers as if it
 * measured something. It measured nothing: three reports always produced 80%,
 * whether they were three neighbours describing one fire or three strangers
 * describing three.
 *
 * The facts underneath are more useful and are actually true — how many
 * independent reports, how tightly they sit together, and over what stretch of
 * time they arrived. A dispatcher can weigh those; a fabricated percentage only
 * borrowed authority from the machine.
 *
 * @returns {{count: number, spreadMeters: number|null, spanMinutes: number|null}}
 */
export function describeCorroboration(reports) {
  const rows = (reports ?? []).filter(Boolean);
  if (rows.length === 0) return { count: 0, spreadMeters: null, spanMinutes: null };

  let spreadMeters = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const distance = getDistanceMeters(rows[i].lat, rows[i].lng, rows[j].lat, rows[j].lng);
      if (Number.isFinite(distance) && distance > spreadMeters) spreadMeters = distance;
    }
  }

  const times = rows
    .map((row) => new Date(row.created_at).getTime())
    .filter((value) => Number.isFinite(value));

  const spanMinutes =
    times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / 60_000) : 0;

  return {
    count: rows.length,
    spreadMeters: rows.length > 1 ? Math.round(spreadMeters) : null,
    spanMinutes: times.length > 0 ? spanMinutes : null,
  };
}

/** The same facts as one short line, for a badge or a card header. */
export function corroborationLabel(reports) {
  const { count, spreadMeters, spanMinutes } = describeCorroboration(reports);
  if (count === 0) return "No reports";
  if (count === 1) return "1 report";

  const parts = [`${count} reports`];
  if (spreadMeters !== null) {
    parts.push(spreadMeters < 1000 ? `within ${spreadMeters} m` : `within ${(spreadMeters / 1000).toFixed(1)} km`);
  }
  if (spanMinutes !== null) {
    if (spanMinutes < 1) parts.push("filed together");
    else if (spanMinutes < 60) parts.push(`over ${spanMinutes} min`);
    else parts.push(`over ${Math.round(spanMinutes / 60)} h`);
  }
  return parts.join(" · ");
}

/**
 * Per-status totals over the same set the "All" chip counts, so the chips always
 * sum to no more than the total and never disagree with it.
 */
export function countReportsByStatus(reports, statuses) {
  const counts = Object.fromEntries(statuses.map((s) => [s, 0]));
  for (const report of reports ?? []) {
    if (report?.status in counts) counts[report.status] += 1;
  }
  return counts;
}
