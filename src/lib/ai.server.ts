// Server-only helper to call Lovable AI Gateway for structured JSON output.
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface AiJsonOptions {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}

export async function aiJson<T>(opts: AiJsonOptions): Promise<T> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model ?? "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_object" },
      max_tokens: opts.maxTokens ?? 2000,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI gateway returned empty content");

  try {
    return JSON.parse(content) as T;
  } catch {
    // Try to extract JSON block if the model wrapped it.
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("AI gateway returned non-JSON content");
  }
}
