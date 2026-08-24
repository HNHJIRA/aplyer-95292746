// Server-only runner for the Aplyer prompt library.
import { MODEL_FALLBACKS } from "./prompts/models";
import type { PromptSpec } from "./prompts/types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export interface RunPromptOptions {
  /** Hard timeout in ms. Generous by default — reasoning prompts are slow. */
  timeoutMs?: number;
  maxTokens?: number;
}

function isModelUnavailable(status: number, body: string): boolean {
  return status === 404 || /model_not_found|not_found_error|unknown model/i.test(body);
}

async function callAnthropic(
  model: string,
  spec: PromptSpec,
  user: string,
  opts: RunPromptOptions,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? spec.maxTokens,
        temperature: spec.temperature,
        system: spec.json
          ? `${spec.system}\n\nRespond with ONLY a valid JSON object. No prose, no markdown fences.`
          : spec.system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Anthropic ${res.status} (${model}): ${text.slice(0, 300)}`) as Error & {
        status: number;
        unavailableModel: boolean;
      };
      err.status = res.status;
      err.unavailableModel = isModelUnavailable(res.status, text);
      throw err;
    }
    const data = JSON.parse(text) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}

/** Runs a prompt spec, transparently falling back when the model id is unavailable. */
export async function runPromptText(spec: PromptSpec, user: string, opts: RunPromptOptions = {}): Promise<string> {
  const chain = [spec.model, ...(MODEL_FALLBACKS[spec.model] ?? [])];
  let lastError: unknown;
  for (const model of chain) {
    try {
      const out = await callAnthropic(model, spec, user, opts);
      if (!out) throw new Error("Empty model response");
      return out;
    } catch (e) {
      lastError = e;
      const unavailable = (e as { unavailableModel?: boolean }).unavailableModel;
      if (!unavailable) throw e;
      console.warn(`[prompt:${spec.id}] model ${model} unavailable, trying fallback`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Prompt execution failed");
}

export async function runPromptJson<T>(spec: PromptSpec, user: string, opts: RunPromptOptions = {}): Promise<T> {
  const text = await runPromptText(spec, user, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error(`[prompt:${spec.id}] non-JSON response`);
  }
}
