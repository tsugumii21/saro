// Grounded document assistant.
//
// Ported from the prototype's apps/resident-app/src/lib/gemini.js. The keyword
// lists, the scoring weights, the tripwire rule and the fallback wording are
// carried over unchanged — only the transport moved to the server. The one
// substantive fix: the original called `new GoogleGenAI(...)` without importing
// it, so every request threw and silently fell back to local matching. Gemini
// has therefore never actually answered a question in this product.

import knowledgeBase from "./knowledge-base.json" with { type: "json" };
import { generate, GeminiError } from "./gemini.ts";
import { checkEmergencyTripwire } from "./emergency.ts";

export { checkEmergencyTripwire };

interface KnowledgeEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  source?: string;
}

const KB = knowledgeBase as KnowledgeEntry[];

// Emergency keywords and the tripwire itself now live in emergency.ts, so the
// describe mode can share the keyword list without inheriting the question
// suppression rule.

// Stop words for score matching
const STOP_WORDS = new Set([
  "ang", "sa", "na", "ng", "mga", "ko", "mo", "si", "ni", "kay", "pa", "din", "rin",
  "dito", "doon", "ano", "paano", "saan", "kailan", "bakit", "sino", "the", "a", "an", "in",
  "on", "at", "to", "for", "of", "with", "is", "are", "was", "were", "be", "what", "how", "where",
]);

export interface AssistantResult {
  mode: "assistant";
  isEmergency: boolean;
  matchedPhrase?: string;
  answer: string;
  matchedDocId: string | null;
  source: string | null;
  isFallback: boolean;
  topicCluster: string | null;
}

/** Deterministic local match. Runs when Gemini is unavailable or errors. */
function localFallback(question: string): AssistantResult {
  const qLower = question.toLowerCase().trim();
  const qWords = qLower
    .replace(/[^\w\s]/gi, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  let bestEntry: KnowledgeEntry | null = null;
  let bestScore = 0;

  for (const entry of KB) {
    let score = 0;
    const eQ = entry.question.toLowerCase();
    const eA = entry.answer.toLowerCase();
    const eCat = entry.category.toLowerCase();

    if (qLower.includes(eQ) || eQ.includes(qLower)) score += 10;
    for (const word of qWords) {
      if (eQ.includes(word)) score += 3;
      if (eA.includes(word)) score += 1;
      if (eCat.includes(word)) score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (bestEntry && bestScore >= 3) {
    return {
      mode: "assistant",
      isEmergency: false,
      answer: bestEntry.answer,
      matchedDocId: bestEntry.id,
      source: bestEntry.source ?? null,
      isFallback: true,
      topicCluster: bestEntry.category,
    };
  }

  // Out of scope: name the office most likely to own the question.
  let office = "City Disaster Risk Reduction and Management Office (CDRRMO) o Legazpi 911";
  let topic = "out_of_scope";
  if (/kalsada|tulay|lubak|road/.test(qLower)) {
    office = "City Engineering Office (CEO)";
    topic = "roads";
  } else if (/sunog|fire|gas/.test(qLower)) {
    office = "Bureau of Fire Protection (BFP Legazpi)";
    topic = "fire";
  } else if (/gulo|krimen|pulis/.test(qLower)) {
    office = "Philippine National Police (PNP Legazpi)";
    topic = "peace_and_order";
  } else if (/tubig|health|sakit/.test(qLower)) {
    office = "City Health Office (CHO)";
    topic = "health";
  }

  return {
    mode: "assistant",
    isEmergency: false,
    answer:
      `Pasensya na, wala sa aming opisyal na gabay ang kasagutan sa iyong tanong. ` +
      `Maaari kang makipag-ugnayan sa kaukulang tanggapan ng Lungsod ng Legazpi: ${office}.`,
    matchedDocId: null,
    source: null,
    isFallback: true,
    topicCluster: topic,
  };
}

const SYSTEM_PROMPT =
  `You are SARO Assistant, the official calm, plain, unshowy civic guidance assistant for Legazpi City, Philippines.
You must answer the user's question ONLY using the official Knowledge Base entries provided below.

RULES:
1. Tone: Plain, calm, direct public service. NO marketing tone, NO exclamation marks, NO celebratory text.
2. If a Knowledge Base entry answers the question, answer from it, and set "doc_id" to that entry's exact id and "answered" to true.
3. If NO entry answers the question, you MUST set "answered" to false and "doc_id" to null. Do not guess, do not infer, do not combine entries into a new fact, and do not state a phone number, address, office hour or procedure that is not written in an entry. In "answer", say plainly that this is not in the city's published guidance and name the most relevant Legazpi City office to contact (CDRRMO, Legazpi 911, City Engineering Office, BFP, PNP, CHO, PSO, Coast Guard).
4. A partially relevant entry is NOT an answer. If the entry does not contain the specific fact asked for, "answered" is false.
5. Respond in the same language as the user (English, Tagalog, or Bikol).

KNOWLEDGE BASE:
${JSON.stringify(KB, null, 2)}`;

/**
 * Structured output, because the old contract was self-contradictory.
 *
 * The prompt used to tell the model NOT to emit a doc id, and the code then
 * parsed the reply for `[doc_xxx]` tags. It never found one — so matchedDocId
 * was null on every Gemini answer, no answer was ever cited to a document, and
 * the gap log recorded everything as answered because it fell back to "did not
 * use the local fallback" as its test.
 *
 * With a schema the model states which entry it used and whether it could
 * answer at all, so a citation is a fact the model asserted rather than
 * something scraped out of prose.
 */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING" },
    doc_id: { type: "STRING", nullable: true },
    answered: { type: "BOOLEAN" },
  },
  required: ["answer", "answered"],
};

export async function askAssistant(question: string): Promise<AssistantResult> {
  const emergency = checkEmergencyTripwire(question);
  if (emergency) {
    return {
      mode: "assistant",
      isEmergency: true,
      matchedPhrase: emergency.matchedPhrase,
      answer:
        "EMERGENCY DETECTED: If you or someone else is in immediate danger, please call " +
        "Legazpi emergency hotlines immediately or submit a direct emergency report.",
      matchedDocId: "emergency_tripwire",
      source: null,
      isFallback: false,
      topicCluster: "emergency",
    };
  }

  try {
    const raw = await generate({
      systemInstruction: SYSTEM_PROMPT,
      userText: question,
      config: {
        temperature: 0.2,
        maxOutputTokens: 800,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const parsed = JSON.parse(raw) as {
      answer?: string;
      doc_id?: string | null;
      answered?: boolean;
    };

    // A doc id the model invented is treated as no citation at all. The
    // knowledge base is the authority on what exists in it, not the model.
    const entry = parsed.doc_id ? KB.find((e) => e.id === parsed.doc_id) : undefined;
    const matchedDocId = entry?.id ?? null;

    // Grounded means: the model said it answered AND named an entry that really
    // exists. Either half missing makes this an unanswered question, which is
    // what the gap log is for. Claiming a citation SARO cannot verify would be
    // worse than admitting there is none.
    const grounded = parsed.answered === true && matchedDocId !== null;

    return {
      mode: "assistant",
      isEmergency: false,
      answer: (parsed.answer ?? "").trim(),
      matchedDocId,
      source: entry?.source ?? null,
      isFallback: !grounded,
      topicCluster: entry?.category ?? null,
    };
  } catch (err) {
    console.error("Gemini assistant call failed, using local knowledge base:", (err as GeminiError).message);
    return localFallback(question);
  }
}
