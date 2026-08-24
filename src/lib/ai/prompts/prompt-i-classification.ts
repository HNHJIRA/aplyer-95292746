import { MODEL_OPUS } from "./models";
import type { PromptSpec } from "./types";

export const QUESTION_FRAMEWORKS = [
  "STAR",
  "STAR-F",
  "MOTIVATION",
  "CAR",
  "CULTURAL",
  "GENERAL",
] as const;

export type QuestionFramework = (typeof QUESTION_FRAMEWORKS)[number];

export interface QuestionClassification {
  framework: QuestionFramework;
  confidence: number;
  reason: string;
}

export const PROMPT_I_CLASSIFICATION: PromptSpec = {
  id: "I_QUESTION_CLASSIFICATION",
  version: "1.0.0",
  model: MODEL_OPUS,
  maxTokens: 300,
  temperature: 0,
  json: true,
  system: `You are a question-classification engine for job application forms.

Classify the candidate-facing question into EXACTLY ONE framework:

- STAR — asks for a specific past experience with a situation, the actions taken, and a result. ("Tell me about a time you…")
- STAR-F — a STAR question that explicitly asks about a failure, mistake, conflict, setback, or something that went wrong.
- CAR — asks how the candidate solved a concrete problem or challenge, focused on the challenge → action → result arc, without necessarily requesting a full narrative.
- MOTIVATION — asks why the candidate wants this role, this company, this team, or this career move; also salary/relocation "why" framing about intent.
- CULTURAL — asks about values, working style, collaboration preferences, team fit, diversity perspectives, or how the candidate operates day to day.
- GENERAL — anything else: logistics, availability, short factual free-text, portfolio links, "anything else we should know", or questions that fit no other framework.

Rules:
- Choose the single best fit. Never return two frameworks.
- Failure/conflict/mistake wording always outranks plain STAR → return STAR-F.
- "Why us / why this role / why now" always outranks CULTURAL → return MOTIVATION.
- Short logistical or factual prompts are GENERAL even if they mention experience.
- confidence is 0-1 with two decimals, reflecting genuine certainty.
- reason is one short sentence quoting the deciding words in the question.

Return ONLY this JSON object:
{ "framework": "STAR" | "STAR-F" | "CAR" | "MOTIVATION" | "CULTURAL" | "GENERAL", "confidence": number, "reason": string }`,
};

export function buildClassificationUser(question: string, context?: { platform?: string; fieldType?: string }): string {
  const meta = [
    context?.platform ? `ATS platform: ${context.platform}` : null,
    context?.fieldType ? `Field type: ${context.fieldType}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${meta ? `${meta}\n\n` : ""}Question:\n${question}`;
}

export function validateClassification(value: unknown): QuestionClassification {
  const v = value as Partial<QuestionClassification>;
  const framework = String(v?.framework ?? "").toUpperCase() as QuestionFramework;
  if (!QUESTION_FRAMEWORKS.includes(framework)) throw new Error(`Unknown framework: ${v?.framework}`);
  const confidence = typeof v?.confidence === "number" && v.confidence >= 0 && v.confidence <= 1 ? v.confidence : 0.5;
  return {
    framework,
    confidence: Math.round(confidence * 100) / 100,
    reason: typeof v?.reason === "string" && v.reason.trim() ? v.reason.trim() : "Classified from question wording.",
  };
}

/**
 * Deterministic fallback used when the model is unreachable. Keeps the
 * extension usable (a framework is always available) without inventing
 * confidence it does not have.
 */
export function heuristicClassification(question: string): QuestionClassification {
  const q = question.toLowerCase();
  const has = (...words: string[]) => words.some((w) => q.includes(w));

  if (has("failure", "failed", "mistake", "went wrong", "conflict", "disagree", "setback", "criticism"))
    return { framework: "STAR-F", confidence: 0.6, reason: "Mentions a failure, mistake, or conflict.", };
  if (has("why do you want", "why are you interested", "why this role", "why us", "why our", "why join", "motivat"))
    return { framework: "MOTIVATION", confidence: 0.6, reason: "Asks why the candidate wants the role or company." };
  if (has("tell me about a time", "describe a time", "give an example of a time", "share an experience"))
    return { framework: "STAR", confidence: 0.6, reason: "Requests a specific past experience." };
  if (has("problem", "challenge", "obstacle", "how did you solve", "how would you solve"))
    return { framework: "CAR", confidence: 0.55, reason: "Focuses on solving a concrete problem." };
  if (has("values", "culture", "team environment", "work style", "working style", "collaborat", "diversity", "inclusion"))
    return { framework: "CULTURAL", confidence: 0.55, reason: "Asks about values, culture, or working style." };
  return { framework: "GENERAL", confidence: 0.4, reason: "No framework-specific signals detected." };
}
