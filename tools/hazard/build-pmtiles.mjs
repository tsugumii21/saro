#!/usr/bin/env node
/**
 * Turn the fetched GeoJSON into a single PMTiles archive.
 *
 * Why not tippecanoe: it is the canonical tool and it is not runnable here —
 * no binary, and no Docker, WSL, Go or Python to host one. Rather than leave
 * the pipeline half-built behind a dependency most contributors will not have,
 * the tiler is written in Node against three permissively-licensed libraries:
 *
 *   geojson-vt  (ISC, Mapbox)  GeoJSON  -> tile-space geometry
 *   vt-pbf      (MIT)          tile     -> Mapbox Vector Tile protobuf
 *   node:zlib                  gzip
 *
 * plus a PMTiles v3 writer implemented below against the published spec. The
 * result is that `npm install && node tools/hazard/build-pmtiles.mjs` works on
 * any machine with Node and nothing else.
 *
 * Why PMTiles at all: the raw GeoJSON is ~56 MB, most of it 10 m flood polygons.
 * Handing that to a phone means a multi-megabyte download and a main-thread
 * JSON.parse before the map draws — during a storm, on a phone, which is the
 * exact moment this map is for. PMTiles is one file, range-requested, so a
 * device fetches only the tiles for where it is looking, and the whole archive
 * can be cached offline by the service worker.
 *
 * Run: node tools/hazard/build-pmtiles.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";

const ASSETS = new URL("../../packages/shared/assets/hazard/", import.meta.url);

const MIN_ZOOM = 5;
const MAX_ZOOM = 13;

/**
 * Zoom 13 is roughly 20 m per pixel at this latitude — enough to see which side
 * of a street a flood polygon reaches, which is the finest distinction anybody
 * makes an evacuation decision on. Beyond that MapLibre overzooms the z13 tile,
 * which costs nothing and looks identical.
 *
 * Zoom 5 is the floor because below it the whole of Albay is a few pixels and
 * the layers are not legible anyway.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * PMTiles v3 writer
 * https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 * ══════════════════════════════════════════════════════════════════════════ */

const COMPRESSION_GZIP = 2;
const TILETYPE_MVT = 1;

/**
 * Tile coordinates to a PMTiles tile id.
 *
 * PMTiles orders tiles along a Hilbert curve rather than row-major, so tiles
 * that are near each other on the map are near each other in the file. That is
 * what makes a range request for one screenful of map touch one contiguous byte
 * range instead of a dozen scattered ones — the whole point of the format.
 */
function zxyToTileId(z, x, y) {
  let acc = 0;
  for (let t = 0; t < z; t += 1) acc += (1 << t) * (1 << t);

  const n = 1 << z;
  let rx;
  let ry;
  let d = 0;
  let tx = x;
  let ty = y;

  for (let s = n >> 1; s > 0; s >>= 1) {
    rx = (tx & s) > 0 ? 1 : 0;
    ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);

    // Rotate the quadrant so the curve stays continuous.
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - tx;
        ty = s - 1 - ty;
      }
      const swap = tx;
      tx = ty;
      ty = swap;
    }
  }

  return acc + d;
}

function writeVarint(bytes, value) {
  let v = value;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v & 0x7f);
}

/**
 * Serialize a directory.
 *
 * Four columnar runs — ids, run lengths, byte lengths, byte offsets — each
 * varint encoded, ids delta-encoded. An offset of 0 is the spec's shorthand for
 * "immediately after the previous entry", which is most of them once tiles are
 * written in Hilbert order, so it compresses to almost nothing.
 */
