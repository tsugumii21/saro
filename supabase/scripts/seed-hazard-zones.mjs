#!/usr/bin/env node
/**
 * Load the fetched hazard polygons into `hazard_zones` for server-side
 * geofencing.
 *
 * The same polygons exist twice on purpose, in two forms doing two jobs:
 *
 *   PMTiles   for drawing. Tiled, simplified, range-requested, offline-cached.
 *             Optimised for a phone painting a map.
 *
 *   Postgres  for deciding. Full precision, indexed with GiST, queried by
 *             ST_Intersects inside the insert transaction. Optimised for
 *             answering "is this report inside a danger zone" correctly.
 *
 * Using the tiles for the decision would mean geofencing against simplified
 * geometry, and a report 3 m outside a simplified edge is a real report that
 * quietly does not get escalated.
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node supabase/scripts/seed-hazard-zones.mjs
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import simplify from "@turf/simplify";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.");
  process.exit(1);
}

const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const ASSETS = new URL("../../packages/shared/assets/hazard/", import.meta.url);

const read = (file) => JSON.parse(readFileSync(new URL(file, ASSETS), "utf8"));

/** Postgres wants MultiPolygon; the sources mix Polygon and MultiPolygon. */
function toMultiPolygon(geometry) {
  if (geometry.type === "MultiPolygon") return geometry;
  if (geometry.type === "Polygon") {
    return { type: "MultiPolygon", coordinates: [geometry.coordinates] };
  }
  return null;
}

/** Merge several features into one MultiPolygon so a zone is one row. */
function mergeToMulti(features) {
  const coordinates = [];
  for (const f of features) {
    const multi = toMultiPolygon(f.geometry);
    if (multi) coordinates.push(...multi.coordinates);
  }
  return coordinates.length ? { type: "MultiPolygon", coordinates } : null;
}

const volcanic = read("mayon-volcanic.geojson");
const flood = read("legazpi-flood.geojson");

const rows = [];

/* ── Danger zones ─────────────────────────────────────────────────────────── */

for (const f of volcanic.features.filter((x) => x.properties.layer === "danger_zone")) {
  rows.push({
    kind: "volcanic_danger_zone",
    code: `mayon_${f.properties.zone_id}`,
    label: `Mayon ${f.properties.label}`,
    // The PDZ is meant to be empty of people at all times, so it is the
    // strongest signal on the map. The EDZ is a step below.
    severity: f.properties.zone_id === "pdz" ? 3 : 2,
    is_active: true,
    is_derived: true,
    geometry: toMultiPolygon(f.geometry),
    source: "PHIVOLCS (DOST) — derived from official radius around published summit",
    source_url: "https://gisweb.phivolcs.dost.gov.ph/arcgis/rest/services/PHIVOLCSPublic",
    notes: f.properties.basis,
  });
}

/* ── Volcanic hazard paths ────────────────────────────────────────────────── */

for (const [layer, label, severity] of [
  ["pyroclastic", "Mayon pyroclastic density current path", 3],
  ["lahar", "Mayon lahar channel", 2],
  ["lava", "Mayon lava flow path", 2],
]) {
  const geometry = mergeToMulti(volcanic.features.filter((f) => f.properties.layer === layer));
  if (!geometry) continue;
  rows.push({
    kind: layer,
    code: `mayon_${layer}`,
    label,
    severity,
    is_active: true,
    is_derived: false,
    geometry,
    source: "PHIVOLCS (DOST) — PHIVOLCSPublic ArcGIS service",
    source_url: "https://gisweb.phivolcs.dost.gov.ph/arcgis/rest/services/PHIVOLCSPublic",
    notes: volcanic.metadata?.retrieved_at ? `Retrieved ${volcanic.metadata.retrieved_at}` : null,
  });
}

/* ── Flood ────────────────────────────────────────────────────────────────── */

