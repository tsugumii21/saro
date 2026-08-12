import { generate } from "./gemini.ts";

export interface ReportInsightPayload {
  tracking_code: string;
  category: string;
  description: string;
  barangay?: string;
  status: string;
  created_at: string;
}

export interface StructuredInsightResult {
  insight: string;
  root_cause: string;
  suggested_action: string;
}

export async function synthesizeHazardInsight(payload: ReportInsightPayload): Promise<{ narrative: StructuredInsightResult | string }> {
  const systemInstruction = `You are SARO EOC Operational Intelligence for Legazpi City DRRMO.
Analyze the hazard report and generate a JSON object with EXACTLY 3 mandatory fields:
1. "insight": The AI's analytical read on what is occurring. Written as operational analysis, NOT a neutral restatement of the resident's comment.
2. "root_cause": The AI's best inference of underlying cause(s). If the report/comment genuinely does not contain enough detail to infer a cause, explicitly output: "Insufficient detail in report to determine a probable root cause."
3. "suggested_action": Practical, agency-actionable suggestions for mitigating or addressing the root cause, aimed at what CDRRMO specifically could do.

Every section must be present in every response without exception.`;

  const userText = `Report Details:
- Tracking Code: ${payload.tracking_code}
- Category: ${payload.category}
- Location: ${payload.barangay ? `Brgy. ${payload.barangay}, Legazpi City` : 'Legazpi City'}
- Status: ${payload.status}
- Date/Time: ${payload.created_at}
- Citizen Description: "${payload.description}"`;

  const text = await generate({
    systemInstruction,
    userText,
    config: {
      temperature: 0.2,
      maxOutputTokens: 384,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          insight: { type: "STRING" },
          root_cause: { type: "STRING" },
          suggested_action: { type: "STRING" }
        },
        required: ["insight", "root_cause", "suggested_action"]
      }
    }
  });

  try {
    const parsed = JSON.parse(text) as StructuredInsightResult;
    if (parsed.insight && parsed.root_cause && parsed.suggested_action) {
      return { narrative: parsed };
    }
  } catch {
    // Non-JSON fallback
  }

  return { narrative: text };
}
