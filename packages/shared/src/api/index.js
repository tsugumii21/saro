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
      p_callback_number: insert.callback_number,
      p_is_proxy: insert.is_proxy_report,
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

/**
 * File on Behalf, for barangay officials and admins.
 *
 * `reporter_user_id` is set to the OFFICIAL, not to the walk-in resident, who
 * by definition has no account. Two reasons, and both are load-bearing:
 *
 *   The reports table has a CHECK requiring exactly one of reporter_device_id
 *   or reporter_user_id. A desk-filed report has no device, so the user column
 *   is the only one left — omitting both fails the constraint outright.
 *
 *   The barangay insert policy demands `filed_by = auth.uid()` AND
 *   `reporter_user_id = auth.uid()`. Setting only filed_by, which is what this
 *   function used to do, satisfied neither the policy nor the constraint, so
 *   every File on Behalf attempt was rejected with a bare RLS violation.
 *
 * It also makes the report attributable: a named official vouched for it and
 * can be asked what they were told, which is exactly what `filed_by_verified`
 * should mean on a proxy report.
 */
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
      reporter_user_id: uid,
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

  if (["closed_confirmed", "closed_unconfirmed", "reopened"].includes(newStatus)) {
    return fail(
      "Confirmation and reopening belong to the resident. Officials cannot set these."
    );
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
    } else {
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
 * Profiles
 * ═══════════════════════════════════════════════════════════════════════════ */

export async function getProfile(userId) {
  if (!userId) return fail("User id is required");
  return wrap(
    await supabase.from("profiles_with_scope").select("*").eq("id", userId).maybeSingle()
  );
}
