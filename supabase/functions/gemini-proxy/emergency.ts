// Emergency keyword detection, shared by both modes of the function.
//
// Lifted from the prototype's gemini.js. The two modes need the SAME keywords
// but DIFFERENT rules around them, which is why this is one module with two
// entry points rather than one function with a flag:
//
//   assistant → a question. "Ano ang emergency hotline ng CDRRMO?" contains
//               "emergency" but is not one, so FAQ indicators suppress the
//               tripwire.
//
//   describe  → a statement of what the person is looking at. "Ano ba yan, may
//               sunog!" contains "ano" but is absolutely an emergency.
//               Suppressing on FAQ indicators here would push a live fire down
//               the non-urgent path and into a login wall, which is the exact
//               failure this product exists to avoid. So: keywords only.

export const EMERGENCY_KEYWORDS = [
  "sunog", "apoy", "baha", "dugo", "patay", "nahulog", "disgrasya", "aksidente",
  "krimen", "baril", "kutsilyo", "salud", "ospital", "ambulansya", "emergency",
  "suicide", "fire", "flood", "accident", "bleeding", "unconscious", "stroke", "heart attack",
];

// Informational indicators that mean "this is a question", not a report.
export const FAQ_QUERY_INDICATORS = [
  "ano", "paano", "saan", "kailan", "bakit", "sino", "what", "how", "where", "when", "why", "who",
  "hotline", "number", "numero", "contact", "tel", "phone", "lista", "listahan", "gabay", "faq",
  "info", "tanggapan",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAny(text: string, words: string[]): string | null {
  for (const word of words) {
    if (new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(text)) return word;
  }
  return null;
}

/**
 * Assistant tripwire: emergency keywords, suppressed when the text reads as a
 * question. Returns the matched phrase, or null.
 */
export function checkEmergencyTripwire(question: string): { matchedPhrase: string } | null {
  if (!question || typeof question !== "string") return null;
  const qLower = question.toLowerCase().trim();

  if (matchesAny(qLower, FAQ_QUERY_INDICATORS)) return null;

  const matched = matchesAny(qLower, EMERGENCY_KEYWORDS);
  return matched ? { matchedPhrase: matched } : null;
}

/**
 * Describe fast-track: emergency keywords, no question suppression.
 *
 * A true result means the report may be filed anonymously with no login
 * prompt, so this errs toward true on purpose. A false positive costs a guest
 * report that could have been attributed; a false negative puts a login wall
 * in front of someone watching a fire.
 */
export function detectEmergencyInDescription(description: string): { matchedPhrase: string } | null {
  if (!description || typeof description !== "string") return null;
  const matched = matchesAny(description.toLowerCase().trim(), EMERGENCY_KEYWORDS);
  return matched ? { matchedPhrase: matched } : null;
}
