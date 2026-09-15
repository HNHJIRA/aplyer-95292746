import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, corsHeaders, jsonWithCors, preflight } from "@/lib/cors";
import { makeJsonFieldPreview, sseResponse, wantsStream } from "@/lib/ai/anthropic-stream.server";
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

/**
 * Style violations that `sanitizeAudit` already repairs deterministically, or
 * that are cosmetic. They are recorded, but they never justify a second full
 * model call: that call doubled audit latency and changed the overall take
 * after it had already been streamed to the user.
 */
const STYLE_ONLY_CODES = new Set([
  "em_dash",
  "en_dash",
  "prohibited_hyphen",
  "rule_of_three",
  "duplicate_strength_opening",
  "strength_too_long",
]);

function needsModelCorrection(violations: ResumeAuditGuardViolation[]): boolean {
  return violations.some((v) => !STYLE_ONLY_CODES.has(v.code));
}

/** Prompt C -> structure -> guards -> one corrective retry -> ordering. */
export async function generateResumeAudit(
  resume: string,
  now: Date,
  opts: {
    onPreviewDelta?: (text: string) => void;
    /** Replaces the streamed preview with the text of the validated result. */
    onPreviewReplace?: (text: string) => void;
  } = {},
): Promise<ResumeAudit> {
  const baseUser = buildResumeAuditUser(resume, now);

  // Live preview shows ONLY the model's "overall take" sentences as they are
  // written. It is unvalidated text: the audit itself is still produced by the
  // unchanged structure -> guards -> retry pipeline below.
  const onDelta = opts.onPreviewDelta
    ? makeJsonFieldPreview({ key: "overallTakePoints", array: true, onText: opts.onPreviewDelta })
    : undefined;

  const first = await runPromptValidated(
    PROMPT_C_RESUME_AUDIT,
    baseUser,
    validateResumeAudit,
    RESUME_AUDIT_RETRY_INSTRUCTION,
    onDelta ? { onDelta } : {},
  );

  let audit = first.value;
  let violations: ResumeAuditGuardViolation[] = runResumeAuditGuards(guardable(audit), {
    resumeText: resume,
    now,
  });

  if (needsModelCorrection(violations)) {
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
    try {
      const second = await runPromptValidated(
        PROMPT_C_RESUME_AUDIT,
        correction,
        validateResumeAudit,
        RESUME_AUDIT_RETRY_INSTRUCTION,
      );
      const secondViolations = runResumeAuditGuards(guardable(second.value), {
        resumeText: resume,
        now,
      });
      // Keep whichever pass is cleaner; style guards are quality signals, not
      // a reason to deny the candidate an audit.
      if (secondViolations.length <= violations.length) {
        audit = second.value;
        violations = secondViolations;
      }
    } catch (e) {
      console.warn(
        JSON.stringify({
          evt: "resume_audit_retry_failed",
          prompt: PROMPT_C_RESUME_AUDIT.id,
          reason: e instanceof Error ? e.message.slice(0, 160) : "unknown",
        }),
      );
    }

    if (violations.length > 0) {
      console.warn(
        JSON.stringify({
          evt: "resume_audit_guard_residual",
          prompt: PROMPT_C_RESUME_AUDIT.id,
          promptVersion: PROMPT_C_RESUME_AUDIT.version,
          violations: guardSummary(violations),
        }),
      );
    }
  }

  audit = sanitizeAudit(audit);
  // The preview the user has been reading must end up identical to the overall
  // take in the validated result, even when a corrective pass replaced it.
  opts.onPreviewReplace?.(audit.overallTakePoints.join(" "));
  return { ...audit, redFlags: orderRedFlags(audit.redFlags, resume) };
}

/** Deterministic cleanup of style rules that can be fixed without the model. */
function cleanText(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s+-{1,2}\s+/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeAudit(audit: ResumeAudit): ResumeAudit {
  const overallTakePoints = audit.overallTakePoints.map(cleanText);
  const redFlags = audit.redFlags.map((f) => {
    const whyPoints = f.whyPoints.map(cleanText);
    const fixPoints = f.fixPoints.map(cleanText);
    return {
      ...f,
      flag: cleanText(f.flag),
      whyPoints,
      fixPoints,
      why: whyPoints.join(" "),
      fix: fixPoints.join(" "),
    };
  });
  return {
    overallTake: overallTakePoints.join(" "),
    overallTakePoints,
    redFlags,
    strengths: audit.strengths.map((s) => ({ point: cleanText(s.point) })),
    topPriority: cleanText(audit.topPriority),
  };
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

/** Safe, client-facing error shape shared by the JSON and SSE responses. */
export function auditErrorPayload(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof PromptError) {
    const status = err.code === "model_unavailable" || err.code === "not_configured" ? 503 : 502;
    return {
      status,
      body: {
        error:
          status === 503
            ? "Resume audit is temporarily unavailable."
            : "We could not complete the audit. Please try again.",
        code: err.code,
      },
    };
  }
  return { status: 500, body: { error: "Something went wrong. Please try again." } };
}

export async function handleResumeAudit(request: Request): Promise<Response> {
        try {
          const body = (await request.json().catch(() => ({}))) as { resume?: unknown };
          const resume = typeof body.resume === "string" ? body.resume.trim() : "";
          if (resume.length < 100) {
            return jsonWithCors({ error: "Resume text is too short." }, 400, request);
          }
          const capped = resume.length > 20000 ? resume.slice(0, 20000) : resume;

          // Opt-in SSE. Validation is untouched: `final` is emitted only after
          // the full audit pipeline (structure -> guards -> retry) resolves.
          if (wantsStream(request)) {
            return sseResponse(async (send) => {
              try {
                const audit = await generateResumeAudit(capped, new Date(), {
                  onPreviewDelta: (text) => send("draft", { text }),
                });
                send("final", buildAuditPayload(audit));
              } catch (err) {
                console.error("[resume-audit:stream]", err instanceof PromptError ? err.code : err);
                send("error", auditErrorPayload(err).body);
              }
            }, corsHeaders(request));
          }

          const audit = await generateResumeAudit(capped, new Date());

          return new Response(JSON.stringify(buildAuditPayload(audit)), {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        } catch (err) {
          console.error("[resume-audit]", err instanceof PromptError ? err.code : err);
          const mapped = auditErrorPayload(err);
          return jsonWithCors(mapped.body, mapped.status, request);
        }
}

export const Route = createFileRoute("/api/resume-audit")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => handleResumeAudit(request),
    },
  },
});
