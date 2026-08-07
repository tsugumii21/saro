import { PMTiles, FetchSource } from "pmtiles";
import { readFileSync } from "node:fs";

const buf = readFileSync("apps/resident-app/public/hazard/legazpi-hazards.pmtiles");
class BufSource {
  getKey(){ return "local"; }
  async getBytes(offset, length){ return { data: buf.buffer.slice(buf.byteOffset+offset, buf.byteOffset+offset+length) }; }
}
const p = new PMTiles(new BufSource());
const h = await p.getHeader();
console.log("header parsed by protomaps/pmtiles:");
console.log("  specVersion   ", h.specVersion);
console.log("  tileType      ", h.tileType, "(1 = MVT)");
console.log("  zoom          ", h.minZoom, "-", h.maxZoom);
console.log("  bounds        ", h.minLon.toFixed(3), h.minLat.toFixed(3), h.maxLon.toFixed(3), h.maxLat.toFixed(3));
console.log("  addressedTiles", h.numAddressedTiles, " entries", h.numTileEntries, " contents", h.numTileContents);
console.log("  clustered     ", h.clustered);

const meta = await p.getMetadata();
console.log("  metadata name ", meta.name);
console.log("  vector_layers ", meta.vector_layers.map(l=>l.id).join(", "));

// Legazpi city centre at z13
const z=13, x=Math.floor(((123.7438+180)/360)*(1<<z));
const rad=13.1391*Math.PI/180;
const y=Math.floor(((1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2)*(1<<z));
const t = await p.getZxy(z,x,y);
console.log(`\n  tile z${z}/${x}/${y}: ${t ? t.data.byteLength+" bytes" : "MISSING"}`);
if (t) {
  // pmtiles already applies the archive's tileCompression on read, so t.data
  // is a decompressed MVT here — gunzipping again is what "incorrect header
  // check" was telling us.
  const raw = Buffer.from(t.data);
  const { VectorTile } = await import("@mapbox/vector-tile");
  // pbf v5 exports PbfReader/PbfWriter rather than a default constructor.
  const { PbfReader } = await import("pbf");
  const vt = new VectorTile(new PbfReader(raw));
  for (const name of Object.keys(vt.layers)) {
    const L = vt.layers[name];
    console.log(`    layer "${name}": ${L.length} features`);
    if (L.length) console.log("      sample props:", JSON.stringify(L.feature(0).properties).slice(0,140));
  }
}
