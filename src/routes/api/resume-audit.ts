import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, jsonWithCors, preflight } from "@/lib/cors";
import {
  PROMPT_C_RESUME_AUDIT,
  buildResumeAuditUser,
  validateResumeAudit,
} from "@/lib/ai/prompts/prompt-c-resume-audit";
import { runPromptJson } from "@/lib/ai/run-prompt.server";

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

          const audit = validateResumeAudit(
            await runPromptJson(PROMPT_C_RESUME_AUDIT, buildResumeAuditUser(capped), { timeoutMs: 90_000 }),
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
          const msg = err instanceof Error ? err.message : "Unknown error";
          const status = /429|rate/i.test(msg) ? 429 : /402|payment/i.test(msg) ? 402 : 500;
          return jsonWithCors({ error: "Something went wrong. Please try again." }, status);
        }
      },
    },
  },
});
