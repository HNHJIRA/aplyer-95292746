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
const OPENAI_URL = "https://api.openai.com/v1/responses";

/**
 * Client-owned prompt template, one exported source of truth (Demo Build
 * Specification, September 23, 2026, Part D). Placeholders: [question],
 * [job description], [resume], [writing sample, when provided].
 */
export const DEMO_CHATGPT_PROMPT_TEMPLATE =
  "Here is a job I am applying to and my resume.\n" +
  "Write my answer to this question:\n" +
  "[question]\n" +
  "[job description]\n" +
  "[resume]\n" +
  "[writing sample, when provided]";

/**
 * Exact assembled ChatGPT prompt. One source of truth: this string is both
 * what is sent to OpenAI and what the visitor is shown in the reveal.
 * The question starts on its own line; the writing-sample line is omitted
 * entirely when the field is blank.
 */
export function buildChatgptPrompt(input: Pick<DemoInput, "question" | "jobDescription" | "resume" | "writingSample">): string {
  const hasSample = typeof input.writingSample === "string" && !!input.writingSample.trim();
  // Function replacers: candidate text must be inserted literally, never
  // interpreted (e.g. "$&" in a resume is not a back-reference).
  return DEMO_CHATGPT_PROMPT_TEMPLATE
    .replace("[question]", () => input.question)
    .replace("[job description]", () => input.jobDescription)
    .replace("[resume]", () => input.resume)
    .replace("\n[writing sample, when provided]", () => (hasSample ? "\n" + (input.writingSample as string) : ""));
}

export interface ChatgptResult {
  text: string;
  prompt: string;
  calls: DemoAiCall[];
  /** Display model (unchanged behavior): OpenAI's reported id, else the configured id sent. */
  model: string;
  /** Exact configured model id sent to OpenAI. Stored evidence. */
  requestedModel?: string | null;
  /** Model id present in OpenAI's successful response only; null when omitted. Never falls back. */
  returnedModel?: string | null;
  /** Usage of the SUCCESSFUL response only (never aggregated across retries). */
  inputTokens?: number | null;
  outputTokens?: number | null;
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

/** Client spec "The call": 25-second timeout per attempt. */
export const DEMO_OPENAI_TIMEOUT_MS = 25_000;
/** Client spec: max_output_tokens 500 (API ceiling, not a prompt instruction). */
export const DEMO_OPENAI_MAX_OUTPUT_TOKENS = 500;
/** Longest retry-after we will honour before the single retry. */
const MAX_RETRY_AFTER_MS = 10_000;

type Attempt =
  | { kind: "ok"; body: unknown; requestId: string | null }
  | { kind: "http"; status: number; code: string; retryAfterMs: number | null; requestId: string | null }
  | { kind: "timeout" }
  | { kind: "network" };

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, MAX_RETRY_AFTER_MS);
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.min(Math.max(0, d - Date.now()), MAX_RETRY_AFTER_MS) : null;
}

async function attemptOnce(apiKey: string, body: string, sleepTimeoutMs: number): Promise<Attempt> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), sleepTimeoutMs);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body,
      signal: ctrl.signal,
    });
    const requestId = res.headers.get("x-request-id");
    if (!res.ok) {
      let code = "";
      try {
        const j = (await res.json()) as { error?: { code?: unknown; type?: unknown } };
        code = String(j?.error?.code ?? j?.error?.type ?? "");
      } catch { /* ignore body */ }
      return { kind: "http", status: res.status, code, retryAfterMs: parseRetryAfter(res.headers.get("retry-after")), requestId };
    }
    return { kind: "ok", body: await res.json(), requestId };
  } catch {
    return ctrl.signal.aborted ? { kind: "timeout" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** Extract answer text from a Responses API body (output[].content[].output_text). */
export function extractResponsesText(body: unknown): string {
  const b = body as { output_text?: unknown; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: unknown }> }> };
  if (typeof b?.output_text === "string") return b.output_text;
  let out = "";
  for (const item of b?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const c of item.content ?? []) if (c?.type === "output_text" && typeof c.text === "string") out += c.text;
  }
  return out;
}

