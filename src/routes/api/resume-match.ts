import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, jsonWithCors, preflight } from "@/lib/cors";
import {
  PROMPT_D_RESUME_SCORE,
  buildResumeScoreUser,
  validateResumeScore,
} from "@/lib/ai/prompts/prompt-d-resume-score";
import { runPromptJson } from "@/lib/ai/run-prompt.server";

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

          const report = validateResumeScore(
            await runPromptJson(PROMPT_D_RESUME_SCORE, buildResumeScoreUser(capResume, capJd), {
              timeoutMs: 90_000,
            }),
          );

          // Canonical Prompt D shape + legacy aliases for existing frontends.
          const payload = {
            ...report,
            overallMatch: report.jobDescriptionMatch,
            keywordCoverage: report.jobDescriptionMatch,
            matchingSkills: report.keywordsPresent,
            missingKeywords: report.keywordsMissing,
            missingSkills: report.keywordsMissing,
            weaknesses: report.gaps,
            priorityImprovements: report.suggestions.map((s, i) => ({
              priority: i + 1,
              title: s.split(/[.:]/)[0].slice(0, 80),
              recommendation: s,
            })),
            promptVersion: PROMPT_D_RESUME_SCORE.version,
          };

          return new Response(JSON.stringify(payload), {
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