function serializeDirectory(entries) {
  const bytes = [];
  writeVarint(bytes, entries.length);

  let lastId = 0;
  for (const entry of entries) {
    writeVarint(bytes, entry.tileId - lastId);
    lastId = entry.tileId;
  }
  for (const entry of entries) writeVarint(bytes, entry.runLength);
  for (const entry of entries) writeVarint(bytes, entry.length);

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const previous = entries[i - 1];
    if (i > 0 && previous.offset + previous.length === entry.offset) {
      writeVarint(bytes, 0);
    } else {
      writeVarint(bytes, entry.offset + 1);
    }
  }

  return Buffer.from(bytes);
}

function serializeHeader(h) {
  const buf = Buffer.alloc(127);
  buf.write("PMTiles", 0, "ascii");
  buf.writeUInt8(3, 7);

  buf.writeBigUInt64LE(BigInt(h.rootDirOffset), 8);
  buf.writeBigUInt64LE(BigInt(h.rootDirLength), 16);
  buf.writeBigUInt64LE(BigInt(h.metadataOffset), 24);
  buf.writeBigUInt64LE(BigInt(h.metadataLength), 32);
  buf.writeBigUInt64LE(BigInt(h.leafDirOffset), 40);
  buf.writeBigUInt64LE(BigInt(h.leafDirLength), 48);
  buf.writeBigUInt64LE(BigInt(h.tileDataOffset), 56);
  buf.writeBigUInt64LE(BigInt(h.tileDataLength), 64);
  buf.writeBigUInt64LE(BigInt(h.numAddressedTiles), 72);
  buf.writeBigUInt64LE(BigInt(h.numTileEntries), 80);
  buf.writeBigUInt64LE(BigInt(h.numTileContents), 88);

  buf.writeUInt8(1, 96);                    // clustered: tiles are in tileId order
  buf.writeUInt8(COMPRESSION_GZIP, 97);     // internal (directories + metadata)
  buf.writeUInt8(COMPRESSION_GZIP, 98);     // tile data
  buf.writeUInt8(TILETYPE_MVT, 99);
  buf.writeUInt8(h.minZoom, 100);
  buf.writeUInt8(h.maxZoom, 101);

  const e7 = (v) => Math.round(v * 10_000_000);
  buf.writeInt32LE(e7(h.minLon), 102);
  buf.writeInt32LE(e7(h.minLat), 106);
  buf.writeInt32LE(e7(h.maxLon), 110);
  buf.writeInt32LE(e7(h.maxLat), 114);
  buf.writeUInt8(h.centerZoom, 118);
  buf.writeInt32LE(e7(h.centerLon), 119);
  buf.writeInt32LE(e7(h.centerLat), 123);

  return buf;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tiling
 * ══════════════════════════════════════════════════════════════════════════ */

function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * (1 << z));
}

function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * (1 << z)
  );
}

function boundsOf(collections) {
  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;

  const visit = (coords) => {
    if (typeof coords[0] === "number") {
      minLon = Math.min(minLon, coords[0]);
      maxLon = Math.max(maxLon, coords[0]);
      minLat = Math.min(minLat, coords[1]);
      maxLat = Math.max(maxLat, coords[1]);
      return;
    }
    coords.forEach(visit);
  };

  for (const collection of collections) {
    for (const feature of collection.features) {
      if (feature.geometry?.coordinates) visit(feature.geometry.coordinates);
    }
  }

  return { minLon, minLat, maxLon, maxLat };
}

console.log("Building PMTiles…\n");

/* ── Load ─────────────────────────────────────────────────────────────────── */

const layers = [
  { name: "mayon_volcanic", file: "mayon-volcanic.geojson" },
  { name: "legazpi_flood", file: "legazpi-flood.geojson" },
];

const loaded = [];
for (const layer of layers) {
  const path = new URL(layer.file, ASSETS);
  if (!existsSync(path)) {
    console.error(`  missing ${layer.file} — run fetch-hazards.mjs first`);
    process.exit(1);
  }
  const json = JSON.parse(readFileSync(path, "utf8"));
  console.log(`  ${layer.file}: ${json.features.length} features`);
  loaded.push({ ...layer, json });
}

