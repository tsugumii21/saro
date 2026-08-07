// SARO rainfall-poll — caches rainfall so clients never call upstream.
//
// Scheduled by pg_cron (migration 20) every 15 minutes. Clients read the
// `rainfall_observations` table; nothing in either app talks to Open-Meteo
// directly. A thousand phones refreshing during a typhoon is still one upstream
// request per quarter hour.
//
// ── Source ──────────────────────────────────────────────────────────────────
//
// Open-Meteo (api.open-meteo.com). Free, no API key, no account, no paid tier.
// The non-commercial tier asks for under 10,000 requests a day; this makes 96,
// because all stations are fetched in ONE call — the API accepts comma-separated
// coordinates and returns an array. Even at a one-minute schedule it would sit
// at 1,440.
//
// PAGASA's PANaHON was checked first, since ground stations beat model output
// for local accuracy. It is a socket.io dashboard: /api/* returns 404 and the
// only endpoints in the page bundle are websocket libraries. There is no
// documented queryable feed, so relying on it would mean scraping a socket —
// exactly the fragility this project avoids for the alert level too.
//
// Deploy: supabase functions deploy rainfall-poll
// verify_jwt is false so pg_cron can call it with the publishable key alone,
// which keeps the service-role key out of the database. The function only ever
// writes weather it fetched itself, so an unauthorised call costs one upstream
// request and changes nothing an attacker controls.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SB_SECRET_KEY") ??
  "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Sample points across Legazpi and the Mayon flanks.
 *
 * Not real gauges — Open-Meteo is a model, and these are the coordinates it is
 * sampled at. Named for places rather than given station numbers so nobody
 * mistakes them for PAGASA telemetry, and the UI labels them "modelled".
 *
 * Spread deliberately: the city, the coast, and three points around the volcano
 * where lahar starts. Rain on the upper slopes is what puts debris into the
 * channels that reach the city an hour later, and a single city-centre reading
 * would miss it entirely.
 */
const STATIONS = [
  { code: "legazpi_city",   label: "Legazpi City proper",     lat: 13.1391, lng: 123.7438 },
  { code: "legazpi_port",   label: "Legazpi Port / coast",    lat: 13.1470, lng: 123.7560 },
  { code: "mayon_south",    label: "Mayon south flank",       lat: 13.2100, lng: 123.6900 },
  { code: "mayon_southeast",label: "Mayon southeast flank",   lat: 13.2200, lng: 123.7300 },
  { code: "daraga",         label: "Daraga approach",         lat: 13.1500, lng: 123.7100 },
  { code: "santo_domingo",  label: "Santo Domingo (NE)",      lat: 13.2400, lng: 123.7800 },
];

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

async function fetchRainfall() {
  const params = new URLSearchParams({
    latitude: STATIONS.map((s) => s.lat).join(","),
    longitude: STATIONS.map((s) => s.lng).join(","),
    // `precipitation` is the hourly total; the 1h and 24h figures below are
    // derived from it rather than requested separately, which keeps this to one
    // call and one set of numbers that cannot disagree with each other.
    hourly: "precipitation",
    past_days: "1",
    forecast_days: "1",
    timezone: "Asia/Manila",
  });

  const response = await fetch(`${OPEN_METEO}?${params}`, {
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  const body = await response.json();
  // One coordinate returns an object; several return an array. Normalising here
  // means adding or removing a station never changes the parsing below.
  return Array.isArray(body) ? body : [body];
}

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  try {
    const results = await fetchRainfall();
    const now = Date.now();
    const rows = [];

    results.forEach((result, index) => {
      const station = STATIONS[index];
      if (!station || !result?.hourly?.time) return;

      const times: string[] = result.hourly.time;
      const values: number[] = result.hourly.precipitation ?? [];

      // The most recent hour that is not in the future. Open-Meteo returns
      // forecast hours in the same array as observed ones, and publishing a
      // forecast as a current reading would be a lie on a map people use to
      // decide whether to move.
      let current = -1;
      for (let i = 0; i < times.length; i += 1) {
        if (new Date(`${times[i]}+08:00`).getTime() <= now) current = i;
        else break;
      }
      if (current < 0) return;

      const sum = (from: number) =>
        values
          .slice(Math.max(0, from), current + 1)
          .reduce((total, v) => total + (Number(v) || 0), 0);

      rows.push({
        station_code: station.code,
        station_label: station.label,
        lat: station.lat,
        lng: station.lng,
        observed_at: new Date(`${times[current]}+08:00`).toISOString(),
        precip_mm: Number(values[current]) || 0,
        precip_1h_mm: Number(values[current]) || 0,
        precip_24h_mm: Number(sum(current - 23).toFixed(2)),
        source: "open-meteo",
      });
    });

    if (!rows.length) {
      return jsonResponse(request, { stored: 0, note: "no observed hours yet" });
    }

    // Idempotent on (station_code, observed_at), so running twice inside one
    // hour updates rather than duplicating — which matters because pg_cron
    // retries and because this endpoint is callable without a JWT.
    const { error } = await admin
      .from("rainfall_observations")
      .upsert(rows, { onConflict: "station_code,observed_at" });

    if (error) {
      console.error("rainfall upsert failed:", error.message);
      return jsonResponse(request, { error: error.message }, 500);
    }

    // Keep the table small. Two days is enough for a 24-hour total plus a
    // margin; nothing in either app reads further back, and an unbounded cache
    // on a free tier is a slow leak.
    const cutoff = new Date(now - 48 * 3_600_000).toISOString();
    await admin.from("rainfall_observations").delete().lt("observed_at", cutoff);

    return jsonResponse(request, {
      stored: rows.length,
      observed_at: rows[0].observed_at,
      wettest: rows.reduce((a, b) => (b.precip_24h_mm > a.precip_24h_mm ? b : a)).station_label,
    });
  } catch (err) {
    console.error("rainfall-poll failed:", err);
    return jsonResponse(request, { error: "Could not refresh rainfall." }, 502);
  }
});
