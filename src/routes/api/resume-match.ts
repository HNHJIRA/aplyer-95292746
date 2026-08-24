import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, jsonWithCors, preflight } from "@/lib/cors";
import {
  PROMPT_D_RESUME_SCORE,
  RESUME_SCORE_RETRY_INSTRUCTION,
  buildResumeScoreUser,
  validateResumeScore,
} from "@/lib/ai/prompts/prompt-d-resume-score";
import { PromptError, runPromptValidated } from "@/lib/ai/run-prompt.server";

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

          const { value: report } = await runPromptValidated(
            PROMPT_D_RESUME_SCORE,
            buildResumeScoreUser(capResume, capJd),
            validateResumeScore,
            RESUME_SCORE_RETRY_INSTRUCTION,
          );

          // Canonical Prompt D schema first; legacy aliases are additive only
          // and must never replace the canonical fields.
          const payload = {
            ...report,
            promptVersion: PROMPT_D_RESUME_SCORE.version,
            // --- legacy aliases (deprecated) ---
            jobDescriptionMatch: report.matchScore,
            overallMatch: report.matchScore,
            keywordCoverage: report.matchScore,
            matchingSkills: report.keywordsPresent,
            missingKeywords: report.keywordsMissing,
            missingSkills: report.keywordsMissing,
            suggestions: report.sectionSuggestions,
            priorityImprovements: report.sectionSuggestions.map((s, i) => ({
              priority: i + 1,
              title: s.split(/[.:]/)[0].slice(0, 80),
              recommendation: s,
            })),
          };

          return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        } catch (err) {
          console.error("[resume-match]", err);
          if (err instanceof PromptError) {
            const status =
              err.code === "model_unavailable" || err.code === "not_configured" ? 503 : 502;
            return jsonWithCors(
              {
                error:
                  status === 503
                    ? "Job Description Match is temporarily unavailable."
                    : "We could not score this resume. Please try again.",
                code: err.code,
              },
              status,
            );
          }
          return jsonWithCors({ error: "Something went wrong. Please try again." }, 500);
        }
      },
    },
  },
});