const bounds = boundsOf(loaded.map((l) => l.json));
console.log(
  `\n  bounds ${bounds.minLon.toFixed(3)},${bounds.minLat.toFixed(3)} → ` +
  `${bounds.maxLon.toFixed(3)},${bounds.maxLat.toFixed(3)}`
);

/* ── Index ────────────────────────────────────────────────────────────────── */

/**
 * Strip provenance before tiling.
 *
 * MVT properties are flat scalars, so vt-pbf serialises a nested object by
 * JSON-stringifying it — and then repeats that string on every feature in every
 * tile it appears in. PHIVOLCS' `source_attributes` is ~400 bytes of mapper
 * names and edit dates, which is worth keeping in the GeoJSON asset and worth
 * nothing on a phone. It was a measurable share of the first build's tile size.
 *
 * Only the fields a map style or a popup actually reads survive.
 */
const TILE_FIELDS = [
  "layer", "zone_id", "label", "radius_km", "derived", "volcano",
  "return_period_years", "depth_class", "depth_label",
];

function slimForTiles(collection) {
  return {
    type: "FeatureCollection",
    features: collection.features.map((f) => {
      const properties = {};
      for (const key of TILE_FIELDS) {
        if (f.properties?.[key] !== undefined && f.properties[key] !== null) {
          properties[key] = f.properties[key];
        }
      }
      return { type: "Feature", geometry: f.geometry, properties };
    }),
  };
}

const indexes = loaded.map((layer) => ({
  name: layer.name,
  index: geojsonvt(slimForTiles(layer.json), {
    maxZoom: MAX_ZOOM,
    indexMaxZoom: MAX_ZOOM,
    indexMaxPoints: 0,      // index everything; these layers are small in count
    // Douglas-Peucker tolerance in tile units at maxZoom.
    //
    // The flood layer is vectorised from a 10 m raster, so its polygon edges
    // are literal pixel staircases — thousands of 90-degree corners carrying no
    // information about where the water actually reaches. At 4096-unit extent
    // and z13, 8 units is roughly 4 m on the ground: far below the accuracy of
    // the underlying model, and it removes the staircase rather than the shape.
    tolerance: 8,
    extent: 4096,
    buffer: 64,             // enough that polygon edges do not seam between tiles
    generateId: true,
  }),
}));

/* ── Emit tiles in Hilbert order ──────────────────────────────────────────── */

const tiles = new Map();

for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 1) {
  const xMin = lonToTileX(bounds.minLon, z);
  const xMax = lonToTileX(bounds.maxLon, z);
  const yMin = latToTileY(bounds.maxLat, z);
  const yMax = latToTileY(bounds.minLat, z);

  let count = 0;
  for (let x = xMin; x <= xMax; x += 1) {
    for (let y = yMin; y <= yMax; y += 1) {
      const perLayer = {};
      let any = false;

      for (const { name, index } of indexes) {
        const tile = index.getTile(z, x, y);
        if (tile && tile.features.length) {
          perLayer[name] = tile;
          any = true;
        }
      }

      if (!any) continue;
      const pbf = vtpbf.fromGeojsonVt(perLayer, { version: 2, extent: 4096 });
      tiles.set(zxyToTileId(z, x, y), gzipSync(Buffer.from(pbf), { level: 9 }));
      count += 1;
    }
  }
  console.log(`  z${String(z).padStart(2)}  ${count} tiles`);
}

const bySize = [...tiles.values()].sort((a, b) => b.length - a.length);
console.log(`\n  ${tiles.size} tiles total`);
console.log(
  `  largest ${(bySize[0].length / 1024).toFixed(0)} KB gzipped · ` +
  `median ${(bySize[Math.floor(bySize.length / 2)].length / 1024).toFixed(1)} KB`
);

/* ── Pack ─────────────────────────────────────────────────────────────────── */

const sortedIds = [...tiles.keys()].sort((a, b) => a - b);

