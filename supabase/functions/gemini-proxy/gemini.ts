// Shared Gemini client for the SARO Edge Function.
//
// One place that knows the model, the key and the transport. The two use cases
// (grounded assistant, describe-flow structuring) differ only in the prompt and
// the generation config they pass in.
//
// The API key comes from a Supabase secret and never leaves this runtime:
//   supabase secrets set GEMINI_API_KEY=...

/** Latest stable Gemini model with a free tier. */
export const GEMINI_MODEL = "gemini-3.6-flash";

const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export interface GenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
}

export interface GeminiRequest {
  systemInstruction: string;
  userText: string;
  config?: GenerationConfig;
}

export class GeminiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GeminiError";
  }
}

function apiKey(): string {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    throw new GeminiError("GEMINI_API_KEY is not set as a Supabase secret", 500);
  }
  return key;
}

/**
 * Single call into Gemini. Returns the raw text of the first candidate.
 * Times out rather than holding a resident's request open indefinitely.
 */
export async function generate({
  systemInstruction,
  userText,
  config = {},
}: GeminiRequest): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(ENDPOINT(GEMINI_MODEL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey(),
      },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: {
          temperature: config.temperature ?? 0.2,
          maxOutputTokens: config.maxOutputTokens ?? 1024,
          ...(config.responseMimeType ? { responseMimeType: config.responseMimeType } : {}),
          ...(config.responseSchema ? { responseSchema: config.responseSchema } : {}),
        },
        safetySettings: [
          // Hazard reports describe fires, injuries and crimes. Default
          // thresholds refuse legitimate emergency text, so relax to the
          // block-few setting and rely on the prompt for scope control.
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new GeminiError(
        `Gemini returned ${response.status}: ${detail.slice(0, 300)}`,
        response.status,
      );
    }

    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("")
      .trim();

    if (!text) {
      const reason = payload?.candidates?.[0]?.finishReason ?? "no candidates";
      throw new GeminiError(`Gemini returned no usable text (${reason})`);
    }

    return text;
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new GeminiError("Gemini request timed out after 20s", 504);
    }
    throw new GeminiError((err as Error).message);
  } finally {
    clearTimeout(timeout);
  }
}
