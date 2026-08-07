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

/** Normalise a PostgrestError into the { data, error } shape the apps expect. */
function wrap({ data, error }) {
  return { data: error ? null : data, error: error ? error.message : null };
}

function fail(message) {
  return { data: null, error: message };
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

function adaptCategory(row) {
  if (!row) return row;
  return {
    ...row,
    id: row.category,           // alias: mock called this `id`
    name: row.label,            // alias: mock called this `name`
    name_bikol: row.label_bikol,
    name_tagalog: row.label_tagalog,
    office_id: row.responsible_office_id,
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

export async function getOffices() {
  return wrap(await supabase.from("offices").select("*").order("short_name"));
}

export async function getCategories() {
  // The routing table is the category list. `label` is the display name;
  // `category` is the stable key stored on reports.
  const { data, error } = await supabase.from("routing_table").select("*").order("label");
  if (error) return fail(error.message);
  return { data: (data ?? []).map(adaptCategory), error: null };
}

export async function getBarangays() {
  return wrap(await supabase.from("barangays").select("id, name, is_coastal").order("name"));
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

/** Coarse public hazard map. Coordinates are rounded server-side to ~110 m. */
export async function getPublicMapReports(maxAgeHours = 168) {
  const { data, error } = await supabase.rpc("get_public_map_reports", {
    max_age_hours: maxAgeHours,
  });
  if (error) return fail(error.message);
  return { data: (data ?? []).map(adaptReport), error: null };
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
export async function getReports({ status, category, barangayId, limit = 500 } = {}) {
  let query = supabase
    .from("reports")
    .select(
      `id, tracking_code, category, description, lat, lng, status,
       assigned_office_id, barangay_id, photo_url, reporter_device_id,
       reporter_user_id, filed_by_verified,
       callback_number, is_proxy_report, is_false_report, cluster_id,
       filed_by, created_at, updated_at, resolved_at,
       offices:assigned_office_id ( id, short_name, full_name ),
       barangays:barangay_id ( id, name ),
       routing_table:category ( label, is_emergency, sla_hours )`
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  if (barangayId) query = query.eq("barangay_id", barangayId);

  const { data, error } = await query;
  if (error) return fail(error.message);
  return { data: (data ?? []).map(adaptReport), error: null };
}

export async function getReportById(reportId) {
  if (!reportId) return fail("Report id is required");
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
    callback_number: payload.callback_number || null,
    is_proxy_report: Boolean(payload.is_proxy_report),
    photo_url: payload.photo_url ?? null,
  };

  if (payload.barangay_id) insert.barangay_id = payload.barangay_id;

  if (anonymous) {
    const deviceId = payload.device_fingerprint ?? payload.reporter_device_id ?? null;
    if (!deviceId) return fail("A device id is required to file anonymously.");
    insert.reporter_device_id = deviceId;
  } else {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) {
      return fail("Please sign in to file a standard report, or describe an emergency instead.");
    }
    insert.reporter_user_id = uid;
  }

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

/** Barangay officials' File on Behalf. Requires an authenticated session. */
export async function createReportOnBehalf(payload) {
  const { data: sessionData } = await supabase.auth.getUser();
  const uid = sessionData?.user?.id;
  if (!uid) return fail("You must be signed in to file on behalf of a resident.");

  const { data, error } = await supabase
    .from("reports")
    .insert({
      category: payload.category,
      description: (payload.description ?? "").trim(),
      lat: Number(payload.lat),
      lng: Number(payload.lng),
      barangay_id: payload.barangay_id,
      callback_number: payload.callback_number || null,
      is_proxy_report: true,
      filed_by: uid,
    })
    .select("id, tracking_code, status, created_at")
    .single();

  if (error) return fail(error.message);
  return { data, error: null };
}

/**
 * Move a report along the pipeline.
 *
 * The acting profile id is no longer a parameter. The old mock layer took one
 * and compared it in JavaScript, which meant the caller chose who they were.
 * Now the identity comes from the JWT and the office check is an RLS policy, so
 * a mismatch fails in the database.
 */
export async function updateReportStatus(reportId, newStatus, note) {
  if (!reportId || !newStatus) return fail("Report id and status are required");

  // Resolution requires photographic evidence. Enforced here for a clear
  // message; a future migration should also assert it as a constraint so the
  // rule holds for any client.
  if (newStatus === "resolved") {
    const { data: media, error: mediaError } = await supabase
      .from("report_media")
      .select("id")
      .eq("report_id", reportId)
      .eq("kind", "resolution")
      .limit(1);

    if (mediaError) return fail(mediaError.message);
    if (!media?.length) {
      return fail("Resolution photo required: attach one before marking this report resolved.");
    }
  }

  const { data, error } = await supabase
    .from("reports")
    .update({ status: newStatus })
    .eq("id", reportId)
    .select("id, status, resolved_at, updated_at")
    .single();

  if (error) {
    // RLS returns an empty result rather than an explicit denial.
    return fail(
      error.code === "PGRST116"
        ? "You do not have permission to change this report."
        : error.message
    );
  }

  if (note) {
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("report_status_history").insert({
      report_id: reportId,
      status: newStatus,
      note,
      changed_by: userData?.user?.id ?? null,
    });
  }

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
  if (Object.keys(patch).length === 0) return fail("Nothing to update");

  const { data: userData } = await supabase.auth.getUser();
  patch.updated_by = userData?.user?.id ?? null;

  return wrap(
    await supabase
      .from("routing_table")
      .update(patch)
      .eq("category", category)
      .select("*")
      .single()
  );
}

export async function getRoutingChangelog(limit = 100) {
  return wrap(
    await supabase
      .from("routing_table_changelog")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(limit)
  );
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

/** Admin gap-log viewer. Admin-only by RLS. */
export async function getAssistantLogs({ unresolvedOnly = false, limit = 200 } = {}) {
  let query = supabase
    .from("gap_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unresolvedOnly) query = query.eq("resolved", false);
  return wrap(await query);
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

export async function resolveGapLogEntry(id, resolved = true) {
  if (!id) return fail("Gap log id is required");
  const { data: userData } = await supabase.auth.getUser();
  return wrap(
    await supabase
      .from("gap_log")
      .update({
        resolved,
        resolved_by: resolved ? userData?.user?.id ?? null : null,
        resolved_at: resolved ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select("*")
      .single()
  );
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
 * Profiles
 * ═══════════════════════════════════════════════════════════════════════════ */

export async function getProfile(userId) {
  if (!userId) return fail("User id is required");
  return wrap(
    await supabase.from("profiles_with_scope").select("*").eq("id", userId).maybeSingle()
  );
}
