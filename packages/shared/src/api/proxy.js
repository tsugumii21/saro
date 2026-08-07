/**
 * The one client for the gemini-proxy Edge Function.
 *
 * Both AI surfaces go through here — the Describe flow's structuring call and
 * the public Q&A assistant — because they are one integration with two modes,
 * not two integrations. Timeout handling, degradation, device identification
 * and rate-limit behaviour are written once and behave identically in both.
 *
 * The API key is not in this file, this bundle, or this repository. It is a
 * Supabase secret read by the function at runtime.
 */

import { supabase } from "../supabase/client.js";
import { detectEmergencyInDescription } from "../emergency.js";
import { CLIENT_STORAGE_KEYS } from "../constants.js";

/**
 * Hard ceiling on how long any AI call may take.
 *
 * 8 seconds is chosen against the worst realistic case rather than the average
 * one: someone on 3G in a storm. Past that the answer has stopped being useful
 * and the fallback — the resident's own words, unstructured — is better than a
 * spinner. The function itself already caps Gemini at 20s; this is the tighter
 * client-side limit, and it is the one that governs.
 */
const CALL_TIMEOUT_MS = 8000;

function deviceId() {
  try {
    let id = localStorage.getItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT);
    if (!id) {
      id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT, id);
    }
    return id;
  } catch {
    return null;   // private mode with storage blocked; the call still works
  }
}

async function invoke(body) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), CALL_TIMEOUT_MS)
  );

  const call = supabase.functions
    .invoke("gemini-proxy", { body: { ...body, deviceId: deviceId() } })
    .then(({ data, error }) => {
      if (error) throw new Error(error.message || "proxy error");
      if (data?.error) throw new Error(data.error);
      return data;
    });

  return Promise.race([call, timeout]);
}

/**
 * Turn free text into a structured draft report.
 *
 * ⚠ The `isEmergency` field on the RESULT is not what decides whether a guest
 * hits a login wall. That decision is made in the browser by
 * `detectEmergencyInDescription` before this function is ever called, and is
 * merged in below so the caller cannot accidentally trust the network for it.
 * If this call times out, is rate-limited, or returns nonsense, an emergency
 * described in plain words still fast-tracks.
 *
 * @param {string} description
 * @returns {Promise<{
 *   category: string|null, categoryLabel: string|null, summary: string,
 *   isEmergency: boolean, emergencySource: "keyword"|"category"|null,
 *   matchedPhrase: string|null, confidence: "high"|"low", isFallback: boolean,
 *   degraded: boolean
 * }>}
 */
export async function structureDescription(description) {
  const localHit = detectEmergencyInDescription(description);

  /** What the resident gets if the network or the model lets them down. */
  const degradedResult = {
    category: null,
    categoryLabel: null,
    summary: description.trim().slice(0, 140),
    isEmergency: Boolean(localHit),
    emergencySource: localHit ? "keyword" : null,
    matchedPhrase: localHit?.matchedPhrase ?? null,
    confidence: "low",
    isFallback: true,
    degraded: true,
  };

  try {
    const data = await invoke({ mode: "describe", description });
    return {
      category: data.category ?? null,
      categoryLabel: data.categoryLabel ?? null,
      summary: data.summary || degradedResult.summary,
      // OR, never assignment. The server may spot an emergency the keywords
      // missed; it may never talk the browser out of one it already found.
      isEmergency: Boolean(localHit) || Boolean(data.isEmergency),
      emergencySource: localHit ? "keyword" : (data.emergencySource ?? null),
      matchedPhrase: localHit?.matchedPhrase ?? data.matchedPhrase ?? null,
      confidence: data.confidence ?? "low",
      isFallback: Boolean(data.isFallback),
      degraded: false,
    };
  } catch {
    return degradedResult;
  }
}

/**
 * Ask the grounded assistant a question.
 *
 * Grounding is enforced server-side against the city's published documents. A
 * question it cannot answer from those documents returns `isFallback: true`
 * with `matchedDocId: null`, and the function writes it to `gap_log` for the
 * admin app — the client does not need to do anything to make that happen, and
 * deliberately has no way to suppress it.
 *
 * @param {string} question
 * @returns {Promise<{
 *   answer: string, matchedDocId: string|null, source: string|null,
 *   isEmergency: boolean, matchedPhrase?: string, isFallback: boolean,
 *   topicCluster: string|null, degraded: boolean
 * }>}
 */
export async function askAssistant(question) {
  try {
    const data = await invoke({ mode: "assistant", question });
    return {
      answer: data.answer ?? "",
      matchedDocId: data.matchedDocId ?? null,
      source: data.source ?? null,
      isEmergency: Boolean(data.isEmergency),
      matchedPhrase: data.matchedPhrase,
      isFallback: Boolean(data.isFallback),
      topicCluster: data.topicCluster ?? null,
      degraded: false,
    };
  } catch {
    // Refusing is the honest answer. Inventing a hotline number for someone in
    // trouble because the network was down would be the single worst thing
    // this assistant could do.
    return {
      answer:
        "I can't reach the city's document service right now, so I won't guess. " +
        "For anything urgent call 911. Otherwise please try again in a moment.",
      matchedDocId: null,
      source: null,
      isEmergency: false,
      isFallback: true,
      topicCluster: null,
      degraded: true,
    };
  }
}
