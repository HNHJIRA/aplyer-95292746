import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, jsonWithCors, preflight } from "@/lib/cors";
import {
  PROMPT_C_RESUME_AUDIT,
  buildResumeAuditCorrection,
  buildResumeAuditUser,
  validateResumeAudit,
  RESUME_AUDIT_RETRY_INSTRUCTION,
  type ResumeAudit,
} from "@/lib/ai/prompts/prompt-c-resume-audit";
import { PromptError, runPromptValidated } from "@/lib/ai/run-prompt.server";
import {
  guardSummary,
  orderRedFlags,
  runResumeAuditGuards,
  type ResumeAuditGuardViolation,
} from "@/lib/ai/resume-audit-guards";

function guardable(audit: ResumeAudit) {
  return {
    overallTakePoints: audit.overallTakePoints,
    redFlags: audit.redFlags,
    strengths: audit.strengths.map((s) => s.point),
    topPriority: audit.topPriority,
  };
}

/** Prompt C -> structure -> guards -> one corrective retry -> ordering. */
export async function generateResumeAudit(resume: string, now: Date): Promise<ResumeAudit> {
  const baseUser = buildResumeAuditUser(resume, now);

  const first = await runPromptValidated(
    PROMPT_C_RESUME_AUDIT,
    baseUser,
    validateResumeAudit,
    RESUME_AUDIT_RETRY_INSTRUCTION,
  );

  let audit = first.value;
  let violations: ResumeAuditGuardViolation[] = runResumeAuditGuards(guardable(audit), {
    resumeText: resume,
    now,
  });

  if (violations.length > 0) {
    console.warn(
      JSON.stringify({
        evt: "resume_audit_guard_failed",
        prompt: PROMPT_C_RESUME_AUDIT.id,
        promptVersion: PROMPT_C_RESUME_AUDIT.version,
        attempt: 1,
        violations: guardSummary(violations),
      }),
    );
    const correction = `${baseUser}\n\n---\n\n${buildResumeAuditCorrection(
      Array.from(new Set(violations.map((v) => v.detail))),
    )}`;
    const second = await runPromptValidated(
      PROMPT_C_RESUME_AUDIT,
      correction,
      validateResumeAudit,
      RESUME_AUDIT_RETRY_INSTRUCTION,
    );
    audit = second.value;
    violations = runResumeAuditGuards(guardable(audit), { resumeText: resume, now });
    if (violations.length > 0) {
      console.warn(
        JSON.stringify({
          evt: "resume_audit_guard_failed",
          prompt: PROMPT_C_RESUME_AUDIT.id,
          promptVersion: PROMPT_C_RESUME_AUDIT.version,
          attempt: 2,
          violations: guardSummary(violations),
        }),
      );
      throw new PromptError({
        code: "invalid_output",
        promptId: PROMPT_C_RESUME_AUDIT.id,
        model: PROMPT_C_RESUME_AUDIT.model,
        message: "Resume audit failed deterministic guards twice.",
      });
    }
  }

  return { ...audit, redFlags: orderRedFlags(audit.redFlags, resume) };
}

/** Canonical payload plus legacy aliases so existing consumers keep working. */
export function buildAuditPayload(audit: ResumeAudit) {
  return {
    overallTake: audit.overallTake,
    overallTakePoints: audit.overallTakePoints,
    redFlags: audit.redFlags.map((f) => ({
      flag: f.flag,
      whyPoints: f.whyPoints,
      fixPoints: f.fixPoints,
      employer: f.employer,
      // legacy aliases
      issue: f.flag,
      why: f.whyPoints.join(" "),
      fix: f.fixPoints.join(" "),
    })),
    strengths: audit.strengths,
    strengthsText: audit.strengths.map((s) => s.point),
    topPriority: audit.topPriority,
    // legacy aliases
    verdict: audit.overallTake,
    closing: audit.topPriority,
    promptVersion: PROMPT_C_RESUME_AUDIT.version,
  };
}

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

          const audit = await generateResumeAudit(capped, new Date());

          return new Response(JSON.stringify(buildAuditPayload(audit)), {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        } catch (err) {
          console.error("[resume-audit]", err instanceof PromptError ? err.code : err);
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
