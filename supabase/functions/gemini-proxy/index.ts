// SARO gemini-proxy — the only place Gemini is called from.
//
// One function, two modes:
//   POST { mode: "assistant", question, deviceId? }
//   POST { mode: "describe",  description }
//
// Both share one Gemini client (gemini.ts); only the prompt and generation
// config differ. Neither app ever sees the API key: it lives as a Supabase
// secret in this runtime.
//
// Deploy:  supabase functions deploy gemini-proxy
// Secret:  supabase secrets set GEMINI_API_KEY=...
// Local:   supabase functions serve gemini-proxy --env-file supabase/.env

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { askAssistant } from "./assistant.ts";
import { structureDescription } from "./describe.ts";
import { synthesizeHazardInsight } from "./insight.ts";

// Injected by the platform. The service role key stays server-side; it is used
// only to write the gap log and to read the routing table, both of which the
// anonymous caller must not be able to do directly.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SB_SECRET_KEY") ??
  "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MAX_INPUT_CHARS = 2000;

/** Cheap in-memory throttle. Resets when the isolate recycles — a speed bump,
 *  not a security control. Real abuse handling belongs in the gateway. */
const recentCalls = new Map<string, number[]>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (recentCalls.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recentCalls.set(key, hits);
  return hits.length > RATE_LIMIT;
}

async function loadCategories() {
  const { data, error } = await admin
    .from("routing_table")
    .select("category, label, is_emergency")
    .order("category");

  if (error) {
    console.error("Could not read routing_table:", error.message);
    return [];
  }
  return data ?? [];
}

/** Record every assistant question. Unanswered ones become the admin gap log. */
async function logToGapLog(
  question: string,
  wasAnswered: boolean,
  matchedDoc: string | null,
  topicCluster: string | null,
  deviceId: string | null,
) {
  const { error } = await admin.from("gap_log").insert({
    question,
    was_answered: wasAnswered,
    matched_doc: matchedDoc,
    topic_cluster: topicCluster,
    device_id: deviceId,
  });
  if (error) console.error("gap_log insert failed:", error.message);
}

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: "Body must be JSON" }, 400);
  }

  const mode = String(body.mode ?? "");
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : null;

  const throttleKey =
    deviceId ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anonymous";

  if (isRateLimited(throttleKey)) {
    return jsonResponse(request, { error: "Too many requests. Please wait a moment." }, 429);
  }

  try {
    if (mode === "assistant") {
      const question = String(body.question ?? "").trim();
      if (!question) {
        return jsonResponse(request, { error: "question is required" }, 400);
      }
      if (question.length > MAX_INPUT_CHARS) {
        return jsonResponse(request, { error: "question is too long" }, 413);
      }

      const result = await askAssistant(question);

      // Answered means grounded in a real published document — nothing weaker.
      //
      // This used to be `!isFallback || matchedDocId !== null`, which counted
      // every Gemini reply as answered because isFallback was only ever set by
      // the local fallback path. A fluent "please contact the City Health
      // Office" with no document behind it therefore never reached the gap log,
      // which is precisely the question staff needed to see. The emergency
      // tripwire is excluded too: redirecting somebody to 911 is the right
      // response, not a documentation gap.
      const wasAnswered = result.matchedDocId !== null && result.matchedDocId !== "emergency_tripwire";
      await logToGapLog(question, wasAnswered, result.matchedDocId, result.topicCluster, deviceId);

      return jsonResponse(request, result);
    }

    if (mode === "describe") {
      const description = String(body.description ?? "").trim();
      if (!description) {
        return jsonResponse(request, { error: "description is required" }, 400);
      }
      if (description.length > MAX_INPUT_CHARS) {
        return jsonResponse(request, { error: "description is too long" }, 413);
      }

      const categories = await loadCategories();
      const result = await structureDescription(description, categories);
      return jsonResponse(request, result);
    }

    if (mode === "insight") {
      const report = body.report as any;
      if (!report || !report.description) {
        return jsonResponse(request, { error: "report with description is required" }, 400);
      }
      const result = await synthesizeHazardInsight({
        tracking_code: String(report.tracking_code || ""),
        category: String(report.category || ""),
        description: String(report.description || ""),
        barangay: String(report.barangay || ""),
        status: String(report.status || "received"),
        created_at: String(report.created_at || new Date().toISOString())
      });
      return jsonResponse(request, result);
    }

    return jsonResponse(
      request,
      { error: 'mode must be "assistant", "describe", or "insight"' },
      400,
    );
  } catch (err) {
    // Never surface an upstream error body to the browser; it can echo the
    // prompt and, on some providers, fragments of the key.
    console.error("gemini-proxy failed:", err);
    return jsonResponse(request, { error: "Assistant is temporarily unavailable." }, 502);
  }
});
