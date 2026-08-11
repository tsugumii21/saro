/**
 * Uploads the seeded reports' evidence images.
 *
 * The images are generated here rather than downloaded: a stock photograph of a
 * person has no business standing in for a flooded street, and anything scraped
 * from the web arrives with a licence nobody checked. These are flat PNGs drawn
 * pixel by pixel — the bucket accepts jpeg/png/webp only — and each one is
 * stamped SAMPLE so nobody mistakes it for a photograph of somebody's property.
 *
 * They go to the same bucket a resident's camera upload does, under a
 * `reports/public/` prefix that carries an anon-readable storage policy. Real
 * evidence keeps the original policy: visible only to the office handling it.
 *
 * Usage:  node supabase/scripts/seed-report-photos.mjs
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY from
 * apps/resident-app/.env.local. The publishable key is enough — uploading report
 * evidence is open to anon by design, since residents file without an account.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "../../apps/resident-app/.env.local");

function readEnv(key) {
  const raw = fs.readFileSync(envPath, "utf8");
  return raw.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
}

const SUPABASE_URL = readEnv("VITE_SUPABASE_URL");
const SUPABASE_KEY = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
const BUCKET = "report-photos";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY in", envPath);
  process.exit(1);
}

/* ── A very small raster canvas ──────────────────────────────────────────── */

const W = 800;
const H = 520;

function canvas(fill) {
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    px[i * 3] = fill[0];
    px[i * 3 + 1] = fill[1];
    px[i * 3 + 2] = fill[2];
  }
  return px;
}

function blend(px, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = Math.round(px[i] * (1 - alpha) + color[0] * alpha);
  px[i + 1] = Math.round(px[i + 1] * (1 - alpha) + color[1] * alpha);
  px[i + 2] = Math.round(px[i + 2] * (1 - alpha) + color[2] * alpha);
}

function rect(px, x0, y0, w, h, color, alpha = 1) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) blend(px, x, y, color, alpha);
}

function ellipse(px, cx, cy, rx, ry, color, alpha = 1) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) blend(px, x, y, color, alpha);
    }
  }
}

function thickLine(px, x1, y1, x2, y2, width, color, alpha = 1) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = Math.round(x1 + (x2 - x1) * t);
    const cy = Math.round(y1 + (y2 - y1) * t);
    ellipse(px, cx, cy, width / 2, width / 2, color, alpha);
  }
}

/* A 5x7 bitmap alphabet, enough for the caption words used below. */
const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
};

function text(px, str, x0, y0, scale, color) {
  let cursor = x0;
  for (const char of str.toUpperCase()) {
    const glyph = GLYPHS[char] ?? GLYPHS[" "];
    glyph.forEach((row, ry) => {
      [...row].forEach((bit, rx) => {
        if (bit === "1") rect(px, cursor + rx * scale, y0 + ry * scale, scale, scale, color);
      });
    });
    cursor += 6 * scale;
  }
}

function png(px) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0; // filter: none
    px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/* ── The scenes ──────────────────────────────────────────────────────────── */

const INK = [15, 23, 37];
const WHITE = [255, 255, 255];

function frame(px, caption, tone) {
  rect(px, 0, H - 92, W, 92, INK, 0.86);
  text(px, caption, 28, H - 66, 4, WHITE);
  rect(px, 28, 28, 190, 40, WHITE, 0.92);
  text(px, "SAMPLE", 44, 38, 4, tone);
}

const SCENES = {
  flood(px) {
    rect(px, 0, 0, W, 300, [220, 233, 247]);
    rect(px, 0, 300, W, H - 300, [180, 199, 218]);
    rect(px, 90, 170, 170, 130, WHITE, 0.9);
    rect(px, 120, 210, 46, 60, INK, 0.3);
    rect(px, 520, 150, 200, 150, WHITE, 0.85);
    rect(px, 580, 200, 56, 66, INK, 0.28);
    for (let i = 0; i < 5; i++) rect(px, 0, 300 + i * 26, W, 18, [37, 99, 235], 0.16 + i * 0.06);
    frame(px, "FLOOD - SAMPLE", [37, 99, 235]);
  },
  pothole(px) {
    rect(px, 0, 0, W, 280, [242, 237, 228]);
    rect(px, 0, 280, W, H - 280, [130, 126, 120]);
    rect(px, 0, 368, W, 10, WHITE, 0.75);
    ellipse(px, 400, 400, 150, 52, [40, 34, 28], 0.85);
    ellipse(px, 400, 392, 118, 38, [90, 60, 20], 0.55);
    frame(px, "ROAD DAMAGE - SAMPLE", [180, 83, 9]);
  },
  debris(px) {
    rect(px, 0, 0, W, 300, [232, 239, 230]);
    rect(px, 0, 300, W, H - 300, [199, 211, 194]);
    thickLine(px, 90, 330, 430, 240, 24, [64, 48, 30], 0.85);
    thickLine(px, 430, 240, 740, 320, 22, [64, 48, 30], 0.85);
    thickLine(px, 250, 292, 210, 190, 12, [21, 128, 61], 0.8);
    thickLine(px, 430, 240, 470, 150, 12, [21, 128, 61], 0.8);
    frame(px, "DEBRIS - SAMPLE", [21, 128, 61]);
  },
  drain(px) {
    rect(px, 0, 0, W, 300, [236, 234, 244]);
    rect(px, 0, 300, W, H - 300, [176, 170, 190]);
    rect(px, 300, 310, 210, 110, [36, 26, 61], 0.85);
    rect(px, 322, 332, 166, 66, [109, 40, 217], 0.5);
    thickLine(px, 280, 310, 250, 420, 10, [109, 40, 217], 0.8);
    thickLine(px, 530, 310, 560, 420, 10, [109, 40, 217], 0.8);
    frame(px, "OPEN DRAIN - SAMPLE", [109, 40, 217]);
  },
};

const IMAGES = [
  { path: "reports/public/seed-bitano-flood.png", scene: "flood" },
  { path: "reports/public/seed-gogon-pothole.png", scene: "pothole" },
  { path: "reports/public/seed-orosite-debris.png", scene: "debris" },
  { path: "reports/public/seed-ems-drain.png", scene: "drain" },
];

let uploaded = 0;
for (const image of IMAGES) {
  const px = canvas([255, 255, 255]);
  SCENES[image.scene](px);
  const body = png(px);

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${image.path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "image/png",
    },
    body,
  });

  if (res.ok) {
    uploaded += 1;
    console.log("uploaded", image.path, `${Math.round(body.length / 1024)} KiB`);
  } else {
    console.error("failed", image.path, res.status, (await res.text()).slice(0, 200));
  }
}

console.log(`\n${uploaded}/${IMAGES.length} evidence images in ${BUCKET}.`);
