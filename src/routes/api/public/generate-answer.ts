// Extension-facing endpoint for the validated A -> J answer pipeline.
//
// ROUTE CONVENTION: `/api/public/*` means "reachable by the browser extension
// without the site auth gate". It is NOT unauthenticated — this handler
// enforces its own bearer-token check and resolves the user server-side.
//
// STRICT REQUEST CONTRACT. The body may contain ONLY:
//   { question: string, job?: { title?, company?, description? }, force?: boolean }
//   or { select: { answerId: string, variantId: "A" | "B" } }
// Any framework, facts, resume text, inventory, voice card, mode, model,
// prompt version or user id supplied by the client is ignored outright.
//
// STREAMING (opt-in, backward compatible): a request with `?stream=1` or
// `Accept: text/event-stream` gets an SSE response instead of JSON. The SSE
// stream carries:
//   event: draft  -> UNVALIDATED live preview text of the Prompt A draft
//   event: final  -> the same JSON payload the non-streaming response returns,
//                    produced only after guards + Prompt J + repair + post-guard
//   event: error  -> { code, error } using the existing safe error mapping
// A `draft` chunk must never be treated as the final answer.
import { createFileRoute } from "@tanstack/react-router";
import { corsHeaders, jsonWithCors, preflight } from "@/lib/cors";
import { sseFrame, sseHeaders } from "@/lib/ai/anthropic-stream.server";

function statusFor(code: string): number {
  switch (code) {
    case "inventory_missing":
    case "inventory_not_ready":
    case "inventory_stale":
    case "inventory_empty":
    case "no_resume":
    case "empty_resume":
    case "no_profile":
      return 409;
    case "in_progress":
      return 202;
    case "bad_question":
    case "bad_variant":
      return 400;
    case "not_found":
      return 404;
    case "model_unavailable":
    case "not_configured":
      return 503;
    default:
      return 502;
  }
}

export async function handleGenerateAnswer(request: Request): Promise<Response> {
  try {
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (!token) return jsonWithCors({ error: "Unauthorized" }, 401, request);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) return jsonWithCors({ error: "Unauthorized" }, 401, request);
    const userId = authData.user.id;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const { generateValidatedAnswer, recordVariantPreference, AnswerPipelineError } = await import(
      "@/lib/ai/answer-pipeline.server"
    );

    try {
      // Variant selection for resume-only users.
      const select = body.select as { answerId?: unknown; variantId?: unknown } | undefined;
      if (select && typeof select === "object") {
        const result = await recordVariantPreference(
          supabaseAdmin,
          userId,
          String(select.answerId ?? ""),
          String(select.variantId ?? "") as "A" | "B",
          { writeDb: supabaseAdmin },
        );
        return jsonWithCors({ ok: true, answer: result.answer }, 200, request);
      }

      const jobRaw = (body.job ?? null) as Record<string, unknown> | null;
      const job = jobRaw
        ? {
            title: jobRaw.title ? String(jobRaw.title).slice(0, 300) : undefined,
            company: jobRaw.company ? String(jobRaw.company).slice(0, 300) : undefined,
            description: jobRaw.description ? String(jobRaw.description).slice(0, 8000) : undefined,
          }
        : null;

      const result = await generateValidatedAnswer(
        supabaseAdmin,
        userId,
        { question: String(body.question ?? ""), jobContext: job, force: body.force === true },
        { writeDb: supabaseAdmin },
      );

      // Internal validation details, fact ids, prompt names and models stay server-side.
      return jsonWithCors(
        {
          ok: true,
          answerId: result.answerId,
          answer: result.answer,
          wordCount: result.wordCount,
          options: result.variants
            ? result.variants.map((v) => ({ id: v.id, answer: v.answer, wordCount: v.wordCount }))
            : null,
          needsChoice: result.needsVariantChoice,
          cached: result.cached,
        },
        200,
        request,
      );
    } catch (e) {
      if (e instanceof AnswerPipelineError) {
        return jsonWithCors({ ok: false, code: e.code, error: e.message }, statusFor(e.code), request);
      }
      throw e;
    }
  } catch (e) {
    console.error("[generate-answer]", e);
    return jsonWithCors(
      { ok: false, code: "pipeline_failed", error: "We couldn't produce an answer you can trust. Try again." },
      500,
      request,
    );
  }
}

export const Route = createFileRoute("/api/public/generate-answer")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => handleGenerateAnswer(request),
    },
  },
});
