// Describe-flow structuring.
//
// NOTE: unlike the assistant, there was no existing implementation of this to
// port — the prototype's Describe flow never called Gemini. This is the
// smallest thing that satisfies the architecture (one function serving both
// use cases) without inventing product behaviour: free text in, a category
// from the live routing table plus a one-line summary out. The resident still
// confirms the category; nothing is auto-filed.

import { generate } from "./gemini.ts";

export interface DescribeResult {
  mode: "describe";
  category: string | null;
  categoryLabel: string | null;
  summary: string;
  isEmergency: boolean;
  confidence: "high" | "low";
  isFallback: boolean;
}

interface CategoryRow {
  category: string;
  label: string;
  is_emergency: boolean;
}

const SYSTEM_PROMPT = (categories: CategoryRow[]) =>
  `You classify civic hazard reports for Legazpi City, Philippines.

The resident describes what they are seeing, in English, Tagalog or Bikol. Your
job is to pick the single best category and write one plain sentence summarising
the hazard for a dispatcher.

RULES:
1. Choose "category" from the allowed list ONLY. Never invent a category.
2. If nothing fits, set category to null. A wrong route wastes an office's time.
3. "summary" is one sentence, under 140 characters, plain and factual. No
   marketing tone, no exclamation marks, no reassurance, no advice.
4. Write the summary in English regardless of the input language — dispatchers
   read English.
5. Do not add detail the resident did not give. Do not guess an address.

ALLOWED CATEGORIES:
${categories.map((c) => `- ${c.category}: ${c.label}`).join("\n")}`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", nullable: true },
    summary: { type: "STRING" },
  },
  required: ["summary"],
};

export async function structureDescription(
  description: string,
  categories: CategoryRow[],
): Promise<DescribeResult> {
  const fallback: DescribeResult = {
    mode: "describe",
    category: null,
    categoryLabel: null,
    // Trim rather than invent: the resident's own words are always safe.
    summary: description.trim().slice(0, 140),
    isEmergency: false,
    confidence: "low",
    isFallback: true,
  };

  if (!categories.length) return fallback;

  try {
    const raw = await generate({
      systemInstruction: SYSTEM_PROMPT(categories),
      userText: description,
      config: {
        temperature: 0.1,
        maxOutputTokens: 300,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const parsed = JSON.parse(raw) as { category?: string | null; summary?: string };
    const match = parsed.category
      ? categories.find((c) => c.category === parsed.category)
      : undefined;

    // A category the model made up is treated as no category at all.
    return {
      mode: "describe",
      category: match?.category ?? null,
      categoryLabel: match?.label ?? null,
      summary: (parsed.summary ?? "").trim().slice(0, 140) || fallback.summary,
      isEmergency: match?.is_emergency ?? false,
      confidence: match ? "high" : "low",
      isFallback: false,
    };
  } catch (err) {
    console.error("Gemini describe call failed, returning raw description:", (err as Error).message);
    return fallback;
  }
}
