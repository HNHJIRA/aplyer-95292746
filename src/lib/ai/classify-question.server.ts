// Server-only question classification (Prompt I) with a durable cache.
import {
  PROMPT_I_CLASSIFICATION,
  buildClassificationUser,
  heuristicClassification,
  validateClassification,
  type QuestionClassification,
} from "./prompts/prompt-i-classification";
import { runPromptJson } from "./run-prompt.server";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const memoryCache = new Map<string, { value: QuestionClassification; at: number }>();

function normalize(question: string): string {
  return question.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ?]/g, "").trim();
}

async function hash(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ClassifyResult extends QuestionClassification {
  cached: boolean;
  source: "cache" | "model" | "heuristic";
  promptVersion: string;
}

export async function classifyQuestion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  question: string,
  context: { platform?: string; fieldType?: string } = {},
): Promise<ClassifyResult> {
  const key = await hash(`${PROMPT_I_CLASSIFICATION.version}|${normalize(question)}`);

  const mem = memoryCache.get(key);
  if (mem && Date.now() - mem.at < CACHE_TTL_MS) {
    return { ...mem.value, cached: true, source: "cache", promptVersion: PROMPT_I_CLASSIFICATION.version };
  }

  try {
    const { data } = await supabase
      .from("question_classifications")
      .select("framework, confidence, reason, created_at")
      .eq("question_hash", key)
      .maybeSingle();
    if (data && Date.now() - new Date(data.created_at).getTime() < CACHE_TTL_MS) {
      const value = validateClassification(data);
      memoryCache.set(key, { value, at: Date.now() });
      return { ...value, cached: true, source: "cache", promptVersion: PROMPT_I_CLASSIFICATION.version };
    }
  } catch (e) {
    console.warn("[classify-question] cache read failed", e);
  }

  let value: QuestionClassification;
  let source: ClassifyResult["source"] = "model";
  try {
    value = validateClassification(
      await runPromptJson(PROMPT_I_CLASSIFICATION, buildClassificationUser(question, context), { timeoutMs: 20_000 }),
    );
  } catch (e) {
    console.warn("[classify-question] model unavailable, using heuristic", e);
    value = heuristicClassification(question);
    source = "heuristic";
  }

  memoryCache.set(key, { value, at: Date.now() });

  if (source === "model") {
    try {
      await supabase.from("question_classifications").upsert(
        {
          question_hash: key,
          question_text: question.slice(0, 2000),
          framework: value.framework,
          confidence: value.confidence,
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
  }

  return { ...value, cached: false, source, promptVersion: PROMPT_I_CLASSIFICATION.version };
}
