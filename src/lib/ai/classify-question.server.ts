// Server-only question classification (Prompt I) with a durable cache.
//
// COMPLIANCE: production classification is ALWAYS Prompt I on its pinned
// model. Invalid model output gets exactly one strict correction retry; a
// second failure raises a controlled ClassificationError. There is no
// heuristic production fallback and no fallback model.
import {
  CLASSIFICATION_RETRY_INSTRUCTION,
  PROMPT_I_CLASSIFICATION,
  buildClassificationUser,
  validateClassification,
  type QuestionClassification,
} from "./prompts/prompt-i-classification";
import { PromptError, runPromptValidated } from "./run-prompt.server";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const memoryCache = new Map<string, { value: QuestionClassification; at: number }>();

export class ClassificationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ClassificationError";
    this.code = code;
  }
}

export function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ?]/g, "").trim();
}

/** Cache identity includes the prompt version AND the model, per SOP. */
export function cacheIdentity(question: string): string {
  return `${PROMPT_I_CLASSIFICATION.version}|${PROMPT_I_CLASSIFICATION.model}|${normalizeQuestion(question)}`;
}

async function hash(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ClassifyResult extends QuestionClassification {
  cached: boolean;
  source: "cache" | "model";
  promptVersion: string;
  model: string;
}

export async function classifyQuestion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  question: string,
  context: { platform?: string; fieldType?: string } = {},
): Promise<ClassifyResult> {
  const key = await hash(cacheIdentity(question));
  const stamp = {
    promptVersion: PROMPT_I_CLASSIFICATION.version,
    model: PROMPT_I_CLASSIFICATION.model,
  };

  const mem = memoryCache.get(key);
  if (mem && Date.now() - mem.at < CACHE_TTL_MS) {
    return { ...mem.value, cached: true, source: "cache", ...stamp };
  }

  try {
    const { data } = await supabase
      .from("question_classifications")
      .select("framework, reason, model, prompt_version, created_at")
      .eq("question_hash", key)
      .maybeSingle();
    if (
      data &&
      data.model === PROMPT_I_CLASSIFICATION.model &&
      data.prompt_version === PROMPT_I_CLASSIFICATION.version &&
      Date.now() - new Date(data.created_at).getTime() < CACHE_TTL_MS
    ) {
      const value = validateClassification(data);
      memoryCache.set(key, { value, at: Date.now() });
      return { ...value, cached: true, source: "cache", ...stamp };
    }
  } catch (e) {
    console.warn("[classify-question] cache read failed", e);
  }

  let value: QuestionClassification;
  try {
    const run = await runPromptValidated(
      PROMPT_I_CLASSIFICATION,
      buildClassificationUser(question, context),
      validateClassification,
      CLASSIFICATION_RETRY_INSTRUCTION,
      { timeoutMs: 25_000 },
    );
    value = run.value;
  } catch (e) {
    const code = e instanceof PromptError ? e.code : "classification_failed";
    console.error(
      JSON.stringify({ evt: "classification_failed", code, model: PROMPT_I_CLASSIFICATION.model }),
    );
    throw new ClassificationError(
      code,
      code === "model_unavailable" || code === "not_configured"
        ? "Question classification is temporarily unavailable."
        : "We could not classify this question. Please try again.",
    );
  }

  memoryCache.set(key, { value, at: Date.now() });

  try {
    await supabase.from("question_classifications").upsert(
      {
        question_hash: key,
        question_text: question.slice(0, 2000),
        framework: value.framework,
        reason: value.reason,
        model: PROMPT_I_CLASSIFICATION.model,
        prompt_version: PROMPT_I_CLASSIFICATION.version,
        created_at: new Date().toISOString(),
      },
      { onConflict: "question_hash" },
    );
  } catch (e) {
    console.warn("[classify-question] cache write failed", e);
  }

  return { ...value, cached: false, source: "model", ...stamp };
}

/** Test-only: clears the in-process cache. */
export function __resetClassificationMemoryCache() {
  memoryCache.clear();
}
