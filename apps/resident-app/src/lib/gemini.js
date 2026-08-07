// Client-side Gemini API Integration for SARO Assistant
// Handles FAQ RAG with system prompt, emergency trip-wire detection, and local fallback

import knowledgeBase from "./knowledge-base.json";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

// Trip-wire emergency keywords (Triggers immediate Hotline CTA overlay)
const EMERGENCY_KEYWORDS = [
  "sunog", "apoy", "baha", "dugo", "patay", "nahulog", "disgrasya", "aksidente",
  "krimen", "baril", "kutsilyo", "salud", "ospital", "ambulansya", "emergency",
  "suicide", "fire", "flood", "accident", "bleeding", "unconscious", "stroke", "heart attack"
];

// Stop words for score matching
const STOP_WORDS = new Set([
  "ang", "sa", "na", "ng", "mga", "ko", "mo", "si", "ni", "kay", "pa", "na", "din", "rin",
  "dito", "doon", "ano", "paano", "saan", "kailan", "bakit", "sino", "the", "a", "an", "in",
  "on", "at", "to", "for", "of", "with", "is", "are", "was", "were", "be", "what", "how", "where"
]);

// Informational / FAQ question indicators that negate emergency tripwire
const FAQ_QUERY_INDICATORS = [
  "ano", "paano", "saan", "kailan", "bakit", "sino", "what", "how", "where", "when", "why", "who",
  "hotline", "number", "numero", "contact", "tel", "phone", "lista", "listahan", "gabay", "faq", "info", "tanggapan"
];

// 1. Check Emergency Trip-wire (Only triggers on active emergency reports, not FAQ questions)
export function checkEmergencyTripwire(question) {
  if (!question || typeof question !== "string") return null;
  const qLower = question.toLowerCase().trim();

  // If question contains informational/FAQ indicators (e.g. "Ano ang emergency hotline ng CDRRMO?"), skip emergency alert
  const isFaqQuestion = FAQ_QUERY_INDICATORS.some((word) => {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    return regex.test(qLower);
  });

  if (isFaqQuestion) {
    return null; // Return null so local RAG knowledge base answers the question normally
  }

  for (const kw of EMERGENCY_KEYWORDS) {
    // Word boundary match
    const regex = new RegExp(`\\b${kw}\\b`, "i");
    if (regex.test(qLower)) {
      return { isEmergency: true, matchedPhrase: kw };
    }
  }
  return null;
}

// 2. Deterministic Local Knowledge Base Fallback (No [doc_...] text in answer)
function localFallbackFaq(question) {
  if (!knowledgeBase || !Array.isArray(knowledgeBase)) {
    return {
      answer: "Pasensya na, hindi ma-access ang knowledge base sa ngayon.",
      matchedDocId: null,
      source: null,
      isFallback: true
    };
  }

  const qLower = question.toLowerCase().trim();
  const qWords = qLower
    .replace(/[^\w\s]/gi, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  let bestEntry = null;
  let bestScore = 0;

  for (const entry of knowledgeBase) {
    let score = 0;
    const eQ = entry.question.toLowerCase();
    const eA = entry.answer.toLowerCase();
    const eCat = entry.category.toLowerCase();

    if (qLower.includes(eQ) || eQ.includes(qLower)) {
      score += 10;
    }

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
      answer: bestEntry.answer,
      matchedDocId: bestEntry.id,
      source: bestEntry.source,
      isFallback: true
    };
  }

  // Out of scope fallback naming relevant office
  let officeRecommendation = "City Disaster Risk Reduction and Management Office (CDRRMO) o Legazpi 911";
  if (qLower.includes("kalsada") || qLower.includes("tulay") || qLower.includes("lubak") || qLower.includes("road")) {
    officeRecommendation = "City Engineering Office (CEO)";
  } else if (qLower.includes("sunog") || qLower.includes("fire") || qLower.includes("gas")) {
    officeRecommendation = "Bureau of Fire Protection (BFP Legazpi)";
  } else if (qLower.includes("gulo") || qLower.includes("krimen") || qLower.includes("pulis")) {
    officeRecommendation = "Philippine National Police (PNP Legazpi)";
  } else if (qLower.includes("tubig") || qLower.includes("health") || qLower.includes("sakit")) {
    officeRecommendation = "City Health Office (CHO)";
  }

  return {
    answer: `Pasensya na, wala sa aming opisyal na gabay ang kasagutan sa iyong tanong. Maaari kang makipag-ugnayan sa kaukulang tanggapan ng Lungsod ng Legazpi: ${officeRecommendation}.`,
    matchedDocId: null,
    source: null,
    isFallback: true
  };
}

// 3. Ask FAQ (Gemini API with Local Fallback)
export async function askFaq(question) {
  // Check trip-wire first
  const emergency = checkEmergencyTripwire(question);
  if (emergency) {
    return {
      isEmergency: true,
      matchedPhrase: emergency.matchedPhrase,
      answer: "EMERGENCY DETECTED: If you or someone else is in immediate danger, please call Legazpi emergency hotlines immediately or submit a direct emergency report.",
      matchedDocId: "emergency_tripwire",
      isFallback: false
    };
  }

  // Check key presence
  if (!API_KEY || !API_KEY.trim()) {
    console.warn("VITE_GEMINI_API_KEY is not set or empty. Using local fallback.");
    return localFallbackFaq(question);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });

    const systemPrompt = `You are SARO Assistant, the official calm, plain, unshowy civic guidance assistant for Legazpi City, Philippines.
You must answer the user's question ONLY using the official Knowledge Base entries provided below.

RULES:
1. Tone: Plain, calm, direct public service. NO marketing tone, NO exclamation marks, NO celebratory text.
2. If you find a matching entry in the Knowledge Base, answer clearly. DO NOT include any doc ID tag or brackets in your response text.
3. If the question CANNOT be answered from the Knowledge Base, DO NOT guess or invent facts. State clearly that the information is not in the knowledge base and recommend the most relevant Legazpi City office to contact (e.g. CDRRMO, Legazpi 911, City Engineering Office, BFP, PNP, CHO, PSO, Coast Guard).
4. Respond in the same language as the user (English, Tagalog, or Bikol).

KNOWLEDGE BASE:
${JSON.stringify(knowledgeBase, null, 2)}`;

    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [
        { role: "user", parts: [{ text: `${systemPrompt}\n\nUser Question: ${question}` }] }
      ]
    });

    const rawText = response.text?.trim() || "";

    // Extract doc ID bracket if Gemini returned one
    const docMatch = rawText.match(/\[(doc_[a-z0-9_]+)\]/i);
    const matchedDocId = docMatch ? docMatch[1] : null;

    // Clean answer: Strip any [doc_...] bracket tag from the visible answer text
    const cleanAnswer = rawText.replace(/\s*\[doc_[a-z0-9_]+\]/gi, "").trim();

    return {
      answer: cleanAnswer,
      matchedDocId: matchedDocId,
      isFallback: false,
      rawResponse: rawText
    };
  } catch (err) {
    console.error("Gemini API call failed, falling back to local KB:", err);
    return localFallbackFaq(question);
  }
}
