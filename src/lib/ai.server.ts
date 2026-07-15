// Server-only helper to call Anthropic Claude for structured JSON output.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5";

export interface AiJsonOptions {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}

export async function aiJson<T>(opts: AiJsonOptions): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 2000,
      system: `${opts.system}\n\nRespond with ONLY a valid JSON object. No prose, no markdown fences.`,
      messages: [{ role: "user", content: opts.user }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const content = data.content?.find((c) => c.type === "text")?.text;
  if (!content) throw new Error("Anthropic returned empty content");

  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("Anthropic returned non-JSON content");
  }
}
