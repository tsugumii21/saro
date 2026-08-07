#!/usr/bin/env node
/**
 * Pull the static hazard layers once and write them to the repo as GeoJSON.
 *
 * These datasets do not change day to day — PHIVOLCS remaps a volcano after a
 * major eruption, LiPAD reflies LiDAR every few years — so fetching them live
 * on every map open would be pure cost: slower for the resident, more load on a
 * government server that owes us nothing, and a hard dependency on two
 * third-party hosts being up during exactly the storm when the map matters
 * most. They are bundled instead, and this script is the record of where they
 * came from.
 *
 * Run:  node tools/hazard/fetch-hazards.mjs
 * Then: node tools/hazard/build-pmtiles.mjs
 *
 * Everything here is free and public. No key, no account, no paid tier.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { arcgisToGeoJSON } from "@terraformer/arcgis";
import circle from "@turf/circle";

const OUT = new URL("../../packages/shared/assets/hazard/", import.meta.url);
mkdirSync(OUT, { recursive: true });

/* ── Sources ──────────────────────────────────────────────────────────────── */

const PHIVOLCS = "https://gisweb.phivolcs.dost.gov.ph/arcgis/rest/services/PHIVOLCSPublic";
const LIPAD = "https://lipad-fmc.dream.upd.edu.ph/geoserver/wfs";

/**
 * Mayon summit, from PHIVOLCS's published coordinates.
 *
 * Hard-coded rather than read from the VolcanoLocation service, which has no
 * usable name field (`volcno`, `vtcode`) and returned nothing for a bounding
 * box over the volcano. A summit coordinate is a constant to five decimals; a
 * fragile lookup for it would be worse than a documented literal.
 */
const MAYON_SUMMIT = [123.685278, 13.257222];   // lng, lat — PHIVOLCS / GVP 273030

/**
 * The area we care about. Legazpi City sits on Mayon's southeast flank, so the
 * window is centred on the volcano and wide enough to hold the full hazard
 * footprint plus the city.
 */
const AOI = { xmin: 123.45, ymin: 13.00, xmax: 123.95, ymax: 13.45 };

/* ── PHIVOLCS ─────────────────────────────────────────────────────────────── */

/**
 * PHIVOLCS's ArcGIS Server advertises `Map,Query` but refuses layer-level
 * /query with "The requested capability is not supported". `identify` is
 * enabled, accepts an envelope, and will return geometry — so that is the door
 * that is actually open. Verified against the live service, not assumed.
 */
async function identify(service, layerName) {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ ...AOI, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryEnvelope",
    sr: "4326",
    layers: "all",
    tolerance: "0",
    mapExtent: `${AOI.xmin},${AOI.ymin},${AOI.xmax},${AOI.ymax}`,
    imageDisplay: "2048,2048,96",
    returnGeometry: "true",
    f: "json",
  });

  const url = `${PHIVOLCS}/${service}/MapServer/identify?${params}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${service}: HTTP ${response.status}`);

  const body = await response.json();
  if (body.error) throw new Error(`${service}: ${body.error.message}`);

  const features = (body.results ?? [])
    // Mayon only. The national layers carry every volcano in the Philippines,
    // and shipping Kanlaon's pyroclastic zones to a Legazpi phone is dead
    // weight in a bundle that has to load on a bad connection.
    .filter((r) => String(r.value ?? "").toLowerCase().includes("mayon"))
    .map((r) => ({
      type: "Feature",
      geometry: arcgisToGeoJSON(r.geometry),
      properties: {
        layer: layerName,
        volcano: r.value,
        // Attribute names arrive as display aliases with spaces. Kept verbatim
        // under a single key rather than guessed at, so nothing is silently
        // renamed on the way in.
        source_attributes: r.attributes,
      },
    }));

  console.log(`  PHIVOLCS/${service}: ${features.length} Mayon feature(s)`);
  return features;
}

/* ── Derived danger zones ─────────────────────────────────────────────────── */

/**
 * The 6 km Permanent Danger Zone and 7 km Extended Danger Zone.
 *
 * These are DERIVED, not downloaded, and the distinction matters enough to
 * carry in the data itself (`derived: true`, plus a `basis` string).
 *
 * PHIVOLCS publishes no PDZ/EDZ polygon layer — the public service exposes
 * pyroclastic, lahar, lava and base surge, and nothing else. But the PDZ is not
 * a surveyed boundary in the first place: it is *defined* as a 6 km radius from
 * the summit, and the EDZ as 7 km, extended to 8 km on the northern and
 * northeastern flanks when an eruption is in progress. Generating the circle
 * from the official radius and the official summit coordinate reproduces the
 * definition exactly. Tracing a JPEG hazard map would be strictly worse.
 *
 * The 8 km northern extension is deliberately NOT drawn. It is declared by
 * PHIVOLCS per-eruption, not standing, and a permanently-drawn 8 km ring would
 * either cry wolf between eruptions or be quietly wrong during one.
 */
