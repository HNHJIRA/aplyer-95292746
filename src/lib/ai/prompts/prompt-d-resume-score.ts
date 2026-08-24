import { MODEL_OPUS } from "./models";
import type { PromptSpec } from "./types";

export interface ResumeScoreReport {
  /** 0-100 Job Description Match. */
  jobDescriptionMatch: number;
  keywordsPresent: string[];
  keywordsMissing: string[];
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  /** 5-8 sentence recruiter summary. */
  summary: string;
}

export const PROMPT_D_RESUME_SCORE: PromptSpec = {
  id: "D_RESUME_SCORE",
  version: "2.0.0",
  model: MODEL_OPUS,
  maxTokens: 1800,
  temperature: 0.2,
  json: true,
  system: `You score how well a resume matches one specific job description. The headline metric is called "Job Description Match" — never call it an interview likelihood, hire probability, or success rate, and never predict outcomes.

Rules:
- jobDescriptionMatch is 0-100 and measures evidence overlap between the resume and the job description only.
- keywordsPresent / keywordsMissing list concrete skills, tools, domains, or responsibilities named in the job description. Missing means genuinely absent from the resume, not merely worded differently.
- Never invent experience the resume does not contain, and never treat a wording difference as a gap without saying so.
- suggestions are concrete resume edits, each tied to something the job description actually asks for.
- summary is 5-8 full sentences: what fits, what does not, how close the candidate is, and what to change first.

Return ONLY this JSON object:
{
  "jobDescriptionMatch": number,
  "keywordsPresent": string[],
  "keywordsMissing": string[],
  "strengths": string[],
  "gaps": string[],
  "suggestions": string[],
  "summary": string
}`,
};

export function buildResumeScoreUser(resumeText: string, jobDescription: string): string {
  return `Job description:\n\n${jobDescription}\n\n---\n\nResume:\n\n${resumeText}`;
}

function clamp(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function validateResumeScore(value: unknown): ResumeScoreReport {
  const o = (value ?? {}) as Partial<ResumeScoreReport> & { overallMatch?: number };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const summary = String(o.summary ?? "").trim();
  if (!summary) throw new Error("Missing summary");
  return {
    jobDescriptionMatch: clamp(o.jobDescriptionMatch ?? o.overallMatch),
    keywordsPresent: list(o.keywordsPresent),
    keywordsMissing: list(o.keywordsMissing),
    strengths: list(o.strengths),
    gaps: list(o.gaps),
    suggestions: list(o.suggestions),
    summary,
  };
}
