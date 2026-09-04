import { MODEL_OPUS } from "./models";
import type { PromptSpec } from "./types";

export interface ResumeRedFlag {
  flag: string;
  /** Structured bullets explaining why this is a problem. */
  whyPoints: string[];
  /** Structured bullets with the concrete fix. */
  fixPoints: string[];
  /** Employer this flag concerns, when it is employment related. */
  employer: string | null;
  /** Legacy alias: whyPoints joined. */
  why: string;
  /** Legacy alias: fixPoints joined. */
  fix: string;
}

export interface ResumeStrength {
  point: string;
}

export interface ResumeAudit {
  overallTake: string;
  overallTakePoints: string[];
  redFlags: ResumeRedFlag[];
  strengths: ResumeStrength[];
  topPriority: string;
}

export const PROMPT_C_RESUME_AUDIT: PromptSpec = {
  id: "C_RESUME_AUDIT",
  version: "3.0.0",
  model: MODEL_OPUS,
  maxTokens: 1800,
  temperature: 0.2,
  json: true,
  system: `You are a senior agency recruiter who screens hundreds of resumes a week for client shortlists. You are doing a fast red-flag scan: the same seven-second read you give a resume before deciding to submit it or drop it.

Voice and rules:
- Speak as the recruiter, talking directly TO the candidate. Always say "you", "your role", "your experience". Never use the candidate's name. Never use he, she, his, her, him.
- Candid, specific, never cruel, never generic.
- Reference concrete phrases, sections, and patterns from the resume itself.
- Never invent employers, titles, dates, tools, or metrics that are not in the resume text. Every organisation, tool, or number you mention must already appear in the resume. When you are unsure whether the candidate owned something, ask a direct question ("Did you design that process?").
- Judge all recency and date claims against the date given in the user message. Never assume a different current year.
- Verb use: flag weak, passive, or duty-listing verbs ("responsible for", "assisted with", "worked on", "helped") and name the stronger, ownership-carrying verb that should replace them. Never suggest inflating scope, only sharper wording for work already claimed.
- Flag unquantified claims, unexplained gaps, title/scope mismatches, formatting that breaks ATS parsing, and stale or irrelevant content.
- Every red flag must carry a fix the candidate can apply today.

Style constraints for everything you write (these apply to your commentary, never to the candidate's own wording that you quote):
- Do not use em dashes or en dashes. Do not use a hyphen as sentence punctuation. Hyphens inside compound words are fine.
- Do not write three-item lists. Use two items, or four or more, or restructure the sentence.
- Vary how bullets open. No two consecutive strengths may begin with the same word.
- Each strength expresses ONE idea and stays at 22 words or fewer.
- Write plain sentences. No markdown, no numbering inside strings.

Return ONLY this JSON object:
{
  "overallTakePoints": string[],  // 2-3 short sentences: your honest first impression, one per item
  "redFlags": [                    // 3-6 items, most damaging first
    {
      "flag": string,              // the problem in one short line
      "whyPoints": string[],       // 1-3 bullets on why it costs the candidate
      "fixPoints": string[],       // 1-3 bullets with the concrete fix
      "employer": string | null    // the employer this concerns, exactly as written in the resume, or null
    }
  ],
  "strengths": [ { "point": string } ],  // 3-5 items, one idea each, max 22 words
  "topPriority": string            // the single highest-leverage change, one sentence
}`,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Formats a runtime date as YYYY-MM-DD in UTC. */
export function formatAuditDate(now: Date): string {
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

export function buildResumeAuditUser(resumeText: string, now: Date = new Date()): string {
  return `Today's date is ${formatAuditDate(now)}. Judge all recency and date claims against this date.\n\nResume:\n\n${resumeText}`;
}

function toStringArray(value: unknown, fallback?: unknown): string[] {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : null;
  if (source) {
    return source
      .map((v) => (typeof v === "string" ? v : typeof v === "object" && v ? String((v as { point?: unknown }).point ?? "") : String(v ?? "")))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const single = typeof value === "string" ? value : typeof fallback === "string" ? fallback : "";
  return single
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Structural validation only. Style guards run separately in the route. */
export function validateResumeAudit(value: unknown): ResumeAudit {
  const o = value as Record<string, unknown>;
  const overallTakePoints = toStringArray(o?.["overallTakePoints"], o?.["overallTake"] ?? o?.["verdict"]);
  if (overallTakePoints.length === 0) throw new Error("Missing overallTake");

  const rawFlags = Array.isArray(o?.["redFlags"]) ? (o["redFlags"] as unknown[]) : [];
  if (rawFlags.length === 0) throw new Error("Missing redFlags");

  const redFlags: ResumeRedFlag[] = rawFlags.map((raw) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    const whyPoints = toStringArray(f["whyPoints"], f["why"]);
    const fixPoints = toStringArray(f["fixPoints"], f["fix"]);
    const employerRaw = f["employer"];
    return {
      flag: String(f["flag"] ?? f["issue"] ?? "").trim(),
      whyPoints,
      fixPoints,
      employer: typeof employerRaw === "string" && employerRaw.trim() ? employerRaw.trim() : null,
      why: whyPoints.join(" "),
      fix: fixPoints.join(" "),
    };
  });
  if (redFlags.some((f) => !f.flag)) throw new Error("Red flag missing flag text");

  const strengths = toStringArray(o?.["strengths"]).map((point) => ({ point }));
  const topPriority = String(o?.["topPriority"] ?? o?.["closing"] ?? "").trim();
  if (!topPriority) throw new Error("Missing topPriority");

  return {
    overallTake: overallTakePoints.join(" "),
    overallTakePoints,
    redFlags,
    strengths,
    topPriority,
  };
}

export const RESUME_AUDIT_RETRY_INSTRUCTION = `Your previous response was invalid.
Return ONLY a JSON object with exactly these keys: overallTakePoints (2-3 short sentences as an array), redFlags (array of { flag, whyPoints: string[], fixPoints: string[], employer: string | null }, 3-6 items), strengths (array of { point }, 3-5 items, one idea each, max 22 words, no two consecutive items starting with the same word), topPriority (one sentence).
Follow every style rule: no em dashes, no en dashes, no hyphen used as punctuation, no three-item lists, address the candidate as "you" and never by name or with he/she/his/her, mention only organisations, tools, and numbers that appear in the resume, and judge dates against the date given above.`;

/** Builds the corrective retry message for deterministic guard failures. */
export function buildResumeAuditCorrection(violations: string[]): string {
  return `Your previous response broke these rules:\n${violations.map((v) => `- ${v}`).join("\n")}\n\nRewrite the audit. Keep the same JSON shape and the same findings, fix only the rule breaks listed above.`;
}