/** The model identifier OpenAI reports in its response body, or "" when absent. */
function readReturnedModel(body: unknown): string {
  const m = (body as { model?: unknown } | null)?.model;
  return typeof m === "string" && m.trim() ? m.trim().slice(0, 100) : "";
}

function logAttempt(attempt: number, a: Attempt) {
  // Attempt number, status, request id and the model OpenAI actually returned.
  // Never the key, Authorization header, prompt, candidate text or answer.
  const requestId = a.kind === "ok" || a.kind === "http" ? a.requestId : null;
  const status = a.kind === "ok" ? 200 : a.kind === "http" ? a.status : a.kind;
  const returnedModel = a.kind === "ok" ? readReturnedModel(a.body) : "";
  console.info(
    `[demo-openai] attempt=${attempt} status=${status} request_id=${requestId ?? "none"} returned_model=${returnedModel || "unavailable"}`,
  );
}

const QUOTA_CODES = new Set(["insufficient_quota", "billing_hard_limit_reached"]);

export const generateChatgptDemoAnswer: ChatgptGenerator = async (input, hooks = {}) => {
  const cfg = chatgptConfig();
  if (!cfg) throw new DemoGenerationError("not_configured");
  const prompt = buildChatgptPrompt(input);
  hooks.onPrompt?.(prompt);

  // Exactly the client's call: model, input, max_output_tokens. No temperature/top_p, no instructions.
  const body = JSON.stringify({ model: cfg.model, input: prompt, max_output_tokens: DEMO_OPENAI_MAX_OUTPUT_TOKENS });
  const calls: DemoAiCall[] = [];
  const record = (usage: DemoAiCall["usage"]) =>
    calls.push({ provider: "openai", model: cfg.model, operation: "chatgpt_answer", usage });

  let a: Attempt = { kind: "network" };
  for (let attempt = 1; attempt <= 2; attempt++) {
    a = await attemptOnce(cfg.apiKey, body, DEMO_OPENAI_TIMEOUT_MS);
    logAttempt(attempt, a);
    if (a.kind === "ok") break;
    // A timed-out attempt may still be billed by OpenAI: record it with unknown usage.
    if (a.kind === "timeout") record({});
    const retryable =
      a.kind === "network" ||
      (a.kind === "http" && (a.status >= 500 || (a.status === 429 && !QUOTA_CODES.has(a.code))));
    if (!retryable || attempt === 2) break;
    const wait = a.kind === "http" ? a.retryAfterMs ?? 0 : 0;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  if (a.kind === "timeout") throw new DemoGenerationError("provider_error", true, calls);
  if (a.kind === "network") throw new DemoGenerationError("provider_error", true, calls);
  if (a.kind === "http") {
    const busy = a.status >= 500 || (a.status === 429 && !QUOTA_CODES.has(a.code));
    throw new DemoGenerationError(a.status === 404 ? "model_unavailable" : "provider_error", busy, calls);
  }

  const res = a.body as { model?: unknown; usage?: { input_tokens?: number; output_tokens?: number } | null };
  record({ inputTokens: res?.usage?.input_tokens, outputTokens: res?.usage?.output_tokens });
  const servedModel = typeof res?.model === "string" && res.model.trim() ? res.model.trim().slice(0, 100) : "";
  const text = extractResponsesText(a.body);
  if (!text.trim()) throw new DemoGenerationError("empty_output", false, calls);
  hooks.onDelta?.(text);
  const tok = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  return {
    text,
    prompt,
    calls,
    model: servedModel || cfg.model,
    requestedModel: cfg.model,
    returnedModel: servedModel || null,
    inputTokens: tok(res?.usage?.input_tokens),
    outputTokens: tok(res?.usage?.output_tokens),
  };
};