function dangerZones() {
  const zone = (radiusKm, id, label) => ({
    type: "Feature",
    geometry: circle(MAYON_SUMMIT, radiusKm, { steps: 256, units: "kilometers" }).geometry,
    properties: {
      layer: "danger_zone",
      zone_id: id,
      label,
      radius_km: radiusKm,
      derived: true,
      basis:
        "Generated as a circle of the officially defined radius around the PHIVOLCS " +
        "Mayon summit coordinate. Not a traced or surveyed boundary.",
      volcano: "Mayon",
    },
  });

  console.log("  derived: PDZ 6 km, EDZ 7 km");
  return [
    zone(6, "pdz", "Permanent Danger Zone (6 km)"),
    zone(7, "edz", "Extended Danger Zone (7 km)"),
  ];
}

/* ── LiPAD flood hazard ───────────────────────────────────────────────────── */

/**
 * Legazpi City flood hazard from the LiDAR Portal for Archiving and
 * Distribution (UP Diliman, DREAM / Phil-LiDAR 1).
 *
 * This is the stand-in for MGB's 1:10,000 flood susceptibility maps. MGB's own
 * ArcGIS Server (lgsd.mgb.gov.ph) is unreachable — DNS resolves to
 * 210.213.70.83 but both port 80 and 443 time out, and mgb.gov.ph itself
 * answers 403. Nothing about that is a paid tier; the host is simply not
 * serving. LiPAD is the same national LiDAR programme's output, free, no login,
 * and published as vector rather than raster, which is what makes it tileable.
 *
 * `Var` is the flood depth class. Negative values are the modelled depth bands.
 */
/** Phil-LiDAR flood susceptibility classes that actually represent flooding. */
const HAZARD_CLASSES = new Set([1, 2, 3]);

const DEPTH_LABELS = {
  1: "Low — 0.1 to 0.5 m",
  2: "Medium — 0.5 to 1.5 m",
  3: "High — over 1.5 m",
};

async function lipadFlood(returnPeriod) {
  const typeName = `geonode:ph050506000_fh${returnPeriod}yr_10m`;
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: typeName,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
  });

  const response = await fetch(`${LIPAD}?${params}`, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`LiPAD ${returnPeriod}yr: HTTP ${response.status}`);

  const body = await response.json();

  const features = (body.features ?? [])
    // Only the classes that mean "this floods".
    //
    // `Var` is the Phil-LiDAR flood susceptibility class: 1 low, 2 medium,
    // 3 high. 0 means no flooding — it is the largest polygon in the file by
    // area — and negative values are the sea and nodata masks.
    //
    // Keeping them was a real bug, caught by testing the geofence rather than
    // by reading: merging every class into one extent made the "flood zone"
    // cover the whole municipality plus Albay Gulf, and a test report dropped
    // in open water came back flagged as inside the 5-year flood extent.
    .filter((f) => HAZARD_CLASSES.has(f.properties?.Var))
    .map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        layer: "flood_hazard",
        return_period_years: returnPeriod,
        depth_class: f.properties.Var,
        depth_label: DEPTH_LABELS[f.properties.Var],
        muncode: f.properties?.Muncode ?? null,
      },
    }));

  const dropped = (body.features ?? []).length - features.length;
  console.log(
    `  LiPAD ${returnPeriod}yr flood: ${features.length} hazard feature(s)` +
    ` (dropped ${dropped} no-flood/sea/nodata)`
  );
  return features;
}

/* ── Write ────────────────────────────────────────────────────────────────── */

function write(name, features, meta) {
  const collection = {
    type: "FeatureCollection",
    // Provenance travels with the data. A GeoJSON file with no source in it is
    // one copy away from being unattributable.
    metadata: { ...meta, retrieved_at: new Date().toISOString() },
    features,
  };
  const path = new URL(`${name}.geojson`, OUT);
  writeFileSync(path, JSON.stringify(collection));
  const kb = (JSON.stringify(collection).length / 1024).toFixed(0);
  console.log(`  wrote ${name}.geojson  ${features.length} features  ${kb} KB`);
  return { name, features: features.length, kb: Number(kb), ...meta };
}

console.log("Fetching hazard layers…\n");

const written = [];

