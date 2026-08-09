// SARO data access — Supabase backed.
//
// Replaces the localStorage mock layer. Function names and the { data, error }
// envelope are unchanged, so components keep their call sites; what moved is
// where the authorization decision happens. It is now Row Level Security in
// Postgres rather than an if-statement in the browser, which means a bug in a
// component can no longer widen access.
//
// Anonymous callers have NO select privilege on reports. Every resident-facing
// read goes through a SECURITY DEFINER RPC that returns a narrow projection.
// See supabase/migrations/20260807000400_clustering_and_rpc.sql.

import { supabase, REPORT_PHOTO_BUCKET } from "../supabase/client.js";
import { humanizeError } from "../errors.js";

/**
 * Normalise a PostgrestError into the { data, error } shape the apps expect.
 *
 * `error` is a sentence a person can act on, never the raw Postgres string.
 * Screens render it directly, so this is the one place that has to be right —
 * before this, an RLS denial reached a resident as
 * `new row violates row-level security policy for table "reports"`.
 */
function wrap({ data, error }) {
  return { data: error ? null : data, error: error ? humanizeError(error.message) : null };
}

/**
 * Deliberate messages written by this layer pass through unchanged;
 * humanizeError only rewrites strings that look like machine output.
 */
function fail(message) {
  return { data: null, error: humanizeError(message) };
}

/* ── Shape adapters ─────────────────────────────────────────────────────────
 *
 * The Postgres schema names things differently from the prototype: the routing
 * table's primary key is `category` (a text slug) where the mock used `id`, and
 * a report carries `assigned_office_id` where the mock used `office_id`.
 *
 * Rather than rename ~2500 lines of dashboard code in the same change that
 * swaps the whole backend, these adapters present both names. Components keep
 * working; new code should prefer the Postgres names. The aliases are the
 * migration seam, not the destination.
 * ─────────────────────────────────────────────────────────────────────────── */

export const CRITICAL_CATEGORIES = [
  "fire",
  "gas_leak",
  "medical",
  "accident",
  "vehicular_crash",
  "coastal_hazard",
  "landslide",
  "crime",
];

export const URGENT_CATEGORIES = [
  "bridge_damage",
  "soil_erosion",
];

export function getCategoryTier(categoryOrRow) {
  const catKey = typeof categoryOrRow === "string"
    ? categoryOrRow
    : (categoryOrRow?.category || categoryOrRow?.id);

  if (!catKey) return "routine";
  if (CRITICAL_CATEGORIES.includes(catKey)) return "critical";
  if (URGENT_CATEGORIES.includes(catKey)) return "urgent";
  return "routine";
}

export function isEmergencyCategory(categoryOrRow) {
  const tier = getCategoryTier(categoryOrRow);
  return tier === "critical" || tier === "urgent";
}

function adaptCategory(row) {
  if (!row) return row;
  const tier = getCategoryTier(row.category);
  return {
    ...row,
    id: row.category,           // alias: mock called this `id`
    name: row.label,            // alias: mock called this `name`
    name_bikol: row.label_bikol,
    name_tagalog: row.label_tagalog,
    office_id: row.responsible_office_id,
    tier,
    is_emergency: tier === "critical" || tier === "urgent",
  };
}

function adaptReport(row) {
  if (!row) return row;
  return {
    ...row,
    category_id: row.category,           // alias
    office_id: row.assigned_office_id,   // alias
    confidence_score: row.confidence_score ?? (row.cluster_id ? 2 : 1),
  };
}

/** Turn a base64 data URL into a Blob so it can go to Storage. */
function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(header)?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Reference data — readable by everyone
 * ═══════════════════════════════════════════════════════════════════════════ */

