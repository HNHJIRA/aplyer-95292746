import { MODEL_OPUS } from "./models";
import type { QuestionFramework } from "./prompt-i-classification";
import type { PromptSpec } from "./types";

export interface AnswerGenerationInput {
  question: string;
  framework: QuestionFramework;
  voiceCard: unknown;
  /** P0 fact inventory — the only facts the answer may contain. */
  factInventory: string[];
  jobContext?: string;
  maxWords?: number;
}

export interface GeneratedAnswer {
  answer: string;
  framework: QuestionFramework;
  factsUsed: string[];
  wordCount: number;
}

export const FRAMEWORK_STRUCTURE: Record<QuestionFramework, string> = {
  STAR: "Situation (1 sentence) → Task → Actions you took → Result with a concrete outcome.",
  "STAR-F": "Situation → what went wrong and your ownership of it → what you changed → what you now do differently. End on the learning, not the failure.",
  CAR: "Challenge → Action → Result. Lead with the problem, keep it tight, land the outcome.",
  MOTIVATION: "What specifically draws you (role/company/problem) → the evidence in your background that backs it → what you'd contribute. No flattery.",
  CULTURAL: "How you actually work → one concrete example of it → how that fits the team's way of working.",
  GENERAL: "Answer directly in the first sentence, then one or two sentences of supporting specifics. Nothing else.",
};

export const PROMPT_A_ANSWER_GENERATION: PromptSpec = {
  id: "A_ANSWER_GENERATION",
  version: "1.0.0",
  model: MODEL_OPUS,
  maxTokens: 1200,
  temperature: 0.4,
  json: true,
  system: `You write job application answers in the candidate's own voice.

HARD GATE — P0 fact inventory:
- You may use ONLY facts present in the supplied P0 fact inventory.
- If the inventory does not contain the facts needed to answer, do NOT invent, approximate, or generalise them. Write the strongest honest answer using only what is there, and list exactly which facts you used.
- No invented employers, dates, titles, tools, team sizes, percentages, or metrics. Ever.

Voice:
- Match the Voice Card's archetype, tone, cadence, formality, and vocabulary bias.
- First person. No preamble, no restating the question, no signoff.
- No AI tells ("delve", "tapestry", "testament to", "in today's fast-paced"), no corporate cliché, no empty enthusiasm.

Structure:
- Follow the structure required by the supplied framework exactly.
- Respect the word limit given in the request.

Return ONLY this JSON object:
{ "answer": string, "factsUsed": string[] }`,
};

export function buildAnswerUser(input: AnswerGenerationInput): string {
  const maxWords = input.maxWords ?? 180;
  return [
    `Question:\n${input.question}`,
    `Framework: ${input.framework}\nRequired structure: ${FRAMEWORK_STRUCTURE[input.framework]}`,
    `Word limit: ${maxWords} words maximum.`,
    input.jobContext ? `Job context:\n${input.jobContext}` : null,
    `Voice Card:\n${JSON.stringify(input.voiceCard, null, 2)}`,
    `P0 fact inventory (the ONLY permitted facts):\n${input.factInventory.map((f) => `- ${f}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/** The P0 gate: generation is refused when the fact inventory is empty. */
export function assertFactInventory(factInventory: string[]): void {
  const usable = factInventory.filter((f) => typeof f === "string" && f.trim().length > 0);
  if (usable.length === 0) {
    throw new Error("P0 fact inventory is empty — answer generation is blocked until resume facts are available.");
  }
}

export function validateGeneratedAnswer(value: unknown, framework: QuestionFramework): GeneratedAnswer {
  const o = (value ?? {}) as { answer?: unknown; factsUsed?: unknown };
  const answer = String(o.answer ?? "").trim();
  if (!answer) throw new Error("Empty answer");
  return {
    answer,
    framework,
    factsUsed: Array.isArray(o.factsUsed) ? o.factsUsed.map(String) : [],
    wordCount: answer.split(/\s+/).filter(Boolean).length,
  };
}
