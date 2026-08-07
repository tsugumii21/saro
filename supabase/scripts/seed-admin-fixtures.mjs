#!/usr/bin/env node
/**
 * Seed the two tables the resident app cannot fill on its own.
 *
 * supabase/seed.sql covers offices, barangays, routing and reports. It cannot
 * cover these two:
 *
 *   report_media    needs real objects in a private Storage bucket, which SQL
 *                   cannot create.
 *   panic_flags     is written only by register_panic_flag(), and seeding it by
 *                   hand would produce rows the RPC's own logic never would.
 *
 * Without them the evidence export and the panic abuse review are screens with
 * nothing in them, which is the same as not having built them.
 *
 * Reads credentials from the environment only — nothing is written to a file.
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node supabase/scripts/seed-admin-fixtures.mjs
 */

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;

if (!URL || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.");
  process.exit(1);
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });

/** A plausible-looking evidence photo. Not a real scene, and labelled as such
 *  in the image itself so a seeded photo can never be mistaken for evidence. */
async function makePhoto(label, tint) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720">
    <rect width="960" height="720" fill="${tint}"/>
    <rect x="0" y="600" width="960" height="120" fill="rgba(16,23,37,.72)"/>
    <text x="40" y="656" font-family="sans-serif" font-size="34" fill="#fff">${label}</text>
    <text x="40" y="694" font-family="sans-serif" font-size="22" fill="#A9CFE3">SEEDED SAMPLE — NOT REAL EVIDENCE</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 72 }).toBuffer();
}

async function seedMedia() {
  // Resolution photos only make sense on reports that reached 'resolved', and
  // only for categories whose proof rule is 'photo'.
  const { data: photoCategories } = await db
    .from("routing_table")
    .select("category")
    .eq("resolution_proof", "photo");
  const photoSet = new Set((photoCategories ?? []).map((c) => c.category));

  const { data: reports, error } = await db
    .from("reports")
    .select("id, tracking_code, category, status, created_at")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  let evidence = 0;
  let resolution = 0;

  for (const report of reports) {
    // Evidence on roughly every other report, so the export has photos to show
    // for open cases as well as closed ones.
    const wantsEvidence = evidence < 8;
    const wantsResolution = report.status === "resolved" && photoSet.has(report.category);

    for (const kind of [
      ...(wantsEvidence ? ["evidence"] : []),
      ...(wantsResolution ? ["resolution"] : []),
    ]) {
      const buffer = await makePhoto(
        `${report.tracking_code} · ${kind}`,
        kind === "resolution" ? "#2F5D50" : "#3C4A63"
      );
      const path = `${report.id}/${kind}-${Date.now()}.jpg`;

      const { error: uploadError } = await db.storage
        .from("report-photos")
        .upload(path, buffer, { contentType: "image/jpeg", upsert: true });

      if (uploadError) {
        console.warn(`  upload failed for ${report.tracking_code}: ${uploadError.message}`);
        continue;
      }

      const { error: rowError } = await db
        .from("report_media")
        .insert({ report_id: report.id, object_path: path, kind });

      if (rowError) {
        console.warn(`  row failed for ${report.tracking_code}: ${rowError.message}`);
        continue;
      }

      if (kind === "evidence") evidence += 1;
      else resolution += 1;
    }
  }

  console.log(`report_media: ${evidence} evidence, ${resolution} resolution`);
}

async function seedPanicFlags() {
  // Driven through the RPC rather than inserted, so the rows carry the same
  // shape the real thing produces — including rapid_repeat_count, which only
  // increments when two calls land inside fifteen minutes.
  const devices = [
    { token: "dev_seed_panic_a0001", presses: 9, rapid: true },   // the one to look at
    { token: "dev_seed_panic_b0002", presses: 4, rapid: true },
    { token: "dev_seed_panic_c0003", presses: 2, rapid: false },
    { token: "dev_seed_panic_d0004", presses: 1, rapid: false },
  ];

  for (const device of devices) {
    for (let i = 0; i < device.presses; i += 1) {
      const { error } = await db.rpc("register_panic_flag", { token: device.token });
      if (error) {
        console.warn(`  ${device.token}: ${error.message}`);
        break;
      }
    }

    // A device whose presses were spread over days should not read as rapid.
    if (!device.rapid) {
      await db
        .from("panic_flags")
        .update({ rapid_repeat_count: 0, last_rapid_repeat_at: null })
        .eq("device_token", device.token);
    }
  }

  const { count } = await db
    .from("panic_flags")
    .select("device_token", { count: "exact", head: true });
  console.log(`panic_flags: ${count} devices`);
}

console.log("Seeding admin fixtures…");
await seedMedia();
await seedPanicFlags();
console.log("Done.");
