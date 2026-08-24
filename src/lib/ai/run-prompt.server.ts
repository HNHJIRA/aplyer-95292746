// Server-only runner for the Aplyer prompt library.
//
// COMPLIANCE RULES ENFORCED HERE:
// 1. A prompt runs on the exact model its spec pins. There is no fallback
//    model. If the model is unavailable, the runner throws a controlled
//    `model_unavailable` error and the feature stays unavailable.
// 2. Invalid model output gets exactly ONE strict correction retry, then a
//    controlled `invalid_output` error. No heuristic substitution.
import { isApprovedModel } from "./prompts/models";
import type { PromptSpec } from "./prompts/types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type PromptErrorCode =
  | "not_configured"
  | "model_unavailable"
  | "provider_error"
  | "timeout"
  | "invalid_output";

export class PromptError extends Error {
  readonly code: PromptErrorCode;
  readonly promptId: string;
  readonly model: string;
  readonly status?: number;

  constructor(args: {
    code: PromptErrorCode;
    promptId: string;
    model: string;
    message: string;
    status?: number;
  }) {
    super(args.message);
    this.name = "PromptError";
    this.code = args.code;
    this.promptId = args.promptId;
    this.model = args.model;
    this.status = args.status;
  }
}

export interface RunPromptOptions {
  /** Hard timeout in ms. Generous by default — reasoning prompts are slow. */
  timeoutMs?: number;
  maxTokens?: number;
}

function isModelUnavailable(status: number, body: string): boolean {
  return status === 404 || /model_not_found|not_found_error|unknown model/i.test(body);
}

/** Logs a model-access problem without leaking prompt content or keys. */
function logModelAccessIssue(spec: PromptSpec, status: number | undefined, code: PromptErrorCode) {
  console.error(
    JSON.stringify({
      evt: "prompt_model_access",
      prompt: spec.id,
      promptVersion: spec.version,
      model: spec.model,
      status: status ?? null,
      code,
    }),
  );
}

async function callAnthropic(spec: PromptSpec, user: string, opts: RunPromptOptions): Promise<string> {
  const model = spec.model;
  if (!isApprovedModel(model)) {
    throw new PromptError({
      code: "model_unavailable",
      promptId: spec.id,
      model,
      message: `Model ${model} is not on the approved list.`,
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new PromptError({
      code: "not_configured",
      promptId: spec.id,
      model,
      message: "AI provider is not configured.",
    });
  }

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
      const unavailable = isModelUnavailable(res.status, text);
      const code: PromptErrorCode = unavailable ? "model_unavailable" : "provider_error";
      logModelAccessIssue(spec, res.status, code);
      throw new PromptError({
        code,
        promptId: spec.id,
        model,
        status: res.status,
        message: unavailable
          ? `Required model ${model} is unavailable for this account.`
          : `Provider error ${res.status} for ${spec.id}.`,
      });
    }
    const data = JSON.parse(text) as { content?: Array<{ type: string; text?: string }> };
    const out = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
    if (!out) {
      throw new PromptError({
        code: "invalid_output",
        promptId: spec.id,
        model,
        message: "Model returned an empty response.",
      });
    }
    return out;
  } catch (e) {
    if (e instanceof PromptError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new PromptError({
        code: "timeout",
        promptId: spec.id,
        model,
        message: `${spec.id} timed out after ${timeoutMs}ms.`,
      });
    }
    throw new PromptError({
      code: "provider_error",
      promptId: spec.id,
      model,
      message: (e as Error)?.message ?? "Provider request failed.",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Runs a prompt spec on its pinned model. Never falls back to another model. */
export async function runPromptText(spec: PromptSpec, user: string, opts: RunPromptOptions = {}): Promise<string> {
  return callAnthropic(spec, user, opts);
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("non-JSON response");
  }
}

export async function runPromptJson<T>(spec: PromptSpec, user: string, opts: RunPromptOptions = {}): Promise<T> {
  const text = await runPromptText(spec, user, opts);
  try {
    return parseJsonLoose(text) as T;
  } catch {
    throw new PromptError({
      code: "invalid_output",
      promptId: spec.id,
      model: spec.model,
      message: `${spec.id} returned non-JSON output.`,
    });
  }
}

/**
 * Runs a prompt and validates its output. On an invalid result it retries
 * EXACTLY ONCE with a strict correction instruction; a second invalid result
 * raises a controlled `invalid_output` error. No heuristic fallback.
 */
export async function runPromptValidated<T>(
  spec: PromptSpec,
  user: string,
  validate: (value: unknown) => T,
  retryInstruction: string,
  opts: RunPromptOptions = {},
): Promise<{ value: T; attempts: number }> {
  let lastMessage = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const message = attempt === 1 ? user : `${user}\n\n---\n\n${retryInstruction}`;
    const text = await runPromptText(spec, message, opts);
    try {
      return { value: validate(parseJsonLoose(text)), attempts: attempt };
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : String(e);
      console.warn(
        JSON.stringify({
          evt: "prompt_invalid_output",
          prompt: spec.id,
          promptVersion: spec.version,
          model: spec.model,
          attempt,
          reason: lastMessage.slice(0, 200),
        }),
      );
    }
  }
  throw new PromptError({
    code: "invalid_output",
    promptId: spec.id,
    model: spec.model,
    message: `${spec.id} returned an invalid result twice (${lastMessage}).`,
  });
}
