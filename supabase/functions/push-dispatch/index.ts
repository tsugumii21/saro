// SARO push-dispatch — sends Web Push when a report's status changes.
//
// Called by the admin app immediately after a successful status update. It is
// NOT a database trigger, and that is a deliberate choice rather than an
// omission: driving it from Postgres means pg_net has to hold a service-role
// key, which means the key lives either in a migration file (committed) or in a
// database setting (readable by anything with enough privilege). Neither is
// acceptable when the whole key policy for this project is "secrets exist only
// as Supabase secrets". An explicit call from an authenticated staff session
// costs one round trip and keeps the key where it belongs.
//
// Consequence, stated plainly: a status change made directly in the Supabase
// dashboard or by a raw SQL update sends no notification. Every change made
// through the admin app does.
//
// Deploy:  supabase functions deploy push-dispatch
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SB_SECRET_KEY") ??
  "";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:saro@legazpi.gov.ph";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** What each status says to the person who filed the report. Written for
 *  someone reading a lock screen, so: what happened, in one line, no jargon. */
const MESSAGES: Record<string, { title: string; body: string }> = {
  assigned: {
    title: "Your report was assigned",
    body: "An office has picked it up.",
  },
  in_progress: {
    title: "Work has started",
    body: "Someone is dealing with your report now.",
  },
  resolved: {
    title: "Your report was marked resolved",
    body: "Tap to confirm it was actually fixed — or say it wasn't.",
  },
  closed_confirmed: {
    title: "Report closed",
    body: "Thanks for confirming.",
  },
  closed_unconfirmed: {
    title: "Report closed without your answer",
    body: "You can still reopen it if it was never fixed.",
  },
  reopened: {
    title: "Your report was reopened",
    body: "It is back with the office that handled it.",
  },
};

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed" }, 405);
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    // Not an error the caller can fix, and not a reason to fail their status
    // update. Report it and move on.
    console.error("VAPID keys are not configured; nothing was sent.");
    return jsonResponse(request, { sent: 0, skipped: "not configured" });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  let body: { report_id?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: "Body must be JSON" }, 400);
  }

  const reportId = String(body.report_id ?? "");
  const status = String(body.status ?? "");
  if (!reportId || !status) {
    return jsonResponse(request, { error: "report_id and status are required" }, 400);
  }

  const message = MESSAGES[status];
  // 'received' has no message: the person was looking at the screen when it
  // happened. A notification for something you just did is noise.
  if (!message) return jsonResponse(request, { sent: 0, skipped: "no message for status" });

  const { data: report, error: reportError } = await admin
    .from("reports")
    .select("tracking_code, reporter_user_id, reporter_device_id")
    .eq("id", reportId)
    .maybeSingle();

  if (reportError || !report) {
    return jsonResponse(request, { error: "Report not found" }, 404);
  }

  // Exactly one of these is set — the database enforces it — so this matches
  // the subscription the same way the report was filed.
  const query = admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .eq("is_active", true);

  const { data: subscriptions, error: subError } = report.reporter_user_id
    ? await query.eq("subscriber_user_id", report.reporter_user_id)
    : await query.eq("subscriber_device_id", report.reporter_device_id);

  if (subError) return jsonResponse(request, { error: subError.message }, 500);
  if (!subscriptions?.length) return jsonResponse(request, { sent: 0 });

  const payload = JSON.stringify({
    title: message.title,
    body: `${message.body} (${report.tracking_code})`,
    tracking_code: report.tracking_code,
  });

  let sent = 0;
  const dead: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload,
        );
        sent += 1;
      } catch (err) {
        // 404 and 410 mean the browser threw the subscription away — the app
        // was uninstalled, or notifications were turned off at the OS level.
        // Those rows are marked inactive instead of being retried forever.
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) dead.push(sub.endpoint);
        else console.error("push failed:", statusCode, (err as Error).message);
      }
    }),
  );

  if (dead.length) {
    await admin.from("push_subscriptions").update({ is_active: false }).in("endpoint", dead);
  }

  return jsonResponse(request, { sent, pruned: dead.length });
});
