import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, jsonWithCors, preflight } from "@/lib/cors";
import { aiJson } from "@/lib/ai.server";

interface PriorityImprovement {
  priority: number;
  title: string;
  recommendation: string;
}
interface MatchReport {
  overallMatch: number;
  atsScore: number;
  keywordCoverage: number;
  summary: string;
  matchingSkills: string[];
  missingKeywords: string[];
  missingSkills: string[];
  strengths: string[];
  weaknesses: string[];
  priorityImprovements: PriorityImprovement[];
  interviewLikelihood: { rating: string; reason: string };
}

const SYSTEM = `You are an ATS and recruiter analyst. Compare a resume against a job description and score fit.
Return STRICT JSON matching this TypeScript type, no prose, no markdown:
{
  "overallMatch": number,        // 0-100
  "atsScore": number,            // 0-100
  "keywordCoverage": number,     // 0-100
  "summary": string,             // 2-3 sentences
  "matchingSkills": string[],
  "missingKeywords": string[],
  "missingSkills": string[],
  "strengths": string[],
  "weaknesses": string[],
  "priorityImprovements": Array<{ "priority": number, "title": string, "recommendation": string }>,
  "interviewLikelihood": { "rating": string, "reason": string }
}
Be specific and grounded in the two texts. Never invent skills or employers.`;

export const Route = createFileRoute("/api/resume-match")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            resume?: unknown;
            jobDescription?: unknown;
          };
          const resume = typeof body.resume === "string" ? body.resume.trim() : "";
          const jd =
            typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";
          if (resume.length < 100) {
            return jsonWithCors({ error: "Resume text is too short." }, 400);
          }
          if (jd.length < 50) {
            return jsonWithCors({ error: "Job description is too short." }, 400);
          }
          const capResume = resume.length > 20000 ? resume.slice(0, 20000) : resume;
          const capJd = jd.length > 20000 ? jd.slice(0, 20000) : jd;

          const report = await aiJson<MatchReport>({
            system: SYSTEM,
            user: `RESUME:\n${capResume}\n\n---\n\nJOB DESCRIPTION:\n${capJd}`,
            maxTokens: 2500,
          });

          return new Response(JSON.stringify(report), {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        } catch (err) {
          console.error("[resume-match]", err);
          const msg = err instanceof Error ? err.message : "Unknown error";
          const status = /429|rate/i.test(msg) ? 429 : /402|payment/i.test(msg) ? 402 : 500;
          return jsonWithCors({ error: "Something went wrong. Please try again." }, status);
        }
      },
    },
  },
});