console.log("PHIVOLCS (gisweb.phivolcs.dost.gov.ph, ArcGIS Server 10.51, identify):");
const volcanic = [
  ...dangerZones(),
  ...(await identify("Pyroclastic", "pyroclastic")),
  ...(await identify("VolcanoLahar", "lahar")),
  ...(await identify("Lava", "lava")),
  ...(await identify("BaseSurge", "base_surge")),
];

written.push(
  write("mayon-volcanic", volcanic, {
    title: "Mayon Volcano hazard zones",
    source: "PHIVOLCS (DOST) — PHIVOLCSPublic ArcGIS services; PDZ/EDZ derived from official radii",
    source_url: `${PHIVOLCS}`,
    licence: "Philippine government public data. Attribute PHIVOLCS.",
  })
);

console.log("\nLiPAD (lipad-fmc.dream.upd.edu.ph, GeoServer WFS):");
const flood = [];
for (const period of [5, 25, 100]) {
  try {
    flood.push(...(await lipadFlood(period)));
  } catch (err) {
    console.warn(`  ${period}yr failed: ${err.message}`);
  }
}

written.push(
  write("legazpi-flood", flood, {
    title: "Legazpi City flood hazard (5 / 25 / 100-year return periods)",
    source: "LiPAD — UP Diliman DREAM / Phil-LiDAR 1 programme",
    source_url: "https://lipad-fmc.dream.upd.edu.ph/",
    licence: "Open government data, free to use with attribution.",
    note:
      "Substitutes for MGB 1:10,000 flood susceptibility, whose server " +
      "(lgsd.mgb.gov.ph) was unreachable at the time of retrieval.",
  })
);

/* ── Provenance file ──────────────────────────────────────────────────────── */

const sources = `# Hazard data sources

Generated by \`tools/hazard/fetch-hazards.mjs\`. Do not edit by hand — re-run the
script instead, so the retrieval date stays honest.

**Retrieved:** ${new Date().toISOString().slice(0, 10)}

These layers are bundled rather than fetched live. They change on the order of
years, and a resident opening the map during a typhoon should not depend on two
government servers being up.

## When to refresh

| Layer | Refresh when |
|---|---|
| Mayon volcanic hazards | PHIVOLCS republishes after a major eruption |
| PDZ / EDZ | PHIVOLCS changes the official radii |
| Legazpi flood hazard | LiPAD publishes a new LiDAR flight |

Re-run \`node tools/hazard/fetch-hazards.mjs && node tools/hazard/build-pmtiles.mjs\`
and commit the result.

${written.map((w) => `
## ${w.title}

- **File:** \`packages/shared/assets/hazard/${w.name}.geojson\` (${w.features} features, ${w.kb} KB)
- **Source:** ${w.source}
- **URL:** ${w.source_url}
- **Licence:** ${w.licence}${w.note ? `\n- **Note:** ${w.note}` : ""}
`).join("")}

## Access notes

**PHIVOLCS.** The public ArcGIS Server advertises \`Map,Query\` but refuses
layer-level \`/query\` with *"The requested capability is not supported"*.
\`/identify\` is enabled, accepts an envelope, and returns geometry — that is
what this script uses. If a future refresh returns nothing, check whether
\`/query\` has been re-enabled before assuming the data moved.

**PDZ and EDZ are derived, not downloaded.** PHIVOLCS publishes no danger-zone
polygon layer. The zones are *defined* as radii from the summit (6 km permanent,
7 km extended), so they are generated from the official radius and the official
summit coordinate — which reproduces the definition rather than approximating a
picture of it. Every such feature carries \`derived: true\`.

The 8 km northern/northeastern extension is deliberately not drawn: PHIVOLCS
declares it per-eruption rather than permanently, so a standing 8 km ring would
be wrong most of the time and misleadingly reassuring the rest.

**MGB was unreachable.** \`lgsd.mgb.gov.ph\` resolves to 210.213.70.83 but times
out on ports 80 and 443; \`mgb.gov.ph\` returns 403. Their ArcGIS Online org has
79 public items, none of which is the susceptibility layer. This is an
availability problem, not a paywall. If the host comes back, the service is
\`Flood_Landslide_Susceptibility_10K_new_web/MapServer\` and it should replace
the LiPAD substitute.

**PAGASA PANaHON was rejected.** panahon.gov.ph is a socket.io dashboard; there
is no documented REST feed and \`/api/*\` returns 404. Rainfall comes from
Open-Meteo, which needs no key and no account.

## Attribution

Both apps display **"Data: PHIVOLCS, LiPAD (UP Diliman), Open-Meteo"** on every
map view. Keep it there.
`;

writeFileSync(new URL("SOURCES.md", OUT), sources);
console.log("\n  wrote SOURCES.md");
console.log("\nDone. Next: node tools/hazard/build-pmtiles.mjs");
