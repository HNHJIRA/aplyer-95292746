import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, jsonWithCors, preflight } from "@/lib/cors";
import {
  PROMPT_C_RESUME_AUDIT,
  buildResumeAuditUser,
  validateResumeAudit,
  RESUME_AUDIT_RETRY_INSTRUCTION,
} from "@/lib/ai/prompts/prompt-c-resume-audit";
import { PromptError, runPromptValidated } from "@/lib/ai/run-prompt.server";

export const Route = createFileRoute("/api/resume-audit")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { resume?: unknown };
          const resume = typeof body.resume === "string" ? body.resume.trim() : "";
          if (resume.length < 100) {
            return jsonWithCors({ error: "Resume text is too short." }, 400);
          }
          const capped = resume.length > 20000 ? resume.slice(0, 20000) : resume;

          const { value: audit } = await runPromptValidated(
            PROMPT_C_RESUME_AUDIT,
            buildResumeAuditUser(capped),
            validateResumeAudit,
            RESUME_AUDIT_RETRY_INSTRUCTION,
            { timeoutMs: 90_000 },
          );

          // Canonical Prompt C shape + legacy aliases so existing frontends
          // (verdict / closing / redFlags[].issue) keep working.
          const payload = {
            ...audit,
            redFlags: audit.redFlags.map((f) => ({ ...f, issue: f.flag })),
            verdict: audit.overallTake,
            closing: audit.topPriority,
            promptVersion: PROMPT_C_RESUME_AUDIT.version,
          };

          return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        } catch (err) {
          console.error("[resume-audit]", err);
          if (err instanceof PromptError) {
            const status =
              err.code === "model_unavailable" || err.code === "not_configured" ? 503 : 502;
            return jsonWithCors(
              {
                error:
                  status === 503
                    ? "Resume audit is temporarily unavailable."
                    : "We could not complete the audit. Please try again.",
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
