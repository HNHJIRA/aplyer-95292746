// Extension-facing endpoint for application field memory.
//
// ROUTE CONVENTION: `/api/public/*` means "reachable by the browser extension
// without the site auth gate". It is NOT unauthenticated — this handler
// enforces its own bearer-token check and resolves the user server-side.
//
// STRICT REQUEST CONTRACT:
//   { action: "resolve", fields: [{ fieldId, questionText, fieldType, options }] }
//   { action: "save", answer: { questionText, fieldType, answerValue, options, source } }
//   { action: "used", questionHashes: string[] }
// A user id is never accepted from the client.
import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";

export async function handleFieldMemory(request: Request): Promise<Response> {
  try {
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (!token) return jsonWithCors({ ok: false, error: "Unauthorized" }, 401, request);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) return jsonWithCors({ ok: false, error: "Unauthorized" }, 401, request);
    const userId = authData.user.id;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "resolve");

    const {
      resolveFieldAnswers,
      saveFieldAnswer,
      markFieldAnswersUsed,
      normalizeFieldQueries,
      sanitizeOptions,
      FieldMemoryError,
    } = await import("@/lib/fields/field-memory.server");

    try {
      if (action === "resolve") {
        const fields = normalizeFieldQueries(body.fields);
        const decisions = await resolveFieldAnswers(supabaseAdmin, userId, fields);
        return jsonWithCors({ ok: true, decisions }, 200, request);
      }

      if (action === "save") {
        const a = (body.answer ?? {}) as Record<string, unknown>;
        const res = await saveFieldAnswer(supabaseAdmin, userId, {
          questionText: String(a.questionText ?? ""),
          fieldType: a.fieldType as never,
          answerValue: String(a.answerValue ?? ""),
          options: sanitizeOptions(a.options),
          source: a.source === "correction" ? "correction" : "user",
          confirmedByUser: a.confirmedByUser !== false,
        });
        return jsonWithCors({ ...res, ok: true }, 200, request);
      }

      if (action === "used") {
        const hashes = Array.isArray(body.questionHashes)
          ? body.questionHashes.map((h) => String(h ?? ""))
          : [];
        await markFieldAnswersUsed(supabaseAdmin, userId, hashes);
        return jsonWithCors({ ok: true }, 200, request);
      }

      return jsonWithCors({ ok: false, code: "bad_action", error: "Unknown action." }, 400, request);
    } catch (e) {
      if (e instanceof FieldMemoryError) {
        return jsonWithCors({ ok: false, code: e.code, error: e.message }, 400, request);
      }
      throw e;
    }
  } catch (e) {
    console.error("[field-memory]", e);
    return jsonWithCors(
      { ok: false, code: "field_memory_failed", error: "We couldn't reach your saved answers." },
      500,
      request,
    );
  }
}

export const Route = createFileRoute("/api/public/field-memory")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => handleFieldMemory(request),
    },
  },
});
