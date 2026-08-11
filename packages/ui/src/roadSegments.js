/**
 * Road-segment resolution for accident-prone areas.
 *
 * An accident blackspot is a point, but the hazard it describes is a stretch of
 * road, not a disc of land. Drawing a fixed-radius circle over the point paints
 * houses, fields and parallel streets as accident-prone, which is both wrong and
 * alarming to the people who live inside the circle. So instead we take the
 * reported point, snap it onto the road it was filed on, and highlight only that
 * carriageway for a set distance in each direction.
 *
 * Geometry runs against OpenStreetMap ways fetched from Overpass. When Overpass
 * is unreachable the caller keeps its circular buffer as a degraded fallback —
 * a wrong-shaped hazard still beats no hazard shown at all.
 */

/* Minimum half-length required by the spec: the highlight must reach at least
   50 m out from the report in both directions. The default overshoots slightly
   so the segment still reads as a stretch of road at city zoom levels. */
export const MIN_HALF_LENGTH_M = 50;
const DEFAULT_HALF_LENGTH_M = 70;

/* Ways are fetched from a slightly wider ring than we intend to draw so that a
   report filed near the end of an OSM way can still be extended past the join. */
const SEARCH_PADDING_M = 120;

/* A point further than this from every candidate road is treated as "not on a
   road" — an off-road blackspot should not snap onto a highway 300 m away. */
const MAX_SNAP_DISTANCE_M = 80;

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const DRIVEABLE_HIGHWAYS =
  "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|" +
  "service|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$";

const CACHE_KEY = "saro.roadSegments.v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const METERS_PER_DEG_LAT = 111320;

function metersPerDegLng(lat) {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/* ── Planar helpers ───────────────────────────────────────────────────────────
 * Every segment we handle is a few hundred metres long, so an equirectangular
 * projection around the blackspot itself is accurate to well under a metre and
 * lets the clipping maths stay in plain Cartesian space.
 */

function toXY(lngLat, origin) {
  return [
    (lngLat[0] - origin[0]) * metersPerDegLng(origin[1]),
    (lngLat[1] - origin[1]) * METERS_PER_DEG_LAT,
  ];
}

function toLngLat(xy, origin) {
  return [
    origin[0] + xy[0] / metersPerDegLng(origin[1]),
    origin[1] + xy[1] / METERS_PER_DEG_LAT,
  ];
}

function distance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Closest point on segment a→b to p, in planar metres.
 * Returns the fraction along the segment plus the resulting point and distance.
 */
function projectOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return { t: 0, point: a, dist: distance(p, a) };

  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const point = [a[0] + t * dx, a[1] + t * dy];
  return { t, point, dist: distance(p, point) };
}

/**
 * Closest point on a whole polyline. `index` is the segment the projection fell
 * on, so the caller can walk outward from exactly there.
 */
export function projectOnPolyline(point, polyline) {
  let best = null;
  for (let i = 0; i < polyline.length - 1; i++) {
    const hit = projectOnSegment(point, polyline[i], polyline[i + 1]);
    if (!best || hit.dist < best.dist) best = { ...hit, index: i };
  }
  return best;
}

/**
 * Walk `halfLengthM` along the polyline in both directions from the projected
 * point, cutting the first and last segment mid-way so the highlight ends at an
 * exact distance rather than at whatever vertex happens to be nearby.
 */