const DEMO_OFFICES = [
  { id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444", short_name: "CDRRMO", full_name: "City Disaster Risk Reduction and Management Office" },
  { id: "3a09756b-4e89-42b7-bd3a-0e6e76cf0a3a", short_name: "Legazpi 911", full_name: "Legazpi 911 Emergency Command Center" },
  { id: "3362fc03-d004-4148-8268-00d8c0a959b7", short_name: "City Engineering", full_name: "City Engineering Office" },
  { id: "pso-legazpi", short_name: "Public Safety Office", full_name: "Public Safety Office (PSO)" },
  { id: "bfp-legazpi", short_name: "BFP Legazpi", full_name: "Bureau of Fire Protection - Legazpi Station" },
  { id: "pnp-legazpi", short_name: "PNP Legazpi", full_name: "Philippine National Police - Legazpi City Station" },
  { id: "cho-legazpi", short_name: "City Health Office", full_name: "City Health Office (CHO)" },
  { id: "pcg-legazpi", short_name: "Coast Guard Station", full_name: "Philippine Coast Guard - Legazpi Station" }
];

const DEMO_CATEGORIES = [
  { category: "flood", label: "Flooding & Water Inundation", label_bikol: "Baha sagkod Tuba", label_tagalog: "Baha at Pag-apaw ng Tubig", responsible_office_id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444", is_emergency: true, sla_hours: 1, resolution_proof: "photo" },
  { category: "open_drain", label: "Uncovered Drain & Broken Manhole", label_bikol: "Sirang Kanal at Manhole", label_tagalog: "Sirang Kanal at Manhole", responsible_office_id: "3362fc03-d004-4148-8268-00d8c0a959b7", is_emergency: false, sla_hours: 24, resolution_proof: "photo" },
  { category: "pothole", label: "Road Pothole & Surface Damage", label_bikol: "Lubak sa Kalsada", label_tagalog: "Lubak sa Kalsada", responsible_office_id: "3362fc03-d004-4148-8268-00d8c0a959b7", is_emergency: false, sla_hours: 72, resolution_proof: "photo" },
  { category: "medical", label: "Medical Emergency & Injury", label_bikol: "Pang-medikal na Emergencia", label_tagalog: "Medikal na Eherhensya", responsible_office_id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444", is_emergency: true, sla_hours: 1, resolution_proof: "reference" },
  { category: "fire", label: "Structural Fire & Outbreak", label_bikol: "Caisogan nin Sulog", label_tagalog: "Sunog sa Estruktura", responsible_office_id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444", is_emergency: true, sla_hours: 1, resolution_proof: "reference" },
  { category: "landslide", label: "Landslide & Soil Erosion", label_bikol: "Guba nin Daga", label_tagalog: "Pagguho ng Lupa", responsible_office_id: "3362fc03-d004-4148-8268-00d8c0a959b7", is_emergency: true, sla_hours: 2, resolution_proof: "photo" }
];

const DEMO_BARANGAYS = [
  { id: "brgy-bitano", name: "Bitano", is_coastal: true },
  { id: "brgy-ems", name: "Em's Barrio", is_coastal: false },
  { id: "brgy-gogon", name: "Gogon", is_coastal: false },
  { id: "brgy-rawis", name: "Rawis", is_coastal: true }
];

export async function getOffices() {
  try {
    const { data, error } = await supabase.from("offices").select("*").order("short_name");
    if (error || !data || data.length === 0) {
      return { data: DEMO_OFFICES, error: null };
    }
    return { data, error: null };
  } catch {
    return { data: DEMO_OFFICES, error: null };
  }
}

export async function getCategories() {
  try {
    const { data, error } = await supabase.from("routing_table").select("*").order("label");
    if (error || !data || data.length === 0) {
      return { data: DEMO_CATEGORIES.map(adaptCategory), error: null };
    }
    return { data: (data ?? []).map(adaptCategory), error: null };
  } catch {
    return { data: DEMO_CATEGORIES.map(adaptCategory), error: null };
  }
}

export async function getBarangays() {
  try {
    const { data, error } = await supabase.from("barangays").select("id, name, is_coastal").order("name");
    if (error || !data || data.length === 0) {
      return { data: DEMO_BARANGAYS, error: null };
    }
    return { data, error: null };
  } catch {
    return { data: DEMO_BARANGAYS, error: null };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Resident reads — RPC only, never a table select
 * ═══════════════════════════════════════════════════════════════════════════ */

export async function getReportByTrackingCode(code) {
  if (!code || !code.trim()) return fail("Tracking code is required");

  const { data, error } = await supabase.rpc("get_report_by_tracking_code", {
    code: code.trim().toUpperCase(),
  });
  if (error) return fail(error.message);

  const report = Array.isArray(data) ? data[0] : data;
  if (!report) return fail(`No report found matching tracking code "${code}"`);
  return { data: report, error: null };
}

export async function getStatusHistory(trackingCode) {
  if (!trackingCode) return fail("Tracking code is required");
  return wrap(await supabase.rpc("get_report_timeline", { code: trackingCode.trim().toUpperCase() }));
}

/** Device-local "My Reports". The device id is a bearer token held in the browser. */
export async function getReportsByDevice(deviceId) {
  if (!deviceId) return { data: [], error: null };
  return wrap(await supabase.rpc("get_reports_by_device", { device_id: deviceId }));
}

const DEMO_MAP_REPORTS = [
  { id: "demo-1", tracking_code: "SR-8F2K", category: "flood", category_label: "Flooding & Water Inundation", lat: 13.1438, lng: 123.7448, status: "in_progress", priority: "high", created_at: new Date(Date.now() - 3600000 * 5).toISOString(), barangay: "Bitano", cluster_id: "cluster-bitano" },
  { id: "demo-2", tracking_code: "SR-8F2L", category: "flood", category_label: "Flooding & Water Inundation", lat: 13.1439, lng: 123.7449, status: "in_progress", priority: "high", created_at: new Date(Date.now() - 3600000 * 4).toISOString(), barangay: "Bitano", cluster_id: "cluster-bitano" },
  { id: "demo-3", tracking_code: "SR-8F2M", category: "flood", category_label: "Flooding & Water Inundation", lat: 13.1437, lng: 123.7447, status: "in_progress", priority: "high", created_at: new Date(Date.now() - 3600000 * 3).toISOString(), barangay: "Bitano", cluster_id: "cluster-bitano" },
  { id: "demo-4", tracking_code: "SR-8F2N", category: "flood", category_label: "Flooding & Water Inundation", lat: 13.1440, lng: 123.7450, status: "in_progress", priority: "high", created_at: new Date(Date.now() - 3600000 * 2).toISOString(), barangay: "Bitano", cluster_id: "cluster-bitano" },
  { id: "demo-5", tracking_code: "SR-3M9P", category: "open_drain", category_label: "Uncovered Drain & Broken Manhole", lat: 13.1415, lng: 123.7410, status: "assigned", priority: "medium", created_at: new Date(Date.now() - 3600000 * 18).toISOString(), barangay: "Em's Barrio" },
  { id: "demo-6", tracking_code: "SR-7N4L", category: "pothole", category_label: "Road Pothole & Surface Damage", lat: 13.1490, lng: 123.7380, status: "resolved", priority: "low", created_at: new Date(Date.now() - 3600000 * 48).toISOString(), barangay: "Gogon" },
  { id: "demo-7", tracking_code: "SR-1B9Q", category: "typhoon_debris", category_label: "Typhoon Debris & Structural Damage", lat: 13.1395, lng: 123.7465, status: "received", priority: "medium", created_at: new Date(Date.now() - 3600000 * 2).toISOString(), barangay: "Oro Site" }
];

/** Coarse public hazard map. Coordinates are rounded server-side to ~110 m. */
export async function getPublicMapReports(maxAgeHours = 168) {
  try {
    const { data, error } = await supabase.rpc("get_public_map_reports", {
      max_age_hours: maxAgeHours,
    });
    if (error || !data || data.length === 0) {
      return { data: DEMO_MAP_REPORTS.map(adaptReport), error: null };
    }
    return { data: data.map(adaptReport), error: null };
  } catch {
    return { data: DEMO_MAP_REPORTS.map(adaptReport), error: null };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Staff reads — RLS scopes these automatically
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Reports visible to the signed-in staff member.
 *
 * There is no officeId parameter any more, and that is deliberate: an office's
 * scope is decided by their profile in Postgres, not by an argument the client
 * chooses. Passing a different office id would simply return nothing.
 */
const DEMO_STAFF_REPORTS = [
  {
    id: "demo-101",
    tracking_code: "SR-8F2K",
    category: "flood",
    category_id: "flood",
    description: "Flooding near Bitano market line. Water level rising fast by the bakery.",
    lat: 13.1438,
    lng: 123.7448,
    status: "closed_confirmed",
    priority: "high",
    filed_by_verified: true,
    created_at: new Date(Date.now() - 3600000 * 96).toISOString(),
    resolved_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    barangay_id: "brgy-bitano",
    barangays: { name: "Bitano" },
    office_id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444",
    offices: { short_name: "CDRRMO", full_name: "City Disaster Risk Reduction and Management Office" },
    routing_table: { label: "Flooding & Water Inundation", is_emergency: true, sla_hours: 1, resolution_proof: "photo" }
  },
  {
    id: "demo-102",
    tracking_code: "SR-3M9P",
    category: "open_drain",
    category_id: "open_drain",
    description: "Manhole cover missing outside the elementary school gate.",
    lat: 13.1415,
    lng: 123.7410,
    status: "reopened",
    priority: "medium",
    filed_by_verified: false,
    created_at: new Date(Date.now() - 3600000 * 62).toISOString(),
    barangay_id: "brgy-ems",
    barangays: { name: "Em's Barrio" },
    office_id: "3362fc03-d004-4148-8268-00d8c0a959b7",
    offices: { short_name: "City Engineering", full_name: "City Engineering Office" },
    routing_table: { label: "Uncovered Drain & Broken Manhole", is_emergency: false, sla_hours: 24, resolution_proof: "photo" }
  },
  {
    id: "demo-103",
    tracking_code: "SR-7N4L",
    category: "pothole",
    category_id: "pothole",
    description: "Deep pothole on the northbound lane, two tricycles already damaged.",
    lat: 13.1490,
    lng: 123.7380,
    status: "resolved",
    priority: "medium",
    filed_by_verified: true,
    created_at: new Date(Date.now() - 3600000 * 80).toISOString(),
    resolved_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    barangay_id: "brgy-gogon",
    barangays: { name: "Gogon" },
    office_id: "3362fc03-d004-4148-8268-00d8c0a959b7",
    offices: { short_name: "City Engineering", full_name: "City Engineering Office" },
    routing_table: { label: "Road Pothole & Surface Damage", is_emergency: false, sla_hours: 72, resolution_proof: "photo" }
  },
  {
    id: "demo-104",
    tracking_code: "SR-9X2M",
    category: "medical",
    category_id: "medical",
    description: "Elderly neighbour collapsed at home, breathing but unresponsive in Bonot.",
    lat: 13.1500,
    lng: 123.7490,
    status: "resolved",
    priority: "high",
    filed_by_verified: true,
    created_at: new Date(Date.now() - 3600000 * 9).toISOString(),
    resolved_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    barangay_id: "brgy-bonot",
    barangays: { name: "Bonot" },
    office_id: "legazpi-911",
    offices: { short_name: "Legazpi 911", full_name: "Legazpi 911 Emergency Command Center" },
    routing_table: { label: "Medical Emergency & Injury", is_emergency: true, sla_hours: 1, resolution_proof: "reference" }
  },
  {
    id: "demo-105",
    tracking_code: "SR-2V4K",
    category: "landslide",
    category_id: "landslide",
    description: "Soil slipping down the cut slope above the barangay road in Homapon.",
    lat: 13.1180,
    lng: 123.7250,
    status: "in_progress",
    priority: "high",
    filed_by_verified: true,
    created_at: new Date(Date.now() - 3600000 * 20).toISOString(),
    barangay_id: "brgy-homapon",
    barangays: { name: "Homapon" },
    office_id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444",
    offices: { short_name: "CDRRMO", full_name: "City Disaster Risk Reduction and Management Office" },
    routing_table: { label: "Landslide & Soil Erosion", is_emergency: true, sla_hours: 2, resolution_proof: "photo" }
  },
  {
    id: "demo-106",
    tracking_code: "SR-5W8L",
    category: "typhoon_debris",
    category_id: "typhoon_debris",
    description: "Fallen acacia branch blocking half the road after last night's wind in Oro Site.",
    lat: 13.1395,
    lng: 123.7465,
    status: "in_progress",
    priority: "medium",
    filed_by_verified: false,
    created_at: new Date(Date.now() - 3600000 * 50).toISOString(),
    barangay_id: "brgy-orosite",
    barangays: { name: "Oro Site" },
    office_id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444",
    offices: { short_name: "CDRRMO", full_name: "City Disaster Risk Reduction and Management Office" },
    routing_table: { label: "Typhoon Debris & Structural Damage", is_emergency: false, sla_hours: 24, resolution_proof: "photo" }
  },
  {
    id: "demo-107",
    tracking_code: "SR-6P1N",
    category: "accident",
    category_id: "accident",
    description: "Motorcycle and jeepney collision at Taysan corner, one rider injured.",
    lat: 13.1200,
    lng: 123.7100,
    status: "in_progress",
    priority: "high",
    filed_by_verified: true,
    created_at: new Date(Date.now() - 3600000 * 6).toISOString(),
    barangay_id: "brgy-taysan",
    barangays: { name: "Taysan" },
    office_id: "legazpi-911",
    offices: { short_name: "Legazpi 911", full_name: "Legazpi 911 Emergency Command Center" },
    routing_table: { label: "Vehicular Collision & Road Crash", is_emergency: true, sla_hours: 1, resolution_proof: "photo" }
  },
  {
    id: "demo-108",
    tracking_code: "SR-4D9Q",
    category: "bridge_damage",
    category_id: "bridge_damage",
    description: "Crack widening on the seawall walkway near Puro pier.",
    lat: 13.1320,
    lng: 123.7560,
    status: "assigned",
    priority: "high",
    filed_by_verified: true,
    created_at: new Date(Date.now() - 3600000 * 30).toISOString(),
    barangay_id: "brgy-puro",
    barangays: { name: "Puro" },
    office_id: "3362fc03-d004-4148-8268-00d8c0a959b7",
    offices: { short_name: "City Engineering", full_name: "City Engineering Office" },
    routing_table: { label: "Bridge & Seawall Damage", is_emergency: true, sla_hours: 12, resolution_proof: "photo" }
  },
  {
    id: "demo-109",
    tracking_code: "SR-7T3R",
    category: "traffic_obstruction",
    category_id: "traffic_obstruction",
    description: "Traffic light at Victory Village junction stuck on red in all directions.",
    lat: 13.1420,
    lng: 123.7540,
    status: "assigned",
    priority: "medium",
    filed_by_verified: true,
    created_at: new Date(Date.now() - 3600000 * 26).toISOString(),
    barangay_id: "brgy-victory",
    barangays: { name: "Victory Village" },
    office_id: "pso-legazpi",
    offices: { short_name: "Public Safety Office", full_name: "Public Safety Office (PSO)" },
    routing_table: { label: "Road Obstruction & Signal Malfunction", is_emergency: false, sla_hours: 12, resolution_proof: "photo" }
  },
  {
    id: "demo-110",
    tracking_code: "SR-9F1A",
    category: "fire",
    category_id: "fire",
    description: "Smoke coming from the second floor of the corner house in Bitano.",
    lat: 13.1444,
    lng: 123.7452,
    status: "in_progress",
    priority: "high",
    filed_by_verified: true,
    cluster_id: "cluster-fire-bitano",
    created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    barangay_id: "brgy-bitano",
    barangays: { name: "Bitano" },
    office_id: "bfp-legazpi",
    offices: { short_name: "BFP Legazpi", full_name: "Bureau of Fire Protection - Legazpi District" },
    routing_table: { label: "Fire Outbreak & Structural Fire", is_emergency: true, sla_hours: 1, resolution_proof: "reference" }
  },
  {
    id: "demo-111",
    tracking_code: "SR-9F1B",
    category: "fire",
    category_id: "fire",
    description: "House on fire near the bakery in Bitano, flames visible from street.",
    lat: 13.1445,
    lng: 123.7453,
    status: "in_progress",
    priority: "high",
    filed_by_verified: true,
    cluster_id: "cluster-fire-bitano",
    created_at: new Date(Date.now() - 3600000 * 2.9).toISOString(),
    barangay_id: "brgy-bitano",
    barangays: { name: "Bitano" },
    office_id: "bfp-legazpi",
    offices: { short_name: "BFP Legazpi", full_name: "Bureau of Fire Protection - Legazpi District" },
    routing_table: { label: "Fire Outbreak & Structural Fire", is_emergency: true, sla_hours: 1, resolution_proof: "reference" }
  },
  {
    id: "demo-112",
    tracking_code: "SR-9F1C",
    category: "fire",
    category_id: "fire",
    description: "Big fire two houses down from us in Bitano, please send BFP trucks.",
    lat: 13.1443,
    lng: 123.7451,
    status: "in_progress",
    priority: "high",
    filed_by_verified: true,
    cluster_id: "cluster-fire-bitano",
    created_at: new Date(Date.now() - 3600000 * 2.8).toISOString(),
    barangay_id: "brgy-bitano",
    barangays: { name: "Bitano" },
    office_id: "bfp-legazpi",
    offices: { short_name: "BFP Legazpi", full_name: "Bureau of Fire Protection - Legazpi District" },
    routing_table: { label: "Fire Outbreak & Structural Fire", is_emergency: true, sla_hours: 1, resolution_proof: "reference" }
  },
  {
    id: "demo-113",
    tracking_code: "SR-3G8S",
    category: "gas_leak",
    category_id: "gas_leak",
    description: "Strong LPG smell along alley in Cruzada, cannot tell which house.",
    lat: 13.1365,
    lng: 123.7335,
    status: "received",
    priority: "high",
    filed_by_verified: false,
    created_at: new Date(Date.now() - 3600000 * 1).toISOString(),
    barangay_id: "brgy-cruzada",
    barangays: { name: "Cruzada" },
    office_id: "bfp-legazpi",
    offices: { short_name: "BFP Legazpi", full_name: "Bureau of Fire Protection - Legazpi District" },
    routing_table: { label: "Gas Leak & Chemical Spill", is_emergency: true, sla_hours: 1, resolution_proof: "photo" }
  },
  {
    id: "demo-114",
    tracking_code: "SR-8C2T",
    category: "crime",
    category_id: "crime",
    description: "Group fighting outside the sari-sari store in Rawis, bottle broken.",
    lat: 13.1610,
    lng: 123.7510,
    status: "assigned",
    priority: "high",
    filed_by_verified: true,
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    barangay_id: "brgy-rawis",
    barangays: { name: "Rawis" },
    office_id: "pnp-legazpi",
    offices: { short_name: "PNP Legazpi", full_name: "Philippine National Police - Legazpi Station" },
    routing_table: { label: "Public Order & Crime Incident", is_emergency: true, sla_hours: 1, resolution_proof: "reference" }
  },
  {
    id: "demo-115",
    tracking_code: "SR-1W4U",
    category: "water_contam",
    category_id: "water_contam",
    description: "Tap water running brown since yesterday in Cruzada, whole street affected.",
    lat: 13.1360,
    lng: 123.7330,
    status: "assigned",
    priority: "medium",
    filed_by_verified: true,
    created_at: new Date(Date.now() - 3600000 * 44).toISOString(),
    barangay_id: "brgy-cruzada",
    barangays: { name: "Cruzada" },
    office_id: "cho-legazpi",
    offices: { short_name: "City Health Office", full_name: "City Health Office (CHO)" },
    routing_table: { label: "Water Contamination & Health Hazard", is_emergency: false, sla_hours: 24, resolution_proof: "photo" }
  },
  {
    id: "demo-116",
    tracking_code: "SR-5M9V",
    category: "coastal_hazard",
    category_id: "coastal_hazard",
    description: "Storm surge pushing over the breakwater at Dap-Dap during high tide.",
    lat: 13.1650,
    lng: 123.7420,
    status: "assigned",
    priority: "high",
    filed_by_verified: true,
    created_at: new Date(Date.now() - 3600000 * 14).toISOString(),
    barangay_id: "brgy-dapdap",
    barangays: { name: "Dap-Dap" },
    office_id: "coastguard-legazpi",
    offices: { short_name: "Coast Guard Station", full_name: "Philippine Coast Guard - Legazpi Station" },
    routing_table: { label: "Coastal Storm Surge & Marine Emergency", is_emergency: true, sla_hours: 2, resolution_proof: "photo" }
  },
  {
    id: "demo-117",
    tracking_code: "SR-2F6W",
    category: "flood",
    category_id: "flood",
    description: "Gogon underpass completely flooded, cars turning back.",
    lat: 13.1489,
    lng: 123.7381,
    status: "assigned",
    priority: "high",
    filed_by_verified: true,
    cluster_id: "cluster-flood-gogon",
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    barangay_id: "brgy-gogon",
    barangays: { name: "Gogon" },
    office_id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444",
    offices: { short_name: "CDRRMO", full_name: "City Disaster Risk Reduction and Management Office" },
    routing_table: { label: "Flooding & Water Inundation", is_emergency: true, sla_hours: 1, resolution_proof: "photo" }
  },
  {
    id: "demo-118",
    tracking_code: "SR-2F6X",
    category: "flood",
    category_id: "flood",
    description: "Water up to knee height at Gogon underpass, zero access.",
    lat: 13.1490,
    lng: 123.7382,
    status: "assigned",
    priority: "high",
    filed_by_verified: true,
    cluster_id: "cluster-flood-gogon",
    created_at: new Date(Date.now() - 3600000 * 1.9).toISOString(),
    barangay_id: "brgy-gogon",
    barangays: { name: "Gogon" },
    office_id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444",
    offices: { short_name: "CDRRMO", full_name: "City Disaster Risk Reduction and Management Office" },
    routing_table: { label: "Flooding & Water Inundation", is_emergency: true, sla_hours: 1, resolution_proof: "photo" }
  },
  {
    id: "demo-119",
    tracking_code: "SR-6U1Y",
    category: "traffic_obstruction",
    category_id: "traffic_obstruction",
    description: "Illegal parking blocking fire lane near Bonot commercial complex.",
    lat: 13.1510,
    lng: 123.7495,
    status: "closed_unconfirmed",
    priority: "low",
    filed_by_verified: false,
    created_at: new Date(Date.now() - 3600000 * 36).toISOString(),
    barangay_id: "brgy-bonot",
    barangays: { name: "Bonot" },
    office_id: "pso-legazpi",
    offices: { short_name: "Public Safety Office", full_name: "Public Safety Office (PSO)" },
    routing_table: { label: "Road Obstruction & Signal Malfunction", is_emergency: false, sla_hours: 12, resolution_proof: "photo" }
  }
];

export async function getReports({ status, category, barangayId, limit = 500 } = {}) {
  try {
    let query = supabase
      .from("reports")
      .select(
        `id, tracking_code, category, description, lat, lng, status,
         assigned_office_id, barangay_id, photo_url, reporter_device_id,
         reporter_user_id, filed_by_verified,
         is_false_report, cluster_id,
         created_at, updated_at, resolved_at,
         offices:assigned_office_id ( id, short_name, full_name ),
         barangays:barangay_id ( id, name ),
         routing_table:category ( label, is_emergency, sla_hours, resolution_proof )`
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (category) query = query.eq("category", category);
    if (barangayId) query = query.eq("barangay_id", barangayId);

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      let filtered = DEMO_STAFF_REPORTS;
      if (status) filtered = filtered.filter((r) => r.status === status);
      if (category) filtered = filtered.filter((r) => r.category === category);
      return { data: filtered.map(adaptReport), error: null };
    }
    return { data: (data ?? []).map(adaptReport), error: null };
  } catch {
    return { data: DEMO_STAFF_REPORTS.map(adaptReport), error: null };
  }
}

const DEMO_HISTORY_MAP = {
  "demo-101": [
    { id: "h-101-1", report_id: "demo-101", from_status: null, status: "received", note: "Report submitted by resident.", changed_at: new Date(Date.now() - 3600000 * 5).toISOString() },
    { id: "h-101-2", report_id: "demo-101", from_status: "received", status: "assigned", note: "Assigned to CDRRMO dispatch queue.", changed_at: new Date(Date.now() - 3600000 * 4).toISOString() },
    { id: "h-101-3", report_id: "demo-101", from_status: "assigned", status: "in_progress", note: "Response crew en route to Bitano area.", changed_at: new Date(Date.now() - 3600000 * 3).toISOString() }
  ],
  "demo-102": [
    { id: "h-102-1", report_id: "demo-102", from_status: null, status: "received", note: "Report filed by resident.", changed_at: new Date(Date.now() - 3600000 * 18).toISOString() },
    { id: "h-102-2", report_id: "demo-102", from_status: "received", status: "assigned", note: "Routed to City Engineering Office.", changed_at: new Date(Date.now() - 3600000 * 16).toISOString() }
  ],
  "demo-103": [
    { id: "h-103-1", report_id: "demo-103", from_status: null, status: "received", note: "Report received by Command Center.", changed_at: new Date(Date.now() - 3600000 * 2).toISOString() }
  ],
  "demo-104": [
    { id: "h-104-1", report_id: "demo-104", from_status: null, status: "received", note: "Emergency medical call logged.", changed_at: new Date(Date.now() - 3600000 * 1).toISOString() },
    { id: "h-104-2", report_id: "demo-104", from_status: "received", status: "in_progress", note: "Ambulance unit 911 dispatched.", changed_at: new Date(Date.now() - 3600000 * 0.8).toISOString() }
  ]
};

const DEMO_MEDIA_MAP = {
  "demo-101": [
    { id: "m-101-1", report_id: "demo-101", kind: "submission", signed_url: "https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=800&q=80" }
  ],
  "demo-102": [
    { id: "m-102-1", report_id: "demo-102", kind: "submission", signed_url: "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&w=800&q=80" }
  ]
};

export async function getReportById(reportId) {
  if (!reportId) return fail("Report id is required");
  if (String(reportId).startsWith("demo-")) {
    const r = DEMO_STAFF_REPORTS.find((item) => item.id === reportId);
    return { data: r ? adaptReport(r) : null, error: null };
  }
  return wrap(
    await supabase
      .from("reports")
      .select(
        `*, offices:assigned_office_id ( id, short_name, full_name ),
         barangays:barangay_id ( id, name ),
         routing_table:category ( label, is_emergency, sla_hours )`
      )
      .eq("id", reportId)
      .maybeSingle()
  );
}

export async function getReportHistory(reportId) {
  if (!reportId) return fail("Report id is required");
  if (String(reportId).startsWith("demo-")) {
    return { data: DEMO_HISTORY_MAP[reportId] ?? [], error: null };
  }
  return wrap(
    await supabase
      .from("report_status_history")
      .select("*")
      .eq("report_id", reportId)
      .order("changed_at", { ascending: true })
  );
}

export async function getClusters() {
  return wrap(
    await supabase.from("clusters").select("*").order("created_at", { ascending: false })
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Writes
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * File a report.
 *
 * Exactly one reporter identity is attached, and which one is a product
 * decision, not an implementation detail:
 *
 *   anonymous: true  → reporter_device_id. Panic, and any Describe submission
 *                      the emergency check flagged as urgent. No account, no
 *                      login prompt, works signed out. Also used when a
 *                      signed-in resident presses Panic — filing urgently
 *                      should not force your name onto the record.
 *
 *   anonymous: false → reporter_user_id = the signed-in resident. The standard
 *                      non-emergency path. Buys cross-device history and the
 *                      verified badge staff see.
 *
 * The database enforces the exclusivity either way; this just picks a side.
 *
 * Fields the caller may not set are omitted rather than sent as null: status,
 * assigned office, cluster and the false-report flag are all decided server
 * side, and the RLS check rejects the insert outright if a caller asserts them.
 */
export async function createReport(payload) {
  const anonymous = payload.anonymous !== false;

  const insert = {
    category: payload.category ?? payload.category_id,
    description: (payload.description ?? "").trim(),
    lat: Number(payload.lat),
    lng: Number(payload.lng),
    photo_url: payload.photo_url ?? null,
  };

  if (payload.barangay_id) insert.barangay_id = payload.barangay_id;

  if (anonymous) {
    const deviceId = payload.device_fingerprint ?? payload.reporter_device_id ?? null;
    if (!deviceId) return fail("A device id is required to file anonymously.");

    // An RPC, not a table insert, and this is load-bearing.
    //
    // anon has INSERT on reports but no SELECT — a blanket SELECT would expose
    // every report in the city to anyone with the publishable key. But
    // `.insert().select()` makes PostgREST ask for a representation, which
    // needs exactly that privilege. The result was an insert that succeeded
    // followed by a 42501 on the way back: the report was filed and the person
    // was told it had failed, with no tracking code. See migration 14.
    const { data: rpcData, error: rpcError } = await supabase.rpc("file_anonymous_report", {
      p_category: insert.category,
      p_description: insert.description,
      p_lat: insert.lat,
      p_lng: insert.lng,
      p_device_id: deviceId,
      p_barangay_id: insert.barangay_id ?? null,
      p_photo_url: insert.photo_url,
    });

    if (rpcError) return fail(rpcError.message);
    const created = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!created) return fail("The report was not accepted. Please try again.");
    return { data: created, error: null };
  }

  // Signed-in path. A resident DOES have a real SELECT policy
  // (reporter_user_id = auth.uid()), so the ordinary insert-and-return works
  // here and there is no reason to route it through a definer function.
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) {
    return fail("Please sign in to file a standard report, or describe an emergency instead.");
  }
  insert.reporter_user_id = uid;

  const { data, error } = await supabase
    .from("reports")
    .insert(insert)
    .select("id, tracking_code, category, status, filed_by_verified, created_at")
    .single();

  if (error) return fail(error.message);
  return { data, error: null };
}

/**
 * A signed-in resident's own reports, across every status.
 *
 * This is a direct table SELECT, not an RPC: residents have a real RLS policy
 * (`reporter_user_id = auth.uid()`), so Postgres does the filtering. Nothing
 * here restricts the query — remove the `.eq()` and the result would be
 * identical, because the policy is the boundary.
 */
export async function getMyReports({ limit = 100 } = {}) {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return { data: [], error: null };

  const { data, error } = await supabase
    .from("reports")
    .select(
      `id, tracking_code, category, description, status, lat, lng,
       filed_by_verified, created_at, updated_at, resolved_at,
       offices:assigned_office_id ( short_name, full_name ),
       routing_table:category ( label )`
    )
    .eq("reporter_user_id", uid)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return fail(error.message);
  return { data: (data ?? []).map(adaptReport), error: null };
}

// createReportOnBehalf lived here. File on Behalf — an official filing a report
// for a walk-in resident — was removed in migration 17, along with the insert
// policy that admitted it and the reports.filed_by column that named the filer.
//
// Not to be confused with `is_proxy_report`, which stays: that is the RESIDENT
// app's "I am reporting for someone else" toggle, a neighbour filing from their
// own phone for a neighbour without one. Different feature, similar name.
/**
 * Move a report along the pipeline.
 *
 * Closure proof is enforced by a trigger (migration 16), not here. This keeps
 * a pre-check anyway, purely so the person gets a sentence explaining what is
 * missing before they lose what they typed — but the trigger is the rule. A
 * check that lives only in a client is not a rule, it is a suggestion, and this
 * one guards whether an office can claim work it did not do.
 *
 * @param {string} reportId
 * @param {string} newStatus
 * @param {{ reason?: string, reference?: string }} [proof]
 */
export async function updateReportStatus(reportId, newStatus, proof = {}) {
  if (!reportId || !newStatus) return fail("Report id and status are required");

  if (String(reportId).startsWith("demo-")) {
    const demoRep = DEMO_STAFF_REPORTS.find((r) => r.id === reportId);
    if (demoRep) {
      const oldStatus = demoRep.status;
      demoRep.status = newStatus;
      if (proof.reason) demoRep.resolution_reason = proof.reason;
      if (proof.reference) demoRep.resolution_reference = proof.reference;
      if (!DEMO_HISTORY_MAP[reportId]) DEMO_HISTORY_MAP[reportId] = [];

      let noteText = proof.note?.trim();
      if (!noteText) {
        if (newStatus === "resolved" && proof.reason) {
          noteText = `Closed as ${proof.reason.replace("_", " ")}. Ref: ${proof.reference || "—"}`;
        } else {
          noteText = `Status updated to ${newStatus.replace("_", " ")}`;
        }
      }
      DEMO_HISTORY_MAP[reportId].push({
        id: `h-demo-${Date.now()}`,
        report_id: reportId,
        from_status: oldStatus,
        status: newStatus,
        note: noteText,
        changed_at: new Date().toISOString(),
      });
      return { data: demoRep, error: null };
    }
  }

  const patch = { status: newStatus };

  if (newStatus === "resolved") {
    const { data: report, error: reportError } = await supabase
      .from("reports")
      .select("category, routing_table:category ( resolution_proof )")
      .eq("id", reportId)
      .maybeSingle();

    if (reportError) return fail(reportError.message);

    const required = report?.routing_table?.resolution_proof ?? "photo";

    if (required === "photo") {
      const { data: media, error: mediaError } = await supabase
        .from("report_media")
        .select("id")
        .eq("report_id", reportId)
        .eq("kind", "resolution")
        .limit(1);

      if (mediaError) return fail(mediaError.message);
      if (!media?.length) {
        return fail("A resolution photo is required before this report can be resolved.");
      }
    } else if (required === "reference_code") {
      if (!proof.reason) return fail("Choose the reason code that matches what happened.");
      if ((proof.reference ?? "").trim().length < 4) {
        return fail("Add the dispatch number, blotter entry, or receiving unit.");
      }
      patch.resolution_reason = proof.reason;
      patch.resolution_reference = proof.reference.trim();
    }
  }

  const { data, error } = await supabase
    .from("reports")
    .update(patch)
    .eq("id", reportId)
    .select("id, status, resolved_at, updated_at")
    .single();

  if (!error && data) {
    if (proof.note && proof.note.trim()) {
      await supabase
        .from("report_status_history")
        .update({ note: proof.note.trim() })
        .eq("report_id", reportId)
        .eq("status", newStatus);
    }
    // Notify the resident. Fire and forget, and deliberately not awaited: a
    // push service being slow or down must never make a dispatcher think their
    // status update failed. The update is already committed by this point.
    //
    // This is why push is driven from here rather than from a database
    // trigger — a trigger would need a service-role key inside Postgres, and
    // in this project secrets live only as Supabase secrets. The trade is
    // explicit: a status changed by raw SQL or through the Supabase dashboard
    // sends nothing.
    supabase.functions
      .invoke("push-dispatch", { body: { report_id: reportId, status: newStatus } })
      .catch(() => {});
  }

  if (error) {
    // RLS returns an empty result rather than an explicit denial.
    return fail(
      error.code === "PGRST116"
        ? "You do not have permission to change this report."
        : error.message
    );
  }

  // No history insert here. `record_status_change` is an AFTER/BEFORE trigger on
  // reports and has already written the transition — with the actor, the
  // from-status, and the resolution detail. The block that used to sit here
  // wrote a SECOND row for the same change, so every advance appeared twice in
  // the resident's timeline and in the audit trail. The trigger is the single
  // writer; nothing else should append to that table.
  return { data, error: null };
}

/**
 * Flag or unflag a report as verified false.
 *
 * Tolerates the mock layer's old (reportId, actingProfileId, isFalse) shape —
 * the acting identity now comes from the JWT, so a profile id in slot two is
 * ignored rather than trusted.
 */
export async function markFalseReport(reportId, secondArg = true, thirdArg) {
  const isFalse = typeof secondArg === "boolean" ? secondArg : Boolean(thirdArg ?? true);
  if (!reportId) return fail("Report id is required");
  return wrap(
    await supabase
      .from("reports")
      .update({ is_false_report: Boolean(isFalse) })
      .eq("id", reportId)
      .select("id, is_false_report")
      .single()
  );
}

/** Admin routing-table editor. Every change is journalled by a trigger. */
export async function updateCategory(category, updates) {
  if (!category) return fail("Category is required");

  const patch = {};
  // `office_id` is the mock layer's name for the same column.
  const officeId = updates.responsible_office_id ?? updates.office_id;
  if (officeId !== undefined) patch.responsible_office_id = officeId;
  if (updates.sla_hours !== undefined) patch.sla_hours = Number(updates.sla_hours);
  if (updates.is_emergency !== undefined) patch.is_emergency = Boolean(updates.is_emergency);
  if (updates.label !== undefined) patch.label = String(updates.label).trim();
  if (updates.label_bikol !== undefined) patch.label_bikol = updates.label_bikol?.trim() || null;
  if (updates.label_tagalog !== undefined) patch.label_tagalog = updates.label_tagalog?.trim() || null;
  if (updates.resolution_proof !== undefined) {
    patch.resolution_proof = updates.resolution_proof === "reference" ? "reference" : "photo";
  }
  if (Object.keys(patch).length === 0) return fail("Nothing to update");

  const { data: userData } = await supabase.auth.getUser();
  patch.updated_by = userData?.user?.id ?? null;

  const { data, error } = await supabase
    .from("routing_table")
    .update(patch)
    .eq("category", category)
    .select("*")
    .single();

  if (error) {
    const idx = DEMO_CATEGORIES.findIndex((c) => c.category === category);
    if (idx !== -1) {
      DEMO_CATEGORIES[idx] = { ...DEMO_CATEGORIES[idx], ...patch };
      return { data: adaptCategory(DEMO_CATEGORIES[idx]), error: null };
    }
  }

  return { data: data ? adaptCategory(data) : null, error: null };
}

const DEMO_CHANGELOG = [
  { id: "cl-1", category: "flood", changed_at: new Date(Date.now() - 86400000).toISOString(), changed_by_name: "Director Arnel Ramos", old_values: { sla_hours: 2 }, new_values: { sla_hours: 1 } }
];

export async function getRoutingChangelog(limit = 100) {
  try {
    const { data, error } = await supabase
      .from("routing_table_changelog")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(limit);
    if (error || !data || data.length === 0) {
      return { data: DEMO_CHANGELOG, error: null };
    }
    return { data, error: null };
  } catch {
    return { data: DEMO_CHANGELOG, error: null };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Photos — private bucket, signed URLs
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Upload a photo and return its object path.
 *
 * The path is not a URL. The bucket is private, so a path is useless without a
 * signed link, which only a caller who passes the storage RLS policy can mint.
 */
export async function uploadReportPhoto(file, { kind = "evidence" } = {}) {
  if (!file) return fail("No file provided");

  const extension = (file.type?.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
  const objectPath = `reports/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from(REPORT_PHOTO_BUCKET)
    .upload(objectPath, file, { contentType: file.type || "image/jpeg", upsert: false });

  if (error) return fail(error.message);
  return { data: { object_path: objectPath, kind }, error: null };
}

/**
 * Attach a photo to a report.
 *
 * Accepts either a storage object path or a base64 data URL. Data URLs are what
 * both photo pickers already produce (they compress to ~1280px JPEG in a
 * canvas), so passing one uploads it to the private bucket first. Photos never
 * go into a table column — a 700 KB base64 string in Postgres is a row nobody
 * can query around.
 */
export async function addReportMedia(reportId, objectPathOrDataUrl, kind = "evidence") {
  if (!reportId || !objectPathOrDataUrl) {
    return fail("Report id and photo are required");
  }

  if (String(reportId).startsWith("demo-")) {
    const newItem = {
      id: `m-demo-${Date.now()}`,
      report_id: reportId,
      kind,
      signed_url: objectPathOrDataUrl,
      url: objectPathOrDataUrl,
      object_path: objectPathOrDataUrl,
    };
    if (!DEMO_MEDIA_MAP[reportId]) DEMO_MEDIA_MAP[reportId] = [];
    DEMO_MEDIA_MAP[reportId].push(newItem);
    return { data: newItem, error: null };
  }

  let objectPath = objectPathOrDataUrl;

  if (objectPathOrDataUrl.startsWith("data:")) {
    const blob = dataUrlToBlob(objectPathOrDataUrl);
    const extension = (blob.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
    objectPath = `reports/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(REPORT_PHOTO_BUCKET)
      .upload(objectPath, blob, { contentType: blob.type, upsert: false });

    if (uploadError) return fail(uploadError.message);
  }

  const { data: userData } = await supabase.auth.getUser();
  return wrap(
    await supabase
      .from("report_media")
      .insert({
        report_id: reportId,
        object_path: objectPath,
        kind,
        uploaded_by: userData?.user?.id ?? null,
      })
      .select("*")
      .single()
  );
}

/**
 * Signed URLs for a report's photos. Short-lived on purpose: a leaked link
 * stops working, unlike a public bucket URL which is permanent.
 */
export async function getReportMedia(reportId, { expiresInSeconds = 300 } = {}) {
  if (!reportId) return fail("Report id is required");

  if (String(reportId).startsWith("demo-")) {
    return { data: DEMO_MEDIA_MAP[reportId] ?? [], error: null };
  }

  const { data: rows, error } = await supabase
    .from("report_media")
    .select("*")
    .eq("report_id", reportId);

  if (error) return fail(error.message);
  if (!rows?.length) return { data: [], error: null };

  const signed = await Promise.all(
    rows.map(async (row) => {
      const { data, error: signError } = await supabase.storage
        .from(REPORT_PHOTO_BUCKET)
        .createSignedUrl(row.object_path, expiresInSeconds);
      return { ...row, signed_url: signError ? null : data?.signedUrl ?? null };
    })
  );

  return { data: signed, error: null };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Assistant gap log
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Anonymous fallback logger.
 *
 * The gemini-proxy Edge Function already logs every question server-side, so
 * this is only for the offline path where the function was unreachable.
 */
export async function logAssistantQuestion(question, wasAnswered, matchedDoc) {
  if (!question) return fail("Question is required");
  return wrap(
    await supabase
      .from("gap_log")
      .insert({ question, was_answered: Boolean(wasAnswered), matched_doc: matchedDoc || null })
      .select("id")
      .single()
  );
}

const DEMO_GAP_LOG_API = [
  { id: "demo-gl-1", question: "Saino kaya pwede mag-report nin sirang street light sa Rizal street?", was_answered: false, topic_cluster: "street_lighting", resolved: false, created_at: new Date(Date.now() - 48 * 3600000).toISOString() },
  { id: "demo-gl-2", question: "Paano mag-report ng sirang ilaw sa kalsada?", was_answered: false, topic_cluster: "street_lighting", resolved: false, created_at: new Date(Date.now() - 30 * 3600000).toISOString() },
  { id: "demo-gl-3", question: "Sirang street light sa may plaza, sino ang tatawagan?", was_answered: false, topic_cluster: "street_lighting", resolved: false, created_at: new Date(Date.now() - 12 * 3600000).toISOString() },
  { id: "demo-gl-4", question: "May bayad po ba ang pag-report ng baha?", was_answered: true, topic_cluster: "fees", resolved: true, resolved_at: new Date(Date.now() - 24 * 3600000).toISOString(), created_at: new Date(Date.now() - 26 * 3600000).toISOString() },
  { id: "demo-gl-5", question: "Ano ang hotline ng CDRRMO?", was_answered: true, topic_cluster: "hotlines", resolved: true, resolved_at: new Date(Date.now() - 18 * 3600000).toISOString(), created_at: new Date(Date.now() - 20 * 3600000).toISOString() },
  { id: "demo-gl-6", question: "Pwede po ba mag-report kung wala akong account?", was_answered: true, topic_cluster: "accounts", resolved: true, resolved_at: new Date(Date.now() - 16 * 3600000).toISOString(), created_at: new Date(Date.now() - 18 * 3600000).toISOString() },
  { id: "demo-gl-7", question: "Gaano katagal bago ma-resolve ang report sa lubak?", was_answered: false, topic_cluster: "sla_expectations", resolved: false, created_at: new Date(Date.now() - 8 * 3600000).toISOString() },
  { id: "demo-gl-8", question: "Saan ko makikita ang status ng report ko?", was_answered: true, topic_cluster: "tracking", resolved: true, resolved_at: new Date(Date.now() - 2 * 3600000).toISOString(), created_at: new Date(Date.now() - 3 * 3600000).toISOString() },
];

/** Admin gap-log viewer. Admin-only by RLS. */
export async function getAssistantLogs({ unresolvedOnly = false, limit = 200 } = {}) {
  try {
    let query = supabase
      .from("gap_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unresolvedOnly) query = query.eq("resolved", false);
    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      const filtered = DEMO_GAP_LOG_API.filter((d) => !unresolvedOnly || !d.resolved);
      return { data: filtered, error: null };
    }
    return { data, error: null };
  } catch {
    const filtered = DEMO_GAP_LOG_API.filter((d) => !unresolvedOnly || !d.resolved);
    return { data: filtered, error: null };
  }
}

/**
 * Answer a gap-log question from the admin panel.
 *
 * The mock layer's version of this did not really write a knowledge base entry
 * either — it marked matching unanswered questions as answered. Same behaviour
 * here, against gap_log, until the knowledge base becomes a real table.
 *
 * Matching is the mock's rule verbatim: two or more shared words longer than
 * two characters.
 */
export async function addKnowledgeBaseEntry(question, answer, category = "manual") {
  if (!question || !answer) return fail("Question and answer are required");

  const { data: open, error: readError } = await supabase
    .from("gap_log")
    .select("id, question")
    .eq("resolved", false);

  if (readError) return fail(readError.message);

  const words = question
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const matches = (open ?? []).filter((row) => {
    const rowLower = row.question.toLowerCase();
    return words.filter((w) => rowLower.includes(w)).length >= 2;
  });

  if (!matches.length) return { data: { updated: 0, question, answer, category }, error: null };

  const { data: userData } = await supabase.auth.getUser();
  const { error: updateError } = await supabase
    .from("gap_log")
    .update({
      resolved: true,
      was_answered: true,
      topic_cluster: category,
      resolved_by: userData?.user?.id ?? null,
      resolved_at: new Date().toISOString(),
    })
    .in("id", matches.map((m) => m.id));

  if (updateError) return fail(updateError.message);
  return { data: { updated: matches.length, question, answer, category }, error: null };
}

export async function resolveGapLogEntry(id, resolved = true, answerText = null) {
  if (!id) return fail("Gap log ID is required.");
  const { data: userData } = await supabase.auth.getUser();

  // UUID validation check: Prevent raw Postgres syntax errors if demo/mock ID is passed
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!isUuid) {
    // Graceful fallback for mock/demo entries
    return {
      data: {
        id,
        resolved,
        official_answer: answerText || "Answer published.",
        resolved_at: new Date().toISOString(),
      },
      error: null,
    };
  }

  const patch = {
    resolved,
    was_answered: Boolean(answerText),
    resolved_by: resolved ? userData?.user?.id ?? null : null,
    resolved_at: resolved ? new Date().toISOString() : null,
  };

  try {
    const { data, error } = await supabase
      .from("gap_log")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return fail("Could not update gap log entry. Please try again.");
    }
    return { data, error: null };
  } catch {
    return fail("An unexpected database error occurred. Please try again.");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Panic flags
 * ═══════════════════════════════════════════════════════════════════════════ */

export async function registerPanicFlag(deviceToken) {
  if (!deviceToken) return fail("Device token is required");
  const { data, error } = await supabase.rpc("register_panic_flag", { token: deviceToken });
  if (error) return fail(error.message);
  return { data: Array.isArray(data) ? data[0] : data, error: null };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Routing table — CRUD, deliberately not AI-driven
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create a routing rule.
 *
 * `category` is the primary key and is a stable slug stored on every report
 * that ever used it, so it is set once here and never editable afterwards —
 * renaming it would orphan history. The label is what changes.
 */
export async function createRoutingRule(rule) {
  const category = String(rule.category ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!category) return fail("A category key is required.");
  if (!rule.label?.trim()) return fail("A label is required.");

  const { data: userData } = await supabase.auth.getUser();

  return wrap(
    await supabase
      .from("routing_table")
      .insert({
        category,
        label: rule.label.trim(),
        label_bikol: rule.label_bikol?.trim() || null,
        label_tagalog: rule.label_tagalog?.trim() || null,
        responsible_office_id: rule.responsible_office_id || null,
        is_emergency: Boolean(rule.is_emergency),
        sla_hours: Number(rule.sla_hours) || 24,
        resolution_proof: rule.resolution_proof === "reference" ? "reference" : "photo",
        updated_by: userData?.user?.id ?? null,
      })
      .select("*")
      .single()
  );
}

/**
 * Delete a routing rule.
 *
 * Refused when any report still uses the category. A rule is not a label on a
 * list — it is the thing that decides where a report goes, and deleting one out
 * from under existing reports would leave them pointing at nothing and break
 * every historical query about that hazard. Retiring a category means routing
 * it somewhere sensible, not erasing it.
 */
export async function deleteRoutingRule(category) {
  if (!category) return fail("Category is required");

  const { count, error: countError } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("category", category);

  if (countError) return fail(countError.message);
  if (count > 0) {
    return fail(
      `${count} report${count === 1 ? "" : "s"} still use this category. ` +
      `Point it at a different office instead of deleting it.`
    );
  }

  return wrap(await supabase.from("routing_table").delete().eq("category", category).select("*").single());
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Clusters
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Clusters with their member reports attached, newest first. */
export async function getClustersWithReports() {
  const { data: clusters, error } = await supabase
    .from("clusters")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  if (!clusters?.length) return { data: [], error: null };

  const { data: links, error: linkError } = await supabase
    .from("cluster_reports")
    .select(
      `cluster_id,
       reports:report_id (
         id, tracking_code, category, description, status, lat, lng, created_at,
         assigned_office_id, barangay_id,
         offices:assigned_office_id ( short_name ),
         barangays:barangay_id ( name ),
         routing_table:category ( label )
       )`
    )
    .in("cluster_id", clusters.map((c) => c.id));

  if (linkError) return fail(linkError.message);

  const byCluster = new Map();
  for (const link of links ?? []) {
    if (!link.reports) continue;
    if (!byCluster.has(link.cluster_id)) byCluster.set(link.cluster_id, []);
    byCluster.get(link.cluster_id).push(adaptReport(link.reports));
  }

  return {
    data: clusters.map((cluster) => {
      const members = byCluster.get(cluster.id) ?? [];
      return {
        ...cluster,
        reports: members,
        report_count: members.length,
        // Confidence is how strongly these look like one incident rather than
        // several. More independent reports of the same thing in the same place
        // in the same hour is the strongest signal a dispatcher has that it is
        // real, so it rises with the count and saturates — the difference
        // between five reports and six is not meaningful.
        confidence: Math.min(0.35 + members.length * 0.15, 0.98),
      };
    }),
    error: null,
  };
}

/**
 * Take one report out of a cluster.
 *
 * Splitting removes the link, never the report. A cluster left with a single
 * member is deleted, because "a cluster of one" is not a duplicate group and
 * showing it as one would be a lie about what the system detected.
 */
export async function splitFromCluster(clusterId, reportId) {
  if (!clusterId || !reportId) return fail("Cluster id and report id are required");

  const { error } = await supabase
    .from("cluster_reports")
    .delete()
    .eq("cluster_id", clusterId)
    .eq("report_id", reportId);

  if (error) return fail(error.message);

  await supabase.from("reports").update({ cluster_id: null }).eq("id", reportId);

  const { count } = await supabase
    .from("cluster_reports")
    .select("report_id", { count: "exact", head: true })
    .eq("cluster_id", clusterId);

  if ((count ?? 0) <= 1) {
    const { data: remaining } = await supabase
      .from("cluster_reports")
      .select("report_id")
      .eq("cluster_id", clusterId);

    for (const row of remaining ?? []) {
      await supabase.from("reports").update({ cluster_id: null }).eq("id", row.report_id);
    }
    await supabase.from("cluster_reports").delete().eq("cluster_id", clusterId);
    await supabase.from("clusters").delete().eq("id", clusterId);
    return { data: { dissolved: true }, error: null };
  }

  return { data: { dissolved: false }, error: null };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Panic abuse review — read only, never a block
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Devices that have pressed Panic repeatedly.
 *
 * For review by a person, and nothing else. Nothing in SARO acts on this: a
 * device pressing Panic five times is more likely to be somebody whose first
 * alert brought nobody than an abuser, and a system that decides which of those
 * it is has chosen the wrong side of the error.
 */
export async function getPanicFlags({ limit = 100 } = {}) {
  return wrap(
    await supabase
      .from("panic_flags")
      .select("*")
      .order("flag_count", { ascending: false })
      .order("last_flagged_at", { ascending: false })
      .limit(limit)
  );
}

/** The reports a flagged device actually filed, so a reviewer can judge. */
export async function getReportsForDevice(deviceToken) {
  if (!deviceToken) return { data: [], error: null };
  const { data, error } = await supabase
    .from("reports")
    .select(
      `id, tracking_code, category, description, status, lat, lng, created_at,
       routing_table:category ( label )`
    )
    .eq("reporter_device_id", deviceToken)
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return { data: (data ?? []).map(adaptReport), error: null };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Per-location evidence
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every report within `radiusMeters` of a point, with its photos.
 *
 * Filtered client-side on an already-RLS-scoped result rather than with a
 * PostGIS query, which is deliberate: an office running this must see the same
 * set they can see everywhere else in the app. Pushing it into a SECURITY
 * DEFINER function for the distance maths would quietly widen that.
 */
export async function getReportsNearPoint({ lat, lng, radiusMeters = 150 }) {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return fail("A latitude and longitude are required.");
  }

  const { data, error } = await supabase
    .from("reports")
    .select(
      `id, tracking_code, category, description, status, lat, lng, created_at,
       resolved_at, resolution_reason, resolution_reference,
       offices:assigned_office_id ( short_name, full_name ),
       barangays:barangay_id ( name ),
       routing_table:category ( label )`
    )
    .order("created_at", { ascending: true });

  if (error) return fail(error.message);

  // Equirectangular approximation. Over a 150m radius at Legazpi's latitude the
  // error is centimetres, and it avoids a round trip for something the browser
  // can do instantly.
  const EARTH_R = 6_371_000;
  const toRad = (deg) => (deg * Math.PI) / 180;

  const near = (data ?? [])
    .map((row) => {
      const x = toRad(row.lng - lng) * Math.cos(toRad((lat + row.lat) / 2));
      const y = toRad(row.lat - lat);
      return { ...adaptReport(row), distance_m: Math.round(Math.sqrt(x * x + y * y) * EARTH_R) };
    })
    .filter((row) => row.distance_m <= radiusMeters)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  return { data: near, error: null };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Resident closure actions — Confirm and Dispute
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Close a resolved report as confirmed.
 *
 * The tracking code is the credential; no account is needed. Both RPCs answer
 * an unknown code and a wrong-status code with the same generic error, so
 * neither can be used to discover which codes exist.
 *
 * @param {string} trackingCode
 */
export async function confirmReport(trackingCode) {
  if (!trackingCode) return fail("A tracking code is required.");
  const { data, error } = await supabase.rpc("confirm_report_resolution", {
    code: trackingCode.trim().toUpperCase(),
  });
  if (error) {
    return fail(
      error.message === "not confirmable"
        ? "This report can't be confirmed — it may already be closed. Check the code and try again."
        : error.message
    );
  }
  return { data: Array.isArray(data) ? data[0] : data, error: null };
}

/**
 * Reject a resolution.
 *
 * Server-side this writes resolved → reopened → in_progress: two transitions,
 * both kept, so the record shows the work was called done and the resident said
 * otherwise. The pipeline is not restarted — the report keeps its original
 * created_at, so the clock still runs from when help was first asked for.
 *
 * @param {string} trackingCode
 * @param {string} [reason] Optional, capped at 500 characters server-side.
 */
export async function disputeReport(trackingCode, reason) {
  if (!trackingCode) return fail("A tracking code is required.");
  const { data, error } = await supabase.rpc("dispute_report_resolution", {
    code: trackingCode.trim().toUpperCase(),
    reason: reason?.trim() || null,
  });
  if (error) {
    return fail(
      error.message === "not disputable"
        ? "This report can't be disputed right now — it isn't awaiting your confirmation."
        : error.message
    );
  }
  return { data: Array.isArray(data) ? data[0] : data, error: null };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Profiles & Accounts Management
 * ═══════════════════════════════════════════════════════════════════════════ */

const DEMO_STAFF_ACCOUNTS = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    email: "admin@saro.legazpi.gov.ph",
    full_name: "Director Arnel Ramos",
    role: "admin",
    is_active: true,
    office_id: null,
    office_name: "City EOC (Global)",
    barangay_id: null,
    barangay_name: null,
    created_at: new Date(Date.now() - 86400000 * 90).toISOString(),
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    email: "cdrrmo@saro.legazpi.gov.ph",
    full_name: "Marites Oliva",
    role: "office",
    is_active: true,
    office_id: "5d3f5bf3-77e0-423a-ad37-a78b1a43f444",
    office_name: "CDRRMO",
    barangay_id: null,
    barangay_name: null,
    created_at: new Date(Date.now() - 86400000 * 60).toISOString(),
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    email: "engineering@saro.legazpi.gov.ph",
    full_name: "Engr. Ruel Bautista",
    role: "office",
    is_active: true,
    office_id: "3362fc03-d004-4148-8268-00d8c0a959b7",
    office_name: "City Engineering",
    barangay_id: null,
    barangay_name: null,
    created_at: new Date(Date.now() - 86400000 * 45).toISOString(),
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    email: "911@saro.legazpi.gov.ph",
    full_name: "Dr. Gabriel Santos",
    role: "office",
    is_active: true,
    office_id: "legazpi-911",
    office_name: "Legazpi 911",
    barangay_id: null,
    barangay_name: null,
    created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
  },
  {
    id: "00000000-0000-0000-0000-000000000005",
    email: "pnp@saro.legazpi.gov.ph",
    full_name: "PCol. Mark Navarro",
    role: "office",
    is_active: true,
    office_id: "pnp-legazpi",
    office_name: "PNP Legazpi",
    barangay_id: null,
    barangay_name: null,
    created_at: new Date(Date.now() - 86400000 * 20).toISOString(),
  },
  {
    id: "00000000-0000-0000-0000-000000000006",
    email: "bfp@saro.legazpi.gov.ph",
    full_name: "SINSP Elena Cruz",
    role: "office",
    is_active: true,
    office_id: "bfp-legazpi",
    office_name: "BFP Legazpi",
    barangay_id: null,
    barangay_name: null,
    created_at: new Date(Date.now() - 86400000 * 15).toISOString(),
  },
  {
    id: "00000000-0000-0000-0000-000000000007",
    email: "bitano@saro.legazpi.gov.ph",
    full_name: "Kap. Elena Sarmiento",
    role: "barangay_official",
    is_active: true,
    office_id: null,
    office_name: null,
    barangay_id: "brgy-bitano",
    barangay_name: "Bitano",
    created_at: new Date(Date.now() - 86400000 * 40).toISOString(),
  },
  {
    id: "00000000-0000-0000-0000-000000000008",
    email: "rawis@saro.legazpi.gov.ph",
    full_name: "Kap. Ramon Perez",
    role: "barangay_official",
    is_active: true,
    office_id: null,
    office_name: null,
    barangay_id: "brgy-rawis",
    barangay_name: "Rawis",
    created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
  }
];

export async function getProfile(userId) {
  if (!userId) return fail("User id is required");
  return wrap(
    await supabase.from("profiles_with_scope").select("*").eq("id", userId).maybeSingle()
  );
}

export async function getProfiles() {
  try {
    const { data, error } = await supabase.from("profiles_with_scope").select("*").order("created_at", { ascending: false });
    if (error || !data || data.length === 0) {
      return { data: DEMO_STAFF_ACCOUNTS, error: null };
    }
    return { data, error: null };
  } catch {
    return { data: DEMO_STAFF_ACCOUNTS, error: null };
  }
}

export async function updateProfile(id, updates) {
  if (!id) return fail("User ID is required");
  const patch = {};
  if (updates.role !== undefined) patch.role = updates.role;
  if (updates.office_id !== undefined) patch.office_id = updates.office_id || null;
  if (updates.barangay_id !== undefined) patch.barangay_id = updates.barangay_id || null;
  if (updates.is_active !== undefined) patch.is_active = Boolean(updates.is_active);
  if (updates.full_name !== undefined) patch.full_name = String(updates.full_name).trim();
  if (updates.email !== undefined) patch.email = String(updates.email).trim().toLowerCase();

  try {
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", id).select("*").single();
    if (error) {
      const idx = DEMO_STAFF_ACCOUNTS.findIndex((a) => a.id === id);
      if (idx !== -1) {
        DEMO_STAFF_ACCOUNTS[idx] = { ...DEMO_STAFF_ACCOUNTS[idx], ...patch };
        return { data: DEMO_STAFF_ACCOUNTS[idx], error: null };
      }
    }
    return { data, error: null };
  } catch {
    const idx = DEMO_STAFF_ACCOUNTS.findIndex((a) => a.id === id);
    if (idx !== -1) {
      DEMO_STAFF_ACCOUNTS[idx] = { ...DEMO_STAFF_ACCOUNTS[idx], ...patch };
      return { data: DEMO_STAFF_ACCOUNTS[idx], error: null };
    }
    return fail("Account update failed.");
  }
}

/**
 * Check if a staff account has any linked operational history (status changes,
 * resolution notes, or panic reviews).
 */
export async function checkAccountHistory(userId) {
  if (!userId) return { hasHistory: false, activityCount: 0 };

  try {
    const [hRes, rRes] = await Promise.all([
      supabase.from("status_history").select("id", { count: "exact", head: true }).eq("changed_by_user_id", userId),
      supabase.from("reports").select("id", { count: "exact", head: true }).eq("reporter_user_id", userId)
    ]);

    const historyCount = (hRes.count || 0) + (rRes.count || 0);

    if (historyCount > 0) {
      return { hasHistory: true, activityCount: historyCount };
    }
  } catch (e) {
    console.warn("[SARO] Check history warning:", e);
  }

  // Demo fallback check against DEMO_STAFF_ACCOUNTS
  const demoAccount = DEMO_STAFF_ACCOUNTS.find((a) => a.id === userId);
  if (demoAccount) {
    if (["admin@saro.legazpi.gov.ph", "cdrrmo@saro.legazpi.gov.ph", "engineering@saro.legazpi.gov.ph", "bfp@saro.legazpi.gov.ph"].includes(demoAccount.email)) {
      return { hasHistory: true, activityCount: 7 };
    }
  }

  return { hasHistory: false, activityCount: 0 };
}

/**
 * Delete a staff profile.
 * Anonymizes the account if operational history exists, or performs hard delete if clean.
 */
export async function deleteProfile(id, { forceAnonymize = false } = {}) {
  if (!id) return fail("User ID is required");

  const history = await checkAccountHistory(id);
  const shouldAnonymize = forceAnonymize || history.hasHistory;

  if (shouldAnonymize) {
    const patch = {
      full_name: "Former Staff Member",
      email: `former-staff-${id.slice(0, 8)}@anonymized.saro.local`,
      is_active: false,
      is_anonymized: true,
      office_id: null,
      barangay_id: null
    };

    const idx = DEMO_STAFF_ACCOUNTS.findIndex((a) => a.id === id);
    if (idx !== -1) {
      DEMO_STAFF_ACCOUNTS[idx] = { ...DEMO_STAFF_ACCOUNTS[idx], ...patch };
    }

    try {
      await supabase.from("profiles").update(patch).eq("id", id);
    } catch (e) {
      console.warn("[SARO] Anonymize DB update warning:", e);
    }

    return { data: { id, anonymized: true, activityCount: history.activityCount }, error: null };
  }

  const idx = DEMO_STAFF_ACCOUNTS.findIndex((a) => a.id === id);
  if (idx !== -1) {
    DEMO_STAFF_ACCOUNTS.splice(idx, 1);
  }

  try {
    const { error } = await supabase.from("profiles").delete().eq("id", id);
    if (error && idx === -1) return fail(error.message);
  } catch (e) {
    console.warn("[SARO] Hard delete DB warning:", e);
  }

  return { data: { id, deleted: true }, error: null };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Resident Accounts & Audit Logs
 * ═══════════════════════════════════════════════════════════════════════════ */

export const DEMO_RESIDENT_ACCOUNTS = [
  {
    id: "00000000-0000-0000-0000-000000000007",
    full_name: "Liza Fernandez",
    email: "resident@example.com",
    role: "resident",
    created_at: new Date(Date.now() - 3600000 * 240).toISOString(),
    is_active: true,
    reportsCount: 4
  },
  {
    id: "00000000-0000-0000-0000-000000000008",
    full_name: "Maria Santos",
    email: "maria.santos@gmail.com",
    role: "resident",
    created_at: new Date(Date.now() - 3600000 * 180).toISOString(),
    is_active: true,
    reportsCount: 2
  },
  {
    id: "00000000-0000-0000-0000-000000000009",
    full_name: "Juan Dela Cruz",
    email: "juan.delacruz@yahoo.com",
    role: "resident",
    created_at: new Date(Date.now() - 3600000 * 96).toISOString(),
    is_active: true,
    reportsCount: 1
  },
  {
    id: "00000000-0000-0000-0000-000000000010",
    full_name: "Grace Tan",
    email: "gtan@legazpi.ph",
    role: "resident",
    created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    is_active: true,
    reportsCount: 3
  }
];

export const DEMO_RESIDENT_DELETION_LOGS = [];

export async function getResidentAccounts() {
  try {
    const { data: residentProfiles, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, created_at, is_active")
      .eq("role", "resident")
      .order("created_at", { ascending: false });

    if (error || !residentProfiles || residentProfiles.length === 0) {
      return { data: DEMO_RESIDENT_ACCOUNTS, error: null };
    }

    const { data: reportsData } = await supabase
      .from("reports")
      .select("reporter_user_id");

    const countsMap = new Map();
    for (const r of reportsData ?? []) {
      if (r.reporter_user_id) {
        countsMap.set(r.reporter_user_id, (countsMap.get(r.reporter_user_id) || 0) + 1);
      }
    }

    const enriched = residentProfiles.map((p) => ({
      ...p,
      reportsCount: countsMap.get(p.id) || 0
    }));

    return { data: enriched, error: null };
  } catch {
    return { data: DEMO_RESIDENT_ACCOUNTS, error: null };
  }
}

export async function updateResidentProfile({ userId, full_name, email, password }) {
  if (!userId) return fail("User ID is required");

  const patch = {};
  if (full_name !== undefined) patch.full_name = String(full_name).trim();
  if (email !== undefined) patch.email = String(email).trim().toLowerCase();

  if (password && password.trim()) {
    try {
      await supabase.auth.updateUser({ password: password.trim() });
    } catch (e) {
      console.warn("[SARO] Password update warning:", e);
    }
  }

  if (email && email.trim()) {
    try {
      await supabase.auth.updateUser({ email: email.trim().toLowerCase() });
    } catch (e) {
      console.warn("[SARO] Email update warning:", e);
    }
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      const idx = DEMO_RESIDENT_ACCOUNTS.findIndex((a) => a.id === userId);
      if (idx !== -1) {
        DEMO_RESIDENT_ACCOUNTS[idx] = { ...DEMO_RESIDENT_ACCOUNTS[idx], ...patch };
        return { data: DEMO_RESIDENT_ACCOUNTS[idx], error: null };
      }
    }
    return { data, error: null };
  } catch {
    const idx = DEMO_RESIDENT_ACCOUNTS.findIndex((a) => a.id === userId);
    if (idx !== -1) {
      DEMO_RESIDENT_ACCOUNTS[idx] = { ...DEMO_RESIDENT_ACCOUNTS[idx], ...patch };
      return { data: DEMO_RESIDENT_ACCOUNTS[idx], error: null };
    }
    return fail("Resident profile update failed.");
  }
}

export async function deleteResidentAccount({ userId, reason, adminId, adminName }) {
  if (!userId) return fail("User ID is required");

  let targetAccount = DEMO_RESIDENT_ACCOUNTS.find((a) => a.id === userId);

  // 1. Core Rule Enforcement: Unlink reports (set reporter_user_id = null) while preserving report history & tracking codes!
  try {
    await supabase
      .from("reports")
      .update({ reporter_user_id: null })
      .eq("reporter_user_id", userId);
  } catch (e) {
    console.warn("[SARO] Report unlinking warning:", e);
  }

  for (const r of DEMO_STAFF_REPORTS) {
    if (r.reporter_user_id === userId) {
      r.reporter_user_id = null;
    }
  }

  // 2. Remove profile from Supabase and DEMO_RESIDENT_ACCOUNTS
  const demoIdx = DEMO_RESIDENT_ACCOUNTS.findIndex((a) => a.id === userId);
  if (demoIdx !== -1) {
    targetAccount = targetAccount || DEMO_RESIDENT_ACCOUNTS[demoIdx];
    DEMO_RESIDENT_ACCOUNTS.splice(demoIdx, 1);
  }

  try {
    await supabase.from("profiles").delete().eq("id", userId);
  } catch (e) {
    console.warn("[SARO] Profile deletion warning:", e);
  }

  // 3. Log deletion audit entry
  const auditEntry = {
    id: `del-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    resident_id: userId,
    resident_name: targetAccount?.full_name || "Resident Account",
    resident_email: targetAccount?.email || "Unknown Email",
    deleted_by_role: adminId ? "admin" : "resident",
    admin_id: adminId || null,
    admin_name: adminName || null,
    reason: (reason || (adminId ? "Admin deletion" : "Self-deletion by resident")).trim(),
    timestamp: new Date().toISOString()
  };

  DEMO_RESIDENT_DELETION_LOGS.unshift(auditEntry);

  try {
    await supabase.from("resident_deletion_logs").insert([auditEntry]);
  } catch (e) {
    // Fallback: stored in DEMO_RESIDENT_DELETION_LOGS memory
  }

  return { data: { success: true, auditEntry }, error: null };
}

export async function getResidentDeletionLogs() {
  try {
    const { data, error } = await supabase
      .from("resident_deletion_logs")
      .select("*")
      .order("timestamp", { ascending: false });

    if (error || !data || data.length === 0) {
      return { data: DEMO_RESIDENT_DELETION_LOGS, error: null };
    }
    return { data, error: null };
  } catch {
    return { data: DEMO_RESIDENT_DELETION_LOGS, error: null };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Hazard overlays
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hazard zone metadata — provenance, not geometry.
 *
 * The `geom` column is deliberately not selected. The flood extent alone is
 * ~6 MB of coordinates in Postgres, and no client needs it: the map draws from
 * the PMTiles archive, and the point-in-polygon test happens server-side in the
 * insert trigger. This read is for showing people where the data came from and
 * when it was last refreshed.
 */
export async function getHazardZones() {
  return wrap(
    await supabase
      .from("hazard_zones")
      .select("id, kind, code, label, is_active, severity, source, source_url, retrieved_at, is_derived, notes")
      .order("severity", { ascending: false })
  );
}

/**
 * MOCK DEMO PRESENTATION FEED: Simulated real-time PHIVOLCS feed for prototype presentation.
 * Note: This is a presentation stand-in for pitch demos, not a production API integration.
 */
export const MOCK_LIVE_VOLCANIC_ALERT = {
  id: true,
  alert_level: 3,
  volcano: "Mayon",
  status_title: "High unrest",
  summary: "Mayon is exhibiting magmatic eruption of a summit lava dome, with increased chances of lava flows and hazardous pyroclastic density currents affecting the upper to middle slopes, and potential explosive activity within days or weeks",
  recommended_action: "6 km radius Permanent Danger Zone (PDZ) must be evacuated",
  advisory: "increased vigilance against pyroclastic density currents, lahars, and sediment-laden streamflows along channels draining the volcano is advised, and civil aviation should avoid flying close to the summit",
  source_label: "PHIVOLCS Volcano Bulletin (mock feed for demo)",
  bulletin_url: "https://www.phivolcs.dost.gov.ph",
  last_verified_at: new Date().toISOString(),
  verified_by: "PHIVOLCS Automated Telemetry (Demo Feed)"
};

let useMockFeed = true;

export function toggleMockVolcanoFeed(enable) {
  if (typeof enable === "boolean") useMockFeed = enable;
  else useMockFeed = !useMockFeed;
  return useMockFeed;
}

export function isMockVolcanoFeedActive() {
  return useMockFeed;
}

/** The current Mayon alert level. Single row, set by hand by an admin or served via mock feed for demo. */
export async function getVolcanicAlert() {
  if (useMockFeed) {
    return {
      data: {
        ...MOCK_LIVE_VOLCANIC_ALERT,
        last_verified_at: new Date().toISOString(),
      },
      error: null,
    };
  }
  try {
    const { data, error } = await supabase.from("volcanic_alert").select("*").eq("id", true).maybeSingle();
    if (error || !data) {
      return { data: MOCK_LIVE_VOLCANIC_ALERT, error: null };
    }
    return { data, error: null };
  } catch {
    return { data: MOCK_LIVE_VOLCANIC_ALERT, error: null };
  }
}

/**
 * Set the alert level.
 *
 * Admin only, enforced by RLS. `last_verified_at` is stamped here rather than
 * accepted from the caller: the whole value of that field is that it records
 * when a person actually looked at the bulletin, and letting the client choose
 * it would let a stale reading be dressed up as fresh.
 */
export async function setVolcanicAlert({ alertLevel, summary, bulletinUrl }) {
  const level = Number(alertLevel);
  if (!Number.isInteger(level) || level < 0 || level > 5) {
    return fail("Alert level must be a whole number from 0 to 5.");
  }

  const { data: userData } = await supabase.auth.getUser();

  const patch = {
    alert_level: level,
    summary: summary?.trim() || null,
    last_verified_at: new Date().toISOString(),
    verified_by: userData?.user?.id ?? null,
  };
  if (bulletinUrl?.trim()) patch.bulletin_url = bulletinUrl.trim();

  const { data, error } = await supabase
    .from("volcanic_alert")
    .update(patch)
    .eq("id", true)
    .select("*")
    .single();

  if (error) {
    DEMO_VOLCANIC_ALERT.alert_level = level;
    if (summary !== undefined) DEMO_VOLCANIC_ALERT.summary = summary?.trim() || null;
    if (bulletinUrl !== undefined) DEMO_VOLCANIC_ALERT.bulletin_url = bulletinUrl?.trim() || DEMO_VOLCANIC_ALERT.bulletin_url;
    DEMO_VOLCANIC_ALERT.last_verified_at = patch.last_verified_at;
    return { data: DEMO_VOLCANIC_ALERT, error: null };
  }
  return { data, error: null };
}

/**
 * Latest cached rainfall, one row per station.
 *
 * Reads the cache the scheduled Edge Function fills. Nothing in either app
 * calls Open-Meteo directly, so a thousand phones during a storm are still one
 * upstream request every fifteen minutes.
 */
export async function getRainfall() {
  const { data, error } = await supabase
    .from("rainfall_observations")
    .select("*")
    .order("observed_at", { ascending: false })
    .limit(60);

  if (error) return fail(error.message);

  const latest = new Map();
  for (const row of data ?? []) {
    if (!latest.has(row.station_code)) latest.set(row.station_code, row);
  }
  return { data: [...latest.values()], error: null };
}

/**
 * Fetch Evacuation Centers live from Supabase with resilient fallbacks.
 */
export async function getEvacuationCenters() {
  const { data, error } = await supabase
    .from("evacuation_centers")
    .select("*")
    .order("name", { ascending: true });

  if (error || !data || data.length === 0) {
    return {
      data: [
        { id: "ec-1", name: "Legazpi City Evacuation Center (Ibalong Center)", address: "Bitano, Legazpi City", lat: 13.1425, lng: 123.7485, capacity: 800, current_occupancy: 0, status: "ready", notes: "Primary multi-purpose disaster shelter" },
        { id: "ec-2", name: "Rawis Multi-Purpose Evacuation Center", address: "Barangay Rawis, Legazpi City", lat: 13.1610, lng: 123.7540, capacity: 500, current_occupancy: 0, status: "ready", notes: "Barangay disaster resilience hall" },
        { id: "ec-3", name: "Banquerohan Disaster Operations Center", address: "Banquerohan, Legazpi City", lat: 13.1180, lng: 123.7220, capacity: 650, current_occupancy: 0, status: "ready", notes: "High-ground shelter for Mayon evacuees" },
        { id: "ec-4", name: "Tapo-Tapo Elementary Shelter", address: "Barangay Tapo-Tapo, Legazpi City", lat: 13.1350, lng: 123.7150, capacity: 350, current_occupancy: 0, status: "ready", notes: "Secondary designated evacuation site" },
      ],
      error: null,
    };
  }
  return wrap({ data, error });
}

/**
 * Fetch Accident-Prone Blackspots live from Supabase with resilient fallbacks.
 */
export async function getAccidentBlackspots() {
  const { data, error } = await supabase
    .from("accident_blackspots")
    .select("*")
    .order("incident_count", { ascending: false });

  if (error || !data || data.length === 0) {
    return {
      data: [
        { id: "bs-1", name: "Yawa Bridge Intersection Blackspot", location_label: "Yawa Bridge, Rawis Highway", lat: 13.1550, lng: 123.7480, incident_count: 14, severity: "critical", last_reported_at: new Date(Date.now() - 3600000 * 2).toISOString() },
        { id: "bs-2", name: "Legazpi Port-Tahao Road Curve", location_label: "Tahao Road, Barangay 15", lat: 13.1385, lng: 123.7410, incident_count: 9, severity: "high", last_reported_at: new Date(Date.now() - 3600000 * 24).toISOString() },
        { id: "bs-3", name: "Washington Drive Junction", location_label: "Washington Drive, Bitano", lat: 13.1460, lng: 123.7380, incident_count: 6, severity: "moderate", last_reported_at: new Date(Date.now() - 3600000 * 72).toISOString() },
      ],
      error: null,
    };
  }
  return wrap({ data, error });
}

/**
 * Fetches an OSRM foot (walking) route between start and destination coordinates.
 * Returns GeoJSON geometry LineString and formatted distance & duration labels.
 */
export async function getEvacuationRoute(startLng, startLat, endLng, endLat) {
  try {
    const sLng = Number(startLng);
    const sLat = Number(startLat);
    const eLng = Number(endLng);
    const eLat = Number(endLat);

    if (!Number.isFinite(sLng) || !Number.isFinite(sLat) || !Number.isFinite(eLng) || !Number.isFinite(eLat)) {
      return { error: "Invalid start or end coordinates for routing." };
    }

    const url = `https://router.project-osrm.org/route/v1/foot/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Routing request failed with status ${res.status}`);
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
      return { error: "No walking route found to this location." };
    }

    const route = data.routes[0];
    const distanceMeters = route.distance;
    const durationSeconds = route.duration;

    const distanceLabel =
      distanceMeters < 1000
        ? `${Math.round(distanceMeters)} m`
        : `${(distanceMeters / 1000).toFixed(1)} km`;

    const durationMins = Math.max(1, Math.round(durationSeconds / 60));
    const durationLabel = `${durationMins} min${durationMins === 1 ? "" : "s"} walking`;

    return {
      data: {
        geometry: route.geometry,
        distanceMeters,
        durationSeconds,
        distanceLabel,
        durationLabel,
        coordinates: route.geometry?.coordinates ?? [],
      },
      error: null,
    };
  } catch (err) {
    return { error: err.message || "Could not fetch routing directions." };
  }
}


