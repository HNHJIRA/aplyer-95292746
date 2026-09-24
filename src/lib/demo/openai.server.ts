/**
 * ChatGPT side of the Demo — SERVER ONLY.
 *
 * The prompt is the client-owned text from the Demo Build Specification
 * of September 23, 2026, Part D, used verbatim. The only substitutions are the visitor's own
 * question, job description, resume and (when provided) writing sample.
 * No system message, no hidden instructions, no Aplyer rules.
 *
 * Model and credential are configuration (DEMO_OPENAI_MODEL, OPENAI_API_KEY).
 * Nothing is hardcoded: when either is missing the side fails closed with
 * `not_configured` and no provider call is made.
 */
import type { DemoAiCall, DemoInput } from "./generate.server";
import { DemoGenerationError } from "./generate.server";

export const DEMO_CHATGPT_SIDE = "openai" as const;
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Exact assembled ChatGPT prompt. One source of truth: this string is both
 * what is sent to OpenAI and what the visitor is shown in the reveal.
 * Lines are joined by a single newline, one spec line per line.
 */
export function buildChatgptPrompt(input: Pick<DemoInput, "question" | "jobDescription" | "resume" | "writingSample">): string {
  const lines = [
    "Here is a job I am applying to and my resume.",
    `Write my answer to this question: ${input.question}`,
    input.jobDescription,
    input.resume,
  ];
  if (typeof input.writingSample === "string" && input.writingSample.trim()) lines.push(input.writingSample);
  return lines.join("\n");
}

export interface ChatgptResult {
  text: string;
  prompt: string;
  calls: DemoAiCall[];
  /** Model that served this answer: OpenAI's reported id, else the configured id sent. */
  model: string;
}

export interface ChatgptHooks {
  onDelta?: (text: string) => void;
  /** Called with the exact prompt right before the provider request. */
  onPrompt?: (prompt: string) => void;
}

export type ChatgptGenerator = (input: DemoInput, hooks?: ChatgptHooks) => Promise<ChatgptResult>;

export function chatgptConfig(): { model: string; apiKey: string } | null {
  const model = (process.env.DEMO_OPENAI_MODEL ?? "").trim();
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  return model && apiKey ? { model, apiKey } : null;
}

export const generateChatgptDemoAnswer: ChatgptGenerator = async (input, hooks = {}) => {
  const cfg = chatgptConfig();
  if (!cfg) throw new DemoGenerationError("not_configured");
  const prompt = buildChatgptPrompt(input);
  hooks.onPrompt?.(prompt);

  const calls: DemoAiCall[] = [];
  let usage: { inputTokens?: number; outputTokens?: number } = {};
  const record = () =>
    calls.length
      ? undefined
      : calls.push({ provider: "openai", model: cfg.model, operation: "chatgpt_answer", usage });

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
  } catch {
    throw new DemoGenerationError("provider_error", true);
  }
  if (!res.ok || !res.body) {
    // Not billed when the provider rejects the request outright.
    const busy = res.status === 429 || res.status >= 500;
    throw new DemoGenerationError(res.status === 404 ? "model_unavailable" : "provider_error", busy);
  }

  let text = "";
  let servedModel = "";
  let sawError = false;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let j: {
          error?: unknown;
          model?: unknown;
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        };
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) sawError = true;
        if (!servedModel && typeof j.model === "string" && j.model.trim()) servedModel = j.model.trim().slice(0, 100);
        const piece = j.choices?.[0]?.delta?.content;
        if (typeof piece === "string" && piece) {
          text += piece;
          hooks.onDelta?.(piece);
        }
        if (j.usage) usage = { inputTokens: j.usage.prompt_tokens, outputTokens: j.usage.completion_tokens };
      }
    }
  } catch {
    record();
    throw new DemoGenerationError("provider_error", true, calls);
  }
  record();
  if (sawError) throw new DemoGenerationError("provider_error", true, calls);
  if (!text.trim()) throw new DemoGenerationError("empty_output", false, calls);
  return { text, prompt, calls, model: servedModel || cfg.model };
};
