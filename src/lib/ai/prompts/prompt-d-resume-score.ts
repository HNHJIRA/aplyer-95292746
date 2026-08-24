import { MODEL_OPUS } from "./models";
import type { PromptSpec } from "./types";

/** Canonical Prompt D schema (locked SOP). Legacy aliases live in the route. */
export interface ResumeScoreReport {
  /** 0-100 Job Description Match. */
  matchScore: number;
  keywordsPresent: string[];
  keywordsMissing: string[];
  sectionSuggestions: string[];
  /** 5-8 sentence recruiter summary. */
  summary: string;
}

export const PROMPT_D_RESUME_SCORE: PromptSpec = {
  id: "D_RESUME_SCORE",
  version: "3.0.0",
  model: MODEL_OPUS,
  maxTokens: 1800,
  temperature: 0.2,
  json: true,
  system: `You score how well a resume matches one specific job description. The headline metric is called "Job Description Match" — never call it an interview likelihood, hire probability, or success rate, and never predict outcomes.

Rules:
- matchScore is 0-100 and measures the Job Description Match: evidence overlap between the resume and the job description only.
- keywordsPresent / keywordsMissing list concrete skills, tools, domains, or responsibilities named in the job description. Missing means genuinely absent from the resume, not merely worded differently.
- sectionSuggestions are concrete edits, each naming the resume section to change and what the job description asks for.
- Never invent experience the resume does not contain, and never treat a wording difference as a gap without saying so.
- summary is 5-8 full sentences: what fits, what does not, how close the candidate is, and what to change first.

Return ONLY this JSON object:
{
  "matchScore": number,
  "keywordsPresent": string[],
  "keywordsMissing": string[],
  "sectionSuggestions": string[],
  "summary": string
}`,
};

export const RESUME_SCORE_RETRY_INSTRUCTION = `Your previous response was invalid.
Return ONLY a JSON object with exactly these keys: matchScore (0-100 number), keywordsPresent (string[]), keywordsMissing (string[]), sectionSuggestions (string[]), summary (5-8 sentences).`;

export function buildResumeScoreUser(resumeText: string, jobDescription: string): string {
  return `Job description:\n\n${jobDescription}\n\n---\n\nResume:\n\n${resumeText}`;
}

function clamp(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function validateResumeScore(value: unknown): ResumeScoreReport {
  const o = (value ?? {}) as Partial<ResumeScoreReport> & {
    overallMatch?: number;
    jobDescriptionMatch?: number;
    suggestions?: unknown;
  };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const summary = String(o.summary ?? "").trim();
  if (!summary) throw new Error("Missing summary");
  const score = o.matchScore ?? o.jobDescriptionMatch ?? o.overallMatch;
  if (score === undefined || score === null) throw new Error("Missing matchScore");
  return {
    matchScore: clamp(score),
    keywordsPresent: list(o.keywordsPresent),
    keywordsMissing: list(o.keywordsMissing),
    sectionSuggestions: list(o.sectionSuggestions ?? o.suggestions),
    summary,
  };
}
