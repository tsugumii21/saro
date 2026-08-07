// Client for the gemini-proxy Edge Function.
//
// Neither app talks to Gemini directly any more. The API key lives as a
// Supabase secret inside the function; the browser only knows this URL and the
// publishable key, both of which are safe to ship.

import { supabase } from "../supabase/client.js";

const FUNCTION_NAME = "gemini-proxy";

function fail(message) {
  return { data: null, error: message };
}

/**
 * Grounded document assistant.
 *
 * Emergency detection and the local knowledge-base fallback both run inside the
 * function, so an answer always comes back even when Gemini is unreachable —
 * the resident sees `isFallback: true` rather than an error.
 *
 * @param {string} question
 * @param {{ deviceId?: string }} [options]
 */
export async function askAssistant(question, { deviceId } = {}) {
  if (!question || !question.trim()) return fail("Question is required");

  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { mode: "assistant", question: question.trim(), deviceId: deviceId ?? null },
  });

  if (error) return fail(error.message ?? "Assistant is temporarily unavailable.");
  if (data?.error) return fail(data.error);
  return { data, error: null };
}

/**
 * Describe-flow structuring: free text in, a suggested category and a one-line
 * dispatcher summary out.
 *
 * The suggestion is never applied automatically. The resident confirms it, so a
 * wrong guess costs a tap rather than a misrouted emergency.
 *
 * @param {string} description
 */
export async function structureDescription(description) {
  if (!description || !description.trim()) return fail("Description is required");

  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { mode: "describe", description: description.trim() },
  });

  if (error) return fail(error.message ?? "Could not analyse that description.");
  if (data?.error) return fail(data.error);
  return { data, error: null };
}
