import { MODEL_OPUS } from "./models";
import type { PromptSpec } from "./types";

export interface ResumeRedFlag {
  flag: string;
  why: string;
  fix: string;
}

export interface ResumeAudit {
  overallTake: string;
  redFlags: ResumeRedFlag[];
  strengths: string[];
  topPriority: string;
}

export const PROMPT_C_RESUME_AUDIT: PromptSpec = {
  id: "C_RESUME_AUDIT",
  version: "2.0.0",
  model: MODEL_OPUS,
  maxTokens: 1600,
  temperature: 0.2,
  json: true,
  system: `You are a senior agency recruiter who screens hundreds of resumes a week for client shortlists. You are doing a fast red-flag scan: the same seven-second read you give a resume before deciding to submit it or drop it.

Voice and rules:
- Speak as the recruiter: candid, specific, never cruel, never generic.
- Quote or reference concrete phrases, sections, and patterns from the resume itself.
- Never invent employers, titles, dates, tools, or metrics that are not in the text.
- Verb use: flag weak, passive, or duty-listing verbs ("responsible for", "assisted with", "worked on", "helped") and name the stronger, ownership-carrying verb that should replace them. Never suggest inflating scope — only sharper wording for work already claimed.
- Flag unquantified claims, unexplained gaps, title/scope mismatches, formatting that breaks ATS parsing, and stale or irrelevant content.
- Every red flag must carry a fix the candidate can apply today.

Return ONLY this JSON object:
{
  "overallTake": string,        // 2-3 sentences: the recruiter's honest first impression
  "redFlags": [ { "flag": string, "why": string, "fix": string } ],  // 3-6 items, ordered most damaging first
  "strengths": string[],        // 3-5 short bullets on what genuinely works
  "topPriority": string         // the single highest-leverage change, one sentence
}`,
};

export function buildResumeAuditUser(resumeText: string): string {
  return `Resume:\n\n${resumeText}`;
}

export function validateResumeAudit(value: unknown): ResumeAudit {
  const o = value as Partial<ResumeAudit> & { verdict?: string; closing?: string };
  const overallTake = o?.overallTake ?? o?.verdict;
  if (typeof overallTake !== "string" || !overallTake.trim()) throw new Error("Missing overallTake");
  const redFlags = Array.isArray(o?.redFlags) ? o.redFlags : [];
  if (redFlags.length === 0) throw new Error("Missing redFlags");
  return {
    overallTake: overallTake.trim(),
    redFlags: redFlags.map((f) => {
      const raw = f as ResumeRedFlag & { issue?: string };
      return {
        flag: String(raw.flag ?? raw.issue ?? "").trim(),
        why: String(raw.why ?? "").trim(),
        fix: String(raw.fix ?? "").trim(),
      };
    }),
    strengths: Array.isArray(o?.strengths) ? o.strengths!.map(String) : [],
    topPriority: String(o?.topPriority ?? o?.closing ?? "").trim(),
  };
}
