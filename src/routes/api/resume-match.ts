import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, corsHeaders, jsonWithCors, preflight } from "@/lib/cors";
import {
  PROMPT_D_RESUME_SCORE,
  RESUME_SCORE_RETRY_INSTRUCTION,
  buildResumeScoreUser,
  validateResumeScore,
  type ResumeScoreReport,
} from "@/lib/ai/prompts/prompt-d-resume-score";
import { PromptError, runPromptValidated } from "@/lib/ai/run-prompt.server";
import { makeJsonFieldPreview, sseResponse, wantsStream } from "@/lib/ai/anthropic-stream.server";

/** Canonical Prompt D schema plus legacy aliases (additive only). */
export function buildMatchPayload(report: ResumeScoreReport) {
  return {
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
}

/** Runs Prompt D with the unchanged single-retry validation contract. */
export async function generateResumeMatch(
  resume: string,
  jobDescription: string,
  opts: { onPreviewDelta?: (text: string) => void } = {},
): Promise<ResumeScoreReport> {
  // Preview shows ONLY the model's plain-language summary as it is written.
  const onDelta = opts.onPreviewDelta
    ? makeJsonFieldPreview({ key: "summary", onText: opts.onPreviewDelta })
    : undefined;
  const { value } = await runPromptValidated(
    PROMPT_D_RESUME_SCORE,
    buildResumeScoreUser(resume, jobDescription),
    validateResumeScore,
    RESUME_SCORE_RETRY_INSTRUCTION,
    onDelta ? { onDelta } : {},
  );
  return value;
}

/** Safe, client-facing error shape shared by the JSON and SSE responses. */
export function matchErrorPayload(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof PromptError) {
    const status = err.code === "model_unavailable" || err.code === "not_configured" ? 503 : 502;
    return {
      status,
      body: {
        error:
          status === 503
            ? "Job Description Match is temporarily unavailable."
            : "We could not score this resume. Please try again.",
        code: err.code,
      },
    };
  }
  return { status: 500, body: { error: "Something went wrong. Please try again." } };
}

export async function handleResumeMatch(request: Request): Promise<Response> {
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

          // Opt-in SSE. `final` carries the same validated payload as JSON.
          if (wantsStream(request)) {
            return sseResponse(async (send) => {
              try {
                const streamed = await generateResumeMatch(capResume, capJd, {
                  onPreviewDelta: (text) => send("draft", { text }),
                });
                send("final", buildMatchPayload(streamed));
              } catch (err) {
                console.error("[resume-match:stream]", err instanceof PromptError ? err.code : err);
                send("error", matchErrorPayload(err).body);
              }
            }, corsHeaders(request));
          }

          const report = await generateResumeMatch(capResume, capJd);

          // Canonical Prompt D schema first; legacy aliases are additive only
          // and must never replace the canonical fields.
          const payload = buildMatchPayload(report);

          return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        } catch (err) {
          console.error("[resume-match]", err instanceof PromptError ? err.code : err);
          const mapped = matchErrorPayload(err);
          return jsonWithCors(mapped.body, mapped.status, request);
        }
}

export const Route = createFileRoute("/api/resume-match")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => handleResumeMatch(request),
    },
  },
});