export function sliceAroundPoint(polyline, projection, halfLengthM) {
  const { index, point } = projection;

  const backward = [];
  let remaining = halfLengthM;
  let cursor = point;
  for (let i = index; i >= 0; i--) {
    const vertex = polyline[i];
    const step = distance(cursor, vertex);
    if (step >= remaining) {
      const ratio = step === 0 ? 0 : remaining / step;
      backward.push([
        cursor[0] + (vertex[0] - cursor[0]) * ratio,
        cursor[1] + (vertex[1] - cursor[1]) * ratio,
      ]);
      break;
    }
    backward.push(vertex);
    remaining -= step;
    cursor = vertex;
  }

  const forward = [];
  remaining = halfLengthM;
  cursor = point;
  for (let i = index + 1; i < polyline.length; i++) {
    const vertex = polyline[i];
    const step = distance(cursor, vertex);
    if (step >= remaining) {
      const ratio = step === 0 ? 0 : remaining / step;
      forward.push([
        cursor[0] + (vertex[0] - cursor[0]) * ratio,
        cursor[1] + (vertex[1] - cursor[1]) * ratio,
      ]);
      break;
    }
    forward.push(vertex);
    remaining -= step;
    cursor = vertex;
  }

  /* Walking outward from a vertex the projection already sits on can emit that
     vertex twice; collapse coincident neighbours so the line has clean joins. */
  const walked = [...backward.reverse(), point, ...forward];
  return walked.filter((c, i) => i === 0 || distance(c, walked[i - 1]) > 1e-6);
}

function polylineLength(polyline) {
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) total += distance(polyline[i], polyline[i + 1]);
  return total;
}

/* ── Way stitching ────────────────────────────────────────────────────────────
 * OSM splits a single named road into many ways wherever tags or junctions
 * change. Left unstitched, a report near a way boundary would only ever get the
 * short stub it landed on. Chains sharing an endpoint and a name are merged
 * first, so the 50 m walk can cross those boundaries.
 */

function endpointKey(coord) {
  return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
}

export function stitchWays(ways) {
  const remaining = ways.map((w) => w.slice());
  const chains = [];

  while (remaining.length > 0) {
    let chain = remaining.pop();
    let merged = true;

    while (merged) {
      merged = false;
      for (let i = 0; i < remaining.length; i++) {
        const way = remaining[i];
        const chainStart = endpointKey(chain[0]);
        const chainEnd = endpointKey(chain[chain.length - 1]);
        const wayStart = endpointKey(way[0]);
        const wayEnd = endpointKey(way[way.length - 1]);

        if (chainEnd === wayStart) {
          chain = chain.concat(way.slice(1));
        } else if (chainEnd === wayEnd) {
          chain = chain.concat(way.slice().reverse().slice(1));
        } else if (chainStart === wayEnd) {
          chain = way.slice(0, -1).concat(chain);
        } else if (chainStart === wayStart) {
          chain = way.slice().reverse().slice(0, -1).concat(chain);
        } else {
          continue;
        }

        remaining.splice(i, 1);
        merged = true;
        break;
      }
    }

    chains.push(chain);
  }

  return chains;
}

/**
 * Group Overpass ways into stitched candidate roads. Ways carrying the same
 * name belong to the same road; unnamed ways are stitched per way id so a
 * service road never silently absorbs its neighbour.
 */
export function buildCandidateRoads(elements) {
  const groups = new Map();

  for (const el of elements) {
    if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const tags = el.tags || {};
    const name = tags.name || tags.ref || "";
    const key = name ? `name:${name}` : `way:${el.id}`;
    const coords = el.geometry.map((g) => [g.lon, g.lat]);

    if (!groups.has(key)) {
      groups.set(key, { name, highway: tags.highway || "road", ways: [] });
    }
    groups.get(key).ways.push(coords);
  }

  const candidates = [];
  for (const group of groups.values()) {
    for (const chain of stitchWays(group.ways)) {
      if (chain.length >= 2) {
        candidates.push({ name: group.name, highway: group.highway, coordinates: chain });
      }
    }
  }
  return candidates;
}

/**
 * Snap one point to the best candidate road and clip the highlight around it.
 * Returns null when nothing driveable is close enough to call a road segment.
 */
