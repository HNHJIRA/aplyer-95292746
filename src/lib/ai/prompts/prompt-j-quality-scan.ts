import { MODEL_OPUS } from "./models";
import type { PromptSpec } from "./types";

export interface QualityCheckResult {
  id: number;
  name: string;
  passed: boolean;
  note: string;
}

export interface QualityScanResult {
  passed: boolean;
  score: number;
  checks: QualityCheckResult[];
  blocking: string[];
  revisedAnswer: string | null;
}

/** The canonical 21 checks, in order. */
export const QUALITY_CHECKS = [
  "No invented facts, employers, dates, tools, or metrics",
  "Every claim traceable to the fact inventory",
  "Answers the question that was actually asked",
  "Correct framework structure for the question type",
  "Opens without preamble or restating the question",
  "No AI tells (delve, tapestry, testament, leverage-as-filler)",
  "No corporate cliché or empty enthusiasm",
  "Matches the candidate's Voice Card tone",
  "Matches the candidate's cadence and sentence length",
  "Matches the candidate's formality level",
  "Uses the candidate's vocabulary bias, not generic synonyms",
  "First person, consistent tense",
  "Specific over abstract — concrete detail present",
  "Result or outcome is stated where the framework requires it",
  "Within the requested length limit",
  "No repetition of the same point or phrase",
  "No hedging that undermines the claim",
  "No unexplained jargon or unexpanded acronyms",
  "Grammatically clean and readable",
  "Nothing that could embarrass the candidate if quoted back",
  "Reads like a person, not a template",
] as const;

export const PROMPT_J_QUALITY_SCAN: PromptSpec = {
  id: "J_QUALITY_SCAN",
  version: "1.0.0",
  model: MODEL_OPUS,
  maxTokens: 2200,
  temperature: 0,
  json: true,
  system: `You are the Aplyer quality gate. You receive a generated application answer, the question, the candidate's Voice Card, and the P0 fact inventory (the only facts that may appear in the answer).

Run all 21 checks in order and report each one honestly:
${QUALITY_CHECKS.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Rules:
- Checks 1 and 2 are hard blockers: any fact not present in the P0 fact inventory fails the scan outright.
- passed is true only when zero checks fail.
- score is the number of passed checks (0-21).
- blocking lists the short names of failed checks that must be fixed before the answer can be used.
- revisedAnswer: when the scan fails, rewrite the answer so every check passes, using ONLY the fact inventory. When the scan passes, return null.

Return ONLY this JSON object:
{
  "passed": boolean,
  "score": number,
  "checks": [ { "id": number, "name": string, "passed": boolean, "note": string } ],
  "blocking": string[],
  "revisedAnswer": string | null
}`,
};

export function buildQualityScanUser(input: {
  question: string;
  answer: string;
  voiceCard: unknown;
  factInventory: string[];
}): string {
  return [
    `Question:\n${input.question}`,
    `Answer to scan:\n${input.answer}`,
    `Voice Card:\n${JSON.stringify(input.voiceCard, null, 2)}`,
    `P0 fact inventory (the ONLY permitted facts):\n${input.factInventory.map((f) => `- ${f}`).join("\n")}`,
  ].join("\n\n---\n\n");
}

export function validateQualityScan(value: unknown): QualityScanResult {
  const o = (value ?? {}) as Partial<QualityScanResult>;
  const checks = Array.isArray(o.checks)
    ? o.checks.map((c, i) => {
        const raw = c as Partial<QualityCheckResult>;
        return {
          id: typeof raw.id === "number" ? raw.id : i + 1,
          name: String(raw.name ?? QUALITY_CHECKS[i] ?? `Check ${i + 1}`),
          passed: !!raw.passed,
          note: String(raw.note ?? ""),
        };
      })
    : [];
  if (checks.length === 0) throw new Error("Missing checks");
  const passed = checks.every((c) => c.passed);
  return {
    passed,
    score: checks.filter((c) => c.passed).length,
    checks,
    blocking: Array.isArray(o.blocking) ? o.blocking.map(String) : checks.filter((c) => !c.passed).map((c) => c.name),
    revisedAnswer: typeof o.revisedAnswer === "string" && o.revisedAnswer.trim() ? o.revisedAnswer.trim() : null,
  };
}
