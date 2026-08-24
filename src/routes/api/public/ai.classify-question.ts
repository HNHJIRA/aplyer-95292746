import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";
import { ClassificationError, classifyQuestion } from "@/lib/ai/classify-question.server";

// Classification is server-authoritative: the client can never supply a
// trusted framework. Any `framework` field in the request body is ignored.
export async function handleClassifyQuestion(request: Request): Promise<Response> {
  try {
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (!token) return jsonWithCors({ error: "Unauthorized" }, 401, request);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) return jsonWithCors({ error: "Unauthorized" }, 401, request);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (question.length < 5) return jsonWithCors({ error: "question is required" }, 400, request);
    if (question.length > 2000) return jsonWithCors({ error: "question too long" }, 400, request);

    const result = await classifyQuestion(supabaseAdmin, question, {
      platform: typeof body.platform === "string" ? body.platform : undefined,
      fieldType: typeof body.fieldType === "string" ? body.fieldType : undefined,
    });

    return jsonWithCors(
      {
        ok: true,
        framework: result.framework,
        reason: result.reason,
        cached: result.cached,
        promptVersion: result.promptVersion,
        model: result.model,
      },
      200,
      request,
    );
  } catch (e) {
    if (e instanceof ClassificationError) {
      const status = e.code === "model_unavailable" || e.code === "not_configured" ? 503 : 502;
      return jsonWithCors({ error: e.message, code: e.code }, status, request);
    }
    console.error("[classify-question]", e);
    return jsonWithCors({ error: "Classification failed", code: "classification_failed" }, 500, request);
  }
}

export const Route = createFileRoute("/api/public/ai/classify-question")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => handleClassifyQuestion(request),
    },
  },
});
