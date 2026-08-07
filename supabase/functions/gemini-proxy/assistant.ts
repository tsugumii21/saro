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
2. If you find a matching entry in the Knowledge Base, answer clearly. DO NOT include any doc ID tag or brackets in your response text.
3. If the question CANNOT be answered from the Knowledge Base, DO NOT guess or invent facts. State clearly that the information is not in the knowledge base and recommend the most relevant Legazpi City office to contact (e.g. CDRRMO, Legazpi 911, City Engineering Office, BFP, PNP, CHO, PSO, Coast Guard).
4. Respond in the same language as the user (English, Tagalog, or Bikol).

KNOWLEDGE BASE:
${JSON.stringify(KB, null, 2)}`;

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
      config: { temperature: 0.2, maxOutputTokens: 800 },
    });

    // The model is told not to emit doc tags, but strip them if it does.
    const docMatch = raw.match(/\[(doc_[a-z0-9_]+)\]/i);
    const answer = raw.replace(/\s*\[doc_[a-z0-9_]+\]/gi, "").trim();
    const matchedDocId = docMatch ? docMatch[1] : null;

    return {
      mode: "assistant",
      isEmergency: false,
      answer,
      matchedDocId,
      source: matchedDocId ? (KB.find((e) => e.id === matchedDocId)?.source ?? null) : null,
      isFallback: false,
      topicCluster: matchedDocId ? (KB.find((e) => e.id === matchedDocId)?.category ?? null) : null,
    };
  } catch (err) {
    console.error("Gemini assistant call failed, using local knowledge base:", (err as GeminiError).message);
    return localFallback(question);
  }
}