export function resolveSegmentForPoint(lat, lng, candidates, halfLengthM = DEFAULT_HALF_LENGTH_M) {
  const origin = [lng, lat];
  const target = [0, 0];
  const reach = Math.max(MIN_HALF_LENGTH_M, halfLengthM);

  let best = null;
  for (const candidate of candidates) {
    const planar = candidate.coordinates.map((c) => toXY(c, origin));
    const projection = projectOnPolyline(target, planar);
    if (!projection) continue;
    if (!best || projection.dist < best.projection.dist) {
      best = { candidate, planar, projection };
    }
  }

  if (!best || best.projection.dist > MAX_SNAP_DISTANCE_M) return null;

  const sliced = sliceAroundPoint(best.planar, best.projection, reach);
  if (sliced.length < 2) return null;

  return {
    coordinates: sliced.map((xy) => toLngLat(xy, origin)),
    roadName: best.candidate.name || "Unnamed road",
    highway: best.candidate.highway,
    snapDistanceM: Math.round(best.projection.dist),
    lengthM: Math.round(polylineLength(sliced)),
  };
}

/* ── Overpass access ──────────────────────────────────────────────────────── */

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    /* Keep only live entries so a long-running install cannot grow the key
       without bound as blackspot sets change. */
    const fresh = Object.fromEntries(
      Object.entries(cache).filter(([, v]) => Date.now() - v.at < CACHE_TTL_MS)
    );
    localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
  } catch {
    /* storage full or blocked — the network path still works */
  }
}

function cacheKeyFor(spots, halfLengthM) {
  const points = spots
    .map((s) => `${Number(s.lat).toFixed(5)},${Number(s.lng).toFixed(5)}`)
    .sort()
    .join("|");
  return `${halfLengthM}#${points}`;
}

function buildOverpassQuery(spots, radiusM) {
  const clauses = spots
    .map(
      (s) =>
        `way(around:${radiusM},${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)})` +
        `["highway"~"${DRIVEABLE_HIGHWAYS}"];`
    )
    .join("\n  ");
  return `[out:json][timeout:25];\n(\n  ${clauses}\n);\nout geom;`;
}

async function queryOverpass(query, signal) {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: query,
        signal,
      });
      if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
      const json = await res.json();
      if (Array.isArray(json?.elements)) return json.elements;
      throw new Error("Overpass returned no elements array");
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      lastError = err;
    }
  }
  throw lastError ?? new Error("All Overpass endpoints failed");
}

/**
 * Resolve a road segment for every blackspot in one Overpass round trip.
 *
 * Resolves to a Map keyed by spot id. Spots with no nearby road are simply
 * absent from the map, which is the caller's cue to keep the circular buffer.
 */
export async function fetchRoadSegments(spots, { halfLengthM = DEFAULT_HALF_LENGTH_M, signal } = {}) {
  const usable = (spots ?? []).filter(
    (s) => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng))
  );
  if (usable.length === 0) return new Map();

  const reach = Math.max(MIN_HALF_LENGTH_M, halfLengthM);
  const key = cacheKeyFor(usable, reach);
  const cache = readCache();
  const hit = cache[key];

  let elements;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    elements = hit.elements;
  } else {
    elements = await queryOverpass(buildOverpassQuery(usable, Math.round(reach + SEARCH_PADDING_M)), signal);
    /* Only the fields the geometry needs are cached; full Overpass payloads are
       large enough to blow the localStorage quota on their own. */
    const lean = elements.map((el) => ({
      type: el.type,
      id: el.id,
      tags: { name: el.tags?.name, ref: el.tags?.ref, highway: el.tags?.highway },
      geometry: el.geometry,
    }));
    writeCache({ ...cache, [key]: { at: Date.now(), elements: lean } });
    elements = lean;
  }

  const candidates = buildCandidateRoads(elements);
  const resolved = new Map();

  for (const spot of usable) {
    const segment = resolveSegmentForPoint(Number(spot.lat), Number(spot.lng), candidates, reach);
    if (segment) resolved.set(spot.id ?? `${spot.lat},${spot.lng}`, segment);
  }

  return resolved;
}
