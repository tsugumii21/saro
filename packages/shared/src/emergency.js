/**
 * In-browser emergency keyword detection.
 *
 * ⚠ MIRROR — this file is a deliberate duplicate of
 * `supabase/functions/gemini-proxy/emergency.ts`. Edit one, edit the other.
 *
 * It is duplicated rather than shared because the two runtimes cannot import
 * each other: the Edge Function is Deno with URL imports and no access to the
 * npm workspace, and the browser bundle cannot pull from `supabase/functions`
 * without dragging Deno-only imports into Vite. A build step could bridge them;
 * a build step that must succeed for a fire to be reported correctly is a worse
 * trade than two files and this comment.
 *
 * WHY IT EXISTS AT ALL, given the Edge Function already does this:
 *
 * The decision "does this guest hit a login wall?" must not depend on a network
 * round-trip to a third-party model. During the storm that makes SARO matter,
 * the network is the first thing to go and Gemini's free tier is the second.
 * So the browser decides first, locally, in microseconds, before any request is
 * made. The Edge Function's copy is the belt to this file's braces — it catches
 * emergencies phrased in ways the keywords miss, and it still runs, but nothing
 * urgent waits on it.
 *
 * The asymmetry is intentional: a false positive costs one report that could
 * have been attributed to an account. A false negative puts a signup form in
 * front of someone watching a fire. Err toward true.
 */

/** Words that mean "something is happening now", in Bikol, Tagalog and English. */
export const EMERGENCY_KEYWORDS = [
  "sunog", "apoy", "baha", "dugo", "patay", "nahulog", "disgrasya", "aksidente",
  "krimen", "baril", "kutsilyo", "salud", "ospital", "ambulansya", "emergency",
  "suicide", "fire", "flood", "accident", "bleeding", "unconscious", "stroke", "heart attack",
];

/** Words that mean "I am asking a question", not "this is happening". */
export const FAQ_QUERY_INDICATORS = [
  "ano", "paano", "saan", "kailan", "bakit", "sino", "what", "how", "where", "when", "why", "who",
  "hotline", "number", "numero", "contact", "tel", "phone", "lista", "listahan", "gabay", "faq",
  "info", "tanggapan",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAny(text, words) {
  for (const word of words) {
    if (new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(text)) return word;
  }
  return null;
}

/**
 * Describe fast-track. Keywords only — no question suppression.
 *
 * "Ano ba yan, may sunog!" contains "ano" and is absolutely an emergency.
 *
 * @param {string} description
 * @returns {{ matchedPhrase: string } | null}
 */
export function detectEmergencyInDescription(description) {
  if (!description || typeof description !== "string") return null;
  const matched = matchesAny(description.toLowerCase().trim(), EMERGENCY_KEYWORDS);
  return matched ? { matchedPhrase: matched } : null;
}

/**
 * Assistant tripwire. Keywords, suppressed when the text reads as a question.
 *
 * "Ano ang emergency hotline ng CDRRMO?" contains "emergency" but is somebody
 * looking up a number, not somebody in a fire.
 *
 * @param {string} question
 * @returns {{ matchedPhrase: string } | null}
 */
export function checkEmergencyTripwire(question) {
  if (!question || typeof question !== "string") return null;
  const lower = question.toLowerCase().trim();
  if (matchesAny(lower, FAQ_QUERY_INDICATORS)) return null;
  const matched = matchesAny(lower, EMERGENCY_KEYWORDS);
  return matched ? { matchedPhrase: matched } : null;
}