const entries = [];
const chunks = [];
let offset = 0;

// Identical tiles are stored once and referenced twice. Neighbouring empty-ish
// tiles at low zoom are frequently byte-identical, so this is not theoretical.
const seen = new Map();

for (const tileId of sortedIds) {
  const data = tiles.get(tileId);
  const key = data.toString("base64");

  if (seen.has(key)) {
    const previous = seen.get(key);
    entries.push({ tileId, offset: previous.offset, length: previous.length, runLength: 1 });
    continue;
  }

  const entry = { tileId, offset, length: data.length, runLength: 1 };
  entries.push(entry);
  seen.set(key, entry);
  chunks.push(data);
  offset += data.length;
}

const tileData = Buffer.concat(chunks);

const metadata = gzipSync(
  Buffer.from(
    JSON.stringify({
      name: "SARO hazard overlays — Legazpi City",
      description:
        "Mayon Volcano hazard zones (PHIVOLCS) and Legazpi City flood hazard (LiPAD, UP Diliman). " +
        "PDZ and EDZ are derived from official radii around the PHIVOLCS summit coordinate.",
      attribution: "PHIVOLCS (DOST), LiPAD (UP Diliman)",
      generated: new Date().toISOString(),
      generator: "tools/hazard/build-pmtiles.mjs (geojson-vt + vt-pbf, no tippecanoe)",
      vector_layers: [
        {
          id: "mayon_volcanic",
          description: "Mayon danger zones, pyroclastic density currents, lahar and lava paths",
          fields: { layer: "String", zone_id: "String", label: "String", radius_km: "Number", derived: "Boolean" },
        },
        {
          id: "legazpi_flood",
          description: "Flood hazard by return period",
          fields: { layer: "String", return_period_years: "Number", depth_class: "Number" },
        },
      ],
    })
  ),
  { level: 9 }
);

const rootDir = gzipSync(serializeDirectory(entries), { level: 9 });

const HEADER_BYTES = 127;
const rootDirOffset = HEADER_BYTES;
const metadataOffset = rootDirOffset + rootDir.length;
const tileDataOffset = metadataOffset + metadata.length;

const header = serializeHeader({
  rootDirOffset,
  rootDirLength: rootDir.length,
  metadataOffset,
  metadataLength: metadata.length,
  // No leaf directories: the root fits comfortably, so every lookup is answered
  // from the first range request.
  leafDirOffset: 0,
  leafDirLength: 0,
  tileDataOffset,
  tileDataLength: tileData.length,
  numAddressedTiles: entries.length,
  numTileEntries: entries.length,
  numTileContents: chunks.length,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  minLon: bounds.minLon,
  minLat: bounds.minLat,
  maxLon: bounds.maxLon,
  maxLat: bounds.maxLat,
  centerZoom: 11,
  centerLon: (bounds.minLon + bounds.maxLon) / 2,
  centerLat: (bounds.minLat + bounds.maxLat) / 2,
});

const archive = Buffer.concat([header, rootDir, metadata, tileData]);

// Written to both apps' public/ so each deploys standalone — neither app may
// reach into the other, and Vite only serves what is under its own root.
for (const app of ["resident-app", "admin-app"]) {
  const out = new URL(`../../apps/${app}/public/hazard/legazpi-hazards.pmtiles`, import.meta.url);
  writeFileSync(out, archive);
}

console.log(`
  root directory  ${(rootDir.length / 1024).toFixed(1)} KB
  metadata        ${(metadata.length / 1024).toFixed(1)} KB
  tile data       ${(tileData.length / 1024 / 1024).toFixed(2)} MB
  ────────────────────────────
  archive         ${(archive.length / 1024 / 1024).toFixed(2)} MB
  deduplicated    ${entries.length - chunks.length} tiles

  wrote apps/{resident-app,admin-app}/public/hazard/legazpi-hazards.pmtiles`);