/**
 * Only the 5-year flood extent goes into Postgres, and only simplified.
 *
 * Two decisions here, both deliberate.
 *
 * WHY ONLY 5-YEAR. All three return periods are drawn on the map from the
 * PMTiles archive. But the 100-year outline covers most of low-lying Legazpi,
 * and escalating every report inside it would mark half the city's potholes
 * high priority — the flag would stop meaning anything inside a week. The
 * 5-year extent is the land that actually floods often, which is the land where
 * a report deserves a second look. The other two need no database row at all:
 * nothing reads them except the renderer, and the renderer reads tiles.
 *
 * WHY SIMPLIFIED. These polygons are vectorised from a 10 m raster, so their
 * edges are pixel staircases — 48 MB of coordinates describing corners that are
 * an artefact of the grid, not of where water goes. Loading them verbatim timed
 * out the statement, and would have made every ST_Intersects slow forever after.
 *
 * A 20 m tolerance is inside the source's own accuracy: a 10 m DEM cannot
 * resolve a flood edge more precisely than that, so this discards artefact, not
 * information. Note the asymmetry with the volcanic zones above, which are
 * loaded at full precision because they are real mapped boundaries.
 */
const FLOOD_GEOFENCE_TOLERANCE_DEG = 0.0002;   // ~22 m at this latitude

const floodGeometry = mergeToMulti(
  flood.features.filter((f) => f.properties.return_period_years === 5)
);

if (floodGeometry) {
  const before = JSON.stringify(floodGeometry).length;
  const simplified = simplify(
    { type: "Feature", geometry: floodGeometry, properties: {} },
    { tolerance: FLOOD_GEOFENCE_TOLERANCE_DEG, highQuality: false, mutate: true }
  ).geometry;
  const after = JSON.stringify(simplified).length;

  console.log(
    `  flood 5yr simplified ${(before / 1024 / 1024).toFixed(1)} MB → ` +
    `${(after / 1024 / 1024).toFixed(2)} MB at ~22 m tolerance\n`
  );

  rows.push({
    kind: "flood",
    code: "legazpi_flood_5yr",
    label: "Legazpi 5-year flood extent",
    severity: 2,
    is_active: true,
    is_derived: false,
    geometry: simplified,
    source: "LiPAD — UP Diliman DREAM / Phil-LiDAR 1",
    source_url: "https://lipad-fmc.dream.upd.edu.ph/",
    notes:
      "Simplified to ~22 m for geofencing, which is within the 10 m source " +
      "raster's own accuracy. The map draws the unsimplified version from PMTiles. " +
      "The 25- and 100-year extents are drawn but deliberately not geofenced.",
  });
}

/* ── Upsert ───────────────────────────────────────────────────────────────── */

console.log(`Seeding ${rows.length} hazard zones…\n`);

for (const row of rows) {
  const { geometry, ...rest } = row;

  // PostgREST cannot cast GeoJSON to geography directly, so the insert goes
  // through an RPC that does ST_GeomFromGeoJSON server-side.
  const { error } = await db.rpc("upsert_hazard_zone", {
    p_kind: rest.kind,
    p_code: rest.code,
    p_label: rest.label,
    p_severity: rest.severity,
    p_is_active: rest.is_active,
    p_is_derived: rest.is_derived,
    p_geojson: JSON.stringify(geometry),
    p_source: rest.source,
    p_source_url: rest.source_url,
    p_notes: rest.notes,
    p_retrieved_at: volcanic.metadata?.retrieved_at ?? new Date().toISOString(),
  });

  const rings = geometry.coordinates.length;
  console.log(
    error
      ? `  ✗ ${rest.code}: ${error.message}`
      : `  ${rest.is_active ? "●" : "○"} ${rest.code.padEnd(26)} sev ${rest.severity}  ${rings} polygon(s)`
  );
}

const { count } = await db
  .from("hazard_zones")
  .select("id", { count: "exact", head: true })
  .eq("is_active", true);

console.log(`\n  ${count} zones active for geofencing (○ = drawn but not geofenced)`);
